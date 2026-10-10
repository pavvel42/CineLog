import { test, expect } from "@playwright/test";

// Zgłoszenie użytkownika: „Lioness” (3 sezony po 8 odcinków, wszystkie obejrzane)
// w trybie klienta pokazywał w zakładkach „Sezon 1 (8/11)” i „Sezon 2 (8/11)”, a po
// kliknięciu zakładka wracała do 8/8. Serial z importu nie miał listy odcinków
// w sezonach (season_ep_counts), metadane TMDb wczytywano tylko dla bieżącego sezonu,
// a dla pozostałych tryb klienta zgadywał „obejrzane + 3”. Liczby sezonów są w
// odpowiedzi /tv/{id}, którą tracker i tak pobiera — z niej bierzemy mianowniki.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

const obejrzane = [1, 2, 3].flatMap((sezon) =>
  Array.from({ length: 8 }, (_, i) => ({
    episode_id: `s${sezon}e${i + 1}`,
    season: sezon,
    episode: i + 1,
    created_at: "2026-01-01 00:00:00",
    runtime: 50,
  }))
);

const odcinkiSezonu = (sezon) => ({
  episodes: Array.from({ length: 8 }, (_, i) => ({
    episode_number: i + 1,
    name: `S${sezon} odcinek ${i + 1}`,
    overview: "",
    air_date: "2023-07-23",
    runtime: 50,
    still_path: null,
  })),
});

test.describe("Zakładki sezonów — liczba odcinków w trybie klienta", () => {
  test.use({ serviceWorkers: "block" });

  test("Lioness: każdy sezon pokazuje 8/8 od razu, bez klikania w zakładkę", async ({ page }) => {
    await page.route("https://www.googleapis.com/**", (r) => r.abort());
    await page.route("**/api/**", (r) => r.abort());
    await page.route("https://api.tvmaze.com/**", (r) => r.fulfill({ status: 404, body: "" }));
    await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({ results: [] })));
    await page.route(
      (url) => url.hostname === "api.themoviedb.org" && url.pathname === "/3/tv/113962",
      (r) =>
        r.fulfill(
          json({
            id: 113962,
            name: "Lioness",
            overview: "Agentki CIA.",
            first_air_date: "2023-07-23",
            number_of_seasons: 3,
            number_of_episodes: 24,
            status: "Returning Series",
            seasons: [
              { season_number: 0, episode_count: 2 },
              { season_number: 1, episode_count: 8 },
              { season_number: 2, episode_count: 8 },
              { season_number: 3, episode_count: 8 },
            ],
            genres: [],
            credits: { cast: [], crew: [] },
          })
        )
    );
    await page.route(
      (url) => url.hostname === "api.themoviedb.org" && url.pathname.startsWith("/3/tv/113962/season/"),
      (r) => r.fulfill(json(odcinkiSezonu(Number(r.request().url().match(/season\/(\d+)/)[1]))))
    );
    await page.addInitScript((epizody) => {
      localStorage.setItem("cinelog_active_mode", "client");
      localStorage.setItem("cinelog_user_imported", "true");
      localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
      localStorage.setItem("vod-country", "PL");
      localStorage.setItem(
        "cinelog_database",
        JSON.stringify({
          movies: [],
          shows: [
            {
              uuid: "show-lioness",
              title: "Lioness",
              tmdb_id: 113962,
              episodes_watched: epizody,
              watched_count: epizody.length,
              latest_season: 3,
              latest_episode: 8,
              latest_progress: "S03E08",
              status: "watching",
              total_episodes: 24,
              total_seasons: 3,
            },
          ],
          updated_at: new Date().toISOString(),
        })
      );
    }, obejrzane);

    await page.goto("/?mode=shows");
    await page.locator("#m3-shows-grid article.m3-card").first().click();
    await expect(page.locator("#m3-sheet-episodes")).toHaveClass(/active/, { timeout: 10_000 });
    await expect(page.locator("#ep-3-8")).toBeVisible({ timeout: 10_000 });

    for (const sezon of [1, 2, 3]) {
      await expect(page.locator(`#tab-season-${sezon} .m3-season-tab-badge`)).toHaveText("(8/8)");
    }
  });
});
