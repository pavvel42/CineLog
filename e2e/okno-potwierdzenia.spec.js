import { test, expect } from "@playwright/test";

// Okno potwierdzenia dostaje treść z prostym formatowaniem (<b>, <br>). Po uszczelnieniu XSS
// cała treść była escapowana, więc użytkownik widział surowe znaczniki („<b>"Tytuł"</b>”,
// a w oknie przełączenia na serwer — cały blok <div style=…>). Dozwolone są wyłącznie <b> i <br>;
// wszystko inne (w tym tytuł z biblioteki) pozostaje tekstem.

const TYTUL = 'Film <img src=x onerror="window.__xss=1"> X';

test.describe("Okno potwierdzenia", () => {
  test.use({ serviceWorkers: "block" });

  test("pogrubia tytuł, nie pokazuje znaczników i nie wykonuje HTML z tytułu", async ({ page }) => {
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
    await page.addInitScript((tytul) => {
      localStorage.setItem("cinelog_database", JSON.stringify({
        movies: [{ uuid: "f1", title: tytul, status: "watched", rating: 3 }], shows: [],
      }));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
    }, TYTUL);

    await page.goto("/?mode=movies");
    await page.locator("#m3-movies-grid article.m3-card").first().click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/, { timeout: 10_000 });
    await page.locator("#m3-detail-delete-btn").click();

    const tresc = page.locator("#m3-confirm-dialog-modal .m3-dialog-message");
    await expect(tresc).toBeVisible();
    await expect(tresc).not.toContainText("<b>");
    await expect(tresc.locator("b")).toHaveText(`"${TYTUL}"`);
    await expect(tresc.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });
});
