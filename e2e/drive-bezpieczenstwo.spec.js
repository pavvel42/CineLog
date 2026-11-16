import { test, expect } from "@playwright/test";

// Regresje z audytu synchronizacji z Dyskiem Google (D7–D9) i decyzji „usunięcia mają
// przechodzić między urządzeniami":
//  - błąd odczytu (HTTP 5xx, uszkodzony plik, nieudane wyszukiwanie) wyglądał jak „Dysk pusty",
//    po czym lokalna biblioteka nadpisywała plik na Dysku;
//  - zapis odroczony o 2 s wysyłał tablice z chwili edycji, a nie aktualną bibliotekę;
//  - „Przywróć poprzednią bazę" nie wysyłało wyniku na Dysk, więc następna synchronizacja
//    cofała przywrócenie;
//  - scalanie było sumą zbiorów: pozycja usunięta na jednym urządzeniu wracała z drugiego.

const json = (body, status = 200) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
const PLIK_BAZY = "baza-test-1";
const PLIK_USTAWIEN = "ustawienia-test-1";

const film = (uuid, title, tmdb_id) => ({
  uuid,
  title,
  tmdb_id,
  status: "watched",
  rating: null,
  is_favorite: false,
  poster_url: "",
  release_date: "2010-01-01",
  watch_date: "2026-01-01 10:00:00",
});

const INCEPCJA = film("m-1", "Incepcja", 27205);
const DIUNA = film("m-2", "Diuna", 438631);
const ARRIVAL = film("m-3", "Nowy początek", 329865);

/**
 * Atrapa Dysku Google z wstrzykiwanymi awariami.
 * @param {import("@playwright/test").Page} page
 * @param {{movies: object[], shows: object[], deleted?: object[]}|null} bazaNaDysku null = brak pliku
 */
async function atrapaDysku(page, bazaNaDysku) {
  const dysk = { baza: bazaNaDysku, wysylki: [], probyWysylki: 0, pobrania: 0, awaria: {} };
  await page.route("**/api/**", (r) => r.abort());
  await page.route("https://api.themoviedb.org/**", (r) => r.fulfill(json({ results: [] })));
  await page.route("https://accounts.google.com/**", (r) => r.abort());
  await page.route("https://www.googleapis.com/**", async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.includes("/upload/drive/")) {
      const tresc = req.postData() || "";
      if (tresc.includes("cinelog_database.json")) {
        dysk.probyWysylki += 1;
        if (dysk.awaria.wysylka) return route.fulfill(json({ error: "awaria" }, dysk.awaria.wysylka));
        const start = tresc.indexOf('{\n  "app"');
        const wyslana = JSON.parse(tresc.slice(start, tresc.lastIndexOf("}") + 1));
        dysk.wysylki.push(wyslana);
        dysk.baza = { movies: wyslana.movies, shows: wyslana.shows, deleted: wyslana.deleted };
        return route.fulfill(json({ id: PLIK_BAZY }));
      }
      return route.fulfill(json({ id: PLIK_USTAWIEN }));
    }
    if (url.includes(`/files/${PLIK_BAZY}?alt=media`)) {
      dysk.pobrania += 1;
      if (dysk.awaria.pobieranie) return route.fulfill(json({ error: "awaria" }, dysk.awaria.pobieranie));
      if (dysk.awaria.zepsutyPlik) return route.fulfill({ status: 200, contentType: "application/json", body: '{"app": "CineLog", "movies": [' });
      return route.fulfill(json({ app: "CineLog", ...dysk.baza }));
    }
    if (url.includes(`/files/${PLIK_USTAWIEN}?alt=media`)) {
      return route.fulfill(json({ country: "PL", subscriptions: [] }));
    }
    if (url.includes(`/files/${PLIK_BAZY}?fields`)) {
      if (!dysk.baza) return route.fulfill(json({ error: "brak pliku" }, 404));
      return route.fulfill(json({ id: PLIK_BAZY, name: "cinelog_database.json", trashed: false }));
    }
    if (url.includes(`/files/${PLIK_USTAWIEN}?fields`)) {
      return route.fulfill(json({ id: PLIK_USTAWIEN, name: "cinelog_settings.json", trashed: false }));
    }
    if (url.includes("/drive/v3/files?")) {
      if (dysk.awaria.szukanie) return route.fulfill(json({ error: "awaria" }, dysk.awaria.szukanie));
      const ustawienia = decodeURIComponent(url).includes("cinelog_settings.json");
      if (!ustawienia && !dysk.baza) return route.fulfill(json({ files: [] }));
      return route.fulfill(json({ files: [{ id: ustawienia ? PLIK_USTAWIEN : PLIK_BAZY }] }));
    }
    return route.fulfill(json({}));
  });
  return dysk;
}

