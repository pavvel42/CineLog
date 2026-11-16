import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Regresje z audytu „peryferii” frontendu (P1–P5):
//  P1 parser CSV traktował apostrof jak cudzysłów pola,
//  P2 radar premier wstawiał tytuł i plakat z API do innerHTML bez escapowania,
//  P3 eksport .ics miał DTEND = DTSTART, nieescapowany tekst i brak zawijania linii,
//  P4 asystent AI odrzucał prawdziwe tytuły zawierające słowo z listy etykiet,
//  P5 w index.html zostały kontrolki bez żadnej obsługi w JS.
// Żaden test nie wychodzi do prawdziwej sieci: API aplikacji i TMDb są mockowane.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** Strona z pustą biblioteką (domyślnie w trybie klienta); backend i TMDb zablokowane. */
const przygotuj = async (page, routing = async () => {}, tryb = "client") => {
  await page.route("**/api/**", (r) => r.fulfill({ status: 404, body: "" }));
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({})));
  await page.route("https://image.tmdb.org/**", (r) => r.abort());
  await page.route("https://www.omdbapi.com/**", (r) => r.fulfill(json({ Response: "False" })));
  await routing(page);
  await page.addInitScript((trybBiblioteki) => {
    if (localStorage.getItem("__zasiane")) return;
    localStorage.setItem("__zasiane", "1");
    localStorage.setItem(
      "cinelog_database",
      JSON.stringify({ movies: [], shows: [], updated_at: "2026-01-01T00:00:00.000Z" }),
    );
    localStorage.setItem("cinelog_active_mode", trybBiblioteki);
    localStorage.setItem("cinelog_user_imported", "true");
  }, tryb);
  await page.goto("/");
  await page.waitForFunction(() => typeof window.switchTab === "function");
};

// Harmonogram z /api/upcoming dotyczy biblioteki serwera, więc radar pyta o niego tylko
// w trybie serwera Flask — te testy działają na (pustej) bibliotece serwera.
const otworzNadchodzace = async (page, items) => {
  await przygotuj(page, async (p) => {
    await p.route("**/api/movies", (r) => r.fulfill(json([])));
    await p.route("**/api/shows", (r) => r.fulfill(json([])));
    await p.route("**/api/shows/verify_completion", (r) => r.fulfill(json({ updated: 0 })));
    await p.route("**/api/upcoming**", (r) => r.fulfill(json({ items })));
  }, "flask");
  await page.evaluate(() => window.switchTab("upcoming"));
  await expect(page.locator("#m3-upcoming-content .m3-upcoming-card").first()).toBeVisible({ timeout: 10_000 });
};

test.describe("P1: parser CSV importu", () => {
  test.use({ serviceWorkers: "block" });

  const parsuj = (page, tekst) =>
    page.evaluate(async (t) => {
      const { parseCSV } = await import("/static/js/modules/importer.js");
      return parseCSV(t);
    }, tekst);

  test("apostrof jest zwykłym znakiem; przecinek i \"\" w polu w cudzysłowie dają 4 poprawne wiersze", async ({ page }) => {
    await przygotuj(page);
    const csv = [
      "Title,Year,Rating",
      "Ocean's Eleven,2001,4",
      "Schindler's List,1993,5",
      '"Lock, Stock and Two Smoking Barrels",1998,4',
      '"Say ""Hello"" to Hell",2000,3',
    ].join("\n");

    const wiersze = await parsuj(page, csv);
    expect(wiersze).toEqual([
      { title: "Ocean's Eleven", year: "2001", rating: "4" },
      { title: "Schindler's List", year: "1993", rating: "5" },
      { title: "Lock, Stock and Two Smoking Barrels", year: "1998", rating: "4" },
      { title: 'Say "Hello" to Hell', year: "2000", rating: "3" },
    ]);
  });

  test("pole w cudzysłowie może zawierać znak nowej linii; BOM i CRLF nie psują wierszy", async ({ page }) => {
    await przygotuj(page);
    const csv = "\uFEFFTitle;Year;Review\r\n" +
      "Ocean's Eleven;2001;\"Pierwsza linia\r\ndruga linia; ze średnikiem\"\r\n" +
      "Don't Look Up;2021;ok\r\n";

    const wiersze = await parsuj(page, csv);
    expect(wiersze).toHaveLength(2);
    expect(wiersze[0]).toEqual({
      title: "Ocean's Eleven",
      year: "2001",
      review: "Pierwsza linia\r\ndruga linia; ze średnikiem",
    });
    expect(wiersze[1]).toEqual({ title: "Don't Look Up", year: "2021", review: "ok" });
  });
});

