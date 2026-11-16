// Google Drive BYO-Cloud Database & Settings Synchronization Module (Client-Side REST API)

// Czyste funkcje danych współdzielone z modules/state.js (esbuild bundluje
// wszystko do drive_sync.min.js, więc <script> bez type="module" dalej działa).
import { recalculateShowProgress, taSamaPozycja, pobierzUsuniete, zapiszUsuniete, scalUsuniete, czyUsuniety, pobierzStanBazowy, zapiszStanBazowy, wyczyscStanBazowy } from './modules/state.js';

const DRIVE_DATABASE_FILE_NAME = "cinelog_database.json";
const DRIVE_SETTINGS_FILE_NAME = "cinelog_settings.json";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";
// Zmiany z biblioteki, które jeszcze nie dotarły na Dysk (np. token wygasł).
// "true" = scal z Dyskiem i wyślij; "replace" = biblioteka z przeglądarki zastępuje tę na Dysku
// (przywrócenie kopii, import pliku) — scalenie przywróciłoby to, co użytkownik właśnie cofnął.
const PENDING_UPLOAD_KEY = "gdrive_pending_upload";
const ZAPIS_ZASTEPUJACY = "replace";
const OPOZNIENIE_ZAPISU_MS = 2000;

/**
 * Dysk nie odpowiedział tak, żeby dało się ustalić stan pliku (sieć, HTTP 4xx/5xx, uszkodzona
 * treść). To co innego niż „pliku nie ma": po takim błędzie nie wolno niczego wysyłać.
 */
class BladDysku extends Error {
  /**
   * @param {string} message
   * @param {number} [status] kod HTTP, 0 gdy żądanie w ogóle nie doszło
   */
  constructor(message, status = 0) {
    super(message);
    this.name = "BladDysku";
    this.status = status;
  }
}
// Powrót do aplikacji częściej niż co tyle nie pobiera bazy ponownie.
const MIN_ODSTEP_SYNCHRONIZACJI_MS = 30_000;

