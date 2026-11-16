// ==========================================================================
// CineLog - State Management & Utility Helpers Module
// ==========================================================================

function getInitialVodSubscriptions() {
  try {
    const raw = localStorage.getItem("vod-subscriptions");
    if (!raw) return ["Netflix", "HBO Max", "Disney Plus", "Amazon Prime Video", "SkyShowtime", "Apple TV", "CANAL+"];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["Netflix", "HBO Max", "Disney Plus", "Amazon Prime Video", "SkyShowtime", "Apple TV", "CANAL+"];
  } catch (e) {
    return ["Netflix", "HBO Max", "Disney Plus", "Amazon Prime Video", "SkyShowtime", "Apple TV", "CANAL+"];
  }
}

function getInitialCountry() {
  const saved = localStorage.getItem("vod-country");
  if (saved) return saved;
  const browserLang = (typeof navigator !== "undefined" ? (navigator.language || navigator.userLanguage || "pl") : "pl").toUpperCase();
  if (browserLang.startsWith("PL")) return "PL";
  if (browserLang.startsWith("EN-GB") || browserLang === "GB") return "GB";
  if (browserLang.startsWith("EN-CA") || browserLang === "CA") return "CA";
  if (browserLang.startsWith("EN-AU") || browserLang === "AU") return "AU";
  if (browserLang.startsWith("EN")) return "US";
  if (browserLang.startsWith("DE")) return "DE";
  if (browserLang.startsWith("FR")) return "FR";
  if (browserLang.startsWith("ES")) return "ES";
  if (browserLang.startsWith("IT")) return "IT";
  return "PL";
}

export const state = {
  movies: [],
  shows: [],
  mode: localStorage.getItem("cinelog_mode") || "movies", // "movies" | "shows"
  activeTab: "all",
  activeMovieTab: "all",
  activeShowTab: "all_shows",
  activeVodFilter: "all",
  sortMode: localStorage.getItem("cinelog_sort_mode") || "default",
  userVodCountry: getInitialCountry(),
  userVodSubscriptions: getInitialVodSubscriptions(),
  themeMode: localStorage.getItem("cinelog_theme_mode") || "dark",
  colorSeed: localStorage.getItem("cinelog_color_seed") || "#9333ea",
  backendAvailable: false,
  // Tryb, z którego pochodzi biblioteka trzymana w pamięci TEJ karty ("flask" | "demo" | "client").
  // Zapis idzie pod klucz tego trybu, a nie trybu z localStorage — ten mogła zmienić inna karta.
  trybBazy: null,
  vodCache: {},
  recFeedData: null,
  isRecLoading: false,
  rouletteSource: "watchlist",
  rouletteTime: "all",
  rouletteMood: "all",
  currentRematchType: null,
  currentRematchUuid: null,
  currentRematchCurrentId: null
};

// Legacy window aliases removed - modules must read/write `state` directly.
// (drive_sync.js receives live data via injected localLibraryProvider in main.js)

export function syncWindowAliases() {
  // Kept as no-op for backward compatibility with existing call sites.
}

/**
 * Formatuje liczbę minut do czytelnej postaci ("90 min", "2h 15m", "1d 3h").
 * @param {number|null} totalMinutes
 * @returns {string}
 */
export function formatWatchTimeMinutes(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${mins > 0 ? mins + 'm' : ''}`.trim();
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours > 0 ? remHours + 'h' : ''}`.trim();
}

/**
 * Escapuje znaki HTML (& < > " ') - obowiązkowe przed wstrzyknięciem
 * danych zewnętrznych do innerHTML (ochrona XSS).
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Przepuszcza wyłącznie bezpieczne URL-e obrazów (http/https/protocol-relative/data:image).
 * @param {*} value
 * @returns {string} pusty string gdy URL podejrzany
 */
export function safeUrl(value) {
  const url = String(value || "").trim();
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:image/") || url === "") return url;
  return "";
}

/**
 * Zwraca identyfikator TMDb jako liczbę dodatnią albo null.
 * Powód: w ścieżce awaryjnej (brak szczegółów z TMDb) identyfikator budowano
 * sklejeniem tekstu, co dawało literał "tmdb_undefined" wysyłany potem do API
 * jako prawdziwe id (zapytania do movie/tmdb_undefined/...).
 * @param {*} value
 * @returns {number|null}
 */
export function tmdbIdOf(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return parsed > 0 ? parsed : null;
  }
  return null;
}

/**
 * Nagłówki z lokalnymi kluczami API (BYOK) dla wywołań własnego backendu —
 * klucze nie trafiają wtedy do query stringów i logów serwera.
 * @returns {Record<string, string>}
 */
function getKeyHeaders() {
  const headers = {};
  const tmdbKey = localStorage.getItem("cinelog_tmdb_key");
  if (tmdbKey) headers["X-TMDB-Key"] = tmdbKey;
  const omdbKey = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key");
  if (omdbKey) headers["X-OMDb-Key"] = omdbKey;
  return headers;
}