test.describe("P2: radar premier nie wykonuje HTML z API", () => {
  test.use({ serviceWorkers: "block" });

  test("tytuł, plakat, identyfikator i etykieta z API są tekstem, a nie znacznikami", async ({ page }) => {
    const zlosliwyTytul = '<img src=x onerror="window.__xss=1">';
    await otworzNadchodzace(page, [
      {
        id: 'id" onmouseover="window.__xss=1',
        title: zlosliwyTytul,
        media_type: "tv",
        poster_url: 'https://image.tmdb.org/t/p/w500/a.jpg" onerror="window.__xss=1',
        release_date: "2026-11-20",
        days_left: 6,
        badge_type: "episode_airing",
        status_label: '<b onmouseover="window.__xss=1">S01E01</b>',
      },
      {
        id: "film-2",
        title: "Film z plakatem javascript",
        media_type: "movie",
        poster_url: "javascript:window.__xss=1",
        release_date: '2026-12-01"><i id="wstrzykniety">',
        days_left: 17,
        badge_type: "movie_premiere",
        status_label: "Premiera",
      },
    ]);
    await page.waitForTimeout(500);

    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
    await expect(page.locator("#m3-upcoming-content .m3-upcoming-title").first()).toHaveText(zlosliwyTytul);
    await expect(page.locator("#m3-upcoming-content .m3-upcoming-subtitle").first()).toHaveText(
      '<b onmouseover="window.__xss=1">S01E01</b>',
    );

    // Nic z danych API nie stało się elementem ani atrybutem.
    expect(await page.locator('#m3-upcoming-content img[src="x"]').count()).toBe(0);
    expect(await page.locator("#m3-upcoming-content #wstrzykniety").count()).toBe(0);
    const atrybuty = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#m3-upcoming-content *")).flatMap((el) =>
        Array.from(el.attributes).map((a) => a.name).filter((n) => /^on/i.test(n)),
      ),
    );
    expect(atrybuty).toEqual([]);
    await expect(page.locator("#m3-upcoming-content .m3-upcoming-card").first()).toHaveAttribute(
      "data-id",
      'id" onmouseover="window.__xss=1',
    );
  });
});

test.describe("P3: eksport .ics", () => {
  test.use({ serviceWorkers: "block" });

  const dlugiTytul = "Zażółć gęślą jaźń — bardzo długi tytuł serialu, który na pewno nie zmieści się w jednej linii pliku kalendarza";

  const pobierzIcs = async (page) => {
    const [pobranie] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#m3-upcoming-export-ics-btn").click(),
    ]);
    const bajty = fs.readFileSync(await pobranie.path());
    return { surowy: bajty.toString("utf8"), bajty };
  };

  const zdarzenie = (tekstZRozwinietymiLiniami, fragment) =>
    tekstZRozwinietymiLiniami
      .split("BEGIN:VEVENT")
      .slice(1)
      .find((blok) => blok.includes(fragment));

  test("DTEND to następny dzień, tekst jest escapowany wg RFC 5545, a linie mają ≤ 75 oktetów", async ({ page }) => {
    await otworzNadchodzace(page, [
      {
        id: "mm",
        title: "Mad Men; sezon 2, odc. 1",
        media_type: "tv",
        release_date: "2026-12-31",
        days_left: 47,
        status_label: "S02E01",
      },
      {
        id: "przestepny",
        title: "Film przestępny",
        media_type: "movie",
        release_date: "2028-02-28",
        days_left: 500,
        status_label: "Premiera",
      },
      {
        id: "linie",
        title: "Linia1\nLinia2 \\ koniec",
        media_type: "movie",
        release_date: "2026-11-30",
        days_left: 16,
        status_label: "Premiera",
      },
      { id: "dlugi", title: dlugiTytul, media_type: "tv", release_date: "2026-11-25", days_left: 11, status_label: "S03E04" },
    ]);

    const { surowy } = await pobierzIcs(page);
    expect(surowy).not.toContain("\uFFFD"); // zawijanie nie rozcięło znaku wielobajtowego
    expect(surowy.endsWith("END:VCALENDAR\r\n") || surowy.endsWith("END:VCALENDAR")).toBe(true);

    // Plik kończy się CRLF — ostatni, pusty element podziału nie jest linią pliku.
    const fizyczne = surowy.replace(/\r\n$/, "").split("\r\n");
    for (const linia of fizyczne) {
      expect(Buffer.byteLength(linia, "utf8"), `linia dłuższa niż 75 oktetów: ${linia}`).toBeLessThanOrEqual(75);
    }
    // Zawijanie: kontynuacja zaczyna się od spacji (rozwijamy ją przed asercjami).
    const rozwiniety = surowy.replace(/\r\n[ \t]/g, "");

    const madMen = zdarzenie(rozwiniety, "Mad Men");
    expect(madMen).toBeTruthy();
    expect(madMen).toContain("DTSTART;VALUE=DATE:20261231");
    expect(madMen).toContain("DTEND;VALUE=DATE:20270101");
    expect(madMen).toContain("SUMMARY:📺 Premiera odcinka: Mad Men\\; sezon 2\\, odc. 1 (S02E01)");
    expect(madMen).not.toContain("Mad Men; sezon");
    // Separator wierszy opisu to \n (jeden ukośnik), nie \\n.
    expect(madMen).toContain("DESCRIPTION:Premiera w CineLog: Mad Men\\; sezon 2\\, odc. 1\\nStatus: S02E01\\nTyp: Serial");
    expect(madMen).not.toContain("\\\\n");

    const przestepny = zdarzenie(rozwiniety, "Film przestępny");
    expect(przestepny).toContain("DTSTART;VALUE=DATE:20280228");
    expect(przestepny).toContain("DTEND;VALUE=DATE:20280229");

    const linie = zdarzenie(rozwiniety, "Linia1");
    expect(linie).toContain("SUMMARY:🎬 Premiera filmu: Linia1\\nLinia2 \\\\ koniec");
    expect(linie).toContain("DTEND;VALUE=DATE:20261201");

    const dlugi = zdarzenie(rozwiniety, "Zażółć");
    expect(dlugi).toContain(`SUMMARY:📺 Premiera odcinka: ${dlugiTytul.replace(/,/g, "\\,")} (S03E04)`);
    // Ten tytuł faktycznie wymusił zawijanie.
    expect(fizyczne.some((l) => l.startsWith(" "))).toBe(true);
    for (const linia of fizyczne) expect(linia).not.toMatch(/^\s*$/);

    // UID nie niesie znaków specjalnych z tytułu.
    for (const uid of rozwiniety.match(/^UID:.*$/gm) || []) expect(uid).toMatch(/^UID:[\w@.-]+$/);
  });
});

