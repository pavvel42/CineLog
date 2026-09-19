import { test, expect } from "@playwright/test";

// Regresja zgłoszona przez użytkownika: po dodaniu serialu "Biuro" opis i obsada były
// z jednej wersji serialu, a odcinki z innej. Przyczyna: gdy wpis nie miał tmdb_id,
// aplikacja wyszukiwała serial po tytule i brała PIERWSZY wynik, nie sprawdzając nawet,
// czy to ten sam tytuł ani rok. Sprawdzamy więc samo dopasowanie, na prawdziwym module
// aplikacji (import z bundla), oraz to, że istniejącego identyfikatora nikt nie nadpisuje.

const PRAWDZIWY = { id: 2316, name: "Biuro", original_name: "The Office", first_air_date: "2005-03-24" };
const ZUPEŁNIE_INNY = { id: 309130, name: "激战黄土岭", original_name: "激战黄土岭", first_air_date: "1995-01-01" };
const TA_SAMA_NAZWA_INNY_ROK = { id: 2996, name: "Biuro", original_name: "The Office", first_air_date: "2001-07-09" };

const przygotuj = async (page) => {
  // bez sieci: sprawdzamy wyłącznie logikę dopasowania i stan biblioteki
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.route("**/api/**", (r) => r.abort());
  await page.route("https://api.themoviedb.org/**", (r) => r.abort());
  await page.addInitScript(() => {
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
    localStorage.setItem("cinelog_tmdb_key", "klucz-testowy");
    localStorage.setItem("vod-country", "PL");
  });
  await page.goto("/");
  await page.waitForTimeout(2500);
};

const dopasuj = (page, wyniki, tytul, rok) =>
  page.evaluate(async ([lista, t, r]) => {
    const { wybierzTrafienieWTmdb } = await import("/static/js/modules/state.js");
    const trafienie = wybierzTrafienieWTmdb(lista, t, r);
    return trafienie ? trafienie.id : null;
  }, [wyniki, tytul, rok]);

test.describe("Dopasowanie tytułu do TMDb", () => {
  test.use({ serviceWorkers: "block" });

  test("wybiera wersję zgodną z tytułem i rokiem, a nie pierwszą z listy", async ({ page }) => {
    await przygotuj(page);
    expect(await dopasuj(page, [ZUPEŁNIE_INNY, TA_SAMA_NAZWA_INNY_ROK, PRAWDZIWY], "Biuro", "2005")).toBe(2316);
  });

  test("rok rozstrzyga między dwiema wersjami o tym samym tytule", async ({ page }) => {
    await przygotuj(page);
    expect(await dopasuj(page, [TA_SAMA_NAZWA_INNY_ROK, PRAWDZIWY], "Biuro", "2005")).toBe(2316);
  });

  test("obcy tytuł nie jest przyjmowany, nawet jako pierwszy wynik", async ({ page }) => {
    await przygotuj(page);
    expect(await dopasuj(page, [ZUPEŁNIE_INNY], "Biuro", "2005")).toBeNull();
  });

  test("bez roku dwie wersje o tym samym tytule to za mało, żeby cokolwiek wybrać", async ({ page }) => {
    await przygotuj(page);
    expect(await dopasuj(page, [PRAWDZIWY, TA_SAMA_NAZWA_INNY_ROK], "Biuro", "")).toBeNull();
  });

  test("tytuł oryginalny też jest brany pod uwagę", async ({ page }) => {
    await przygotuj(page);
    expect(await dopasuj(page, [PRAWDZIWY], "The Office", "2005")).toBe(2316);
  });
});

test.describe("Import nie wpisuje identyfikatora z pierwszego wyniku", () => {
  test.use({ serviceWorkers: "block" });

  const zaimportujId = (page) =>
    page.evaluate(async () => {
      const { resolveImportTmdbId } = await import("/static/js/modules/importer.js");
      return resolveImportTmdbId({ title: "Biuro", year: "2005" }, true, "klucz-testowy", "pl-PL");
    });

  test("odrzuca pierwszą lepszą produkcję o innym roku i nie pasujący tytuł", async ({ page }) => {
    await przygotuj(page);
    await page.route("https://api.themoviedb.org/3/search/tv?**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [ZUPEŁNIE_INNY, TA_SAMA_NAZWA_INNY_ROK] }),
      })
    );

    expect(await zaimportujId(page)).toBeFalsy();
  });

  test("przyjmuje właściwą wersję serialu, gdy jest na liście wyników", async ({ page }) => {
    await przygotuj(page);
    await page.route("https://api.themoviedb.org/3/search/tv?**", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ results: [ZUPEŁNIE_INNY, TA_SAMA_NAZWA_INNY_ROK, PRAWDZIWY] }),
      })
    );

    expect(await zaimportujId(page)).toBe(2316);
  });
});
