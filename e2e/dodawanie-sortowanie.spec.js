import { test, expect } from "@playwright/test";

// Zgłoszenie użytkownika: dodany film („Mroczny Rycerz") ląduje na SAMYM DOLE listy
// przy sortowaniu „Ostatnio dodane / aktywność", mimo że jest najnowszy.
// Przyczyna: sortowanie bierze `watch_date || follow_date || created_at`, a ścieżki
// klienckie (tryb demo / GitHub Pages / brak backendu) zapisywały wyłącznie `user_date`
// — datę bez godziny, której sortowanie w ogóle nie znało. Serwer Flask nadaje
// `follow_date`, więc błąd było widać tylko po stronie klienta.
// Poprawka: klient nadaje `follow_date` (i `watch_date` dla obejrzanych) jak serwer,
// a sortowanie zna też `user_date` — to ratuje wpisy dodane wcześniej.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const MROCZNY_RYCERZ = {
  id: 155,
  title: "Mroczny Rycerz",
  original_title: "The Dark Knight",
  release_date: "2008-07-16",
  overview: "Batman podejmuje walkę z Jokerem.",
  runtime: 152,
  poster_path: "/qJ2tW6WMUDux911r6m7haRef0WH.jpg",
  vote_average: 8.5,
};

// Biblioteka jak z importu / konwersji: każdy film ma datę, od której sortowanie liczy.
const biblioteka = (dodatkowe = []) => ({
  movies: [
    { uuid: "m1", title: "Alfa", status: "watched", rating: 4, tmdb_id: 1, created_at: "2021-05-01 10:00:00", watch_date: "2021-05-02 10:00:00" },
    { uuid: "m2", title: "Beta", status: "watched", rating: 3, tmdb_id: 2, created_at: "2022-06-01 10:00:00", watch_date: "2022-06-02 10:00:00" },
    { uuid: "m3", title: "Gamma", status: "watchlist", rating: null, tmdb_id: 3, created_at: "2023-07-01 10:00:00" },
    ...dodatkowe,
  ],
  shows: [],
  updated_at: new Date().toISOString(),
});

async function przygotuj(page, bibliotekaBazy) {
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
  // Predykaty po ścieżce: globy gubią parametry zapytania (`?language=`).
  await page.route(
    (url) => url.hostname === "api.themoviedb.org" && url.pathname.includes("/search/movie"),
    (r) => r.fulfill(json({ results: [MROCZNY_RYCERZ] }))
  );
  await page.route(
    (url) => url.hostname === "api.themoviedb.org" && /\/movie\/155$/.test(url.pathname),
    (r) => r.fulfill(json(MROCZNY_RYCERZ))
  );
  await page.addInitScript((dane) => {
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
    localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
    localStorage.setItem("vod-country", "PL");
    localStorage.setItem("cinelog_database", JSON.stringify(dane));
  }, bibliotekaBazy);
  await page.goto("/?mode=movies");
  await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible({ timeout: 15_000 });
}

const dodajPrzezUI = async (page, tytul = "Mroczny Rycerz") => {
  await page.locator("#m3-fab-add").click();
  await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/, { timeout: 10_000 });
  await page.fill("#m3-search-preview-input", tytul);
  await page.click("#m3-btn-search-trigger");
  await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });
  await page.locator("#m3-confirm-add-form button[type=submit]").click();
  await expect(page.locator("#m3-toast-notification")).toContainText(tytul, { timeout: 10_000 });
};

test.describe("Nowo dodany film na czele „Ostatnio dodane / aktywność”", () => {
  test.use({ serviceWorkers: "block" });

  test("dodany film jest pierwszy na liście, mimo że biblioteka ma starsze daty", async ({ page }) => {
    await przygotuj(page, biblioteka());
    await dodajPrzezUI(page);

    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toContainText("Mroczny Rycerz");
    // Kolejność reszty bez zmian: Beta (2022) przed Alfą (2021), a Gamma bez daty obejrzenia na końcu.
    const tytuly = await page.locator("#m3-movies-grid article.m3-card").allInnerTexts();
    expect(tytuly.slice(1).join(" | ")).toContain("Beta");
  });

  test("wpis dostaje datę aktywności (follow_date) i datę obejrzenia", async ({ page }) => {
    await przygotuj(page, biblioteka());
    await dodajPrzezUI(page);

    const wpis = await page.evaluate(() => {
      const dane = JSON.parse(localStorage.getItem("cinelog_database") || "{}");
      return (dane.movies || []).find((m) => m.title === "Mroczny Rycerz") || null;
    });
    expect(wpis).not.toBeNull();
    expect(wpis.follow_date).toBeTruthy();
    // Formularz domyślnie dodaje jako obejrzane — wtedy data obejrzenia = teraz.
    expect(wpis.status).toBe("watched");
    expect(wpis.watch_date).toBeTruthy();
  });

  test("wpisy dodane wcześniej (tylko user_date) też sortują się na czele", async ({ page }) => {
    // Tak wygląda wpis dodany przed poprawką — ma wyłącznie user_date.
    const stary = { uuid: "m9", title: "Mroczny Rycerz", status: "watchlist", rating: null, tmdb_id: 155, user_date: "2026-09-19" };
    await przygotuj(page, biblioteka([stary]));

    const kolejnosc = await page.evaluate(async () => {
      const { sortItems } = await import("/static/js/modules/movies.js");
      const dane = JSON.parse(localStorage.getItem("cinelog_database") || "{}");
      return sortItems(dane.movies, "default", "movie").map((m) => m.title);
    });
    expect(kolejnosc[0]).toBe("Mroczny Rycerz");
  });
});
