import { test, expect } from "@playwright/test";

// Regresja: identyfikator klienta OAuth trafiał do Google bez żadnej walidacji, więc
// numer projektu, klucz API albo obcięte wklejenie z telefonu kończyły się błędem
// `401 invalid_client` („The OAuth client was not found") — komunikatem, który wygląda
// jak problem z uprawnieniami konta albo listą użytkowników testowych, a mówi tylko
// tyle, że wartość nie jest identyfikatorem klienta.

const POPRAWNY_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com";
const POLE_ID = "#m3-gdrive-client-id";
const PRZYCISK_POLACZ = "#m3-btn-gdrive-connect";
const PRZYCISK_WYCZYSC = "#m3-gdrive-client-id-clear";
const TOAST = "#m3-toast-notification";

/**
 * Stan toastu liczony z przeglądarki — sam tekst w DOM nic nie mówi.
 *
 * Toast jest `position: fixed; opacity: 0; pointer-events: none`, a widoczność włącza
 * klasa; gdy CSS i JS nie zgadzają się co do jej nazwy, komunikat istnieje w DOM
 * i testy `toContainText` przechodzą, ale użytkownik nie widzi nic.
 */
async function stanToastu(page) {
  return page.evaluate(() => {
    const t = document.getElementById("m3-toast-notification");
    if (!t) return { istnieje: false };
    const styl = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    const naWierzchu = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      istnieje: true,
      opacity: styl.opacity,
      pointerEvents: styl.pointerEvents,
      przykryty: !(t === naWierzchu || t.contains(naWierzchu)),
      tekst: t.textContent.trim(),
    };
  });
}

/** Podstawia atrapę połączenia, czyści zapamiętany identyfikator i zeruje config.js. */
async function przygotuj(page) {
  await page.evaluate(() => {
    localStorage.removeItem("gdrive_client_id");
    // Serwer deweloperski wpisuje do config.js identyfikator z .env (run.py), więc
    // w e2e pole bywa wstępnie wypełnione — zerujemy je, żeby o wartości decydował test.
    window.CINELOG_CONFIG = window.CINELOG_CONFIG || {};
    window.CINELOG_CONFIG.GOOGLE_CLIENT_ID = "";
    window.__connectArgs = [];
    window.googleDriveSync = window.googleDriveSync || {};
    // Oryginał zostaje dla testów, które sprawdzają samą ścieżkę łączenia.
    window.__connectOriginal = window.__connectOriginal || window.googleDriveSync.connect.bind(window.googleDriveSync);
    window.googleDriveSync.connect = (...args) => {
      window.__connectArgs.push(args);
    };
  });
}

/**
 * Otwiera okno „Dysk Google" i rozwija sekcję z polem identyfikatora.
 *
 * `openCloudSyncModal` to ta sama funkcja, którą woła przycisk `#m3-btn-open-cloud-sync`
 * (main.js eksportuje ją na `window`), a pole siedzi w zwiniętym `<details>`.
 */
async function otworzOknoDrive(page) {
  await page.goto("/");
  await page.evaluate(() => window.openCloudSyncModal("drive"));
  await przygotuj(page);
  const sekcja = page.locator("details", { hasText: "Opcje deweloperskie" }).first();
  await sekcja.locator("summary").click();
}