/**
 * Stan przeglądarki: biblioteka użytkownika + połączenie z Dyskiem.
 * @param {import("@playwright/test").Page} page
 */
async function przegladarka(page, { movies, zmianyDoWyslania = false, zapamietanyPlik = true, usuniete = null, kopia = null, tryb = "client" }) {
  await page.addInitScript(
    ({ movies, zmianyDoWyslania, zapamietanyPlik, usuniete, kopia, tryb, plikBazy, plikUstawien }) => {
      if (sessionStorage.getItem("przygotowane")) return; // odświeżenie strony w teście
      sessionStorage.setItem("przygotowane", "1");
      if (tryb === "client") {
        localStorage.setItem("cinelog_active_mode", "client");
        localStorage.setItem("cinelog_user_imported", "true");
        localStorage.setItem("cinelog_database", JSON.stringify({ movies, shows: [], updated_at: new Date().toISOString() }));
      }
      localStorage.setItem("vod-country", "PL");
      localStorage.setItem("gdrive_client_id", "klient-testowy.apps.googleusercontent.com");
      localStorage.setItem("gdrive_access_token", "token-testowy");
      localStorage.setItem("gdrive_token_exp", String(Date.now() + 3_600_000));
      if (zapamietanyPlik) localStorage.setItem("gdrive_file_id", plikBazy);
      localStorage.setItem("gdrive_settings_file_id", plikUstawien);
      if (zmianyDoWyslania) localStorage.setItem("gdrive_pending_upload", "true");
      if (usuniete) localStorage.setItem("cinelog_deleted", JSON.stringify(usuniete));
      if (kopia) localStorage.setItem("cinelog_database_backup", JSON.stringify(kopia));
    },
    { movies, zmianyDoWyslania, zapamietanyPlik, usuniete, kopia, tryb, plikBazy: PLIK_BAZY, plikUstawien: PLIK_USTAWIEN }
  );
  await page.addInitScript(() => {
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (cfg) => {
            const klient = {
              callback: cfg.callback,
              requestAccessToken: () => setTimeout(() => klient.callback({ access_token: "token-odnowiony", expires_in: 3600 }), 50),
            };
            return klient;
          },
          revoke: () => {},
        },
      },
    };
  });
}

const lokalneTytuly = (page) =>
  page.evaluate(() => (JSON.parse(localStorage.getItem("cinelog_database") || "{}").movies || []).map((m) => m.title).sort());

const nagrobek = (wpis, kiedy = new Date().toISOString()) => ({
  typ: "movie",
  uuid: wpis.uuid,
  tmdb_id: String(wpis.tmdb_id),
  title: wpis.title,
  year: "2010",
  deleted_at: kiedy,
});

test.describe("Dysk Google: błąd odczytu nie może nadpisać biblioteki na Dysku", () => {
  test.use({ serviceWorkers: "block" });

  for (const [opis, awaria, zapamietanyPlik] of [
    ["HTTP 500 przy pobieraniu pliku", { pobieranie: 500 }, true],
    ["HTTP 429 przy pobieraniu pliku", { pobieranie: 429 }, true],
    ["uszkodzony plik na Dysku", { zepsutyPlik: true }, true],
    ["nieudane wyszukiwanie pliku", { szukanie: 500 }, false],
  ]) {
    test(`${opis}: nic nie jest wysyłane, biblioteka zostaje`, async ({ page }) => {
      const dysk = await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
      dysk.awaria = awaria;
      await przegladarka(page, { movies: [INCEPCJA], zapamietanyPlik });

      await page.goto("/?mode=movies");
      await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });
      await page.waitForTimeout(2500);

      expect(dysk.wysylki, "po błędzie odczytu nie wolno nic wysyłać").toHaveLength(0);
      expect(await lokalneTytuly(page)).toEqual(["Incepcja"]);
      await expect(page.locator("#m3-drive-status-text")).toContainText(/Błąd/);
    });
  }

  test("pusta baza na Dysku nie kasuje po cichu lokalnej biblioteki", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA, DIUNA] });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1000);

    expect(await lokalneTytuly(page)).toEqual(["Diuna", "Incepcja"]);
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(2);
  });

  test("połączenie z pustym Dyskiem w trybie demo nie wysyła bazy demonstracyjnej", async ({ page }) => {
    const dysk = await atrapaDysku(page, null);
    await przegladarka(page, { movies: [], tryb: "demo", zapamietanyPlik: false });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(50, { timeout: 10_000 });
    await page.evaluate(() => window.googleDriveSync.syncWithDrive(() => {}));
    await page.waitForTimeout(1000);

    expect(dysk.wysylki, "baza demo nie jest biblioteką użytkownika").toHaveLength(0);
  });
});

