import { test, expect } from "@playwright/test";

// Regresja zgłoszona przez użytkownika: po oznaczeniu filmu jako obejrzany sortowanie
// po "ostatnio obejrzane" go ignorowało. Druga część pilnuje, żeby KAŻDA opcja z listy
// sortowania faktycznie porządkowała — część wartości nie była obsługiwana wcale.
//
// Uwaga na tło: biblioteka użytkownika pochodzi z TVTime, więc filmy mają własne,
// historyczne daty obejrzenia. Oznaczenie takiego filmu jako obejrzanego musi
// zaktualizować datę, inaczej pozycja nigdy nie trafi na początek listy.

// Kolejność wpisów jest celowo "pomieszana": każda opcja sortowania musi dać inny
// porządek niż kolejność wejściowa, inaczej test przechodziłby także wtedy, gdy
// opcja nie robi nic (to właśnie ukrywało brak obsługi `year_*` i `episodes_*`).
const BIBLIOTEKA = {
  updated_at: "2026-09-19T10:00:00.000Z",
  movies: [
    { uuid: "m-z-2022", title: "Film z 2022", status: "watchlist", watch_date: "2022-03-02 12:00:00", release_date: "2010-05-05", rating: 3 },
    { uuid: "m-nowy", title: "Film nowy", status: "watchlist", watch_date: "", follow_date: "2026-08-01 12:00:00", release_date: "2020-01-01", rating: 5 },
    { uuid: "m-stary", title: "Film stary", status: "watched", watch_date: "2019-01-01 12:00:00", release_date: "1980-01-01", rating: null },
  ],
  shows: [
    { uuid: "s-c", title: "Serial C", status: "watching", updated_at: "2026-01-01 10:00:00", episodes_watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }] },
    { uuid: "s-a", title: "Serial A", status: "watching", updated_at: "2026-04-01 10:00:00", episodes_watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] },
    { uuid: "s-b", title: "Serial B", status: "watched", updated_at: "2026-02-01 10:00:00", episodes_watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }, { season: 1, episode: 3 }, { season: 1, episode: 4 }, { season: 1, episode: 5 }] },
  ],
};

const przygotuj = async (page) => {
  await page.addInitScript((zawartosc) => {
    localStorage.setItem("cinelog_database", JSON.stringify(zawartosc));
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
  }, BIBLIOTEKA);
  // Bez sieci do Drive i bez API: test sprawdza sortowanie zaseedowanej biblioteki,
  // a nie danych, które aplikacja mogłaby pobrać z działającego serwera Flask.
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/");
  await page.waitForTimeout(2500);
};

const tytulyWKolejnosci = (page, siatka) =>
  page.$$eval(`${siatka} .m3-card .m3-card-title`, (els) => els.map((e) => e.textContent.trim()));

const ustawSortowanie = async (page, wartosc) => {
  await page.evaluate((v) => {
    const sel = document.getElementById("m3-sort-select");
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, wartosc);
  await page.waitForTimeout(500);
};

test.describe("Sortowanie biblioteki", () => {
  test.use({ serviceWorkers: "block" });

  test("oznaczenie filmu jako obejrzany ustawia dzisiejszą datę i wypycha go na początek", async ({ page }) => {
    await przygotuj(page);
    expect(await tytulyWKolejnosci(page, "#m3-movies-grid")).toEqual(["Film nowy", "Film z 2022", "Film stary"]);

    await page.locator("#m3-movies-grid .m3-card", { hasText: "Film z 2022" }).click();
    await expect(page.locator("#m3-detail-btn-watched")).toBeVisible();
    await page.click("#m3-detail-btn-watched");
    await page.waitForTimeout(700);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);

    const stan = await page.evaluate(() => {
      const bd = JSON.parse(localStorage.getItem("cinelog_database") || "{}");
      const film = (bd.movies || []).find((m) => m.uuid === "m-z-2022");
      return { status: film.status, watch_date: film.watch_date, dzis: new Date().toLocaleDateString("sv-SE") };
    });

    expect(stan.status).toBe("watched");
    expect(
      stan.watch_date.slice(0, 10),
      "data obejrzenia musi zostać odświeżona — inaczej film zostaje w środku listy",
    ).toBe(stan.dzis);
    expect(await tytulyWKolejnosci(page, "#m3-movies-grid")).toEqual(["Film z 2022", "Film nowy", "Film stary"]);
  });

  const OPCJE_FILMOW = [
    { opcja: "default", tytuly: ["Film nowy", "Film z 2022", "Film stary"] },
    { opcja: "watched_asc", tytuly: ["Film stary", "Film z 2022", "Film nowy"] },
    { opcja: "title_asc", tytuly: ["Film nowy", "Film stary", "Film z 2022"] },
    { opcja: "title_desc", tytuly: ["Film z 2022", "Film stary", "Film nowy"] },
    { opcja: "rating_desc", tytuly: ["Film nowy", "Film z 2022", "Film stary"] },
    { opcja: "rating_asc", tytuly: ["Film z 2022", "Film nowy", "Film stary"] },
    { opcja: "year_desc", tytuly: ["Film nowy", "Film z 2022", "Film stary"] },
    { opcja: "year_asc", tytuly: ["Film stary", "Film z 2022", "Film nowy"] },
  ];

  for (const { opcja, tytuly } of OPCJE_FILMOW) {
    test(`opcja sortowania "${opcja}" porządkuje filmy`, async ({ page }) => {
      await przygotuj(page);
      await ustawSortowanie(page, opcja);
      expect(await tytulyWKolejnosci(page, "#m3-movies-grid")).toEqual(tytuly);
    });
  }

  const OPCJE_SERIALI = [
    { opcja: "episodes_desc", tytuly: ["Serial B", "Serial C", "Serial A"] },
    { opcja: "episodes_asc", tytuly: ["Serial A", "Serial C", "Serial B"] },
  ];

  for (const { opcja, tytuly } of OPCJE_SERIALI) {
    test(`opcja sortowania "${opcja}" porządkuje seriale`, async ({ page }) => {
      await przygotuj(page);
      // Najpierw przełączamy bibliotekę na seriale, potem zakładkę (nawigacja bywa
      // schowana w układzie mobilnym, więc klikamy przez DOM).
      await page.evaluate(() => document.getElementById("m3-mode-shows").click());
      await page.waitForTimeout(800);
      await page.evaluate(() => document.querySelector('button[data-tab="all_shows"]')?.click());
      await page.waitForTimeout(800);
      await ustawSortowanie(page, opcja);
      expect(await tytulyWKolejnosci(page, "#m3-shows-grid")).toEqual(tytuly);
    });
  }
});