/**
 * fetch z limitem czasu — na komórkach zawieszony request nie może
 * blokować UI na zawsze (np. spinner wyszukiwania).
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=8000]
 * @returns {Promise<Response>}
 */
export function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Jedno wejście do własnego backendu (/api/*): nagłówki z kluczami BYOK, limit
 * czasu i sprawdzenie statusu w jednym miejscu. Wcześniej każde wywołanie robiło
 * to po swojemu — część nie wysyłała klucza wcale, a mutacje ignorowały błąd
 * i udawały sukces. Rzuca Error z polem .status gdy odpowiedź nie jest 2xx.
 * @param {string} path ścieżka zaczynająca się od "/api/"
 * @param {RequestInit & {timeoutMs?: number}} [options]
 * @returns {Promise<Response>}
 */
// Trasy, które zmieniają bibliotekę serwera Flask (`data/*.json`).
const TRASA_BIBLIOTEKI_SERWERA = /^\/api\/(movies|shows|import)(\/|$)/;

export async function apiFetch(path, options = {}) {
  const { timeoutMs = 15000, headers, ...rest } = options;
  // Biblioteka klienta i demo to inne bazy niż biblioteka serwera, także gdy serwer działa
  // obok (aplikacja otwarta z localhost). Zapis takiej biblioteki na serwer psuł obie:
  // serwer dostawał cudze wpisy, a jego odpowiedź (własna lista) zastępowała bibliotekę
  // użytkownika. Żądanie odpada tu, bez sieci — wywołujący schodzą na zapis w przeglądarce
  // tak samo jak przy braku backendu.
  const metoda = String(rest.method || "GET").toUpperCase();
  if (metoda !== "GET" && TRASA_BIBLIOTEKI_SERWERA.test(path) && trybBazyWPamieci() !== "flask") {
    const error = new Error(`Biblioteka w trybie „${trybBazyWPamieci()}” nie jest zapisywana na serwerze (${metoda} ${path})`);
    error.status = 0;
    error.path = path;
    error.kod = "biblioteka-poza-serwerem";
    throw error;
  }
  const response = await fetchWithTimeout(path, {
    ...rest,
    headers: { ...getKeyHeaders(), ...(headers || {}) },
  }, timeoutMs);
  if (!response.ok) {
    const error = new Error(`Żądanie ${path} nie powiodło się (HTTP ${response.status})`);
    error.status = response.status;
    error.path = path;
    throw error;
  }
  return response;
}

/** Czy odpowiedź backendu zawiera realne dane (a nie prośbę o klucz API)?
 *
 * `/api/search_detail` zwraca 200 z `needs_key: true`, gdy backend nie ma
 * żadnego klucza (albo klucz został odrzucony). Taka odpowiedź nie jest danymi —
 * potraktowana jak sukces zablokowałaby fallback kliencki (tryb demo / GitHub Pages).
 */
export function isRealDetail(body) {
  return Boolean(body) && !body.needs_key && body.found !== false;
}

/** Klucz TMDb użytkownika (BYOK) widoczny dla przeglądarki. */
export function clientTmdbKey() {
  return localStorage.getItem("cinelog_tmdb_key") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.TMDB_API_KEY) || "";
}

/**
 * Wyszukiwanie w TMDb wprost z przeglądarki — dla trybu demo, backendu bez klucza
 * oraz ponownego dopasowania wersji filmu z edytora.
 *
 * Backend bez klucza odpowiada `needs_key` (prośba o klucz, nie dane), więc gdy
 * użytkownik ma własny klucz, szukamy nim u dostawcy zamiast pokazywać pustą listę.
 *
 * @param {string} query szukana fraza
 * @param {string} type "movie" albo "series"
 * @param {string} [lang] kod języka, np. "pl-PL"
 * @returns {Promise<Array<object>|null>} wyniki w kształcie używanym przez UI; null = brak klucza/błąd
 */
export async function szukajWTmdbPoStronieKlienta(query, type, lang) {
  const klucz = clientTmdbKey();
  if (!klucz || !query) return null;

  const endpoint = type === "series" ? "tv" : "movie";
  try {
    const res = await fetchWithTimeout(
      `https://api.themoviedb.org/3/search/${endpoint}?api_key=${encodeURIComponent(klucz)}` +
        `&query=${encodeURIComponent(query)}&language=${encodeURIComponent(lang || "pl-PL")}&include_adult=false`
    );
    if (!res.ok) return null;

    const dane = await res.json();
    return (dane.results || []).map((it) => ({
      title: it.title || it.name || "",
      original_title: it.original_title || it.original_name || "",
      year: (it.release_date || it.first_air_date || "").slice(0, 4),
      poster_url: it.poster_path ? `https://image.tmdb.org/t/p/w500${it.poster_path}` : "",
      type: type === "series" ? "series" : "movie",
      tmdb_id: tmdbIdOf(it.id),
      plot: it.overview || "",
      overview: it.overview || "",
      vote_average: it.vote_average || 0,
    }));
  } catch (e) {
    console.warn("Wyszukiwanie w TMDb po stronie klienta nie powiodło się:", e);
    return null;
  }
}