test.describe("Dysk Google: zapis odroczony i przywracanie kopii", () => {
  test.use({ serviceWorkers: "block" });

  test("zapis odroczony wysyła aktualną bibliotekę, a nie tablice z chwili edycji", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);

    // Na drugim urządzeniu doszedł film; tutaj edycja i od razu synchronizacja (powrót do karty).
    dysk.baza = { movies: [INCEPCJA, DIUNA], shows: [] };
    await page.locator("#m3-movies-grid .m3-card-fav-btn").first().click();
    await page.evaluate(() => window.googleDriveSync.autoSync());
    await expect(page.locator("#m3-movies-grid")).toContainText("Diuna", { timeout: 10_000 });
    await page.waitForTimeout(3000); // czas na odroczony zapis sprzed synchronizacji

    expect(dysk.baza.movies.map((m) => m.title).sort(), "ostatni zapis na Dysku").toEqual(["Diuna", "Incepcja"]);
    expect(dysk.baza.movies.find((m) => m.title === "Incepcja").is_favorite).toBe(true);
  });

  test("przywrócona kopia trafia na Dysk i nie jest cofana przy następnej synchronizacji", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, {
      movies: [INCEPCJA],
      kopia: { movies: [INCEPCJA, DIUNA, ARRIVAL], shows: [], saved_at: "2026-01-01T00:00:00.000Z", source: "test" },
      usuniete: [nagrobek(DIUNA)],
    });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);
    await page.evaluate(() => document.getElementById("m3-btn-restore-backup").click());
    await page.evaluate(() => document.getElementById("m3-dialog-btn-confirm").click());

    await expect.poll(() => (dysk.baza.movies || []).length, { timeout: 10_000 }).toBe(3);
    expect(dysk.baza.deleted || [], "przywrócona pozycja nie może zostać oznaczona jako usunięta").toHaveLength(0);

    await page.reload();
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(3, { timeout: 10_000 });
    expect(await lokalneTytuly(page)).toEqual(["Diuna", "Incepcja", "Nowy początek"]);
  });
});

test.describe("Dysk Google: usunięcia przechodzą między urządzeniami", () => {
  test.use({ serviceWorkers: "block" });

  test("film usunięty tutaj nie wraca z Dysku i znika także na Dysku", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA, DIUNA] });

    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(2, { timeout: 10_000 });
    await expect.poll(() => dysk.pobrania, { timeout: 10_000 }).toBeGreaterThan(0);

    await page.locator("#m3-movies-grid article.m3-card", { hasText: "Diuna" }).click();
    await page.locator("#m3-detail-delete-btn").click();
    await page.locator("#m3-dialog-btn-confirm").click();
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1);

    await expect.poll(() => (dysk.baza.movies || []).map((m) => m.title), { timeout: 10_000 }).toEqual(["Incepcja"]);
    expect((dysk.baza.deleted || []).map((u) => u.uuid)).toEqual(["m-2"]);

    // Drugie urządzenie w międzyczasie wysłało swoją (starą) wersję z Diuną i nową pozycją.
    dysk.baza = { movies: [INCEPCJA, DIUNA, ARRIVAL], shows: [] };
    await page.evaluate(() => {
      localStorage.setItem("gdrive_pending_upload", "true");
      return window.googleDriveSync.autoSync();
    });
    await expect(page.locator("#m3-movies-grid")).toContainText("Nowy początek", { timeout: 10_000 });
    expect(await lokalneTytuly(page)).toEqual(["Incepcja", "Nowy początek"]);
    expect(dysk.baza.movies.map((m) => m.title).sort()).toEqual(["Incepcja", "Nowy początek"]);
  });

  test("film usunięty na drugim urządzeniu znika tutaj mimo lokalnych zmian do wysłania", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA], shows: [], deleted: [nagrobek(DIUNA)] });
    await przegladarka(page, { movies: [INCEPCJA, DIUNA, ARRIVAL], zmianyDoWyslania: true });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);

    expect(await lokalneTytuly(page)).toEqual(["Incepcja", "Nowy początek"]);
    expect(dysk.baza.movies.map((m) => m.title).sort()).toEqual(["Incepcja", "Nowy początek"]);
    expect((dysk.baza.deleted || []).map((u) => u.uuid)).toEqual(["m-2"]);
  });

  test("film dodany ponownie po usunięciu zostaje (nowy wpis ma nowy uuid)", async ({ page }) => {
    const dodanaPonownie = { ...DIUNA, uuid: "m-2-nowy" };
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA, dodanaPonownie], shows: [], deleted: [nagrobek(DIUNA)] });
    await przegladarka(page, { movies: [INCEPCJA, DIUNA], zmianyDoWyslania: true });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);

    expect(await lokalneTytuly(page)).toEqual(["Diuna", "Incepcja"]);
    expect(dysk.baza.movies.map((m) => m.uuid).sort()).toEqual(["m-1", "m-2-nowy"]);
  });
});

