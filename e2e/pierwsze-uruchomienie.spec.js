import { test, expect } from "@playwright/test";

// Regresja (audyt F2): przy pierwszym uruchomieniu tryb wybiera się sam — działający backend
// to tryb serwera Flask. Wcześniej tryb był ustalany, zanim sonda backendu zdążyła odpowiedzieć,
// więc nowy użytkownik z działającym serwerem lądował w demo i demo zostawało przypięte na stałe.

const FILM_SERWERA = { uuid: "srv-film-1", title: "FILM Z SERWERA", status: "watched", rating: 5, is_favorite: false };

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

test.describe("Pierwsze uruchomienie (pusty localStorage)", () => {
  test.use({ serviceWorkers: "block" });

  test("działający backend → biblioteka serwera, a nie demo", async ({ page }) => {
    await page.route("**/api/movies", async (r) => {
      // Serwer odpowiada z opóźnieniem — jak prawdziwy przy zimnym starcie.
      await new Promise((gotowe) => setTimeout(gotowe, 300));
      await r.fulfill(json([FILM_SERWERA]));
    });
    await page.route("**/api/shows", (r) => r.fulfill(json([])));
    await page.route("**/api/shows/verify_completion", (r) => r.fulfill(json({ updated: 0 })));

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1);
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toContainText("FILM Z SERWERA");

    const stan = await page.evaluate(() => ({
      tryb: localStorage.getItem("cinelog_active_mode"),
      bazaSerwera: JSON.parse(localStorage.getItem("cinelog_database_server") || "null")?.movies?.length ?? null,
      bazaDemo: localStorage.getItem("cinelog_database_demo"),
    }));
    expect(stan.tryb).toBe("flask");
    expect(stan.bazaSerwera).toBe(1);
    expect(stan.bazaDemo).toBeNull();

    // Kolejne uruchomienie przy niedostępnym serwerze nie przerzuca użytkownika do demo.
    await page.unroute("**/api/movies");
    await page.route("**/api/**", (r) => r.fulfill({ status: 503, body: "" }));
    await page.reload();
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1);
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toContainText("FILM Z SERWERA");
    expect(await page.evaluate(() => localStorage.getItem("cinelog_active_mode"))).toBe("flask");
  });

  test("brak backendu i brak własnej biblioteki → demo", async ({ page }) => {
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(50);
    expect(await page.evaluate(() => localStorage.getItem("cinelog_active_mode"))).toBe("demo");
  });

  test("brak backendu, ale jest wcześniej zaimportowana biblioteka → tryb klienta", async ({ page }) => {
    await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
    await page.addInitScript((film) => {
      localStorage.setItem("cinelog_database", JSON.stringify({ movies: [{ ...film, title: "MOJ FILM" }], shows: [] }));
      localStorage.setItem("cinelog_user_imported", "true");
    }, FILM_SERWERA);
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1);
    await expect(page.locator("#m3-movies-grid article.m3-card").first()).toContainText("MOJ FILM");
    expect(await page.evaluate(() => localStorage.getItem("cinelog_active_mode"))).not.toBe("demo");
  });
});
