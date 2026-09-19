import { test, expect } from "@playwright/test";
import fs from "node:fs";

// Regresja (audyt D6): przełączenie na "Serwer Flask" nadpisywało bibliotekę użytkownika
// bez ostrzeżenia, a pierwsza edycja w tym trybie wypychała bazę serwera do Google Drive,
// kasując bibliotekę w chmurze. Ten spec pilnuje trzech barier: zgody przed przełączeniem,
// osobnego klucza dla bazy serwera i kopii zapisanej przed nadpisaniem.

const BIBLIOTEKA_UZYTKOWNIKA = {
  movies: [{ id: 1, title: "Mój film A" }, { id: 2, title: "Mój film B" }],
  shows: [{ id: 3, title: "Mój serial" }],
  updated_at: "2026-01-01T00:00:00.000Z",
};

const przygotujBiblioteke = async (page, db = BIBLIOTEKA_UZYTKOWNIKA) => {
  await page.addInitScript((zawartosc) => {
    localStorage.setItem("cinelog_database", JSON.stringify(zawartosc));
    localStorage.setItem("cinelog_active_mode", "client");
    localStorage.setItem("cinelog_user_imported", "true");
  }, db);
  // Bez sieci do Drive: test nie może niczego zapisać w prawdziwej chmurze.
  await page.route("https://www.googleapis.com/**", (r) => r.abort());
  await page.goto("/");
  await page.waitForTimeout(2500); // sonda /api/* ustawia backendAvailable
};

const stanLokalny = (page) =>
  page.evaluate(() => {
    const wczytaj = (klucz) => JSON.parse(localStorage.getItem(klucz) || "null");
    return {
      tryb: localStorage.getItem("cinelog_active_mode"),
      biblioteka: wczytaj("cinelog_database"),
      bazaSerwera: wczytaj("cinelog_database_server"),
      kopia: wczytaj("cinelog_database_backup"),
    };
  });