test.describe("Dysk Google: scalanie paruje wpisy jeden do jednego", () => {
  test.use({ serviceWorkers: "block" });

  // Znalezione na prawdziwej bibliotece: dwa wpisy tego samego serialu (polski i oryginalny
  // tytuł, ten sam tmdb_id, różne uuid). Scalenie parowało oba lokalne wpisy z PIERWSZYM
  // wpisem z Dysku — jeden wpis znikał, a drugi trafiał na Dysk dwa razy z tym samym uuid.
  const WPIS_PL = { ...DIUNA, uuid: "m-pl", title: "Diuna" };
  const WPIS_EN = { ...DIUNA, uuid: "m-en", title: "Dune" };

  test("biblioteka scalona z samą sobą zostaje bez zmian, także przy dwóch wpisach o tym samym tmdb_id", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });

    const wynik = await page.evaluate(([pl, en]) => {
      const serial = (uuid, title) => ({ uuid, title, tmdb_id: 90228, status: "watching", episodes_watched: [{ season: 1, episode: 1 }] });
      const filmy = () => [{ ...pl }, { ...en }];
      const seriale = () => [serial("s-pl", "Diuna: Proroctwo"), serial("s-en", "Dune: Prophecy")];
      const scalona = window.googleDriveSync.mergeLibraries(filmy(), seriale(), filmy(), seriale());
      const opis = (lista) => lista.map((x) => `${x.uuid}:${x.title}`);
      return { filmy: opis(scalona.movies), seriale: opis(scalona.shows) };
    }, [WPIS_PL, WPIS_EN]);

    expect(wynik.filmy).toEqual(["m-pl:Diuna", "m-en:Dune"]);
    expect(wynik.seriale).toEqual(["s-pl:Diuna: Proroctwo", "s-en:Dune: Prophecy"]);
  });

  test("synchronizacja z czekającą zmianą nie gubi ani nie dubluje wpisów o tym samym tmdb_id", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA, WPIS_PL, WPIS_EN], shows: [] });
    await przegladarka(page, { movies: [{ ...INCEPCJA, is_favorite: true }, WPIS_PL, WPIS_EN], zmianyDoWyslania: true });

    await page.goto("/?mode=movies");
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);

    const opis = (lista) => lista.map((m) => `${m.uuid}:${m.title}`).sort();
    expect(opis(dysk.baza.movies), "na Dysku").toEqual(["m-1:Incepcja", "m-en:Dune", "m-pl:Diuna"]);
    expect(dysk.baza.movies.find((m) => m.uuid === "m-1").is_favorite).toBe(true);
    const lokalne = await page.evaluate(() => JSON.parse(localStorage.getItem("cinelog_database")).movies.map((m) => `${m.uuid}:${m.title}`).sort());
    expect(lokalne, "w przeglądarce").toEqual(["m-1:Incepcja", "m-en:Dune", "m-pl:Diuna"]);
  });

  test("wpis lokalny bez pary po uuid nie zabiera wpisu, który ma już swoją parę", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });

    // Na Dysku jest tylko wpis „pl"; tutaj doszedł drugi wpis tego samego tytułu („en"),
    // ustawiony na liście PRZED „pl".
    const wynik = await page.evaluate(([pl, en]) => {
      const scalona = window.googleDriveSync.mergeLibraries([{ ...en }, { ...pl, rating: 9 }], [], [{ ...pl }], []);
      return scalona.movies.map((m) => `${m.uuid}:${m.title}:${m.rating}`);
    }, [WPIS_PL, WPIS_EN]);

    expect(wynik).toEqual(["m-pl:Diuna:9", "m-en:Dune:null"]);
  });

  test("wpis poprawiony przez rematch (ten sam uuid, inny tmdb_id) zastępuje starą wersję z Dysku", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(1, { timeout: 10_000 });

    const wynik = await page.evaluate((zDysku) => {
      const poRematchu = { ...zDysku, tmdb_id: 841, title: "Diuna (1984)" };
      const scalona = window.googleDriveSync.mergeLibraries([poRematchu], [], [zDysku], []);
      return scalona.movies.map((m) => `${m.uuid}:${m.tmdb_id}:${m.title}`);
    }, DIUNA);

    expect(wynik, "błędne dopasowanie nie może wrócić z Dysku jako drugi wpis o tym samym uuid").toEqual(["m-2:841:Diuna (1984)"]);
  });
});

