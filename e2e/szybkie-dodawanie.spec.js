import { test, expect } from "@playwright/test";

// M1 (audyt): szybkie dodawanie „+ Do obejrzenia” z rekomendacji i z profilu aktora
// miało dwie osobne kopie logiki i zapisywało serial bez liczby sezonów i odcinków
// w sezonach — tracker pokazywał wtedy jeden sezon. Oba przyciski idą teraz przez
// jedną funkcję, która dociąga szczegóły jak okno dodawania.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const BIURO_W_REKOMENDACJACH = {
  title: "Biuro",
  type: "series",
  media_type: "tv",
  tmdb_id: 2316,
  year: "2005",
  poster_url: "",
  vote_average: 8.6,
};

const BIURO_SZCZEGOLY = {
  title: "Biuro",
  original_title: "The Office",
  type: "series",
  tmdb_id: 2316,
  year: "2005",
  genre: "Komedia",
  plot: "Codzienność biura w Scranton.",
  total_seasons: 9,
  total_episodes: 201,
  series_status: "Ended",
  in_production: false,
  season_ep_counts: { 1: 6, 2: 22, 9: 23 },
};

test.describe("Szybkie dodawanie z rekomendacji", () => {
  test.use({ serviceWorkers: "block" });

  test("serial dodany z karty rekomendacji ma liczbę sezonów i odcinków w sezonach", async ({ page }) => {
    let zapisanySerial = null;

    await page.route("https://www.googleapis.com/**", (r) => r.abort());
    await page.route("**/api/recommendations/**", (r) => r.fulfill(json({ results: [BIURO_W_REKOMENDACJACH] })));
    await page.route("**/api/search_detail**", (r) => r.fulfill(json(BIURO_SZCZEGOLY)));
    await page.route("**/api/watch_providers**", (r) => r.fulfill(json({ results: {} })));
    // Zapis przechwytujemy — test nie może dopisać serialu do wspólnej bazy serwera e2e.
    await page.route("**/api/shows", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      zapisanySerial = route.request().postDataJSON();
      return route.fulfill(json({ uuid: "s-biuro", episodes_watched: [], ...zapisanySerial }));
    });
    await page.addInitScript(() => {
      localStorage.clear();
      localStorage.setItem("cinelog_active_mode", "flask");
      localStorage.setItem("vod-country", "PL");
    });

    await page.goto("/?mode=movies");
    await page.waitForTimeout(2000);
    await page.locator('[data-tab="recommendations"]:visible').first().click();

    const przycisk = page.locator(".m3-rec-card .m3-rec-quick-add").first();
    await expect(przycisk).toBeVisible({ timeout: 15_000 });
    await przycisk.click();
    await expect.poll(() => zapisanySerial, { timeout: 10_000 }).not.toBeNull();

    expect(zapisanySerial).toMatchObject({
      title: "Biuro",
      status: "watchlist",
      tmdb_id: 2316,
      total_seasons: 9,
      total_episodes: 201,
      series_status: "Ended",
      season_ep_counts: { 1: 6, 2: 22, 9: 23 },
    });
    await expect(przycisk).toHaveClass(/added/);
  });
});