// Progressive rendering: append cards in chunks so large libraries don't freeze the UI.
// A generation counter cancels pending chunks when a newer render starts.
/**
 * Przyrostowe renderowanie listy kart w chunkach (bez zamrażania UI przy dużych bibliotekach).
 * Licznik generacji anuluje oczekujące chunki po rozpoczęciu nowego renderu.
 * @param {HTMLElement} grid kontener kart
 * @param {Array} items elementy do wyrenderowania
 * @param {(item: *, index: number) => HTMLElement} buildCardFn fabryka karty
 * @param {number} [chunkSize=48]
 */
export function renderListInChunks(grid, items, buildCardFn, chunkSize = 48) {
  grid.__cinelogRenderGen = (grid.__cinelogRenderGen || 0) + 1;
  const gen = grid.__cinelogRenderGen;

  const appendChunk = (start) => {
    if (gen !== grid.__cinelogRenderGen) return;
    const frag = document.createDocumentFragment();
    const end = Math.min(start + chunkSize, items.length);
    for (let i = start; i < end; i++) {
      frag.appendChild(buildCardFn(items[i], i));
    }
    grid.appendChild(frag);
    if (end < items.length) {
      setTimeout(() => appendChunk(end), 0);
    }
  };
  appendChunk(0);
}

export function getGradientForTitle(title) {
  let hash = 0;
  for (let i = 0; i < (title || "").length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 130) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 65%, 45%), hsl(${h2}, 75%, 28%))`;
}

/**
 * Normalizuje tytuł do klucza porównań (lowercase, bez roku/nawiasów/diakrytyków).
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitleForLibrary(title) {
  if (!title) return "";
  return String(title)
    .replace(/\s*\(\d{4}\)/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

const idTmdbPozycji = (entry) =>
  (entry && entry.tmdb_id !== undefined && entry.tmdb_id !== null && entry.tmdb_id !== "") ? String(entry.tmdb_id) : null;

/**
 * Rok pozycji: pole `year`, data premiery albo nawias w tytule („Maniac (2018)").
 * @param {object} entry
 * @returns {string} cztery cyfry albo pusty napis
 */
export function rokPozycji(entry) {
  if (!entry) return "";
  for (const pole of [entry.year, entry.release_year, entry.release_date, entry.first_air_date]) {
    const trafienie = String(pole ?? "").match(/(?:^|\D)((?:18|19|20)\d{2})(?:\D|$)/);
    if (trafienie) return trafienie[1];
  }
  const wTytule = String(entry.title || "").match(/\(((?:18|19|20)\d{2})\)/);
  return wTytule ? wTytule[1] : "";
}

/**
 * Czy dwa wpisy to ta sama pozycja biblioteki. Remake to osobna pozycja:
 * - oba wpisy mają tmdb_id → decyduje wyłącznie równość tmdb_id;
 * - inaczej ten sam uuid albo ten sam znormalizowany tytuł, o ile lata się nie kłócą
 *   (równe albo co najmniej jeden wpis nie ma roku).
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function taSamaPozycja(a, b) {
  if (!a || !b) return false;
  const tmdbA = idTmdbPozycji(a);
  const tmdbB = idTmdbPozycji(b);
  if (tmdbA && tmdbB) return tmdbA === tmdbB;
  if (a.uuid && b.uuid && String(a.uuid) === String(b.uuid)) return true;
  const tytulA = normalizeTitleForLibrary(a.title);
  if (!tytulA || tytulA !== normalizeTitleForLibrary(b.title)) return false;
  const rokA = rokPozycji(a);
  const rokB = rokPozycji(b);
  return !rokA || !rokB || rokA === rokB;
}

/**
 * Czy wpis biblioteki jest tym, który użytkownik usuwa. Cel-obiekt z uuid usuwa dokładnie
 * ten wpis — wcześniej sam tytuł wystarczał, więc usunięcie remake'u kasowało też oryginał.
 * @param {object} entry wpis biblioteki
 * @param {object|string|number} cel usuwany wpis albo jego identyfikator/tytuł
 * @returns {boolean}
 */
export function pozycjaDoUsuniecia(entry, cel) {
  if (!entry || cel === null || cel === undefined || cel === "") return false;
  if (typeof cel !== "object") {
    const klucz = String(cel);
    if (entry.uuid && String(entry.uuid) === klucz) return true;
    if (entry.id && String(entry.id) === klucz) return true;
    const tytul = normalizeTitleForLibrary(klucz);
    return Boolean(tytul) && normalizeTitleForLibrary(entry.title) === tytul;
  }
  if (entry === cel) return true;
  if (cel.uuid && entry.uuid) return String(entry.uuid) === String(cel.uuid);
  if (cel.id && entry.id && String(entry.id) === String(cel.id)) return true;
  return taSamaPozycja(entry, cel);
}

// --- Usunięcia (nagrobki) -----------------------------------------------------------------
// Scalanie bibliotek to suma zbiorów, więc bez śladu po usunięciu pozycja skasowana na jednym
// urządzeniu wracała z drugiego. Ślad („nagrobek") jedzie na Dysk razem z biblioteką.
const KLUCZ_USUNIETYCH = "cinelog_deleted";
const MAKS_WIEK_USUNIECIA_MS = 365 * 24 * 60 * 60 * 1000;
const MAKS_LICZBA_USUNIEC = 5000;

function kluczUsuniecia(u) {
  if (u.uuid) return `${u.typ}:uuid:${u.uuid}`;
  if (u.tmdb_id) return `${u.typ}:tmdb:${u.tmdb_id}`;
  const tytul = normalizeTitleForLibrary(u.title);
  return tytul ? `${u.typ}:tytul:${tytul}:${u.year || ""}` : "";
}

/**
 * Suma dwóch list usunięć: bez duplikatów, bez wpisów starszych niż rok, najnowsze pierwsze.
 * @param {object[]} a
 * @param {object[]} b
 * @returns {{typ: "movie"|"show", uuid: string, tmdb_id: string|null, title: string, year: string, deleted_at: string}[]}
 */
export function scalUsuniete(a, b) {
  const granica = Date.now() - MAKS_WIEK_USUNIECIA_MS;
  const poKluczu = new Map();
  [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])].forEach((u) => {
    if (!u || typeof u !== "object" || (u.typ !== "movie" && u.typ !== "show")) return;
    const czas = Date.parse(u.deleted_at);
    if (!Number.isFinite(czas) || czas < granica) return;
    const klucz = kluczUsuniecia(u);
    if (!klucz) return;
    const obecny = poKluczu.get(klucz);
    if (!obecny || Date.parse(obecny.deleted_at) < czas) poKluczu.set(klucz, u);
  });
  return [...poKluczu.values()]
    .sort((x, y) => Date.parse(y.deleted_at) - Date.parse(x.deleted_at))
    .slice(0, MAKS_LICZBA_USUNIEC);
}

/** Usunięcia zapamiętane w tej przeglądarce (dotyczą biblioteki użytkownika). */
export function pobierzUsuniete() {
  try {
    return scalUsuniete(JSON.parse(localStorage.getItem(KLUCZ_USUNIETYCH) || "[]"), []);
  } catch (e) {
    console.warn("CineLog: nieczytelna lista usunięć — pomijam", e);
    return [];
  }
}

/** @param {object[]} lista */
export function zapiszUsuniete(lista) {
  try {
    localStorage.setItem(KLUCZ_USUNIETYCH, JSON.stringify(scalUsuniete(lista, [])));
  } catch (e) {
    console.warn("CineLog: nie udało się zapisać listy usunięć", e);
  }
}

/**
 * Czy wpis został usunięty. Wpis z uuid pasuje tylko po uuid: pozycja dodana ponownie
 * dostaje nowy uuid, więc stare usunięcie jej nie dotyczy.
 * @param {object} entry
 * @param {"movie"|"show"} typ
 * @param {object[]} usuniete
 * @returns {boolean}
 */
export function czyUsuniety(entry, typ, usuniete) {
  if (!entry || !Array.isArray(usuniete) || !usuniete.length) return false;
  return usuniete.some((u) => {
    if (u.typ !== typ) return false;
    if (u.uuid || entry.uuid) return Boolean(u.uuid && entry.uuid && String(u.uuid) === String(entry.uuid));
    return taSamaPozycja(u, entry);
  });
}

/**
 * Zapamiętuje usunięcie pozycji z biblioteki użytkownika.
 * @param {object} entry
 * @param {"movie"|"show"} typ
 */
export function oznaczUsuniecie(entry, typ) {
  if (!entry) return;
  zapiszUsuniete([...pobierzUsuniete(), {
    typ,
    uuid: entry.uuid ? String(entry.uuid) : "",
    tmdb_id: idTmdbPozycji(entry),
    title: entry.title || "",
    year: rokPozycji(entry),
    deleted_at: new Date().toISOString()
  }]);
}

/**
 * Biblioteka wprowadzona świadomie w całości (import, przywrócenie kopii) unieważnia
 * usunięcia pozycji, które zawiera — inaczej następna synchronizacja znów by je skasowała.
 * @param {object[]} movies
 * @param {object[]} shows
 */
export function odwolajUsunieciaDla(movies, shows) {
  const usuniete = pobierzUsuniete();
  if (!usuniete.length) return;
  const zostaja = usuniete.filter((u) =>
    !((u.typ === "movie" ? movies : shows) || []).some((entry) => czyUsuniety(entry, u.typ, [u])));
  if (zostaja.length !== usuniete.length) zapiszUsuniete(zostaja);
}

// Dopasowanie wyniku wyszukiwania TMDb do wpisu biblioteki.
// Nie wolno brać pierwszego wyniku "w ciemno": tytuł typu "Biuro" ma w TMDb po kilka
// wersji (The Office US, The Office UK, seriale o biurach), a wtedy opis i obsada
// pochodzą z jednego serialu, a odcinki z zupełnie innego.
// Zwraca dopasowany wynik albo null, gdy nie ma wystarczającej pewności.
export function wybierzTrafienieWTmdb(wyniki, tytul, rok) {
  if (!Array.isArray(wyniki) || wyniki.length === 0) return null;
  const cel = normalizeTitleForLibrary(tytul);
  if (!cel) return null;
  const rokCelu = parseInt(rok, 10) || null;

  const zgodne = [];
  for (const wynik of wyniki) {
    const nazwy = [wynik.name, wynik.title, wynik.original_name, wynik.original_title]
      .map(normalizeTitleForLibrary)
      .filter(Boolean);
    if (!nazwy.includes(cel)) continue;
    const rokWyniku = parseInt(String(wynik.first_air_date || wynik.release_date || "").slice(0, 4), 10) || null;
    // Rok znany po obu stronach musi się zgadzać; brak roku po którejkolwiek stronie
    // nie dyskwalifikuje kandydata, ale nie pozwala też wybrać między kilkoma.
    if (rokCelu && rokWyniku && Math.abs(rokWyniku - rokCelu) > 1) continue;
    zgodne.push(wynik);
  }

  if (zgodne.length === 0) return null;
  if (zgodne.length > 1 && !rokCelu) return null;
  return zgodne[0];
}

function getTitleVariants(itemOrTitle) {
  if (!itemOrTitle) return [];
  const set = new Set();
  const add = (t) => {
    if (!t) return;
    const clean = String(t).trim();
    if (clean) {
      const normalized = normalizeTitleForLibrary(clean);
      if (normalized) set.add(normalized);
      // Remove text after colon or dash (e.g. "Spider-Man: Homecoming" -> "spiderman")
      const baseColon = clean.split(":")[0].trim();
      if (baseColon && baseColon !== clean) {
        const normColon = normalizeTitleForLibrary(baseColon);
        if (normColon) set.add(normColon);
      }
      const baseDash = clean.split(" - ")[0].trim();
      if (baseDash && baseDash !== clean) {
        const normDash = normalizeTitleForLibrary(baseDash);
        if (normDash) set.add(normDash);
      }
    }
  };

  if (typeof itemOrTitle === "string") {
    add(itemOrTitle);
  } else if (typeof itemOrTitle === "object") {
    add(itemOrTitle.title);
    add(itemOrTitle.original_title);
    add(itemOrTitle.name);
    add(itemOrTitle.original_name);
    add(itemOrTitle.alt_title);
  }
  return Array.from(set);
}

/**
 * Sprawdza czy pozycja (z TMDb/importu) już istnieje w bibliotece -
 * dopasowanie po tmdb_id / imdb_id / wariantach znormalizowanego tytułu.
 * @param {{title?: string, tmdb_id?: *, imdb_id?: string}} item
 * @returns {boolean}
 */
export function isItemInLibrary(item) {
  if (!item) return false;
  const tmdbId = String(item.tmdb_id || item.id || "");
  const imdbId = String(item.imdb_id || "");
  const itemYear = String(item.year || (item.release_date ? item.release_date.substring(0, 4) : "") || "");
  const itemVariants = getTitleVariants(item);

  const checkList = (arr) => {
    return (arr || []).some(entry => {
      // 1. Oba wpisy mają identyfikator TMDb: rozstrzyga wyłącznie on. Ten sam tytuł z innym
      // identyfikatorem to inna pozycja (remake, film i serial o tej samej nazwie).
      if (tmdbId && entry.tmdb_id) return String(entry.tmdb_id) === tmdbId;
      // 2. Exact IMDb ID Match
      if (imdbId && entry.imdb_id && String(entry.imdb_id) === imdbId) return true;

      // 3. Normalized Title / Original Title Variants Match
      const entryVariants = getTitleVariants(entry);
      const hasMatch = itemVariants.some(iv => iv.length >= 3 && entryVariants.includes(iv));
      if (hasMatch) return true;

      // 4. Same release year and high substring containment
      const entryYear = String(entry.release_year || (entry.release_date ? entry.release_date.substring(0, 4) : "") || entry.year || "");
      if (itemYear && entryYear && itemYear === entryYear) {
        const itemNorm = normalizeTitleForLibrary(item.title || item.original_title || "");
        const entryNorm = normalizeTitleForLibrary(entry.title || entry.original_title || "");
        if (itemNorm.length >= 4 && entryNorm.length >= 4) {
          if (itemNorm.includes(entryNorm) || entryNorm.includes(itemNorm)) {
            return true;
          }
        }
      }

      return false;
    });
  };

  return checkList(state.movies) || checkList(state.shows);
}

/**
 * Wyszukuje duplikat tytułu w bibliotece (filmów lub seriali).
 * @param {string} title
 * @param {"movie"|"series"} type
 * @param {string|number|null} tmdbId
 * @returns {object|undefined}
 */
export function findDuplicateInLibrary(title, type = "movie", tmdbId = null) {
  const normTitle = normalizeTitleForLibrary(title);
  const targetTmdb = tmdbId ? String(tmdbId) : "";
  const titleVariants = getTitleVariants(title);

  const matchEntry = (entry) => {
    // Oba identyfikatory TMDb znane: rozstrzygają same (remake to osobna pozycja).
    if (targetTmdb && entry.tmdb_id) return String(entry.tmdb_id) === targetTmdb;
    const entryVariants = getTitleVariants(entry);
    return titleVariants.some(tv => tv.length >= 3 && entryVariants.includes(tv));
  };

  if (type === "series" || type === "tv") {
    return state.shows.find(matchEntry);
  } else {
    return state.movies.find(matchEntry);
  }
}

/**
 * UUID v4 z fallbackiem na Math.random dla starszych przeglądarek.
 * @returns {string}
 */
export function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Klucz localStorage z biblioteką danego trybu. Trzy tryby to trzy osobne bazy:
 * "cinelog_database" należy wyłącznie do biblioteki użytkownika (tryb klienta).
 * Wspólny klucz kończył się utratą danych — baza serwera albo demo nadpisywała
 * bibliotekę użytkownika, a powrót na tryb klienta jej nie przywracał.
 * @param {string} tryb "flask" | "demo" | "client"
 * @returns {string}
 */
export function kluczBazyDlaTrybu(tryb) {
  if (tryb === "flask") return "cinelog_database_server";
  if (tryb === "demo") return "cinelog_database_demo";
  return "cinelog_database";
}

/**
 * Podmienia bibliotekę w pamięci razem z informacją, z którego trybu pochodzi.
 * Dane i tryb muszą zmieniać się w jednym kroku: zapis między nimi trafiłby
 * z biblioteką jednego trybu pod klucz drugiego.
 * @param {object[]} movies
 * @param {object[]} shows
 * @param {string} tryb "flask" | "demo" | "client"
 */
export function ustawBiblioteke(movies, shows, tryb) {
  state.movies = Array.isArray(movies) ? movies : [];
  state.shows = Array.isArray(shows) ? shows : [];
  state.trybBazy = tryb;
}

/** Tryb biblioteki trzymanej w pamięci tej karty (przed pierwszym wczytaniem: tryb z ustawień). */
export function trybBazyWPamieci() {
  return state.trybBazy || getActiveEnvMode();
}

/**
 * Czy zmiany biblioteki zapisuje serwer: w pamięci jest baza serwera Flask i serwer odpowiada.
 * Sama dostępność backendu nie wystarcza — w trybie klienta i demo serwer bywa obok, a nie
 * jest właścicielem danych (patrz `apiFetch`).
 */
export function bibliotekaNaSerwerze() {
  return state.backendAvailable && trybBazyWPamieci() === "flask";
}

/** Klucz kopii ostatniej bazy użytkownika, sprzed destrukcyjnego nadpisania. */
const KLUCZ_KOPII_BAZY = "cinelog_database_backup";

/**
 * Zapisuje kopię bazy użytkownika przed operacją, która ma ją zastąpić
 * (Pull z Dysku, scalanie, przełączenie na serwer/demo). Import z pliku kopii
 * nie robi — to świadoma wymiana biblioteki, kopię pobiera się przyciskiem eksportu.
 * Kopia jest jednopoziomowa: trzyma ostatnią wersję sprzed nadpisania.
 * @param {string} [zrodlo=""] Krótki opis operacji (do komunikatu w UI).
 * @returns {boolean} true, jeśli kopię udało się zapisać
 */
export function zapiszKopieBazy(zrodlo = "") {
  try {
    const aktualna = localStorage.getItem("cinelog_database");
    if (!aktualna) return false;
    const parsed = JSON.parse(aktualna);
    if (!parsed || !Array.isArray(parsed.movies) || !Array.isArray(parsed.shows)) return false;
    if (!parsed.movies.length && !parsed.shows.length) return false;
    localStorage.setItem(KLUCZ_KOPII_BAZY, JSON.stringify({
      movies: parsed.movies,
      shows: parsed.shows,
      saved_at: new Date().toISOString(),
      source: zrodlo
    }));
    return true;
  } catch (e) {
    console.warn("Nie udało się zapisać kopii bazy:", e);
    return false;
  }
}

/**
 * Znacznik czasu w LOKALNYM czasie przeglądarki, w formacie spójnym z
 * backendem ("YYYY-MM-DD HH:MM:SS"). toISOString() zwraca UTC — wieczorem/
 * nocą dawałoby datę wsteczną o jeden dzień względem lokalnej.
 * @returns {string}
 */
export function localTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Jedyne miejsce w frontendzie przeliczające pola postępu serialu na podstawie
 * episodes_watched (reguła 1:1 z routes/shows.py). Używane przez tracker
 * (shows.js) i scalanie Drive (drive_sync.js).
 * @param {object} show obiekt serialu (mutowany w miejscu)
 * @returns {object} ten sam serial z przeliczonymi watched_count / latest_*
 */
export function recalculateShowProgress(show) {
  const eps = show.episodes_watched ? [...show.episodes_watched] : [];
  eps.sort((a, b) => (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0));
  show.episodes_watched = eps;
  show.watched_count = eps.length;
  if (eps.length > 0) {
    const highestS = Math.max(...eps.map(e => e.season || 0));
    const highestE = Math.max(...eps.filter(e => (e.season || 0) === highestS).map(e => e.episode || 0));
    show.latest_progress = `S${String(highestS).padStart(2, "0")}E${String(highestE).padStart(2, "0")}`;
    show.latest_season = highestS;
    show.latest_episode = highestE;
  } else {
    show.latest_progress = null;
    show.latest_season = 0;
    show.latest_episode = 0;
  }
  return show;
}

/**
 * Buduje lokalny wpis biblioteki (film/serial) z danych podglądu TMDb —
 * używany jako fallback zapisu w trybie klienta / GitHub Pages (bez backendu).
 * Kształt pól jest spójny z buildLocalMovie / buildLocalShow z search.js.
 * @param {object} previewData dane podglądu (title, tmdb_id/id, poster_url, ...)
 * @param {"movie"|"series"} type
 * @param {string} [status]
 * @param {number|null} [rating]
 * @param {Array} [episodesList] lista {season, episode} dla seriali
 * @returns {object}
 */
export function buildLocalLibraryEntry(previewData, type, status = "watchlist", rating = null, episodesList = []) {
  const entry = {
    uuid: `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: previewData.title,
    original_title: previewData.original_title || previewData.title,
    year: previewData.year || "",
    genre: previewData.genre || "",
    plot: previewData.plot || "",
    poster_url: previewData.poster_url || "",
    status: status || "watchlist",
    rating: rating ?? null,
    tmdb_id: previewData.tmdb_id || previewData.id,
    imdb_id: previewData.imdb_id || "",
    is_favorite: false,
    user_date: localTimestamp().slice(0, 10),
    // Data aktywności: sortowanie „Ostatnio dodane / aktywność" liczy z
    // watch_date || follow_date || created_at, więc wpis bez żadnej z nich ląduje na
    // KOŃCU listy — dokładnie tak zgłosił to użytkownik. Serwer Flask nadaje
    // follow_date przy dodaniu (routes/movies.py), klient musi robić to samo.
    follow_date: localTimestamp()
  };
  if (entry.status === "watched") entry.watch_date = entry.follow_date;
  if (type === "series" || type === "tv") {
    entry.total_seasons = previewData.total_seasons || 1;
    entry.total_episodes = previewData.total_episodes || 0;
    entry.season_ep_counts = previewData.season_ep_counts || {};
    entry.episodes_watched = episodesList;
  } else {
    entry.director = previewData.director || "";
    entry.cast = previewData.cast || "";
    entry.runtime = previewData.runtime || "";
    entry.release_date = previewData.release_date || (previewData.year ? `${previewData.year}-01-01` : null);
  }
  return entry;
}

