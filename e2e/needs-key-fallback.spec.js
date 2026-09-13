import { test, expect } from "@playwright/test";

// Regresja (audyt F4/U3): odpowiedź 200 z `needs_key` to prośba o klucz, nie dane.
// Backend bez klucza odpowiada `needs_key`, ale użytkownik ma własny klucz BYOK —
// front musi wtedy zejść na ścieżkę kliencką (TMDb z przeglądarki), a nie pokazać
// „brak szczegółów”. Wcześniej `needs_key` był traktowany jak poprawna odpowiedź,
// więc podgląd zostawał pusty, mimo że klient miał czym dociągnąć dane.
// Ten sam mechanizm dotyczy „Innej wersji” w edytorze filmu.

const TMDB_KEY = "test-key";

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const OPIS_Z_KLIENTA = "Opis pobrany bezpośrednio z TMDb przez przeglądarkę.";
const OPIS_Z_LISTY_TMDB = "Fabularny opis z listy wyników TMDb.";
const TITLE_Z_TMDB = "Odrzucony Klucz";

const JEDEN_WYNIK = {
  results: [{
    id: 4242,
    title: TITLE_Z_TMDB,
    name: TITLE_Z_TMDB,
    original_title: "Rejected Key",
    original_name: "Rejected Key",
    release_date: "2026-02-02",
    first_air_date: "2026-02-02",
    overview: OPIS_Z_LISTY_TMDB,
    poster_path: "/rk.jpg",
    vote_average: 7.1,
  }],
};

/**
 * Trasy udające dostawców przy backendie bez klucza: backend mówi `needs_key`,
 * a TMDb/OMDb odpowiadają jak w trybie demo.
 */
async function podstawTrasyTmdB(page) {
  // Catch-all TMDb PIERWSZY — Playwright dopasowuje trasy LIFO.
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));

  // Backend odpowiada, ale nie ma klucza: to nie są dane.
  await page.route("**/api/search_preview**", (r) =>
    r.fulfill(json({
      found: false,
      needs_key: true,
      message: "Wyszukiwanie online wymaga darmowego klucza TMDb.",
    })));
  await page.route("**/api/search_detail**", (r) =>
    r.fulfill(json({
      found: false,
      needs_key: true,
      key_rejected: true,
      message: "Klucz TMDb został odrzucony przez API (HTTP 401).",
    })));

  await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
    r.fulfill(json({ status_code: 1, status_message: "Success." })));
  // Klient szuka w TMDb sam — typ zależy od aktywnej zakładki (film/serial),
  // więc podstawiamy wynik pod wszystkie trzy warianty wyszukiwania.
  for (const sciezka of ["search/movie?**", "search/tv?**", "search/multi?**"]) {
    await page.route(`https://api.themoviedb.org/3/${sciezka}`, (r) => r.fulfill(json(JEDEN_WYNIK)));
  }
  await page.route("https://api.themoviedb.org/3/movie/4242?*", (r) =>
    r.fulfill(json({
      id: 4242,
      title: TITLE_Z_TMDB,
      original_title: "Rejected Key",
      overview: OPIS_Z_KLIENTA,
      runtime: 111,
      release_date: "2026-02-02",
      genres: [{ id: 53, name: "Thriller" }],
      credits: { cast: [], crew: [] },
      watch: { providers: { results: {} } },
      release_dates: { results: [] },
      production_countries: [],
      poster_path: "/rk.jpg",
      imdb_id: null,
    })));
  await page.route("https://www.omdbapi.com/**", (r) =>
    r.fulfill(json({ Response: "False", Error: "Movie not found!" })));
}

test.describe("needs_key z backendu nie blokuje ścieżki klienckiej", () => {
  test.use({ serviceWorkers: "block" });

  test("podgląd uzupełnia się z TMDb, gdy backend zgłasza needs_key", async ({ page }) => {
    const zadaniaDoTmdb = [];
    page.on("request", (r) => {
      if (r.url().includes("api.themoviedb.org")) zadaniaDoTmdb.push(r.url());
    });

    await page.addInitScript((klucz) => {
      localStorage.setItem("cinelog_tmdb_key", klucz);
      localStorage.setItem("cinelog_omdb_key", "omdb-test-key");
    }, TMDB_KEY);
    await podstawTrasyTmdB(page);

    await page.goto("/");
    await page.locator("#m3-fab-add").click();
    await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/);
    await page.fill("#m3-search-preview-input", TITLE_Z_TMDB);
    await page.click("#m3-btn-search-trigger");

    const wyniki = page.locator("#m3-search-results-list .m3-result-item");
    // Pojedynczy wynik: aplikacja otwiera podgląd od razu, więc listy wyników nie ma.
    await expect
      .poll(async () => (await wyniki.count()) + (await page.locator("#m3-add-step-preview").isVisible() ? 1 : 0), {
        timeout: 15_000,
      })
      .toBeGreaterThan(0);

    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#m3-preview-title")).toContainText(TITLE_Z_TMDB);
    // Tekst pochodzi z odpowiedzi TMDb pobranej przez przeglądarkę — dowód, że po
    // `needs_key` front zszedł na ścieżkę kliencką (a nie pokazał pustego podglądu).
    await expect(page.locator("#m3-preview-plot")).toContainText(OPIS_Z_LISTY_TMDB);

    expect(
      zadaniaDoTmdb.some((u) => u.includes("/3/movie/4242")),
      "front nie sięgnął po szczegóły do TMDb po odpowiedzi needs_key"
    ).toBe(true);
  });

  test("edytor filmu: »Inna wersja« szuka kluczem z przeglądarki", async ({ page }) => {
    const szukaniaWTmdb = [];
    page.on("request", (r) => {
      if (r.url().includes("api.themoviedb.org/3/search/")) szukaniaWTmdb.push(r.url());
    });

    await page.addInitScript((klucz) => {
      localStorage.setItem("cinelog_tmdb_key", klucz);
      localStorage.setItem("cinelog_database", JSON.stringify({
        movies: [{
          uuid: "film-1",
          title: "Testowy Film",
          tmdb_id: 111,
          year: "2020",
          type: "movie",
          poster_url: "",
          plot: "Opis z biblioteki użytkownika.",
        }],
        shows: [],
      }));
    }, TMDB_KEY);
    await podstawTrasyTmdB(page);

    await page.goto("/");
    await page.evaluate(() => {
      const baza = JSON.parse(localStorage.getItem("cinelog_database"));
      window.openMovieDetail(baza.movies[0]);
    });
    await page.click("#m3-detail-rematch-btn");

    await expect(page.locator("#m3-sheet-rematch")).toHaveClass(/active/, { timeout: 15_000 });
    const karty = page.locator("#m3-rematch-results-list .m3-rematch-card");
    await expect(karty).toHaveCount(1, { timeout: 15_000 });
    await expect(karty.first().locator(".m3-rematch-card-title")).toContainText(TITLE_Z_TMDB);

    expect(
      szukaniaWTmdb.length,
      "»Inna wersja« nie sięgnęła do TMDb kluczem z przeglądarki przy backendzie bez klucza"
    ).toBeGreaterThan(0);
  });
});
