import { test, expect } from "@playwright/test";

// Regresja (audyt F1): serce w arkuszu szczegółów filmu i serialu.
//  - Arkusz trzyma ten sam obiekt co biblioteka, więc przełącznik zmieniał pole dwa razy
//    i serce wracało do stanu sprzed kliknięcia (a serwer dostawał zmianę).
//  - W trybie klienta (bez backendu) ulubione serialu były cofane z komunikatem o błędzie,
//    choć zapis w przeglądarce to tam normalna droga.

const BIBLIOTEKA = {
  movies: [{ uuid: "fav-film-1", title: "Film Ulubiony", status: "watched", rating: 4, is_favorite: false }],
  shows: [{
    uuid: "fav-serial-1", title: "Serial Ulubiony", status: "watching", rating: null, is_favorite: false,
    episodes_watched: [], total_seasons: 1, total_episodes: 6, season_ep_counts: { 1: 6 },
  }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

const zasiej = (page) =>
  page.addInitScript((db) => {
    if (localStorage.getItem("__zasiane")) return; // odświeżenie strony nie cofa zmian testu
    localStorage.setItem("__zasiane", "1");
    localStorage.setItem("cinelog_database", JSON.stringify(db));
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
  }, BIBLIOTEKA);

const ulubionyWBazie = (page, lista, uuid) =>
  page.evaluate(([l, id]) => {
    const db = JSON.parse(localStorage.getItem("cinelog_database") || "null");
    return Boolean((db?.[l] || []).find((wpis) => wpis.uuid === id)?.is_favorite);
  }, [lista, uuid]);

test.describe("Ulubione w arkuszu szczegółów (tryb klienta)", () => {
  test.use({ serviceWorkers: "block" });

  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "no backend" }));
    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
    await zasiej(page);
  });

  test("serce w arkuszu filmu zapala się, zostaje po odświeżeniu i gaśnie po drugim kliknięciu", async ({ page }) => {
    await page.goto("/?mode=movies");
    await page.locator("#m3-movies-grid article.m3-card", { hasText: "Film Ulubiony" }).first().click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/, { timeout: 10_000 });

    const serce = page.locator("#m3-detail-fav-btn");
    await expect(serce).not.toHaveClass(/is-fav/);
    await serce.click();
    await expect(serce).toHaveClass(/is-fav/);
    await expect.poll(() => ulubionyWBazie(page, "movies", "fav-film-1")).toBe(true);

    await page.reload();
    await expect(page.locator("#m3-movies-grid article.m3-card .m3-card-fav-btn.is-fav")).toHaveCount(1);

    await page.locator("#m3-movies-grid article.m3-card", { hasText: "Film Ulubiony" }).first().click();
    await expect(serce).toHaveClass(/is-fav/);
    await serce.click();
    await expect(serce).not.toHaveClass(/is-fav/);
    await expect.poll(() => ulubionyWBazie(page, "movies", "fav-film-1")).toBe(false);
  });

  test("serce w arkuszu serialu działa bez backendu i nie zgłasza błędu zapisu", async ({ page }) => {
    await page.goto("/?mode=shows");
    await page.locator("#m3-shows-grid article.m3-card", { hasText: "Serial Ulubiony" }).first().click();

    const serce = page.locator("#m3-btn-fav-show");
    await expect(serce).toBeVisible({ timeout: 10_000 });
    await expect(serce).not.toHaveClass(/is-fav/);
    await serce.click();
    await expect(serce).toHaveClass(/is-fav/);
    await expect.poll(() => ulubionyWBazie(page, "shows", "fav-serial-1")).toBe(true);
    // Odpowiedź 404 z „/api” już przyszła — zmiana nie może zostać cofnięta ani oznaczona jako błąd.
    await page.waitForTimeout(500);
    await expect(serce).toHaveClass(/is-fav/);
    expect(await ulubionyWBazie(page, "shows", "fav-serial-1")).toBe(true);
    await expect(page.getByText("Nie udało się zapisać zmiany")).toHaveCount(0);

    await page.reload();
    await expect(page.locator("#m3-shows-grid article.m3-card .m3-card-fav-btn.is-fav")).toHaveCount(1);
  });
});

test.describe("Ulubione w arkuszu szczegółów (tryb serwera)", () => {
  test.use({ serviceWorkers: "block" });

  test("odrzucony zapis na serwerze cofa serce w arkuszu serialu i mówi o tym", async ({ page }) => {
    const serial = { ...BIBLIOTEKA.shows[0] };
    await page.route("**/api/movies", (r) => r.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.route("**/api/shows", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([serial]) }));
    await page.route("**/api/shows/verify_completion", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ updated: 0 }) }));
    await page.route("**/api/shows/fav-serial-1", (r) =>
      r.request().method() === "PUT"
        ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "x" }) })
        : r.fallback());
    await page.addInitScript(() => localStorage.setItem("cinelog_active_mode", "flask"));

    await page.goto("/?mode=shows");
    await page.locator("#m3-shows-grid article.m3-card", { hasText: "Serial Ulubiony" }).first().click();
    const serce = page.locator("#m3-btn-fav-show");
    await expect(serce).toBeVisible({ timeout: 10_000 });
    await serce.click();
    await expect(page.getByText("Nie udało się zapisać zmiany na serwerze.")).toBeVisible();
    await expect(serce).not.toHaveClass(/is-fav/);
  });
});
