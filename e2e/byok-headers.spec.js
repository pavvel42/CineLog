import { test, expect } from "@playwright/test";

// Regresja (audyt B3): klucz BYOK z localStorage docierał do backendu tylko
// w 3 z 25 wywołań /api/* — profil aktora i odświeżanie metadanych pytały
// backend bez klucza i dostawały pustą odpowiedź, którą front uznawał za sukces.
// Ten test przechodzi przez kilka przepływów i wymaga, żeby KAŻDE żądanie do
// własnego /api/* niosło nagłówek X-TMDB-Key.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.describe("Klucz BYOK w żądaniach do własnego backendu", () => {
  test.use({ serviceWorkers: "block" });

  test("każde żądanie /api/* niesie X-TMDB-Key", async ({ page }) => {
    const apiRequests = [];
    const missingHeader = [];

    page.on("request", (r) => {
      const url = new URL(r.url());
      if (url.origin !== "http://localhost:5599") return;
      if (!url.pathname.startsWith("/api/")) return;
      apiRequests.push(url.pathname + url.search);
      const headers = r.headers();
      if (headers["x-tmdb-key"] !== "test-key") {
        missingHeader.push(`${url.pathname}${url.search} (nagłówki: ${Object.keys(headers).join(",")})`);
      }
    });

    await page.addInitScript(() => {
      localStorage.setItem("cinelog_tmdb_key", "test-key");
      localStorage.setItem("cinelog_omdb_key", "omdb-test-key");
    });

    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
    await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
      r.fulfill(json({ status_code: 1, status_message: "Success." })));
    await page.route("https://api.themoviedb.org/3/search/multi?**", (r) =>
      r.fulfill(json({
        results: [
          { id: 550, media_type: "movie", title: "Fight Club", release_date: "1999-10-15", overview: "Klub.", poster_path: "/fc.jpg", vote_average: 8.4 },
        ],
      })));
    await page.route("https://api.themoviedb.org/3/search/movie?**", (r) =>
      r.fulfill(json({
        results: [
          { id: 550, title: "Fight Club", release_date: "1999-10-15", overview: "Klub.", poster_path: "/fc.jpg", vote_average: 8.4 },
        ],
      })));
    await page.route("https://api.themoviedb.org/3/search/tv?**", (r) => r.fulfill(json({ results: [] })));
    await page.route("https://api.themoviedb.org/3/movie/550?**", (r) =>
      r.fulfill(json({
        id: 550, title: "Fight Club", original_title: "Fight Club", overview: "Klub.", runtime: 139,
        release_date: "1999-10-15", genres: [{ id: 18, name: "Dramat" }], credits: { cast: [], crew: [] },
        watch: { providers: { results: {} } }, release_dates: { results: [] }, production_countries: [],
        poster_path: "/fc.jpg", imdb_id: "tt0137523",
      })));
    await page.route("https://www.omdbapi.com/**", (r) => r.fulfill(json({ Response: "False", Error: "Movie not found!" })));

    await page.goto("/");
    await page.waitForTimeout(1500);

    // Przepływy: zakładki aplikacji (każda dociąga dane z backendu).
    for (const tab of ["#m3-nav-shows", "#m3-nav-upcoming", "#m3-nav-recommendations", "#m3-nav-library"]) {
      const el = page.locator(tab);
      if (await el.count()) {
        await el.click({ force: true }).catch(() => {});
        await page.waitForTimeout(800);
      }
    }

    // Przepływ: wyszukiwanie i otwarcie podglądu (jeśli UI na to pozwoli —
    // nie jest to warunkiem testu, chodzi o ruch do /api/*).
    await page.locator("#m3-fab-add").click({ force: true }).catch(() => {});
    await page.fill("#m3-search-preview-input", "Fight Club").catch(() => {});
    await page.click("#m3-btn-search-trigger").catch(() => {});
    await page.waitForTimeout(2000);

    expect(apiRequests.length, "Test jest pusty: żadne żądanie /api/* nie poleciało").toBeGreaterThan(1);
    expect(missingHeader, `Żądania bez klucza BYOK:\n${missingHeader.join("\n")}`).toEqual([]);
  });
});
