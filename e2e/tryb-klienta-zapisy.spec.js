import { test, expect } from "@playwright/test";

// Biblioteka w trybie klienta (albo demo) to inna baza niż biblioteka serwera Flask, nawet gdy
// serwer działa obok (aplikacja otwarta z localhost). Zapisy, usunięcia i „weryfikacja ukończenia”
// szły mimo to na serwer: odpowiedź serwera (jego lista) zastępowała bibliotekę użytkownika,
// odcinek kliknięty w trackerze nie zapisywał się nigdzie, a baza serwera dostawała cudze wpisy.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const BIBLIOTEKA_KLIENTA = {
  movies: [
    { uuid: "k-film-1", title: "FILM KLIENTA A", status: "watched", rating: 3, is_favorite: false },
    { uuid: "k-film-2", title: "FILM KLIENTA B", status: "watched", rating: 4, is_favorite: false },
  ],
  shows: [{
    uuid: "k-serial-1", title: "SERIAL KLIENTA", status: "watching", rating: null, is_favorite: false,
    episodes_watched: [], total_seasons: 1, total_episodes: 6, season_ep_counts: { 1: 6 },
  }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

const FILM_SERWERA = { uuid: "srv-film-1", title: "FILM Z SERWERA", status: "watched", rating: 5 };
const SERIAL_SERWERA = { uuid: "srv-serial-1", title: "SERIAL Z SERWERA", status: "watched", episodes_watched: [] };

/** Działający backend z własną biblioteką; zapisuje każde żądanie zmieniające bibliotekę. */
async function backendZWlasnaBiblioteka(page, zapisy) {
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
  await page.route("**/api/**", (r) => r.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
  await page.route(/\/api\/(movies|shows|import)(\/.*)?$/, (route) => {
    const zadanie = route.request();
    const sciezka = new URL(zadanie.url()).pathname;
    if (zadanie.method() !== "GET") {
      zapisy.push(`${zadanie.method()} ${sciezka}`);
      if (sciezka.endsWith("/verify_completion")) return route.fulfill(json({ updated: 1, shows: [SERIAL_SERWERA] }));
      return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    }
    if (sciezka === "/api/movies") return route.fulfill(json([FILM_SERWERA]));
    if (sciezka === "/api/shows") return route.fulfill(json([SERIAL_SERWERA]));
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
}

const zasiejKlienta = (page) =>
  page.addInitScript((db) => {
    if (localStorage.getItem("__zasiane")) return;
    localStorage.setItem("__zasiane", "1");
    localStorage.setItem("cinelog_database", JSON.stringify(db));
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
  }, BIBLIOTEKA_KLIENTA);

const bazaKlienta = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")));

test.describe("Tryb klienta przy działającym serwerze", () => {
  test.use({ serviceWorkers: "block" });

  test("wejście w seriale i kliknięcie odcinka zostają w bibliotece klienta", async ({ page }) => {
    const zapisy = [];
    await backendZWlasnaBiblioteka(page, zapisy);
    await zasiejKlienta(page);

    await page.goto("/?mode=shows");
    const karty = page.locator("#m3-shows-grid article.m3-card");
    await expect(karty).toHaveCount(1);
    await expect(karty.first()).toContainText("SERIAL KLIENTA");
    await page.waitForTimeout(1200); // czas na odpowiedź „weryfikacji ukończenia”
    await expect(karty.first()).toContainText("SERIAL KLIENTA");

    await karty.first().click();
    await expect(page.locator("#m3-sheet-episodes")).toHaveClass(/active/, { timeout: 10_000 });
    await page.locator("#ep-1-1").click(); // pierwszy odcinek: bez pytania o oznaczenie poprzednich
    await expect.poll(async () => (await bazaKlienta(page)).shows[0].episodes_watched.map((o) => `${o.season}x${o.episode}`))
      .toEqual(["1x1"]);

    expect((await bazaKlienta(page)).shows.map((s) => s.title)).toEqual(["SERIAL KLIENTA"]);
    expect(zapisy).toEqual([]);
  });

  test("usunięcie filmu nie podmienia biblioteki listą z serwera", async ({ page }) => {
    const zapisy = [];
    await backendZWlasnaBiblioteka(page, zapisy);
    await zasiejKlienta(page);

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);
    await page.locator("#m3-movies-grid article.m3-card", { hasText: "FILM KLIENTA A" }).first().click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/, { timeout: 10_000 });
    await page.locator("#m3-detail-delete-btn").click();
    await page.locator("#m3-dialog-btn-confirm").click();

    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1);
    await page.waitForTimeout(800); // czas na ewentualne „odświeżam listę z serwera”
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toContainText("FILM KLIENTA B");
    expect((await bazaKlienta(page)).movies.map((m) => m.title)).toEqual(["FILM KLIENTA B"]);
    await expect(page.getByText("Nie udało się usunąć filmu na serwerze")).toHaveCount(0);
    expect(zapisy).toEqual([]);
  });

  test("ocena i ulubione filmu nie trafiają na serwer", async ({ page }) => {
    const zapisy = [];
    await backendZWlasnaBiblioteka(page, zapisy);
    await zasiejKlienta(page);

    await page.goto("/?mode=movies");
    await page.locator("#m3-movies-grid article.m3-card", { hasText: "FILM KLIENTA A" }).first().click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/, { timeout: 10_000 });
    await page.locator("#m3-detail-fav-btn").click();
    await expect.poll(async () => (await bazaKlienta(page)).movies.find((m) => m.uuid === "k-film-1").is_favorite).toBe(true);
    await page.waitForTimeout(500);
    expect(zapisy).toEqual([]);
    await expect(page.getByText("na serwerze")).toHaveCount(0);
  });

  test("radar premier pokazuje premiery biblioteki klienta, a nie biblioteki serwera", async ({ page }) => {
    const zapisy = [];
    await backendZWlasnaBiblioteka(page, zapisy);
    await page.route("**/api/upcoming**", (r) => r.fulfill(json({
      items: [{
        id: "srv-premiera", title: "PREMIERA Z SERWERA", media_type: "movie", poster_url: "",
        release_date: "2030-01-01", days_left: 100, badge_type: "movie_premiere", status_label: "Premiera kinowa / VOD",
      }],
    })));
    await zasiejKlienta(page);
    await page.addInitScript(() => {
      const db = JSON.parse(localStorage.getItem("cinelog_database") || "null");
      if (!db || db.movies.some((m) => m.uuid === "k-premiera")) return;
      const zaStoDni = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
      db.movies.push({ uuid: "k-premiera", title: "PREMIERA KLIENTA", status: "watchlist", release_date: zaStoDni });
      localStorage.setItem("cinelog_database", JSON.stringify(db));
    });

    await page.goto("/?mode=movies");
    await page.waitForFunction(() => typeof window.switchTab === "function");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();
    await page.evaluate(() => window.switchTab("upcoming"));

    const tytuly = page.locator("#m3-upcoming-content .m3-upcoming-title");
    await expect(tytuly).toHaveText(["PREMIERA KLIENTA"]);
  });
});
