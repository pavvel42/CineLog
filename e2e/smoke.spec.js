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
