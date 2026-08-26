import { test, expect } from "@playwright/test";

// Regresja zgłoszenia z PWA na telefonie:
// 1) PL (1 wynik, brak polskiego opisu -> fallback OMDb) zawieszał spinner na zawsze
//    (fetch bez timeouta). Teraz: timeout 6s, przepływ kończy się podglądem.
// 2) EN (wiele wyników) -> klik otwierał podgląd; pilnujemy dalej.
// 3) Service Worker rejestrowany z root scope (wcześniej niepoprawny scope = brak PWA/offline).

const TMDB_KEY = "test-key";

const MOVIE_DETAIL = (id, title) => ({
  id,
  title,
  original_title: title,
  overview: "Przykładowy opis fabuły filmu.",
  runtime: 104,
  release_date: "2025-09-12",
  genres: [{ id: 53, name: "Thriller" }],
  credits: { cast: [], crew: [] },
  watch: { providers: { results: {} } },
  release_dates: { results: [] },
  production_countries: [],
  poster_path: "/abc.jpg",
  imdb_id: null,
});

function installRoutes(page, { omdbHang = false } = {}) {
  const json = (body) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  // Uwaga: Playwright dopasowuje trasy LIFO — catch-all musi być PIERWSZY.
  page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));

  // Brak backendu (jak na GitHub Pages)
  page.route("**/api/search_preview**", (r) => r.abort());
  page.route("**/api/search_detail**", (r) => r.abort());

  page.route("https://api.themoviedb.org/3/authentication?*", (r) =>
    r.fulfill(json({ status_code: 1, status_message: "Success." })));

  page.route("https://api.themoviedb.org/3/search/movie?**", (route) => {
    const url = route.request().url();
    if (url.includes(encodeURIComponent("Kiedy nikt nie patrzy"))) {
      return route.fulfill(json({
        results: [{
          id: 9001,
          title: "Kiedy nikt nie patrzy",
          original_title: "Nobody Watches Me",
          release_date: "2025-09-12",
          overview: "",
          poster_path: "/pl1.jpg",
          vote_average: 6.4,
        }],
      }));
    }
    if (url.includes(encodeURIComponent("The Voyeurs"))) {
      return route.fulfill(json({
        results: [
          { id: 632857, title: "The Voyeurs", original_title: "The Voyeurs", release_date: "2021-09-10", overview: "Thriller.", poster_path: "/tv1.jpg", vote_average: 6.0 },
          { id: 632858, title: "The Voyeurs 2", original_title: "The Voyeurs 2", release_date: "2022-01-01", overview: "Sequel.", poster_path: "/tv2.jpg", vote_average: 5.0 },
        ],
      }));
    }
    return route.fulfill(json({ results: [] }));
  });

  page.route("https://api.themoviedb.org/3/movie/9001?*", (r) => {
    const detail = MOVIE_DETAIL(9001, "Kiedy nikt nie patrzy");
    detail.overview = ""; // polski overview nieosiągalny -> wymusza fallback OMDb
    return r.fulfill(json(detail));
  });
  page.route("https://api.themoviedb.org/3/movie/632857?*", (r) =>
    r.fulfill(json(MOVIE_DETAIL(632857, "The Voyeurs"))));

  if (omdbHang) {
    // Symulacja zawieszonego OMDb (sieć komórkowa/reklamy DNS)
    page.route("https://www.omdbapi.com/**", () => new Promise(() => {}));
  } else {
    page.route("https://www.omdbapi.com/**", (r) =>
      r.fulfill(json({ Response: "False", Error: "Movie not found!" })));
  }
}

async function openAddModal(page) {
  await page.addInitScript(() => {
    localStorage.setItem("cinelog_tmdb_key", "test-key");
    localStorage.setItem("cinelog_omdb_key", "omdb-test-key");
  });
  await page.goto("/");
  await page.locator("#m3-fab-add").click();
  await expect(page.locator("#m3-sheet-add")).toHaveClass(/active/);
}

async function submitSearch(page, query) {
  await page.fill("#m3-search-preview-input", query);
  await page.click("#m3-btn-search-trigger");
}

function expectedErrors(errors) {
  return errors.filter((e) => !e.includes("net::ERR_FAILED"));
}

test.describe("Service Worker", () => {
  test("rejestruje się z poprawnym scope (root, nie /static/)", async ({ page }) => {
    await page.goto("/");
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.ready;
      return r.active.scriptURL;
    });
    expect(reg).toContain("/sw.js");
    expect(reg).not.toContain("/static/sw.js");
  });
});

test.describe("Wyszukiwanie i dodawanie (tryb statyczny, jak PWA na telefonie)", () => {
  // Blokujemy SW: jego własne fetch-e omijają mocki tras i uderzają w realne API.
  test.use({ serviceWorkers: "block" });

  let errors;

  test.beforeEach(async ({ page }) => {
    errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });
  });

  test("PL: pojedynczy wynik bez polskiego opisu otwiera podgląd mimo wiszącego OMDb", async ({ page }) => {
    installRoutes(page, { omdbHang: true });
    await openAddModal(page);
    await submitSearch(page, "Kiedy nikt nie patrzy");
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("#m3-preview-title")).toContainText("Kiedy nikt nie patrzy");
    expect(expectedErrors(errors), `Błędy JS:\n${expectedErrors(errors).join("\n")}`).toEqual([]);
  });

  test("EN: wiele wyników -> klik otwiera podgląd", async ({ page }) => {
    installRoutes(page);
    await openAddModal(page);
    await submitSearch(page, "The Voyeurs");
    const rows = page.locator("#m3-search-results-list .m3-result-item");
    await expect(rows).toHaveCount(2, { timeout: 8000 });
    await rows.first().click();
    await expect(page.locator("#m3-add-step-preview")).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#m3-preview-title")).toContainText("The Voyeurs");
    expect(expectedErrors(errors), `Błędy JS:\n${expectedErrors(errors).join("\n")}`).toEqual([]);
  });
});