test.describe("P4: asystent AI rozpoznaje prawdziwe tytuły", () => {
  test.use({ serviceWorkers: "block" });

  const kandydaci = (page, linie) =>
    page.evaluate(async (l) => {
      const { extractPrimaryMentionCandidates } = await import("/static/js/modules/ai.js");
      return extractPrimaryMentionCandidates(l).map((c) => c.name);
    }, linie);

  test("tytuły zawierające słowo z listy etykiet są rozpoznawane", async ({ page }) => {
    await przygotuj(page);
    const nazwy = await kandydaci(page, [
      '1. "Wybór Zofii" (1982) – dramat',
      '2. "Prime Suspect" (1991) – serial',
      '3. "Serial Experiments Lain" (1998) – anime',
      '4. "Idea of You" (2024) – romans',
    ]);
    expect(nazwy).toEqual(["Wybór Zofii", "Prime Suspect", "Serial Experiments Lain", "Idea of You"]);
  });

  test("etykiety i nagłówki (całe frazy z listy) nadal są odrzucane", async ({ page }) => {
    await przygotuj(page);
    const nazwy = await kandydaci(page, [
      '1. "Mój wybór: Coherence" (2013)',
      '2. "Analyze the User\'s Request"',
      "3. **Twój Archetyp Kinomana**: Analityczny Koneser",
      "4. **Kluczowe Fascynacje**: motywy",
      "5. **Złota Rekomendacja AI**: Dokładnie 1 film",
      '6. "Masz na liście"',
      '7. "Tok myślenia"',
      '8. "Propozycje dla Ciebie"',
      '9. "Netflix"',
      '10. "Do obejrzenia"',
      '11. "Coherence" (2013) – prawdziwy tytuł',
    ]);
    expect(nazwy).toEqual(["Coherence"]);
  });
});

test.describe("P5: martwe kontrolki usunięte z index.html", () => {
  test.use({ serviceWorkers: "block" });

  const USUNIETE = [
    "m3-btn-next-ep",
    "m3-btn-copy-series-ai",
    "m3-btn-pwa-install",
    "m3-pwa-install-banner",
    "m3-btn-pwa-install-banner",
    "m3-btn-pwa-dismiss",
    "m3-add-episodes-summary",
  ];

  test("usunięte identyfikatory nie istnieją w DOM", async ({ page }) => {
    await przygotuj(page);
    await page.waitForTimeout(800);
    const obecne = await page.evaluate(
      (ids) => ids.filter((id) => document.getElementById(id)),
      USUNIETE,
    );
    expect(obecne).toEqual([]);
  });

  test("żaden element nie obiecuje instalacji przyciskiem ani nie jest ukryty na stałe jako baner PWA", async ({ page }) => {
    await przygotuj(page);
    const html = await page.evaluate(() => document.body.innerHTML);
    expect(html).not.toMatch(/Zainstaluj (aplikację|CineLog)/);
    expect(html).not.toContain("Oznacz kolejny (+1)");
  });
});
