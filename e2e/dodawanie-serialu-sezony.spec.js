import { test, expect } from "@playwright/test";

// Zgłoszenie: wyszukanie „Biuro" (polski tytuł The Office US) daje amerykański serial
// (9 sezonów), ale w oknie dodawania był tylko JEDEN sezon i 6 odcinków.
// Przyczyna: /api/search_detail zwracał season_ep_counts, ale nie total_seasons,
// a frontend budował zakładki z `detail.total_seasons || 1` — stąd jedna zakładka
// z 6 odcinkami (tyle ma sezon 1 amerykańskiego „Biura").
// Ten test idzie ścieżką klienta (brak backendu), gdzie liczba sezonów musi być
// wyliczona z listy sezonów, gdy TMDb nie podaje number_of_seasons.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const WYNIK_SZUKANIA = {
  id: 2316,
  name: "Biuro",
  original_name: "The Office",
  first_air_date: "2005-03-24",
  overview: "Pracownicy biura sprzedającego papier.",
};

// Celowo BEZ number_of_seasons — liczba sezonów musi wyjść z tej listy.
const SZCZEGOLY_BEZ_LICZBY_SEZONOW = {
  id: 2316,
  name: "Biuro",
  original_name: "The Office",
  first_air_date: "2005-03-24",
  overview: "Pracownicy biura sprzedającego papier.",
  genres: [{ id: 35, name: "Komedia" }],
  seasons: [
    { season_number: 0, episode_count: 106 },
    { season_number: 1, episode_count: 6 },
    { season_number: 2, episode_count: 22 },
    { season_number: 3, episode_count: 23 },
    { season_number: 4, episode_count: 14 },
    { season_number: 5, episode_count: 26 },
    { season_number: 6, episode_count: 24 },
    { season_number: 7, episode_count: 24 },
    { season_number: 8, episode_count: 24 },
    { season_number: 9, episode_count: 23 },
  ],
  credits: { cast: [], crew: [] },
};

async function przygotuj(page) {
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
  // Predykaty po ścieżce — globy gubią parametry zapytania (?language=…).
  await page.route(
    (url) => url.hostname === "api.themoviedb.org" && url.pathname.includes("/search/tv"),
    (r) => r.fulfill(json({ results: [WYNIK_SZUKANIA] }))
  );
  await page.route(
    (url) => url.hostname === "api.themoviedb.org" && /\/tv\/2316$/.test(url.pathname),
    (r) => r.fulfill(json(SZCZEGOLY_BEZ_LICZBY_SEZONOW))
  );
  await page.addInitScript(() => {
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
    localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
    localStorage.setItem("vod-country", "PL");
    localStorage.setItem("cinelog_database", JSON.stringify({ movies: [], shows: [], updated_at: "2026-01-01T00:00:00Z" }));
  });
}

test.describe("Dodawanie serialu z polskim tytułem („Biuro” = The Office US)", () => {
  test.use({ serviceWorkers: "block" });

  test("okno dodawania pokazuje wszystkie 9 sezonów, nie jeden", async ({ page }) => {
    await przygotuj(page);
    await page.goto("/?mode=shows");
    await page.locator("#m3-fab-add").click();
    await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/, { timeout: 10_000 });
    await page.fill("#m3-search-preview-input", "Biuro");
    await page.click("#m3-btn-search-trigger");

    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("#m3-preview-title")).toContainText("Biuro");

    const zakladki = page.locator("#m3-add-season-tabs .m3-season-tab");
    await expect(zakladki).toHaveCount(9);
    // Zakładka sezonu 1 pokazuje liczbę odcinków z listy sezonów, nie domyślne 10.
    await expect(zakladki.first()).toContainText("(0/6)");
    await expect(zakladki.nth(8)).toContainText("Sezon 9");
  });

  test("zapisany serial ma 9 sezonów (a nie 1)", async ({ page }) => {
    await przygotuj(page);
    await page.goto("/?mode=shows");
    await page.locator("#m3-fab-add").click();
    await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/, { timeout: 10_000 });
    await page.fill("#m3-search-preview-input", "Biuro");
    await page.click("#m3-btn-search-trigger");
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });
    await page.locator("#m3-confirm-add-form button[type=submit]").click();
    await expect(page.locator("#m3-toast-notification")).toContainText("Biuro", { timeout: 10_000 });

    const wpis = await page.evaluate(() => {
      const dane = JSON.parse(localStorage.getItem("cinelog_database") || "{}");
      return (dane.shows || []).find((s) => s.title === "Biuro") || null;
    });
    expect(wpis).not.toBeNull();
    expect(wpis.total_seasons).toBe(9);
    expect(Object.keys(wpis.season_ep_counts || {}).length).toBe(9);
  });

  test("tracker pokazuje wszystkie odcinki sezonu, nie tylko obejrzane", async ({ page }) => {
    await przygotuj(page);
    await page.goto("/?mode=shows");
    await page.locator("#m3-fab-add").click();
    await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/, { timeout: 10_000 });
    await page.fill("#m3-search-preview-input", "Biuro");
    await page.click("#m3-btn-search-trigger");
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });

    // 3 odcinki sezonu 1, potem jeden odcinek sezonu 9
    const chips = page.locator("#m3-add-episodes-grid .m3-ep-chip");
    for (const i of [0, 1, 2]) await chips.nth(i).click();
    await page.locator("#m3-add-season-tabs .m3-season-tab").nth(8).click();
    await page.locator("#m3-add-episodes-grid .m3-ep-chip").first().click();
    await page.locator("#m3-confirm-add-form button[type=submit]").click();
    await expect(page.locator("#m3-toast-notification")).toContainText("Biuro", { timeout: 10_000 });

    await page.locator("#m3-shows-grid article.m3-card").first().click();
    const sheet = page.locator("#m3-sheet-episodes");
    await expect(sheet).toHaveClass(/active/, { timeout: 10_000 });

    const zakladki = sheet.locator(".m3-season-tab");
    await expect(zakladki).toHaveCount(9);
    await expect(zakladki.first()).toContainText("(3/6)");
    await expect(zakladki.nth(8)).toContainText("(1/23)");

    await zakladki.nth(8).click();
    await expect(sheet.locator(".m3-ep-item")).toHaveCount(23);
  });
});