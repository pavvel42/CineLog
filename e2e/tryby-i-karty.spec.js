import { test, expect } from "@playwright/test";

// Regresja (audyt D1): trzy tryby danych muszą mieć trzy osobne bazy, a karta przeglądarki
// zapisuje wyłącznie bazę trybu, w którym sama została wczytana. Wcześniej demo i biblioteka
// użytkownika dzieliły klucz "cinelog_database", więc:
//  - karta otwarta w demo po jednym kliknięciu nadpisywała bibliotekę użytkownika z drugiej karty,
//  - przejście klient → demo → odświeżenie kasowało bibliotekę razem z jej kopią,
//  - dwie karty w trybie klienta gubiły nawzajem swoje zmiany.

const film = (n, extra = {}) => ({
  uuid: `bbbbbbbb-0000-4000-8000-00000000000${n}`,
  title: `MOJ FILM ${n}`,
  year: `202${n}`,
  status: "watched",
  rating: 4,
  is_favorite: false,
  follow_date: `2026-01-0${n} 10:00:00`,
  ...extra,
});

const BIBLIOTEKA = { movies: [film(1), film(2)], shows: [], updated_at: "2026-01-01T00:00:00.000Z" };

const bezSieci = async (context) => {
  // Brak backendu (jak GitHub Pages) i brak Dysku: test nie dotyka niczego poza przeglądarką.
  await context.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
  await context.route("https://www.googleapis.com/**", (r) => r.abort());
  await context.route("https://api.themoviedb.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
};

const zasiejBiblioteke = (page, db = BIBLIOTEKA) =>
  page.addInitScript((zawartosc) => {
    if (sessionStorage.getItem("__zasiane")) return; // tylko pierwsze wczytanie tej karty
    sessionStorage.setItem("__zasiane", "1");
    if (localStorage.getItem("__zasiane")) return; // druga karta nie nadpisuje stanu pierwszej
    localStorage.setItem("__zasiane", "1");
    localStorage.setItem("cinelog_database", JSON.stringify(zawartosc));
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
  }, db);

const baza = (page, klucz = "cinelog_database") =>
  page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), klucz);

const tytuly = async (page, klucz) => ((await baza(page, klucz))?.movies || []).map((m) => m.title);

test.describe("Tryby danych i wiele kart", () => {
  test.use({ serviceWorkers: "block" });

  test("karta otwarta w demo nie nadpisuje biblioteki użytkownika z drugiej karty", async ({ context }) => {
    await bezSieci(context);

    const kartaDemo = await context.newPage();
    await kartaDemo.goto("/");
    await expect(kartaDemo.locator("#m3-movies-grid article.m3-card")).toHaveCount(50);

    // Druga karta: użytkownik przechodzi na własną bibliotekę (to samo zostawia import pliku).
    const kartaUzytkownika = await context.newPage();
    await kartaUzytkownika.goto("/");
    await kartaUzytkownika.evaluate((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_user_imported", "true");
      localStorage.setItem("cinelog_active_mode", "client");
    }, BIBLIOTEKA);

    // Stara karta sama przechodzi na bibliotekę użytkownika, zamiast trzymać demo w pamięci.
    await kartaDemo.bringToFront();
    await expect(kartaDemo.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);
    await kartaDemo.locator("#m3-movies-grid .m3-card-fav-btn").first().click();

    await expect.poll(() => tytuly(kartaDemo)).toEqual(["MOJ FILM 1", "MOJ FILM 2"]);
    const poKliknieciu = await baza(kartaDemo);
    expect(poKliknieciu.movies.filter((m) => m.is_favorite), "kliknięcie trafiło w bibliotekę użytkownika").toHaveLength(1);
  });

  test("zapis z karty demo nigdy nie trafia pod klucz biblioteki użytkownika", async ({ context }) => {
    await bezSieci(context);
    const kartaDemo = await context.newPage();
    await kartaDemo.goto("/");
    await expect(kartaDemo.locator("#m3-movies-grid article.m3-card")).toHaveCount(50);

    // Zmiana trybu „za plecami" karty, bez zdarzenia storage (ta sama karta pisze sama do siebie):
    // najgorszy przypadek — karta nie wie, że tryb się zmienił, i zapisuje.
    await kartaDemo.evaluate((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_user_imported", "true");
      localStorage.setItem("cinelog_active_mode", "client");
    }, BIBLIOTEKA);
    await kartaDemo.locator("#m3-movies-grid .m3-card-fav-btn").first().click();
    await kartaDemo.waitForTimeout(800);

    expect(await tytuly(kartaDemo)).toEqual(["MOJ FILM 1", "MOJ FILM 2"]);
  });

  test("tryb demo nie rusza biblioteki użytkownika ani jej kopii, także po odświeżeniu", async ({ context }) => {
    await bezSieci(context);
    const page = await context.newPage();
    await zasiejBiblioteke(page);
    await page.goto("/");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);

    await page.evaluate(() => document.getElementById("m3-btn-switch-demo").click());
    await page.evaluate(() => document.getElementById("m3-dialog-btn-confirm").click());
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(50);
    expect(await tytuly(page), "biblioteka użytkownika po przejściu na demo").toEqual(["MOJ FILM 1", "MOJ FILM 2"]);

    await page.reload();
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(50);
    expect(await tytuly(page), "biblioteka użytkownika po odświeżeniu w demo").toEqual(["MOJ FILM 1", "MOJ FILM 2"]);
    const kopia = await baza(page, "cinelog_database_backup");
    expect(kopia === null || kopia.movies.length === 2, "kopia nie może zawierać bazy demo").toBe(true);

    await page.evaluate(() => document.getElementById("m3-btn-switch-client").click());
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);
    expect(await page.evaluate(() => localStorage.getItem("cinelog_active_mode"))).toBe("client");
    expect(await tytuly(page)).toEqual(["MOJ FILM 1", "MOJ FILM 2"]);
  });

  test("dwie karty w trybie klienta nie gubią nawzajem swoich zmian", async ({ context }) => {
    await bezSieci(context);
    const a = await context.newPage();
    await zasiejBiblioteke(a);
    await a.goto("/");
    const b = await context.newPage();
    await zasiejBiblioteke(b);
    await b.goto("/");
    await expect(a.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);
    await expect(b.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);

    const serce = (page, tytul) =>
      page.locator("#m3-movies-grid article.m3-card", { hasText: tytul }).locator(".m3-card-fav-btn").click();

    await serce(a, "MOJ FILM 1");
    await expect.poll(async () => (await baza(a)).movies.filter((m) => m.is_favorite).length).toBe(1);
    await b.bringToFront();
    await serce(b, "MOJ FILM 2");

    await expect
      .poll(async () => (await baza(b)).movies.filter((m) => m.is_favorite).map((m) => m.title).sort())
      .toEqual(["MOJ FILM 1", "MOJ FILM 2"]);
  });
});