test.describe("identyfikator klienta Google OAuth w oknie Drive", () => {
  test.use({ serviceWorkers: "block" });

  test("odrzuca wartość, która nie kończy się na googleusercontent.com", async ({ page }) => {
    await otworzOknoDrive(page);

    // Najczęstsza pomyłka: numer projektu albo klucz API wklejony w to pole.
    await page.fill(POLE_ID, "123456789012-abcdef");
    await page.click(PRZYCISK_POLACZ);

    await expect(page.locator(TOAST)).toContainText("musi kończyć się na .apps.googleusercontent.com");
    expect(await page.evaluate(() => window.__connectArgs.length)).toBe(0);
  });

  test("odrzuca identyfikator z niewidzialnym znakiem", async ({ page }) => {
    await otworzOknoDrive(page);

    // Zero-width space typowo dokleja się przy kopiowaniu na telefonie.
    await page.fill(POLE_ID, `${POPRAWNY_ID}\u200b`);
    await page.click(PRZYCISK_POLACZ);

    await expect(page.locator(TOAST)).toContainText("niewidzialny znak");
    expect(await page.evaluate(() => window.__connectArgs.length)).toBe(0);
  });

  test("przepuszcza poprawny identyfikator i używa wartości z pola", async ({ page }) => {
    await otworzOknoDrive(page);

    await page.fill(POLE_ID, `  ${POPRAWNY_ID}  `);
    await page.click(PRZYCISK_POLACZ);

    const argumenty = await page.evaluate(() => window.__connectArgs);
    expect(argumenty.length).toBe(1);
    expect(argumenty[0][0]).toBe(POPRAWNY_ID);
  });

  test("komunikat o złym identyfikatorze jest faktycznie widoczny nad arkuszem", async ({ page }) => {
    await otworzOknoDrive(page);

    await page.fill(POLE_ID, "123456789012-abcdef");
    await page.click(PRZYCISK_POLACZ);

    // Regresja: CSS widoczność toastu włączał klasą `.active`, a JS dodawał `show`,
    // więc komunikat istniał w DOM (i testy tekstu przechodziły), ale był przezroczysty
    // — z punktu widzenia użytkownika kliknięcie nie robiło nic. Opacity zmienia się
    // z przejściem 0.32 s, więc czekamy na koniec animacji.
    await expect.poll(async () => (await stanToastu(page)).opacity, { timeout: 2_000 }).toBe("1");
    const stan = await stanToastu(page);
    expect(stan.pointerEvents).toBe("auto");
    expect(stan.przykryty).toBe(false);
    expect(stan.tekst).toContain("musi kończyć się na .apps.googleusercontent.com");
  });

  test("gdy biblioteka Google się nie wczyta, użytkownik dostaje komunikat, a nie ciszę", async ({ page }) => {
    await otworzOknoDrive(page);
    // Blokada rozszerzenia, filtr DNS albo brak dostępu do accounts.google.com.
    await page.evaluate(() => {
      window.google = undefined;
      // Wracamy do prawdziwej ścieżki łączenia — atrapa z `przygotuj` ją omija.
      window.googleDriveSync.connect = window.__connectOriginal;
    });
    await page.fill(POLE_ID, POPRAWNY_ID);

    await page.click(PRZYCISK_POLACZ);

    await expect.poll(async () => (await stanToastu(page)).opacity, { timeout: 2_000 }).toBe("1");
    const stan = await stanToastu(page);
    expect(stan.tekst).toContain("Biblioteka Google");
  });

  test("brak identyfikatora nadal daje komunikat o wymaganym Client ID", async ({ page }) => {
    await otworzOknoDrive(page);

    await page.fill(POLE_ID, "");
    await page.click(PRZYCISK_POLACZ);

    await expect(page.locator(TOAST)).toContainText("Wymagany Google OAuth Client ID");
    expect(await page.evaluate(() => window.__connectArgs.length)).toBe(0);
  });

  test("bierze identyfikator z config.js, gdy pole i pamięć są puste", async ({ page }) => {
    await otworzOknoDrive(page);
    // Tak działa serwer deweloperski: run.py wpisuje wartość z .env do config.js.
    await page.evaluate((id) => {
      window.CINELOG_CONFIG.GOOGLE_CLIENT_ID = id;
      localStorage.removeItem("gdrive_client_id");
    }, POPRAWNY_ID);
    await page.fill(POLE_ID, "");

    await page.click(PRZYCISK_POLACZ);

    const argumenty = await page.evaluate(() => window.__connectArgs);
    expect(argumenty.length).toBe(1);
    expect(argumenty[0][0]).toBe(POPRAWNY_ID);
  });

  test("przycisk czyści zapamiętany identyfikator i dane połączenia", async ({ page }) => {
    await otworzOknoDrive(page);

    await page.evaluate(() => {
      localStorage.setItem("gdrive_client_id", "stary-identyfikator");
      localStorage.setItem("gdrive_access_token", "token-poprzedniego-konta");
      localStorage.setItem("gdrive_file_id", "plik-poprzedniego-konta");
      localStorage.setItem("gdrive_settings_file_id", "ustawienia-poprzedniego-konta");
    });
    await page.fill(POLE_ID, "stary-identyfikator");

    await page.click(PRZYCISK_WYCZYSC);

    const stan = await page.evaluate(() => ({
      klucz: localStorage.getItem("gdrive_client_id"),
      token: localStorage.getItem("gdrive_access_token"),
      plik: localStorage.getItem("gdrive_file_id"),
      ustawienia: localStorage.getItem("gdrive_settings_file_id"),
      pole: document.getElementById("m3-gdrive-client-id").value,
    }));

    expect(stan).toEqual({ klucz: null, token: null, plik: null, ustawienia: null, pole: "" });
    await expect(page.locator(TOAST)).toContainText("Wyczyszczono zapamiętany identyfikator");
  });
});
