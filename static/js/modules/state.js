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

// Global backward-compatibility window bindings
window.allMovies = state.movies;
window.allShows = state.shows;
window.userVodCountry = state.userVodCountry;
window.userVodSubscriptions = state.userVodSubscriptions;
window.currentMode = state.mode;

export function syncWindowAliases() {
  window.allMovies = state.movies;
  window.allShows = state.shows;
  window.userVodCountry = state.userVodCountry;
  window.userVodSubscriptions = state.userVodSubscriptions;
  window.currentMode = state.mode;
}

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

export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function safeUrl(value) {
  const url = String(value || "").trim();
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:image/") || url === "") return url;
  return "";
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

export function normalizeTitleForLibrary(title) {
  if (!title) return "";
  return String(title)
    .replace(/\s*\(\d{4}\)/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function getTitleVariants(itemOrTitle) {
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

export function saveLocalDatabase(skipCloudSync = false) {
  try {
    localStorage.setItem("cinelog_database", JSON.stringify({
      movies: state.movies,
      shows: state.shows,
      updated_at: new Date().toISOString()
    }));
  } catch (e) {
    console.warn("Nie udało się zapisać bazy do localStorage:", e);
  }
  syncWindowAliases();
  
  // 🛡️ CRITICAL GUARD: Never auto-sync to Google Drive if explicitly skipped or database is marked as demo
  if (!skipCloudSync && !isUserDatabaseDemo() && window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
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

export async function resetToDemoDatabase() {
  setActiveEnvMode("demo");
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

