import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Import = WYMIANA całej biblioteki, w każdym trybie, bez automatycznej kopii.
// Kopię użytkownik pobiera sam przyciskiem „Pobierz kopię JSON”.
//
// Regresje (audyt W1):
// - import JSON wymieniał tylko niepuste listy (plik z samymi filmami zostawiał
//   stare seriale) i zapisywał kopię, której nikt nie chciał,
// - w trybie demo import nie przełączał trybu, więc odświeżenie strony
//   wczytywało demo i zaimportowana biblioteka znikała,
// - w trybie serwera import pisał tylko do localStorage, a odświeżenie strony
//   wczytywało starą bazę z /api/movies — import CSV dodatkowo po cichu
//   przełączał aplikację na tryb klienta.

const BIBLIOTEKA_PRZED = {
  movies: [{ uuid: "m1", title: "Stary film A" }, { uuid: "m2", title: "Stary film B" }],
  shows: [{ uuid: "s1", title: "Stary serial", episodes_watched: [] }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const stanLokalny = (page) =>
  page.evaluate(() => {
    const wczytaj = (klucz) => JSON.parse(localStorage.getItem(klucz) || "null");
    return {
      tryb: localStorage.getItem("cinelog_active_mode"),
      biblioteka: wczytaj("cinelog_database"),
      kopia: wczytaj("cinelog_database_backup"),
    };
  });

const tytulyNaLiscie = (page) =>
  page.locator("#m3-movies-grid article.m3-card .m3-card-title").allInnerTexts();

const zapiszPlik = (testInfo, nazwa, tresc) => {
  const sciezka = testInfo.outputPath(nazwa);
  fs.writeFileSync(sciezka, typeof tresc === "string" ? tresc : JSON.stringify(tresc));
  return sciezka;
};

async function otworz(page, { tryb, biblioteka = null }) {
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.addInitScript(
    ({ tryb, biblioteka }) => {
      // Init script działa przy każdym przeładowaniu — ustawiamy stan tylko raz,
      // inaczej test sprawdzający „przetrwa odświeżenie” nadpisywałby własny wynik.
      if (sessionStorage.getItem("__e2e_przygotowane")) return;
      sessionStorage.setItem("__e2e_przygotowane", "1");
      localStorage.clear();
      localStorage.setItem("cinelog_active_mode", tryb);
      localStorage.setItem("vod-country", "PL");
      if (biblioteka) {
        localStorage.setItem("cinelog_database", JSON.stringify(biblioteka));
        localStorage.setItem("cinelog_user_imported", "true");
      }
    },
    { tryb, biblioteka }
  );
  await page.goto("/?mode=movies");
  await page.waitForTimeout(2500); // sonda /api/* ustawia backendAvailable
}

test.describe("Import zastępuje bibliotekę — tryb klienta i demo", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    // Tryb klienta nie może dotknąć wspólnej bazy serwera e2e.
    await page.route("**/api/**", (r) => r.abort());
  });

  test("plik z samymi filmami wymienia całą bibliotekę i nie robi kopii", async ({ page }, testInfo) => {
    await otworz(page, { tryb: "client", biblioteka: BIBLIOTEKA_PRZED });
    const plik = zapiszPlik(testInfo, "same-filmy.json", { movies: [{ title: "Nowy film" }] });

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect
      .poll(async () => (await stanLokalny(page)).biblioteka?.movies?.map((m) => m.title), { timeout: 10_000 })
      .toEqual(["Nowy film"]);

    const stan = await stanLokalny(page);
    expect(stan.biblioteka.shows, "import to wymiana — seriali z pliku nie było").toEqual([]);
    expect(stan.biblioteka.movies[0].uuid, "wpis musi być adresowalny").toBeTruthy();
    expect(stan.kopia, "import nie zapisuje automatycznej kopii").toBeNull();
    expect(stan.tryb).toBe("client");
  });

  test("import w trybie demo przetrwa odświeżenie strony", async ({ page }, testInfo) => {
    await otworz(page, { tryb: "demo" });
    const plik = zapiszPlik(testInfo, "z-demo.json", { movies: [{ title: "Mój własny film" }], shows: [] });

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect.poll(() => tytulyNaLiscie(page), { timeout: 10_000 }).toEqual(["Mój własny film"]);

    await page.reload();
    await expect.poll(() => tytulyNaLiscie(page), { timeout: 15_000 }).toEqual(["Mój własny film"]);
    expect((await stanLokalny(page)).tryb).toBe("client");
  });
});

