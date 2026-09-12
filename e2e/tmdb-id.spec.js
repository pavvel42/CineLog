import { test, expect } from "@playwright/test";

// Regresja: podgląd pozycji bez prawdziwego identyfikatora TMDb wysyłał do
// backendu `tmdb_id=tmdb_undefined` - literał sklejony z undefined
// (search.js: id: item.id || `tmdb_${tData.id}`). Skutki: zapytanie
// `movie/tmdb_undefined/watch/providers` do TMDb i wyłączony cache VOD.
//
// Uwaga na globy Playwrighta: `*` NIE przechodzi przez znak "/", a adres
// szczegółów zawiera `append_to_response=credits,watch/providers` - dlatego
// trasy szczegółów muszą używać `**` (inaczej mock nigdy się nie uruchamia
// i test przechodzi na pustej odpowiedzi z catch-alla).

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const MOVIE_DETAIL = (id, title) => ({
  id,
  title,
  original_title: title,
  overview: "Przykładowy opis fabuły filmu.",
  runtime: 104,
  release_date: "2025-09-12",
  genres: [{ id: 53, name: "Thriller" }],
  credits: { cast: [], crew: [] },
  watch: { providers: { results: {} } },
  release_dates: { results: [] },
  production_countries: [],
  poster_path: "/abc.jpg",
  imdb_id: null,
});

test.describe("Identyfikator TMDb w żądaniach VOD", () => {
  test.use({ serviceWorkers: "block" });

  test("podgląd nie wysyła tmdb_id=tmdb_undefined i przekazuje prawdziwe id", async ({ page }) => {
    const vodUrls = [];
    page.on("request", (r) => {
      if (r.url().includes("watch/providers")) vodUrls.push(r.url());
    });

    await page.addInitScript(() => {
      localStorage.setItem("cinelog_tmdb_key", "test-key");
      localStorage.setItem("cinelog_omdb_key", "omdb-test-key");
    });

    // Playwright dopasowuje trasy LIFO - catch-all rejestrujemy PIERWSZY.
    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
    await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
      r.fulfill(json({ status_code: 1, status_message: "Success." })));
    await page.route("**/api/search_preview**", (r) => r.abort());
    await page.route("**/api/search_detail**", (r) => r.abort());
    await page.route("https://api.themoviedb.org/3/search/movie?**", (route) => {
      if (route.request().url().includes(encodeURIComponent("The Voyeurs"))) {
        return route.fulfill(json({
          results: [
            { id: 632857, title: "The Voyeurs", original_title: "The Voyeurs", release_date: "2021-09-10", overview: "Thriller.", poster_path: "/tv1.jpg", vote_average: 6.0 },
            { id: 632858, title: "The Voyeurs 2", original_title: "The Voyeurs 2", release_date: "2022-01-01", overview: "Sequel.", poster_path: "/tv2.jpg", vote_average: 5.0 },
          ],
        }));
      }
      return route.fulfill(json({ results: [] }));
    });
    await page.route("https://api.themoviedb.org/3/movie/632857?**", (r) =>
      r.fulfill(json(MOVIE_DETAIL(632857, "The Voyeurs"))));
    await page.route("https://www.omdbapi.com/**", (r) =>
      r.fulfill(json({ Response: "False", Error: "Movie not found!" })));

    await page.goto("/");
    await page.locator("#m3-fab-add").click();
    await page.fill("#m3-search-preview-input", "The Voyeurs");
    await page.click("#m3-btn-search-trigger");
    const rows = page.locator("#m3-search-results-list .m3-result-item");
    await expect(rows).toHaveCount(2, { timeout: 8000 });

    // Czekamy na konkretne żądanie (stałe opóźnienia w tym przepływie są zawodne).
    const backendRequest = page.waitForRequest(
      (r) => r.url().includes("/api/watch_providers"),
      { timeout: 15_000 },
    );
    await rows.first().click();
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#m3-preview-title")).toContainText("The Voyeurs");
    const request = await backendRequest;
    await page.waitForTimeout(500);

    const withGarbage = vodUrls.filter((u) => u.includes("tmdb_undefined"));
    expect(withGarbage, `Żądania z tmdb_undefined:\n${withGarbage.join("\n")}`).toEqual([]);
    expect(request.url()).toContain("tmdb_id=632857");
  });

  test("gdy szczegóły TMDb nie przyjdą, nie wysyłamy literału tmdb_undefined", async ({ page }) => {
    // Ścieżka awaryjna: brak odpowiedzi szczegółów (offline, 404, limit API).
    // Wtedy identyfikator jest nieznany i nie wolno sklejać tekstu z undefined.
    const vodUrls = [];
    page.on("request", (r) => {
      if (r.url().includes("watch/providers")) vodUrls.push(r.url());
    });

    await page.addInitScript(() => {
      localStorage.setItem("cinelog_tmdb_key", "test-key");
      localStorage.setItem("cinelog_omdb_key", "omdb-test-key");
    });

    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
    await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
      r.fulfill(json({ status_code: 1, status_message: "Success." })));
    await page.route("**/api/search_preview**", (r) => r.abort());
    await page.route("**/api/search_detail**", (r) => r.abort());
    await page.route("https://api.themoviedb.org/3/search/movie?**", (route) => {
      if (route.request().url().includes(encodeURIComponent("The Voyeurs"))) {
        return route.fulfill(json({
          results: [
            { id: 632857, title: "The Voyeurs", original_title: "The Voyeurs", release_date: "2021-09-10", overview: "Thriller.", poster_path: "/tv1.jpg", vote_average: 6.0 },
          ],
        }));
      }
      return route.fulfill(json({ results: [] }));
    });
    // Szczegóły wracają 200 z pustym obiektem (tData.id === undefined) - tak jak
    // w diagnozie: żądanie szczegółów nie pasuje do mocka albo API oddaje pustkę.
    await page.route("https://api.themoviedb.org/3/movie/632857?**", (r) => r.fulfill(json({})));
    await page.route("https://www.omdbapi.com/**", (r) =>
      r.fulfill(json({ Response: "False", Error: "Movie not found!" })));

    await page.goto("/");
    await page.locator("#m3-fab-add").click();
    await page.fill("#m3-search-preview-input", "The Voyeurs");
    await page.click("#m3-btn-search-trigger");
    // Pojedynczy wynik: aplikacja otwiera podgląd od razu (bez listy wyników).
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });
    await page.waitForTimeout(2500);

    const withGarbage = vodUrls.filter((u) => u.includes("tmdb_undefined"));
    expect(withGarbage, `Żądania z tmdb_undefined:\n${withGarbage.join("\n")}`).toEqual([]);
    expect(vodUrls.length, "Test jest pusty: żadne żądanie VOD nie poleciało").toBeGreaterThan(0);
  });
});
