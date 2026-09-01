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

  // Testy trybu klienta symulują origin github.io: /api/** -> 404, baza w localStorage.
  // serviceWorkers: "block" — SW omija page.route dla żądań zewnętrznych (mocki TMDb nie trafiały).
  test.describe("tryb klienta", () => {
    test.use({ serviceWorkers: "block" });

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

  test("tryb klienta: zmiana statusu filmu i ocena zapisują się lokalnie", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 404, body: "no backend" }));
    const testMovie = {
      uuid: "e2e-client-movie-1",
      title: "Test Movie Client",
      status: "watchlist",
      rating: null,
      is_favorite: false
    };
    await page.addInitScript((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
    }, { movies: [testMovie], shows: [], updated_at: "2026-01-01T00:00:00Z" });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();

    // otwórz szczegóły i oznacz jako obejrzane
    await page.locator("#m3-movies-grid article.m3-card").first().click();
    const sheet = page.locator("#m3-sheet-movie-detail");
    await expect(sheet).toHaveClass(/active/, { timeout: 10_000 });
    await page.locator("#m3-detail-btn-watched").click();
    await page.waitForTimeout(400);

    let stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")));
    expect(stored.movies[0].status).toBe("watched");
    expect(stored.movies[0].watch_date).toBeTruthy();

    // ocena przez gwiazdki (karta siatki)
    await page.keyboard.press("Escape");
    await expect(sheet).not.toHaveClass(/active/);
    await page.locator("#m3-movies-grid article.m3-card").first().locator(".m3-star").nth(3).click();
    await page.waitForTimeout(400);

    stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")));
    expect(stored.movies[0].rating).toBe(4);
  });

  test("tryb klienta: przekroczenie kwoty localStorage pokazuje toast i nie wywala aplikacji", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 404, body: "no backend" }));
    // UWAGA na kolejność addInitScript: seed bazy MUSI być pierwszy — wrapper
    // setItem rzuca wyjątkiem dla cinelog_database i zablokowałby własny seed.
    const testShow = {
      uuid: "e2e-client-show-quota",
      title: "Test Series Quota",
      status: "watching",
      watched_count: 3,
      latest_progress: "S01E03",
      latest_season: 1,
      latest_episode: 3,
      episodes_watched: [
        { episode_id: "q1", season: 1, episode: 1, created_at: "2026-01-01 10:00:00" },
        { episode_id: "q2", season: 1, episode: 2, created_at: "2026-01-02 10:00:00" },
        { episode_id: "q3", season: 1, episode: 3, created_at: "2026-01-03 10:00:00" }
      ]
    };
    await page.addInitScript((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
    }, { movies: [], shows: [testShow], updated_at: "2026-01-01T00:00:00Z" });
    await page.addInitScript(() => {
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "cinelog_database") {
          const err = new Error("mock: Exceeded storage quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        return originalSetItem.call(this, key, value);
      };
    });

    await page.goto("/?mode=shows");
    await expect(page.locator("#m3-shows-grid article.m3-card").first()).toBeVisible();
    await page.locator("#m3-shows-grid article.m3-card").first().click();
    const sheet = page.locator("#m3-sheet-episodes");
    await expect(sheet).toHaveClass(/active/, { timeout: 10_000 });

    // zaznaczenie odcinka: zapis lokalny rzuca QuotaExceeded -> toast, brak crashu
    await sheet.locator(".m3-ep-item").nth(3).click();
    await page.locator("#m3-btn-batch-only").click();

    const toast = page.locator("#m3-toast-notification");
    await expect(toast).toContainText("Brak miejsca", { timeout: 5_000 });
    await expect(toast).toHaveClass(/show/);

    // stan w pamięci nadal zaktualizowany (UI działa mimo nieudanego zapisu)
    await expect(sheet.locator(".m3-ep-item").nth(3)).toHaveClass(/watched/);
    await expect(page.locator("#m3-ep-show-meta")).toContainText("S01E04");
  });

  test("modal Tryb i Środowisko pokazuje raport rozmiaru bazy", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 404, body: "no backend" }));
    await page.addInitScript((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
    }, { movies: [], shows: [], updated_at: "2026-01-01T00:00:00Z" });

    await page.goto("/");
    await expect(page.locator("#m3-btn-env-toggle")).toBeVisible();
    await page.locator("#m3-btn-env-toggle").click();
    const sizeEl = page.locator("#m3-env-db-size");
    await expect(sizeEl).toBeVisible();
    await expect(sizeEl).toContainText("localStorage");
    await expect(sizeEl).toContainText("~5 MB");
    await expect(sizeEl).toContainText("%");
  });

  test("tryb klienta: rematch filmu działa przez bezpośrednie TMDb (mock)", async ({ page }) => {
    await page.route("**/api/**", route => route.fulfill({ status: 404, body: "no backend" }));
    // mock bezpośredniego API TMDb (BYOK), jak w przeglądarce pod originem github.io
    // UWAGA: Playwright dopasowuje trasy od ostatniej zarejestrowanej, więc
    // specyficzna trasa search/movie musi być zarejestrowana JAKO OSTATNIA.
    await page.route("**/api.themoviedb.org/**", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({})
    }));
    await page.route("**/api.themoviedb.org/3/search/movie*", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        results: [{
          id: 999,
          title: "Test Movie Client (Alternatywna wersja)",
          original_title: "Test Movie Client",
          poster_path: "/alt.jpg",
          release_date: "1999-01-01",
          overview: "Alternatywne dopasowanie.",
          vote_average: 7.5
        }]
      })
    }));

    const testMovie = {
      uuid: "e2e-client-movie-1",
      title: "Test Movie Client",
      status: "watchlist",
      rating: null,
      is_favorite: false
    };
    await page.addInitScript((db) => {
      localStorage.setItem("cinelog_database", JSON.stringify(db));
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
      localStorage.setItem("cinelog_tmdb_key", "e2e-fake-key");
    }, { movies: [testMovie], shows: [], updated_at: "2026-01-01T00:00:00Z" });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();
    await page.locator("#m3-movies-grid article.m3-card").first().click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/, { timeout: 10_000 });

    await page.locator("#m3-detail-rematch-btn").click();
    const rematchSheet = page.locator("#m3-sheet-rematch");
    await expect(rematchSheet).toHaveClass(/active/);
    await expect(rematchSheet.locator(".m3-rematch-card").first()).toBeVisible({ timeout: 10_000 });

    // wybierz alternatywną wersję -> zapis lokalny mimo braku backendu
    await rematchSheet.locator(".m3-rematch-card").first().click();
    await expect(rematchSheet).not.toHaveClass(/active/, { timeout: 5_000 });

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")));
    expect(String(stored.movies[0].tmdb_id)).toBe("999");
    expect(stored.movies[0].title).toContain("Alternatywna wersja");
  });
  });

  test("scalenie Drive: postęp serialu przeliczany z unii odcinków, dopasowanie po tmdb_id", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();

    const merged = await page.evaluate(() => {
      const cloudShow = {
        uuid: "cloud-show-1",
        title: "Lioness (z chmury)",
        tmdb_id: 136315,
        watched_count: 5,
        latest_progress: "S03E05",
        latest_season: 3,
        latest_episode: 5,
        episodes_watched: [
          { episode_id: "c1", season: 1, episode: 1 },
          { episode_id: "c2", season: 1, episode: 2 },
          { episode_id: "c3", season: 3, episode: 1 },
          { episode_id: "c4", season: 3, episode: 2 },
          { episode_id: "c5", season: 3, episode: 5 }
        ]
      };
      const localShow = {
        uuid: "cloud-show-1",
        title: "Lioness (zmieniona wersja po rematchu)",
        tmdb_id: 136315,
        watched_count: 2,
        latest_progress: "S03E02",
        latest_season: 3,
        latest_episode: 2,
        episodes_watched: [
          { episode_id: "c1", season: 1, episode: 1 },
          { episode_id: "c2", season: 1, episode: 2 },
          { episode_id: "c3", season: 3, episode: 1 },
          { episode_id: "c4", season: 3, episode: 2 }
        ]
      };
      return window.googleDriveSync.mergeLibraries([], [localShow], [], [cloudShow]);
    });

    expect(merged.shows).toHaveLength(1);
    const show = merged.shows[0];
    // unia odcinków + postęp przeliczony z unii, a nie z ostatnio zapisującego
    expect(show.episodes_watched).toHaveLength(5);
    expect(show.watched_count).toBe(5);
    expect(show.latest_progress).toBe("S03E05");
    expect(show.latest_episode).toBe(5);
  });

  test("scalenie Drive: film po tmdb_id mimo różnych tytułów, bez fałszywego scalenia dwóch wersji", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toBeVisible();

    const result = await page.evaluate(() => {
      const cloudMovie = { uuid: "m-1", title: "Maniac (z chmury)", tmdb_id: 555, rating: 4, status: "watched" };
      const localMovie = { uuid: "m-1", title: "Maniac (Alternatywna wersja po rematchu)", tmdb_id: 555, rating: null, status: "watchlist" };
      const cloudA = { uuid: "a", title: "Maniac (2018)", tmdb_id: 111 };
      const cloudB = { uuid: "b", title: "Maniac (2018)", tmdb_id: 222 };
      const localA = { uuid: "local-a", title: "Maniac (2018) inne wydanie", tmdb_id: 222 };

      return {
        merged: window.googleDriveSync.mergeLibraries([localMovie], [], [cloudMovie], []),
        versions: window.googleDriveSync.mergeLibraries([localA], [], [cloudA, cloudB], [])
      };
    });

    // film scalony po tmdb_id (jeden wpis), ocena z chmury zachowana przy lokalnej null
    expect(result.merged.movies).toHaveLength(1);
    expect(result.merged.movies[0].rating).toBe(4);
    expect(result.merged.movies[0].status).toBe("watchlist");

    // dwa różne tmdb_id pozostają dwiema pozycjami mimo podobnych tytułów;
    // lokalna wersja scala się z tą o tym samym tmdb_id
    expect(result.versions.movies).toHaveLength(2);
    const b = result.versions.movies.find(m => String(m.tmdb_id) === "222");
    expect(b.uuid).toBe("local-a");
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
