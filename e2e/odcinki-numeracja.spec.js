import { test, expect } from "@playwright/test";

// Zgłoszenie użytkownika: „The Office" (Biuro) sezon 5 ma 28 odcinków — tak pokazują
// go Filmweb, TVDB i TVmaze, bo odcinki podwójne liczą jako dwa. TMDb scala
// „Weight Loss" i „Stress Relief" w jeden wpis i ma 26 odcinków, przez co numery
// rozjeżdżały się (od 3. odcinka o 1, od 18. o 2), opis jednego odcinka wisiał przy
// zaznaczeniu drugiego, a dwa ostatnie wiersze nie miały żadnych danych.
// Poprawka: gdy biblioteka ma więcej odcinków niż TMDb, sezon jest wyświetlany w
// numeracji biblioteki (lista z TVmaze), a polska nazwa i opis pochodzą z odcinka
// TMDb dopasowanego po nazwie (nazwy angielskie, bo polskie są tłumaczone).
// Nazwy w tym teście to prawdziwe dane z TMDb (pl-PL i en-US) i TVmaze.

const PL = [
  "Odchudzanie", "Etyka biznesu", "Odcinek 3", "Pomocnik w przestępstwie", "Przeniesienie",
  "Badanie satysfakcji klientów", "Podróż służbowa", "Wrobić Toby'ego", "Nadwyżka",
  "Gwiazdka po marokańsku", "Pojedynek", "Konkurencja", "Odprężenie",
  "Seria wykładów - część 1", "Seria wykładów - część 2", "Krwiodawstwo", "Złoty bilet",
  "Nowy szef", "Dwa tygodnie", "Wymarzony zespół", "Firma papiernicza Michaela Scotta",
  "Ciężka konkurencja", "Spłukani", "Luźny piątek", "Odcinek 25", "Firmowy piknik",
];

// TMDb en-US — 26 odcinków: „Weight Loss" i „Stress Relief" scalone w jeden wpis.
const EN = [
  "Weight Loss", "Business Ethics", "Baby Shower", "Crime Aid", "Employee Transfer",
  "Customer Survey", "Business Trip", "Frame Toby", "The Surplus", "Moroccan Christmas",
  "The Duel", "Prince Family Paper", "Stress Relief", "Lecture Circuit (1)",
  "Lecture Circuit (2)", "Blood Drive", "Golden Ticket", "New Boss", "Two Weeks",
  "Dream Team", "Michael Scott Paper Company", "Heavy Competition", "Broke",
  "Casual Friday", "Cafe Disco", "Company Picnic",
];

// TVmaze — 28 odcinków w numeracji biblioteki (odcinki podwójne rozbite na części).
const TVMAZE = [
  "Weight Loss (1)", "Weight Loss (2)", "Business Ethics", "Baby Shower", "Crime Aid",
  "Employee Transfer", "Customer Survey", "Business Trip", "Frame Toby", "The Surplus",
  "Moroccan Christmas", "The Duel", "Prince Family Paper", "Stress Relief (1)",
  "Stress Relief (2)", "Lecture Circuit (1)", "Lecture Circuit (2)", "Blood Drive",
  "Golden Ticket", "New Boss", "Two Weeks", "Dream Team", "The Michael Scott Paper Company",
  "Heavy Competition", "Broke", "Casual Friday", "Cafe Disco", "Company Picnic",
];

