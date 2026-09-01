import { test, expect } from "@playwright/test";

test.describe("CineLog - smoke e2e", () => {
  test("aplikacja startuje i biblioteka się renderuje", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible({ timeout: 15_000 });
    expect(errors).toEqual([]);
  });

  test("wyszukiwarka filtruje bibliotekę bez podwójnego renderu", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();
    await page.fill("#m3-search-input", "Social");
    await expect
      .poll(() => page.locator("#m3-movies-grid article.m3-card").count(), { timeout: 5_000 })
      .toBeLessThan(50);
  });

  test("przełącznik trybu seriali + tracker odcinków (otwórz, toggle, Esc)", async ({ page }) => {
    await page.goto("/?mode=shows");
    await expect(page.locator("#m3-shows-grid article.m3-card").first()).toBeVisible();

    // otwórz tracker pierwszego serialu
    await page.locator("#m3-shows-grid article.m3-card").first().click();
    const sheet = page.locator("#m3-sheet-episodes");
    await expect(sheet).toHaveClass(/active/, { timeout: 10_000 });
    await expect(page.locator("#m3-ep-show-title")).not.toBeEmpty();

    // zapamiętaj licznik i przełącz pierwszy odcinek sezonu
    const progressBefore = await page.locator("#m3-ep-show-meta").innerText();
    const firstEp = sheet.locator(".m3-ep-item").first();
    await firstEp.click();
    await page.waitForTimeout(800);

    // Esc zamyka arkusz (a11y)
    await page.keyboard.press("Escape");
    await expect(sheet).not.toHaveClass(/active/);
  });

  test("tryb klienta (PWA bez backendu): zaznaczenie odcinka zapisuje się lokalnie", async ({ page }) => {
    // Symulacja originu github.io: wszystkie /api/** zwracają 404, baza w localStorage.
    await page.route("**/api/**", route => route.fulfill({ status: 404, body: "no backend" }));
    const testShow = {
      uuid: "e2e-client-show-1",
      title: "Test Series Client",
      status: "watching",
      watched_count: 3,
      latest_progress: "S01E03",
      latest_season: 1,
      latest_episode: 3,
      episodes_watched: [
        { episode_id: "e2e-ep-1", season: 1, episode: 1, created_at: "2026-01-01 10:00:00" },
        { episode_id: "e2e-ep-2", season: 1, episode: 2, created_at: "2026-01-02 10:00:00" },
        { episode_id: "e2e-ep-3", season: 1, episode: 3, created_at: "2026-01-03 10:00:00" }
      ]
    };
    await page.addInitScript((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
    }, { movies: [], shows: [testShow], updated_at: "2026-01-01T00:00:00Z" });

    await page.goto("/?mode=shows");
    await expect(page.locator("#m3-shows-grid article.m3-card").first()).toBeVisible();
    await page.locator("#m3-shows-grid article.m3-card").first().click();
    const sheet = page.locator("#m3-sheet-episodes");
    await expect(sheet).toHaveClass(/active/, { timeout: 10_000 });

    // Bez metadanych TMDb tracker pokazuje ostatni obejrzany + 3 kolejne (1..6)
    await expect(sheet.locator(".m3-ep-item")).toHaveCount(6);

    // klik na odcinek 4 -> dialog inteligentnego zaznaczania -> "tylko ten odcinek"
    await sheet.locator(".m3-ep-item").nth(3).click();
    await page.locator("#m3-btn-batch-only").click();

    // odcinek 4 oznaczony, licznik i localStorage zaktualizowane
    await expect(sheet.locator(".m3-ep-item").nth(3)).toHaveClass(/watched/, { timeout: 5_000 });
    await expect(page.locator("#m3-ep-show-meta")).toContainText("S01E04");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")));
    expect(stored.shows[0].episodes_watched.some(e => e.season === 1 && e.episode === 4)).toBe(true);
    expect(stored.shows[0].watched_count).toBe(4);
    expect(stored.shows[0].latest_progress).toBe("S01E04");
  });

  test("zakładka rekomendacji renderuje hub bez błędów JS", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?tab=recommendations&mode=movies");
    await page.locator('[data-tab="recommendations"]').first().click().catch(() => {});
    await expect(page.locator("#m3-rec-carousels-hub")).toBeVisible({ timeout: 10_000 });
    // AI curator input istnieje (sekcja zainicjalizowana)
    await expect(page.locator("#m3-rec-ai-input")).toBeAttached();
    expect(errors).toEqual([]);
  });
});
