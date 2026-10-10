import { test, expect } from "@playwright/test";

// Zgłoszenie użytkownika: telefon i komputer zalogowane na to samo konto Google, ale
// zmiany nie przechodziły same — trzeba było ręcznie kliknąć „Scal”. Przyczyny:
// 1. przy starcie aplikacja wołała nieistniejącą funkcję checkAutoSync — wyjątek
//    połykał pusty catch, więc pobranie bazy z Dysku nigdy się nie odbywało;
// 2. powrót do aplikacji (PWA w tle na telefonie) niczego nie pobierał;
// 3. token Google żyje godzinę — po nim zapis na Dysk po cichu się nie odbywał.
// Teraz: pobranie przy starcie i po powrocie do aplikacji; bez lokalnych zmian
// czekających na wysłanie Dysk jest źródłem prawdy (usunięcia też przechodzą),
// z takimi zmianami — scalenie i wysłanie; po wygaśnięciu tokenu synchronizacja
// wznawia się przy pierwszym dotknięciu (Google wymaga gestu użytkownika).

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const PLIK_BAZY = "baza-test-1";
const PLIK_USTAWIEN = "ustawienia-test-1";

const film = (uuid, title, tmdb_id) => ({
  uuid,
  title,
  tmdb_id,
  status: "watched",
  rating: null,
  is_favorite: false,
  poster_url: "",
  release_date: "2010-01-01",
  watch_date: "2026-01-01 10:00:00",
});

const INCEPCJA = film("m-1", "Incepcja", 27205);
const DIUNA = film("m-2", "Diuna", 438631);
const ARRIVAL = film("m-3", "Nowy początek", 329865);

/**
 * Atrapa Dysku Google: baza w pamięci testu, zapisy zbierane w `wysylki`.
 * @param {import("@playwright/test").Page} page
 * @param {{movies: object[], shows: object[]}} bazaNaDysku
 */
async function atrapaDysku(page, bazaNaDysku) {
  const dysk = { baza: bazaNaDysku, wysylki: [], pobrania: 0 };
  await page.route("**/api/**", (r) => r.abort());
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({ results: [] })));
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  await page.route("https://www.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("/upload/drive/")) {
      const tresc = req.postData() || "";
      if (tresc.includes("cinelog_database.json")) {
        const start = tresc.indexOf('{\n  "app"');
        const wyslana = JSON.parse(tresc.slice(start, tresc.lastIndexOf("}") + 1));
        dysk.wysylki.push(wyslana);
        dysk.baza = { movies: wyslana.movies, shows: wyslana.shows };
        return route.fulfill(json({ id: PLIK_BAZY }));
      }
      return route.fulfill(json({ id: PLIK_USTAWIEN }));
    }
    if (url.includes(`/files/${PLIK_BAZY}?alt=media`)) {
      dysk.pobrania += 1;
      return route.fulfill(json({ app: "CineLog", ...dysk.baza }));
    }
    if (url.includes(`/files/${PLIK_USTAWIEN}?alt=media`)) {
      return route.fulfill(json({ country: "PL", subscriptions: [] }));
    }
    if (url.includes(`/files/${PLIK_BAZY}?fields`)) {
      return route.fulfill(json({ id: PLIK_BAZY, name: "cinelog_database.json", trashed: false }));
    }
    if (url.includes(`/files/${PLIK_USTAWIEN}?fields`)) {
      return route.fulfill(json({ id: PLIK_USTAWIEN, name: "cinelog_settings.json", trashed: false }));
    }
    if (url.includes("/drive/v3/files?")) {
      const ustawienia = decodeURIComponent(url).includes("cinelog_settings.json");
      return route.fulfill(json({ files: [{ id: ustawienia ? PLIK_USTAWIEN : PLIK_BAZY }] }));
    }
    return route.fulfill(json({}));
  });
  return dysk;
}

/**
 * Biblioteka w przeglądarce + stan połączenia z Dyskiem.
 * @param {import("@playwright/test").Page} page
 */