const sezon = (nazwy) => ({
  episodes: nazwy.map((name, i) => ({
    episode_number: i + 1,
    name,
    overview: `Opis: ${name}`,
    air_date: "2008-09-25",
    runtime: 22,
    still_path: null,
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

const przygotuj = async (page, { tvmazeDziala = true } = {}) => {
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  // Kolejność ma znaczenie: Playwright wygrywa OSTATNIO zarejestrowaną trasę,
  // więc ogólny mock musi iść pierwszy, a sezonowy (konkretny) po nim.
  await page.route("https://api.themoviedb.org/**", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) })
  );
  // Predykat po adresie, nie glob: glob nie łapał żądań z parametrem języka
  // (?language=en-US) i te szły do prawdziwego API (401).
  await page.route(
    (url) => url.hostname === "api.themoviedb.org" && url.pathname.includes("/tv/2316/season/"),
    (r) => {
    const jezyk = new URL(r.request().url()).searchParams.get("language");
    const dane = jezyk === "en-US" ? sezon(EN) : sezon(PL);
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dane) });
  });
  await page.route("https://api.tvmaze.com/**", (r) => {
    if (!tvmazeDziala) return r.fulfill({ status: 500, body: "" });
    const episodes = TVMAZE.map((name, i) => ({
      season: 5,
      number: i + 1,
      name,
      summary: `<p>Streszczenie: ${name}</p>`,
      airdate: "2008-09-25",
      runtime: 22,
      image: null,
    }));
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ name: "The Office", _embedded: { episodes } }),
    });
  });
  await page.addInitScript((epizody) => {
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
    localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
    localStorage.setItem("vod-country", "PL"); // fixture = polski użytkownik: nazwy i opisy z TMDb po polsku
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
  await expect(page.locator("#ep-5-1")).toBeVisible({ timeout: 10_000 });
};

const wiersz = (page, nr) => page.locator(`#ep-5-${nr}`);

test.describe("Sezon w numeracji biblioteki (odcinki podwójne scalone przez TMDb)", () => {
  test.use({ serviceWorkers: "block" });

  test("pokazuje wszystkie 28 odcinków, także te, których TMDb nie ma osobno", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(page.locator("#m3-episodes-list .m3-ep-item")).toHaveCount(28);
    await expect(wiersz(page, 27)).toBeVisible();
    await expect(wiersz(page, 28)).toBeVisible();
  });

  test("numeracja jest zgodna z biblioteką: wiersz 3 to Etyka biznesu, nie Baby Shower", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(wiersz(page, 1)).toContainText("Odchudzanie");
    await expect(wiersz(page, 2)).toContainText("Odchudzanie");
    await expect(wiersz(page, 3)).toContainText("Etyka biznesu");
    // Przy numeracji TMDb wiersz 3 pokazywał „Baby Shower" — czyli opis innego odcinka.
    await expect(wiersz(page, 3)).not.toContainText("Baby Shower");
  });

  test("przesunięcie o 2 jest widoczne na Odprężeniu i Serii wykładów", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(wiersz(page, 14)).toContainText("Odprężenie");
    await expect(wiersz(page, 15)).toContainText("Odprężenie");
    await expect(wiersz(page, 16)).toContainText("Seria wykładów");
    await expect(wiersz(page, 17)).toContainText("Seria wykładów");
  });

  test("polskie opisy TMDb trafiają na właściwe wiersze, a brak tłumaczenia korzysta z TVmaze", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(wiersz(page, 3).locator(".m3-ep-desc")).toContainText("Opis: Etyka biznesu");
    // TMDb nie ma polskiej nazwy odcinka „Cafe Disco" (zaślepka „Odcinek 25") — bierzemy nazwę z TVmaze.
    await expect(wiersz(page, 27)).toContainText("Cafe Disco");
    await expect(wiersz(page, 28)).toContainText("Firmowy piknik");
  });

  test("licznik sezonu zgadza się z liczbą odcinków, bez notki o pominiętych wpisach", async ({ page }) => {
    await przygotuj(page);
    await otworzTracker(page);

    await expect(page.locator("#tab-season-5 .m3-season-tab-badge")).toHaveText("(28/28)");
    await expect(page.locator("#m3-episodes-list .m3-ep-extra-note")).toHaveCount(0);
  });

  test("gdy TVmaze nie odpowiada, zostaje numeracja TMDb i wpisy bez wiersza są zapowiedziane", async ({ page }) => {
    await przygotuj(page, { tvmazeDziala: false });
    await otworzTracker(page);

    await expect(page.locator("#m3-episodes-list .m3-ep-item")).toHaveCount(26);
    const nota = page.locator("#m3-episodes-list .m3-ep-extra-note");
    await expect(nota).toHaveCount(1);
    await expect(nota).toContainText("27, 28");
  });
});