test.describe("Dysk Google: scalanie wie, kto co zmienił", () => {
  test.use({ serviceWorkers: "block" });

  // Scalanie było sumą: serce „którekolwiek", ocena „lokalna, jeśli jest", odcinki „wszystkie".
  // Cofnięcie (odznaczone serce, wyczyszczona ocena, odznaczony odcinek), które nie zdążyło się
  // wysłać, wracało z Dysku, a stare wartości z tej przeglądarki cofały zmiany z drugiego urządzenia.
  const ULUBIONA = { ...INCEPCJA, is_favorite: true, rating: 6 };

  const kliknijSerce = async (page, uuid) => {
    await page.locator(`#m3-movies-grid article.m3-card:has(.m3-card-fav-btn[data-uuid="${uuid}"])`).click();
    await expect(page.locator("#m3-sheet-movie-detail")).toHaveClass(/active/);
    await page.locator("#m3-detail-fav-btn").click();
  };
  const otworz = async (page, liczbaKart) => {
    await page.goto("/?mode=movies");
    await expect(page.locator("#m3-movies-grid article.m3-card")).toHaveCount(liczbaKart, { timeout: 10_000 });
    await expect(page.locator("#m3-drive-status-text")).not.toHaveText(/Synchronizuj|Zapisuj/);
  };
  const lokalnyFilm = (page, uuid) =>
    page.evaluate((u) => JSON.parse(localStorage.getItem("cinelog_database")).movies.find((m) => m.uuid === u), uuid);

  test("odznaczone serce, które nie zdążyło się wysłać, nie wraca z Dysku", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [ULUBIONA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [ULUBIONA, DIUNA] });
    await otworz(page, 2);

    dysk.awaria.wysylka = 503;
    await kliknijSerce(page, "m-1");
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(dysk.baza.movies[0].is_favorite, "awaria: na Dysku stara wartość").toBe(true);

    dysk.awaria.wysylka = null;
    await page.reload();
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(dysk.baza.movies.find((m) => m.uuid === "m-1").is_favorite, "na Dysku").toBe(false);
    expect((await lokalnyFilm(page, "m-1")).is_favorite, "w przeglądarce").toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("gdrive_stan_bazowy")), "po wysłaniu nie ma czego pamiętać").toBeNull();
  });

  test("zmiana z drugiego urządzenia nie jest cofana przez starą wartość z tej przeglądarki", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [ULUBIONA, DIUNA], shows: [] });
    await przegladarka(page, { movies: [ULUBIONA, DIUNA] });
    await otworz(page, 2);

    dysk.awaria.wysylka = 503;
    await kliknijSerce(page, "m-2"); // tutaj: serce na „Diunie"
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(0);
    // drugie urządzenie w tym czasie: nowa ocena „Incepcji" i zdjęte serce
    dysk.baza = { movies: [{ ...ULUBIONA, rating: 9, is_favorite: false }, DIUNA], shows: [] };

    dysk.awaria.wysylka = null;
    await page.reload();
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const opis = (m) => `${m.title}: ocena ${m.rating}, serce ${m.is_favorite}`;
    expect(dysk.baza.movies.map(opis)).toEqual(["Incepcja: ocena 9, serce false", "Diuna: ocena null, serce true"]);
    expect(opis(await lokalnyFilm(page, "m-1"))).toBe("Incepcja: ocena 9, serce false");
  });

  test("ten sam film zmieniony na obu urządzeniach: każde pole od tego, kto je zmienił", async ({ page }) => {
    const dysk = await atrapaDysku(page, { movies: [ULUBIONA], shows: [] });
    await przegladarka(page, { movies: [ULUBIONA] });
    await otworz(page, 1);

    dysk.awaria.wysylka = 503;
    await kliknijSerce(page, "m-1"); // tutaj: zdjęte serce
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(0);
    dysk.baza = { movies: [{ ...ULUBIONA, rating: 9 }], shows: [] }; // tam: nowa ocena

    // Pierwsze scalenie nie dochodzi na Dysk…
    await page.reload();
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(1);
    await expect.poll(async () => (await lokalnyFilm(page, "m-1")).rating).toBe(9);
    // …a drugie urządzenie zmienia ocenę jeszcze raz.
    dysk.baza = { movies: [{ ...ULUBIONA, rating: 10 }], shows: [] };

    dysk.awaria.wysylka = null;
    await page.reload();
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const naDysku = dysk.baza.movies[0];
    expect(`ocena ${naDysku.rating}, serce ${naDysku.is_favorite}`).toBe("ocena 10, serce false");
  });

  test("cofnięty odcinek i wyczyszczona ocena nie wracają, a odcinek z drugiego urządzenia dochodzi", async ({ page }) => {
    await atrapaDysku(page, { movies: [INCEPCJA], shows: [] });
    await przegladarka(page, { movies: [INCEPCJA] });
    await otworz(page, 1);

    const wynik = await page.evaluate(() => {
      const odc = (season, episode) => ({ season, episode });
      const serial = (odcinki, rating) => ({ uuid: "s-1", title: "Serial", tmdb_id: 1, status: "watching", rating, episodes_watched: odcinki });
      const bazowy = serial([odc(1, 1), odc(1, 2), odc(1, 3)], 8);
      const tutaj = serial([odc(1, 1), odc(1, 2)], null); // cofnięty 1x3, wyczyszczona ocena
      const naDysku = serial([odc(1, 1), odc(1, 2), odc(1, 3), odc(1, 4)], 8); // tam obejrzany 1x4
      const scalona = window.googleDriveSync.mergeLibraries([], [tutaj], [], [naDysku], [], [], { "s-1": bazowy });
      const s = scalona.shows[0];
      return { odcinki: s.episodes_watched.map((o) => `${o.season}x${o.episode}`), ocena: s.rating, licznik: s.watched_count, postep: s.latest_progress };
    });

    expect(wynik).toEqual({ odcinki: ["1x1", "1x2", "1x4"], ocena: null, licznik: 3, postep: "S01E04" });
  });

  test("zmiany czekające sprzed śledzenia scalają się po staremu, a nowa edycja tego nie zmienia", async ({ page }) => {
    // Znacznik „do wysłania" bez zapamiętanego stanu bazowego (zmiana z wcześniejszej wersji aplikacji):
    // nie wiadomo, co zmieniono, więc nic z tej przeglądarki nie może przegrać z Dyskiem.
    const dysk = await atrapaDysku(page, { movies: [INCEPCJA, DIUNA], shows: [] });
    dysk.awaria.wysylka = 503;
    await przegladarka(page, { movies: [{ ...INCEPCJA, is_favorite: true }, DIUNA], zmianyDoWyslania: true });
    await otworz(page, 2);
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(0);

    const proby = dysk.probyWysylki;
    await kliknijSerce(page, "m-2");
    await expect.poll(() => dysk.probyWysylki, { timeout: 10_000 }).toBeGreaterThan(proby);

    dysk.awaria.wysylka = null;
    await page.reload();
    await expect.poll(() => dysk.wysylki.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(dysk.baza.movies.map((m) => `${m.title}: ${m.is_favorite}`)).toEqual(["Incepcja: true", "Diuna: true"]);
  });
});