async function przegladarka(page, { movies, tokenWazny = true, zmianyDoWyslania = false }) {
  await page.addInitScript(
    ({ movies, tokenWazny, zmianyDoWyslania, plikBazy, plikUstawien }) => {
      if (sessionStorage.getItem("przygotowane")) return; // odświeżenie strony w teście
      sessionStorage.setItem("przygotowane", "1");
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
      localStorage.setItem("vod-country", "PL");
      localStorage.setItem(
        "cinelog_database",
        JSON.stringify({ movies, shows: [], updated_at: new Date().toISOString() })
      );
      localStorage.setItem("gdrive_client_id", "klient-testowy.apps.googleusercontent.com");
      localStorage.setItem("gdrive_access_token", "token-testowy");
      localStorage.setItem("gdrive_token_exp", String(tokenWazny ? Date.now() + 3_600_000 : Date.now() - 1000));
      localStorage.setItem("gdrive_file_id", plikBazy);
      localStorage.setItem("gdrive_settings_file_id", plikUstawien);
      if (zmianyDoWyslania) localStorage.setItem("gdrive_pending_upload", "true");
    },
    { movies, tokenWazny, zmianyDoWyslania, plikBazy: PLIK_BAZY, plikUstawien: PLIK_USTAWIEN }
  );
  // Atrapa Google Identity Services: zgoda wydana wcześniej, więc token przychodzi
  // bez pytania — ale tylko wtedy, gdy aplikacja o niego poprosi.
  await page.addInitScript(() => {
    window.__prosbyOToken = 0;
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => {
            const klient = {
              callback: cfg.callback,
              requestAccessToken: () => {
                window.__prosbyOToken += 1;
                setTimeout(() => klient.callback({ access_token: "token-odnowiony", expires_in: 3600 }), 50);
              },
            };
            return klient;
          },
          revoke: () => {},
        },
      },
    };
  });
}

const tytulyNaLiscie = (page) =>
  page.locator("#m3-movies-grid article.m3-card").evaluateAll((karty) => karty.map((k) => k.innerText));

test.describe("Automatyczna synchronizacja z Dyskiem Google", () => {
  test.use({ serviceWorkers: "block" });

  test("przy starcie pobiera zmiany z drugiego urządzenia", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid")).toContainText("Diuna", { timeout: 10_000 });
  });

  test("usunięcie na drugim urządzeniu też przechodzi (bez lokalnych zmian Dysk wygrywa)", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA, DIUNA] });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);
    await expect(page.locator("#m3-movies-grid")).not.toContainText("Diuna", { timeout: 10_000 });
    expect(await tytulyNaLiscie(page)).toHaveLength(1);
    expect(dysk.wysylki, "pobranie bez lokalnych zmian nie może nic wysyłać").toHaveLength(0);
  });

  test("lokalne zmiany czekające na wysłanie są scalane i wysyłane", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA, ARRIVAL], zmianyDoWyslania: true });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid")).toContainText("Diuna", { timeout: 10_000 });
    await expect(page.locator("#m3-movies-grid")).toContainText("Nowy początek");
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const naDysku = dysk.baza.movies.map((m) => m.title).sort();
    expect(naDysku).toEqual(["Diuna", "Incepcja", "Nowy początek"]);
  });

  test("powrót do aplikacji pobiera zmiany zrobione w międzyczasie", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);

    // W tym czasie na telefonie dodano film.
    dysk.baza = { movies: [INCEPCJA, DIUNA], shows: [] };
    await page.evaluate(() => {
      window.googleDriveSync.ostatniaSynchronizacja = 0; // pomijamy limit częstotliwości
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.locator("#m3-movies-grid")).toContainText("Diuna", { timeout: 10_000 });
  });

  test("po wygaśnięciu tokenu synchronizacja wznawia się przy pierwszym dotknięciu", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA], tokenWazny: false });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__prosbyOToken), "bez gestu nie wolno otwierać okna Google").toBe(0);
    await expect(page.locator("#m3-drive-status-text")).toContainText("Dotknij");

    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(page.locator("#m3-movies-grid")).toContainText("Diuna", { timeout: 10_000 });
    expect(await page.evaluate(() => window.__prosbyOToken)).toBe(1);
  });

  test("zmiana zrobiona po wygaśnięciu tokenu nie przepada — trafia na Dysk", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA], tokenWazny: false });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });

    // Prawdziwa edycja przy wygasłym tokenie: serduszko na karcie filmu.
    await page.locator("#m3-movies-grid .m3-card-fav-btn").first().click();

    await expect
      .poll(() => (dysk.baza.movies.find((m) => m.title === "Incepcja") || {}).is_favorite, { timeout: 10_000 })
      .toBe(true);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("gdrive_pending_upload"))).toBeNull();
  });
});
