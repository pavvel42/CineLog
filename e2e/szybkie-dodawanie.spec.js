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

  // Serwer rozpoznał pozycję jako już obecną (np. dodaną w innej karcie) i zwraca istniejący
  // wpis z `already_exists`. Klient nie może ogłosić „Dodano”, zdublować wpisu ani zapisać
  // pola `already_exists` w bibliotece.
  test("pozycja, którą serwer już ma, nie jest dublowana ani ogłaszana jako dodana", async ({ page }) => {
    const istniejacy = {
      uuid: "s-biuro", title: "Biuro", status: "watching", rating: 4, tmdb_id: 2316,
      episodes_watched: [{ season: 1, episode: 1 }], total_seasons: 9, total_episodes: 201,
    };
    let wyslano = 0;

    await page.route("https://www.googleapis.com/**", (r) => r.abort());
    await page.route("**/api/recommendations/**", (r) => r.fulfill(json({ results: [BIURO_W_REKOMENDACJACH] })));
    await page.route("**/api/search_detail**", (r) => r.fulfill(json(BIURO_SZCZEGOLY)));
    await page.route("**/api/watch_providers**", (r) => r.fulfill(json({ results: {} })));
    await page.route("**/api/shows", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      wyslano += 1;
      return route.fulfill(json({ ...istniejacy, already_exists: true }));
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
    await expect.poll(() => wyslano).toBe(1);

    await expect(page.locator("#m3-toast-notification")).toContainText("jest już w bibliotece");
    const wpisy = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cinelog_database_server")).shows.filter((w) => w.title === "Biuro"));
    expect(wpisy).toHaveLength(1);
    expect(wpisy[0]).toMatchObject({ uuid: "s-biuro", status: "watching", rating: 4 });
    expect(wpisy[0]).not.toHaveProperty("already_exists");
  });
});
