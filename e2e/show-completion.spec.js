import { test, expect } from "@playwright/test";

// Regresja (Etap 4): trasa /api/shows/verify_completion istniała, ale nie wywoływał
// jej nikt, a backend nie dostawał total_episodes/series_status od frontu — więc
// "obejrzany serial" nigdy się nie oznaczał sam. Ten test przechodzi całą drogę:
// serial w bazie -> wejście w zakładkę "Seriale" -> backend oznacza go jako obejrzany.

test.describe("Automatyczne oznaczanie obejrzanych seriali", () => {
  test("wejście w zakładkę Seriale oznacza serial obejrzany do końca", async ({ page, request }) => {
    const marker = `E2E Serial ${Date.now()}`;
    const created = await request.post("/api/shows", {
      data: {
        title: marker,
        status: "watching",
        tmdb_id: 990001,
        total_seasons: 1,
        total_episodes: 2,
        series_status: "Ended",
        in_production: false,
        episodes_watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }]
      }
    });
    expect(created.status(), "seeding serialu przez API").toBe(201);
    const uuid = (await created.json()).uuid;

    try {
      await page.goto("/?mode=shows&tab=all");
      await page.waitForFunction(() => typeof window.switchTab === "function", null, { timeout: 10_000 });
      // Przełączenie zakładki przez API aplikacji (klik w pigułkę bywa zasłonięty
      // przez nakładkę mobilnej nawigacji) — to ten sam kod, który woła użytkownik.
      await page.evaluate(() => window.switchTab("all"));

      await expect
        .poll(
          async () => {
            const res = await request.get("/api/shows");
            const shows = await res.json();
            const found = (Array.isArray(shows) ? shows : []).find(s => s.uuid === uuid);
            return found ? `${found.status}/${found.caught_up === true}` : "brak-w-bazie";
          },
          { timeout: 10_000, message: "backend nie oznaczył serialu jako obejrzanego po wejściu w zakładkę" }
        )
        .toBe("watched/false");
    } finally {
      await request.delete(`/api/shows/${uuid}`);
    }
  });
});
