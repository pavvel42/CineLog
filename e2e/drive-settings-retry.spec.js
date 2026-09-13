import { test, expect } from "@playwright/test";

// Regresja: zapis ustawień VOD na Dysku Google potrafi się nie udać raz na kilka
// przebiegów (zaobserwowane 1 na 4) — najczęściej przez nieaktualny identyfikator
// pliku (`gdrive_settings_file_id`) albo chwilowy błąd Drive. Jedna próba zostawiała
// ustawienia tylko lokalnie; teraz `uploadSettingsToDrive` ponawia po odświeżeniu
// identyfikatora, szukając pliku po nazwie.

const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const USTAWIENIA_ID = "settings-test-1";

test.describe("zapis ustawień na Dysku Google", () => {
  test.use({ serviceWorkers: "block" });

  test("ponawia zapis, gdy pierwsza próba padnie", async ({ page }) => {
    const zapisy = [];
    const wyszukiwaniaPoNazwie = [];

    await page.route("https://www.googleapis.com/**", async (route) => {
      const req = route.request();
      const url = req.url();

      if (req.method() === "PATCH" || req.method() === "POST") {
        zapisy.push(url);
        if (zapisy.length === 1) {
          // Pierwsza próba: Drive odrzuca żądanie.
          return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: 500, message: "Internal Error" } }) });
        }
        return route.fulfill(json({ id: USTAWIENIA_ID, name: "cinelog_settings.json" }));
      }

      if (url.includes("/drive/v3/files?")) {
        // Ponowna próba szuka pliku po nazwie.
        wyszukiwaniaPoNazwie.push(url);
        return route.fulfill(json({ files: [{ id: USTAWIENIA_ID, name: "cinelog_settings.json", modifiedTime: "2026-09-13T10:00:00.000Z" }] }));
      }

      // Weryfikacja zapisanego identyfikatora pliku.
      return route.fulfill(json({ id: USTAWIENIA_ID, name: "cinelog_settings.json", trashed: false }));
    });

    await page.goto("/");

    const wynik = await page.evaluate(async (id) => {
      const g = window.googleDriveSync;
      g.accessToken = "test-token";
      g.tokenExpiresAt = Date.now() + 3600_000; // isAuthorized() === true
      g.settingsFileId = id;
      localStorage.setItem("gdrive_settings_file_id", id);
      return await g.uploadSettingsToDrive("PL", ["HBO Max"]);
    }, USTAWIENIA_ID);

    expect(wynik, "ustawienia nie trafiły na Dysk po ponowieniu").toBe(true);
    expect(zapisy.length, "oczekiwana dokładnie jedna ponowna próba").toBe(2);
    expect(
      wyszukiwaniaPoNazwie.length,
      "ponowna próba musi najpierw odświeżyć identyfikator pliku wyszukaniem po nazwie"
    ).toBeGreaterThan(0);
  });

  test("nie ponawia w kółko, gdy katalog pliku jest poprawny", async ({ page }) => {
    const zapisy = [];
    const wyszukiwaniaPoNazwie = [];
    await page.route("https://www.googleapis.com/**", (route) => {
      const req = route.request();
      if (req.method() === "PATCH" || req.method() === "POST") {
        zapisy.push(req.url());
        return route.fulfill(json({ id: USTAWIENIA_ID }));
      }
      if (req.url().includes("/drive/v3/files?")) {
        wyszukiwaniaPoNazwie.push(req.url());
        return route.fulfill(json({ files: [{ id: USTAWIENIA_ID, name: "cinelog_settings.json" }] }));
      }
      return route.fulfill(json({ id: USTAWIENIA_ID, name: "cinelog_settings.json", trashed: false }));
    });

    await page.goto("/");
    const wynik = await page.evaluate(async (id) => {
      const g = window.googleDriveSync;
      g.accessToken = "test-token";
      g.tokenExpiresAt = Date.now() + 3600_000;
      g.settingsFileId = id;
      localStorage.setItem("gdrive_settings_file_id", id);
      return await g.uploadSettingsToDrive("PL", ["HBO Max"]);
    }, USTAWIENIA_ID);

    expect(wynik).toBe(true);
    expect(zapisy.length, "udany zapis nie może lecieć drugi raz").toBe(1);
    expect(wyszukiwaniaPoNazwie.length, "przy poprawnym identyfikatorze nie ma wyszukiwania po nazwie").toBe(0);
  });
});
