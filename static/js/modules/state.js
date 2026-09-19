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
export async function apiFetch(path, options = {}) {
  const { timeoutMs = 15000, headers, ...rest } = options;
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
      // 1. Exact TMDb ID Match
      if (tmdbId && entry.tmdb_id && String(entry.tmdb_id) === tmdbId) return true;
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
    if (targetTmdb && entry.tmdb_id && String(entry.tmdb_id) === targetTmdb) return true;
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
 * Klucz, pod którym zapisujemy aktywną bazę.
 *
 * W trybie serwera (Flask) biblioteka przychodzi z /api/movies i /api/shows, więc
 * trzymamy ją pod osobnym kluczem: nadpisywanie "cinelog_database" kasowało
 * bibliotekę użytkownika i powrót na tryb klienta jej nie przywracał.
 */
function aktywnyKluczBazy() {
  return getActiveEnvMode() === "flask" ? "cinelog_database_server" : "cinelog_database";
}

/** Klucz kopii ostatniej bazy użytkownika, sprzed destrukcyjnego nadpisania. */
const KLUCZ_KOPII_BAZY = "cinelog_database_backup";

/**
 * Zapisuje kopię bazy użytkownika przed operacją, która ma ją zastąpić
 * (Pull z Dysku, scalanie, import z pliku, przełączenie na serwer/demo).
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
  state.movies = Array.isArray(kopia.movies) ? kopia.movies : [];
  state.shows = Array.isArray(kopia.shows) ? kopia.shows : [];
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
  try {
    localStorage.setItem(aktywnyKluczBazy(), JSON.stringify({
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
  if (!skipCloudSync && getActiveEnvMode() === "client" && !isUserDatabaseDemo() && window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
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

export function markUserDatabaseCustom() {
  localStorage.setItem("cinelog_user_imported", "true");
  setActiveEnvMode("client");
}

/**
 * Przywraca bazę demonstracyjną ze static/data/*.json (z pominięciem synchronizacji Drive).
 * @returns {Promise<{movies: object[], shows: object[]}>}
 */
export async function resetToDemoDatabase() {
  setActiveEnvMode("demo");
  zapiszKopieBazy("reset do bazy demonstracyjnej");
  localStorage.removeItem("cinelog_database");
  localStorage.removeItem("cinelog_user_imported");
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
    } catch (e) {}
  }

  state.movies = Array.isArray(movies) ? movies : [];
  state.shows = Array.isArray(shows) ? shows : [];
  
  // 🛡️ Explicitly skip cloud sync to protect user's private Google Drive backup from being overwritten with demo
  saveLocalDatabase(true);
  return { movies: state.movies, shows: state.shows };
}