// Ostatni czas pokazania toastu o przekroczeniu kwoty localStorage —
// throttling, żeby seria zapisów nie spamowała użytkownika powiadomieniami.
let lastQuotaToastAt = 0;

function isQuotaError(err) {
  if (!err) return false;
  return err.name === "QuotaExceededError"
    || err.code === 22
    || (typeof err.message === "string" && /quota|exceed/i.test(err.message));
}

function showStorageQuotaWarning() {
  const now = Date.now();
  if (now - lastQuotaToastAt < 60_000) return;
  lastQuotaToastAt = now;
  console.error("🛑 localStorage quota exceeded — baza nie została zapisana w przeglądarce.");
  if (typeof window !== "undefined" && typeof window.showToastNotification === "function") {
    window.showToastNotification(
      "🛑 Brak miejsca w pamięci przeglądarki — zmiany NIE zostały zapisane! Zrób kopię (Chmura → Drive / eksport JSON) i usuń część pozycji.",
      "error"
    );
  }
}

/**
 * Zwraca kopię bazy użytkownika (sprzed ostatniego nadpisania) albo null.
 * @returns {{movies: object[], shows: object[], saved_at?: string, source?: string}|null}
 */
export function pobierzKopieBazy() {
  try {
    const raw = localStorage.getItem(KLUCZ_KOPII_BAZY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.movies)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Przywraca kopię jako aktywną bibliotekę użytkownika (przełącza na tryb klienta).
 * @returns {{movies: object[], shows: object[]}|null}
 */
export function przywrocKopieBazy() {
  const kopia = pobierzKopieBazy();
  if (!kopia) return null;
  ustawBiblioteke(kopia.movies, kopia.shows, "client");
  localStorage.setItem("cinelog_database", JSON.stringify({
    movies: state.movies,
    shows: state.shows,
    updated_at: new Date().toISOString()
  }));
  localStorage.removeItem(KLUCZ_KOPII_BAZY);
  markUserDatabaseCustom();
  syncWindowAliases();
  return { movies: state.movies, shows: state.shows };
}

/**
 * Zapisuje stan biblioteki do localStorage i ewentualnie triggeruje autosave Drive.
 * @param {boolean} [skipCloudSync=false] true = nigdy nie dotykaj Drive (np. zapis demo)
 */
export function saveLocalDatabase(skipCloudSync = false) {
  const trybBazy = trybBazyWPamieci();
  try {
    localStorage.setItem(kluczBazyDlaTrybu(trybBazy), JSON.stringify({
      movies: state.movies,
      shows: state.shows,
      updated_at: new Date().toISOString()
    }));
  } catch (e) {
    if (isQuotaError(e)) {
      showStorageQuotaWarning();
    } else {
      console.warn("Nie udało się zapisać bazy do localStorage:", e);
    }
  }
  syncWindowAliases();
  // 🛡️ CRITICAL GUARD: auto-sync do Drive tylko dla bazy UŻYTKOWNIKA w trybie klienta.
  // Bez tego warunku jedna edycja w trybie serwera wypychała do chmury bazę serwera,
  // nadpisując bibliotekę użytkownika na Dysku. Baza oznaczona jako demo też nie jedzie
  // do chmury (drugi guard, niezależny od trybu).
  // Bez warunku isAuthorized(): przy wygasłym tokenie zmiana ma zostać oznaczona
  // do wysłania (triggerAutoSave), a nie przepaść po cichu.
  // Oba warunki naraz: biblioteka w pamięci jest biblioteką użytkownika ORAZ tryb w ustawieniach
  // to nadal tryb klienta (inna karta mogła go zmienić — wtedy ta karta zaraz się przeładuje).
  if (!skipCloudSync && trybBazy === "client" && getActiveEnvMode() === "client" && window.googleDriveSync) {
    window.googleDriveSync.triggerAutoSave(state.movies, state.shows);
  }
}

export function getActiveEnvMode() {
  const saved = localStorage.getItem("cinelog_active_mode");
  if (saved) return saved; // "flask" | "demo" | "client"
  if (state.backendAvailable) return "flask";
  if (localStorage.getItem("cinelog_user_imported") === "true") return "client";
  return "demo";
}

export function setActiveEnvMode(mode) {
  localStorage.setItem("cinelog_active_mode", mode);
  state.activeEnvMode = mode;
}

export function isUserDatabaseDemo() {
  const mode = getActiveEnvMode();
  return mode === "demo";
}

/**
 * Biblioteka trzymana w pamięci staje się biblioteką użytkownika (import, pobranie z Dysku).
 * Wołaj PRZED saveLocalDatabase(): zapis idzie pod klucz trybu biblioteki w pamięci,
 * więc w odwrotnej kolejności pobrana biblioteka trafiłaby pod klucz demo albo serwera.
 */
export function markUserDatabaseCustom() {
  localStorage.setItem("cinelog_user_imported", "true");
  setActiveEnvMode("client");
  state.trybBazy = "client";
}

/**
 * Przywraca bazę demonstracyjną ze static/data/*.json (z pominięciem synchronizacji Drive).
 * @returns {Promise<{movies: object[], shows: object[]}>}
 */
export async function resetToDemoDatabase() {
  setActiveEnvMode("demo");
  // Demo ma własny klucz, więc biblioteki użytkownika nie dotykamy. Wyjątek to pozostałość
  // po starszych wersjach: trzymały demo pod kluczem biblioteki użytkownika i kasowały przy
  // tym znacznik własnej biblioteki — bez znacznika pod tym kluczem leży stara kopia demo.
  if (localStorage.getItem("cinelog_user_imported") !== "true" || !localStorage.getItem("cinelog_database")) {
    localStorage.removeItem("cinelog_database");
    localStorage.removeItem("cinelog_user_imported");
  }
  localStorage.removeItem("cinelog_demo_banner_dismissed");
  
  let movies = [];
  let shows = [];
  const candidatePaths = [
    ["./static/data/movies_parsed.json", "./static/data/shows_parsed.json"],
    ["static/data/movies_parsed.json", "static/data/shows_parsed.json"],
    ["/static/data/movies_parsed.json", "/static/data/shows_parsed.json"]
  ];

  for (const [mPath, sPath] of candidatePaths) {
    try {
      const [rm, rs] = await Promise.all([fetch(mPath), fetch(sPath)]);
      if (rm.ok && rs.ok) {
        movies = await rm.json();
        shows = await rs.json();
        break;
      }
    } catch (e) { console.debug("CineLog: baza demo niedostępna pod tą ścieżką — próbuję następną", e); }
  }

  ustawBiblioteke(movies, shows, "demo");

  // 🛡️ Explicitly skip cloud sync to protect user's private Google Drive backup from being overwritten with demo
  saveLocalDatabase(true);
  return { movies: state.movies, shows: state.shows };
}