test.describe("Import CSV — podgląd i skala ocen", () => {
  test.use({ serviceWorkers: "block" });

  test("IMDb CSV: podgląd pokazuje pozycje, oceny 1–10 trafiają w skali 1–5", async ({ page }, testInfo) => {
    await page.route("**/api/**", (r) => r.abort());
    await otworz(page, { tryb: "client", biblioteka: BIBLIOTEKA_PRZED });
    const plik = zapiszPlik(
      testInfo,
      "imdb.csv",
      "Const,Your Rating,Date Rated,Title,Title Type,Year\n" +
        "tt0111161,10,2024-01-01,Skazani na Shawshank,movie,1994\n" +
        "tt0068646,7,2024-01-02,Ojciec chrzestny,movie,1972\n" +
        "tt0000001,1,2024-01-03,Słaby film,movie,2001\n"
    );

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect(page.locator("#m3-import-stat-total")).toHaveText("3");
    await expect(page.locator("#m3-btn-start-import")).toContainText("Zastąp bibliotekę (3 pozycji)");
    await page.locator("#m3-btn-start-import").click();

    await expect
      .poll(async () => (await stanLokalny(page)).biblioteka?.movies?.length, { timeout: 15_000 })
      .toBe(3);
    const stan = await stanLokalny(page);
    expect(Object.fromEntries(stan.biblioteka.movies.map((m) => [m.title, m.rating]))).toEqual({
      "Skazani na Shawshank": 5,
      "Ojciec chrzestny": 4,
      "Słaby film": 1,
    });
    expect(stan.biblioteka.shows, "import to wymiana — stary serial znika").toEqual([]);
  });
});

test.describe("Import zastępuje bibliotekę — tryb serwera (czarna skrzynka)", () => {
  test.use({ serviceWorkers: "block" });
  // Testy piszą do wspólnej bazy serwera e2e — bez równoległości i z odtworzeniem stanu.
  test.describe.configure({ mode: "serial" });

  let bazaSerwera = null;

  test.beforeEach(async ({ request }) => {
    bazaSerwera = {
      movies: await (await request.get("/api/movies")).json(),
      shows: await (await request.get("/api/shows")).json(),
    };
  });

  test.afterEach(async ({ request }) => {
    const res = await request.post("/api/import", { data: bazaSerwera });
    expect(res.ok(), "odtworzenie bazy serwera po teście").toBeTruthy();
  });

  test("import JSON zapisuje bibliotekę na serwerze", async ({ page, request }, testInfo) => {
    await otworz(page, { tryb: "flask" });
    const plik = zapiszPlik(testInfo, "serwer.json", {
      movies: [{ title: "Import serwera" }],
      shows: [{ title: "Serial z importu", episodes_watched: [{ season: 1, episode: 2 }] }],
    });

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect
      .poll(async () => (await (await request.get("/api/movies")).json()).map((m) => m.title), { timeout: 10_000 })
      .toEqual(["Import serwera"]);

    const seriale = await (await request.get("/api/shows")).json();
    expect(seriale.map((s) => s.title)).toEqual(["Serial z importu"]);
    expect(seriale[0].episodes_watched).toHaveLength(1);
    expect((await stanLokalny(page)).tryb, "import nie zmienia trybu").toBe("flask");

    await page.reload();
    await expect.poll(() => tytulyNaLiscie(page), { timeout: 15_000 }).toEqual(["Import serwera"]);
  });

  test("import CSV (Letterboxd) zapisuje bibliotekę na serwerze i zostaje w trybie serwera", async ({ page, request }, testInfo) => {
    // Bez sieci do TMDb: wzbogacanie metadanych zwraca „brak klucza”, wpisy idą z CSV.
    await page.route("**/api/search_detail**", (r) => r.fulfill(json({ needs_key: true })));
    await otworz(page, { tryb: "flask" });
    const plik = zapiszPlik(
      testInfo,
      "letterboxd.csv",
      "Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Diuna,2021,https://boxd.it/a,4\n2024-01-03,Oppenheimer,2023,https://boxd.it/b,5\n"
    );

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect(page.locator("#m3-btn-start-import")).toBeVisible();
    await expect(page.locator("#m3-btn-start-import")).toContainText("Zastąp bibliotekę (2 pozycji)");
    await page.locator("#m3-btn-start-import").click();

    await expect
      .poll(async () => (await (await request.get("/api/movies")).json()).map((m) => m.title).sort(), { timeout: 15_000 })
      .toEqual(["Diuna", "Oppenheimer"]);
    const filmy = await (await request.get("/api/movies")).json();
    // Letterboxd ocenia w gwiazdkach 0,5–5 — to już skala biblioteki (1–5).
    expect(Object.fromEntries(filmy.map((m) => [m.title, m.rating]))).toEqual({ Diuna: 4, Oppenheimer: 5 });
    expect(await (await request.get("/api/shows")).json()).toEqual([]);
    expect((await stanLokalny(page)).tryb).toBe("flask");
  });
});