class GoogleDriveSync {
  constructor() {
    this.tokenClient = null;
    // Injected by main.js: () => ({ movies, shows }) - replaces legacy window.allMovies/allShows aliases
    this.localLibraryProvider = null;
    this.accessToken = localStorage.getItem("gdrive_access_token") || null;
    this.tokenExpiresAt = parseInt(localStorage.getItem("gdrive_token_exp") || "0", 10);
    this.databaseFileId = localStorage.getItem("gdrive_file_id") || null;
    this.settingsFileId = localStorage.getItem("gdrive_settings_file_id") || null;
    this.lastSyncTime = localStorage.getItem("gdrive_last_sync") || null;
    this.clientId = localStorage.getItem("gdrive_client_id") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.GOOGLE_CLIENT_ID) || "";
    this.isSyncing = false;
    this.debounceTimer = null;
    // Automatyczna synchronizacja: callback podmieniający bibliotekę (main.js).
    this.zastosujBibliotekeZDysku = null;
    this.ostatniaSynchronizacja = 0;
    this.czekaNaGest = false;
  }

  init() {
    this.updateStatusUI();
    // Wygasłego tokenu nie odnawiamy tu: okno Google bez gestu użytkownika blokuje
    // przeglądarka (szczególnie na telefonie). Odnowienie czeka na pierwsze dotknięcie.
    if (this.byloPolaczenie() && !this.isAuthorized()) this.czekajNaGest();
  }

  /** Użytkownik połączył kiedyś aplikację z Dyskiem (token mógł już wygasnąć). */
  byloPolaczenie() {
    return Boolean(this.clientId && (this.accessToken || localStorage.getItem("gdrive_file_id")));
  }

  /** Automatyczna synchronizacja dotyczy tylko własnej biblioteki w trybie klienta. */
  trybPozwalaNaSynchronizacje() {
    const wlasnaBaza = localStorage.getItem("cinelog_user_imported") === "true";
    const tryb = localStorage.getItem("cinelog_active_mode") || (wlasnaBaza ? "client" : "demo");
    return wlasnaBaza && tryb === "client";
  }

  maZmianyDoWyslania() {
    return localStorage.getItem(PENDING_UPLOAD_KEY) === "true";
  }

  /**
   * Czy zapis biblioteki ma zapamiętać wersje wpisów sprzed zmiany (stan bazowy scalania).
   * Te same warunki co wysyłka na Dysk; przy oczekującym zastąpieniu scalania nie będzie.
   */
  sledziZmianyLokalne() {
    return this.byloPolaczenie() && this.trybPozwalaNaSynchronizacje() && this.trybOczekujacegoZapisu() !== ZAPIS_ZASTEPUJACY;
  }

  /**
   * Włącza automatyczną synchronizację: teraz i przy każdym powrocie do aplikacji.
   * @param {(movies: object[], shows: object[]) => void} zastosuj podmienia bibliotekę
   */
  startAutoSync(zastosuj) {
    this.zastosujBibliotekeZDysku = zastosuj;
    if (!this._nasluchPowrotu) {
      this._nasluchPowrotu = true;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible") return;
        if (Date.now() - this.ostatniaSynchronizacja < MIN_ODSTEP_SYNCHRONIZACJI_MS) return;
        this.autoSync();
      });
    }
    return this.autoSync();
  }

  /**
   * Pobiera bazę z Dysku. Bez lokalnych zmian czekających na wysłanie Dysk jest
   * źródłem prawdy (przechodzą też usunięcia z drugiego urządzenia); z takimi
   * zmianami — scalenie i wysłanie wyniku.
   * @returns {Promise<"ok"|"pominieto"|"czeka-na-gest"|"blad">}
   */
  async autoSync() {
    if (!this.trybPozwalaNaSynchronizacje() || !this.byloPolaczenie()) return "pominieto";
    if (!this.isAuthorized()) {
      this.czekajNaGest();
      return "czeka-na-gest";
    }
    if (this.isSyncing) return "pominieto";
    this.isSyncing = true;
    this.ostatniaSynchronizacja = Date.now();
    // Odroczony zapis sprzed synchronizacji wysłałby bibliotekę sprzed scalenia; znacznik
    // zmian do wysłania zostaje, więc te zmiany pójdą na Dysk w scaleniu poniżej.
    this._anulujOdroczonyZapis();
    try {
      if (!this._bibliotekaUzytkownika()) return "pominieto";
      if (this.trybOczekujacegoZapisu() === ZAPIS_ZASTEPUJACY) {
        const doWyslania = this._bibliotekaUzytkownika();
        return (await this.uploadToDrive(doWyslania.movies, doWyslania.shows)) ? "ok" : "blad";
      }

      // Rzuca BladDysku, gdy stanu pliku nie da się ustalić — wtedy niczego nie wysyłamy.
      const dysk = await this.downloadFromDrive();
      // Dopiero po pobraniu: w trakcie oczekiwania użytkownik mógł coś zmienić albo zmienić tryb.
      const lokalna = this._bibliotekaUzytkownika();
      if (!lokalna) return "pominieto";
      const lokalnaMaDane = lokalna.movies.length > 0 || lokalna.shows.length > 0;

      if (dysk === null) {
        // Pliku na Dysku na pewno nie ma: pierwsza wysyłka biblioteki użytkownika.
        if (lokalnaMaDane) await this.uploadToDrive(lokalna.movies, lokalna.shows);
        return "ok";
      }

      const filmyDysku = dysk.movies || [];
      const serialeDysku = dysk.shows || [];
      const usunieteDysku = Array.isArray(dysk.deleted) ? dysk.deleted : [];
      if (this.maZmianyDoWyslania()) {
        const bazowe = pobierzStanBazowy();
        const scalona = this.mergeLibraries(lokalna.movies, lokalna.shows, filmyDysku, serialeDysku, pobierzUsuniete(), usunieteDysku, bazowe);
        zapiszUsuniete(scalona.deleted);
        this._zastosuj(scalona.movies, scalona.shows);
        // Gdyby wysyłka poniżej się nie udała: wynik scalenia zawiera już to, co przyszło z Dysku,
        // więc następne scalenie liczy zmiany względem tej wersji z Dysku, a nie starszej.
        if (bazowe) zapiszStanBazowy(this._przebazuj(bazowe, filmyDysku, serialeDysku));
        await this.uploadToDrive(scalona.movies, scalona.shows);
        return "ok";
      }
      if (lokalnaMaDane && filmyDysku.length === 0 && serialeDysku.length === 0) {
        // Pusta baza na Dysku przy niepustej bibliotece to prawie zawsze pomyłka innego
        // urządzenia. Automat niczego nie kasuje — decyzję podejmuje użytkownik w oknie chmury.
        this.updateStatusUI("error", "Baza na Dysku jest pusta — nic nie zmieniono");
        if (window.showToastNotification) {
          window.showToastNotification("Baza na Dysku Google jest pusta, a w tej przeglądarce są filmy lub seriale. Niczego nie zmieniłem — w oknie chmury wybierz „Wyślij do Chmury” albo „Pobierz z Chmury”.", "warning");
        }
        return "ok";
      }
      zapiszUsuniete(usunieteDysku);
      if (JSON.stringify([lokalna.movies, lokalna.shows]) !== JSON.stringify([filmyDysku, serialeDysku])) {
        this._zastosuj(filmyDysku, serialeDysku);
      }
      return "ok";
    } catch (err) {
      console.warn("CineLog: automatyczna synchronizacja z Dyskiem nie powiodła się", err);
      this.updateStatusUI("error", "Błąd synchronizacji z Dyskiem — nic nie zmieniono");
      return "blad";
    } finally {
      this.isSyncing = false;
    }
  }

  _zastosuj(movies, shows) {
    if (typeof this.zastosujBibliotekeZDysku === "function") this.zastosujBibliotekeZDysku(movies, shows);
  }

  /**
   * Biblioteka użytkownika z pamięci karty albo null, gdy karta trzyma bazę demo lub serwera
   * (te nigdy nie trafiają na Dysk).
   * @returns {{movies: object[], shows: object[]}|null}
   */
  _bibliotekaUzytkownika() {
    if (!this.trybPozwalaNaSynchronizacje() || typeof this.localLibraryProvider !== "function") return null;
    const lokalna = this.localLibraryProvider();
    if (!lokalna || (lokalna.tryb && lokalna.tryb !== "client")) return null;
    return {
      movies: Array.isArray(lokalna.movies) ? lokalna.movies : [],
      shows: Array.isArray(lokalna.shows) ? lokalna.shows : []
    };
  }

  /** @returns {"true"|"replace"|null} */
  trybOczekujacegoZapisu() {
    return localStorage.getItem(PENDING_UPLOAD_KEY);
  }

  _anulujOdroczonyZapis() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  _zaplanujZapis() {
    this._anulujOdroczonyZapis();
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this._wyslijAktualnaBiblioteke();
    }, OPOZNIENIE_ZAPISU_MS);
  }

  /** Wysyła bibliotekę w stanie z chwili wysyłki (nie z chwili edycji, która ją zaplanowała). */
  async _wyslijAktualnaBiblioteke() {
    if (this.isSyncing) {
      this._zaplanujZapis();
      return false;
    }
    const lokalna = this._bibliotekaUzytkownika();
    if (!lokalna) return false;
    return this.uploadToDrive(lokalna.movies, lokalna.shows);
  }

  /**
   * Biblioteka z przeglądarki ma zastąpić tę na Dysku, bez scalania (przywrócenie kopii,
   * import pliku). Gdy wysyłka teraz się nie uda, zastąpi ją najbliższa synchronizacja.
   * @returns {Promise<boolean>} true, gdy biblioteka jest już na Dysku
   */
  async zastapNaDysku() {
    if (!this.byloPolaczenie() || !this._bibliotekaUzytkownika()) return false;
    this._anulujOdroczonyZapis();
    localStorage.setItem(PENDING_UPLOAD_KEY, ZAPIS_ZASTEPUJACY);
    wyczyscStanBazowy();
    if (!this.isAuthorized()) {
      this.czekajNaGest();
      return false;
    }
    const lokalna = this._bibliotekaUzytkownika();
    return this.uploadToDrive(lokalna.movies, lokalna.shows);
  }

  _uniewaznijToken() {
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    localStorage.removeItem("gdrive_access_token");
    localStorage.removeItem("gdrive_token_exp");
  }

  /**
   * Żądanie do API Dysku z tokenem. Brak odpowiedzi to BladDysku, a nie „pusty wynik".
   * @param {string} url
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async _zadanie(url, init = {}) {
    let res;
    try {
      res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${this.accessToken}` } });
    } catch (e) {
      throw new BladDysku(`brak połączenia z Dyskiem Google (${e && e.message ? e.message : "błąd sieci"})`);
    }
    // Token odwołany albo unieważniony przed czasem: następna próba poprosi o nowy.
    if (res.status === 401) this._uniewaznijToken();
    return res;
  }

  /**
   * Token wygasł (żyje godzinę). Google pozwala go odnowić tylko w reakcji na gest
   * użytkownika, więc czekamy na pierwsze dotknięcie i wtedy synchronizujemy.
   */
  czekajNaGest() {
    this.updateStatusUI("expired");
    if (this.czekaNaGest) return;
    this.czekaNaGest = true;
    const wznow = () => {
      document.removeEventListener("pointerdown", wznow, true);
      document.removeEventListener("keydown", wznow, true);
      this.czekaNaGest = false;
      this.ensureValidToken().then((ok) => {
        if (ok) this.autoSync();
        else this.czekajNaGest();
      });
    };
    document.addEventListener("pointerdown", wznow, true);
    document.addEventListener("keydown", wznow, true);
  }

  isAuthorized() {
    return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt);
  }

  async ensureValidToken() {
    if (this.isAuthorized()) return true;
    if (!this.clientId) return false;

    return new Promise((resolve) => {
      if (!this.tokenClient && window.google && window.google.accounts) {
        this.initTokenClient(this.clientId);
      }
      if (this.tokenClient) {
        this.tokenClient.callback = (tokenResponse) => {
          if (tokenResponse && tokenResponse.access_token) {
            this.accessToken = tokenResponse.access_token;
            const expiresIn = (parseInt(tokenResponse.expires_in, 10) || 3600) * 1000;
            this.tokenExpiresAt = Date.now() + expiresIn - 60000;

            localStorage.setItem("gdrive_access_token", this.accessToken);
            localStorage.setItem("gdrive_token_exp", this.tokenExpiresAt.toString());

            this.updateStatusUI("connected", "Połączono z Google Drive");
            if (window.updateDriveModalUI) window.updateDriveModalUI();
            resolve(true);
          } else {
            resolve(false);
          }
        };
        try {
          this.tokenClient.requestAccessToken({ prompt: "" });
        } catch (e) {
          resolve(false);
        }
      } else {
        resolve(false);
      }
    });
  }

  initTokenClient(clientId, callback) {
    if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
      console.warn("Google Identity Services script not loaded yet.");
      return false;
    }

    this.clientId = clientId;
    localStorage.setItem("gdrive_client_id", clientId);

    try {
      this.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPES,
        // Bez tego zamknięcie okna albo zablokowany popup kończyły się ciszą:
        // kliknięcie „Zaloguj się przez konto Google” nie robiło nic widocznego.
        error_callback: (err) => {
          console.error("Auth error_callback:", err);
          const powod = (err && err.type) ? err.type : "nieznany powód";
          if (window.showToastNotification) {
            window.showToastNotification(`Logowanie Google nie doszło do skutku (${powod}). Spróbuj ponownie, a jeśli okno się nie otwiera — sprawdź blokadę wyskakujących okien dla tej strony.`, "error");
          }
          this.updateStatusUI("error", "Błąd autoryzacji Google");
        },
        callback: (tokenResponse) => {
          if (tokenResponse.error !== undefined) {
            console.error("Auth error:", tokenResponse);
            this.updateStatusUI("error", "Błąd autoryzacji Google");
            if (window.showToastNotification) {
              window.showToastNotification(`Google odrzuciło logowanie (${tokenResponse.error}).`, "error");
            }
            return;
          }

          this.accessToken = tokenResponse.access_token;
          const expiresIn = (parseInt(tokenResponse.expires_in, 10) || 3600) * 1000;
          this.tokenExpiresAt = Date.now() + expiresIn - 60000; // 1 min buffer

          localStorage.setItem("gdrive_access_token", this.accessToken);
          localStorage.setItem("gdrive_token_exp", this.tokenExpiresAt.toString());

          this.updateStatusUI("connected", "Połączono z Google Drive");
          if (window.updateDriveModalUI) window.updateDriveModalUI();

          if (this.onAuthSuccess) {
            this.syncWithDrive(this.onAuthSuccess);
          } else if (callback) {
            callback();
          }
        },
      });
      return true;
    } catch (e) {
      // Np. identyfikator odrzucony przez samą bibliotekę: wyjątek leciał w górę
      // i kończył się tym, że kliknięcie nie robiło nic widocznego.
      console.error("initTokenClient failed:", e);
      this.tokenClient = null;
      return false;
    }
  }

  connect(clientId, onSuccess, onError) {
    this.onAuthSuccess = onSuccess;
    const gotowy = this.initTokenClient(clientId, () => {
      this.syncWithDrive(onSuccess);
      if (window.updateDriveModalUI) window.updateDriveModalUI();
    });

    if (!gotowy) {
      // Biblioteka GIS bywa niedostępna (blokada rozszerzenia, filtr DNS, brak dostępu
      // do accounts.google.com) — wcześniej kończyło się to tylko ostrzeżeniem w konsoli.
      if (typeof onError === "function") {
        onError("Biblioteka Google (Identity Services) nie została wczytana. Odśwież stronę i spróbuj ponownie; jeśli błąd wraca, sprawdź, czy blokada skryptów nie odcina accounts.google.com.");
      }
      return;
    }

    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: "consent" });
    }
  }

  disconnect() {
    if (this.accessToken && window.google && window.google.accounts) {
      try {
        google.accounts.oauth2.revoke(this.accessToken, () => {});
      } catch (e) { console.debug("CineLog: Drive: odwołanie tokenu Google nie powiodło się", e); }
    }
    this.accessToken = null;
    this.tokenExpiresAt = 0;
    this.databaseFileId = null;
    this.settingsFileId = null;
    this.lastSyncTime = null;

    localStorage.removeItem("gdrive_access_token");
    localStorage.removeItem("gdrive_token_exp");
    localStorage.removeItem("gdrive_file_id");
    localStorage.removeItem("gdrive_settings_file_id");
    localStorage.removeItem("gdrive_last_sync");
    wyczyscStanBazowy();

    this.updateStatusUI("disconnected");
  }

  /**
   * Szuka pliku aplikacji na Dysku.
   * @returns {Promise<string|null>} identyfikator albo null, gdy pliku na pewno nie ma
   * @throws {BladDysku} gdy nie da się tego ustalić (sieć, HTTP inne niż 200/404)
   */
  async findFileByName(fileName, cachedIdKey) {
    const cachedId = localStorage.getItem(cachedIdKey);
    if (cachedId) {
      const checkRes = await this._zadanie(`https://www.googleapis.com/drive/v3/files/${cachedId}?fields=id,name,trashed`);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (!checkData.trashed && checkData.name === fileName) return cachedId;
      } else if (checkRes.status !== 404) {
        throw new BladDysku(`Dysk Google odpowiedział HTTP ${checkRes.status} przy sprawdzaniu pliku ${fileName}`, checkRes.status);
      }
      // Plik skasowany, w koszu albo o innej nazwie: zapamiętany identyfikator jest nieaktualny.
      localStorage.removeItem(cachedIdKey);
    }

    const q = encodeURIComponent(`name = '${fileName}' and trashed = false`);
    const searchRes = await this._zadanie(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`);
    if (!searchRes.ok) {
      throw new BladDysku(`Dysk Google odpowiedział HTTP ${searchRes.status} przy szukaniu pliku ${fileName}`, searchRes.status);
    }
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      const foundId = data.files[0].id;
      localStorage.setItem(cachedIdKey, foundId);
      return foundId;
    }
    return null;
  }

  // --- DATABASE SYNC (cinelog_database.json) ---
  /**
   * Pobiera bibliotekę z Dysku.
   * @returns {Promise<object|null>} treść pliku albo null, gdy pliku na Dysku na pewno nie ma
   * @throws {BladDysku} gdy pliku nie udało się odczytać — wtedy NIE wolno uznać Dysku za pusty
   */
  async downloadFromDrive() {
    await this.ensureValidToken();
    if (!this.isAuthorized()) throw new BladDysku("brak ważnego logowania do Dysku Google", 401);

    try {
      const fileId = await this.findFileByName(DRIVE_DATABASE_FILE_NAME, "gdrive_file_id");
      if (!fileId) return null;

      this.updateStatusUI("syncing", "Pobieram bazę z Dysku...");
      const res = await this._zadanie(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
      if (!res.ok) throw new BladDysku(`Dysk Google odpowiedział HTTP ${res.status} przy pobieraniu bazy`, res.status);

      let payload;
      try {
        payload = await res.json();
      } catch (e) {
        throw new BladDysku("plik bazy na Dysku Google nie jest poprawnym plikiem JSON");
      }
      if (!payload || typeof payload !== "object" || !(Array.isArray(payload.movies) || Array.isArray(payload.shows))) {
        throw new BladDysku("plik bazy na Dysku Google nie zawiera biblioteki CineLog");
      }

      this.databaseFileId = fileId;
      this.lastSyncTime = new Date().toISOString();
      localStorage.setItem("gdrive_last_sync", this.lastSyncTime);
      this.updateStatusUI("connected", "Baza pobrana z Google Drive");
      return payload;
    } catch (err) {
      console.error("Error downloading database from Drive:", err);
      this.updateStatusUI("error", "Błąd pobierania bazy z Dysku");
      throw err instanceof BladDysku ? err : new BladDysku(err && err.message ? err.message : "nieznany błąd");
    }
  }

  /**
   * Zapisuje bibliotekę na Dysku razem z listą usunięć (zastępuje treść pliku).
   * @returns {Promise<boolean>} true, gdy plik został zapisany
   */
  async uploadToDrive(movies, shows) {
    await this.ensureValidToken();
    if (!this.isAuthorized()) return false;

    try {
      this.updateStatusUI("syncing", "Zapisuję na Dysku Google...");
      const payload = {
        app: "CineLog",
        version: "1.0.0",
        synced_at: new Date().toISOString(),
        movies: movies,
        shows: shows,
        deleted: pobierzUsuniete()
      };

      // Rzuca przy błędzie wyszukiwania: bez tego nieudane szukanie zakładało drugi plik bazy.
      const fileId = await this.findFileByName(DRIVE_DATABASE_FILE_NAME, "gdrive_file_id");
      const metadata = {
        name: DRIVE_DATABASE_FILE_NAME,
        mimeType: "application/json"
      };

      let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      let method = "POST";

      if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = "PATCH";
      }

      const boundary = "-------cinelog_drive_boundary_" + Date.now();
      const delimiter = "\r\n--" + boundary + "\r\n";
      const closeDelim = "\r\n--" + boundary + "--";

      const multipartBody =
        delimiter +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        "Content-Type: application/json\r\n\r\n" +
        JSON.stringify(payload, null, 2) +
        closeDelim;

      const res = await this._zadanie(url, {
        method: method,
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body: multipartBody
      });

      if (res.ok) {
        const data = await res.json();
        this.databaseFileId = data.id;
        localStorage.setItem("gdrive_file_id", this.databaseFileId);
        localStorage.removeItem(PENDING_UPLOAD_KEY);
        wyczyscStanBazowy();
        this.lastSyncTime = new Date().toISOString();
        localStorage.setItem("gdrive_last_sync", this.lastSyncTime);
        this.updateStatusUI("connected", "Zsynchronizowano z Google Drive");
        return true;
      }
      console.warn(`Zapis bazy na Dysku nieudany: HTTP ${res.status}`);
      this.updateStatusUI("error", "Błąd zapisu na Dysku");
      if (res.status === 401) this.czekajNaGest();
    } catch (err) {
      console.error("Error uploading database to Drive:", err);
      this.updateStatusUI("error", "Błąd zapisu na Dysku");
    }
    return false;
  }

  // --- SEPARATE VOD SETTINGS SYNC (cinelog_settings.json) ---
  async downloadSettingsFromDrive() {
    await this.ensureValidToken();
    if (!this.isAuthorized()) return null;

    try {
      // Ustawienia VOD nie są krytyczne: błąd odczytu oznacza tylko „zostają lokalne".
      const fileId = await this.findFileByName(DRIVE_SETTINGS_FILE_NAME, "gdrive_settings_file_id");
      if (!fileId) return null;
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });

      if (res.ok) {
        const settings = await res.json();
        this.settingsFileId = fileId;
        return settings;
      }
    } catch (err) {
      console.error("Error downloading settings from Drive:", err);
    }
    return null;
  }

  /**
   * Zapisuje ustawienia VOD na Dysku Google.
   *
   * Jedna próba to za mało: zapisany identyfikator pliku (`gdrive_settings_file_id`)
   * bywa nieaktualny — plik mógł zostać usunięty albo podmieniony w innej sesji —
   * a Drive potrafi też odrzucić pojedyncze żądanie. Druga próba leci po skasowaniu
   * identyfikatora, więc plik zostaje znaleziony po nazwie albo założony od nowa.
   *
   * @returns {Promise<boolean>} true, gdy ustawienia są na Dysku
   */
  async uploadSettingsToDrive(country, subscriptions) {
    if (!this.isAuthorized()) return false;

    if (await this._zapiszUstawieniaNaDysku(country, subscriptions)) return true;

    console.warn("Pierwsza próba zapisu ustawień VOD nie powiodła się — ponawiam po odświeżeniu identyfikatora pliku.");
    this.settingsFileId = null;
    localStorage.removeItem("gdrive_settings_file_id");
    return this._zapiszUstawieniaNaDysku(country, subscriptions);
  }

  async _zapiszUstawieniaNaDysku(country, subscriptions) {
    try {
      const payload = {
        app: "CineLog",
        type: "settings",
        updated_at: new Date().toISOString(),
        country: country,
        subscriptions: subscriptions
      };

      const fileId = await this.findFileByName(DRIVE_SETTINGS_FILE_NAME, "gdrive_settings_file_id");
      const metadata = {
        name: DRIVE_SETTINGS_FILE_NAME,
        mimeType: "application/json"
      };

      let url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
      let method = "POST";

      if (fileId) {
        url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
        method = "PATCH";
      }

      const boundary = "-------cinelog_settings_boundary_" + Date.now();
      const delimiter = "\r\n--" + boundary + "\r\n";
      const closeDelim = "\r\n--" + boundary + "--";

      const multipartBody =
        delimiter +
        "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
        JSON.stringify(metadata) +
        delimiter +
        "Content-Type: application/json\r\n\r\n" +
        JSON.stringify(payload, null, 2) +
        closeDelim;

      const res = await fetch(url, {
        method: method,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      });

      if (res.ok) {
        const data = await res.json();
        this.settingsFileId = data.id;
        localStorage.setItem("gdrive_settings_file_id", this.settingsFileId);
        return true;
      }
      console.warn(`Zapis ustawień VOD na Dysku nieudany: HTTP ${res.status}`);
    } catch (err) {
      console.error("Error uploading settings to Drive:", err);
    }
    return false;
  }

  triggerAutoSave(movies, shows) {
    if (!this.byloPolaczenie()) return;

    // 🛡️ CRITICAL SAFETY GUARD: Never auto-sync to Google Drive if local database is marked as Demo/default
    const isCustom = localStorage.getItem("cinelog_user_imported") === "true";
    if (!isCustom) {
      console.warn("🛡️ Google Drive Auto-Save wstrzymany: aktywna baza jest bazą demonstracyjną (Demo).");
      return;
    }

    // 🛡️ CRITICAL SAFETY GUARD: baza serwera (tryb "flask") nigdy nie leci do chmury.
    // Bez tego jedna edycja w trybie serwera wysyłała na Drive bazę z /api/*,
    // nadpisując bibliotekę użytkownika (i flagę "cinelog_user_imported" z przeszłości
    // wystarczało, żeby ten guard przepuścił). Auto-sync dotyczy wyłącznie trybu klienta.
    const tryb = localStorage.getItem("cinelog_active_mode")
      || (isCustom ? "client" : "demo");
    if (tryb !== "client") {
      console.warn(`🛡️ Google Drive Auto-Save wstrzymany: aktywna baza to tryb "${tryb}", a nie biblioteka użytkownika.`);
      return;
    }

    // Znacznik zostaje do udanego wysłania: zmiana zrobiona przy wygasłym tokenie
    // albo bez sieci wyśle się przy najbliższej synchronizacji (scalenie z Dyskiem).
    // Oczekującego zastąpienia (przywrócona kopia, import) zwykła edycja nie osłabia do scalenia.
    if (this.trybOczekujacegoZapisu() !== ZAPIS_ZASTEPUJACY) localStorage.setItem(PENDING_UPLOAD_KEY, "true");
    if (!this.isAuthorized()) {
      this.czekajNaGest();
      return;
    }

    this.updateStatusUI("syncing", "Oczekuję na zapis...");
    // Tablice z argumentów to stan z chwili edycji; wysyłka czyta bibliotekę na nowo,
    // bo w ciągu tych 2 s synchronizacja albo import mogły ją podmienić.
    this._zaplanujZapis();
  }

  /** Biblioteka w przeglądarce jest dokładnie tym, co leży na Dysku: nic nie czeka na wysłanie. */
  zapamietajStanZsynchronizowany() {
    this._anulujOdroczonyZapis();
    localStorage.removeItem(PENDING_UPLOAD_KEY);
    wyczyscStanBazowy();
  }

  mergeMovie(cloudMovie, localMovie) {
    return {
      ...cloudMovie,
      ...localMovie,
      is_favorite: localMovie.is_favorite || cloudMovie.is_favorite,
      rating: (localMovie.rating !== null && localMovie.rating !== undefined) ? localMovie.rating : cloudMovie.rating,
      status: localMovie.status || cloudMovie.status
    };
  }

  mergeShow(cloudShow, localShow) {
    const epSet = new Set();
    const mergedEps = [];
    [...(cloudShow.episodes_watched || []), ...(localShow.episodes_watched || [])].forEach(ep => {
      const epKey = `${ep.season}_${ep.episode}`;
      if (!epSet.has(epKey)) {
        epSet.add(epKey);
        mergedEps.push(ep);
      }
    });

    const merged = {
      ...cloudShow,
      ...localShow,
      episodes_watched: mergedEps,
      rating: (localShow.rating !== null && localShow.rating !== undefined) ? localShow.rating : cloudShow.rating
    };
    // Postęp (watched_count / latest_progress / latest_season / latest_episode)
    // przeliczamy z unii odcinków, zamiast ufać ostatnio zapisującemu —
    // inaczej scalenie z telefonu (S03E02) i chmury (S03E05) daje niespójny licznik.
    return recalculateShowProgress(merged);
  }

  /**
   * Scalenie pary wpisów, gdy wiadomo, jak wpis wyglądał przy ostatniej synchronizacji:
   * pole zmienione tutaj bierze wartość stąd (także pustą — to jest cofnięcie), każde inne
   * wartość z Dysku. Odcinki rozlicza _scalOdcinki.
   * @param {object} zDysku
   * @param {object} lokalny
   * @param {object} bazowy wpis sprzed zmian w tej przeglądarce
   * @returns {object}
   */
  _scalTrojstronnie(zDysku, lokalny, bazowy) {
    const takieSame = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
    const wynik = { ...zDysku };
    new Set([...Object.keys(lokalny), ...Object.keys(bazowy)]).forEach((pole) => {
      if (pole === "episodes_watched" || takieSame(lokalny[pole], bazowy[pole])) return;
      if (lokalny[pole] === undefined) delete wynik[pole];
      else wynik[pole] = lokalny[pole];
    });
    return wynik;
  }

  /**
   * Odcinki z Dysku bez tych, które tutaj odznaczono, plus te, które tutaj zaznaczono.
   * @returns {object[]}
   */
  _scalOdcinki(zDysku, lokalne, bazowe) {
    const klucz = (odcinek) => `${odcinek.season}_${odcinek.episode}`;
    const lokalneKlucze = new Set(lokalne.map(klucz));
    const bazoweKlucze = new Set(bazowe.map(klucz));
    const wynik = zDysku.filter((odcinek) => !bazoweKlucze.has(klucz(odcinek)) || lokalneKlucze.has(klucz(odcinek)));
    const obecne = new Set(wynik.map(klucz));
    lokalne.forEach((odcinek) => {
      if (bazoweKlucze.has(klucz(odcinek)) || obecne.has(klucz(odcinek))) return;
      obecne.add(klucz(odcinek));
      wynik.push(odcinek);
    });
    return wynik;
  }

  /**
   * Po scaleniu stanem bazowym wpisów zmienionych tutaj staje się ich wersja z Dysku.
   * @param {Object<string, object|null>} bazowe
   * @returns {Object<string, object|null>}
   */
  _przebazuj(bazowe, filmyDysku, serialeDysku) {
    const naDysku = new Map();
    [...filmyDysku, ...serialeDysku].forEach((wpis) => {
      if (wpis && wpis.uuid) naDysku.set(String(wpis.uuid), wpis);
    });
    return Object.fromEntries(Object.keys(bazowe).map((uuid) => [uuid, naDysku.get(uuid) || null]));
  }

  /**
   * Scala bibliotekę z przeglądarki z biblioteką z Dysku. Usunięcia z obu stron są
   * stosowane PRZED scaleniem: pozycja skasowana na jednym urządzeniu nie wraca z drugiego,
   * a dodana ponownie (nowy uuid) zostaje.
   *
   * Ze stanem bazowym (bazowe) scalanie wie, kto co zmienił: wpis nietknięty tutaj bierze
   * wersję z Dysku, wpis zmieniony tutaj — pole po polu (_scalTrojstronnie). Bez stanu
   * bazowego (ręczne scalenie dwóch bibliotek, zmiany sprzed śledzenia) nic nie wiadomo,
   * więc wynik jest sumą obu stron (mergeMovie / mergeShow).
   * @param {Object<string, object|null>|null} [bazowe] wynik pobierzStanBazowy()
   * @returns {{movies: object[], shows: object[], deleted: object[]}}
   */
  mergeLibraries(localMovies, localShows, cloudMovies, cloudShows, localDeleted = [], cloudDeleted = [], bazowe = null) {
    const deleted = scalUsuniete(localDeleted, cloudDeleted);
    const zyje = (typ) => (entry) => Boolean(entry) && !czyUsuniety(entry, typ, deleted);

    const zTytulem = (entry) => Boolean((entry.title || "").trim());

    const scalPare = (suma, trojstronnie) => (zDysku, lokalny) => {
      if (!bazowe) return suma(zDysku, lokalny);
      const uuid = String(lokalny.uuid);
      if (!Object.prototype.hasOwnProperty.call(bazowe, uuid)) return zDysku;
      // null: wpis dodany tutaj, a na Dysku ta pozycja już jest (dodana też na drugim urządzeniu).
      return bazowe[uuid] ? trojstronnie(zDysku, lokalny, bazowe[uuid]) : suma(zDysku, lokalny);
    };

    return {
      movies: this._scalListe(
        (cloudMovies || []).filter(zyje("movie")),
        (localMovies || []).filter(zyje("movie")).filter(zTytulem),
        scalPare(
          (zDysku, lokalny) => this.mergeMovie(zDysku, lokalny),
          (zDysku, lokalny, bazowy) => this._scalTrojstronnie(zDysku, lokalny, bazowy)
        )
      ),
      shows: this._scalListe(
        (cloudShows || []).filter(zyje("show")),
        (localShows || []).filter(zyje("show")).filter(zTytulem),
        scalPare(
          (zDysku, lokalny) => this.mergeShow(zDysku, lokalny),
          (zDysku, lokalny, bazowy) => recalculateShowProgress({
            ...this._scalTrojstronnie(zDysku, lokalny, bazowy),
            episodes_watched: this._scalOdcinki(zDysku.episodes_watched || [], lokalny.episodes_watched || [], bazowy.episodes_watched || [])
          })
        )
      ),
      deleted: deleted
    };
  }

  /**
   * Paruje wpisy lokalne z wpisami z Dysku jeden do jednego: każdy wpis z Dysku dostaje
   * najwyżej jedną parę. Najpierw pary po uuid (to ten sam wpis biblioteki), dopiero potem
   * po tożsamości pozycji (taSamaPozycja: dwa różne tmdb_id to dwie pozycje, ten sam tytuł
   * z innym rokiem to remake) wśród wpisów z Dysku, które pary jeszcze nie mają.
   * Parowanie zachłanne („pierwszy pasujący") przy dwóch wpisach o tym samym tmdb_id
   * wkładało oba lokalne w ten sam wpis z Dysku: jeden znikał, drugi się dublował.
   * Kolejność wyniku: wpisy z Dysku, po nich nowe wpisy lokalne.
   * @param {object[]} zDysku
   * @param {object[]} lokalne
   * @param {(zDysku: object, lokalny: object) => object} scalPare
   * @returns {object[]}
   */
  _scalListe(zDysku, lokalne, scalPare) {
    const wynik = zDysku.slice();
    const maPare = new Array(wynik.length).fill(false);
    const indeksPoUuid = new Map();
    wynik.forEach((wpis, i) => {
      const uuid = wpis.uuid ? String(wpis.uuid) : "";
      if (uuid && !indeksPoUuid.has(uuid)) indeksPoUuid.set(uuid, i);
    });

    const bezParyPoUuid = [];
    lokalne.forEach((lokalny) => {
      const i = lokalny.uuid ? indeksPoUuid.get(String(lokalny.uuid)) : undefined;
      if (i === undefined || maPare[i]) {
        bezParyPoUuid.push(lokalny);
        return;
      }
      maPare[i] = true;
      wynik[i] = scalPare(wynik[i], lokalny);
    });

    const liczbaZDysku = zDysku.length;
    bezParyPoUuid.forEach((lokalny) => {
      let i = -1;
      for (let k = 0; k < liczbaZDysku; k += 1) {
        if (!maPare[k] && taSamaPozycja(wynik[k], lokalny)) {
          i = k;
          break;
        }
      }
      if (i === -1) {
        wynik.push(lokalny);
        return;
      }
      maPare[i] = true;
      wynik[i] = scalPare(wynik[i], lokalny);
    });

    return wynik;
  }

  async syncWithDrive(onDataUpdated) {
    if (!this.isAuthorized()) return;

    // 1. Sync Settings (country & subscriptions)
    const settings = await this.downloadSettingsFromDrive();
    if (settings && settings.country) {
      localStorage.setItem("vod-country", settings.country);
      if (settings.subscriptions) {
        localStorage.setItem("vod-subscriptions", JSON.stringify(settings.subscriptions));
      }
      if (window.applyLoadedVodSettings) {
        window.applyLoadedVodSettings(settings.country, settings.subscriptions);
      }
    }

    // 2. Sync Database
    let driveData;
    try {
      driveData = await this.downloadFromDrive();
    } catch (err) {
      // Stanu pliku nie znamy: niczego nie wysyłamy i niczego nie podmieniamy.
      if (window.showToastNotification) {
        window.showToastNotification(`Nie udało się odczytać bazy z Dysku Google (${err.message}). Biblioteka w przeglądarce i plik na Dysku zostają bez zmian.`, "error");
      }
      return;
    }
    if (driveData) {
      if (onDataUpdated) {
        onDataUpdated(driveData.movies || [], driveData.shows || [], driveData);
      }
    } else {
      // Pliku na Dysku na pewno nie ma: zakładamy go z biblioteki użytkownika.
      // Baza demo i baza serwera nie są biblioteką użytkownika — nie trafiają na Dysk.
      const local = this._bibliotekaUzytkownika();
      if (local && (local.movies.length > 0 || local.shows.length > 0)) {
        await this.uploadToDrive(local.movies, local.shows);
      }
    }
  }

  updateStatusUI(state, customMessage) {
    // Element statusu: ten sam przycisk co wejście do chmury (id: m3-btn-open-cloud-sync),
    // rozpoznawany po atrybucie, bo element nie ma osobnego id (wcześniej odwołanie
    // do "m3-chip-drive-status" nie trafiało w nic i status nigdy się nie aktualizował).
    const chip = document.querySelector("[data-drive-chip]");
    const chipText = document.getElementById("m3-drive-status-text");
    const chipIcon = document.getElementById("m3-drive-status-icon");

    if (!chip || !chipText || !chipIcon) return;

    if (!this.isAuthorized()) {
      chip.className = "m3-chip";
      chipIcon.style.animation = "none";
      if (this.byloPolaczenie()) {
        chipIcon.innerText = "cloud_sync";
        chipText.innerText = "Dysk Google: Dotknij, aby zsynchronizować";
      } else {
        chipIcon.innerText = "cloud_off";
        chipText.innerText = "Dysk Google: Rozłączony";
      }
      return;
    }

    if (state === "syncing") {
      chip.className = "m3-chip";
      chipIcon.innerText = "sync";
      chipIcon.style.animation = "spin 1s linear infinite";
      chipText.innerText = customMessage || "Synchronizuję...";
    } else if (state === "error") {
      chip.className = "m3-chip";
      chipIcon.innerText = "warning";
      chipIcon.style.animation = "none";
      chipText.innerText = customMessage || "Błąd synchronizacji";
    } else {
      chip.className = "m3-chip active";
      chipIcon.innerText = "cloud_done";
      chipIcon.style.animation = "none";
      chipText.innerText = customMessage || "Dysk Google: Połączono";
    }
  }
}

window.googleDriveSync = new GoogleDriveSync();