test.describe("Bezpieczeństwo danych przy zmianie trybu", () => {
  test.use({ serviceWorkers: "block" });

  test("tryb Flask pyta o zgodę i nie nadpisuje biblioteki użytkownika", async ({ page }) => {
    await przygotujBiblioteke(page);

    await page.evaluate(() => document.getElementById("m3-btn-switch-flask").click());
    await expect(page.locator("#m3-confirm-dialog-modal")).toBeVisible();
    // Przed potwierdzeniem nic się nie dzieje — sama zmiana trybu wymaga zgody.
    expect((await stanLokalny(page)).tryb).toBe("client");

    await page.evaluate(() => document.getElementById("m3-dialog-btn-confirm").click());
    await page.waitForTimeout(3000);
    const stan = await stanLokalny(page);

    expect(stan.tryb).toBe("flask");
    expect(stan.biblioteka.movies.map((m) => m.title)).toEqual(["Mój film A", "Mój film B"]);
    expect(stan.biblioteka.shows).toHaveLength(1);
    expect(stan.bazaSerwera, "baza serwera trafia do osobnego klucza").not.toBeNull();
    expect(stan.kopia, "kopia biblioteki przed nadpisaniem").not.toBeNull();
    expect(stan.kopia.movies).toHaveLength(2);
  });

  test("powrót na tryb klienta sam odtwarza bibliotekę użytkownika", async ({ page }) => {
    await przygotujBiblioteke(page);

    await page.evaluate(() => document.getElementById("m3-btn-switch-flask").click());
    await page.evaluate(() => document.getElementById("m3-dialog-btn-confirm").click());
    await page.waitForTimeout(3000);
    await page.evaluate(() => document.getElementById("m3-btn-switch-client").click());
    await page.waitForTimeout(2500);

    const stan = await stanLokalny(page);
    expect(stan.tryb).toBe("client");
    expect(stan.biblioteka.movies.map((m) => m.title)).toEqual(["Mój film A", "Mój film B"]);
    expect(stan.biblioteka.shows).toHaveLength(1);
  });

  test("Push wysyła bibliotekę razem z ustawieniami VOD", async ({ page }) => {
    await przygotujBiblioteke(page, {
      movies: [{ id: 1, title: "Film" }],
      shows: [],
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    // Podmieniamy wyłącznie wysyłkę (sieć), logika przycisku zostaje produkcyjna.
    await page.evaluate(() => {
      window.__wyslane = [];
      window.googleDriveSync.uploadToDrive = async (movies, shows) => {
        window.__wyslane.push({ co: "baza", filmy: (movies || []).length, seriale: (shows || []).length });
        return true;
      };
      window.googleDriveSync.uploadSettingsToDrive = async (country, subscriptions) => {
        window.__wyslane.push({ co: "ustawienia", kraj: country, subskrypcje: (subscriptions || []).length });
        return true;
      };
    });

    await page.evaluate(() => document.getElementById("m3-btn-gdrive-push").click());
    await expect
      .poll(() => page.evaluate(() => (window.__wyslane || []).length), { timeout: 10000 })
      .toBe(2);

    const wyslane = await page.evaluate(() => window.__wyslane);
    expect(wyslane[0]).toMatchObject({ co: "baza", filmy: 1 });
    expect(wyslane[1].co).toBe("ustawienia");
    expect(wyslane[1].kraj).toBeTruthy();
  });

  test("bez kopii przycisk nie udaje przywracania", async ({ page }) => {
    await przygotujBiblioteke(page);

    await page.evaluate(() => {
      localStorage.removeItem("cinelog_database_backup");
      document.getElementById("m3-btn-restore-backup").click();
    });
    await page.waitForTimeout(800);

    expect(await page.locator("#m3-confirm-dialog-modal").count()).toBe(0);
    expect((await stanLokalny(page)).biblioteka.movies).toHaveLength(2);
  });

  test("przycisk przywracania cofa nadpisanie biblioteki", async ({ page }) => {
    await przygotujBiblioteke(page);

    // Kopia w formacie, jaki zapisuje zapiszKopieBazy() — biblioteka sprzed nadpisania.
    await page.evaluate((db) => {
      localStorage.setItem(
        "cinelog_database_backup",
        JSON.stringify({ ...db, saved_at: "2026-01-01T00:00:00.000Z", source: "test" })
      );
      // Symulujemy nadpisanie biblioteki (jak po Pullu z chmury bez kopii).
      localStorage.setItem("cinelog_database", JSON.stringify({ movies: [], shows: [], updated_at: new Date().toISOString() }));
    }, BIBLIOTEKA_UZYTKOWNIKA);
    await page.reload();
    await page.waitForTimeout(2500);

    await page.evaluate(() => document.getElementById("m3-btn-restore-backup").click());
    await expect(page.locator("#m3-confirm-dialog-modal")).toBeVisible();
    await page.evaluate(() => document.getElementById("m3-dialog-btn-confirm").click());
    await page.waitForTimeout(2000);

    const stan = await stanLokalny(page);
    expect(stan.biblioteka.movies.map((m) => m.title)).toEqual(["Mój film A", "Mój film B"]);
    expect(stan.kopia, "kopia jest jednorazowa — po przywróceniu znika").toBeNull();
  });
});

// Regresja: przycisk "Pobierz kopię JSON" był zwykłym linkiem do /api/export,
// więc na hostingu statycznym (GitHub Pages) prowadził do 404 i przeglądarka
// pokazywała "plik nie był dostępny w witrynie", a przy działającym backendzie
// pobierał bazę serwera zamiast biblioteki użytkownika.
test.describe("Kopia biblioteki: pobieranie i podpowiedź", () => {
  test.use({ serviceWorkers: "block" });

  test("pobranie kopii JSON daje bibliotekę użytkownika, nie bazę serwera", async ({ page }) => {
    await przygotujBiblioteke(page);

    const pobraniePromise = page.waitForEvent("download", { timeout: 15000 });
    await page.evaluate(() => {
      // Przycisk siedzi w arkuszu chmury — otwieramy go tak, jak użytkownik.
      if (typeof window.openCloudSyncModal === "function") window.openCloudSyncModal();
      document.getElementById("m3-btn-export-backup").click();
    });
    const pobranie = await pobraniePromise;

    expect(pobranie.suggestedFilename()).toMatch(/^cinelog_export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json$/);
    const zawartosc = JSON.parse(fs.readFileSync(await pobranie.path(), "utf-8"));
    expect(zawartosc.movies.map((m) => m.title)).toEqual(["Mój film A", "Mój film B"]);
    expect(zawartosc.shows).toHaveLength(1);
    expect(typeof zawartosc.exported_at).toBe("string");
  });

  test("po imporcie z pliku podpowiedź pokazuje zapisaną kopię", async ({ page }, testInfo) => {
    await przygotujBiblioteke(page);

    const plik = testInfo.outputPath("do-importu.json");
    fs.writeFileSync(plik, JSON.stringify({ movies: [{ uuid: "import-1", title: "Z importu" }], shows: [] }));

    await page.setInputFiles("#m3-importer-file-input", plik);
    await expect
      .poll(async () => (await stanLokalny(page)).kopia?.movies?.length ?? -1, { timeout: 10000 })
      .toBe(2);

    const podpowiedz = await page.evaluate(
      () => (document.getElementById("m3-restore-backup-hint") || {}).textContent || ""
    );
    expect(podpowiedz).toMatch(/Kopia z/);
    expect(podpowiedz).toContain("2 filmów");
  });
});
