import { test, expect } from "@playwright/test";

// Zgłoszenie użytkownika: „The Office", sezon 5 — odcinki 27 i 28 nie mają opisu.
// Przyczyna nie leży w TMDb (ten sezon ma 26 odcinków, wszystkie z opisem), tylko
// w numeracji biblioteki: TVTime liczył odcinki podwójne jako dwa (porządek TVDB),
// więc wpisów jest 28. Aplikacja renderowała tyle wierszy, ile wynosił najwyższy
// NUMER WPISU, a nie liczba odcinków — dwa ostatnie wiersze nie miały ani tytułu,
// ani opisu, więc wyglądały jak brak danych w TMDb.
// Poprawka: liczbę wierszy wyznaczają metadane, a wpisy spoza listy są opisane
// pod listą (nie znikają — to historia użytkownika).

const sezon = (ile) => ({
  episodes: Array.from({ length: ile }, (_, i) => ({
    episode_number: i + 1,
    name: `Tytuł odcinka ${i + 1}`,
    overview: `Opis odcinka ${i + 1}`,
    air_date: "2008-09-25",
    runtime: 22,
  })),
});

const wpisy = (ile) =>
  Array.from({ length: ile }, (_, i) => ({
    episode_id: `e${i + 1}`,
    season: 5,
    episode: i + 1,
    created_at: "2020-01-01 00:00:00",
    runtime: 22,
  }));

const przygotuj = async (page) => {
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  // Kolejność ma znaczenie: Playwright wygrywa OSTATNIO zarejestrowaną trasą,
  // więc ogólny mock musi iść pierwszy, a sezonowy (konkretny) po nim.
  await page.route("https://api.themoviedb.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) })
  );
  await page.route("https://api.themoviedb.org/3/tv/2316/season/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sezon(26)) })
  );
  await page.addInitScript((epizody) => {
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
    localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
    localStorage.setItem(
      "cinelog_database",
      JSON.stringify({
        movies: [],
        shows: [
          {
            uuid: "show-test",
            title: "The Office (US)",
            tmdb_id: 2316,
            episodes_watched: epizody,
            watched_count: epizody.length,
            latest_season: 5,
            latest_episode: 28,
            latest_progress: "S05E28",
            status: "watched",
            total_episodes: 186,
            total_seasons: 9,
          },
        ],
        updated_at: new Date().toISOString(),
      })
    );
  }, wpisy(28));
  await page.goto("/?mode=shows");
  await expect(page.locator("#m3-shows-grid article.m3-card").first()).toBeVisible({ timeout: 15_000 });
};

// Ta sama droga co użytkownik: klik w kartę serialu otwiera tracker odcinków.
const otworzTracker = async (page) => {
  await page.locator("#m3-shows-grid article.m3-card").first().click();
  await expect(page.locator("#m3-sheet-episodes")).toHaveClass(/active/, { timeout: 10_000 });
  await page.waitForTimeout(1200);
};

test.describe("Odcinki poza listą TMDb (stara numeracja TVTime)", () => {
  test.use({ serviceWorkers: "block" });

  test("renderuje tyle wierszy, ile odcinków zna TMDb, i nie zostawia wierszy bez opisu", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(page.locator("#ep-5-26")).toHaveCount(1);
    await expect(page.locator("#ep-5-27")).toHaveCount(0);
    await expect(page.locator("#ep-5-28")).toHaveCount(0);
    expect(await page.locator("#m3-episodes-list .m3-ep-item").count()).toBe(26);
    await expect(page.locator("#ep-5-26 .m3-ep-desc")).toBeVisible();
  });

  test("nadmiarowe wpisy są opisane pod listą, nie udają brakujących opisów", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    const nota = page.locator("#m3-episodes-list .m3-ep-extra-note");
    await expect(nota).toHaveCount(1);
    await expect(nota).toContainText("27, 28");
  });

  test("licznik sezonu nie przekracza liczby odcinków", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(page.locator("#tab-season-5 .m3-season-tab-badge")).toHaveText("(26/26)");
  });
});
