import { test, expect } from "@playwright/test";

// Regresja (audyt B1/B4): cztery przyciski w pustych stanach miały akcje w atrybutach
// `onclick`, których Content-Security-Policy aplikacji ("script-src 'self'") nie
// wykonuje — przycisk wyglądał poprawnie i nic nie robił. Dodatkowo odwołanie do
// nieistniejącego elementu statusu Dysku Google przerywało aktualizację statusu.
//
// Te testy pilnują obu rzeczy: w DOM nie ma atrybutów zdarzeń, a przycisk
// "Wprowadź klucz TMDb" faktycznie otwiera modal na zakładce kluczy.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.describe("Martwe kontrolki UI", () => {
  test.use({ serviceWorkers: "block" });

  test("w DOM nie ma atrybutów onclick/onchange/onsubmit (blokuje je CSP)", async ({ page }) => {
    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
    await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
      r.fulfill(json({ status_code: 1, status_message: "Success." })));
    await page.route("https://www.omdbapi.com/**", (r) => r.fulfill(json({ Response: "False" })));

    await page.goto("/");
    await page.waitForTimeout(1200);

    for (const url of ["/?tab=recommendations", "/?tab=upcoming", "/?tab=shows", "/?tab=movies"]) {
      await page.goto(url);
      await page.waitForTimeout(1200);
    }

    const inlineHandlers = await page.evaluate(() => {
      const elements = document.querySelectorAll(
        "[onclick],[onchange],[oninput],[onsubmit],[onerror],[onload],[onkeydown]",
      );
      return Array.from(elements).map((el) => el.outerHTML.slice(0, 120));
    });
    expect(inlineHandlers, `Elementy z atrybutem zdarzenia:\n${inlineHandlers.join("\n")}`).toEqual([]);
  });

  test("przycisk 'Wprowadź klucz TMDb' otwiera modal chmury na zakładce kluczy", async ({ page }) => {
    // Bez klucza TMDb aplikacja pokazuje kartę zachęty z przyciskiem.
    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
    await page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
      r.fulfill(json({ status_code: 1, status_message: "Success." })));
    await page.route("https://www.omdbapi.com/**", (r) => r.fulfill(json({ Response: "False" })));

    await page.goto("/?tab=recommendations");
    await expect(page.locator("#m3-rec-carousels-hub")).toBeVisible({ timeout: 10_000 });

    const keyButton = page.locator("[data-action='open-cloud-sync-keys']").first();
    await expect(keyButton).toBeVisible({ timeout: 10_000 });
    await keyButton.click();

    await expect(page.locator("#m3-tab-cloud-keys")).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator("#m3-panel-cloud-keys")).toBeVisible({ timeout: 5000 });
  });
});
