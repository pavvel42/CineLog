// static/js/modules/state.js
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
var state = {
  movies: [],
  shows: [],
  mode: localStorage.getItem("cinelog_mode") || "movies",
  // "movies" | "shows"
  activeTab: "all",
  activeMovieTab: "all",
  activeShowTab: "all_shows",
  activeVodFilter: "all",
  sortMode: localStorage.getItem("cinelog_sort_mode") || "default",
  userVodCountry: localStorage.getItem("vod-country") || "PL",
  userVodSubscriptions: getInitialVodSubscriptions(),
  themeMode: localStorage.getItem("cinelog_theme_mode") || "dark",
  colorSeed: localStorage.getItem("cinelog_color_seed") || "#9333ea",
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
window.allMovies = state.movies;
window.allShows = state.shows;
window.userVodCountry = state.userVodCountry;
window.userVodSubscriptions = state.userVodSubscriptions;
window.currentMode = state.mode;
function syncWindowAliases() {
  window.allMovies = state.movies;
  window.allShows = state.shows;
  window.userVodCountry = state.userVodCountry;
  window.userVodSubscriptions = state.userVodSubscriptions;
  window.currentMode = state.mode;
}
function formatWatchTimeMinutes(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "0 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${mins > 0 ? mins + "m" : ""}`.trim();
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours > 0 ? remHours + "h" : ""}`.trim();
}
function getGradientForTitle(title) {
  let hash = 0;
  for (let i = 0; i < (title || "").length; i++) {
    hash = title.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 130) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 65%, 45%), hsl(${h2}, 75%, 28%))`;
}
function normalizeTitleForLibrary(title) {
  if (!title) return "";
  return String(title).replace(/\s*\(\d{4}\)/g, "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function isItemInLibrary(item) {
  const normTitle = normalizeTitleForLibrary(item.title);
  const tmdbId = item.id || item.tmdb_id;
  const inMovies = state.movies.some((m) => {
    if (tmdbId && m.tmdb_id && String(m.tmdb_id) === String(tmdbId)) return true;
    return normalizeTitleForLibrary(m.title) === normTitle;
  });
  if (inMovies) return true;
  const inShows = state.shows.some((s) => {
    if (tmdbId && s.tmdb_id && String(s.tmdb_id) === String(tmdbId)) return true;
    return normalizeTitleForLibrary(s.title) === normTitle;
  });
  return inShows;
}
function findDuplicateInLibrary(title, type = "movie", tmdbId = null) {
  const normTitle = normalizeTitleForLibrary(title);
  if (type === "series" || type === "tv") {
    return state.shows.find((s) => {
      if (tmdbId && s.tmdb_id && String(s.tmdb_id) === String(tmdbId)) return true;
      const sNorm = normalizeTitleForLibrary(s.title);
      return sNorm.length > 0 && sNorm === normTitle;
    });
  } else {
    return state.movies.find((m) => {
      if (tmdbId && m.tmdb_id && String(m.tmdb_id) === String(tmdbId)) return true;
      const mNorm = normalizeTitleForLibrary(m.title);
      return mNorm.length > 0 && mNorm === normTitle;
    });
  }
}
function generateUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function saveLocalDatabase() {
  syncWindowAliases();
  if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    window.googleDriveSync.triggerAutoSave(state.movies, state.shows);
  }
}

// static/js/modules/ui.js
function hexToHsl(hex) {
  if (!hex || typeof hex !== "string") hex = "#9333ea";
  let c = hex.replace(/^#/, "");
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  if (c.length !== 6) c = "9333ea";
  const num = parseInt(c, 16);
  if (isNaN(num)) return { h: 270, s: 70, l: 60 };
  let r = (num >> 16) / 255;
  let g = (num >> 8 & 255) / 255;
  let b = (num & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}
function applyMaterial3Theme() {
  try {
    const isSystemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    let effectiveMode = state.themeMode || "dark";
    if (effectiveMode === "system") {
      effectiveMode = isSystemDark ? "dark" : "light";
    }
    if (document.documentElement) {
      document.documentElement.setAttribute("data-theme", effectiveMode);
      const root = document.documentElement;
      const { h, s } = hexToHsl(state.colorSeed);
      if (effectiveMode === "dark") {
        root.style.setProperty("--md-sys-color-primary", `hsl(${h}, ${Math.max(s, 70)}%, 78%)`);
        root.style.setProperty("--md-sys-color-on-primary", `hsl(${h}, ${Math.max(s, 70)}%, 18%)`);
        root.style.setProperty("--md-sys-color-primary-container", `hsl(${h}, ${Math.max(s, 55)}%, 32%)`);
        root.style.setProperty("--md-sys-color-on-primary-container", `hsl(${h}, ${Math.max(s, 70)}%, 92%)`);
        root.style.setProperty("--md-sys-color-surface-tint", `hsl(${h}, ${Math.max(s, 70)}%, 78%)`);
      } else {
        root.style.setProperty("--md-sys-color-primary", `hsl(${h}, ${Math.max(s, 70)}%, 42%)`);
        root.style.setProperty("--md-sys-color-on-primary", `#ffffff`);
        root.style.setProperty("--md-sys-color-primary-container", `hsl(${h}, ${Math.max(s, 65)}%, 90%)`);
        root.style.setProperty("--md-sys-color-on-primary-container", `hsl(${h}, ${Math.max(s, 70)}%, 15%)`);
        root.style.setProperty("--md-sys-color-surface-tint", `hsl(${h}, ${Math.max(s, 70)}%, 42%)`);
      }
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute("content", effectiveMode === "dark" ? "#141218" : "#fef7ff");
    }
    document.querySelectorAll(".m3-theme-mode-btn").forEach((btn) => {
      const modeAttr = btn.getAttribute("data-theme-mode");
      if (modeAttr) btn.classList.toggle("active", modeAttr === state.themeMode);
    });
    document.querySelectorAll(".m3-color-seed-btn").forEach((btn) => {
      const seedAttr = btn.getAttribute("data-seed");
      if (seedAttr && state.colorSeed) {
        btn.classList.toggle("active", seedAttr.toLowerCase() === state.colorSeed.toLowerCase());
      }
    });
    const picker = document.getElementById("m3-color-seed-picker");
    if (picker && state.colorSeed) picker.value = state.colorSeed;
  } catch (e) {
    console.warn("applyMaterial3Theme non-fatal error:", e);
  }
}
function showToastNotification(message, type = "success") {
  let toast = document.getElementById("m3-toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "m3-toast-notification";
    toast.className = "m3-toast-notification";
    document.body.appendChild(toast);
  }
  const iconName = type === "error" ? "error" : type === "warning" ? "warning" : type === "info" ? "info" : "check_circle";
  const iconColor = type === "error" ? "#f43f5e" : type === "warning" ? "#f59e0b" : "var(--md-sys-color-inverse-primary)";
  toast.innerHTML = `
    <span class="material-symbols-rounded m3-toast-icon" style="color: ${iconColor};">${iconName}</span>
    <span class="m3-toast-message">${message}</span>
  `;
  toast.classList.remove("show");
  void toast.offsetWidth;
  toast.classList.add("show");
  if (window._m3ToastTimeout) clearTimeout(window._m3ToastTimeout);
  window._m3ToastTimeout = setTimeout(() => {
    toast.classList.remove("show");
  }, 3200);
}
function initBackdropDismiss() {
  document.querySelectorAll(".m3-bottom-sheet").forEach((sheet) => {
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) {
        sheet.classList.remove("active");
      }
    });
  });
}
function initThemeControls() {
  const sheetThemeSettings = document.getElementById("m3-sheet-theme-settings");
  const openThemeSettings = () => {
    applyMaterial3Theme();
    if (sheetThemeSettings) sheetThemeSettings.classList.add("active");
  };
  const btnThemeToggle = document.getElementById("m3-theme-toggle");
  const btnMobileThemeToggle = document.getElementById("m3-mobile-theme-toggle");
  const btnCloseThemeSettings = document.getElementById("m3-theme-settings-close");
  if (btnThemeToggle) btnThemeToggle.addEventListener("click", openThemeSettings);
  if (btnMobileThemeToggle) btnMobileThemeToggle.addEventListener("click", openThemeSettings);
  if (btnCloseThemeSettings && sheetThemeSettings) {
    btnCloseThemeSettings.addEventListener("click", () => {
      sheetThemeSettings.classList.remove("active");
    });
  }
  document.querySelectorAll(".m3-theme-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.themeMode = btn.getAttribute("data-theme-mode");
      localStorage.setItem("cinelog_theme_mode", state.themeMode);
      applyMaterial3Theme();
    });
  });
  document.querySelectorAll(".m3-color-seed-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.colorSeed = btn.getAttribute("data-seed");
      localStorage.setItem("cinelog_color_seed", state.colorSeed);
      applyMaterial3Theme();
    });
  });
  const seedPicker = document.getElementById("m3-color-seed-picker");
  if (seedPicker) {
    const customContainer = seedPicker.closest(".m3-color-seed-custom");
    if (customContainer) {
      customContainer.addEventListener("click", () => {
        seedPicker.click();
      });
    }
    seedPicker.addEventListener("input", (e) => {
      state.colorSeed = e.target.value;
      localStorage.setItem("cinelog_color_seed", state.colorSeed);
      applyMaterial3Theme();
    });
  }
}

// static/js/modules/vod.js
var TMDB_GLOBAL_VOD_MAP = {
  "Netflix": "8",
  "HBO Max": "1899|384",
  "Disney Plus": "337",
  "Amazon Prime Video": "119|9",
  "SkyShowtime": "1773",
  "Apple TV": "350|2",
  "Google Play Movies": "3",
  "YouTube Premium": "188",
  "Hulu": "15",
  "Peacock": "386|387",
  "Paramount+": "531",
  "Starz": "43",
  "MGM+": "633|34",
  "AMC+": "528",
  "CANAL+": "645|381",
  "Player": "509",
  "Polsat Box Go": "512",
  "TVP VOD": "510",
  "CDA Premium": "470",
  "Viaplay": "76",
  "Megogo": "444",
  "Cineman": "503",
  "Crunchyroll": "283",
  "MUBI": "11",
  "Curiosity Stream": "190",
  "Rakuten TV": "35",
  "BBC iPlayer": "38",
  "ITVX": "41",
  "NOW": "39",
  "Channel 4": "103",
  "My5": "333",
  "BFI Player": "445",
  "BritBox": "380",
  "RTL+": "538",
  "Joyn": "304",
  "ZDFmediathek": "532",
  "ARD Mediathek": "540",
  "MagentaTV": "486",
  "France TV": "533",
  "TF1+": "534",
  "OCS": "56",
  "Molotov": "236",
  "Arte": "234",
  "Movistar Plus+": "149",
  "Filmin": "63",
  "Atresplayer": "296",
  "RTVE Play": "548",
  "Mitele": "300",
  "RaiPlay": "222",
  "Mediaset Infinity": "553",
  "TIMVISION": "109",
  "Discovery+": "520",
  "Videoland": "72",
  "NPO Start": "544",
  "NLZIET": "550",
  "Path\xE9 Thuis": "71",
  "SVT Play": "426",
  "TV4 Play": "428",
  "NRK TV": "429",
  "TV 2 Play": "430",
  "DR TV": "424",
  "Filmstriben": "427",
  "Yle Areena": "431",
  "Ruutu": "432",
  "MTV Katsomo": "433",
  "Voyo": "395|400",
  "iVys\xEDl\xE1n\xED": "488",
  "Prima+": "1888",
  "KVIFF.TV": "1782",
  "JOJ Play": "1840",
  "RTVS": "1841",
  "Sweet.tv": "575",
  "Kyivstar TV": "576",
  "Takflix": "577",
  "Crave": "230",
  "CBC Gem": "314",
  "Global TV": "326",
  "CTV": "327",
  "Tubi TV": "73",
  "Pluto TV": "300",
  "Globoplay": "307",
  "Claro video": "167",
  "Telecine": "227",
  "Stan": "21",
  "BINGE": "385",
  "ABC iview": "368",
  "SBS On Demand": "369",
  "7plus": "370",
  "9Now": "371",
  "10 play": "372",
  "Foxtel Now": "134",
  "Kayo Sports": "389",
  "U-NEXT": "84",
  "Lemino": "1883",
  "ABEMA": "559",
  "TELASA": "489",
  "FOD": "560",
  "DMM TV": "1884",
  "TVING": "97",
  "Wavve": "356",
  "Coupang Play": "524",
  "Watcha": "96",
  "Series On": "434"
};
var COUNTRY_STREAMING_PROVIDERS = {
  "PL": {
    name: "Polska \u{1F1F5}\u{1F1F1}",
    categories: [
      {
        name: "G\u0142\xF3wne & Globalne",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "HBO Max", label: "Max / HBO", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Google Play Movies", label: "Google Play / YouTube", color: "#4285F4", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "YouTube Premium", label: "YouTube Premium", color: "#FF0000", logo: "https://image.tmdb.org/t/p/original/pTnn5JwWr4p3pG8H6VrpiQo7Vs0.jpg" }
        ]
      },
      {
        name: "Polskie i Lokalne",
        items: [
          { value: "CANAL+", label: "CANAL+ online", color: "#FFDE00", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Player", label: "Player", color: "#0076FF", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Polsat Box Go", label: "Polsat Box Go", color: "#FF6600", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "TVP VOD", label: "TVP VOD (Darmowe)", color: "#005A9C", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "CDA Premium", label: "CDA Premium", color: "#E2231A", logo: "https://image.tmdb.org/t/p/original/rZG2UBzS8ysl2kloSbrm9w4Mth2.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "Megogo", label: "Megogo", color: "#2B2B2B", logo: "https://image.tmdb.org/t/p/original/yMw8nFjA2vFvWzW9lWfC7fM7k.jpg" },
          { value: "Cineman", label: "Cineman", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/mBliLuM0AbkRPGDoVa7IGxwC59b.jpg" },
          { value: "Ninateka", label: "Ninateka (Darmowe)", color: "#009688", logo: "https://image.tmdb.org/t/p/original/vPZrjHe7wvALuwJEXT2kwYLi0gV.jpg" },
          { value: "Mojeekino", label: "Mojeekino", color: "#E91E63", logo: "https://image.tmdb.org/t/p/original/fbveJTcro9Xw2KuPIIoPPePHiwy.jpg" }
        ]
      },
      {
        name: "Anime & Kino Autorskie",
        items: [
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" },
          { value: "MUBI", label: "MUBI", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Curiosity Stream", label: "Curiosity Stream", color: "#FFBF00", logo: "https://image.tmdb.org/t/p/original/oR1aNm1Qu9jQBkW4VrGPWhqbC3P.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" }
        ]
      }
    ]
  },
  "US": {
    name: "Stany Zjednoczone \u{1F1FA}\u{1F1F8}",
    categories: [
      {
        name: "G\u0142\xF3wne & Subskrypcyjne (USA)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "HBO Max", label: "Max (HBO)", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Hulu", label: "Hulu", color: "#1CE783", logo: "https://image.tmdb.org/t/p/original/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg" },
          { value: "Peacock", label: "Peacock", color: "#000000", logo: "https://image.tmdb.org/t/p/original/2aGrp1xw3qhwCYvNGAJZPdjfeeX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Starz", label: "Starz", color: "#000000", logo: "https://image.tmdb.org/t/p/original/8Z8j1nfg7jU3A1k4sK9Q5vK6f1.jpg" },
          { value: "MGM+", label: "MGM+", color: "#C59B27", logo: "https://image.tmdb.org/t/p/original/efu1Cqc63XrPBoreYnf2mn0Nizj.jpg" },
          { value: "AMC+", label: "AMC+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/9b2Y7m6c7a8b9c0d1e2f3a4b5c.jpg" },
          { value: "Google Play Movies", label: "Google TV", color: "#4285F4", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "YouTube Premium", label: "YouTube Premium", color: "#FF0000", logo: "https://image.tmdb.org/t/p/original/pTnn5JwWr4p3pG8H6VrpiQo7Vs0.jpg" }
        ]
      },
      {
        name: "Darmowe & Niszowe (USA)",
        items: [
          { value: "Tubi TV", label: "Tubi TV (Free)", color: "#FF5A00", logo: "https://image.tmdb.org/t/p/original/7k9s0z1.jpg" },
          { value: "Pluto TV", label: "Pluto TV (Free)", color: "#000000", logo: "https://image.tmdb.org/t/p/original/8k0s1z2.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" },
          { value: "MUBI", label: "MUBI", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" }
        ]
      }
    ]
  },
  "GB": {
    name: "Wielka Brytania \u{1F1EC}\u{1F1E7}",
    categories: [
      {
        name: "G\u0142\xF3wne (UK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "BBC iPlayer", label: "BBC iPlayer", color: "#FF004E", logo: "https://image.tmdb.org/t/p/original/4ka5sB9922k10Z9eZtG5xXWfFv1.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "NOW", label: "NOW (Sky)", color: "#003349", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Channel 4", label: "Channel 4", color: "#00B4B4", logo: "https://image.tmdb.org/t/p/original/m6N5p8tZ9VpX4c6qYw5tN8p2Y.jpg" },
          { value: "ITVX", label: "ITVX", color: "#10B981", logo: "https://image.tmdb.org/t/p/original/b2vX2B2aP1r9d7XW2ZpX5p6p7v7.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "BritBox", label: "BritBox", color: "#001A9C", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "DE": {
    name: "Niemcy \u{1F1E9}\u{1F1EA}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (DE)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "NOW", label: "WOW (Sky)", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "RTL+", label: "RTL+", color: "#FF004E", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Joyn", label: "Joyn", color: "#00FF00", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "ZDFmediathek", label: "ZDFmediathek", color: "#FA7D00", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "ARD Mediathek", label: "ARD Mediathek", color: "#002D5A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "MagentaTV", label: "MagentaTV", color: "#E20074", logo: "https://image.tmdb.org/t/p/original/E20074.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "FR": {
    name: "Francja \u{1F1EB}\u{1F1F7}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (FR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "France TV", label: "france.tv", color: "#0055A5", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TF1+", label: "TF1+", color: "#003A70", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "OCS", label: "OCS", color: "#FF5500", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Arte", label: "Arte", color: "#FA5000", logo: "https://image.tmdb.org/t/p/original/Arte.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "ES": {
    name: "Hiszpania \u{1F1EA}\u{1F1F8}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (ES)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Movistar Plus+", label: "Movistar Plus+", color: "#00A9E0", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Filmin", label: "Filmin", color: "#00FFA3", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Atresplayer", label: "Atresplayer", color: "#E20613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "RTVE Play", label: "RTVE Play", color: "#004488", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "IT": {
    name: "W\u0142ochy \u{1F1EE}\u{1F1F9}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (IT)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "NOW", label: "NOW (Sky)", color: "#003349", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "RaiPlay", label: "RaiPlay (Darmowe)", color: "#002D62", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Mediaset Infinity", label: "Mediaset Infinity", color: "#FF9900", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "TIMVISION", label: "TIMVISION", color: "#003399", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "NL": {
    name: "Holandia \u{1F1F3}\u{1F1F1}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (NL)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Videoland", label: "Videoland", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max / HBO", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "NPO Start", label: "NPO Start", color: "#FF5900", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "NLZIET", label: "NLZIET", color: "#00B4D8", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Path\xE9 Thuis", label: "Path\xE9 Thuis", color: "#FFDE00", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "SE": {
    name: "Szwecja \u{1F1F8}\u{1F1EA}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (SE)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "SVT Play", label: "SVT Play (Darmowe)", color: "#00A499", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV4 Play", label: "TV4 Play", color: "#E4002B", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "NO": {
    name: "Norwegia \u{1F1F3}\u{1F1F4}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (NO)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "NRK TV", label: "NRK TV (Darmowe)", color: "#0047BA", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV 2 Play", label: "TV 2 Play", color: "#D4001A", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Discovery+", label: "Discovery+", color: "#003366", logo: "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "DK": {
    name: "Dania \u{1F1E9}\u{1F1F0}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (DK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "DR TV", label: "DR TV (Darmowe)", color: "#101010", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "TV 2 Play", label: "TV 2 Play", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Filmstriben", label: "Filmstriben (Darmowe)", color: "#F39200", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "FI": {
    name: "Finlandia \u{1F1EB}\u{1F1EE}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (FI)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Yle Areena", label: "Yle Areena (Darmowe)", color: "#0098A6", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Ruutu", label: "Ruutu", color: "#E6007E", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "MTV Katsomo", label: "MTV Katsomo", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Viaplay", label: "Viaplay", color: "#E0004D", logo: "https://image.tmdb.org/t/p/original/sElGn8Ml7yYKuAsceZYQ0nKpqHa.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "CZ": {
    name: "Czechy \u{1F1E8}\u{1F1FF}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (CZ)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Voyo", label: "Voyo", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "iVys\xEDl\xE1n\xED", label: "iVys\xEDl\xE1n\xED \u010CT (Darmowe)", color: "#003366", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Prima+", label: "Prima+", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "KVIFF.TV", label: "KVIFF.TV", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "SK": {
    name: "S\u0142owacja \u{1F1F8}\u{1F1F0}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (SK)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Voyo", label: "Voyo", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "SkyShowtime", label: "SkyShowtime", color: "#00FF85", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "JOJ Play", label: "JOJ Play", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "RTVS", label: "RTVS (Darmowe)", color: "#003366", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "CANAL+", label: "CANAL+", color: "#1A1A1A", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "UA": {
    name: "Ukraina \u{1F1FA}\u{1F1E6}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (UA)",
        items: [
          { value: "Megogo", label: "Megogo", color: "#2B2B2B", logo: "https://image.tmdb.org/t/p/original/yMw8nFjA2vFvWzW9lWfC7fM7k.jpg" },
          { value: "Sweet.tv", label: "Sweet.tv", color: "#FF5500", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Kyivstar TV", label: "Kyivstar TV", color: "#007AFF", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Takflix", label: "Takflix", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "CA": {
    name: "Kanada \u{1F1E8}\u{1F1E6}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (CA)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Crave", label: "Crave (HBO/Starz)", color: "#0033A0", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "CBC Gem", label: "CBC Gem (Darmowe)", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Global TV", label: "Global TV", color: "#00A859", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "CTV", label: "CTV", color: "#003399", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Tubi TV", label: "Tubi TV", color: "#FF5A00", logo: "https://image.tmdb.org/t/p/original/7k9s0z1.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "BR": {
    name: "Brazylia \u{1F1E7}\u{1F1F7}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (BR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Globoplay", label: "Globoplay", color: "#FB0038", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "HBO Max", label: "Max", color: "#5822b4", logo: "https://image.tmdb.org/t/p/original/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "Claro video", label: "Claro video", color: "#E30613", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Telecine", label: "Telecine", color: "#ED1C24", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Starz", label: "Lionsgate+ (Starz)", color: "#000000", logo: "https://image.tmdb.org/t/p/original/8Z8j1nfg7jU3A1k4sK9Q5vK6f1.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "AU": {
    name: "Australia \u{1F1E6}\u{1F1FA}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (AU)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "Stan", label: "Stan", color: "#0071CE", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "BINGE", label: "BINGE", color: "#FF007A", logo: "https://image.tmdb.org/t/p/original/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Paramount+", label: "Paramount+", color: "#0064FF", logo: "https://image.tmdb.org/t/p/original/fts6X10Jn4QT0X6ac3udKEn2tJA.jpg" },
          { value: "ABC iview", label: "ABC iview (Darmowe)", color: "#009688", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "SBS On Demand", label: "SBS On Demand", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "7plus", label: "7plus", color: "#ED1C24", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "9Now", label: "9Now", color: "#0055FF", logo: "https://image.tmdb.org/t/p/original/9Now.jpg" },
          { value: "10 play", label: "10 play", color: "#00B4D8", logo: "https://image.tmdb.org/t/p/original/10play.jpg" },
          { value: "Foxtel Now", label: "Foxtel Now", color: "#FF6600", logo: "https://image.tmdb.org/t/p/original/Foxtel.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "JP": {
    name: "Japonia \u{1F1EF}\u{1F1F5}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (JP)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "U-NEXT", label: "U-NEXT", color: "#002B49", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Hulu", label: "Hulu Japan", color: "#1CE783", logo: "https://image.tmdb.org/t/p/original/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Lemino", label: "Lemino / dTV", color: "#E4007F", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "ABEMA", label: "ABEMA", color: "#00FF7F", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "TELASA", label: "TELASA", color: "#FF4500", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "FOD", label: "FOD", color: "#003366", logo: "https://image.tmdb.org/t/p/original/FOD.jpg" },
          { value: "DMM TV", label: "DMM TV", color: "#FFD700", logo: "https://image.tmdb.org/t/p/original/DMM.jpg" },
          { value: "Rakuten TV", label: "Rakuten TV", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  },
  "KR": {
    name: "Korea Po\u0142udniowa \u{1F1F0}\u{1F1F7}",
    categories: [
      {
        name: "G\u0142\xF3wne & Lokalne (KR)",
        items: [
          { value: "Netflix", label: "Netflix", color: "#E50914", logo: "https://image.tmdb.org/t/p/original/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
          { value: "TVING", label: "TVING", color: "#FF153C", logo: "https://image.tmdb.org/t/p/original/qgGvfpnevWSs5tRyfoCOj4fAfHk.jpg" },
          { value: "Wavve", label: "Wavve", color: "#1351F9", logo: "https://image.tmdb.org/t/p/original/jhMNVBV2UocEGepRkr9oFPD7Gpb.jpg" },
          { value: "Coupang Play", label: "Coupang Play", color: "#00A8FF", logo: "https://image.tmdb.org/t/p/original/2YCt92ETw8xLXxhkURtMjZnzfKT.jpg" },
          { value: "Disney Plus", label: "Disney+", color: "#113CCF", logo: "https://image.tmdb.org/t/p/original/97yvRBw1GzX7fXprcF80er19ot.jpg" },
          { value: "Watcha", label: "Watcha", color: "#FF0558", logo: "https://image.tmdb.org/t/p/original/fj94cKNCHf4LTo31kFkWkGqf3e0.jpg" },
          { value: "Amazon Prime Video", label: "Prime Video", color: "#00A8E1", logo: "https://image.tmdb.org/t/p/original/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
          { value: "Apple TV", label: "Apple TV+", color: "#A3AAAE", logo: "https://image.tmdb.org/t/p/original/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
          { value: "Series On", label: "Naver Series On", color: "#00C73C", logo: "https://image.tmdb.org/t/p/original/mhsYsVY18PVcVh76y2XFrodqbBD.jpg" },
          { value: "Crunchyroll", label: "Crunchyroll", color: "#F47521", logo: "https://image.tmdb.org/t/p/original/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg" }
        ]
      }
    ]
  }
};
function getProvidersForCountry(country) {
  if (COUNTRY_STREAMING_PROVIDERS[country]) {
    return COUNTRY_STREAMING_PROVIDERS[country];
  }
  return COUNTRY_STREAMING_PROVIDERS["PL"];
}
function getCountryDisplayName(country) {
  const map = {
    "PL": "Polska \u{1F1F5}\u{1F1F1}",
    "US": "Stany Zjednoczone (USA) \u{1F1FA}\u{1F1F8}",
    "GB": "Wielka Brytania \u{1F1EC}\u{1F1E7}",
    "DE": "Niemcy \u{1F1E9}\u{1F1EA}",
    "FR": "Francja \u{1F1EB}\u{1F1F7}",
    "ES": "Hiszpania \u{1F1EA}\u{1F1F8}",
    "IT": "W\u0142ochy \u{1F1EE}\u{1F1F9}",
    "NL": "Holandia \u{1F1F3}\u{1F1F1}",
    "SE": "Szwecja \u{1F1F8}\u{1F1EA}",
    "NO": "Norwegia \u{1F1F3}\u{1F1F4}",
    "DK": "Dania \u{1F1E9}\u{1F1F0}",
    "FI": "Finlandia \u{1F1EB}\u{1F1EE}",
    "CZ": "Czechy \u{1F1E8}\u{1F1FF}",
    "SK": "S\u0142owacja \u{1F1F8}\u{1F1F0}",
    "UA": "Ukraina \u{1F1FA}\u{1F1E6}",
    "CA": "Kanada \u{1F1E8}\u{1F1E6}",
    "BR": "Brazylia \u{1F1E7}\u{1F1F7}",
    "AU": "Australia \u{1F1E6}\u{1F1FA}",
    "JP": "Japonia \u{1F1EF}\u{1F1F5}",
    "KR": "Korea Po\u0142udniowa \u{1F1F0}\u{1F1F7}"
  };
  return map[country] || country;
}
function getUserLanguage() {
  const map = {
    "PL": "pl-PL",
    "US": "en-US",
    "GB": "en-GB",
    "DE": "de-DE",
    "FR": "fr-FR",
    "ES": "es-ES",
    "IT": "it-IT",
    "NL": "nl-NL",
    "SE": "sv-SE",
    "NO": "no-NO",
    "DK": "da-DK",
    "FI": "fi-FI",
    "CZ": "cs-CZ",
    "SK": "sk-SK",
    "UA": "uk-UA",
    "CA": "en-CA",
    "BR": "pt-BR",
    "AU": "en-AU",
    "JP": "ja-JP",
    "KR": "ko-KR"
  };
  return map[state.userVodCountry] || "pl-PL";
}
function renderVodSubscriptionsChecklist(country) {
  const container = document.getElementById("m3-vod-subscriptions-list");
  if (!container) return;
  container.innerHTML = "";
  const config = getProvidersForCountry(country);
  config.categories.forEach((cat) => {
    const catBlock = document.createElement("div");
    catBlock.style.marginBottom = "10px";
    catBlock.innerHTML = `
      <div style="font-size: 0.75rem; font-weight: 700; color: var(--md-sys-color-primary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
        <span class="material-symbols-rounded" style="font-size: 16px;">category</span>
        <span>${cat.name}</span>
      </div>
      <div class="m3-vod-cat-grid"></div>
    `;
    const grid = catBlock.querySelector(".m3-vod-cat-grid");
    cat.items.forEach((item) => {
      const isChecked = (state.userVodSubscriptions || []).includes(item.value);
      const label = document.createElement("label");
      label.className = `m3-vod-check-item ${isChecked ? "active" : ""}`;
      const logoHtml = item.logo ? `<img src="${item.logo}" alt="${item.label}" class="m3-vod-item-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';"><span class="m3-vod-dot" style="background-color: ${item.color || "#888"}; display: none;"></span>` : `<span class="m3-vod-dot" style="background-color: ${item.color || "#888"};"></span>`;
      label.innerHTML = `
        <input type="checkbox" value="${item.value}" ${isChecked ? "checked" : ""} style="display: none;">
        <span class="material-symbols-rounded m3-vod-item-check" style="font-size: 20px; color: ${isChecked ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline-variant)"}; flex-shrink: 0;">
          ${isChecked ? "check_box" : "check_box_outline_blank"}
        </span>
        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex-grow: 1;">
          ${logoHtml}
          <span style="font-size: 0.82rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.label}</span>
        </div>
      `;
      const input = label.querySelector("input");
      if (input) {
        input.addEventListener("change", () => {
          const isNowChecked = input.checked;
          label.classList.toggle("active", isNowChecked);
          const icon = label.querySelector(".m3-vod-item-check");
          if (icon) {
            icon.innerText = isNowChecked ? "check_box" : "check_box_outline_blank";
            icon.style.color = isNowChecked ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline-variant)";
          }
        });
      }
      grid.appendChild(label);
    });
    container.appendChild(catBlock);
  });
}
async function hydrateVodCache() {
  try {
    const res = await fetch(`/api/vod_cache_all?region=${state.userVodCountry}`);
    if (res.ok) {
      const data = await res.json();
      Object.keys(data).forEach((key) => {
        state.vodCache[key] = data[key];
      });
    }
  } catch (e) {
  }
}
async function getWatchProvidersForTitle(title, mediaType, tmdbId = null) {
  const cleanTitle = (title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
  if (state.vodCache[cacheKey] && state.vodCache[cacheKey].found && !tmdbId) {
    return state.vodCache[cacheKey];
  }
  try {
    let url = `/api/watch_providers?title=${encodeURIComponent(cleanTitle)}&type=${mediaType}&region=${state.userVodCountry}`;
    if (tmdbId) {
      url += `&tmdb_id=${encodeURIComponent(tmdbId)}`;
    }
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.found) {
        state.vodCache[cacheKey] = data;
      }
      return data;
    }
  } catch (e) {
    console.error("VOD Fetch error:", e);
  }
  const empty = { found: false, flatrate: [], rent: [], buy: [], free: [] };
  state.vodCache[cacheKey] = empty;
  return empty;
}
function matchVodFilter(title, mediaType) {
  if (state.activeVodFilter === "all") return true;
  const cleanTitle = (title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
  const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
  const data = state.vodCache[cacheKey];
  if (!data || !data.found) return false;
  const streamingList = [...data.flatrate || [], ...data.free || []];
  const streamNames = streamingList.map((p) => (p.name || "").toLowerCase());
  if (state.activeVodFilter === "my_vod") {
    const subList = state.userVodSubscriptions.map((s) => s.toLowerCase());
    return streamNames.some((name) => subList.some((sub) => name.includes(sub) || sub.includes(name)));
  }
  const target = state.activeVodFilter.toLowerCase();
  return streamNames.some((name) => name.includes(target) || target.includes(name));
}
async function ensureVodDataForVisible(items, mediaType, onProgress, onComplete) {
  const missing = items.filter((item) => {
    const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
    const cacheKey = `${mediaType}_${state.userVodCountry}_${cleanTitle}`;
    return !state.vodCache[cacheKey];
  });
  if (missing.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  const total = missing.length;
  let processed = 0;
  const banner = document.getElementById("m3-vod-loading-banner");
  const countEl = document.getElementById("m3-vod-loading-count");
  const progressBar = document.getElementById("m3-vod-progress-bar");
  if (banner) banner.style.display = "block";
  const chunkSize = 4;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const chunk = missing.slice(i, i + chunkSize);
    await Promise.all(chunk.map(async (item) => {
      await getWatchProvidersForTitle(item.title, mediaType, item.tmdb_id || item.id);
      processed++;
      const pct = Math.round(processed / total * 100);
      if (countEl) countEl.innerText = `${processed}/${total} (${pct}%)`;
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (onProgress) onProgress(processed, total);
    }));
  }
  if (banner) {
    setTimeout(() => {
      banner.style.display = "none";
    }, 400);
  }
  if (onComplete) onComplete();
}
function renderTopVodFilterBar(country, onFilterChange) {
  const bar = document.getElementById("m3-vod-filter-bar");
  if (!bar) return;
  bar.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.className = `m3-vod-chip ${state.activeVodFilter === "all" ? "active" : ""}`;
  allBtn.setAttribute("data-vod", "all");
  allBtn.title = "Wszystkie pozycje w bibliotece";
  allBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 17px;">public</span><span class="m3-desktop-only-text">Wszystkie</span>`;
  bar.appendChild(allBtn);
  const myVodBtn = document.createElement("button");
  myVodBtn.className = `m3-vod-chip icon-only ${state.activeVodFilter === "my_vod" ? "active" : ""}`;
  myVodBtn.setAttribute("data-vod", "my_vod");
  myVodBtn.id = "m3-chip-my-vod";
  myVodBtn.title = "Moje VOD (Aktywne subskrypcje)";
  myVodBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px; color: var(--md-sys-color-primary);">star</span>`;
  bar.appendChild(myVodBtn);
  const favBtn = document.createElement("button");
  favBtn.className = `m3-vod-chip icon-only m3-mobile-fav-chip ${state.activeVodFilter === "fav" ? "active" : ""}`;
  favBtn.setAttribute("data-vod", "fav");
  favBtn.id = "m3-chip-fav";
  favBtn.title = "Tylko ulubione pozycje (\u2764\uFE0F)";
  favBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px; color: var(--md-sys-color-favorite);">favorite</span>`;
  bar.appendChild(favBtn);
  const config = getProvidersForCountry(country);
  const chipsList = [];
  config.categories.forEach((cat) => {
    cat.items.forEach((item) => chipsList.push(item));
  });
  chipsList.slice(0, 18).forEach((item) => {
    const btn = document.createElement("button");
    btn.className = `m3-vod-chip icon-only ${state.activeVodFilter === item.value ? "active" : ""}`;
    btn.setAttribute("data-vod", item.value);
    btn.title = item.label;
    const logoHtml = item.logo ? `<img src="${item.logo}" alt="${item.label}" class="m3-vod-chip-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='inline-block';"><span class="m3-vod-dot" style="background-color: ${item.color || "var(--md-sys-color-primary)"}; display: none;"></span>` : `<span class="m3-vod-dot" style="background-color: ${item.color || "var(--md-sys-color-primary)"};"></span>`;
    btn.innerHTML = logoHtml;
    bar.appendChild(btn);
  });
  bar.querySelectorAll(".m3-vod-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      bar.querySelectorAll(".m3-vod-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.activeVodFilter = chip.getAttribute("data-vod");
      if (onFilterChange) onFilterChange();
    });
  });
}
function initVodSettingsHandlers(onSettingsSaved) {
  const sheetVodSettings = document.getElementById("m3-sheet-vod-settings");
  const vodCountrySelect = document.getElementById("m3-vod-country-select");
  if (vodCountrySelect) {
    vodCountrySelect.addEventListener("change", (e) => {
      renderVodSubscriptionsChecklist(e.target.value);
    });
  }
  const openVodSettings = () => {
    if (vodCountrySelect) vodCountrySelect.value = state.userVodCountry;
    renderVodSubscriptionsChecklist(state.userVodCountry);
    if (sheetVodSettings) sheetVodSettings.classList.add("active");
  };
  const btnOpen = document.getElementById("m3-btn-open-vod-settings");
  const btnMobile = document.getElementById("m3-mobile-vod-settings");
  const btnClose = document.getElementById("m3-vod-settings-close");
  const btnSave = document.getElementById("m3-btn-save-vod-settings");
  if (btnOpen) btnOpen.addEventListener("click", openVodSettings);
  if (btnMobile) btnMobile.addEventListener("click", openVodSettings);
  if (btnClose && sheetVodSettings) {
    btnClose.addEventListener("click", () => {
      sheetVodSettings.classList.remove("active");
    });
  }
  if (btnSave) {
    btnSave.addEventListener("click", () => {
      const prevCountry = state.userVodCountry;
      state.userVodCountry = vodCountrySelect ? vodCountrySelect.value : "PL";
      localStorage.setItem("vod-country", state.userVodCountry);
      const checked = [];
      document.querySelectorAll("#m3-vod-subscriptions-list input:checked").forEach((chk) => {
        checked.push(chk.value);
      });
      state.userVodSubscriptions = checked;
      localStorage.setItem("vod-subscriptions", JSON.stringify(checked));
      if (sheetVodSettings) sheetVodSettings.classList.remove("active");
      if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
        window.googleDriveSync.uploadSettingsToDrive(state.userVodCountry, state.userVodSubscriptions);
      }
      renderTopVodFilterBar(state.userVodCountry, onSettingsSaved);
      if (prevCountry !== state.userVodCountry) {
        hydrateVodCache();
      }
      showToastNotification("Zapisano preferencje VOD!");
      if (onSettingsSaved) onSettingsSaved();
    });
  }
}

// static/js/modules/cast.js
function normalizeTitleForMatch(str) {
  if (!str) return "";
  return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function renderCastRail(containerId, castList = [], directorsList = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  const peopleMap = /* @__PURE__ */ new Map();
  (directorsList || []).forEach((d) => {
    if (!d || !d.name) return;
    const key = d.id ? `id_${d.id}` : `name_${normalizeTitleForMatch(d.name)}`;
    peopleMap.set(key, {
      id: d.id,
      name: d.name,
      roles: [d.job || "Re\u017Cyser"],
      isCrew: true,
      profile_url: d.profile_url
    });
  });
  (castList || []).forEach((c) => {
    if (!c || !c.name) return;
    const key = c.id ? `id_${c.id}` : `name_${normalizeTitleForMatch(c.name)}`;
    const charRole = c.character ? `jako ${c.character}` : "Aktor";
    if (peopleMap.has(key)) {
      const existing = peopleMap.get(key);
      if (!existing.roles.includes(charRole)) {
        existing.roles.push(charRole);
      }
      if (!existing.profile_url && c.profile_url) {
        existing.profile_url = c.profile_url;
      }
      if (!existing.id && c.id) {
        existing.id = c.id;
      }
    } else {
      peopleMap.set(key, {
        id: c.id,
        name: c.name,
        roles: [charRole],
        isCrew: false,
        profile_url: c.profile_url
      });
    }
  });
  const uniquePeople = Array.from(peopleMap.values());
  if (uniquePeople.length === 0) {
    const parentSection = container.closest(".m3-cast-section") || container.parentElement;
    if (parentSection) parentSection.style.display = "none";
    return;
  }
  uniquePeople.forEach((p) => {
    const card = document.createElement("div");
    card.className = "m3-cast-card";
    const combinedRole = p.roles.join(" \u2022 ");
    card.title = `${p.name} (${combinedRole})`;
    const photoHtml = p.profile_url ? `<img src="${p.profile_url}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-cast-photo-fallback" style="display: none;"><span class="material-symbols-rounded" style="font-size: 24px; opacity: 0.85;">person</span></div>` : `<div class="m3-cast-photo-fallback"><span class="material-symbols-rounded" style="font-size: 24px; opacity: 0.85;">person</span></div>`;
    card.innerHTML = `
      <div class="m3-cast-photo-box">
        ${photoHtml}
      </div>
      <div class="m3-cast-name">${p.name}</div>
      <div class="m3-cast-character" style="${p.isCrew ? "color: var(--md-sys-color-primary); font-weight: 600;" : ""}">${combinedRole}</div>
    `;
    card.addEventListener("click", (e) => {
      e.stopPropagation();
      openActorProfile(p.id, p.name);
    });
    container.appendChild(card);
  });
}
async function openActorProfile(personId, personName) {
  const sheet = document.getElementById("m3-sheet-actor");
  if (!sheet) return;
  document.getElementById("m3-actor-name").innerText = personName;
  document.getElementById("m3-actor-bio").innerText = "Wczytywanie informacji o aktorze...";
  document.getElementById("m3-actor-meta-row").innerHTML = `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px; animation: spin 1s linear infinite;">sync</span> Pobieram filmografi\u0119...</span>`;
  const avatarImg = document.getElementById("m3-actor-avatar");
  const avatarFallback = document.getElementById("m3-actor-avatar-fallback");
  avatarImg.style.display = "none";
  avatarFallback.style.display = "flex";
  const watchedSec = document.getElementById("m3-actor-watched-section");
  const watchlistSec = document.getElementById("m3-actor-watchlist-section");
  const watchedGrid = document.getElementById("m3-actor-watched-grid");
  const watchlistGrid = document.getElementById("m3-actor-watchlist-grid");
  const recSec = document.getElementById("m3-actor-recommendations-section");
  const recGrid = document.getElementById("m3-actor-recommendations-grid");
  const recLoading = document.getElementById("m3-actor-rec-loading");
  watchedSec.style.display = "none";
  watchlistSec.style.display = "none";
  watchedGrid.innerHTML = "";
  watchlistGrid.innerHTML = "";
  recGrid.innerHTML = "";
  recLoading.style.display = "flex";
  sheet.classList.add("active");
  try {
    const res = await fetch(`/api/actor/details?id=${personId || ""}&name=${encodeURIComponent(personName)}&lang=${getUserLanguage()}`);
    const data = res.ok ? await res.json() : {
      name: personName,
      biography: "Tw\xF3rca niezale\u017Cny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).",
      filmography: []
    };
    document.getElementById("m3-actor-name").innerText = data.name || personName;
    document.getElementById("m3-actor-bio").innerText = data.biography || "Tw\xF3rca niezale\u017Cny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).";
    if (data.profile_url) {
      avatarImg.src = data.profile_url;
      avatarImg.style.display = "block";
      avatarFallback.style.display = "none";
    }
    const metaRow = document.getElementById("m3-actor-meta-row");
    metaRow.innerHTML = "";
    if (data.known_for_department) {
      const deptLabel = data.known_for_department === "Acting" ? "Aktor / Aktorka" : data.known_for_department === "Directing" ? "Re\u017Cyser" : data.known_for_department;
      metaRow.innerHTML += `<span class="m3-meta-badge highlight">${deptLabel}</span>`;
    }
    if (data.birthday) {
      const birthYear = data.birthday.split("-")[0];
      const age = data.deathday ? `\u2020 (${data.birthday} - ${data.deathday})` : `${(/* @__PURE__ */ new Date()).getFullYear() - parseInt(birthYear)} lat`;
      metaRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">cake</span> ${age}</span>`;
    }
    if (data.place_of_birth) {
      metaRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">location_on</span> ${data.place_of_birth.split(",").slice(-2).join(",").trim()}</span>`;
    }
    const filmography = data.filmography || [];
    const isFilmInLib = (f, libItem) => {
      if (f.tmdb_id && libItem.tmdb_id && String(f.tmdb_id) === String(libItem.tmdb_id)) return true;
      const libTitle = normalizeTitleForMatch(libItem.title);
      const fTitle1 = normalizeTitleForMatch(f.title);
      const fTitle2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
      return fTitle1 && libTitle === fTitle1 || fTitle2 && libTitle === fTitle2;
    };
    const watchedInLib = [];
    const watchlistInLib = [];
    const matchedFilmographyKeys = /* @__PURE__ */ new Set();
    const normSearchName = normalizeTitleForMatch(personName);
    state.movies.forEach((m) => {
      const match = filmography.find((f) => isFilmInLib(f, m));
      const textMatch = m.director && normalizeTitleForMatch(m.director).includes(normSearchName) || m.actors && normalizeTitleForMatch(m.actors).includes(normSearchName);
      if (match || textMatch) {
        if (match) {
          matchedFilmographyKeys.add(`${match.type || "movie"}_${match.tmdb_id}`);
          matchedFilmographyKeys.add(normalizeTitleForMatch(match.title));
          if (match.original_title) matchedFilmographyKeys.add(normalizeTitleForMatch(match.original_title));
        }
        if (m.status === "watched") watchedInLib.push({ ...m, itemType: "movie" });
        else watchlistInLib.push({ ...m, itemType: "movie" });
      }
    });
    state.shows.forEach((s) => {
      const match = filmography.find((f) => isFilmInLib(f, s));
      const textMatch = s.director && normalizeTitleForMatch(s.director).includes(normSearchName) || s.actors && normalizeTitleForMatch(s.actors).includes(normSearchName);
      if (match || textMatch) {
        if (match) {
          matchedFilmographyKeys.add(`${match.type || "series"}_${match.tmdb_id}`);
          matchedFilmographyKeys.add(normalizeTitleForMatch(match.title));
          if (match.original_title) matchedFilmographyKeys.add(normalizeTitleForMatch(match.original_title));
        }
        if (s.watched_count > 0 || s.status === "watched") watchedInLib.push({ ...s, itemType: "show" });
        else watchlistInLib.push({ ...s, itemType: "show" });
      }
    });
    if (watchedInLib.length > 0) {
      document.getElementById("m3-actor-watched-count").innerText = `${watchedInLib.length} ${watchedInLib.length === 1 ? "pozycja" : "pozycji"}`;
      watchedInLib.forEach((item) => {
        watchedGrid.appendChild(createActorLibCard(item));
      });
      watchedSec.style.display = "flex";
    }
    if (watchlistInLib.length > 0) {
      document.getElementById("m3-actor-watchlist-count").innerText = `${watchlistInLib.length} ${watchlistInLib.length === 1 ? "pozycja" : "pozycji"}`;
      watchlistInLib.forEach((item) => {
        watchlistGrid.appendChild(createActorLibCard(item));
      });
      watchlistSec.style.display = "flex";
    }
    recLoading.style.display = "none";
    const recommendations = filmography.filter((f) => {
      const key = `${f.type || "movie"}_${f.tmdb_id}`;
      const n1 = normalizeTitleForMatch(f.title);
      const n2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
      if (matchedFilmographyKeys.has(key) || matchedFilmographyKeys.has(n1) || n2 && matchedFilmographyKeys.has(n2)) return false;
      return !isItemInLibrary(f);
    }).slice(0, 15);
    if (recommendations.length > 0) {
      recommendations.forEach((rec) => {
        const card = document.createElement("div");
        card.className = "m3-actor-item-card";
        const posterSrc = rec.poster_url || "";
        card.innerHTML = `
          ${posterSrc ? `<img src="${posterSrc}" alt="${rec.title}" class="m3-actor-item-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>`}
          <div class="m3-actor-item-body">
            <div class="m3-actor-item-title">${rec.title}</div>
            <div class="m3-actor-item-meta">
              <span>${rec.year || ""}</span>
              ${rec.vote_average ? `<span style="font-weight: 700; color: #f59e0b; display: inline-flex; align-items: center; gap: 2px;">\u2605 ${rec.vote_average}</span>` : ""}
            </div>
            <button type="button" class="m3-actor-add-btn" title="Dodaj do kolejki 'Do obejrzenia'">
              <span class="material-symbols-rounded" style="font-size: 14px;">bookmark_add</span>
              <span>+ Do obejrzenia</span>
            </button>
          </div>
        `;
        const addBtn = card.querySelector(".m3-actor-add-btn");
        addBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          addBtn.disabled = true;
          addBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 14px; animation: spin 1s linear infinite;">sync</span> Dodaj\u0119...`;
          await quickAddToWatchlist(rec, addBtn);
          addBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 14px; color: #10b981;">check</span> Dodano!`;
          addBtn.style.background = "rgba(16, 185, 129, 0.2)";
          addBtn.style.color = "#10b981";
        });
        card.addEventListener("click", () => {
          if (window.openPreviewVod) {
            window.openPreviewVod(rec.title, rec.type || "movie", rec.tmdb_id);
          }
        });
        recGrid.appendChild(card);
      });
    } else {
      recGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.8rem;">Brak dodatkowych rekomendacji. Masz ju\u017C w bibliotece wszystkie najwa\u017Cniejsze dzie\u0142a tego tw\xF3rcy! \u{1F389}</div>`;
    }
  } catch (err) {
    console.error("Error loading actor details:", err);
    document.getElementById("m3-actor-bio").innerText = "Wyst\u0105pi\u0142 b\u0142\u0105d podczas wczytywania profilu aktora.";
    recLoading.style.display = "none";
  }
}
function createActorLibCard(item) {
  const card = document.createElement("div");
  card.className = "m3-actor-item-card";
  const posterSrc = item.poster_url || "";
  const isShow = item.itemType === "show";
  const statusLabel = item.status === "watched" || item.watched_count > 0 ? item.rating ? `${item.rating}\u2605` : "Obejrzane" : "Do obejrzenia";
  card.innerHTML = `
    ${posterSrc ? `<img src="${posterSrc}" alt="${item.title}" class="m3-actor-item-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>`}
    <div class="m3-actor-item-body">
      <div class="m3-actor-item-title">${item.title}</div>
      <div class="m3-actor-item-meta">
        <span>${item.release_date ? item.release_date.split("-")[0] : item.release_year || ""}</span>
        <span style="font-weight: 700; color: var(--md-sys-color-primary);">${statusLabel}</span>
      </div>
    </div>
  `;
  card.addEventListener("click", () => {
    document.getElementById("m3-sheet-actor").classList.remove("active");
    if (isShow && window.openEpisodeTracker) {
      window.openEpisodeTracker(item);
    } else if (window.openMovieDetail) {
      window.openMovieDetail(item);
    }
  });
  return card;
}
async function quickAddToWatchlist(item) {
  const isShow = item.type === "tv" || item.type === "series";
  const payload = {
    title: item.title,
    type: isShow ? "series" : "movie",
    status: "watchlist",
    rating: null,
    tmdb_id: item.tmdb_id || item.id,
    poster_url: item.poster_url || "",
    release_date: item.release_date || (item.year ? `${item.year}-01-01` : "")
  };
  try {
    const endpoint = isShow ? "/api/shows" : "/api/movies";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const added = await res.json();
      if (isShow) {
        state.shows.unshift(added);
      } else {
        state.movies.unshift(added);
      }
      saveLocalDatabase();
      showToastNotification(`Dodano "${item.title}" do listy Do obejrzenia! \u{1F3AC}`);
    }
  } catch (err) {
    console.error("Error quick adding to watchlist:", err);
  }
}

// static/js/modules/movies.js
function getItemWatchDate(item, type) {
  if (type === "movie") {
    return item.watch_date || item.follow_date || item.created_at || "";
  } else {
    if (item.episodes_watched && item.episodes_watched.length > 0) {
      let maxEpDate = "";
      for (const ep of item.episodes_watched) {
        if (ep.created_at && ep.created_at > maxEpDate) {
          maxEpDate = ep.created_at;
        }
      }
      if (maxEpDate) return maxEpDate;
    }
    return item.updated_at || item.created_at || "";
  }
}
function sortItems(items, sortMode, type = "movie") {
  return [...items].sort((a, b) => {
    if (sortMode === "default" || sortMode === "watched_desc") {
      const dateA = getItemWatchDate(a, type);
      const dateB = getItemWatchDate(b, type);
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (dateA && dateB && dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "watched_asc") {
      const dateA = getItemWatchDate(a, type);
      const dateB = getItemWatchDate(b, type);
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (dateA && dateB && dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "title_asc") {
      return (a.title || "").localeCompare(b.title || "", "pl", { sensitivity: "base" });
    }
    if (sortMode === "title_desc") {
      return (b.title || "").localeCompare(a.title || "", "pl", { sensitivity: "base" });
    }
    if (sortMode === "rating_desc") {
      const rA = a.rating !== null && a.rating !== void 0 ? a.rating : -1;
      const rB = b.rating !== null && b.rating !== void 0 ? b.rating : -1;
      if (rB !== rA) return rB - rA;
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "rating_asc") {
      const rA = a.rating !== null && a.rating !== void 0 ? a.rating : 99;
      const rB = b.rating !== null && b.rating !== void 0 ? b.rating : 99;
      if (rA !== rB) return rA - rB;
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "release_desc") {
      const yA = a.release_date || (a.release_year ? `${a.release_year}-01-01` : "") || "";
      const yB = b.release_date || (b.release_year ? `${b.release_year}-01-01` : "") || "";
      if (yA && !yB) return -1;
      if (!yA && yB) return 1;
      if (yA && yB && yA !== yB) return yB.localeCompare(yA);
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "release_asc") {
      const yA = a.release_date || (a.release_year ? `${a.release_year}-01-01` : "") || "";
      const yB = b.release_date || (b.release_year ? `${b.release_year}-01-01` : "") || "";
      if (yA && !yB) return -1;
      if (!yA && yB) return 1;
      if (yA && yB && yA !== yB) return yA.localeCompare(yB);
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    return 0;
  });
}
async function renderMovies() {
  const grid = document.getElementById("m3-movies-grid");
  if (!grid) return;
  const searchInput = document.getElementById("m3-search-input");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";
  let filtered = (state.movies || []).filter((m) => {
    if (!m) return false;
    if (state.activeMovieTab === "watched" && m.status !== "watched") return false;
    if (state.activeMovieTab === "watchlist" && m.status !== "watchlist") return false;
    if (state.activeMovieTab === "favorites" && !m.is_favorite) return false;
    if (state.activeVodFilter === "fav" && !m.is_favorite) return false;
    if (state.activeMovieTab === "top_rated" && (m.rating === null || m.rating < 4)) return false;
    if (searchQuery) {
      return m.title && m.title.toLowerCase().includes(searchQuery);
    }
    return true;
  });
  if (state.activeVodFilter !== "all" && state.activeVodFilter !== "fav") {
    await ensureVodDataForVisible(filtered, "movie");
    filtered = filtered.filter((m) => matchVodFilter(m.title, "movie"));
  }
  filtered = sortItems(filtered, state.sortMode, "movie");
  const countEl = document.getElementById("m3-visible-count");
  if (countEl) countEl.innerText = filtered.length;
  grid.innerHTML = "";
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 12px;">search_off</span>
        <p>Brak film\xF3w spe\u0142niaj\u0105cych wybrane kryteria i filtr VOD.</p>
      </div>
    `;
    return;
  }
  filtered.forEach((m) => {
    const card = document.createElement("article");
    card.className = "m3-card";
    let coverHtml = "";
    if (m.poster_url) {
      coverHtml = `
        <img src="${m.poster_url}" alt="${m.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(m.title)}; display: none;">${m.title}</div>
      `;
    } else {
      coverHtml = `<div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(m.title)}">${m.title}</div>`;
    }
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
      const active = m.rating && i <= m.rating ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}">star</span>`;
    }
    const isFav = Boolean(m.is_favorite);
    const favActiveClass = isFav ? "is-fav active" : "";
    const favIconStyle = isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : "";
    card.innerHTML = `
      <div class="m3-card-cover">
        ${coverHtml}
        <button class="m3-card-fav-btn ${favActiveClass}" data-uuid="${m.uuid}" title="${isFav ? "Usu\u0144 z ulubionych" : "Dodaj do ulubionych"}">
          <span class="material-symbols-rounded" style="${favIconStyle}">favorite</span>
        </button>
      </div>
      <div class="m3-card-body">
        <div class="m3-card-title">${m.title}</div>
        <div class="m3-card-meta">
          <span>${m.release_date ? m.release_date.split("-")[0] : ""}</span>
          <span>\u2022</span>
          <span class="m3-status-btn" style="cursor: pointer; text-decoration: underline;">
            ${m.status === "watched" ? "Obejrzane" : "Do obejrzenia"}
          </span>
        </div>
        <div class="m3-stars" data-uuid="${m.uuid}">
          ${starsHtml}
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      openMovieDetail(m);
    });
    const favBtn = card.querySelector(".m3-card-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMovieFavorite(m.uuid, isFav);
    });
    const statusBtn = card.querySelector(".m3-status-btn");
    statusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextStatus = m.status === "watched" ? "watchlist" : "watched";
      updateMovieStatus(m.uuid, nextStatus);
    });
    const starSpans = card.querySelectorAll(".m3-star");
    starSpans.forEach((star) => {
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        const val = parseInt(star.getAttribute("data-val"), 10);
        const nextVal = m.rating === val ? null : val;
        updateMovieRating(m.uuid, nextVal);
      });
    });
    grid.appendChild(card);
  });
}
async function openMovieDetail(movie) {
  document.getElementById("m3-detail-title").innerText = movie.title;
  document.getElementById("m3-detail-meta").innerText = `${movie.release_date ? movie.release_date.split("-")[0] : "Film"} \u2022 Film kinowy`;
  document.getElementById("m3-detail-plot").innerText = "Wczytywanie szczeg\xF3\u0142\xF3w filmu...";
  const badgesRow = document.getElementById("m3-detail-badges-row");
  if (badgesRow) {
    badgesRow.innerHTML = "";
    const y = movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : null);
    if (y) badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${y}</span>`;
    if (movie.watch_date && movie.status === "watched") {
      const formattedDate = movie.watch_date.split(" ")[0];
      badgesRow.innerHTML += `<span class="m3-meta-badge highlight" title="Data oznaczenia jako obejrzany: ${movie.watch_date}"><span class="material-symbols-rounded" style="font-size: 13px;">visibility</span> Obejrzano: ${formattedDate}</span>`;
    }
  }
  const imgEl = document.getElementById("m3-detail-img");
  if (movie.poster_url) {
    imgEl.src = movie.poster_url;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
  }
  const favBtn = document.getElementById("m3-detail-fav-btn");
  if (favBtn) {
    const updateFavBtnUI = () => {
      const isFav = Boolean(movie.is_favorite);
      favBtn.className = `m3-card-fav-btn ${isFav ? "is-fav active" : ""}`;
      favBtn.innerHTML = `<span class="material-symbols-rounded" style="${isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : ""}">favorite</span>`;
      favBtn.title = isFav ? "Usu\u0144 z ulubionych" : "Dodaj do ulubionych";
    };
    updateFavBtnUI();
    favBtn.onclick = () => {
      toggleMovieFavorite(movie.uuid, Boolean(movie.is_favorite));
      movie.is_favorite = !movie.is_favorite;
      updateFavBtnUI();
    };
  }
  const btnWatched = document.getElementById("m3-detail-btn-watched");
  const btnWatchlist = document.getElementById("m3-detail-btn-watchlist");
  const starsContainer = document.getElementById("m3-detail-stars");
  const updateStatusUI = () => {
    if (movie.status === "watched") {
      btnWatched.classList.add("active");
      btnWatchlist.classList.remove("active");
      starsContainer.style.opacity = "1";
      starsContainer.style.pointerEvents = "auto";
      starsContainer.title = "Kliknij gwiazdk\u0119, aby oceni\u0107 film (1-5\u2605)";
    } else {
      btnWatchlist.classList.add("active");
      btnWatched.classList.remove("active");
      starsContainer.style.opacity = "0.35";
      starsContainer.style.pointerEvents = "none";
      starsContainer.title = "Oznacz film jako obejrzany, aby wystawi\u0107 ocen\u0119";
    }
  };
  btnWatched.onclick = () => {
    if (movie.status !== "watched") {
      updateMovieStatus(movie.uuid, "watched");
      movie.status = "watched";
      updateStatusUI();
      renderMovies();
      updateStats();
    }
  };
  btnWatchlist.onclick = () => {
    if (movie.status !== "watchlist") {
      updateMovieStatus(movie.uuid, "watchlist");
      movie.status = "watchlist";
      if (movie.rating) {
        updateMovieRating(movie.uuid, null);
        movie.rating = null;
      }
      openMovieDetail(movie);
      renderMovies();
      updateStats();
    }
  };
  updateStatusUI();
  const deleteBtn = document.getElementById("m3-detail-delete-btn");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Czy na pewno chcesz usun\u0105\u0107 film "${movie.title}" z biblioteki?`)) return;
      await deleteMovie(movie.uuid);
    };
  }
  starsContainer.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const active = movie.status === "watched" && movie.rating && i <= movie.rating ? "active" : "";
    const star = document.createElement("span");
    star.className = `material-symbols-rounded m3-star ${active}`;
    star.innerText = "star";
    star.addEventListener("click", () => {
      if (movie.status !== "watched") return;
      const nextRating = movie.rating === i ? null : i;
      updateMovieRating(movie.uuid, nextRating);
      movie.rating = nextRating;
      openMovieDetail(movie);
      renderMovies();
    });
    starsContainer.appendChild(star);
  }
  const regionEl = document.getElementById("m3-detail-vod-region");
  if (regionEl) regionEl.innerText = getCountryDisplayName(state.userVodCountry);
  const vodLoading = document.getElementById("m3-detail-vod-loading");
  const vodResults = document.getElementById("m3-detail-vod-results");
  const boxFlat = document.getElementById("m3-vod-box-flatrate");
  const boxRent = document.getElementById("m3-vod-box-rent");
  const boxFree = document.getElementById("m3-vod-box-free");
  const boxEmpty = document.getElementById("m3-vod-box-empty");
  vodLoading.style.display = "flex";
  vodResults.style.display = "none";
  boxFlat.style.display = "none";
  boxRent.style.display = "none";
  document.getElementById("m3-sheet-movie-detail").classList.add("active");
  const rematchBtn = document.getElementById("m3-detail-rematch-btn");
  if (rematchBtn) {
    rematchBtn.onclick = () => {
      openMovieRematchPicker(movie);
    };
  }
  try {
    const movieYear = movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : "");
    const tmdbParam = movie.tmdb_id ? `&tmdb_id=${movie.tmdb_id}` : "";
    const yearParam = movieYear ? `&year=${movieYear}` : "";
    const posterParam = movie.poster_url ? `&poster_url=${encodeURIComponent(movie.poster_url)}` : "";
    const detailFetchUrl = `/api/search_detail?title=${encodeURIComponent(movie.title)}&type=movie&lang=${getUserLanguage()}${tmdbParam}${yearParam}${posterParam}`;
    const [detailRes, vodData] = await Promise.all([
      fetch(detailFetchUrl),
      getWatchProvidersForTitle(movie.title, "movie")
    ]);
    if (detailRes.ok) {
      const detail = await detailRes.json();
      if (detail.plot) document.getElementById("m3-detail-plot").innerText = detail.plot;
      if (detail.genre) document.getElementById("m3-detail-meta").innerText = `${detail.year || ""} \u2022 ${detail.genre}`;
      if (badgesRow) {
        badgesRow.innerHTML = "";
        const y = detail.year || movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : null);
        if (y) badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${y}</span>`;
        if (detail.runtime) {
          const hrs = Math.floor(detail.runtime / 60);
          const mins = detail.runtime % 60;
          const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
          badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> ${timeStr}</span>`;
        }
        if (detail.vote_average && detail.vote_average > 0) {
          badgesRow.innerHTML += `<span class="m3-meta-badge tmdb-score"><span class="material-symbols-rounded" style="font-size: 13px;">star</span> ${detail.vote_average.toFixed(1)}</span>`;
        }
        if (detail.genre) {
          const firstGenre = detail.genre.split(",")[0].trim();
          badgesRow.innerHTML += `<span class="m3-meta-badge highlight">${firstGenre}</span>`;
        }
      }
      const castSection = document.getElementById("m3-detail-cast-section");
      if (castSection) {
        if (detail.cast && detail.cast.length > 0) {
          renderCastRail("m3-detail-cast-rail", detail.cast, detail.directors);
          castSection.style.display = "block";
        } else {
          castSection.style.display = "none";
        }
      }
    }
    vodLoading.style.display = "none";
    vodResults.style.display = "flex";
    const flatrates = vodData.flatrate || [];
    const rents = [...vodData.rent || [], ...vodData.buy || []];
    const uniqueRents = [];
    const seen = /* @__PURE__ */ new Set();
    rents.forEach((r) => {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        uniqueRents.push(r);
      }
    });
    const frees = vodData.free || [];
    const renderLogos = (containerId, list) => {
      const cont = document.getElementById(containerId);
      cont.innerHTML = "";
      list.forEach((p) => {
        const badge = document.createElement("div");
        badge.className = "m3-vod-logo-badge";
        badge.title = p.name;
        badge.innerHTML = `
          ${p.logo_url ? `<img src="${p.logo_url}" alt="${p.name}">` : `<span class="material-symbols-rounded" style="font-size: 18px;">movie</span>`}
          <span>${p.name}</span>
        `;
        cont.appendChild(badge);
      });
    };
    let hasAny = false;
    if (flatrates.length > 0) {
      boxFlat.style.display = "block";
      renderLogos("m3-vod-logos-flatrate", flatrates);
      hasAny = true;
    }
    if (uniqueRents.length > 0) {
      boxRent.style.display = "block";
      renderLogos("m3-vod-logos-rent", uniqueRents);
      hasAny = true;
    }
    if (frees.length > 0) {
      boxFree.style.display = "block";
      renderLogos("m3-vod-logos-free", frees);
      hasAny = true;
    }
    if (!hasAny) {
      boxEmpty.style.display = "block";
    } else {
      boxEmpty.style.display = "none";
    }
    const jwBtn = document.getElementById("m3-btn-justwatch-link");
    if (jwBtn) {
      if (vodData && vodData.link) {
        jwBtn.href = vodData.link;
        jwBtn.style.display = "inline-flex";
      } else {
        jwBtn.style.display = "none";
      }
    }
  } catch (err) {
    console.warn("Error rendering VOD detail:", err);
    vodLoading.style.display = "none";
    vodResults.style.display = "flex";
  }
}
async function toggleMovieFavorite(uuid, currentFav) {
  const nextFav = !currentFav;
  try {
    const res = await fetch(`/api/movies/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: nextFav })
    });
    if (res.ok) {
      const found = state.movies.find((m) => m.uuid === uuid);
      if (found) found.is_favorite = nextFav;
      renderMovies();
      updateStats();
      saveLocalDatabase();
    }
  } catch (e) {
    console.error("Error toggling fav:", e);
  }
}
async function updateMovieStatus(uuid, status) {
  try {
    const payload = { status };
    if (status === "watched") {
      payload.watch_date = (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").substring(0, 19);
    }
    const res = await fetch(`/api/movies/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const found = state.movies.find((m) => m.uuid === uuid);
      if (found) {
        found.status = status;
        if (status === "watched" && !found.watch_date) {
          found.watch_date = payload.watch_date;
        }
      }
      renderMovies();
      updateStats();
      saveLocalDatabase();
      showToastNotification(status === "watched" ? "Oznaczono jako obejrzane! \u{1F389}" : "Przeniesiono do Do obejrzenia.");
    }
  } catch (e) {
    console.error("Error updating status:", e);
  }
}
async function updateMovieRating(uuid, rating) {
  try {
    const res = await fetch(`/api/movies/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating })
    });
    if (res.ok) {
      const found = state.movies.find((m) => m.uuid === uuid);
      if (found) found.rating = rating;
      renderMovies();
      updateStats();
      saveLocalDatabase();
      showToastNotification(rating ? `Oceniono na ${rating}\u2605` : "Usuni\u0119to ocen\u0119.");
    }
  } catch (e) {
    console.error("Error rating movie:", e);
  }
}
async function deleteMovie(uuid) {
  try {
    const res = await fetch(`/api/movies/${uuid}`, { method: "DELETE" });
    if (res.ok) {
      state.movies = state.movies.filter((m) => m.uuid !== uuid);
      updateStats();
      renderMovies();
      document.getElementById("m3-sheet-movie-detail").classList.remove("active");
      saveLocalDatabase();
      showToastNotification("Film zosta\u0142 usuni\u0119ty z biblioteki.", "info");
    } else {
      showToastNotification("B\u0142\u0105d podczas usuwania filmu.", "error");
    }
  } catch (err) {
    console.error("Error deleting movie:", err);
  }
}
function openMovieRematchPicker(movie) {
  openRematchPicker(movie, "movie");
}
async function openRematchPicker(item, itemType = "movie") {
  if (itemType === "movie") {
    const movieSheet = document.getElementById("m3-sheet-movie-detail");
    if (movieSheet) movieSheet.classList.remove("active");
  } else {
    const showSheet = document.getElementById("m3-sheet-episodes");
    if (showSheet) showSheet.classList.remove("active");
  }
  const sheetRematch = document.getElementById("m3-sheet-rematch");
  const titleEl = document.getElementById("m3-rematch-title");
  const inputEl = document.getElementById("m3-rematch-search-input");
  const loadingEl = document.getElementById("m3-rematch-loading");
  const resultsContainer = document.getElementById("m3-rematch-results-list");
  const closeBtn = document.getElementById("m3-rematch-close-btn");
  const searchBtn = document.getElementById("m3-rematch-search-btn");
  const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
  titleEl.innerText = `Zmie\u0144 wersj\u0119: ${item.title}`;
  inputEl.value = cleanTitle;
  resultsContainer.innerHTML = "";
  loadingEl.style.display = "flex";
  closeBtn.onclick = () => {
    sheetRematch.classList.remove("active");
    if (itemType === "movie") {
      openMovieDetail(item);
    } else if (window.openEpisodeTracker) {
      window.openEpisodeTracker(item);
    }
  };
  const doSearch = async (query) => {
    if (!query) return;
    loadingEl.style.display = "flex";
    resultsContainer.innerHTML = "";
    try {
      const typeParam = itemType === "series" ? "series" : "movie";
      const res = await fetch(`/api/search_preview?q=${encodeURIComponent(query)}&type=${typeParam}&lang=${getUserLanguage()}`);
      loadingEl.style.display = "none";
      if (!res.ok) {
        resultsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.85rem;">Nie znaleziono pozycji w TMDb.</div>`;
        return;
      }
      const data = await res.json();
      const results = data.results || (data.item ? [data.item] : []);
      if (results.length === 0) {
        resultsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.85rem;">Brak innych wersji pasuj\u0105cych do "${query}".</div>`;
        return;
      }
      results.forEach((it) => {
        const card = document.createElement("div");
        const pUrl = it.poster_url || "";
        const yearStr = it.year || (it.release_date ? it.release_date.split("-")[0] : "");
        const isCurrentMatch = it.tmdb_id && item.tmdb_id && String(it.tmdb_id) === String(item.tmdb_id) || it.poster_url && item.poster_url && it.poster_url === item.poster_url;
        card.className = `m3-rematch-card ${isCurrentMatch ? "is-active-match" : ""}`;
        card.innerHTML = `
          <div class="m3-rematch-poster">
            ${pUrl ? `<img src="${pUrl}" alt="${it.title}" loading="lazy">` : `<span class="material-symbols-rounded" style="font-size: 26px; color: var(--md-sys-color-on-surface-variant);">${itemType === "series" ? "tv" : "movie"}</span>`}
          </div>
          <div class="m3-rematch-body">
            <div class="m3-rematch-title-row">
              <span class="m3-rematch-card-title">${it.title}</span>
              ${isCurrentMatch ? `<span class="m3-meta-badge highlight" style="font-size: 0.68rem; padding: 2px 8px;"><span class="material-symbols-rounded" style="font-size: 13px;">check_circle</span> Aktualna wersja</span>` : ""}
            </div>
            <div class="m3-rematch-badges-row">
              ${yearStr ? `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 12px;">calendar_today</span> ${yearStr}</span>` : ""}
              ${it.original_title && it.original_title !== it.title ? `<span class="m3-meta-badge">${it.original_title}</span>` : ""}
              ${it.vote_average && it.vote_average > 0 ? `<span class="m3-meta-badge tmdb-score"><span class="material-symbols-rounded" style="font-size: 12px;">star</span> ${Number(it.vote_average).toFixed(1)}</span>` : ""}
            </div>
            <p class="m3-rematch-plot">${it.overview || it.plot || "Brak opisu fabu\u0142y w bazie TMDb."}</p>
          </div>
          <button type="button" class="m3-rematch-select-btn ${isCurrentMatch ? "is-current" : ""}">
            <span class="material-symbols-rounded" style="font-size: 16px;">${isCurrentMatch ? "check" : "sync"}</span>
            <span>${isCurrentMatch ? "Wybrana" : "Wybierz"}</span>
          </button>
        `;
        card.addEventListener("click", async () => {
          const payload = {
            title: it.title,
            poster_url: it.poster_url || item.poster_url,
            release_date: it.release_date || item.release_date,
            tmdb_id: it.tmdb_id || it.id
          };
          try {
            const endpoint = itemType === "series" ? `/api/shows/${item.uuid}` : `/api/movies/${item.uuid}`;
            const updateRes = await fetch(endpoint, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (updateRes.ok) {
              const updated = await updateRes.json();
              Object.assign(item, updated);
              sheetRematch.classList.remove("active");
              if (itemType === "series") {
                if (window.renderShows) window.renderShows();
                updateStats();
                if (window.openEpisodeTracker) window.openEpisodeTracker(item);
                showToastNotification(`Zaktualizowano wersj\u0119 serialu: "${item.title}" (${yearStr})! \u2728`);
              } else {
                renderMovies();
                updateStats();
                openMovieDetail(item);
                showToastNotification(`Zaktualizowano wersj\u0119 filmu: "${item.title}" (${yearStr})! \u2728`);
              }
              saveLocalDatabase();
            }
          } catch (err) {
            console.error("Error saving rematch:", err);
          }
        });
        resultsContainer.appendChild(card);
      });
    } catch (e) {
      console.error("Error executing rematch search:", e);
      loadingEl.style.display = "none";
    }
  };
  searchBtn.onclick = () => doSearch(inputEl.value.trim());
  inputEl.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(inputEl.value.trim());
    }
  };
  sheetRematch.classList.add("active");
  doSearch(cleanTitle);
}
window.openMovieDetail = openMovieDetail;
window.renderMovies = renderMovies;

// static/js/modules/directors_data.js
var TOP_DIRECTORS_CATALOG = [
  {
    "name": "Christopher Nolan",
    "id": 525,
    "avatar": "https://image.tmdb.org/t/p/w185/xuAIuYSmsUzKlUMBFGVZaWsY3DZ.jpg",
    "movies": [
      {
        "title": "Doodlebug",
        "original_title": "Doodlebug",
        "year": "1997",
        "tmdb_id": 43629,
        "poster_url": "https://image.tmdb.org/t/p/w185/cXDFFv6yZNW3vUHOKKUPJNnL0So.jpg",
        "rating": 6.5
      },
      {
        "title": "\u015Aledz\u0105c",
        "original_title": "Following",
        "year": "1999",
        "tmdb_id": 11660,
        "poster_url": "https://image.tmdb.org/t/p/w185/pZnfUffNIkeHB1gi2Lr31VNEIl.jpg",
        "rating": 7.1
      },
      {
        "title": "Memento",
        "original_title": "Memento",
        "year": "2000",
        "tmdb_id": 77,
        "poster_url": "https://image.tmdb.org/t/p/w185/nzlv62aC0octS5AklAiWpXLX9Z0.jpg",
        "rating": 8.2
      },
      {
        "title": "Bezsenno\u015B\u0107",
        "original_title": "Insomnia",
        "year": "2002",
        "tmdb_id": 320,
        "poster_url": "https://image.tmdb.org/t/p/w185/dVppgIoMNu3NvK3GThHdXjqOHYD.jpg",
        "rating": 7
      },
      {
        "title": "Batman - Pocz\u0105tek",
        "original_title": "Batman Begins",
        "year": "2005",
        "tmdb_id": 272,
        "poster_url": "https://image.tmdb.org/t/p/w185/cub46jQ4bLQYYbpbSL9Q24wofS2.jpg",
        "rating": 7.7
      },
      {
        "title": "Presti\u017C",
        "original_title": "The Prestige",
        "year": "2006",
        "tmdb_id": 1124,
        "poster_url": "https://image.tmdb.org/t/p/w185/osBXpsFTRtpXpnxo81XRceymWNj.jpg",
        "rating": 8.2
      },
      {
        "title": "Mroczny Rycerz",
        "original_title": "The Dark Knight",
        "year": "2008",
        "tmdb_id": 155,
        "poster_url": "https://image.tmdb.org/t/p/w185/gKMDmGde8aAD8M6dvm6j7wciSbJ.jpg",
        "rating": 8.5
      },
      {
        "title": "Incepcja",
        "original_title": "Inception",
        "year": "2010",
        "tmdb_id": 27205,
        "poster_url": "https://image.tmdb.org/t/p/w185/efvcvRgOAZgFC2hrPUa6YqrE1KG.jpg",
        "rating": 8.4
      },
      {
        "title": "Mroczny Rycerz powstaje",
        "original_title": "The Dark Knight Rises",
        "year": "2012",
        "tmdb_id": 49026,
        "poster_url": "https://image.tmdb.org/t/p/w185/oWIhEWtHbSlvttp5qbBEutPOV7G.jpg",
        "rating": 7.8
      },
      {
        "title": "Interstellar",
        "original_title": "Interstellar",
        "year": "2014",
        "tmdb_id": 157336,
        "poster_url": "https://image.tmdb.org/t/p/w185/q4emCJmjNomEE2pVGgqr3nDEIzI.jpg",
        "rating": 8.5
      },
      {
        "title": "Dunkierka",
        "original_title": "Dunkirk",
        "year": "2017",
        "tmdb_id": 374720,
        "poster_url": "https://image.tmdb.org/t/p/w185/zPRomhANBqtY8XSb9y4f2o5nHzp.jpg",
        "rating": 7.4
      },
      {
        "title": "Tenet",
        "original_title": "Tenet",
        "year": "2020",
        "tmdb_id": 577922,
        "poster_url": "https://image.tmdb.org/t/p/w185/IveefzhRc6Zdd5gzQw3VFjitZP.jpg",
        "rating": 7.2
      },
      {
        "title": "Oppenheimer",
        "original_title": "Oppenheimer",
        "year": "2023",
        "tmdb_id": 872585,
        "poster_url": "https://image.tmdb.org/t/p/w185/gBrW3l0GsN7fvrn6A7ofaw90qj4.jpg",
        "rating": 8
      },
      {
        "title": "Odyseja",
        "original_title": "The Odyssey",
        "year": "2026",
        "tmdb_id": 1368337,
        "poster_url": "https://image.tmdb.org/t/p/w185/1g2v4Gg8kVe6P1p5Tz5IA69BPBN.jpg",
        "rating": 8
      }
    ]
  },
  {
    "name": "Quentin Tarantino",
    "id": 138,
    "avatar": "https://image.tmdb.org/t/p/w185/1gjcpAa99FAOWGnrUvHEXXsRs7o.jpg",
    "movies": [
      {
        "title": "Reservoir Dogs",
        "original_title": "Reservoir Dogs",
        "year": "1991",
        "tmdb_id": 443129,
        "poster_url": "https://image.tmdb.org/t/p/w185/oiPx0edR4IoT97KOHDJx4n1dk5U.jpg",
        "rating": 7.5
      },
      {
        "title": "Pulp Fiction",
        "original_title": "Pulp Fiction",
        "year": "1994",
        "tmdb_id": 680,
        "poster_url": "https://image.tmdb.org/t/p/w185/5Whi9po8MTPyUTxAioXfyXGHNQE.jpg",
        "rating": 8.5
      },
      {
        "title": "Cztery Pokoje",
        "original_title": "Four Rooms",
        "year": "1995",
        "tmdb_id": 5,
        "poster_url": "https://image.tmdb.org/t/p/w185/9U7bDaqHHOL2loFNk0cE3TjfTzH.jpg",
        "rating": 5.9
      },
      {
        "title": "Jackie Brown",
        "original_title": "Jackie Brown",
        "year": "1997",
        "tmdb_id": 184,
        "poster_url": "https://image.tmdb.org/t/p/w185/rOUx7qg4KmEh1juEDwqzbDSL1Nr.jpg",
        "rating": 7.4
      },
      {
        "title": "Kill Bill",
        "original_title": "Kill Bill: Vol. 1",
        "year": "2003",
        "tmdb_id": 24,
        "poster_url": "https://image.tmdb.org/t/p/w185/v7TaX8kXMXs5yFFGR41guUDNcnB.jpg",
        "rating": 8
      },
      {
        "title": "Kill Bill 2",
        "original_title": "Kill Bill: Vol. 2",
        "year": "2004",
        "tmdb_id": 393,
        "poster_url": "https://image.tmdb.org/t/p/w185/2yhg0mZQMhDyvUQ4rG1IZ4oIA8L.jpg",
        "rating": 7.9
      },
      {
        "title": "Grindhouse",
        "original_title": "Grindhouse",
        "year": "2007",
        "tmdb_id": 285923,
        "poster_url": "https://image.tmdb.org/t/p/w185/xpqMGiHX0lebkVCgZuLmkJ00f4L.jpg",
        "rating": 7
      },
      {
        "title": "Death Proof",
        "original_title": "Death Proof",
        "year": "2007",
        "tmdb_id": 1991,
        "poster_url": "https://image.tmdb.org/t/p/w185/vtu6H4NWnQVqEp3aanUq3hNeeot.jpg",
        "rating": 6.8
      },
      {
        "title": "B\u0119karty wojny",
        "original_title": "Inglourious Basterds",
        "year": "2009",
        "tmdb_id": 16869,
        "poster_url": "https://image.tmdb.org/t/p/w185/xYoYYRo0vZNa0VJAOvXtfRPCi3S.jpg",
        "rating": 8.2
      },
      {
        "title": "Kill Bill: The Whole Bloody Affair",
        "original_title": "Kill Bill: The Whole Bloody Affair",
        "year": "2011",
        "tmdb_id": 414419,
        "poster_url": "https://image.tmdb.org/t/p/w185/gPtZJxDvrk7n5cE5msNr4ac5XxT.jpg",
        "rating": 8.1
      },
      {
        "title": "Django",
        "original_title": "Django Unchained",
        "year": "2012",
        "tmdb_id": 68718,
        "poster_url": "https://image.tmdb.org/t/p/w185/6UjfRbaSdpNeaJvLIPTdhCO6yzJ.jpg",
        "rating": 8.2
      },
      {
        "title": "Nienawistna \xF3semka",
        "original_title": "The Hateful Eight",
        "year": "2015",
        "tmdb_id": 273248,
        "poster_url": "https://image.tmdb.org/t/p/w185/sLmii6n2CLOQm1LATwZaXZYrNwx.jpg",
        "rating": 7.8
      },
      {
        "title": "Pewnego razu\u2026 w Hollywood",
        "original_title": "Once Upon a Time... in Hollywood",
        "year": "2019",
        "tmdb_id": 466272,
        "poster_url": "https://image.tmdb.org/t/p/w185/uqYoGbriYgNOKKAYSqnF3JndrMT.jpg",
        "rating": 7.4
      }
    ]
  },
  {
    "name": "Denis Villeneuve",
    "id": 137427,
    "avatar": "https://image.tmdb.org/t/p/w185/zdDx9Xs93UIrJFWYApYR28J8M6b.jpg",
    "movies": [
      {
        "title": "32 sierpnia na Ziemi",
        "original_title": "Un 32 ao\xFBt sur terre",
        "year": "1999",
        "tmdb_id": 59482,
        "poster_url": "https://image.tmdb.org/t/p/w185/1Cn8wxg26eI5PaKik2BTB492rK.jpg",
        "rating": 6.5
      },
      {
        "title": "Maelstr\xF6m",
        "original_title": "Maelstr\xF6m",
        "year": "2000",
        "tmdb_id": 35650,
        "poster_url": "https://image.tmdb.org/t/p/w185/icV1B4ouHmPttcN20og84v8gv0e.jpg",
        "rating": 6.2
      },
      {
        "title": "Kolejne pi\u0119tro",
        "original_title": "Next Floor",
        "year": "2008",
        "tmdb_id": 99343,
        "poster_url": "https://image.tmdb.org/t/p/w185/1HBizk472Kb0SY8NM8XTbig2xpm.jpg",
        "rating": 7.1
      },
      {
        "title": "Politechnika",
        "original_title": "Polytechnique",
        "year": "2009",
        "tmdb_id": 22302,
        "poster_url": "https://image.tmdb.org/t/p/w185/k0xmtct9cSseksuFKMSXxM8hfni.jpg",
        "rating": 7.1
      },
      {
        "title": "Pogorzelisko",
        "original_title": "Incendies",
        "year": "2010",
        "tmdb_id": 46738,
        "poster_url": "https://image.tmdb.org/t/p/w185/n8jJREVlHUw2J90I4P3mgAEG3Yk.jpg",
        "rating": 8.1
      },
      {
        "title": "Labirynt",
        "original_title": "Prisoners",
        "year": "2013",
        "tmdb_id": 146233,
        "poster_url": "https://image.tmdb.org/t/p/w185/3XUDusNMvbubbKUx1qKh456MQd3.jpg",
        "rating": 8.1
      },
      {
        "title": "Wr\xF3g",
        "original_title": "Enemy",
        "year": "2014",
        "tmdb_id": 181886,
        "poster_url": "https://image.tmdb.org/t/p/w185/xdU2ErL3gjqtJDj5kbn9OmRGV67.jpg",
        "rating": 6.8
      },
      {
        "title": "Sicario",
        "original_title": "Sicario",
        "year": "2015",
        "tmdb_id": 273481,
        "poster_url": "https://image.tmdb.org/t/p/w185/fZtSgpJ6k1wWgJ6fBNlfxew70MK.jpg",
        "rating": 7.4
      },
      {
        "title": "Nowy pocz\u0105tek",
        "original_title": "Arrival",
        "year": "2016",
        "tmdb_id": 329865,
        "poster_url": "https://image.tmdb.org/t/p/w185/evHCf9GuBDc42KvW9DRhY7pKx11.jpg",
        "rating": 7.6
      },
      {
        "title": "Blade Runner 2049",
        "original_title": "Blade Runner 2049",
        "year": "2017",
        "tmdb_id": 335984,
        "poster_url": "https://image.tmdb.org/t/p/w185/g3YrbSqzRXVEM74AaY8rK5OqY9u.jpg",
        "rating": 7.6
      },
      {
        "title": "Diuna",
        "original_title": "Dune",
        "year": "2021",
        "tmdb_id": 438631,
        "poster_url": "https://image.tmdb.org/t/p/w185/4L3Dkdujbrq5EKcrVdWEdTEvhtb.jpg",
        "rating": 7.8
      },
      {
        "title": "Diuna: Cz\u0119\u015B\u0107 druga",
        "original_title": "Dune: Part Two",
        "year": "2024",
        "tmdb_id": 693134,
        "poster_url": "https://image.tmdb.org/t/p/w185/xdfO6EB9e59qZpzmHxezTdPfTxZ.jpg",
        "rating": 8.1
      }
    ]
  },
  {
    "name": "Martin Scorsese",
    "id": 1032,
    "avatar": "https://image.tmdb.org/t/p/w185/g3DjfKsgZQWZiw30I20hZVk1oMX.jpg",
    "movies": [
      {
        "title": "The Big Shave",
        "original_title": "The Big Shave",
        "year": "1967",
        "tmdb_id": 48714,
        "poster_url": "https://image.tmdb.org/t/p/w185/1bgOIU4ezln7qqVymjQBLEYMPpb.jpg",
        "rating": 6.9
      },
      {
        "title": "Who's That Knocking at My Door",
        "original_title": "Who's That Knocking at My Door",
        "year": "1968",
        "tmdb_id": 42694,
        "poster_url": "https://image.tmdb.org/t/p/w185/zcH6pKZKeImwcBtIH7fSdUyoQ2e.jpg",
        "rating": 6
      },
      {
        "title": "Wagon towarowy Bertha",
        "original_title": "Boxcar Bertha",
        "year": "1972",
        "tmdb_id": 22784,
        "poster_url": "https://image.tmdb.org/t/p/w185/gF5VslUB2xpWbboc735VVnO7DXh.jpg",
        "rating": 5.8
      },
      {
        "title": "Ulice N\u0119dzy",
        "original_title": "Mean Streets",
        "year": "1973",
        "tmdb_id": 203,
        "poster_url": "https://image.tmdb.org/t/p/w185/53kxzpHYjbmwcPjFGPArlTeqTmF.jpg",
        "rating": 7
      },
      {
        "title": "Alicja ju\u017C tu nie mieszka",
        "original_title": "Alice Doesn't Live Here Anymore",
        "year": "1974",
        "tmdb_id": 16153,
        "poster_url": "https://image.tmdb.org/t/p/w185/gCL9sR1YGwtdGyvsfGIGOdLkG1b.jpg",
        "rating": 7
      },
      {
        "title": "Taks\xF3wkarz",
        "original_title": "Taxi Driver",
        "year": "1976",
        "tmdb_id": 103,
        "poster_url": "https://image.tmdb.org/t/p/w185/6vEoplgvAqgwh3TnYj8kjFsaxXu.jpg",
        "rating": 8.1
      },
      {
        "title": "New York, New York",
        "original_title": "New York, New York",
        "year": "1977",
        "tmdb_id": 12637,
        "poster_url": "https://image.tmdb.org/t/p/w185/1nD40aUcPAxYdE1WxERrTjZuFGe.jpg",
        "rating": 6.5
      },
      {
        "title": "Ostatni walc",
        "original_title": "The Last Waltz",
        "year": "1978",
        "tmdb_id": 13963,
        "poster_url": "https://image.tmdb.org/t/p/w185/2K7CFH0AIHnGrA4yQjPCoIB5CmQ.jpg",
        "rating": 7.7
      },
      {
        "title": "W\u015Bciek\u0142y Byk",
        "original_title": "Raging Bull",
        "year": "1980",
        "tmdb_id": 1578,
        "poster_url": "https://image.tmdb.org/t/p/w185/1WV7WlTS8LI1L5NkCgjWT9GSW3O.jpg",
        "rating": 7.9
      },
      {
        "title": "Kr\xF3l komedii",
        "original_title": "The King of Comedy",
        "year": "1982",
        "tmdb_id": 262,
        "poster_url": "https://image.tmdb.org/t/p/w185/fxmmb8yFPDnMzewodW3i9eRL42M.jpg",
        "rating": 7.8
      },
      {
        "title": "Po godzinach",
        "original_title": "After Hours",
        "year": "1985",
        "tmdb_id": 10843,
        "poster_url": "https://image.tmdb.org/t/p/w185/eamOBurHBu0MIxohTIVcfxmZ6Z7.jpg",
        "rating": 7.5
      },
      {
        "title": "Kolor Pieni\u0119dzy",
        "original_title": "The Color of Money",
        "year": "1986",
        "tmdb_id": 11873,
        "poster_url": "https://image.tmdb.org/t/p/w185/f9dh3Dq1LS0DEKnrnz9B3u3n4r9.jpg",
        "rating": 6.9
      },
      {
        "title": "Ostatnie kuszenie Chrystusa",
        "original_title": "The Last Temptation of Christ",
        "year": "1988",
        "tmdb_id": 11051,
        "poster_url": "https://image.tmdb.org/t/p/w185/3kmD6DLQsBiEzkJxfSAcPtmoqza.jpg",
        "rating": 7.2
      },
      {
        "title": "Nowojorskie opowie\u015Bci",
        "original_title": "New York Stories",
        "year": "1989",
        "tmdb_id": 9686,
        "poster_url": "https://image.tmdb.org/t/p/w185/mViGEH5dfsAnUgJmce1RJkFycAi.jpg",
        "rating": 6.2
      },
      {
        "title": "Ch\u0142opcy z ferajny",
        "original_title": "GoodFellas",
        "year": "1990",
        "tmdb_id": 769,
        "poster_url": "https://image.tmdb.org/t/p/w185/m9taboMOrt6h7sTLkGfOBSqp3qr.jpg",
        "rating": 8.4
      },
      {
        "title": "Przyl\u0105dek strachu",
        "original_title": "Cape Fear",
        "year": "1991",
        "tmdb_id": 1598,
        "poster_url": "https://image.tmdb.org/t/p/w185/wNU5XF8TUdd2BFh9GXt7QWEtlmZ.jpg",
        "rating": 7.3
      },
      {
        "title": "Wiek niewinno\u015Bci",
        "original_title": "The Age of Innocence",
        "year": "1993",
        "tmdb_id": 10436,
        "poster_url": "https://image.tmdb.org/t/p/w185/3NmQVZnM8tsDYADYIGA1hEjkuvG.jpg",
        "rating": 7
      },
      {
        "title": "Kasyno",
        "original_title": "Casino",
        "year": "1995",
        "tmdb_id": 524,
        "poster_url": "https://image.tmdb.org/t/p/w185/mtmgLoDfFiIZ8D3TMxwBq0kA24z.jpg",
        "rating": 8
      },
      {
        "title": "Kundun - \u017Cycie Dalaj Lamy",
        "original_title": "Kundun",
        "year": "1997",
        "tmdb_id": 9746,
        "poster_url": "https://image.tmdb.org/t/p/w185/yvdFRDoQIQ5PBk4u8x8gJT8NJAw.jpg",
        "rating": 6.8
      },
      {
        "title": "Ciemna strona miasta",
        "original_title": "Bringing Out the Dead",
        "year": "1999",
        "tmdb_id": 8649,
        "poster_url": "https://image.tmdb.org/t/p/w185/uhKVu9JVm8U6KXqX875eLZRAPxP.jpg",
        "rating": 6.6
      },
      {
        "title": "Gangi Nowego Jorku",
        "original_title": "Gangs of New York",
        "year": "2002",
        "tmdb_id": 3131,
        "poster_url": "https://image.tmdb.org/t/p/w185/uMcROA58iZcLwVMyfNvDTBarImV.jpg",
        "rating": 7.3
      },
      {
        "title": "Aviator",
        "original_title": "The Aviator",
        "year": "2004",
        "tmdb_id": 2567,
        "poster_url": "https://image.tmdb.org/t/p/w185/xi2H8QHLMtOcSuG5FaUL4ypVZ6q.jpg",
        "rating": 7.2
      },
      {
        "title": "Bez sta\u0142ego adresu: Bob Dylan",
        "original_title": "No Direction Home: Bob Dylan",
        "year": "2005",
        "tmdb_id": 19082,
        "poster_url": "https://image.tmdb.org/t/p/w185/lqOo4nyRS56Goi8InZqLFKGEJR5.jpg",
        "rating": 7.8
      },
      {
        "title": "Infiltracja",
        "original_title": "The Departed",
        "year": "2006",
        "tmdb_id": 1422,
        "poster_url": "https://image.tmdb.org/t/p/w185/fENeo92FAaDPngxfI4CF4h1V0UA.jpg",
        "rating": 8.2
      },
      {
        "title": "Shine a Light",
        "original_title": "Shine a Light",
        "year": "2008",
        "tmdb_id": 7944,
        "poster_url": "https://image.tmdb.org/t/p/w185/rMVrNWWaO3xAWZHFUbeamWPzVAC.jpg",
        "rating": 6.8
      },
      {
        "title": "Wyspa tajemnic",
        "original_title": "Shutter Island",
        "year": "2010",
        "tmdb_id": 11324,
        "poster_url": "https://image.tmdb.org/t/p/w185/scYivmvdv2DwCfbiblEcRG4P9Me.jpg",
        "rating": 8.2
      },
      {
        "title": "Hugo i jego wynalazek",
        "original_title": "Hugo",
        "year": "2011",
        "tmdb_id": 44826,
        "poster_url": "https://image.tmdb.org/t/p/w185/1dxRq3o3l3bVWNRvvSb7rRf68qp.jpg",
        "rating": 7.2
      },
      {
        "title": "Wilk z Wall Street",
        "original_title": "The Wolf of Wall Street",
        "year": "2013",
        "tmdb_id": 106646,
        "poster_url": "https://image.tmdb.org/t/p/w185/eQTzLZ8szPpQuxKsxvUDUEq74nd.jpg",
        "rating": 8
      },
      {
        "title": "The Audition",
        "original_title": "The Audition",
        "year": "2015",
        "tmdb_id": 365717,
        "poster_url": "https://image.tmdb.org/t/p/w185/t1PDIeDpJGgI9JPqIRMuG7WDdId.jpg",
        "rating": 6.2
      },
      {
        "title": "Milczenie",
        "original_title": "Silence",
        "year": "2016",
        "tmdb_id": 68730,
        "poster_url": "https://image.tmdb.org/t/p/w185/6s6731QQJW5JZM5c41sGUlXL6z8.jpg",
        "rating": 7.1
      },
      {
        "title": "Rolling Thunder Revue: Opowie\u015B\u0107 o Bobie Dylanie od Martina Scorsese",
        "original_title": "Rolling Thunder Revue: A Bob Dylan Story by Martin Scorsese",
        "year": "2019",
        "tmdb_id": 574638,
        "poster_url": "https://image.tmdb.org/t/p/w185/ixxELBgYj9OH8hz0XCrcZOJpIx9.jpg",
        "rating": 7
      },
      {
        "title": "Irlandczyk",
        "original_title": "The Irishman",
        "year": "2019",
        "tmdb_id": 398978,
        "poster_url": "https://image.tmdb.org/t/p/w185/tCQVSf9EhH0XQ06x6jCyWlPMyzT.jpg",
        "rating": 7.6
      },
      {
        "title": "Czas krwawego ksi\u0119\u017Cyca",
        "original_title": "Killers of the Flower Moon",
        "year": "2023",
        "tmdb_id": 466420,
        "poster_url": "https://image.tmdb.org/t/p/w185/oA1EDzdHhAMkslPxtiVIRW4T3I4.jpg",
        "rating": 7.4
      }
    ]
  },
  {
    "name": "David Fincher",
    "id": 7467,
    "avatar": "https://image.tmdb.org/t/p/w185/tpEczFclQZeKAiCeKZZ0adRvtfz.jpg",
    "movies": [
      {
        "title": "Obcy 3",
        "original_title": "Alien\xB3",
        "year": "1992",
        "tmdb_id": 8077,
        "poster_url": "https://image.tmdb.org/t/p/w185/hpADTPbDzfFqTO4MZ5EjIU6lLCZ.jpg",
        "rating": 6.4
      },
      {
        "title": "Siedem",
        "original_title": "Se7en",
        "year": "1995",
        "tmdb_id": 807,
        "poster_url": "https://image.tmdb.org/t/p/w185/jKstsinBR4nXRzmOItLjmpt9CQ4.jpg",
        "rating": 8.4
      },
      {
        "title": "Gra",
        "original_title": "The Game",
        "year": "1997",
        "tmdb_id": 2649,
        "poster_url": "https://image.tmdb.org/t/p/w185/srhBuSCOti8KnysBN7SQmzluhND.jpg",
        "rating": 7.6
      },
      {
        "title": "Podziemny kr\u0105g",
        "original_title": "Fight Club",
        "year": "1999",
        "tmdb_id": 550,
        "poster_url": "https://image.tmdb.org/t/p/w185/efBb4gjjKneUoBVgfFOUu2OwihS.jpg",
        "rating": 8.4
      },
      {
        "title": "Azyl",
        "original_title": "Panic Room",
        "year": "2002",
        "tmdb_id": 4547,
        "poster_url": "https://image.tmdb.org/t/p/w185/lGSRPNBj7adSDhsHuub3hOhxb44.jpg",
        "rating": 6.8
      },
      {
        "title": "Zodiak",
        "original_title": "Zodiac",
        "year": "2007",
        "tmdb_id": 1949,
        "poster_url": "https://image.tmdb.org/t/p/w185/2BODBRj7MCfiF3wcXaZlowFdqT4.jpg",
        "rating": 7.5
      },
      {
        "title": "Ciekawy przypadek Benjamina Buttona",
        "original_title": "The Curious Case of Benjamin Button",
        "year": "2008",
        "tmdb_id": 4922,
        "poster_url": "https://image.tmdb.org/t/p/w185/lapKiaHTCrOYDaHE1FaRhxfSAHN.jpg",
        "rating": 7.6
      },
      {
        "title": "The Social Network",
        "original_title": "The Social Network",
        "year": "2010",
        "tmdb_id": 37799,
        "poster_url": "https://image.tmdb.org/t/p/w185/4UqFxN1ayyXyPI6aZim2q0HvCZs.jpg",
        "rating": 7.4
      },
      {
        "title": "Dziewczyna z tatua\u017Cem",
        "original_title": "The Girl with the Dragon Tattoo",
        "year": "2011",
        "tmdb_id": 65754,
        "poster_url": "https://image.tmdb.org/t/p/w185/68JCjybFaZsQyY5DCr9ZFJsVt7j.jpg",
        "rating": 7.4
      },
      {
        "title": "Zaginiona dziewczyna",
        "original_title": "Gone Girl",
        "year": "2014",
        "tmdb_id": 210577,
        "poster_url": "https://image.tmdb.org/t/p/w185/rFwfIgdxQQIA45y0hjCAIRowOhY.jpg",
        "rating": 7.9
      },
      {
        "title": "Mank",
        "original_title": "Mank",
        "year": "2020",
        "tmdb_id": 614560,
        "poster_url": "https://image.tmdb.org/t/p/w185/4yzTcAtvzyZLLto4z04xobUK9el.jpg",
        "rating": 6.7
      },
      {
        "title": "Zab\xF3jca",
        "original_title": "The Killer",
        "year": "2023",
        "tmdb_id": 800158,
        "poster_url": "https://image.tmdb.org/t/p/w185/6mKqWM7KETGPqdlpWfuu96Ekyqs.jpg",
        "rating": 6.6
      }
    ]
  },
  {
    "name": "Hayao Miyazaki",
    "id": 608,
    "avatar": "https://image.tmdb.org/t/p/w185/ouhjt9KugzhWtdEyBPipihB3ic8.jpg",
    "movies": [
      {
        "title": "Lupin Trzeci: Zamek Cagliostro",
        "original_title": "\u30EB\u30D1\u30F3\u4E09\u4E16 \u30AB\u30EA\u30AA\u30B9\u30C8\u30ED\u306E\u57CE",
        "year": "1979",
        "tmdb_id": 15371,
        "poster_url": "https://image.tmdb.org/t/p/w185/169MlJFokbOUFrIWoAWugvRjb0A.jpg",
        "rating": 7.5
      },
      {
        "title": "Nausica\xE4 z Doliny Wiatru",
        "original_title": "\u98A8\u306E\u8C37\u306E\u30CA\u30A6\u30B7\u30AB",
        "year": "1984",
        "tmdb_id": 81,
        "poster_url": "https://image.tmdb.org/t/p/w185/jisAAzfCMDyd9iqhlJf5sESQ5f8.jpg",
        "rating": 7.9
      },
      {
        "title": "Laputa \u2013 podniebny zamek",
        "original_title": "\u5929\u7A7A\u306E\u57CE\u30E9\u30D4\u30E5\u30BF",
        "year": "1986",
        "tmdb_id": 10515,
        "poster_url": "https://image.tmdb.org/t/p/w185/jS50vAIVGgTAjvi92RTJ7cZoHxU.jpg",
        "rating": 8
      },
      {
        "title": "M\xF3j s\u0105siad Totoro",
        "original_title": "\u3068\u306A\u308A\u306E\u30C8\u30C8\u30ED",
        "year": "1988",
        "tmdb_id": 8392,
        "poster_url": "https://image.tmdb.org/t/p/w185/p6i0gjS4G3FogVlRVayex1SJnn8.jpg",
        "rating": 8.1
      },
      {
        "title": "Podniebna poczta Kiki",
        "original_title": "\u9B54\u5973\u306E\u5B85\u6025\u4FBF",
        "year": "1989",
        "tmdb_id": 16859,
        "poster_url": "https://image.tmdb.org/t/p/w185/kcq8jt9akgsCauWDQhmvzy9bwFB.jpg",
        "rating": 7.8
      },
      {
        "title": "Szkar\u0142atny pilot",
        "original_title": "\u7D05\u306E\u8C5A",
        "year": "1992",
        "tmdb_id": 11621,
        "poster_url": "https://image.tmdb.org/t/p/w185/2xgraFzBYskdhsrBEnCliZkwb34.jpg",
        "rating": 7.8
      },
      {
        "title": "Ksi\u0119\u017Cniczka Mononoke",
        "original_title": "\u3082\u306E\u306E\u3051\u59EB",
        "year": "1997",
        "tmdb_id": 128,
        "poster_url": "https://image.tmdb.org/t/p/w185/tpm3eXEKqiGsMBqhp2gXqBrDEmW.jpg",
        "rating": 8.3
      },
      {
        "title": "Spirited Away: W krainie Bog\xF3w",
        "original_title": "\u5343\u3068\u5343\u5C0B\u306E\u795E\u96A0\u3057",
        "year": "2001",
        "tmdb_id": 129,
        "poster_url": "https://image.tmdb.org/t/p/w185/gSqglWhte6Q3zT71ovD1Ww4ckzd.jpg",
        "rating": 8.5
      },
      {
        "title": "Ruchomy zamek Hauru",
        "original_title": "\u30CF\u30A6\u30EB\u306E\u52D5\u304F\u57CE",
        "year": "2004",
        "tmdb_id": 4935,
        "poster_url": "https://image.tmdb.org/t/p/w185/pCHfm0Icmk0rJiBJjY1XAfYMTd7.jpg",
        "rating": 8.4
      },
      {
        "title": "Ponyo",
        "original_title": "\u5D16\u306E\u4E0A\u306E\u30DD\u30CB\u30E7",
        "year": "2008",
        "tmdb_id": 12429,
        "poster_url": "https://image.tmdb.org/t/p/w185/clnLxVRnILJY2omZptFvaqn7oFP.jpg",
        "rating": 7.8
      },
      {
        "title": "Zrywa si\u0119 wiatr",
        "original_title": "\u98A8\u7ACB\u3061\u306C",
        "year": "2013",
        "tmdb_id": 149870,
        "poster_url": "https://image.tmdb.org/t/p/w185/3bIxQuItLeBAkOUBqyvaCI8emgw.jpg",
        "rating": 7.8
      },
      {
        "title": "Ch\u0142opiec i czapla",
        "original_title": "\u541B\u305F\u3061\u306F\u3069\u3046\u751F\u304D\u308B\u304B",
        "year": "2023",
        "tmdb_id": 508883,
        "poster_url": "https://image.tmdb.org/t/p/w185/n2ArOgkidv17tIHnt9X6EnhvLpW.jpg",
        "rating": 7.4
      }
    ]
  },
  {
    "name": "Stanley Kubrick",
    "id": 240,
    "avatar": "https://image.tmdb.org/t/p/w185/exfQ6vXXq7rMS5YWb3B88PK39a1.jpg",
    "movies": [
      {
        "title": "Flying Padre",
        "original_title": "Flying Padre",
        "year": "1951",
        "tmdb_id": 45970,
        "poster_url": "https://image.tmdb.org/t/p/w185/5aog5qVlMFakpogT1Nar9Z7gqq4.jpg",
        "rating": 5.1
      },
      {
        "title": "Day of the Fight",
        "original_title": "Day of the Fight",
        "year": "1951",
        "tmdb_id": 45966,
        "poster_url": "https://image.tmdb.org/t/p/w185/7OEwDK1Fdz8R7Xo9cDWANjiz7vH.jpg",
        "rating": 5.8
      },
      {
        "title": "Fear and Desire",
        "original_title": "Fear and Desire",
        "year": "1953",
        "tmdb_id": 10165,
        "poster_url": "https://image.tmdb.org/t/p/w185/mj7CDh6d5nJDDmEhd0ft6s3L8CM.jpg",
        "rating": 5.4
      },
      {
        "title": "The Seafarers",
        "original_title": "The Seafarers",
        "year": "1953",
        "tmdb_id": 45314,
        "poster_url": "https://image.tmdb.org/t/p/w185/nSucFIAQ5CowEE1WZ87mz3OsbQ1.jpg",
        "rating": 4.5
      },
      {
        "title": "Poca\u0142unek mordercy",
        "original_title": "Killer's Kiss",
        "year": "1955",
        "tmdb_id": 10056,
        "poster_url": "https://image.tmdb.org/t/p/w185/rLbad0lscycS4R3qTSrKguZ0Zz5.jpg",
        "rating": 6.3
      },
      {
        "title": "Zab\xF3jstwo",
        "original_title": "The Killing",
        "year": "1956",
        "tmdb_id": 247,
        "poster_url": "https://image.tmdb.org/t/p/w185/3xyj00iTheDTPGqd3F6mz6GAJ9I.jpg",
        "rating": 7.6
      },
      {
        "title": "\u015Acie\u017Cki chwa\u0142y",
        "original_title": "Paths of Glory",
        "year": "1957",
        "tmdb_id": 975,
        "poster_url": "https://image.tmdb.org/t/p/w185/hGg1UCQSHlXfv2HI9bDHT2OQBam.jpg",
        "rating": 8.3
      },
      {
        "title": "Spartakus",
        "original_title": "Spartacus",
        "year": "1960",
        "tmdb_id": 967,
        "poster_url": "https://image.tmdb.org/t/p/w185/r0Fgg1GyZgzokaiw2HFQv3oPaL2.jpg",
        "rating": 7.5
      },
      {
        "title": "Lolita",
        "original_title": "Lolita",
        "year": "1962",
        "tmdb_id": 802,
        "poster_url": "https://image.tmdb.org/t/p/w185/8Puqbeh0D95DpXFWep1rmH78btu.jpg",
        "rating": 7.3
      },
      {
        "title": "Doktor Strangelove, lub jak przesta\u0142em si\u0119 martwi\u0107 i pokocha\u0142em bomb\u0119",
        "original_title": "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb",
        "year": "1964",
        "tmdb_id": 935,
        "poster_url": "https://image.tmdb.org/t/p/w185/9qA4LQIeCt3UWunufJsvSVsAETq.jpg",
        "rating": 8.1
      },
      {
        "title": "2001: Odyseja kosmiczna",
        "original_title": "2001: A Space Odyssey",
        "year": "1968",
        "tmdb_id": 62,
        "poster_url": "https://image.tmdb.org/t/p/w185/z5m9wsdN9qDP3zrxAiB76Zmui1q.jpg",
        "rating": 8
      },
      {
        "title": "Mechaniczna pomara\u0144cza",
        "original_title": "A Clockwork Orange",
        "year": "1971",
        "tmdb_id": 185,
        "poster_url": "https://image.tmdb.org/t/p/w185/fsPwxQpKyvnKCeTx8MGXQrKMS0h.jpg",
        "rating": 8.2
      },
      {
        "title": "Barry Lyndon",
        "original_title": "Barry Lyndon",
        "year": "1975",
        "tmdb_id": 3175,
        "poster_url": "https://image.tmdb.org/t/p/w185/znfLskGQnXYB2xcOGM9eInRHPAV.jpg",
        "rating": 8
      },
      {
        "title": "L\u015Bnienie",
        "original_title": "The Shining",
        "year": "1980",
        "tmdb_id": 694,
        "poster_url": "https://image.tmdb.org/t/p/w185/lMniGq1BYnHOdhEiLOQxGYAKATC.jpg",
        "rating": 8.2
      },
      {
        "title": "Pe\u0142ny magazynek",
        "original_title": "Full Metal Jacket",
        "year": "1987",
        "tmdb_id": 600,
        "poster_url": "https://image.tmdb.org/t/p/w185/kMKyx1k8hWWscYFnPbnxxN4Eqo4.jpg",
        "rating": 8.1
      },
      {
        "title": "Oczy szeroko zamkni\u0119te",
        "original_title": "Eyes Wide Shut",
        "year": "1999",
        "tmdb_id": 345,
        "poster_url": "https://image.tmdb.org/t/p/w185/eP0DXI35LdMfnPjKXCiHnrWM0hg.jpg",
        "rating": 7.5
      }
    ]
  },
  {
    "name": "Wes Anderson",
    "id": 5655,
    "avatar": "https://image.tmdb.org/t/p/w185/s03CeUeC5yAXyB1acqP0zGNo2SC.jpg",
    "movies": [
      {
        "title": "Bottle Rocket",
        "original_title": "Bottle Rocket",
        "year": "1993",
        "tmdb_id": 56149,
        "poster_url": "https://image.tmdb.org/t/p/w185/6RU227m20neBsRS8WMNuO1BCFn8.jpg",
        "rating": 6.2
      },
      {
        "title": "Rushmore",
        "original_title": "Rushmore",
        "year": "1998",
        "tmdb_id": 11545,
        "poster_url": "https://image.tmdb.org/t/p/w185/hSJ6swahAuZ8wM96lHDTwQPXUvZ.jpg",
        "rating": 7.4
      },
      {
        "title": "Genialny klan",
        "original_title": "The Royal Tenenbaums",
        "year": "2001",
        "tmdb_id": 9428,
        "poster_url": "https://image.tmdb.org/t/p/w185/wR4lB1tQ4WzWrxH8jT91gHlINDZ.jpg",
        "rating": 7.5
      },
      {
        "title": "Podwodne \u017Cycie ze Stevem Zissou",
        "original_title": "The Life Aquatic with Steve Zissou",
        "year": "2004",
        "tmdb_id": 421,
        "poster_url": "https://image.tmdb.org/t/p/w185/zU3jWcVDWc8yHYeIp27vgTRkH9S.jpg",
        "rating": 7.1
      },
      {
        "title": "Poci\u0105g do Darjeeling",
        "original_title": "The Darjeeling Limited",
        "year": "2007",
        "tmdb_id": 4538,
        "poster_url": "https://image.tmdb.org/t/p/w185/nHKbYnnsI1fXaGtTikeVFOlpmas.jpg",
        "rating": 7.1
      },
      {
        "title": "Hotel Chevalier",
        "original_title": "Hotel Chevalier",
        "year": "2007",
        "tmdb_id": 6418,
        "poster_url": "https://image.tmdb.org/t/p/w185/fiWLuGIUAcJtu2hs7KlcZ0O2Ix3.jpg",
        "rating": 6.9
      },
      {
        "title": "Fantastyczny Pan Lis",
        "original_title": "Fantastic Mr. Fox",
        "year": "2009",
        "tmdb_id": 10315,
        "poster_url": "https://image.tmdb.org/t/p/w185/oITj1HUSBheqhHdSVYVCwPQ23tl.jpg",
        "rating": 7.8
      },
      {
        "title": "Kochankowie z ksi\u0119\u017Cyca",
        "original_title": "Moonrise Kingdom",
        "year": "2012",
        "tmdb_id": 83666,
        "poster_url": "https://image.tmdb.org/t/p/w185/2AE4270kUodkAsmJ1nIunandKxe.jpg",
        "rating": 7.7
      },
      {
        "title": "Cousin Ben Troop Screening",
        "original_title": "Cousin Ben Troop Screening",
        "year": "2012",
        "tmdb_id": 126909,
        "poster_url": "https://image.tmdb.org/t/p/w185/u0SbegbpJGPXkKXDNeTfkhtYOIB.jpg",
        "rating": 6.4
      },
      {
        "title": "Castello Cavalcanti",
        "original_title": "Castello Cavalcanti",
        "year": "2013",
        "tmdb_id": 236028,
        "poster_url": "https://image.tmdb.org/t/p/w185/iGZHMSIxbsvjG1M5PfUYq1doMDK.jpg",
        "rating": 7
      },
      {
        "title": "Grand Budapest Hotel",
        "original_title": "The Grand Budapest Hotel",
        "year": "2014",
        "tmdb_id": 120467,
        "poster_url": "https://image.tmdb.org/t/p/w185/npptkW8LqZeIlZUDFoUuOykihlQ.jpg",
        "rating": 8
      },
      {
        "title": "Wyspa ps\xF3w",
        "original_title": "Isle of Dogs",
        "year": "2018",
        "tmdb_id": 399174,
        "poster_url": "https://image.tmdb.org/t/p/w185/xnIAnSrVo6B2ZBNs0sQqhRuTZKh.jpg",
        "rating": 7.8
      },
      {
        "title": "Kurier Francuski z Liberty, Kansas Evening Sun",
        "original_title": "The French Dispatch of the Liberty, Kansas Evening Sun",
        "year": "2021",
        "tmdb_id": 542178,
        "poster_url": "https://image.tmdb.org/t/p/w185/6JXR3KJH5roiBCjWFt09xfgxHZc.jpg",
        "rating": 7
      },
      {
        "title": "Asteroid City",
        "original_title": "Asteroid City",
        "year": "2023",
        "tmdb_id": 747188,
        "poster_url": "https://image.tmdb.org/t/p/w185/hfo7pvL9Fys7rocfL4VOzw9qDEQ.jpg",
        "rating": 6.5
      },
      {
        "title": "Zdumiewaj\u0105ca historia Henry\u2019ego Sugara",
        "original_title": "The Wonderful Story of Henry Sugar",
        "year": "2023",
        "tmdb_id": 923939,
        "poster_url": "https://image.tmdb.org/t/p/w185/fDUywEHwHh6nsLnVXAdPN9m4ZUG.jpg",
        "rating": 7.3
      },
      {
        "title": "\u0141ab\u0119d\u017A",
        "original_title": "The Swan",
        "year": "2023",
        "tmdb_id": 1172675,
        "poster_url": "https://image.tmdb.org/t/p/w185/fRbx6DPdQBJrhZWyshjJABtAIyu.jpg",
        "rating": 6.8
      },
      {
        "title": "Szczuro\u0142ap",
        "original_title": "The Rat Catcher",
        "year": "2023",
        "tmdb_id": 1172674,
        "poster_url": "https://image.tmdb.org/t/p/w185/29WJ7dOHt48AtXK1J1rONEEvIMN.jpg",
        "rating": 6.6
      },
      {
        "title": "Trucizna",
        "original_title": "Poison",
        "year": "2023",
        "tmdb_id": 1172676,
        "poster_url": "https://image.tmdb.org/t/p/w185/IQG49DUJw5DsgcNbW0NfagiDOs.jpg",
        "rating": 6.8
      },
      {
        "title": "Zdumiewaj\u0105ca historia Henry'ego Sugara i trzy inne opowie\u015Bci",
        "original_title": "The Wonderful Story of Henry Sugar and Three More",
        "year": "2024",
        "tmdb_id": 1259365,
        "poster_url": "https://image.tmdb.org/t/p/w185/8gBOtLTs0GNMEZnisAK132o5V67.jpg",
        "rating": 7.5
      },
      {
        "title": "Fenicki uk\u0142ad",
        "original_title": "The Phoenician Scheme",
        "year": "2025",
        "tmdb_id": 1137350,
        "poster_url": "https://image.tmdb.org/t/p/w185/u2jxeYLXTYfu0bqJmnLGIgZswib.jpg",
        "rating": 6.5
      }
    ]
  }
];

// static/js/modules/stats.js
var m3RatingsChart = null;
var m3YearlyChart = null;
var m3GenresChart = null;
var currentAnalyticsScope = "movies";
function updateStats() {
  const elHeading = document.getElementById("m3-stats-heading");
  const elLabel1 = document.getElementById("m3-stat-label-1");
  const elStat1 = document.getElementById("m3-stat-1");
  const elLabel2 = document.getElementById("m3-stat-label-2");
  const elStat2 = document.getElementById("m3-stat-2");
  const elLabel3 = document.getElementById("m3-stat-label-3");
  const elStat3 = document.getElementById("m3-stat-3");
  const elStatAvg = document.getElementById("m3-stat-avg");
  const elStatTime = document.getElementById("m3-stat-time");
  if (!elHeading) return;
  if (state.mode === "movies") {
    const moviesList = Array.isArray(state.movies) ? state.movies.filter(Boolean) : [];
    const total = moviesList.length;
    const watched = moviesList.filter((m) => m.status === "watched").length;
    const favs = moviesList.filter((m) => m.is_favorite).length;
    const rated = moviesList.filter((m) => m.rating !== null && m.rating >= 1);
    const avg = rated.length > 0 ? (rated.reduce((sum, m) => sum + m.rating, 0) / rated.length).toFixed(1) : "0.0";
    const totalMins = moviesList.filter((m) => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);
    elHeading.innerText = "Podsumowanie Film\xF3w";
    if (elLabel1) elLabel1.innerText = "Kolekcja";
    if (elStat1) elStat1.innerText = total;
    if (elLabel2) elLabel2.innerText = "Obejrzane";
    if (elStat2) elStat2.innerText = watched;
    if (elLabel3) elLabel3.innerText = "Ulubione";
    if (elStat3) elStat3.innerText = favs;
    if (elStatAvg) elStatAvg.innerText = avg + "\u2605";
    if (elStatTime) elStatTime.innerText = formatWatchTimeMinutes(totalMins);
  } else {
    const showsList = Array.isArray(state.shows) ? state.shows.filter(Boolean) : [];
    const totalShows = showsList.length;
    const watching = showsList.filter((s) => s.status === "watching").length;
    const totalEps = showsList.reduce((sum, s) => sum + (s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0), 0);
    const rated = showsList.filter((s) => s.rating !== null && s.rating >= 1);
    const avg = rated.length > 0 ? (rated.reduce((sum, s) => sum + s.rating, 0) / rated.length).toFixed(1) : "0.0";
    const totalMins = showsList.reduce((sum, s) => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0;
      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      return sum + epCount * epDuration;
    }, 0);
    elHeading.innerText = "Podsumowanie Seriali";
    if (elLabel1) elLabel1.innerText = "Wszystkie seriale";
    if (elStat1) elStat1.innerText = totalShows;
    if (elLabel2) elLabel2.innerText = "Ogl\u0105dane w toku";
    if (elStat2) elStat2.innerText = watching;
    if (elLabel3) elLabel3.innerText = "Obejrzane odcinki";
    if (elStat3) elStat3.innerText = totalEps;
    if (elStatAvg) elStatAvg.innerText = avg + "\u2605";
    if (elStatTime) elStatTime.innerText = formatWatchTimeMinutes(totalMins);
  }
}
function initCharts(scope = currentAnalyticsScope) {
  currentAnalyticsScope = scope;
  const ctxRatings = document.getElementById("m3RatingsChart");
  const ctxYearly = document.getElementById("m3YearlyChart");
  const ctxGenres = document.getElementById("m3GenresChart");
  if (!ctxRatings || !ctxYearly) return;
  const btnMovies = document.getElementById("m3-analytics-mode-movies");
  const btnShows = document.getElementById("m3-analytics-mode-shows");
  const btnAll = document.getElementById("m3-analytics-mode-all");
  if (btnMovies) btnMovies.classList.toggle("active", scope === "movies");
  if (btnShows) btnShows.classList.toggle("active", scope === "shows");
  if (btnAll) btnAll.classList.toggle("active", scope === "all");
  const totalLabel = document.getElementById("m3-analytics-total-label");
  const watchedLabel = document.getElementById("m3-analytics-watched-label");
  const elTotal = document.getElementById("m3-analytics-total-count");
  const elWatched = document.getElementById("m3-analytics-watched-count");
  const elTime = document.getElementById("m3-analytics-time-count");
  const elAvg = document.getElementById("m3-analytics-avg-rating");
  const elFav = document.getElementById("m3-analytics-fav-count");
  const elWatchlist = document.getElementById("m3-analytics-watchlist-count");
  let totalCount = 0;
  let watchedCount = 0;
  let favCount = 0;
  let watchlistCount = 0;
  let totalMinutes = 0;
  let allRatings = [];
  const genreCountMap = {};
  const yearlyMap = {};
  if (scope === "movies") {
    if (totalLabel) totalLabel.innerText = "Filmy w kolekcji";
    if (watchedLabel) watchedLabel.innerText = "Obejrzane filmy";
    totalCount = state.movies.length;
    watchedCount = state.movies.filter((m) => m.status === "watched").length;
    favCount = state.movies.filter((m) => m.is_favorite).length;
    watchlistCount = state.movies.filter((m) => m.status === "watchlist").length;
    totalMinutes = state.movies.filter((m) => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);
    state.movies.forEach((m) => {
      if (m.rating && m.rating >= 1 && m.rating <= 5) allRatings.push(m.rating);
      const gList = m.genres || (m.genre ? m.genre.split(",") : []);
      gList.forEach((g) => {
        const cleanG = (typeof g === "string" ? g : g.name || "").trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });
      const d = m.watch_date || m.created_at || m.release_date || (m.year ? `${m.year}-01-01` : null);
      if (d) {
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });
  } else if (scope === "shows") {
    if (totalLabel) totalLabel.innerText = "Seriale og\xF3\u0142em";
    if (watchedLabel) watchedLabel.innerText = "Obejrzane odcinki";
    totalCount = state.shows.length;
    favCount = state.shows.filter((s) => s.is_favorite).length;
    watchlistCount = state.shows.filter((s) => s.status === "watchlist").length;
    state.shows.forEach((s) => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0;
      watchedCount += epCount;
      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      totalMinutes += epCount * epDuration;
      if (s.rating && s.rating >= 1 && s.rating <= 5) allRatings.push(s.rating);
      const gList = s.genres || (s.genre ? s.genre.split(",") : []);
      gList.forEach((g) => {
        const cleanG = (typeof g === "string" ? g : g.name || "").trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });
      if (s.episodes_watched && s.episodes_watched.length > 0) {
        s.episodes_watched.forEach((ep) => {
          const d = ep.created_at || ep.date;
          if (d) {
            const y = d.split("-")[0].substring(0, 4);
            if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
              yearlyMap[y] = (yearlyMap[y] || 0) + 1;
            }
          }
        });
      } else if (s.created_at || s.year) {
        const d = s.created_at || `${s.year}-01-01`;
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });
  } else {
    if (totalLabel) totalLabel.innerText = "\u0141\u0105czna kolekcja";
    if (watchedLabel) watchedLabel.innerText = "Wszystkie seanse";
    totalCount = state.movies.length + state.shows.length;
    const watchedMoviesCount = state.movies.filter((m) => m.status === "watched").length;
    const totalEps = state.shows.reduce((sum, s) => sum + (s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0), 0);
    watchedCount = watchedMoviesCount + totalEps;
    favCount = state.movies.filter((m) => m.is_favorite).length + state.shows.filter((s) => s.is_favorite).length;
    watchlistCount = state.movies.filter((m) => m.status === "watchlist").length + state.shows.filter((s) => s.status === "watchlist").length;
    const movieMins = state.movies.filter((m) => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);
    const showMins = state.shows.reduce((sum, s) => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0;
      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      return sum + epCount * epDuration;
    }, 0);
    totalMinutes = movieMins + showMins;
    [...state.movies, ...state.shows].forEach((it) => {
      if (it.rating && it.rating >= 1 && it.rating <= 5) allRatings.push(it.rating);
      const gList = it.genres || (it.genre ? it.genre.split(",") : []);
      gList.forEach((g) => {
        const cleanG = (typeof g === "string" ? g : g.name || "").trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });
    });
    state.movies.forEach((m) => {
      const d = m.watch_date || m.created_at || m.release_date || (m.year ? `${m.year}-01-01` : null);
      if (d) {
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });
    state.shows.forEach((s) => {
      if (s.episodes_watched && s.episodes_watched.length > 0) {
        s.episodes_watched.forEach((ep) => {
          const d = ep.created_at || ep.date;
          if (d) {
            const y = d.split("-")[0].substring(0, 4);
            if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
              yearlyMap[y] = (yearlyMap[y] || 0) + 1;
            }
          }
        });
      }
    });
  }
  const avgRating = allRatings.length > 0 ? (allRatings.reduce((acc, r) => acc + r, 0) / allRatings.length).toFixed(1) + "\u2605" : "0.0\u2605";
  if (elTotal) elTotal.innerText = totalCount;
  if (elWatched) elWatched.innerText = watchedCount;
  if (elTime) elTime.innerText = formatWatchTimeMinutes(totalMinutes);
  if (elAvg) elAvg.innerText = avgRating;
  if (elFav) elFav.innerText = favCount;
  if (elWatchlist) elWatchlist.innerText = watchlistCount;
  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? "rgba(255, 255, 255, 0.88)" : "rgba(28, 27, 31, 0.88)";
  const textMutedColor = isDark ? "rgba(255, 255, 255, 0.60)" : "rgba(28, 27, 31, 0.60)";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";
  const counts = [0, 0, 0, 0, 0];
  allRatings.forEach((r) => {
    if (r >= 1 && r <= 5) counts[r - 1]++;
  });
  if (m3RatingsChart) m3RatingsChart.destroy();
  if (ctxRatings && window.Chart) {
    m3RatingsChart = new Chart(ctxRatings, {
      type: "bar",
      data: {
        labels: ["1\u2605", "2\u2605", "3\u2605", "4\u2605", "5\u2605"],
        datasets: [{
          label: "Liczba ocen",
          data: counts,
          backgroundColor: ["#f2b8b5", "#e8def8", "#d0bcff", "#8b5cf6", "#6750a4"],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textMutedColor, font: { size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 12, weight: "600" } }
          }
        }
      }
    });
  }
  if (ctxGenres) {
    const sortedGenres = Object.entries(genreCountMap).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const genreLabels = sortedGenres.map((g) => g[0]);
    const genreValues = sortedGenres.map((g) => g[1]);
    const hasGenres = genreLabels.length > 0;
    const chartCard = ctxGenres.closest("div") || ctxGenres.parentElement;
    let emptyState = chartCard ? chartCard.querySelector(".m3-genres-empty-state") : null;
    if (m3GenresChart) {
      m3GenresChart.destroy();
      m3GenresChart = null;
    }
    if (!hasGenres) {
      ctxGenres.style.display = "none";
      if (!emptyState && chartCard) {
        emptyState = document.createElement("div");
        emptyState.className = "m3-genres-empty-state";
        emptyState.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 180px; text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 12px;";
        emptyState.innerHTML = `
          <span class="material-symbols-rounded" style="font-size: 38px; opacity: 0.35; margin-bottom: 6px;">category</span>
          <div style="font-size: 0.88rem; font-weight: 700; color: var(--md-sys-color-on-surface);">Brak danych o gatunkach</div>
          <div style="font-size: 0.76rem; opacity: 0.7; margin-top: 4px; max-width: 220px; line-height: 1.3;">Gatunki zostan\u0105 uzupe\u0142nione automatycznie przy dodawaniu i synchronizacji z TMDb.</div>
        `;
        chartCard.appendChild(emptyState);
      } else if (emptyState) {
        emptyState.style.display = "flex";
      }
    } else {
      ctxGenres.style.display = "block";
      if (emptyState) emptyState.style.display = "none";
      if (window.Chart) {
        m3GenresChart = new Chart(ctxGenres, {
          type: "doughnut",
          data: {
            labels: genreLabels,
            datasets: [{
              data: genreValues,
              backgroundColor: ["#d0bcff", "#38bdf8", "#34d399", "#f59e0b", "#f43f5e", "#a78bfa"],
              borderWidth: 2,
              borderColor: isDark ? "#1e1b24" : "#ffffff"
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "bottom",
                labels: {
                  boxWidth: 12,
                  font: { size: 11, weight: "600" },
                  color: textColor,
                  padding: 8,
                  usePointStyle: true
                }
              }
            },
            cutout: "65%"
          }
        });
      }
    }
  }
  const years = Object.keys(yearlyMap).sort();
  const yearlyCounts = years.map((y) => yearlyMap[y]);
  if (m3YearlyChart) m3YearlyChart.destroy();
  if (ctxYearly && window.Chart) {
    m3YearlyChart = new Chart(ctxYearly, {
      type: "line",
      data: {
        labels: years.length > 0 ? years : ["2022", "2023", "2024", "2025", "2026"],
        datasets: [{
          label: "Liczba seans\xF3w",
          data: yearlyCounts.length > 0 ? yearlyCounts : [0, 0, 0, 0, 0],
          borderColor: "#d0bcff",
          backgroundColor: "rgba(208, 188, 255, 0.15)",
          fill: true,
          tension: 0.35,
          pointBackgroundColor: "#8b5cf6",
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: gridColor },
            ticks: { color: textMutedColor, font: { size: 11 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 11 } }
          }
        }
      }
    });
  }
  renderYearlyGoalCard();
  renderDirectorMasteryBadges();
}
function renderYearlyGoalCard() {
  const container = document.getElementById("m3-analytics-yearly-goal-box");
  if (!container) return;
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const savedGoal = parseInt(localStorage.getItem("cinelog_yearly_goal")) || 52;
  const watchedThisYear = state.movies.filter((m) => {
    if (m.status !== "watched") return false;
    const date = m.watch_date || m.created_at || "";
    return date.startsWith(String(currentYear));
  }).length;
  const pct = Math.min(Math.round(watchedThisYear / savedGoal * 100), 100);
  container.innerHTML = `
    <div style="background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-xl); padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-rounded" style="color: #eab308; font-size: 22px;">military_tech</span>
          <div>
            <div style="font-weight: 700; font-size: 0.88rem;">Wyzwanie Filmowe ${currentYear}</div>
            <div style="font-size: 0.74rem; color: var(--md-sys-color-on-surface-variant);">Tw\xF3j osobisty cel liczby seans\xF3w w tym roku</div>
          </div>
        </div>
        <button type="button" class="m3-chip" id="m3-btn-change-yearly-goal" style="font-size: 0.72rem; padding: 3px 8px;">
          <span class="material-symbols-rounded" style="font-size: 14px;">edit</span> Cel: ${savedGoal}
        </button>
      </div>

      <div style="display: flex; align-items: baseline; justify-content: space-between;">
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--md-sys-color-primary);">
          ${watchedThisYear} <span style="font-size: 0.85rem; font-weight: 600; color: var(--md-sys-color-on-surface-variant);">/ ${savedGoal} film\xF3w (${pct}%)</span>
        </div>
        <div style="font-size: 0.75rem; font-weight: 600; color: ${pct >= 100 ? "#10b981" : "var(--md-sys-color-primary)"};">
          ${pct >= 100 ? "\u{1F389} Cel osi\u0105gni\u0119ty!" : `Pozosta\u0142o ${Math.max(savedGoal - watchedThisYear, 0)} film\xF3w`}
        </div>
      </div>

      <div style="width: 100%; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 999px; overflow: hidden;">
        <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #8b5cf6, #3b82f6); border-radius: 999px; transition: width 0.3s ease;"></div>
      </div>
    </div>
  `;
  const btnEdit = container.querySelector("#m3-btn-change-yearly-goal");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      const input = prompt(`Ustaw sw\xF3j roczny cel filmowy na ${currentYear} rok (liczba film\xF3w):`, savedGoal);
      if (input && !isNaN(parseInt(input)) && parseInt(input) > 0) {
        localStorage.setItem("cinelog_yearly_goal", parseInt(input));
        renderYearlyGoalCard();
      }
    });
  }
}
var currentDirectorModal = null;
var currentDirectorTab = "watched";
function cleanPartSuffix(str) {
  return (str || "").replace(/(partone|part1|czesc1|czescpierwsza|volume1|vol1|chapter1|parti|parttwo|part2|czesc2|czescdruga|volume2|vol2|chapter2|partii|partthree|part3|czesc3|czesctrzecia|volume3|vol3|chapter3|partiii|[123])$/g, "");
}
function isDirectorMovieMatch(dm, m) {
  if (!dm || !m) return false;
  if (dm.tmdb_id && m.tmdb_id && String(dm.tmdb_id) === String(m.tmdb_id)) return true;
  const mNorm = normalizeTitleForLibrary(m.title);
  if (!mNorm) return false;
  const dmNorm = normalizeTitleForLibrary(dm.title);
  const dmOrigNorm = normalizeTitleForLibrary(dm.original_title);
  if (dmNorm && mNorm === dmNorm) return true;
  if (dmOrigNorm && mNorm === dmOrigNorm) return true;
  if (Array.isArray(dm.aliases)) {
    for (const alias of dm.aliases) {
      const aNorm = normalizeTitleForLibrary(alias);
      if (aNorm && mNorm === aNorm) return true;
    }
  }
  const mYear = m.release_date ? m.release_date.split("-")[0] : m.year || "";
  const dmYear = dm.year || "";
  const yearMatches = Boolean(mYear && dmYear && Math.abs(parseInt(mYear) - parseInt(dmYear)) <= 1);
  const isPart1_m = /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(mNorm);
  const isPart2_m = /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(mNorm);
  const isPart1_dm = /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(dmNorm) || /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(dmOrigNorm);
  const isPart2_dm = /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(dmNorm) || /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(dmOrigNorm);
  if (isPart2_m && !isPart2_dm || !isPart2_m && isPart2_dm) {
    return false;
  }
  if (isPart1_m && isPart2_dm || isPart2_m && isPart1_dm) {
    return false;
  }
  const mClean = cleanPartSuffix(mNorm);
  const dmOrigClean = cleanPartSuffix(dmOrigNorm);
  const dmClean = cleanPartSuffix(dmNorm);
  if (mClean && (mClean === dmOrigClean || mClean === dmClean)) {
    if (yearMatches || !mYear || !dmYear) return true;
  }
  if (yearMatches) {
    if (dmOrigNorm.length >= 4 && (mNorm.includes(dmOrigNorm) || dmOrigNorm.includes(mNorm))) {
      return true;
    }
    if (dmNorm.length >= 4 && (mNorm.includes(dmNorm) || dmNorm.includes(mNorm))) {
      return true;
    }
  }
  return false;
}
function renderDirectorMasteryBadges() {
  const container = document.getElementById("m3-analytics-directors-grid");
  if (!container) return;
  container.innerHTML = "";
  const directorsWithStats = TOP_DIRECTORS_CATALOG.map((dir) => {
    let watchedCount = 0;
    const totalTitles = dir.movies.length;
    dir.movies.forEach((dm) => {
      const match = state.movies.find((m) => m.status === "watched" && isDirectorMovieMatch(dm, m));
      if (match) watchedCount++;
    });
    const pct = totalTitles > 0 ? Math.round(watchedCount / totalTitles * 100) : 0;
    let badgeIcon = "military_tech";
    let badgeColor = "#71717a";
    let badgeRank = "Pocz\u0105tkuj\u0105cy";
    if (pct === 100) {
      badgeIcon = "diamond";
      badgeColor = "#06b6d4";
      badgeRank = "\u{1F48E} Komplet (100%)";
    } else if (pct >= 75) {
      badgeIcon = "workspace_premium";
      badgeColor = "#eab308";
      badgeRank = "\u{1F947} Z\u0142ota Odznaka";
    } else if (pct >= 50) {
      badgeIcon = "military_tech";
      badgeColor = "#94a3b8";
      badgeRank = "\u{1F948} Srebrna Odznaka";
    } else if (pct >= 25) {
      badgeIcon = "military_tech";
      badgeColor = "#b45309";
      badgeRank = "\u{1F949} Br\u0105zowa Odznaka";
    }
    return {
      ...dir,
      watchedCount,
      totalTitles,
      pct,
      badgeIcon,
      badgeColor,
      badgeRank
    };
  });
  directorsWithStats.sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    if (b.watchedCount !== a.watchedCount) return b.watchedCount - a.watchedCount;
    return a.name.localeCompare(b.name, "pl");
  });
  directorsWithStats.forEach((dir) => {
    const card = document.createElement("div");
    card.className = "m3-director-badge-card";
    card.style.cssText = "background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-lg); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; user-select: none;";
    card.onmouseenter = () => {
      card.style.borderColor = dir.badgeColor;
      card.style.transform = "translateY(-2px)";
    };
    card.onmouseleave = () => {
      card.style.borderColor = "var(--md-sys-color-outline-variant)";
      card.style.transform = "translateY(0)";
    };
    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
        <img src="${dir.avatar}" alt="${dir.name}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid ${dir.badgeColor}; flex-shrink: 0; background: var(--md-sys-color-surface-container-highest);" onerror="this.onerror=null; this.src='/static/icons/favicon.png';">
        <div style="min-width: 0;">
          <div style="font-weight: 700; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dir.name}</div>
          <div style="font-size: 0.72rem; color: ${dir.badgeColor}; font-weight: 600;">${dir.badgeRank}</div>
        </div>
      </div>
      <div style="text-align: right; flex-shrink: 0;">
        <div style="font-size: 0.88rem; font-weight: 800; color: var(--md-sys-color-primary);">${dir.watchedCount}/${dir.totalTitles}</div>
        <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); font-weight: 600;">${dir.pct}%</div>
      </div>
    `;
    card.addEventListener("click", () => {
      openDirectorDetailModal(dir, "watched");
    });
    container.appendChild(card);
  });
}
function openDirectorDetailModal(dir, activeTab = "watched") {
  currentDirectorModal = dir;
  currentDirectorTab = activeTab;
  const sheet = document.getElementById("m3-sheet-director-detail");
  if (!sheet) return;
  const avatarEl = document.getElementById("m3-director-modal-avatar");
  const nameEl = document.getElementById("m3-director-modal-name");
  const badgeEl = document.getElementById("m3-director-modal-badge");
  const statsEl = document.getElementById("m3-director-modal-stats");
  if (avatarEl) {
    avatarEl.src = dir.avatar;
    avatarEl.onerror = () => {
      avatarEl.src = "/static/icons/favicon.png";
    };
  }
  if (nameEl) nameEl.textContent = dir.name;
  const totalTitles = dir.movies.length;
  const processedMovies = dir.movies.map((dm) => {
    const matchedMovie = state.movies.find((m) => isDirectorMovieMatch(dm, m));
    const isWatched = Boolean(matchedMovie && matchedMovie.status === "watched");
    const isWatchlist = Boolean(matchedMovie && matchedMovie.status === "watchlist");
    return {
      ...dm,
      isWatched,
      isWatchlist,
      matchedMovie,
      userRating: matchedMovie ? matchedMovie.rating : null
    };
  });
  const watchedList = processedMovies.filter((m) => m.isWatched);
  const missingList = processedMovies.filter((m) => !m.isWatched);
  const watchedCount = watchedList.length;
  const pct = totalTitles > 0 ? Math.round(watchedCount / totalTitles * 100) : 0;
  let badgeColor = "#71717a";
  let badgeRank = "\u{1F3AC} Pocz\u0105tkuj\u0105cy Kinoman";
  if (pct === 100) {
    badgeColor = "#06b6d4";
    badgeRank = "\u{1F48E} Komplet Mistrza (100%)";
  } else if (pct >= 75) {
    badgeColor = "#eab308";
    badgeRank = "\u{1F947} Z\u0142ota Odznaka Re\u017Cyserska";
  } else if (pct >= 50) {
    badgeColor = "#94a3b8";
    badgeRank = "\u{1F948} Srebrna Odznaka Re\u017Cyserska";
  } else if (pct >= 25) {
    badgeColor = "#b45309";
    badgeRank = "\u{1F949} Br\u0105zowa Odznaka Re\u017Cyserska";
  }
  if (badgeEl) {
    badgeEl.textContent = badgeRank;
    badgeEl.style.borderColor = badgeColor;
    badgeEl.style.color = badgeColor;
  }
  if (statsEl) {
    statsEl.textContent = `Obejrzano ${watchedCount} z ${totalTitles} film\xF3w (${pct}%) \u2022 Re\u017Cyseria: ${dir.name}`;
  }
  const countWatchedEl = document.getElementById("m3-dir-count-watched");
  const countMissingEl = document.getElementById("m3-dir-count-missing");
  const countAllEl = document.getElementById("m3-dir-count-all");
  if (countWatchedEl) countWatchedEl.textContent = watchedList.length;
  if (countMissingEl) countMissingEl.textContent = missingList.length;
  if (countAllEl) countAllEl.textContent = totalTitles;
  const tabWatched = document.getElementById("m3-dir-tab-watched");
  const tabMissing = document.getElementById("m3-dir-tab-missing");
  const tabAll = document.getElementById("m3-dir-tab-all");
  if (tabWatched) tabWatched.classList.toggle("active", activeTab === "watched");
  if (tabMissing) tabMissing.classList.toggle("active", activeTab === "missing");
  if (tabAll) tabAll.classList.toggle("active", activeTab === "all");
  const grid = document.getElementById("m3-director-movies-container");
  if (grid) {
    grid.innerHTML = "";
    let listToRender = processedMovies;
    if (activeTab === "watched") listToRender = watchedList;
    else if (activeTab === "missing") listToRender = missingList;
    if (listToRender.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px 16px; color: var(--md-sys-color-on-surface-variant);">
          <span class="material-symbols-rounded" style="font-size: 36px; margin-bottom: 8px;">check_circle</span>
          <p style="margin: 0; font-size: 0.85rem; font-weight: 600;">
            ${activeTab === "missing" ? "\u{1F389} Gratulacje! Obejrza\u0142e\u015B wszystkie filmy z filmografii tego re\u017Cysera!" : "Brak pozycji w tej kategorii."}
          </p>
        </div>
      `;
    } else {
      listToRender.forEach((item) => {
        const itemCard = document.createElement("div");
        itemCard.style.cssText = "background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-lg); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s ease;";
        let posterHtml = "";
        if (item.poster_url) {
          posterHtml = `
            <div style="position: relative; width: 100%; aspect-ratio: 2/3; background: var(--md-sys-color-surface-container-highest);">
              <img src="${item.poster_url}" alt="${item.title}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(item.title)}; display: none; width: 100%; height: 100%; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; font-weight: 700; padding: 6px;">${item.title}</div>
            </div>
          `;
        } else {
          posterHtml = `
            <div style="width: 100%; aspect-ratio: 2/3; background: ${getGradientForTitle(item.title)}; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; font-weight: 700; padding: 6px;">${item.title}</div>
          `;
        }
        let footerHtml = "";
        if (item.isWatched) {
          const stars = item.userRating ? `\u2605 ${item.userRating}/5` : "\u2713 Obejrzano";
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 6px 8px 8px 8px;">
              <span style="font-size: 0.72rem; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 3px;">
                <span class="material-symbols-rounded" style="font-size: 14px;">check_circle</span> ${stars}
              </span>
              <button type="button" class="m3-chip" style="font-size: 0.65rem; padding: 2px 6px;">Szczeg\xF3\u0142y</button>
            </div>
          `;
          itemCard.style.cursor = "pointer";
          itemCard.addEventListener("click", () => {
            if (item.matchedMovie) {
              openMovieDetail(item.matchedMovie);
            }
          });
        } else if (item.isWatchlist) {
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 6px 8px 8px 8px;">
              <span style="font-size: 0.7rem; font-weight: 700; color: var(--md-sys-color-primary); display: flex; align-items: center; gap: 3px;">
                <span class="material-symbols-rounded" style="font-size: 14px;">bookmark</span> Na li\u015Bcie
              </span>
              <button type="button" class="m3-chip" style="font-size: 0.65rem; padding: 2px 6px;">Szczeg\xF3\u0142y</button>
            </div>
          `;
          itemCard.style.cursor = "pointer";
          itemCard.addEventListener("click", () => {
            if (item.matchedMovie) {
              openMovieDetail(item.matchedMovie);
            }
          });
        } else {
          footerHtml = `
            <div style="margin-top: auto; padding: 6px 8px 8px 8px;">
              <button type="button" class="m3-btn-action-primary m3-btn-add-dir-movie" style="width: 100%; justify-content: center; font-size: 0.7rem; padding: 4px 6px; border-radius: var(--md-corner-full); font-weight: 700; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary);">
                <span class="material-symbols-rounded" style="font-size: 14px;">add</span> Do listy
              </button>
            </div>
          `;
        }
        itemCard.innerHTML = `
          ${posterHtml}
          <div style="padding: 6px 8px 0 8px;">
            <div style="font-weight: 700; font-size: 0.78rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${item.title}">${item.title}</div>
            <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); margin-top: 2px;">${item.year || ""}</div>
          </div>
          ${footerHtml}
        `;
        const btnAdd = itemCard.querySelector(".m3-btn-add-dir-movie");
        if (btnAdd) {
          btnAdd.addEventListener("click", (e) => {
            e.stopPropagation();
            const newMovie = {
              uuid: generateUUID(),
              tmdb_id: item.tmdb_id,
              title: item.title,
              original_title: item.original_title,
              release_date: item.year ? `${item.year}-01-01` : "",
              poster_url: item.poster_url,
              director: dir.name,
              status: "watchlist",
              rating: null,
              created_at: (/* @__PURE__ */ new Date()).toISOString()
            };
            state.movies.unshift(newMovie);
            saveLocalDatabase();
            updateStats();
            if (state.mode === "movies") renderMovies();
            showToastNotification(`Dodano \u201E${item.title}\u201D do listy Do obejrzenia!`, "success");
            openDirectorDetailModal(dir, activeTab);
            renderDirectorMasteryBadges();
          });
        }
        grid.appendChild(itemCard);
      });
    }
  }
  sheet.classList.add("active");
}
function openAnalyticsModal() {
  const sheet = document.getElementById("m3-sheet-analytics");
  if (sheet) {
    sheet.classList.add("active");
    setTimeout(() => initCharts(state.mode === "shows" ? "shows" : "movies"), 80);
  }
}
function initAnalyticsEvents() {
  const btnOpenAnalytics = document.getElementById("m3-btn-open-analytics");
  const btnMobileAnalytics = document.getElementById("m3-mobile-analytics");
  const btnCloseAnalytics = document.getElementById("m3-sheet-analytics-close");
  const sheetAnalytics = document.getElementById("m3-sheet-analytics");
  if (btnOpenAnalytics) btnOpenAnalytics.addEventListener("click", openAnalyticsModal);
  if (btnMobileAnalytics) btnMobileAnalytics.addEventListener("click", openAnalyticsModal);
  if (btnCloseAnalytics && sheetAnalytics) {
    btnCloseAnalytics.addEventListener("click", () => {
      sheetAnalytics.classList.remove("active");
    });
  }
  const btnAnalyticsMovies = document.getElementById("m3-analytics-mode-movies");
  const btnAnalyticsShows = document.getElementById("m3-analytics-mode-shows");
  const btnAnalyticsAll = document.getElementById("m3-analytics-mode-all");
  if (btnAnalyticsMovies) btnAnalyticsMovies.addEventListener("click", () => initCharts("movies"));
  if (btnAnalyticsShows) btnAnalyticsShows.addEventListener("click", () => initCharts("shows"));
  if (btnAnalyticsAll) btnAnalyticsAll.addEventListener("click", () => initCharts("all"));
  const btnCloseDirModal = document.getElementById("m3-director-modal-close");
  const sheetDirDetail = document.getElementById("m3-sheet-director-detail");
  if (btnCloseDirModal && sheetDirDetail) {
    btnCloseDirModal.addEventListener("click", () => {
      sheetDirDetail.classList.remove("active");
    });
  }
  const tabWatched = document.getElementById("m3-dir-tab-watched");
  const tabMissing = document.getElementById("m3-dir-tab-missing");
  const tabAll = document.getElementById("m3-dir-tab-all");
  if (tabWatched) {
    tabWatched.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "watched");
    });
  }
  if (tabMissing) {
    tabMissing.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "missing");
    });
  }
  if (tabAll) {
    tabAll.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "all");
    });
  }
}

// static/js/modules/ai.js
var STORAGE_KEY = "cinelog_ai_config";
var AI_PRESETS = {
  openai: {
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo", "o3-mini"],
    placeholder: "sk-proj-...",
    requiresKey: true
  },
  deepseek: {
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    placeholder: "sk-...",
    requiresKey: true
  },
  groq: {
    name: "Groq (Szybki & Darmowy)",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
    placeholder: "gsk_...",
    requiresKey: true
  },
  openrouter: {
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-chat",
    models: ["deepseek/deepseek-chat", "deepseek/deepseek-r1", "anthropic/claude-3.5-sonnet", "meta-llama/llama-3.3-70b-instruct"],
    placeholder: "sk-or-v1-...",
    requiresKey: true
  },
  ollama: {
    name: "Ollama / Lokalne AI",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    models: ["llama3.2", "deepseek-r1", "mistral", "qwen2.5"],
    placeholder: "Opcjonalny klucz (np. ollama)",
    requiresKey: false
  },
  custom: {
    name: "W\u0142asne API (OpenAI)",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini"],
    placeholder: "Wpisz sw\xF3j klucz API",
    requiresKey: true
  }
};
function getAiConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
  }
  return {
    provider: "openai",
    apiKey: "",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    enabled: false
  };
}
function saveAiConfig(cfg) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    return true;
  } catch (e) {
    console.error("Failed to save AI config:", e);
    return false;
  }
}
function isAiConfigured() {
  const cfg = getAiConfig();
  if (cfg.provider === "ollama") return true;
  return Boolean(cfg.apiKey && cfg.apiKey.trim().length > 5);
}
function getAiLanguagePrompt() {
  const country = (state.userVodCountry || "PL").toUpperCase();
  const langMap = {
    "PL": { lang: "j\u0119zyku polskim (Polish)", vod: "w Polsce (np. Netflix, HBO Max, SkyShowtime, Disney+, Prime Video, Canal+, Player, Polsat Box Go, TVP VOD)" },
    "US": { lang: "j\u0119zyku angielskim (English)", vod: "w USA (np. Netflix, Max, Disney+, Hulu, Prime Video, Apple TV+)" },
    "GB": { lang: "j\u0119zyku angielskim (English)", vod: "w Wielkiej Brytanii (np. BBC iPlayer, Netflix, NOW, Prime Video, Disney+)" },
    "DE": { lang: "j\u0119zyku niemieckim (German)", vod: "w Niemczech (np. Netflix, WOW/Sky, Prime Video, Disney+)" },
    "FR": { lang: "j\u0119zyku francuskim (French)", vod: "we Francji (np. Netflix, Canal+, Prime Video, Disney+)" },
    "ES": { lang: "j\u0119zyku hiszpa\u0144skim (Spanish)", vod: "w Hiszpanii (np. Netflix, Movistar+, Prime Video, HBO Max)" },
    "IT": { lang: "j\u0119zyku w\u0142oskim (Italian)", vod: "we W\u0142oszech (np. Netflix, NOW/Sky, Prime Video, Disney+)" }
  };
  const selected = langMap[country] || { lang: "j\u0119zyku angielskim (English)", vod: `dla wybranego kraju (${country})` };
  return `ZASADA J\u0118ZYKA I VOD:
- Odpowiadaj WY\u0141\u0104CZNIE w ${selected.lang}.
- Proponowane platformy streamingowe dostosuj do dost\u0119pno\u015Bci ${selected.vod}.
- Nie wypisuj swojego toku my\u015Blenia ani meta-analizy zadania w tre\u015Bci odpowiedzi. Odpowiadaj od razu konkretnie do u\u017Cytkownika.`;
}
async function testAiConnection(config) {
  const cfg = config || getAiConfig();
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const apiKey = cfg.apiKey ? cfg.apiKey.trim() : "";
  const model = cfg.model || "gpt-4o-mini";
  const startTime = Date.now();
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (cfg.provider === "openrouter") {
      headers["HTTP-Referer"] = window.location.origin;
      headers["X-Title"] = "CineLog";
    }
    const payload = {
      model,
      messages: [
        { role: "system", content: "You are CineLog assistant. Reply with only one word: OK." },
        { role: "user", content: "Test." }
      ],
      max_tokens: 10,
      temperature: 0.1
    };
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload)
    });
    const elapsed = Date.now() - startTime;
    if (!res.ok) {
      let errDetail = `B\u0142\u0105d HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson.error && errJson.error.message) {
          errDetail = errJson.error.message;
        }
      } catch (e) {
      }
      return { success: false, error: errDetail, elapsed };
    }
    const data = await res.json();
    if (data.choices && data.choices.length > 0) {
      return { success: true, model, elapsed };
    } else {
      return { success: false, error: "Pusta odpowied\u017A z modelu.", elapsed };
    }
  } catch (err) {
    const elapsed = Date.now() - startTime;
    return { success: false, error: err.message || "B\u0142\u0105d po\u0142\u0105czenia sieciowego (sprawd\u017A CORS lub adres API).", elapsed };
  }
}
async function streamAiChat({ messages, temperature = 0.7, max_tokens = 2e3, onToken, onThought }) {
  const cfg = getAiConfig();
  if (!isAiConfigured()) {
    throw new Error("Asystent AI nie zosta\u0142 jeszcze skonfigurowany. Otw\xF3rz 'Chmura & Asystent AI', aby poda\u0107 klucz API.");
  }
  const baseUrl = (cfg.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const headers = {
    "Content-Type": "application/json"
  };
  if (cfg.apiKey) {
    headers["Authorization"] = `Bearer ${cfg.apiKey.trim()}`;
  }
  if (cfg.provider === "openrouter") {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "CineLog";
  }
  const payload = {
    model: cfg.model || "gpt-4o-mini",
    messages,
    temperature,
    max_tokens,
    stream: true
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    let msg = `B\u0142\u0105d API (${res.status})`;
    try {
      const err = await res.json();
      if (err.error && err.error.message) msg = err.error.message;
    } catch (e) {
    }
    throw new Error(msg);
  }
  if (!res.body) {
    throw new Error("Przegl\u0105darka nie obs\u0142uguje strumieniowania odpowiedzi.");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let sseBuffer = "";
  let rawAccumulatedContent = "";
  let fullThought = "";
  let fullContent = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;
      if (trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data: ")) {
        try {
          const jsonStr = trimmed.slice(6);
          const parsed = JSON.parse(jsonStr);
          const delta = parsed.choices?.[0]?.delta;
          if (delta) {
            const explicitThought = delta.reasoning_content || delta.reasoning || delta.thought || "";
            if (explicitThought) {
              fullThought += explicitThought;
              if (onThought) onThought(explicitThought, fullThought);
            }
            if (delta.content) {
              rawAccumulatedContent += delta.content;
              if (rawAccumulatedContent.includes("<think>")) {
                const thinkStart = rawAccumulatedContent.indexOf("<think>");
                const thinkEnd = rawAccumulatedContent.indexOf("</think>");
                if (thinkEnd !== -1) {
                  const tagThought = rawAccumulatedContent.substring(thinkStart + 7, thinkEnd).trim();
                  const afterContent = rawAccumulatedContent.substring(thinkEnd + 8).trimStart();
                  if (tagThought) {
                    fullThought = tagThought;
                    if (onThought) onThought("", fullThought);
                  }
                  fullContent = afterContent;
                  if (onToken) onToken(delta.content, fullContent);
                } else {
                  const ongoingThought = rawAccumulatedContent.substring(thinkStart + 7);
                  fullThought = ongoingThought;
                  if (onThought) onThought(delta.content, fullThought);
                }
              } else {
                fullContent += delta.content;
                if (onToken) onToken(delta.content, fullContent);
              }
            }
          }
        } catch (err) {
        }
      }
    }
  }
  if (!fullContent.trim() && fullThought.trim()) {
    fullContent = fullThought;
    if (onToken) onToken(fullThought, fullContent);
  }
  if (!fullContent && !fullThought) {
    throw new Error("Otrzymano pust\u0105 odpowied\u017A od modelu AI.");
  }
  return fullContent.trim();
}
function formatAiMarkdown(text) {
  if (!text) return "";
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  let html = clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\*(.*?)\*/g, "<em>$1</em>").replace(/^### (.*$)/gim, '<h4 style="margin: 12px 0 6px 0; color: #a855f7; font-size: 0.95rem; font-weight: 700;">$1</h4>').replace(/^## (.*$)/gim, '<h3 style="margin: 14px 0 8px 0; color: #a855f7; font-size: 1.05rem; font-weight: 800;">$1</h3>').replace(/\n\n/g, "<br><br>").replace(/\n- /g, "<br>\u2022 ").replace(/\n\d+\. /g, (match) => `<br>${match.trim()} `);
  return html;
}
function cleanTitleCandidate(str) {
  if (!str) return "";
  return str.replace(/<[^>]*>/g, "").replace(/["„”«»*`_~]/g, "").replace(/\(\d{4}[^)]*\)/g, "").replace(/[:\-–—].*$/, "").trim();
}
async function resolveMentionedMediaItems(text) {
  if (!text) return [];
  const cleanText = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const lines = cleanText.split("\n");
  const primaryCandidates = [];
  const secondaryCandidates = [];
  const forbiddenWords = [
    "analyze",
    "brainstorm",
    "request",
    "profile",
    "constraints",
    "idea",
    "selection",
    "archetyp",
    "kluczowe",
    "wzorce",
    "rekomendacja",
    "rekomendacje",
    "propozycje",
    "gustu",
    "kinomana",
    "fascynacj",
    "zasady",
    "platforma",
    "vod",
    "netflix",
    "hbo",
    "prime",
    "disney",
    "canal+",
    "film",
    "serial",
    "filmy",
    "seriale",
    "odpowied\u017A",
    "asystent",
    "u\u017Cytkownik",
    "status",
    "ocena",
    "opinia",
    "masz na li\u015Bcie",
    "do obejrzenia",
    "watchlist",
    "obejrzane",
    "planowane",
    "biblioteka",
    "kontekst",
    "tytu\u0142",
    "tytu\u0142y",
    "ulubione",
    "dla ciebie",
    "polska",
    "tok my\u015Blenia",
    "z\u0142ota rekomendacja",
    "wyb\xF3r",
    "minut",
    "godzin"
  ];
  const isForbidden = (str) => {
    const l = str.toLowerCase().trim();
    return forbiddenWords.some((fw) => l === fw || l.includes(fw)) || /^\d+[\.\)]/.test(str);
  };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isNumberedOrBullet = /^(?:\d+[\.\)]|[-*•])\s+/.test(trimmed);
    if (isNumberedOrBullet) {
      const firstQuoteMatch = trimmed.match(/^[^"„”«»]*["„”«»]([^"„”«»\n\r]{2,50})["„”«»]/);
      const firstBoldMatch = trimmed.match(/^[^**]*\*\*([^*:\n\r]{2,50})\*\*/);
      let lineTitle = "";
      if (firstQuoteMatch) {
        lineTitle = cleanTitleCandidate(firstQuoteMatch[1]);
      } else if (firstBoldMatch) {
        lineTitle = cleanTitleCandidate(firstBoldMatch[1]);
      }
      const yearMatch = trimmed.match(/\b(19\d\d|20\d\d)\b/);
      const year = yearMatch ? yearMatch[1] : "";
      if (lineTitle && lineTitle.length >= 2 && !isForbidden(lineTitle)) {
        if (!primaryCandidates.some((c) => c.name.toLowerCase() === lineTitle.toLowerCase())) {
          primaryCandidates.push({ name: lineTitle, year });
        }
      }
    }
  }
  const quotedRegex = /["„”«»]([^"„”«»\n\r]{2,50})["„”«»]/g;
  let match;
  while ((match = quotedRegex.exec(cleanText)) !== null) {
    const cleaned = cleanTitleCandidate(match[1]);
    if (cleaned.length >= 2 && cleaned.length <= 45 && !isForbidden(cleaned)) {
      if (!primaryCandidates.some((c) => c.name.toLowerCase() === cleaned.toLowerCase()) && !secondaryCandidates.some((c) => c.name.toLowerCase() === cleaned.toLowerCase())) {
        secondaryCandidates.push({ name: cleaned, year: "" });
      }
    }
  }
  const orderedCandidates = primaryCandidates.length > 0 ? primaryCandidates : secondaryCandidates;
  const results = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (const { name, year: targetYear } of orderedCandidates) {
    const lower = name.toLowerCase();
    const m = (state.movies || []).find((it) => {
      const t = (it.title || "").toLowerCase();
      const orig = (it.original_title || "").toLowerCase();
      return t === lower || orig === lower || t.startsWith(lower) || lower.startsWith(t);
    });
    if (m) {
      const key = `m-${m.uuid || m.id || m.title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push({ item: m, type: "movie", inLibrary: true });
      }
      continue;
    }
    const s = (state.shows || []).find((it) => {
      const t = (it.title || "").toLowerCase();
      const orig = (it.original_title || "").toLowerCase();
      return t === lower || orig === lower || t.startsWith(lower) || lower.startsWith(t);
    });
    if (s) {
      const key = `s-${s.uuid || s.id || s.title}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push({ item: s, type: "series", inLibrary: true });
      }
      continue;
    }
    try {
      let searchRes = await fetch(`/api/search_preview?q=${encodeURIComponent(name)}&type=movie`);
      let searchData = searchRes.ok ? await searchRes.json() : null;
      let rawList = searchData && searchData.results || [];
      let bestMatch = null;
      if (rawList.length > 0) {
        if (targetYear) {
          bestMatch = rawList.find((it) => it.year === targetYear || it.release_date && it.release_date.startsWith(targetYear));
          if (!bestMatch) {
            bestMatch = rawList.find((it) => it.year && Math.abs(parseInt(it.year) - parseInt(targetYear)) <= 1);
          }
        }
        if (!bestMatch) {
          const sorted = [...rawList].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
          bestMatch = sorted[0];
        }
      }
      if (!bestMatch) {
        searchRes = await fetch(`/api/search_preview?q=${encodeURIComponent(name)}&type=series`);
        searchData = searchRes.ok ? await searchRes.json() : null;
        rawList = searchData && searchData.results || [];
        if (rawList.length > 0) {
          if (targetYear) {
            bestMatch = rawList.find((it) => it.year === targetYear || it.release_date && it.release_date.startsWith(targetYear));
          }
          if (!bestMatch) {
            const sorted = [...rawList].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
            bestMatch = sorted[0];
          }
        }
      }
      if (bestMatch) {
        const isTv = bestMatch.type === "series" || bestMatch.media_type === "tv";
        const tmdbId = bestMatch.tmdb_id || bestMatch.id;
        const bestTitleLower = (bestMatch.title || "").toLowerCase();
        const bestOrigLower = (bestMatch.original_title || "").toLowerCase();
        let existingInLibrary = null;
        if (!isTv) {
          existingInLibrary = (state.movies || []).find((it) => {
            const itTitle = (it.title || "").toLowerCase();
            const itOrig = (it.original_title || "").toLowerCase();
            const itTmdb = it.tmdb_id || it.id;
            return tmdbId && itTmdb && String(itTmdb) === String(tmdbId) || itTitle && (itTitle === bestTitleLower || itTitle === bestOrigLower) || itOrig && (itOrig === bestOrigLower || itOrig === bestTitleLower);
          });
        } else {
          existingInLibrary = (state.shows || []).find((it) => {
            const itTitle = (it.title || "").toLowerCase();
            const itOrig = (it.original_title || "").toLowerCase();
            const itTmdb = it.tmdb_id || it.id;
            return tmdbId && itTmdb && String(itTmdb) === String(tmdbId) || itTitle && (itTitle === bestTitleLower || itTitle === bestOrigLower) || itOrig && (itOrig === bestOrigLower || itOrig === bestTitleLower);
          });
        }
        if (existingInLibrary) {
          const key = `${isTv ? "s" : "m"}-${existingInLibrary.uuid || existingInLibrary.id || existingInLibrary.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ item: existingInLibrary, type: isTv ? "series" : "movie", inLibrary: true });
          }
        } else {
          const itemObj = {
            id: tmdbId,
            tmdb_id: tmdbId,
            title: bestMatch.title || bestMatch.original_title || name,
            original_title: bestMatch.original_title || "",
            poster_url: bestMatch.poster_url || "",
            release_date: bestMatch.release_date || "",
            year: bestMatch.year || (bestMatch.release_date ? bestMatch.release_date.substring(0, 4) : targetYear),
            vote_average: bestMatch.vote_average ? Math.round(bestMatch.vote_average * 10) / 10 : null,
            overview: bestMatch.overview || "",
            media_type: isTv ? "tv" : "movie",
            type: isTv ? "series" : "movie"
          };
          const key = `tmdb-${itemObj.id || itemObj.title}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push({ item: itemObj, type: isTv ? "series" : "movie", inLibrary: false });
          }
        }
      }
    } catch (err) {
      console.warn("Could not fetch TMDb item for", name, err);
    }
  }
  return results;
}
function buildSeriesSystemPrompt(showTitle, currentProgress) {
  const langRule = getAiLanguagePrompt();
  return `Jeste\u015B ekspertem i asystentem serialowym w aplikacji CineLog. 
U\u017Cytkownik ogl\u0105da serial: "${showTitle}".
Bie\u017C\u0105cy post\u0119p u\u017Cytkownika to dok\u0142adnie: "${currentProgress || "Pocz\u0105tek serialu"}".

${langRule}

BEZWZGL\u0118DNY ZAKAZ SPOILER\xD3W:
- Odpowiadaj WY\u0141\u0104CZNIE opieraj\u0105c si\u0119 na wydarzeniach, kt\xF3re mia\u0142y miejsce DO ODCINKA ${currentProgress}.
- Pod \u017Cadnym pozorem nie wspominaj, nie sugeruj ani nie zdradzaj \u017Cadnych wydarze\u0144, zwrot\xF3w akcji ani los\xF3w bohater\xF3w z P\xD3\u0179NIEJSZYCH odcink\xF3w lub kolejnych sezon\xF3w!
- Odpowiadaj zwi\u0119\u017Ale, konkretnie, w 2-3 punktach, bez d\u0142ugich wst\u0119p\xF3w. Wyr\xF3\u017Cniaj tytu\u0142y i postacie w cudzys\u0142owach np. "Tytu\u0142".`;
}
function resolveMentionTags(userText = "") {
  if (!userText) return { cleanText: userText, injectedContext: "" };
  const injectedLines = [];
  const lowerText = userText.toLowerCase();
  if (/@(?:ulubione_filmy|fav_movies)\b/i.test(userText)) {
    const favs = (state.movies || []).filter((m2) => m2.is_favorite || m2.rating >= 4).map((m2) => `"${m2.title}" (${m2.rating ? m2.rating + "/5\u2605" : "Ulubiony"})`);
    injectedLines.push(`[Kontekst @ulubione_filmy (${favs.length})]: ${favs.join(", ") || "Brak"}`);
  }
  if (/@(?:planowane_filmy|do_obejrzenia_filmy|watchlist_movies)\b/i.test(userText)) {
    const wl = (state.movies || []).filter((m2) => m2.status === "watchlist").map((m2) => `"${m2.title}"`);
    injectedLines.push(`[Kontekst @planowane_filmy (${wl.length})]: ${wl.join(", ") || "Brak"}`);
  }
  if (/@(?:obejrzane_filmy|watched_movies)\b/i.test(userText)) {
    const wm = (state.movies || []).filter((m2) => m2.status === "watched").map((m2) => `"${m2.title}" (${m2.rating ? m2.rating + "\u2605" : "obejrzany"})`);
    injectedLines.push(`[Kontekst @obejrzane_filmy (${wm.length})]: ${wm.join(", ") || "Brak"}`);
  }
  if (/@(?:ulubione_seriale|fav_shows)\b/i.test(userText)) {
    const favs = (state.shows || []).filter((s) => s.is_favorite || s.rating >= 4).map((s) => `"${s.title}" (${s.rating ? s.rating + "/5\u2605" : "Ulubiony"})`);
    injectedLines.push(`[Kontekst @ulubione_seriale (${favs.length})]: ${favs.join(", ") || "Brak"}`);
  }
  if (/@(?:planowane_seriale|do_obejrzenia_seriale|watchlist_shows)\b/i.test(userText)) {
    const wl = (state.shows || []).filter((s) => s.status === "watchlist").map((s) => `"${s.title}"`);
    injectedLines.push(`[Kontekst @planowane_seriale (${wl.length})]: ${wl.join(", ") || "Brak"}`);
  }
  if (/@(?:obejrzane_seriale|watched_shows)\b/i.test(userText)) {
    const ws = (state.shows || []).filter((s) => s.status === "watched").map((s) => `"${s.title}" (${s.rating ? s.rating + "\u2605" : "obejrzany"})`);
    injectedLines.push(`[Kontekst @obejrzane_seriale (${ws.length})]: ${ws.join(", ") || "Brak"}`);
  }
  const itemMentionRegex = /@(?:"([^"]+)"|([a-zA-Z0-9_\u00C0-\u017E\-]+))/g;
  let m;
  const knownTags = ["ulubione_filmy", "planowane_filmy", "obejrzane_filmy", "ulubione_seriale", "planowane_seriale", "obejrzane_seriale", "do_obejrzenia", "wszystko", "film_serial"];
  while ((m = itemMentionRegex.exec(userText)) !== null) {
    const rawTag = (m[1] || m[2] || "").trim();
    if (!rawTag) continue;
    const normalized = rawTag.toLowerCase().replace(/_/g, " ");
    if (knownTags.includes(rawTag.toLowerCase())) continue;
    const foundMovie = (state.movies || []).find((it) => {
      const t = (it.title || "").toLowerCase();
      return t === normalized || t.startsWith(normalized) || normalized.startsWith(t);
    });
    if (foundMovie) {
      injectedLines.push(`[Wskazany przez u\u017Cytkownika film @${foundMovie.title}]: Rok: ${foundMovie.year || ""} | Status: ${foundMovie.status === "watched" ? "Obejrzany" : "Planowany (Watchlist)"} | Ocena: ${foundMovie.rating ? foundMovie.rating + "/5\u2605" : "Brak oceny"} | Gatunek: ${foundMovie.genre || "brak"} | Opis: ${foundMovie.plot || foundMovie.overview || ""}`);
      continue;
    }
    const foundShow = (state.shows || []).find((it) => {
      const t = (it.title || "").toLowerCase();
      return t === normalized || t.startsWith(normalized) || normalized.startsWith(t);
    });
    if (foundShow) {
      injectedLines.push(`[Wskazany przez u\u017Cytkownika serial @${foundShow.title}]: Rok: ${foundShow.year || ""} | Status: ${foundShow.status === "watched" ? "Uko\u0144czony" : "W trakcie / Planowany"} | Post\u0119p: ${foundShow.progress || foundShow.total_episodes || ""} | Ocena: ${foundShow.rating ? foundShow.rating + "/5\u2605" : "Brak oceny"} | Gatunek: ${foundShow.genre || "brak"} | Opis: ${foundShow.plot || foundShow.overview || ""}`);
    }
  }
  return {
    injectedContext: injectedLines.join("\n")
  };
}
function buildCuratorSystemPrompt(userQuery = "") {
  const q = (userQuery || "").toLowerCase();
  const isMovieOnly = /film|filmów|filmie|filmowy|filmy|seans|kino|90 minut|kinomaniak|@film|@filmy|@ulubione_filmy|@obejrzane_filmy|@planowane_filmy/.test(q) && !/serial|odcinek|sezon|tasiemiec|@serial|@seriale|@ulubione_seriale|@obejrzane_seriale|@planowane_seriale/.test(q);
  const isSeriesOnly = /serial|serialu|seriale|serialowy|odcink|sezon|binge|tasiemiec|odcinek|@serial|@seriale|@ulubione_seriale|@obejrzane_seriale|@planowane_seriale/.test(q) && !/film|filmów|filmie|filmowy|filmy|seans|kino|90 minut|@film|@filmy|@ulubione_filmy|@obejrzane_filmy|@planowane_filmy/.test(q);
  let libraryContext = "";
  if (isMovieOnly) {
    const favMovies = (state.movies || []).filter((m) => m.is_favorite || m.rating >= 4).slice(0, 30).map((m) => `"${m.title}" (${m.rating ? m.rating + "/5\u2605" : "Ulubiony"})`);
    const watchlistMovies = (state.movies || []).filter((m) => m.status === "watchlist").slice(0, 40).map((m) => `"${m.title}"`);
    const watchedMovies = (state.movies || []).filter((m) => m.status === "watched").map((m) => `"${m.title}"`);
    libraryContext = `
BIBLIOTEKA FILMOWA U\u017BYTKOWNIKA:
- Ulubione i wysoko ocenione filmy (${favMovies.length}): ${favMovies.join(", ") || "brak"}
- Filmy na li\u015Bcie "Do obejrzenia" (Watchlist) (${watchlistMovies.length}): ${watchlistMovies.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE JU\u017B FILMY (ZAKAZ PONOWNEGO POLECANIA, chyba \u017Ce u\u017Cytkownik o to poprosi): ${watchedMovies.join(", ") || "brak"}`;
  } else if (isSeriesOnly) {
    const favShows = (state.shows || []).filter((s) => s.is_favorite || s.rating >= 4).slice(0, 30).map((s) => `"${s.title}" (${s.rating ? s.rating + "/5\u2605" : "Ulubiony"})`);
    const watchlistShows = (state.shows || []).filter((s) => s.status === "watchlist").slice(0, 40).map((s) => `"${s.title}"`);
    const watchedShows = (state.shows || []).filter((s) => s.status === "watched").map((s) => `"${s.title}"`);
    libraryContext = `
BIBLIOTEKA SERIALOWA U\u017BYTKOWNIKA:
- Ulubione i wysoko ocenione seriale (${favShows.length}): ${favShows.join(", ") || "brak"}
- Seriale na li\u015Bcie "Do obejrzenia" (Watchlist) (${watchlistShows.length}): ${watchlistShows.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE JU\u017B SERIALE (ZAKAZ PONOWNEGO POLECANIA, chyba \u017Ce u\u017Cytkownik o to poprosi): ${watchedShows.join(", ") || "brak"}`;
  } else {
    const favMovies = (state.movies || []).filter((m) => m.is_favorite || m.rating >= 4).slice(0, 25).map((m) => `"${m.title}" (${m.rating ? m.rating + "/5\u2605" : "Ulubiony"})`);
    const favShows = (state.shows || []).filter((s) => s.is_favorite || s.rating >= 4).slice(0, 25).map((s) => `"${s.title}" (${s.rating ? s.rating + "/5\u2605" : "Ulubiony"})`);
    const watchlist = [
      ...(state.movies || []).filter((m) => m.status === "watchlist").slice(0, 30).map((m) => `Film: "${m.title}"`),
      ...(state.shows || []).filter((s) => s.status === "watchlist").slice(0, 30).map((s) => `Serial: "${s.title}"`)
    ];
    const watchedAll = [
      ...(state.movies || []).filter((m) => m.status === "watched").map((m) => `"${m.title}"`),
      ...(state.shows || []).filter((s) => s.status === "watched").map((s) => `"${s.title}"`)
    ];
    libraryContext = `
BIBLIOTEKA MULTIMEDIALNA U\u017BYTKOWNIKA:
- Najwy\u017Cej ocenione filmy: ${favMovies.join(", ") || "brak"}
- Ulubione i uko\u0144czone seriale: ${favShows.join(", ") || "brak"}
- Lista "Do obejrzenia" (Watchlist): ${watchlist.join(", ") || "brak"}
- WSZYSTKIE OBEJRZANE POZYCJE (ZAKAZ PONOWNEGO POLECANIA, chyba \u017Ce u\u017Cytkownik o to poprosi): ${watchedAll.join(", ") || "brak"}`;
  }
  const langRule = getAiLanguagePrompt();
  return `Jeste\u015B osobistym doradc\u0105 filmowym i serialowym w aplikacji CineLog. Prowadzisz p\u0142ynny, inteligentny dialog z u\u017Cytkownikiem, doskonale znaj\u0105c ca\u0142\u0105 jego bibliotek\u0119.

${langRule}

${libraryContext}

KLUCZOWE ZASADY:
1. BEZWZGL\u0118DNY ZAKAZ REKOMENDOWANIA OBEJRZANYCH TYTU\u0141\xD3W: U\u017Cytkownik widzia\u0142 ju\u017C wszystkie pozycje z sekcji "WSZYSTKIE OBEJRZANE". Pod \u017Cadnym pozorem nie polecaj mu tytu\u0142\xF3w z tej listy (chyba \u017Ce wprost pyta o opini\u0119 lub powt\xF3rk\u0119)!
2. Gdy proponujesz pozycj\u0119, kt\xF3ra znajduje si\u0119 na jego li\u015Bcie "Do obejrzenia" (Watchlist), koniecznie dodaj oznaczenie (\u{1F37F} Masz na li\u015Bcie Do Obejrzenia!).
3. Gdy polecasz tytu\u0142y, zaproponuj dok\u0142adnie 2-3 wybitne, trafione pozycje.
4. Format punkt\xF3w rekomendacji:
   1. "G\u0142\xF3wny Tytu\u0142" (Rok) \u2013 dlaczego warto + platforma VOD w Polsce.
   2. "G\u0142\xF3wny Tytu\u0142" (Rok) \u2013 dlaczego warto + platforma VOD w Polsce.
   3. "G\u0142\xF3wny Tytu\u0142" (Rok) \u2013 dlaczego warto + platforma VOD w Polsce.
5. BARDZO WA\u017BNE DOTYCZ\u0104CE CUDZYS\u0141OW\xD3W: W cudzys\u0142owach ("Tytu\u0142") umieszczaj WY\u0141\u0104CZNIE 2-3 g\u0142\xF3wne rekomendacje na pocz\u0105tku punkt\xF3w. Je\u015Bli por\xF3wnujesz film do innych produkcji w tre\u015Bci (np. w stylu Twin Peaks), NIE bierz ich w cudzys\u0142owy (napisz po prostu: klimat jak w Twin Peaks), aby aplikacja wygenerowa\u0142a kafelki wy\u0142\u0105cznie dla Twoich g\u0142\xF3wnych rekomendacji!
6. Pami\u0119taj poprzednie wiadomo\u015Bci w rozmowie, aby m\xF3c swobodnie kontynuowa\u0107 dialog.`;
}
function buildTasteDnaPrompt() {
  const topMovies = (state.movies || []).filter((m) => m.rating >= 4 || m.is_favorite).slice(0, 25).map((m) => `"${m.title}" (${m.rating ? m.rating + "/5\u2605" : "Ulubiony"})`);
  const topShows = (state.shows || []).filter((s) => s.rating >= 4 || s.is_favorite || s.status === "watched").slice(0, 25).map((s) => `"${s.title}" (${s.rating ? s.rating + "/5\u2605" : "Uko\u0144czony"})`);
  const langRule = getAiLanguagePrompt();
  const systemPrompt = `Jeste\u015B b\u0142yskotliwym analitykiem kina w aplikacji CineLog.
Na podstawie biblioteki u\u017Cytkownika stw\xF3rz zwi\u0119z\u0142y profil "DNA Twojego Gustu Filmowego".

${langRule}

BEZWZGL\u0118DNY ZAKAZ PISANIA PROCESU MY\u015ALOWEGO:
- Pod \u017Cadnym pozorem nie wypisuj w tre\u015Bci odpowiedzi etap\xF3w analitycznych (np. "1. Analyze the User's Request", "2. Analyze the Input Data", "3. Synthesize the Profile"). Odpowiedz OD RAZU konkretn\u0105 tre\u015Bci\u0105 dla u\u017Cytkownika!

ZASADY FORMATOWANIA (B\u0104D\u0179 ZWI\u0118Z\u0141Y I TRE\u015ACIWY):
1. **Tw\xF3j Archetyp Kinomana**: 1 chwytliwa nazwa (np. "Analityczny Koneser Mrocznego Napi\u0119cia") + 2 zdania uzasadnienia.
2. **Kluczowe Fascynacje**: 3 zwi\u0119z\u0142e punkty z podaniem konkretnych motyw\xF3w i przyk\u0142ad\xF3w tytu\u0142\xF3w w cudzys\u0142owach np. "Tytu\u0142".
3. **Ukryty Wzorzec**: 2 zdania o zaskakuj\u0105cych wsp\xF3lnych cechach Twoich ulubionych produkcji.
4. **Z\u0142ota Rekomendacja AI**: Dok\u0142adnie 1 wybitny film lub serial, kt\xF3rego prawdopodobnie nie widzia\u0142, z 2-zadaniowym trafnym uzasadnieniem i platform\u0105 VOD.`;
  const userMessage = `Moje najwy\u017Cej ocenione filmy:
${topMovies.join(", ") || "Brak"}

Moje ulubione i uko\u0144czone seriale:
${topShows.join(", ") || "Brak"}`;
  return { systemPrompt, userMessage };
}

// static/js/modules/importer.js
var parsedImportCandidates = [];
var detectedFormat = null;
var isImporting = false;
var shouldCancelImport = false;
function parseCSV(text) {
  if (text.charCodeAt(0) === 65279) {
    text = text.slice(1);
  }
  const lines = [];
  let row = [""];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"' || char === "'") {
      if (inQuotes && nextChar === char) {
        row[row.length - 1] += char;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === "," || char === ";") && !inQuotes) {
      row.push("");
    } else if ((char === "\r" || char === "\n") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      if (row.length > 1 || row[0].trim() !== "") {
        lines.push(row.map((c) => c.trim()));
      }
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }
  if (row.length > 1 || row[0] && row[0].trim() !== "") {
    lines.push(row.map((c) => c.trim()));
  }
  if (lines.length < 2) return [];
  const headers = lines[0].map((h) => h.toLowerCase().replace(/['"]/g, ""));
  const results = [];
  for (let i = 1; i < lines.length; i++) {
    const currentLine = lines[i];
    if (currentLine.length <= 1 && (!currentLine[0] || currentLine[0] === "")) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = currentLine[j] || "";
    }
    results.push(obj);
  }
  return results;
}
function detectAndNormalizeFile(filename, content) {
  const ext = filename.split(".").pop().toLowerCase();
  if (ext === "json") {
    try {
      const json = JSON.parse(content);
      let movies = json.movies || (Array.isArray(json) ? json : []);
      let shows = json.shows || [];
      const candidates2 = [];
      movies.forEach((m) => {
        candidates2.push({
          type: "movie",
          title: m.title,
          original_title: m.original_title || m.title,
          year: m.year || "",
          rating: m.rating || null,
          status: m.status || "watched",
          watch_date: m.watch_date || m.created_at || "",
          tmdb_id: m.tmdb_id || null,
          imdb_id: m.imdb_id || null,
          raw: m
        });
      });
      shows.forEach((s) => {
        candidates2.push({
          type: "series",
          title: s.title,
          original_title: s.original_title || s.title,
          year: s.year || "",
          rating: s.rating || null,
          status: s.status || "watching",
          watch_date: s.created_at || "",
          tmdb_id: s.tmdb_id || null,
          imdb_id: s.imdb_id || null,
          raw: s
        });
      });
      return { format: "CineLog JSON", candidates: candidates2 };
    } catch (e) {
      console.warn("Not valid CineLog JSON:", e);
    }
  }
  const rows = parseCSV(content);
  if (rows.length === 0) {
    throw new Error("Plik jest pusty lub nie uda\u0142o si\u0119 odczyta\u0107 wierszy CSV.");
  }
  const sample = rows[0];
  const keys = Object.keys(sample);
  if (keys.some((k) => k === "const") || keys.some((k) => k === "your rating") || keys.some((k) => k === "title type")) {
    const candidates2 = rows.map((r) => {
      const titleType = (r["title type"] || "").toLowerCase();
      const isSeries = titleType.includes("series") || titleType.includes("tv");
      const imdbId = r["const"] || "";
      const title = r["title"] || r["original title"] || "";
      const year = r["year"] || (r["release date"] ? r["release date"].split("-")[0] : "");
      let rating = parseInt(r["your rating"]);
      if (isNaN(rating) || rating <= 0) rating = null;
      const watchDate = r["date rated"] || "";
      return {
        type: isSeries ? "series" : "movie",
        title,
        original_title: title,
        year,
        rating,
        status: rating ? "watched" : "watchlist",
        watch_date: watchDate,
        imdb_id: imdbId.startsWith("tt") ? imdbId : null,
        tmdb_id: null
      };
    }).filter((c) => c.title);
    return { format: "IMDb CSV (ratings / watchlist)", candidates: candidates2 };
  }
  if (keys.some((k) => k === "letterboxd uri") || keys.some((k) => k === "name") && keys.some((k) => k === "year")) {
    const candidates2 = rows.map((r) => {
      const title = r["name"] || "";
      const year = r["year"] || "";
      let ratingRaw = parseFloat(r["rating"]);
      let rating = null;
      if (!isNaN(ratingRaw) && ratingRaw > 0) {
        rating = Math.round(ratingRaw * 2);
      }
      const watchDate = r["watched date"] || r["date"] || "";
      return {
        type: "movie",
        title,
        original_title: title,
        year,
        rating,
        status: "watched",
        watch_date: watchDate,
        imdb_id: null,
        tmdb_id: null
      };
    }).filter((c) => c.title);
    return { format: "Letterboxd CSV", candidates: candidates2 };
  }
  if (keys.some((k) => k.includes("tytu\u0142") || k.includes("tytul") || k.includes("ocena") || k.includes("filmweb"))) {
    const candidates2 = rows.map((r) => {
      const title = r["tytu\u0142"] || r["tytul"] || r["title"] || "";
      const originalTitle = r["oryginalny tytu\u0142"] || r["oryginalny tytul"] || r["original title"] || title;
      const year = r["rok"] || r["year"] || "";
      let rating = parseInt(r["ocena"] || r["rating"]);
      if (isNaN(rating) || rating <= 0) rating = null;
      const watchDate = r["data"] || r["data obejrzenia"] || r["date"] || "";
      const typ = (r["typ"] || r["type"] || "").toLowerCase();
      const isSeries = typ.includes("serial") || typ.includes("series") || typ.includes("tv");
      return {
        type: isSeries ? "series" : "movie",
        title: title || originalTitle,
        original_title: originalTitle || title,
        year,
        rating,
        status: rating ? "watched" : "watchlist",
        watch_date: watchDate,
        imdb_id: null,
        tmdb_id: null
      };
    }).filter((c) => c.title);
    return { format: "Filmweb CSV", candidates: candidates2 };
  }
  const candidates = rows.map((r) => {
    const title = r["title"] || r["name"] || r["tytu\u0142"] || r["tytul"] || Object.values(r)[0] || "";
    const year = r["year"] || r["rok"] || "";
    let rating = parseInt(r["rating"] || r["ocena"]);
    if (isNaN(rating) || rating <= 0) rating = null;
    return {
      type: "movie",
      title,
      original_title: title,
      year,
      rating,
      status: rating ? "watched" : "watchlist",
      watch_date: "",
      imdb_id: null,
      tmdb_id: null
    };
  }).filter((c) => c.title);
  return { format: "Og\xF3lny plik CSV", candidates };
}
function openImporterModal() {
  const modal = document.getElementById("m3-sheet-importer");
  if (!modal) return;
  resetImporterUI();
  modal.classList.add("active");
}
function closeImporterModal() {
  const modal = document.getElementById("m3-sheet-importer");
  if (modal) modal.classList.remove("active");
  if (isImporting) {
    shouldCancelImport = true;
  }
}
function resetImporterUI() {
  parsedImportCandidates = [];
  detectedFormat = null;
  isImporting = false;
  shouldCancelImport = false;
  const dropzone = document.getElementById("m3-import-dropzone");
  const previewBox = document.getElementById("m3-import-preview-box");
  const progressBox = document.getElementById("m3-import-progress-box");
  const btnStart = document.getElementById("m3-btn-start-import");
  const fileInput = document.getElementById("m3-importer-file-input");
  if (dropzone) dropzone.style.display = "flex";
  if (previewBox) previewBox.style.display = "none";
  if (progressBox) progressBox.style.display = "none";
  if (btnStart) {
    btnStart.style.display = "none";
    btnStart.disabled = false;
  }
  if (fileInput) fileInput.value = "";
}
function handleImportFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;
      try {
        const json = JSON.parse(content);
        const importedMovies = json.movies && Array.isArray(json.movies) ? json.movies : Array.isArray(json) ? json : [];
        const importedShows = json.shows && Array.isArray(json.shows) ? json.shows : [];
        if (importedMovies.length > 0 || importedShows.length > 0) {
          if (importedMovies.length > 0) state.movies = importedMovies;
          if (importedShows.length > 0) state.shows = importedShows;
          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();
          saveLocalDatabase();
          showToastNotification(`\u{1F389} Wczytano kopi\u0119 CineLog: ${importedMovies.length} film\xF3w i ${importedShows.length} seriali!`, "success");
          const sheetCloud = document.getElementById("m3-sheet-cloud-sync");
          if (sheetCloud) sheetCloud.classList.remove("active");
          closeImporterModal();
          return;
        }
      } catch (errJson) {
      }
      const { format, candidates } = detectAndNormalizeFile(file.name, content);
      if (candidates.length === 0) {
        showToastNotification("Nie znaleziono \u017Cadnych pozycji w pliku.", "error");
        return;
      }
      detectedFormat = format;
      parsedImportCandidates = candidates;
      openImporterModal();
      renderImportPreview();
    } catch (err) {
      console.error("Import file error:", err);
      showToastNotification(`B\u0142\u0105d odczytu pliku: ${err.message}`, "error");
    }
  };
  reader.readAsText(file);
}
function renderImportPreview() {
  const dropzone = document.getElementById("m3-import-dropzone");
  const previewBox = document.getElementById("m3-import-preview-box");
  const btnStart = document.getElementById("m3-btn-start-import");
  if (!previewBox) return;
  let newMovies = 0;
  let newShows = 0;
  let duplicates = 0;
  parsedImportCandidates.forEach((cand) => {
    const exists = isItemInLibrary({
      title: cand.title,
      type: cand.type,
      tmdb_id: cand.tmdb_id,
      imdb_id: cand.imdb_id,
      year: cand.year
    });
    if (exists) {
      duplicates++;
      cand._isDuplicate = true;
    } else {
      if (cand.type === "series") newShows++;
      else newMovies++;
      cand._isDuplicate = false;
    }
  });
  document.getElementById("m3-import-format-badge").innerText = detectedFormat;
  document.getElementById("m3-import-stat-total").innerText = parsedImportCandidates.length;
  document.getElementById("m3-import-stat-movies").innerText = newMovies;
  document.getElementById("m3-import-stat-shows").innerText = newShows;
  document.getElementById("m3-import-stat-duplicates").innerText = duplicates;
  const listEl = document.getElementById("m3-import-sample-list");
  if (listEl) {
    listEl.innerHTML = "";
    parsedImportCandidates.slice(0, 8).forEach((item) => {
      const row = document.createElement("div");
      row.className = "m3-import-sample-row";
      row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--md-sys-color-surface-container); border-radius: 8px; font-size: 0.78rem; gap: 8px;";
      const starHtml = item.rating ? `<span style="color: var(--md-sys-color-primary); font-weight: 700;">\u2605 ${item.rating}/10</span>` : `<span style="color: var(--md-sys-color-outline-variant);">Brak oceny</span>`;
      const dupBadge = item._isDuplicate ? `<span style="font-size: 0.65rem; background: var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface); padding: 1px 6px; border-radius: 999px;">Duplikat (pomi\u0144)</span>` : `<span style="font-size: 0.65rem; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-primary); padding: 1px 6px; border-radius: 999px; font-weight: 700;">NOWY</span>`;
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
          <span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-sys-color-primary);">${item.type === "series" ? "tv" : "movie"}</span>
          <span style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.title}</span>
          ${item.year ? `<span style="color: var(--md-sys-color-outline); font-size: 0.72rem;">(${item.year})</span>` : ""}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
          ${starHtml}
          ${dupBadge}
        </div>
      `;
      listEl.appendChild(row);
    });
    if (parsedImportCandidates.length > 8) {
      const more = document.createElement("div");
      more.style.cssText = "text-align: center; font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant); padding-top: 4px;";
      more.innerText = `...i ${parsedImportCandidates.length - 8} kolejnych pozycji`;
      listEl.appendChild(more);
    }
  }
  if (dropzone) dropzone.style.display = "none";
  previewBox.style.display = "flex";
  if (btnStart) {
    const countToImport = parsedImportCandidates.filter((c) => !c._isDuplicate).length;
    btnStart.innerText = `Rozpocznij import (${countToImport} pozycji)`;
    btnStart.style.display = "flex";
  }
}
async function executeBatchImport() {
  if (isImporting || parsedImportCandidates.length === 0) return;
  isImporting = true;
  shouldCancelImport = false;
  const previewBox = document.getElementById("m3-import-preview-box");
  const progressBox = document.getElementById("m3-import-progress-box");
  const btnStart = document.getElementById("m3-btn-start-import");
  const progressBar = document.getElementById("m3-import-progress-bar-fill");
  const progressText = document.getElementById("m3-import-progress-text");
  const currentTitleText = document.getElementById("m3-import-current-title");
  if (previewBox) previewBox.style.display = "none";
  if (progressBox) progressBox.style.display = "flex";
  if (btnStart) btnStart.disabled = true;
  const itemsToProcess = parsedImportCandidates.filter((c) => !c._isDuplicate);
  const total = itemsToProcess.length;
  let processed = 0;
  let successCount = 0;
  const userLang = getUserLanguage();
  for (const item of itemsToProcess) {
    if (shouldCancelImport) break;
    processed++;
    if (progressText) progressText.innerText = `Przetwarzanie: ${processed} z ${total} (${Math.round(processed / total * 100)}%)`;
    if (currentTitleText) currentTitleText.innerText = `Pobieram: \u201E${item.title}\u201D...`;
    if (progressBar) progressBar.style.width = `${processed / total * 100}%`;
    try {
      const params = new URLSearchParams({
        title: item.title,
        year: item.year || "",
        type: item.type === "series" ? "series" : "movie",
        lang: userLang
      });
      if (item.imdb_id) params.append("id", item.imdb_id);
      if (item.tmdb_id) params.append("tmdb_id", item.tmdb_id);
      let detail = null;
      try {
        const res = await fetch(`/api/search_detail?${params.toString()}`);
        if (res.ok) detail = await res.json();
      } catch (e) {
        console.warn("Failed detail fetch for", item.title, e);
      }
      const finalTitle = detail && detail.title || item.title;
      const finalYear = detail && detail.year || item.year || "";
      const finalGenre = detail && detail.genre || (item.type === "series" ? "Serial" : "Film");
      const finalPoster = detail && detail.poster_url || "";
      const finalTmdbId = detail && detail.tmdb_id || item.tmdb_id || null;
      const finalImdbId = detail && detail.imdb_id || item.imdb_id || null;
      const finalOverview = detail && detail.plot || "";
      const finalRuntime = detail && detail.runtime || 0;
      const finalCast = detail && detail.cast || [];
      const finalDirector = detail && detail.director || "";
      if (item.type === "series") {
        const newShow = {
          uuid: generateUUID(),
          title: finalTitle,
          original_title: item.original_title || finalTitle,
          year: finalYear,
          genre: finalGenre,
          poster_url: finalPoster,
          rating: item.rating || null,
          status: item.status || "watching",
          created_at: item.watch_date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          updated_at: (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          tmdb_id: finalTmdbId,
          imdb_id: finalImdbId,
          plot: finalOverview,
          cast: finalCast,
          total_seasons: detail && detail.total_seasons || 1,
          season_ep_counts: detail && detail.season_ep_counts || {},
          episodes_watched: []
        };
        state.shows.unshift(newShow);
      } else {
        const newMovie = {
          uuid: generateUUID(),
          title: finalTitle,
          original_title: item.original_title || finalTitle,
          year: finalYear,
          genre: finalGenre,
          poster_url: finalPoster,
          rating: item.rating || null,
          status: item.status || "watched",
          watch_date: item.watch_date || (item.status === "watched" ? (/* @__PURE__ */ new Date()).toISOString().split("T")[0] : ""),
          created_at: item.watch_date || (/* @__PURE__ */ new Date()).toISOString().split("T")[0],
          tmdb_id: finalTmdbId,
          imdb_id: finalImdbId,
          plot: finalOverview,
          runtime: finalRuntime,
          cast: finalCast,
          director: finalDirector
        };
        state.movies.unshift(newMovie);
      }
      successCount++;
    } catch (err) {
      console.error("Error importing item:", item.title, err);
    }
  }
  saveLocalDatabase();
  updateStats();
  if (state.mode === "movies") renderMovies();
  else renderShows();
  if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    window.googleDriveSync.uploadToDrive(state.movies, state.shows);
  }
  showToastNotification(`\u{1F389} Sukces! Pomy\u015Blnie zaimportowano ${successCount} pozycji do Twojej biblioteki.`, "success");
  closeImporterModal();
}
function initImporterHandlers() {
  const btnOpenImporter = document.getElementById("m3-btn-open-importer");
  const btnOpenImporterCloud = document.getElementById("m3-btn-open-importer-cloud");
  const btnClose = document.getElementById("m3-importer-close");
  const dropzone = document.getElementById("m3-import-dropzone");
  const fileInput = document.getElementById("m3-importer-file-input");
  const btnSelectFile = document.getElementById("m3-btn-select-import-file");
  const btnStart = document.getElementById("m3-btn-start-import");
  const btnReset = document.getElementById("m3-btn-reset-import");
  if (btnOpenImporter) {
    btnOpenImporter.addEventListener("click", openImporterModal);
  }
  if (btnOpenImporterCloud) {
    btnOpenImporterCloud.addEventListener("click", openImporterModal);
  }
  if (btnClose) {
    btnClose.addEventListener("click", closeImporterModal);
  }
  if (btnSelectFile && fileInput) {
    btnSelectFile.addEventListener("click", () => fileInput.click());
  }
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) handleImportFile(file);
    });
  }
  if (dropzone) {
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--md-sys-color-primary)";
      dropzone.style.background = "var(--md-sys-color-primary-container)";
    });
    dropzone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--md-sys-color-outline-variant)";
      dropzone.style.background = "var(--md-sys-color-surface-container)";
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--md-sys-color-outline-variant)";
      dropzone.style.background = "var(--md-sys-color-surface-container)";
      const file = e.dataTransfer.files[0];
      if (file) handleImportFile(file);
    });
  }
  if (btnStart) {
    btnStart.addEventListener("click", executeBatchImport);
  }
  if (btnReset) {
    btnReset.addEventListener("click", resetImporterUI);
  }
}

// static/js/modules/cloud.js
function updateDriveModalUI() {
  const boxDisconnected = document.getElementById("m3-drive-disconnected-box");
  const boxConnected = document.getElementById("m3-drive-connected-box");
  const inputClientId = document.getElementById("m3-gdrive-client-id");
  if (!boxDisconnected || !boxConnected) return;
  if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    boxDisconnected.style.display = "none";
    boxConnected.style.display = "flex";
  } else {
    boxDisconnected.style.display = "flex";
    boxConnected.style.display = "none";
    if (inputClientId) inputClientId.value = localStorage.getItem("gdrive_client_id") || "";
  }
}
function updateAiSettingsUI() {
  const cfg = getAiConfig();
  const provider = cfg.provider || "openai";
  const apiKeyInput = document.getElementById("m3-ai-api-key");
  const modelInput = document.getElementById("m3-ai-model");
  const baseUrlInput = document.getElementById("m3-ai-base-url");
  const statusBox = document.getElementById("m3-ai-test-status");
  if (apiKeyInput) apiKeyInput.value = cfg.apiKey || "";
  if (modelInput) modelInput.value = cfg.model || (AI_PRESETS[provider] ? AI_PRESETS[provider].defaultModel : "gpt-4o-mini");
  if (baseUrlInput) baseUrlInput.value = cfg.baseUrl || (AI_PRESETS[provider] ? AI_PRESETS[provider].baseUrl : "https://api.openai.com/v1");
  if (statusBox) statusBox.style.display = "none";
  const providerChips = document.querySelectorAll("#m3-ai-provider-chips [data-provider]");
  providerChips.forEach((chip) => {
    if (chip.getAttribute("data-provider") === provider) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });
  const preset = AI_PRESETS[provider] || AI_PRESETS.openai;
  if (apiKeyInput) apiKeyInput.placeholder = preset.placeholder;
}
function openCloudSyncModal(initialTab = "drive") {
  updateDriveModalUI();
  updateAiSettingsUI();
  const tabDrive = document.getElementById("m3-tab-cloud-drive");
  const tabAi = document.getElementById("m3-tab-cloud-ai");
  const panelDrive = document.getElementById("m3-panel-cloud-drive");
  const panelAi = document.getElementById("m3-panel-cloud-ai");
  if (initialTab === "ai") {
    if (tabDrive) tabDrive.classList.remove("active");
    if (tabAi) tabAi.classList.add("active");
    if (panelDrive) panelDrive.style.display = "none";
    if (panelAi) panelAi.style.display = "flex";
  } else {
    if (tabDrive) tabDrive.classList.add("active");
    if (tabAi) tabAi.classList.remove("active");
    if (panelDrive) panelDrive.style.display = "flex";
    if (panelAi) panelAi.style.display = "none";
  }
  const sheet = document.getElementById("m3-sheet-cloud-sync");
  if (sheet) sheet.classList.add("active");
}
function initCloudSyncHandlers() {
  const sheetCloudSync = document.getElementById("m3-sheet-cloud-sync");
  const inputClientId = document.getElementById("m3-gdrive-client-id");
  const btnOpenCloudSync = document.getElementById("m3-btn-open-cloud-sync");
  const btnMobileCloudSync = document.getElementById("m3-mobile-cloud-sync");
  const btnCloseCloudSync = document.getElementById("m3-cloud-sync-close");
  const btnRecAiSettings = document.getElementById("m3-rec-btn-open-ai-settings");
  if (btnOpenCloudSync) btnOpenCloudSync.addEventListener("click", () => openCloudSyncModal("drive"));
  if (btnMobileCloudSync) btnMobileCloudSync.addEventListener("click", () => openCloudSyncModal("drive"));
  if (btnRecAiSettings) btnRecAiSettings.addEventListener("click", () => openCloudSyncModal("ai"));
  if (btnCloseCloudSync && sheetCloudSync) {
    btnCloseCloudSync.addEventListener("click", () => {
      sheetCloudSync.classList.remove("active");
    });
  }
  const tabDrive = document.getElementById("m3-tab-cloud-drive");
  const tabAi = document.getElementById("m3-tab-cloud-ai");
  const panelDrive = document.getElementById("m3-panel-cloud-drive");
  const panelAi = document.getElementById("m3-panel-cloud-ai");
  if (tabDrive && tabAi) {
    tabDrive.addEventListener("click", () => {
      tabDrive.classList.add("active");
      tabAi.classList.remove("active");
      if (panelDrive) panelDrive.style.display = "flex";
      if (panelAi) panelAi.style.display = "none";
    });
    tabAi.addEventListener("click", () => {
      tabAi.classList.add("active");
      tabDrive.classList.remove("active");
      if (panelDrive) panelDrive.style.display = "none";
      if (panelAi) panelAi.style.display = "flex";
      updateAiSettingsUI();
    });
  }
  const providerChips = document.querySelectorAll("#m3-ai-provider-chips [data-provider]");
  providerChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      providerChips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const pKey = chip.getAttribute("data-provider");
      const preset = AI_PRESETS[pKey] || AI_PRESETS.openai;
      const modelInput = document.getElementById("m3-ai-model");
      const baseUrlInput = document.getElementById("m3-ai-base-url");
      const apiKeyInput2 = document.getElementById("m3-ai-api-key");
      if (modelInput) modelInput.value = preset.defaultModel;
      if (baseUrlInput) baseUrlInput.value = preset.baseUrl;
      if (apiKeyInput2) apiKeyInput2.placeholder = preset.placeholder;
    });
  });
  const toggleKeyBtn = document.getElementById("m3-ai-toggle-key-vis");
  const apiKeyInput = document.getElementById("m3-ai-api-key");
  if (toggleKeyBtn && apiKeyInput) {
    toggleKeyBtn.addEventListener("click", () => {
      const isMasked = apiKeyInput.style.webkitTextSecurity === "disc" || !apiKeyInput.style.webkitTextSecurity;
      if (isMasked) {
        apiKeyInput.style.webkitTextSecurity = "none";
        toggleKeyBtn.innerText = "visibility_off";
      } else {
        apiKeyInput.style.webkitTextSecurity = "disc";
        toggleKeyBtn.innerText = "visibility";
      }
    });
  }
  const btnAiTest = document.getElementById("m3-btn-ai-test");
  const statusBox = document.getElementById("m3-ai-test-status");
  if (btnAiTest) {
    btnAiTest.addEventListener("click", async () => {
      const activeChip = document.querySelector("#m3-ai-provider-chips [data-provider].active");
      const provider = activeChip ? activeChip.getAttribute("data-provider") : "openai";
      const keyVal = apiKeyInput ? apiKeyInput.value.trim() : "";
      const modelVal = document.getElementById("m3-ai-model") ? document.getElementById("m3-ai-model").value.trim() : "gpt-4o-mini";
      const baseUrlVal = document.getElementById("m3-ai-base-url") ? document.getElementById("m3-ai-base-url").value.trim() : "https://api.openai.com/v1";
      if (statusBox) {
        statusBox.style.display = "block";
        statusBox.style.background = "var(--md-sys-color-surface-container-high)";
        statusBox.style.color = "var(--md-sys-color-primary)";
        statusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
        statusBox.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; vertical-align: middle; font-size: 16px;">sync</span> Testuj\u0119 po\u0142\u0105czenie z modelem <strong>${modelVal}</strong>...`;
      }
      const res = await testAiConnection({
        provider,
        apiKey: keyVal,
        baseUrl: baseUrlVal,
        model: modelVal
      });
      if (statusBox) {
        if (res.success) {
          statusBox.style.background = "rgba(16, 185, 129, 0.12)";
          statusBox.style.color = "#10b981";
          statusBox.style.border = "1px solid rgba(16, 185, 129, 0.35)";
          statusBox.innerHTML = `\u{1F7E2} <strong>Po\u0142\u0105czono pomy\u015Blnie!</strong> Model <em>${res.model}</em> odpowiedzia\u0142 w ${res.elapsed}ms.`;
        } else {
          statusBox.style.background = "rgba(239, 68, 68, 0.12)";
          statusBox.style.color = "#ef4444";
          statusBox.style.border = "1px solid rgba(239, 68, 68, 0.35)";
          statusBox.innerHTML = `\u{1F534} <strong>B\u0142\u0105d po\u0142\u0105czenia:</strong> ${res.error}`;
        }
      }
    });
  }
  const btnAiSave = document.getElementById("m3-btn-ai-save");
  if (btnAiSave) {
    btnAiSave.addEventListener("click", () => {
      const activeChip = document.querySelector("#m3-ai-provider-chips [data-provider].active");
      const provider = activeChip ? activeChip.getAttribute("data-provider") : "openai";
      const keyVal = apiKeyInput ? apiKeyInput.value.trim() : "";
      const modelVal = document.getElementById("m3-ai-model") ? document.getElementById("m3-ai-model").value.trim() : "gpt-4o-mini";
      const baseUrlVal = document.getElementById("m3-ai-base-url") ? document.getElementById("m3-ai-base-url").value.trim() : "https://api.openai.com/v1";
      saveAiConfig({
        provider,
        apiKey: keyVal,
        baseUrl: baseUrlVal,
        model: modelVal,
        enabled: true
      });
      showToastNotification("Zapisano ustawienia asystenta AI!", "success");
      if (sheetCloudSync) sheetCloudSync.classList.remove("active");
    });
  }
  const btnAiClear = document.getElementById("m3-btn-ai-clear");
  if (btnAiClear) {
    btnAiClear.addEventListener("click", () => {
      if (!confirm("Czy na pewno chcesz usun\u0105\u0107 klucz API i zresetowa\u0107 ustawienia AI?")) return;
      localStorage.removeItem("cinelog_ai_config");
      updateAiSettingsUI();
      showToastNotification("Usuni\u0119to klucz i zresetowano konfiguracj\u0119 AI.", "info");
    });
  }
  const btnConnect = document.getElementById("m3-btn-gdrive-connect");
  if (btnConnect) {
    btnConnect.addEventListener("click", () => {
      const inputId = inputClientId ? inputClientId.value.trim() : "";
      const configId = window.CINELOG_CONFIG && window.CINELOG_CONFIG.GOOGLE_CLIENT_ID ? window.CINELOG_CONFIG.GOOGLE_CLIENT_ID.trim() : "";
      const savedId = localStorage.getItem("gdrive_client_id") || "";
      const clientId = inputId || configId || savedId;
      if (!clientId) {
        showToastNotification("Wymagany Google OAuth Client ID. Wklej go w sekcji 'Zaawansowane' lub w pliku config.js.", "warning");
        return;
      }
      if (window.googleDriveSync) {
        window.googleDriveSync.connect(clientId, (movies, shows) => {
          if (movies && movies.length > 0) state.movies = movies;
          if (shows && shows.length > 0) state.shows = shows;
          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();
          updateDriveModalUI();
        });
      }
    });
  }
  const btnDisconnect = document.getElementById("m3-btn-gdrive-disconnect");
  if (btnDisconnect) {
    btnDisconnect.addEventListener("click", () => {
      if (window.googleDriveSync) {
        window.googleDriveSync.disconnect();
        updateDriveModalUI();
      }
    });
  }
  const btnPull = document.getElementById("m3-btn-gdrive-pull");
  if (btnPull) {
    btnPull.addEventListener("click", async () => {
      if (window.googleDriveSync) {
        const data = await window.googleDriveSync.downloadFromDrive();
        if (data) {
          if (data.movies) state.movies = data.movies;
          if (data.shows) state.shows = data.shows;
          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();
          showToastNotification(`Wczytano z Dysku Google: ${state.movies.length} film\xF3w, ${state.shows.length} seriali.`, "success");
        }
      }
    });
  }
  const btnPush = document.getElementById("m3-btn-gdrive-push");
  if (btnPush) {
    btnPush.addEventListener("click", async () => {
      if (window.googleDriveSync) {
        const ok = await window.googleDriveSync.uploadToDrive(state.movies, state.shows);
        if (ok) showToastNotification(`Przes\u0142ano bibliotek\u0119 (${state.movies.length} film\xF3w, ${state.shows.length} seriali) na Dysk Google!`, "success");
      }
    });
  }
  const btnMerge = document.getElementById("m3-btn-gdrive-merge");
  if (btnMerge) {
    btnMerge.addEventListener("click", async () => {
      if (window.googleDriveSync) {
        const cloudData = await window.googleDriveSync.downloadFromDrive();
        if (cloudData) {
          const merged = window.googleDriveSync.mergeLibraries(state.movies, state.shows, cloudData.movies, cloudData.shows);
          state.movies = merged.movies;
          state.shows = merged.shows;
          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();
          await window.googleDriveSync.uploadToDrive(state.movies, state.shows);
          showToastNotification(`Pomy\u015Blnie scalono baz\u0119! Stan: ${state.movies.length} film\xF3w, ${state.shows.length} seriali.`, "success");
        } else {
          await window.googleDriveSync.uploadToDrive(state.movies, state.shows);
          showToastNotification("Utworzono now\u0105 baz\u0119 na Dysku Google z Twojej aktualnej biblioteki.", "success");
        }
      }
    });
  }
  const fileInput = document.getElementById("m3-import-json-file");
  const btnImportTrigger = document.getElementById("m3-btn-import-json");
  if (btnImportTrigger && fileInput) {
    btnImportTrigger.addEventListener("click", () => {
      fileInput.click();
    });
    fileInput.addEventListener("change", (evt) => {
      const file = evt.target.files[0];
      if (!file) return;
      handleImportFile(file);
      fileInput.value = "";
    });
  }
}

// static/js/modules/shows.js
var selectedShow = null;
var selectedSeason = 1;
var currentShowMeta = {};
async function renderShows() {
  const grid = document.getElementById("m3-shows-grid");
  if (!grid) return;
  const searchInput = document.getElementById("m3-search-input");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";
  let filtered = (state.shows || []).filter((s) => {
    if (!s) return false;
    if ((state.activeShowTab === "watching_shows" || state.activeShowTab === "watching") && s.status !== "watching") return false;
    if ((state.activeShowTab === "watchlist_shows" || state.activeShowTab === "watchlist") && s.status !== "watchlist") return false;
    if ((state.activeShowTab === "watched_shows" || state.activeShowTab === "watched") && s.status !== "watched") return false;
    if ((state.activeShowTab === "favorites_shows" || state.activeShowTab === "favorites") && !s.is_favorite) return false;
    if (state.activeVodFilter === "fav" && !s.is_favorite) return false;
    if ((state.activeShowTab === "top_rated_shows" || state.activeShowTab === "top_rated") && (s.rating === null || s.rating < 4)) return false;
    if (searchQuery) {
      return s.title && s.title.toLowerCase().includes(searchQuery);
    }
    return true;
  });
  if (state.activeVodFilter !== "all" && state.activeVodFilter !== "fav") {
    await ensureVodDataForVisible(filtered, "tv");
    filtered = filtered.filter((s) => matchVodFilter(s.title, "tv"));
  }
  filtered = sortItems(filtered, state.sortMode, "series");
  const countEl = document.getElementById("m3-visible-count");
  if (countEl) countEl.innerText = filtered.length;
  grid.innerHTML = "";
  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 12px;">search_off</span>
        <p>Brak seriali spe\u0142niaj\u0105cych wybrane kryteria i filtr VOD.</p>
      </div>
    `;
    return;
  }
  filtered.forEach((s) => {
    const card = document.createElement("article");
    card.className = "m3-card";
    let coverHtml = "";
    if (s.poster_url) {
      coverHtml = `
        <img src="${s.poster_url}" alt="${s.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(s.title)}; display: none;">${s.title}</div>
      `;
    } else {
      coverHtml = `<div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(s.title)}">${s.title}</div>`;
    }
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
      const active = s.rating && i <= s.rating ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}">star</span>`;
    }
    const isFav = Boolean(s.is_favorite);
    const favActiveClass = isFav ? "is-fav active" : "";
    const favIconStyle = isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : "";
    const epCount = s.episodes_watched ? s.episodes_watched.length : s.watched_count || 0;
    let statusText = "Do obejrzenia";
    let statusColor = "var(--md-sys-color-on-surface-variant)";
    if (s.status === "watched") {
      statusText = "Uko\u0144czony";
      statusColor = "#10b981";
    } else if (s.status === "watching") {
      statusText = s.caught_up ? "Na bie\u017C\u0105co" : "W trakcie";
      statusColor = s.caught_up ? "#38bdf8" : "var(--md-sys-color-primary)";
    }
    card.innerHTML = `
      <div class="m3-card-cover">
        ${coverHtml}
        <button class="m3-card-fav-btn ${favActiveClass}" data-uuid="${s.uuid}" title="${isFav ? "Usu\u0144 z ulubionych" : "Dodaj do ulubionych"}">
          <span class="material-symbols-rounded" style="${favIconStyle}">favorite</span>
        </button>
      </div>
      <div class="m3-card-body">
        <div class="m3-card-title">${s.title}</div>
        <div class="m3-card-meta">
          <span>${s.release_date ? s.release_date.split("-")[0] : s.release_year || ""}</span>
          <span>\u2022</span>
          <span style="font-weight: 700; color: ${statusColor};">${statusText}</span>
          <span>\u2022</span>
          <span>${epCount} odc.</span>
        </div>
        <div class="m3-stars" data-uuid="${s.uuid}">
          ${starsHtml}
        </div>
      </div>
    `;
    card.addEventListener("click", () => {
      openEpisodeTracker(s);
    });
    const favBtn = card.querySelector(".m3-card-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleShowFavorite(s.uuid, isFav);
    });
    const starSpans = card.querySelectorAll(".m3-star");
    starSpans.forEach((star) => {
      star.addEventListener("click", async (e) => {
        e.stopPropagation();
        const val = parseInt(star.getAttribute("data-val"), 10);
        const nextVal = s.rating === val ? null : val;
        try {
          const res = await fetch(`/api/shows/${s.uuid}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating: nextVal })
          });
          if (res.ok) {
            s.rating = nextVal;
            renderShows();
            updateStats();
            saveLocalDatabase();
          }
        } catch (err) {
        }
      });
    });
    grid.appendChild(card);
  });
}
async function openEpisodeTracker(show) {
  selectedShow = show;
  selectedSeason = Math.max(show.latest_season || 1, 1);
  currentShowMeta = {};
  document.getElementById("m3-ep-show-title").innerText = show.title;
  const progressText = show.latest_progress ? `Post\u0119p: ${show.latest_progress} (${show.watched_count || 0} odcink\xF3w)` : "Brak obejrzanych odcink\xF3w";
  document.getElementById("m3-ep-show-meta").innerText = progressText;
  const detailImg = document.getElementById("m3-show-detail-img");
  const detailMeta = document.getElementById("m3-show-detail-meta");
  const detailPlot = document.getElementById("m3-show-detail-plot");
  const detailStars = document.getElementById("m3-show-detail-stars");
  if (detailImg) {
    const posterBox = detailImg.parentElement;
    if (posterBox) {
      const oldFb = posterBox.querySelector(".m3-poster-fallback");
      if (oldFb) oldFb.remove();
    }
    if (show.poster_url) {
      detailImg.src = show.poster_url;
      detailImg.style.display = "block";
      detailImg.onerror = () => {
        detailImg.style.display = "none";
        if (posterBox && !posterBox.querySelector(".m3-poster-fallback")) {
          const fb = document.createElement("div");
          fb.className = "m3-poster-fallback";
          fb.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(show.title)}; color: #fff; font-weight: 700; font-size: 0.8rem; text-align: center; border-radius: 10px; padding: 6px;`;
          fb.innerText = show.title;
          posterBox.appendChild(fb);
        }
      };
    } else {
      detailImg.style.display = "none";
      if (posterBox && !posterBox.querySelector(".m3-poster-fallback")) {
        const fb = document.createElement("div");
        fb.className = "m3-poster-fallback";
        fb.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(show.title)}; color: #fff; font-weight: 700; font-size: 0.8rem; text-align: center; border-radius: 10px; padding: 6px;`;
        fb.innerText = show.title;
        posterBox.appendChild(fb);
      }
    }
  }
  if (detailMeta) {
    const y = show.release_date ? show.release_date.split("-")[0] : show.release_year || "";
    detailMeta.innerText = y ? `${y} \u2022 Serial` : "Serial telewizyjny";
  }
  if (detailPlot) {
    detailPlot.innerText = show.plot || "Wczytywanie szczeg\xF3\u0142\xF3w serialu z TMDb...";
  }
  if (detailStars) {
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
      const active = show.rating && i <= show.rating ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}" style="cursor: pointer; font-size: 18px;">star</span>`;
    }
    detailStars.innerHTML = starsHtml;
    detailStars.querySelectorAll(".m3-star").forEach((star) => {
      star.addEventListener("click", async (e) => {
        e.stopPropagation();
        const val = parseInt(star.getAttribute("data-val"), 10);
        const nextVal = show.rating === val ? null : val;
        try {
          const res = await fetch(`/api/shows/${show.uuid}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rating: nextVal })
          });
          if (res.ok) {
            show.rating = nextVal;
            renderShows();
            updateStats();
            openEpisodeTracker(show);
          }
        } catch (err) {
        }
      });
    });
  }
  const showBadgesRow = document.getElementById("m3-ep-show-badges-row");
  if (showBadgesRow) {
    showBadgesRow.innerHTML = "";
    if (show.status === "watched") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(16, 185, 129, 0.18); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4);"><span class="material-symbols-rounded" style="font-size: 13px;">task_alt</span> Uko\u0144czony (${show.watched_count || 0} odc.)</span>`;
    } else if (show.caught_up) {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> Na bie\u017C\u0105co (${show.watched_count || 0} odc.)</span>`;
    } else if (show.watched_count) {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge highlight"><span class="material-symbols-rounded" style="font-size: 13px;">play_circle</span> W trakcie (${show.watched_count} odc.)</span>`;
    } else {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">bookmark</span> Do obejrzenia</span>`;
    }
    if (show.series_status === "Ended" || show.series_status === "Canceled") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">flag</span> Zako\u0144czony serial</span>`;
    } else if (show.in_production || show.series_status === "Returning Series") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">autorenew</span> W produkcji</span>`;
    }
  }
  const favShowBtn = document.getElementById("m3-btn-fav-show");
  if (favShowBtn) {
    const updateShowFavUI = () => {
      const isFav = Boolean(show.is_favorite);
      favShowBtn.className = `m3-card-fav-btn ${isFav ? "is-fav active" : ""}`;
      favShowBtn.innerHTML = `<span class="material-symbols-rounded" style="${isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : ""}">favorite</span>`;
      favShowBtn.title = isFav ? "Usu\u0144 z ulubionych" : "Dodaj do ulubionych";
    };
    updateShowFavUI();
    favShowBtn.onclick = () => {
      toggleShowFavorite(show.uuid, Boolean(show.is_favorite));
      show.is_favorite = !show.is_favorite;
      updateShowFavUI();
    };
  }
  const aiAssistantBtn = document.getElementById("m3-btn-ai-show-assistant");
  if (aiAssistantBtn) {
    aiAssistantBtn.onclick = () => {
      openSeriesAiModal(show);
    };
  }
  const rematchShowBtn = document.getElementById("m3-btn-rematch-show");
  if (rematchShowBtn) {
    rematchShowBtn.onclick = () => {
      openShowRematchPicker(show);
    };
  }
  const deleteShowBtn = document.getElementById("m3-btn-delete-show");
  if (deleteShowBtn) {
    deleteShowBtn.onclick = async () => {
      if (!confirm(`Czy na pewno chcesz usun\u0105\u0107 serial "${show.title}" wraz z ca\u0142\u0105 histori\u0105 ogl\u0105dania z biblioteki?`)) return;
      await deleteShow(show.uuid);
    };
  }
  const vodLogosContainer = document.getElementById("m3-show-vod-logos");
  vodLogosContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant);">Szukam VOD...</span>`;
  renderSeasonTabs();
  renderSeasonEpisodes(true);
  document.getElementById("m3-sheet-episodes").classList.add("active");
  getWatchProvidersForTitle(show.title, "tv").then((data) => {
    vodLogosContainer.innerHTML = "";
    const flat = data.flatrate || [];
    const free = data.free || [];
    const rent = [...data.rent || [], ...data.buy || []];
    const uniqueRents = [];
    const seen = /* @__PURE__ */ new Set();
    rent.forEach((r) => {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        uniqueRents.push(r);
      }
    });
    const streaming = [...flat, ...free];
    const displayList = streaming.length > 0 ? streaming : uniqueRents;
    if (displayList.length > 0) {
      displayList.forEach((p) => {
        const item = document.createElement("a");
        item.className = "m3-vod-logo-badge";
        item.href = data.link || "#";
        item.target = "_blank";
        item.rel = "noopener noreferrer";
        const isFreeService = p.is_free || free.some((f) => f.name === p.name);
        const typeLabel = isFreeService ? "(Darmowe / Reklamy)" : flat.some((f) => f.name === p.name) ? "(Abonament)" : "(Wypo\u017Cycz/Kup)";
        item.title = `${p.name} ${typeLabel}`;
        item.innerHTML = `
          ${p.logo_url ? `<img src="${p.logo_url}" alt="${p.name}">` : `<span class="material-symbols-rounded" style="font-size: 16px;">tv</span>`}
          <span>${p.name}</span>
          ${isFreeService ? `<span style="font-size: 0.65rem; font-weight: 800; color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); padding: 1px 6px; border-radius: 999px; margin-left: 2px;">FREE</span>` : ""}
        `;
        vodLogosContainer.appendChild(item);
      });
    } else {
      vodLogosContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant); font-weight: 500;">Brak danych VOD (${getCountryDisplayName(state.userVodCountry)})</span>`;
    }
  });
  try {
    const showYear = show.release_year || (show.release_date ? show.release_date.split("-")[0] : "");
    const tmdbParam = show.tmdb_id ? `&tmdb_id=${show.tmdb_id}` : "";
    const yearParam = showYear ? `&year=${showYear}` : "";
    const posterParam = show.poster_url ? `&poster_url=${encodeURIComponent(show.poster_url)}` : "";
    const detailFetchUrl = `/api/search_detail?title=${encodeURIComponent(show.title)}&type=series&lang=${getUserLanguage()}${tmdbParam}${yearParam}${posterParam}`;
    const [metaRes, detailRes] = await Promise.all([
      fetch(`/api/shows/${show.uuid}/episodes_meta?lang=${getUserLanguage()}${tmdbParam}`),
      fetch(detailFetchUrl)
    ]);
    if (metaRes.ok) {
      currentShowMeta = await metaRes.json();
      renderSeasonTabs();
      renderSeasonEpisodes(false);
    }
    if (detailRes.ok) {
      const detail = await detailRes.json();
      if (detail.poster_url && (!show.poster_url || show.poster_url.includes("amazon") || show.poster_url.includes("favicon"))) {
        show.poster_url = detail.poster_url;
        if (detailImg) {
          detailImg.src = detail.poster_url;
          detailImg.style.display = "block";
        }
      }
      if (detailMeta) {
        detailMeta.innerText = `${detail.year || ""} \u2022 ${detail.genre || "Serial telewizyjny"}`;
      }
      if (detailPlot) {
        detailPlot.innerText = detail.plot || "Brak opisu.";
      }
      if (showBadgesRow) {
        showBadgesRow.innerHTML = "";
        if (show.status === "watched") {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(16, 185, 129, 0.18); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;"><span class="material-symbols-rounded" style="font-size: 13px;">task_alt</span> Uko\u0144czony</span>`;
        } else if (show.caught_up) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700;"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> Na bie\u017C\u0105co</span>`;
        }
        if (detail.year) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${detail.year}</span>`;
        }
        if (detail.total_seasons) {
          const sCount = detail.total_seasons;
          const sWord = sCount === 1 ? "Sezon" : sCount < 5 ? "Sezony" : "Sezon\xF3w";
          showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">video_library</span> ${sCount} ${sWord}</span>`;
        }
        if (detail.vote_average && detail.vote_average > 0) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge tmdb-score"><span class="material-symbols-rounded" style="font-size: 13px;">star</span> ${detail.vote_average.toFixed(1)}</span>`;
        }
        if (detail.genre) {
          const firstGenre = detail.genre.split(",")[0].trim();
          showBadgesRow.innerHTML += `<span class="m3-meta-badge highlight">${firstGenre}</span>`;
        }
        if (show.watched_count) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">check_circle</span> ${show.watched_count} odc.</span>`;
        }
        if (detail.status === "Ended" || detail.status === "Canceled" || show.series_status === "Ended") {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">flag</span> Zako\u0144czony</span>`;
        } else if (detail.status === "Returning Series" || show.in_production) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">autorenew</span> W produkcji</span>`;
        }
      }
      const showCastSec = document.getElementById("m3-show-cast-section");
      if (showCastSec) {
        if (detail.cast && detail.cast.length > 0) {
          renderCastRail("m3-show-cast-rail", detail.cast, detail.directors);
          showCastSec.style.display = "block";
        } else {
          showCastSec.style.display = "none";
        }
      }
    }
  } catch (e) {
  }
}
function renderSeasonTabs() {
  const tabsContainer = document.getElementById("m3-season-tabs");
  if (!tabsContainer || !selectedShow) return;
  tabsContainer.innerHTML = "";
  const watched = selectedShow.episodes_watched || [];
  const latestSeason = selectedShow.latest_season || 1;
  const seasonMap = {};
  watched.forEach((ep) => {
    if (!seasonMap[ep.season]) seasonMap[ep.season] = /* @__PURE__ */ new Set();
    seasonMap[ep.season].add(ep.episode);
  });
  let totalSeasons = Math.max(latestSeason, 1);
  Object.keys(currentShowMeta).forEach((key) => {
    const sNum = parseInt(key.split("_")[0]);
    if (sNum > totalSeasons) totalSeasons = sNum;
  });
  for (let s = 1; s <= totalSeasons; s++) {
    const watchedSet = seasonMap[s] || /* @__PURE__ */ new Set();
    const hasEp0 = watchedSet.has(0) || Boolean(currentShowMeta[`${s}_0`]);
    const watchedInSeason = watchedSet.size;
    let maxEpInSeason = 0;
    Object.keys(currentShowMeta).forEach((key) => {
      const parts = key.split("_");
      if (parseInt(parts[0]) === s) {
        const epNum = parseInt(parts[1]);
        if (epNum > maxEpInSeason) maxEpInSeason = epNum;
      }
    });
    const maxWatchedInSeason = watchedSet.size > 0 ? Math.max(...watchedSet) : 0;
    const finalMaxEp = Math.max(maxEpInSeason, maxWatchedInSeason, 1);
    let totalEps = finalMaxEp;
    if (hasEp0 && (watchedSet.has(0) || currentShowMeta[`${s}_0`])) {
      totalEps = finalMaxEp + 1;
    }
    totalEps = Math.max(totalEps, watchedInSeason);
    const tabBtn = document.createElement("button");
    tabBtn.className = `m3-season-tab ${s === selectedSeason ? "active" : ""}`;
    tabBtn.id = `tab-season-${s}`;
    tabBtn.innerHTML = `
      <span>Sezon ${s}</span>
      <span class="m3-season-tab-badge">(${watchedInSeason}/${totalEps})</span>
    `;
    tabBtn.addEventListener("click", () => {
      selectedSeason = s;
      document.querySelectorAll(".m3-season-tab").forEach((t) => t.classList.remove("active"));
      tabBtn.classList.add("active");
      renderSeasonEpisodes(true);
    });
    tabsContainer.appendChild(tabBtn);
  }
  setTimeout(() => {
    const activeTab = document.getElementById(`tab-season-${selectedSeason}`);
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, 100);
}
function renderSeasonEpisodes(shouldScroll = true) {
  const container = document.getElementById("m3-episodes-list");
  if (!container || !selectedShow) return;
  container.innerHTML = "";
  const watched = selectedShow.episodes_watched || [];
  const latestSeason = selectedShow.latest_season || 1;
  const latestEpisode = selectedShow.latest_episode || 0;
  const watchedInThisSeason = /* @__PURE__ */ new Set();
  watched.forEach((ep) => {
    if (ep.season === selectedSeason) {
      watchedInThisSeason.add(ep.episode);
    }
  });
  const hasEp0 = watchedInThisSeason.has(0) || Boolean(currentShowMeta[`${selectedSeason}_0`]);
  let maxEpInSeason = 0;
  Object.keys(currentShowMeta).forEach((key) => {
    const parts = key.split("_");
    if (parseInt(parts[0]) === selectedSeason) {
      const epNum = parseInt(parts[1]);
      if (epNum > maxEpInSeason) maxEpInSeason = epNum;
    }
  });
  const maxWatchedEp = watchedInThisSeason.size > 0 ? Math.max(...watchedInThisSeason) : 0;
  const epCountToRender = Math.max(maxEpInSeason, maxWatchedEp, 1);
  const startEp = hasEp0 ? 0 : 1;
  let targetElementId = null;
  for (let e = startEp; e <= epCountToRender; e++) {
    const metaKey = `${selectedSeason}_${e}`;
    const epMeta = currentShowMeta[metaKey];
    const isWatched = watchedInThisSeason.has(e);
    const epTitle = epMeta && epMeta.name ? epMeta.name : e === 0 ? "Odcinek specjalny / Prolog" : `Odcinek ${e}`;
    const epMetaInfo = epMeta && epMeta.airdate ? `${epMeta.airdate}${epMeta.runtime ? " \u2022 " + epMeta.runtime + " min" : ""}` : `S${selectedSeason < 10 ? "0" + selectedSeason : selectedSeason}E${e < 10 ? "0" + e : e}`;
    const epSummary = epMeta && epMeta.summary ? epMeta.summary : "";
    const epId = `ep-${selectedSeason}-${e}`;
    const isLatestTarget = selectedSeason === latestSeason && e === latestEpisode;
    if (isLatestTarget) {
      targetElementId = epId;
    }
    const epRow = document.createElement("div");
    epRow.id = epId;
    epRow.className = `m3-ep-item ${isWatched ? "watched" : ""} ${isLatestTarget ? "highlight-target" : ""}`;
    let summaryHtml = "";
    if (epSummary) {
      const isLong = epSummary.length > 125;
      if (isLong) {
        summaryHtml = `
          <div class="m3-ep-desc" id="desc-${epId}" title="Kliknij, aby rozwin\u0105\u0107 pe\u0142ny opis">${epSummary}</div>
          <button type="button" class="m3-ep-desc-toggle" data-target="desc-${epId}">
            <span>Rozwi\u0144</span>
            <span class="material-symbols-rounded" style="font-size: 14px;">expand_more</span>
          </button>
        `;
      } else {
        summaryHtml = `
          <div class="m3-ep-desc short">${epSummary}</div>
        `;
      }
    }
    epRow.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; padding-right: 8px;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-rounded ${isWatched ? "filled" : ""}" style="color: ${isWatched ? "var(--md-sys-color-primary)" : "var(--md-sys-color-outline-variant)"}; flex-shrink: 0; font-size: 24px;">
            ${isWatched ? "check_box" : "check_box_outline_blank"}
          </span>
          <span style="font-weight: 700; font-size: 0.95rem; color: var(--md-sys-color-on-surface); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            ${e}. ${epTitle}
          </span>
        </div>
        <div style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant); padding-left: 32px;">
          ${epMetaInfo}
        </div>
        <div style="padding-left: 32px;">
          ${summaryHtml}
        </div>
      </div>
      <div style="flex-shrink: 0; margin-top: 2px;">
        <span class="m3-chip" style="padding: 4px 10px; font-size: 0.75rem; font-weight: 600;">
          ${isWatched ? "Obejrzany" : "Oznacz"}
        </span>
      </div>
    `;
    epRow.addEventListener("click", (evt) => {
      if (evt.target.closest(".m3-ep-desc-toggle") || evt.target.closest(".m3-ep-desc")) {
        return;
      }
      if (!isWatched) {
        const hasPrevInSeason = e > 1;
        const hasPrevSeasons = selectedSeason > 1;
        if (hasPrevInSeason || hasPrevSeasons) {
          askBatchConfirmation({
            message: `Zaznaczy\u0142e\u015B odcinek ${e} (Sezon ${selectedSeason}). Jak chcesz oznaczy\u0107 post\u0119p ogl\u0105dania?`,
            season: selectedSeason,
            episode: e,
            onAllSeasons: async () => {
              const batchList = [];
              for (let s = 1; s < selectedSeason; s++) {
                let seasonMax = 10;
                Object.keys(currentShowMeta).forEach((key) => {
                  const parts = key.split("_");
                  if (parseInt(parts[0]) === s) {
                    const epN = parseInt(parts[1]);
                    if (epN > seasonMax) seasonMax = epN;
                  }
                });
                for (let epN = 1; epN <= seasonMax; epN++) {
                  batchList.push({ season: s, episode: epN });
                }
              }
              for (let epN = 1; epN <= e; epN++) {
                batchList.push({ season: selectedSeason, episode: epN });
              }
              await batchMarkEpisodes(selectedShow.uuid, batchList);
            },
            onThisSeason: async () => {
              const batchList = [];
              for (let epN = 1; epN <= e; epN++) {
                batchList.push({ season: selectedSeason, episode: epN });
              }
              await batchMarkEpisodes(selectedShow.uuid, batchList);
            },
            onSingle: () => {
              toggleEpisodeWatch(selectedSeason, e);
            }
          });
          return;
        }
      }
      toggleEpisodeWatch(selectedSeason, e);
    });
    const descToggle = epRow.querySelector(".m3-ep-desc-toggle");
    const targetDesc = epRow.querySelector(".m3-ep-desc:not(.short)");
    const toggleExpansion = (evt) => {
      if (evt) evt.stopPropagation();
      if (targetDesc) {
        const isExp = targetDesc.classList.toggle("expanded");
        if (descToggle) {
          descToggle.innerHTML = isExp ? `<span>Zwi\u0144</span><span class="material-symbols-rounded" style="font-size: 14px;">expand_less</span>` : `<span>Rozwi\u0144</span><span class="material-symbols-rounded" style="font-size: 14px;">expand_more</span>`;
        }
      }
    };
    if (descToggle) descToggle.addEventListener("click", toggleExpansion);
    if (targetDesc) targetDesc.addEventListener("click", toggleExpansion);
    container.appendChild(epRow);
  }
  if (shouldScroll && targetElementId) {
    setTimeout(() => {
      const targetEl = document.getElementById(targetElementId);
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 150);
  }
}
async function toggleEpisodeWatch(season, episode) {
  if (!selectedShow) return;
  try {
    const res = await fetch(`/api/shows/${selectedShow.uuid}/episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ season, episode })
    });
    if (res.ok) {
      const updated = await res.json();
      selectedShow = updated;
      const idx = state.shows.findIndex((s) => s.uuid === updated.uuid);
      if (idx !== -1) state.shows[idx] = updated;
      const progressText = updated.latest_progress ? `Post\u0119p: ${updated.latest_progress} (${updated.watched_count} odcink\xF3w)` : "Brak obejrzanych odcink\xF3w";
      document.getElementById("m3-ep-show-meta").innerText = progressText;
      renderSeasonTabs();
      renderSeasonEpisodes(false);
      updateStats();
      renderShows();
      saveLocalDatabase();
    }
  } catch (e) {
  }
}
async function batchMarkEpisodes(showUuid, episodesList) {
  try {
    const res = await fetch(`/api/shows/${showUuid}/batch_episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodes: episodesList })
    });
    if (res.ok) {
      const updated = await res.json();
      selectedShow = updated;
      const idx = state.shows.findIndex((s) => s.uuid === updated.uuid);
      if (idx !== -1) state.shows[idx] = updated;
      const progressText = updated.latest_progress ? `Post\u0119p: ${updated.latest_progress} (${updated.watched_count} odcink\xF3w)` : "Brak obejrzanych odcink\xF3w";
      document.getElementById("m3-ep-show-meta").innerText = progressText;
      renderSeasonTabs();
      renderSeasonEpisodes(false);
      updateStats();
      renderShows();
      saveLocalDatabase();
    }
  } catch (e) {
  }
}
function askBatchConfirmation({ message, season, episode, onAllSeasons, onThisSeason, onSingle }) {
  const modal = document.getElementById("m3-smart-batch-modal");
  if (!modal) return;
  const msgEl = document.getElementById("m3-smart-batch-msg");
  const btnAllSeasons = document.getElementById("m3-btn-batch-all-seasons");
  const btnThisSeason = document.getElementById("m3-btn-batch-this-season");
  const btnOnly = document.getElementById("m3-btn-batch-only");
  const btnCancel = document.getElementById("m3-btn-batch-cancel");
  const textAllSeasons = document.getElementById("m3-btn-batch-all-seasons-text");
  const textThisSeason = document.getElementById("m3-btn-batch-this-season-text");
  if (msgEl) msgEl.innerText = message;
  if (btnAllSeasons) {
    if (season > 1) {
      btnAllSeasons.style.display = "flex";
      if (textAllSeasons) textAllSeasons.innerText = `Wszystkie poprzednie sezony (1\u2013${season - 1}) + Sezon ${season} (1\u2013${episode})`;
    } else {
      btnAllSeasons.style.display = "none";
    }
  }
  if (btnThisSeason) {
    if (episode > 1) {
      btnThisSeason.style.display = "flex";
      if (textThisSeason) textThisSeason.innerText = season > 1 ? `Tylko w Sezonie ${season} (Odcinki 1\u2013${episode})` : `Wszystkie poprzednie odcinki (1\u2013${episode})`;
    } else {
      btnThisSeason.style.display = "none";
    }
  }
  modal.classList.add("active");
  const cleanup = () => {
    modal.classList.remove("active");
    if (btnAllSeasons) btnAllSeasons.onclick = null;
    if (btnThisSeason) btnThisSeason.onclick = null;
    if (btnOnly) btnOnly.onclick = null;
    if (btnCancel) btnCancel.onclick = null;
  };
  if (btnAllSeasons) {
    btnAllSeasons.onclick = () => {
      cleanup();
      if (onAllSeasons) onAllSeasons();
    };
  }
  if (btnThisSeason) {
    btnThisSeason.onclick = () => {
      cleanup();
      if (onThisSeason) onThisSeason();
    };
  }
  if (btnOnly) {
    btnOnly.onclick = () => {
      cleanup();
      if (onSingle) onSingle();
    };
  }
  if (btnCancel) {
    btnCancel.onclick = () => {
      cleanup();
    };
  }
}
async function toggleShowFavorite(uuid, currentFav) {
  const nextFav = !currentFav;
  try {
    const res = await fetch(`/api/shows/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: nextFav })
    });
    if (res.ok) {
      const found = state.shows.find((s) => s.uuid === uuid);
      if (found) found.is_favorite = nextFav;
      renderShows();
      updateStats();
      saveLocalDatabase();
    }
  } catch (e) {
  }
}
async function deleteShow(uuid) {
  try {
    const res = await fetch(`/api/shows/${uuid}`, { method: "DELETE" });
    if (res.ok) {
      state.shows = state.shows.filter((s) => s.uuid !== uuid);
      updateStats();
      renderShows();
      document.getElementById("m3-sheet-episodes").classList.remove("active");
      saveLocalDatabase();
      showToastNotification("Serial zosta\u0142 usuni\u0119ty z biblioteki.", "info");
    } else {
      showToastNotification("B\u0142\u0105d podczas usuwania serialu.", "error");
    }
  } catch (err) {
    console.error("Error deleting show:", err);
  }
}
function openShowRematchPicker(show) {
  openRematchPicker(show, "series");
}
var seriesConversations = {};
function openSeriesAiModal(show) {
  if (!isAiConfigured()) {
    showToastNotification("Aby korzysta\u0107 z Asystenta AI, najpierw skonfiguruj sw\xF3j klucz API.", "info");
    openCloudSyncModal("ai");
    return;
  }
  const sheet = document.getElementById("m3-sheet-ai-series");
  const titleEl = document.getElementById("m3-ai-series-title");
  const progressEl = document.getElementById("m3-ai-series-progress");
  const outputEl = document.getElementById("m3-ai-series-output");
  const inputEl = document.getElementById("m3-ai-series-input");
  const closeBtn = document.getElementById("m3-ai-series-close");
  const resetBtn = document.getElementById("m3-ai-btn-reset-series");
  const sendBtn = document.getElementById("m3-ai-series-send-btn");
  if (!seriesConversations[show.uuid]) {
    seriesConversations[show.uuid] = [];
  }
  if (titleEl) titleEl.innerText = `Asystent: ${show.title}`;
  if (progressEl) progressEl.innerText = `Post\u0119p: ${show.latest_progress || "Pocz\u0105tek serialu"} \u2022 \u{1F6E1}\uFE0F 100% Bez spoiler\xF3w`;
  if (inputEl) inputEl.value = "";
  const resetThread = () => {
    seriesConversations[show.uuid] = [];
    if (outputEl) {
      outputEl.innerHTML = `<span style="color: var(--md-sys-color-on-surface-variant); font-style: italic;">Kliknij jedno z szybkich zapyta\u0144 lub zadaj pytanie. Mo\u017Cesz swobodnie kontynuowa\u0107 rozmow\u0119 i dopytywa\u0107 o w\u0105tki!</span>`;
    }
  };
  if (resetBtn) {
    resetBtn.onclick = resetThread;
  }
  if (closeBtn && sheet) {
    closeBtn.onclick = () => sheet.classList.remove("active");
  }
  const sendSeriesMessage = async (queryText) => {
    if (!queryText || !queryText.trim()) return;
    inputEl.value = "";
    if (outputEl && seriesConversations[show.uuid].length === 0) {
      outputEl.innerHTML = "";
    }
    const userBubble = document.createElement("div");
    userBubble.style.cssText = "align-self: flex-end; max-width: 85%; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); padding: 8px 12px; border-radius: 14px 14px 4px 14px; font-size: 0.82rem; font-weight: 500; margin-bottom: 8px; word-break: break-word;";
    userBubble.innerText = queryText;
    outputEl.appendChild(userBubble);
    const msgId = "series-ai-msg-" + Date.now();
    const assistantBubble = document.createElement("div");
    assistantBubble.style.cssText = "align-self: flex-start; width: 100%; background: var(--md-sys-color-surface-container-high); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 14px 14px 14px 4px; padding: 12px; font-size: 0.82rem; line-height: 1.5; color: var(--md-sys-color-on-surface); margin-bottom: 12px; display: flex; flex-direction: column; gap: 6px;";
    assistantBubble.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--md-sys-color-outline-variant); padding-bottom: 4px;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #a855f7;">
          <span class="material-symbols-rounded" style="font-size: 16px;">auto_awesome</span>
          <span>Asystent Serialu</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" class="m3-chip" id="collapse-${msgId}" style="font-size: 0.7rem; padding: 2px 6px; gap: 4px; display: inline-flex; align-items: center;" title="Rozwi\u0144 / Zwi\u0144 tekst">
            <span class="material-symbols-rounded" id="collapse-icon-${msgId}" style="font-size: 13px;">unfold_more</span>
            <span id="collapse-text-${msgId}">Rozwi\u0144</span>
          </button>
          <button type="button" class="m3-chip" id="copy-${msgId}" style="font-size: 0.7rem; padding: 2px 6px; gap: 4px; display: inline-flex; align-items: center;" title="Kopiuj do schowka">
            <span class="material-symbols-rounded" style="font-size: 13px;">content_copy</span>
            <span>Kopiuj</span>
          </button>
        </div>
      </div>
      <details class="m3-ai-thought-accordion" id="thought-${msgId}" style="display: none; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 6px; padding: 4px 8px; font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant);">
        <summary style="cursor: pointer; font-weight: 700; color: #a855f7; display: flex; align-items: center; gap: 6px; user-select: none;">
          <span class="material-symbols-rounded" style="font-size: 15px;">psychology</span>
          <span>Tok my\u015Blenia (<span id="count-${msgId}">0 s\u0142\xF3w</span>)</span>
        </summary>
        <div id="text-${msgId}" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(168, 85, 247, 0.15); line-height: 1.4; font-style: italic; white-space: pre-wrap; max-height: 100px; overflow-y: auto;"></div>
      </details>
      <div id="content-${msgId}" style="line-height: 1.55; max-height: 90px; overflow-y: auto; position: relative; mask-image: linear-gradient(to bottom, black 50%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%); transition: max-height 0.25s ease;">
        <div style="display: flex; align-items: center; gap: 6px; color: #a855f7;">
          <span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 16px;">auto_awesome</span>
          <span style="font-weight: 600;">Asystent analizuje fabu\u0142\u0119 bez spoiler\xF3w...</span>
        </div>
      </div>
    `;
    outputEl.appendChild(assistantBubble);
    outputEl.scrollTop = outputEl.scrollHeight;
    const contentEl = document.getElementById(`content-${msgId}`);
    const thoughtBox = document.getElementById(`thought-${msgId}`);
    const thoughtTextEl = document.getElementById(`text-${msgId}`);
    const thoughtCountEl = document.getElementById(`count-${msgId}`);
    const copyBtn = document.getElementById(`copy-${msgId}`);
    const collapseBtn = document.getElementById(`collapse-${msgId}`);
    const collapseIcon = document.getElementById(`collapse-icon-${msgId}`);
    const collapseText = document.getElementById(`collapse-text-${msgId}`);
    let latestFullText = "";
    let isCollapsed = true;
    if (collapseBtn && contentEl) {
      collapseBtn.onclick = () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          contentEl.style.maxHeight = "90px";
          contentEl.style.overflowY = "auto";
          contentEl.style.position = "relative";
          contentEl.style.maskImage = "linear-gradient(to bottom, black 50%, transparent 100%)";
          contentEl.style.webkitMaskImage = "linear-gradient(to bottom, black 50%, transparent 100%)";
          if (collapseIcon) collapseIcon.innerText = "unfold_more";
          if (collapseText) collapseText.innerText = "Rozwi\u0144";
        } else {
          contentEl.style.maxHeight = "none";
          contentEl.style.overflowY = "visible";
          contentEl.style.maskImage = "none";
          contentEl.style.webkitMaskImage = "none";
          if (collapseIcon) collapseIcon.innerText = "unfold_less";
          if (collapseText) collapseText.innerText = "Zwi\u0144";
        }
      };
    }
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (latestFullText) {
          navigator.clipboard.writeText(latestFullText).then(() => {
            showToastNotification("Skopiowano odpowied\u017A do schowka!", "success");
          }).catch(() => {
            showToastNotification("Nie uda\u0142o si\u0119 skopiowa\u0107 do schowka.", "error");
          });
        }
      };
    }
    const onToken = (delta, fullText) => {
      latestFullText = fullText;
      if (contentEl) {
        contentEl.innerHTML = formatAiMarkdown(fullText);
        if (isCollapsed) {
          contentEl.scrollTop = contentEl.scrollHeight;
        }
        outputEl.scrollTop = outputEl.scrollHeight;
      }
    };
    const onThought = (deltaThought, fullThoughtText) => {
      if (thoughtBox && thoughtTextEl) {
        thoughtBox.style.display = "block";
        thoughtTextEl.innerText = fullThoughtText;
        if (thoughtCountEl) {
          const words = fullThoughtText.trim().split(/\s+/).length;
          thoughtCountEl.innerText = `${words} s\u0142\xF3w`;
        }
      }
    };
    if (seriesConversations[show.uuid].length === 0) {
      seriesConversations[show.uuid].push({
        role: "system",
        content: buildSeriesSystemPrompt(show.title, show.latest_progress)
      });
    }
    seriesConversations[show.uuid].push({ role: "user", content: queryText });
    try {
      const answer = await streamAiChat({
        messages: seriesConversations[show.uuid],
        temperature: 0.5,
        max_tokens: 1600,
        onToken,
        onThought
      });
      seriesConversations[show.uuid].push({ role: "assistant", content: answer });
    } catch (err) {
      if (contentEl) {
        contentEl.innerHTML = `<span style="color: var(--md-sys-color-error); font-weight: 600;">\u{1F534} B\u0142\u0105d: ${err.message}</span>`;
      }
    }
  };
  const btnRecap = document.getElementById("m3-ai-btn-recap-previous");
  const btnWhoIsWho = document.getElementById("m3-ai-btn-who-is-who");
  const btnLastEvents = document.getElementById("m3-ai-btn-last-events");
  if (btnRecap) {
    btnRecap.onclick = () => sendSeriesMessage(`Podsumuj najwa\u017Cniejsze wydarzenia z poprzednich sezon\xF3w, kt\xF3re doprowadzi\u0142y do stanu na odcinku ${show.latest_progress || "pocz\u0105tek serialu"}, bez \u017Cadnych spoiler\xF3w do przodu.`);
  }
  if (btnWhoIsWho) {
    btnWhoIsWho.onclick = () => sendSeriesMessage(`Kto jest kim w serialu na etapie odcinka ${show.latest_progress || "pocz\u0105tek serialu"}? Wyja\u015Bnij kr\xF3tko relacje g\u0142\xF3wnych bohater\xF3w.`);
  }
  if (btnLastEvents) {
    btnLastEvents.onclick = () => sendSeriesMessage(`Co wydarzy\u0142o si\u0119 w ostatnich odcinkach przed obecnym stanem (${show.latest_progress || "pocz\u0105tek serialu"})? Przypomnij kluczowe w\u0105tki.`);
  }
  if (sendBtn && inputEl) {
    sendBtn.onclick = () => {
      sendSeriesMessage(inputEl.value.trim());
    };
    inputEl.onkeydown = (e) => {
      if (e.key === "Enter") {
        sendSeriesMessage(inputEl.value.trim());
      }
    };
  }
  if (sheet) sheet.classList.add("active");
}
window.openEpisodeTracker = openEpisodeTracker;
window.renderShows = renderShows;

// static/js/modules/search.js
var searchType = "movie";
var confirmedType = "movie";
var confirmedStatus = "watched";
var currentAddRating = null;
var currentPreviewData = null;
var lastSearchResults = [];
var preAddWatchedSet = /* @__PURE__ */ new Set();
var preAddSelectedSeason = 1;
var preAddSeasonCounts = {};
var ratingLabels = [
  "Brak oceny",
  "1/5 \u2605 S\u0142aby",
  "2/5 \u2605\u2605 Przeci\u0119tny",
  "3/5 \u2605\u2605\u2605 Dobry",
  "4/5 \u2605\u2605\u2605\u2605 Bardzo dobry",
  "5/5 \u2605\u2605\u2605\u2605\u2605 Arcydzie\u0142o!"
];
function setConfirmedType(type) {
  confirmedType = type;
  const progressBox = document.getElementById("m3-series-progress-box");
  const typeBadge = document.getElementById("m3-preview-type-badge");
  const labelWatched = document.getElementById("m3-status-label-watched");
  const iconWatched = document.getElementById("m3-status-icon-watched");
  const labelWatchlist = document.getElementById("m3-status-label-watchlist");
  if (type === "series") {
    if (labelWatched) labelWatched.innerText = "W trakcie ogl\u0105dania";
    if (iconWatched) iconWatched.innerText = "play_circle";
    if (labelWatchlist) labelWatchlist.innerText = "Planowane";
    if (confirmedStatus === "watched" || confirmedStatus === "watching") {
      if (progressBox) progressBox.style.display = "block";
    } else {
      if (progressBox) progressBox.style.display = "none";
    }
    if (typeBadge) typeBadge.innerHTML = `\u{1F4FA} SERIAL`;
  } else {
    if (labelWatched) labelWatched.innerText = "Obejrzane";
    if (iconWatched) iconWatched.innerText = "check_circle";
    if (labelWatchlist) labelWatchlist.innerText = "Planowane";
    if (progressBox) progressBox.style.display = "none";
    if (typeBadge) typeBadge.innerHTML = `\u{1F3AC} FILM`;
  }
}
function setConfirmedStatus(status) {
  confirmedStatus = status;
  const btnWatched = document.getElementById("m3-status-btn-watched");
  const btnWatchlist = document.getElementById("m3-status-btn-watchlist");
  const hiddenInput = document.getElementById("m3-confirm-status");
  const ratingBox = document.getElementById("m3-add-rating-container");
  const progressBox = document.getElementById("m3-series-progress-box");
  if (status === "watchlist") {
    if (btnWatchlist) btnWatchlist.classList.add("active");
    if (btnWatched) btnWatched.classList.remove("active");
    if (hiddenInput) hiddenInput.value = "watchlist";
    if (ratingBox) {
      ratingBox.style.opacity = "0.35";
      ratingBox.style.pointerEvents = "none";
    }
    setAddRating(null);
    if (progressBox) progressBox.style.display = "none";
  } else {
    if (btnWatched) btnWatched.classList.add("active");
    if (btnWatchlist) btnWatchlist.classList.remove("active");
    if (hiddenInput) hiddenInput.value = confirmedType === "series" ? "watching" : "watched";
    if (ratingBox) {
      ratingBox.style.opacity = "1";
      ratingBox.style.pointerEvents = "auto";
    }
    if (progressBox && confirmedType === "series") progressBox.style.display = "block";
  }
}
function setAddRating(val) {
  currentAddRating = val ? parseInt(val) : null;
  const hiddenInput = document.getElementById("m3-confirm-rating");
  const labelEl = document.getElementById("m3-add-rating-label");
  const clearBtn = document.getElementById("m3-add-rating-clear");
  const stars = document.querySelectorAll(".m3-interactive-star");
  if (hiddenInput) hiddenInput.value = currentAddRating || "";
  if (labelEl) labelEl.innerText = currentAddRating ? ratingLabels[currentAddRating] : ratingLabels[0];
  if (clearBtn) clearBtn.style.display = currentAddRating ? "inline-flex" : "none";
  stars.forEach((s) => {
    const starVal = parseInt(s.getAttribute("data-val"));
    if (currentAddRating && starVal <= currentAddRating) {
      s.classList.add("filled");
      s.style.color = "var(--md-sys-color-primary)";
      s.style.fontVariationSettings = "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24";
      s.style.transform = "scale(1.15)";
    } else {
      s.classList.remove("filled");
      s.style.color = "var(--md-sys-color-outline-variant)";
      s.style.fontVariationSettings = "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
      s.style.transform = "scale(1.0)";
    }
  });
}
function initPreAddEpisodeSelector(totalSeasons, seasonCounts) {
  preAddWatchedSet.clear();
  preAddSelectedSeason = 1;
  preAddSeasonCounts = seasonCounts || {};
  renderPreAddSeasonTabs(totalSeasons);
  renderPreAddEpisodesGrid();
}
function renderPreAddSeasonTabs(totalSeasons) {
  const tabsContainer = document.getElementById("m3-add-season-tabs");
  if (!tabsContainer) return;
  tabsContainer.innerHTML = "";
  const seasonsToRender = Math.max(totalSeasons || 1, 1);
  for (let s = 1; s <= seasonsToRender; s++) {
    const countInSeason = Array.from(preAddWatchedSet).filter((k) => k.startsWith(`${s}_`)).length;
    const totalInSeason = preAddSeasonCounts[String(s)] || 10;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `m3-season-tab ${s === preAddSelectedSeason ? "active" : ""}`;
    btn.innerHTML = `
      <span>Sezon ${s}</span>
      <span class="m3-season-tab-badge">(${countInSeason}/${totalInSeason})</span>
    `;
    btn.addEventListener("click", () => {
      preAddSelectedSeason = s;
      document.querySelectorAll("#m3-add-season-tabs .m3-season-tab").forEach((t) => t.classList.remove("active"));
      btn.classList.add("active");
      renderPreAddEpisodesGrid();
    });
    tabsContainer.appendChild(btn);
  }
}
function renderPreAddEpisodesGrid() {
  const grid = document.getElementById("m3-add-episodes-grid");
  if (!grid) return;
  grid.innerHTML = "";
  const totalEpsInSeason = preAddSeasonCounts[String(preAddSelectedSeason)] || 10;
  for (let e = 1; e <= totalEpsInSeason; e++) {
    const key = `${preAddSelectedSeason}_${e}`;
    const isChecked = preAddWatchedSet.has(key);
    const chip = document.createElement("div");
    chip.className = `m3-ep-chip ${isChecked ? "checked" : ""}`;
    chip.innerHTML = `
      <span class="material-symbols-rounded" style="font-size: 16px;">${isChecked ? "check" : "add"}</span>
      <span>${e}</span>
    `;
    chip.addEventListener("click", () => {
      if (isChecked) {
        preAddWatchedSet.delete(key);
      } else {
        preAddWatchedSet.add(key);
      }
      renderPreAddSeasonTabs(Object.keys(preAddSeasonCounts).length || 1);
      renderPreAddEpisodesGrid();
      updatePreAddSummary();
    });
    grid.appendChild(chip);
  }
}
function updatePreAddSummary() {
  const countEl = document.getElementById("m3-pre-add-summary-count");
  if (countEl) {
    countEl.innerText = `${preAddWatchedSet.size} ${preAddWatchedSet.size === 1 ? "odcinek" : "odcink\xF3w"}`;
  }
}
async function selectProductionDetail(item) {
  const stepResults = document.getElementById("m3-add-step-results");
  const stepPreview = document.getElementById("m3-add-step-preview");
  try {
    const params = new URLSearchParams({
      tmdb_id: item.tmdb_id || "",
      id: item.imdb_id || "",
      title: item.title || "",
      year: item.year || "",
      type: item.type || searchType,
      lang: getUserLanguage()
    });
    let url = `/api/search_detail?${params.toString()}`;
    const res = await fetch(url);
    const detail = res.ok ? await res.json() : item;
    currentPreviewData = detail;
    const detectedType = detail.type === "series" ? "series" : searchType === "series" ? "series" : "movie";
    setConfirmedType(detectedType);
    const existing = findDuplicateInLibrary(detail.title, detectedType, detail.tmdb_id || detail.id);
    if (existing) {
      setConfirmedStatus(existing.status || "watched");
      setAddRating(existing.rating || null);
      showToastNotification(`\u2139\uFE0F Ta pozycja (\u201E${detail.title}\u201D) jest ju\u017C w Twojej bibliotece (${existing.status === "watched" ? "Obejrzane" : "Do obejrzenia"}).`, "info");
    } else {
      setConfirmedStatus("watched");
      setAddRating(null);
    }
    document.getElementById("m3-preview-title").innerText = detail.title;
    document.getElementById("m3-preview-year").innerText = detail.year || "";
    document.getElementById("m3-preview-meta").innerText = detail.genre || (detectedType === "series" ? "Serial telewizyjny" : "Film kinowy");
    document.getElementById("m3-preview-plot").innerText = detail.plot || "Brak opisu.";
    const finalPoster = detail.poster_url || item.poster_url || "";
    currentPreviewData.poster_url = finalPoster;
    const imgEl = document.getElementById("m3-preview-img");
    const posterBox = imgEl ? imgEl.parentElement : null;
    if (posterBox) {
      const oldFb = posterBox.querySelector(".m3-poster-fallback");
      if (oldFb) oldFb.remove();
    }
    if (imgEl) {
      if (finalPoster) {
        imgEl.src = finalPoster;
        imgEl.style.display = "block";
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          if (posterBox && !posterBox.querySelector(".m3-poster-fallback")) {
            const fb = document.createElement("div");
            fb.className = "m3-poster-fallback";
            fb.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(detail.title)}; color: #fff; font-weight: 700; font-size: 0.8rem; text-align: center; border-radius: 12px; padding: 8px;`;
            fb.innerText = detail.title;
            posterBox.appendChild(fb);
          }
        };
      } else {
        imgEl.style.display = "none";
        if (posterBox && !posterBox.querySelector(".m3-poster-fallback")) {
          const fb = document.createElement("div");
          fb.className = "m3-poster-fallback";
          fb.style.cssText = `width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(detail.title)}; color: #fff; font-weight: 700; font-size: 0.8rem; text-align: center; border-radius: 12px; padding: 8px;`;
          fb.innerText = detail.title;
          posterBox.appendChild(fb);
        }
      }
    }
    if (detectedType === "series") {
      initPreAddEpisodeSelector(detail.total_seasons || 1, detail.season_ep_counts || {});
    }
    renderPreviewVod(detail.title, detectedType === "series" ? "tv" : "movie", detail.tmdb_id || detail.id);
    stepResults.style.display = "none";
    document.getElementById("m3-add-step-search").style.display = "none";
    stepPreview.style.display = "flex";
  } catch (e) {
    console.error("Error loading detail:", e);
  }
}
function initSearchAndAddModal() {
  const searchInput = document.getElementById("m3-search-input");
  const searchClearBtn = document.getElementById("m3-search-clear");
  if (searchInput && searchClearBtn) {
    searchInput.addEventListener("input", () => {
      if (searchInput.value.trim().length > 0) {
        searchClearBtn.style.display = "block";
      } else {
        searchClearBtn.style.display = "none";
      }
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchClearBtn.style.display = "none";
      searchInput.focus();
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  }
  const sheetAdd = document.getElementById("m3-sheet-add");
  const btnFabAdd = document.getElementById("m3-fab-add");
  const btnSidebarAdd = document.getElementById("m3-btn-add");
  const addCloseBtn = document.getElementById("m3-sheet-close");
  const stepSearch = document.getElementById("m3-add-step-search");
  const stepResults = document.getElementById("m3-add-step-results");
  const stepPreview = document.getElementById("m3-add-step-preview");
  const addSearchInput = document.getElementById("m3-search-preview-input");
  const addSearchForm = document.getElementById("m3-search-preview-form");
  const btnSearchTrigger = document.getElementById("m3-btn-search-trigger");
  const resultsContainer = document.getElementById("m3-search-results-list");
  const searchError = document.getElementById("m3-search-error");
  const searchErrorText = document.getElementById("m3-search-error-text");
  const btnResultsBack = document.getElementById("m3-btn-results-back");
  const btnPreviewBack = document.getElementById("m3-btn-back-to-search");
  const btnSearchMovie = document.getElementById("m3-search-type-movie");
  const btnSearchSeries = document.getElementById("m3-search-type-series");
  const openAddModal = () => {
    searchType = state.mode === "movies" ? "movie" : "series";
    if (btnSearchMovie && btnSearchSeries) {
      if (searchType === "movie") {
        btnSearchMovie.classList.add("active");
        btnSearchSeries.classList.remove("active");
      } else {
        btnSearchSeries.classList.add("active");
        btnSearchMovie.classList.remove("active");
      }
    }
    if (stepSearch) stepSearch.style.display = "block";
    if (stepResults) stepResults.style.display = "none";
    if (stepPreview) stepPreview.style.display = "none";
    if (searchError) searchError.style.display = "none";
    if (addSearchInput) addSearchInput.value = "";
    if (resultsContainer) resultsContainer.innerHTML = "";
    const modalTitle = document.getElementById("m3-modal-title");
    if (modalTitle) modalTitle.innerText = "Wyszukaj i dodaj";
    if (sheetAdd) sheetAdd.classList.add("active");
    if (addSearchInput) setTimeout(() => addSearchInput.focus(), 150);
  };
  if (btnFabAdd) btnFabAdd.addEventListener("click", openAddModal);
  if (btnSidebarAdd) btnSidebarAdd.addEventListener("click", openAddModal);
  if (addCloseBtn && sheetAdd) {
    addCloseBtn.addEventListener("click", () => sheetAdd.classList.remove("active"));
  }
  if (btnSearchMovie && btnSearchSeries) {
    btnSearchMovie.addEventListener("click", () => {
      searchType = "movie";
      btnSearchMovie.classList.add("active");
      btnSearchSeries.classList.remove("active");
    });
    btnSearchSeries.addEventListener("click", () => {
      searchType = "series";
      btnSearchSeries.classList.add("active");
      btnSearchMovie.classList.remove("active");
    });
  }
  if (btnResultsBack) {
    btnResultsBack.addEventListener("click", () => {
      if (stepResults) stepResults.style.display = "none";
      if (stepSearch) stepSearch.style.display = "block";
      if (addSearchInput) addSearchInput.focus();
    });
  }
  if (btnPreviewBack) {
    btnPreviewBack.addEventListener("click", () => {
      if (sheetAdd && sheetAdd.getAttribute("data-opened-from-rec") === "true") {
        sheetAdd.removeAttribute("data-opened-from-rec");
        sheetAdd.classList.remove("active");
        return;
      }
      if (stepPreview) stepPreview.style.display = "none";
      if (lastSearchResults.length > 1) {
        if (stepResults) stepResults.style.display = "flex";
      } else {
        if (stepSearch) stepSearch.style.display = "block";
        if (addSearchInput) addSearchInput.focus();
      }
    });
  }
  if (addSearchForm) {
    addSearchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const query = addSearchInput ? addSearchInput.value.trim() : "";
      if (!query) return;
      const origHtml = btnSearchTrigger ? btnSearchTrigger.innerHTML : "";
      if (btnSearchTrigger) {
        btnSearchTrigger.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite;">sync</span> Szukam...`;
        btnSearchTrigger.disabled = true;
      }
      if (searchError) searchError.style.display = "none";
      try {
        const res = await fetch(`/api/search_preview?q=${encodeURIComponent(query)}&type=${searchType}&lang=${getUserLanguage()}`);
        const data = await res.json();
        if (data.found && data.results && data.results.length > 0) {
          lastSearchResults = data.results;
          if (data.results.length === 1) {
            selectProductionDetail(data.results[0]);
          } else {
            if (resultsContainer) {
              resultsContainer.innerHTML = "";
              data.results.forEach((item) => {
                const isSeries = item.type === "series";
                const row = document.createElement("div");
                row.className = "m3-result-item";
                let posterHtml = item.poster_url ? `<img src="${item.poster_url}" class="m3-result-poster" alt="${item.title}">` : `<div class="m3-result-poster" style="background: ${getGradientForTitle(item.title)}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; text-align: center; color: white;">${item.title.substring(0, 10)}</div>`;
                row.innerHTML = `
                  ${posterHtml}
                  <div style="flex-grow: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="m3-preview-type-badge" style="font-size: 0.65rem; padding: 2px 6px;">
                        ${isSeries ? "\u{1F4FA} SERIAL" : "\u{1F3AC} FILM"}
                      </span>
                      <span style="font-size: 0.8rem; font-weight: 700; color: var(--md-sys-color-on-surface-variant);">${item.year || ""}</span>
                    </div>
                    <div style="font-weight: 700; font-size: 0.95rem; color: var(--md-sys-color-on-surface); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${item.title}
                    </div>
                  </div>
                  <span class="material-symbols-rounded" style="color: var(--md-sys-color-primary); font-size: 20px;">chevron_right</span>
                `;
                row.addEventListener("click", () => {
                  selectProductionDetail(item);
                });
                resultsContainer.appendChild(row);
              });
            }
            if (stepSearch) stepSearch.style.display = "none";
            if (stepResults) stepResults.style.display = "flex";
          }
        } else {
          if (searchErrorText) searchErrorText.innerText = data.message || "Nie znaleziono pozycji o podanym tytule. Sprawd\u017A pisowni\u0119.";
          if (searchError) searchError.style.display = "flex";
        }
      } catch (err) {
        console.error("Search preview error:", err);
        if (searchErrorText) searchErrorText.innerText = "B\u0142\u0105d wyszukiwania online. Spr\xF3buj ponownie.";
        if (searchError) searchError.style.display = "flex";
      } finally {
        if (btnSearchTrigger) {
          btnSearchTrigger.innerHTML = origHtml;
          btnSearchTrigger.disabled = false;
        }
      }
    });
  }
  const btnStatusWatched = document.getElementById("m3-status-btn-watched");
  const btnStatusWatchlist = document.getElementById("m3-status-btn-watchlist");
  if (btnStatusWatched) btnStatusWatched.addEventListener("click", () => setConfirmedStatus("watched"));
  if (btnStatusWatchlist) btnStatusWatchlist.addEventListener("click", () => setConfirmedStatus("watchlist"));
  const starElements = document.querySelectorAll(".m3-interactive-star");
  const starBar = document.getElementById("m3-add-star-bar");
  const ratingClearBtn = document.getElementById("m3-add-rating-clear");
  starElements.forEach((star) => {
    star.addEventListener("click", () => {
      const val = parseInt(star.getAttribute("data-val"));
      setAddRating(val === currentAddRating ? null : val);
    });
    star.addEventListener("mouseenter", () => {
      const hoverVal = parseInt(star.getAttribute("data-val"));
      starElements.forEach((s) => {
        const sVal = parseInt(s.getAttribute("data-val"));
        if (sVal <= hoverVal) {
          s.style.color = "var(--md-sys-color-primary)";
          s.style.fontVariationSettings = "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24";
          s.style.transform = "scale(1.15)";
        } else {
          s.style.color = "var(--md-sys-color-outline-variant)";
          s.style.fontVariationSettings = "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
          s.style.transform = "scale(1.0)";
        }
      });
      const labelEl = document.getElementById("m3-add-rating-label");
      if (labelEl) labelEl.innerText = ratingLabels[hoverVal];
    });
  });
  if (starBar) {
    starBar.addEventListener("mouseleave", () => {
      setAddRating(currentAddRating);
    });
  }
  if (ratingClearBtn) {
    ratingClearBtn.addEventListener("click", () => setAddRating(null));
  }
  const confirmForm = document.getElementById("m3-confirm-add-form");
  if (confirmForm) {
    confirmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentPreviewData) return;
      const status = document.getElementById("m3-confirm-status").value;
      const ratingVal = document.getElementById("m3-confirm-rating").value;
      const rating = status === "watchlist" ? null : ratingVal ? parseInt(ratingVal) : null;
      if (confirmedType === "movie") {
        const payload = {
          title: currentPreviewData.title,
          poster_url: currentPreviewData.poster_url,
          release_date: currentPreviewData.released || (currentPreviewData.year ? `${currentPreviewData.year.substring(0, 4)}-01-01` : null),
          status,
          rating,
          tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
          is_favorite: false
        };
        const res = await fetch("/api/movies/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const savedMovie = await res.json();
          const existingIdx = state.movies.findIndex(
            (m) => m.uuid && m.uuid === savedMovie.uuid || savedMovie.tmdb_id && m.tmdb_id && String(m.tmdb_id) === String(savedMovie.tmdb_id) || normalizeTitleForLibrary(m.title) === normalizeTitleForLibrary(savedMovie.title)
          );
          if (existingIdx !== -1) {
            state.movies[existingIdx] = savedMovie;
            showToastNotification(`Zaktualizowano "${savedMovie.title}" w bibliotece! \u2728`);
          } else {
            state.movies.unshift(savedMovie);
            showToastNotification(`Zapisano "${savedMovie.title}" w bibliotece! \u{1F3AC}`);
          }
          if (state.mode === "movies") renderMovies();
          updateStats();
          saveLocalDatabase();
          if (window.updateAiCardBadges) {
            window.updateAiCardBadges(savedMovie.title, savedMovie.tmdb_id, savedMovie.status, savedMovie, "movie");
          }
          if (sheetAdd) sheetAdd.classList.remove("active");
        }
      } else {
        const episodesList = status === "watchlist" ? [] : Array.from(preAddWatchedSet).map((key) => {
          const [s, ep] = key.split("_");
          return { season: parseInt(s), episode: parseInt(ep) };
        });
        const payload = {
          title: currentPreviewData.title,
          poster_url: currentPreviewData.poster_url,
          status,
          rating,
          tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
          episodes_watched: episodesList
        };
        const res = await fetch("/api/shows/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const savedShow = await res.json();
          const existingIdx = state.shows.findIndex(
            (s) => s.uuid && s.uuid === savedShow.uuid || savedShow.tmdb_id && s.tmdb_id && String(s.tmdb_id) === String(savedShow.tmdb_id) || normalizeTitleForLibrary(s.title) === normalizeTitleForLibrary(savedShow.title)
          );
          if (existingIdx !== -1) {
            state.shows[existingIdx] = savedShow;
            showToastNotification(`Zaktualizowano "${savedShow.title}" w bibliotece! \u2728`);
          } else {
            state.shows.unshift(savedShow);
            showToastNotification(`Zapisano "${savedShow.title}" w bibliotece! \u{1F4FA}`);
          }
          if (state.mode === "shows") renderShows();
          updateStats();
          saveLocalDatabase();
          if (window.updateAiCardBadges) {
            window.updateAiCardBadges(savedShow.title, savedShow.tmdb_id, savedShow.status, savedShow, "series");
          }
          if (sheetAdd) sheetAdd.classList.remove("active");
        }
      }
    });
  }
}
window.setConfirmedType = setConfirmedType;
window.setConfirmedStatus = setConfirmedStatus;
window.setAddRating = setAddRating;

// static/js/modules/recommendations.js
var currentRecFilter = "all";
var rouletteSource = "watchlist";
var rouletteTime = "all";
var rouletteMood = "all";
var recFeedData = null;
var isRecLoading = false;
function initRouletteControls() {
  const hub = document.getElementById("m3-recommendations-container");
  if (!hub) return;
  hub.querySelectorAll("[data-roulette-source]").forEach((pill) => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-source]").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteSource = pill.getAttribute("data-roulette-source");
    };
  });
  hub.querySelectorAll("[data-roulette-time]").forEach((pill) => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-time]").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteTime = pill.getAttribute("data-roulette-time");
    };
  });
  hub.querySelectorAll("[data-roulette-mood]").forEach((pill) => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-mood]").forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteMood = pill.getAttribute("data-roulette-mood");
    };
  });
  const spinBtn = document.getElementById("m3-rec-roulette-spin-btn");
  if (spinBtn) {
    spinBtn.onclick = spinRoulette;
  }
}
async function spinRoulette() {
  const resultContainer = document.getElementById("m3-rec-roulette-result");
  const infoEl = document.getElementById("m3-rec-roulette-info");
  if (!resultContainer) return;
  infoEl.innerText = "Losuj\u0119 najlepszy seans...";
  resultContainer.style.display = "block";
  resultContainer.innerHTML = `
    <div class="m3-roulette-result-card" style="justify-content: center; padding: 24px;">
      <span class="material-symbols-rounded" style="font-size: 32px; animation: spin 0.8s linear infinite; color: var(--md-sys-color-primary);">casino</span>
      <span style="font-weight: 600; font-size: 0.9rem;">Wybieram idealny tytu\u0142...</span>
    </div>
  `;
  let candidates = [];
  const genresMap = {
    "romcom": "35,10749",
    "comedy": "35,10751",
    "crime": "80,9648",
    "thriller": "53,9648",
    "horror": "27,53",
    "scifi": "878,14",
    "action": "28,12",
    "animation": "16,10751",
    "drama": "18,36"
  };
  const genreParam = genresMap[rouletteMood] || "";
  if (rouletteSource === "watchlist" || rouletteSource === "planowane") {
    const plannedMovies = state.movies.filter((m) => m.status === "watchlist");
    const plannedShows = state.shows.filter((s) => s.status === "watchlist" || s.status === "watching");
    candidates = [...plannedMovies, ...plannedShows];
    if (candidates.length === 0) {
      candidates = [...state.movies, ...state.shows];
    }
  } else if (rouletteSource === "myvod") {
    try {
      const activePids = (state.userVodSubscriptions || []).map((s) => TMDB_GLOBAL_VOD_MAP[s]).filter(Boolean).join("|");
      let url = `/api/recommendations/discover?media_type=movie&min_vote_avg=6.8&min_vote_count=100`;
      if (genreParam) url += `&genres=${genreParam}`;
      if (activePids) {
        url += `&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      const raw = data.results || [];
      candidates = raw.filter((it) => !isItemInLibrary(it));
    } catch (e) {
      console.error("My VOD roulette error:", e);
    }
  } else {
    try {
      let url = `/api/recommendations/discover?media_type=movie&min_vote_avg=7.2&min_vote_count=150`;
      if (genreParam) url += `&genres=${genreParam}`;
      const res = await fetch(url);
      const data = await res.json();
      const raw = data.results || [];
      candidates = raw.filter((it) => !isItemInLibrary(it));
    } catch (e) {
      console.error("Discovery roulette error:", e);
    }
  }
  if (!candidates || candidates.length === 0) {
    infoEl.innerText = "Brak pasuj\u0105cych pozycji.";
    resultContainer.innerHTML = `
      <div class="m3-roulette-result-card">
        <span class="material-symbols-rounded" style="color: var(--md-sys-color-primary);">info</span>
        <span>Nie znaleziono pozycji w tej kategorii. Dodaj wi\u0119cej tytu\u0142\xF3w do listy Do obejrzenia lub spr\xF3buj innego nastroju!</span>
      </div>
    `;
    return;
  }
  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  infoEl.innerText = `Wylosowano z puli ${candidates.length} pozycji! \u{1F389}`;
  const isMovie = picked.type === "movie" || !picked.episodes_watched;
  const poster = picked.poster_url || "/static/icons/favicon.png";
  const title = picked.title || "Tytu\u0142";
  const year = picked.year || (picked.release_date ? picked.release_date.substring(0, 4) : "");
  const rating = picked.vote_average ? `${picked.vote_average}\u2605` : picked.rating ? `${picked.rating}\u2605` : "Brak oceny";
  const inLibrary = isItemInLibrary(picked);
  resultContainer.innerHTML = `
    <div class="m3-roulette-result-card">
      <div style="width: 85px; min-width: 85px; height: 120px; border-radius: 10px; overflow: hidden; background: #000; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        <img src="${poster}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; flex-grow: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="m3-meta-badge highlight" style="font-size: 0.7rem;">${isMovie ? "\u{1F3AC} FILM" : "\u{1F4FA} SERIAL"}</span>
          ${year ? `<span style="font-size: 0.78rem; font-weight: 600; color: var(--md-sys-color-on-surface-variant);">${year}</span>` : ""}
          <span style="font-size: 0.78rem; font-weight: 700; color: #f59e0b;">\u2605 ${rating}</span>
        </div>
        <h3 style="font-size: 1.05rem; font-weight: 800; margin: 0; color: var(--md-sys-color-on-surface);">${title}</h3>
        <p style="font-size: 0.78rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0;">
          ${picked.overview || picked.plot || "Znakomity wyb\xF3r na seans!"}
        </p>
        <div style="display: flex; gap: 8px; align-items: center; margin-top: 4px; flex-wrap: wrap;">
          ${!inLibrary ? `
            <button type="button" class="m3-btn-action-primary" id="m3-roulette-add-btn" style="padding: 6px 14px; font-size: 0.78rem; gap: 6px;">
              <span class="material-symbols-rounded" style="font-size: 16px;">bookmark</span> Dodaj do Do obejrzenia
            </button>
          ` : `
            <span class="m3-meta-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">
              <span class="material-symbols-rounded" style="font-size: 14px;">check</span> W Twojej bibliotece
            </span>
          `}
          <button type="button" class="m3-chip" id="m3-roulette-reroll-btn" style="padding: 6px 12px; font-size: 0.78rem; gap: 4px;">
            <span class="material-symbols-rounded" style="font-size: 16px;">refresh</span> Losuj inny
          </button>
        </div>
      </div>
    </div>
  `;
  const addBtn = document.getElementById("m3-roulette-add-btn");
  if (addBtn) {
    addBtn.onclick = () => quickAddToWatchlist2(picked, addBtn);
  }
  const rerollBtn = document.getElementById("m3-roulette-reroll-btn");
  if (rerollBtn) {
    rerollBtn.onclick = spinRoulette;
  }
}
function createRecommendationCard(item, matchPct = 96) {
  const card = document.createElement("div");
  card.className = "m3-rec-card";
  const poster = item.poster_url || "/static/icons/favicon.png";
  const title = item.title || "Tytu\u0142";
  const year = item.year || (item.release_date ? item.release_date.substring(0, 4) : "");
  const rating = item.vote_average ? `${item.vote_average}\u2605` : "7.5\u2605";
  card.innerHTML = `
    <div class="m3-rec-poster-box">
      <img src="${poster}" alt="${title}" loading="lazy">
      <span class="m3-rec-match-badge">${matchPct}% Zgodno\u015Bci</span>
      <button type="button" class="m3-rec-quick-add" title="Dodaj do Planowanych">
        <span class="material-symbols-rounded" style="font-size: 20px;">bookmark_add</span>
      </button>
    </div>
    <div class="m3-rec-info">
      <h4 class="m3-rec-title" title="${title}">${title}</h4>
      <div class="m3-rec-meta">
        ${year ? `<span>${year}</span>` : ""}
        <span>\u2022</span>
        <span class="m3-rec-rating-badge"><span class="material-symbols-rounded" style="font-size: 13px;">star</span> ${rating}</span>
      </div>
    </div>
  `;
  const addBtn = card.querySelector(".m3-rec-quick-add");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    quickAddToWatchlist2(item, addBtn);
  });
  card.addEventListener("click", () => {
    openRecPreview(item);
  });
  return card;
}
async function quickAddToWatchlist2(item, btnElement) {
  if (btnElement) {
    btnElement.disabled = true;
    btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px; animation: spin 1s linear infinite;">sync</span>`;
  }
  const isShow = item.type === "series" || item.media_type === "tv";
  const endpoint = isShow ? "/api/shows" : "/api/movies";
  const payload = isShow ? {
    title: item.title,
    poster_url: item.poster_url,
    status: "watchlist",
    rating: null,
    tmdb_id: item.tmdb_id || item.id,
    episodes_watched: []
  } : {
    title: item.title,
    poster_url: item.poster_url,
    release_date: item.release_date || (item.year ? `${item.year}-01-01` : null),
    status: "watchlist",
    rating: null,
    tmdb_id: item.tmdb_id || item.id,
    is_favorite: false
  };
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      const addedItem = await res.json();
      if (isShow) {
        state.shows.unshift(addedItem);
        renderShows();
      } else {
        state.movies.unshift(addedItem);
        renderMovies();
      }
      updateStats();
      saveLocalDatabase();
      if (btnElement) {
        btnElement.classList.add("added");
        btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">check</span>`;
        btnElement.title = "Dodano do listy Do obejrzenia!";
      }
      showToastNotification(`Dodano "${item.title}" do listy Do obejrzenia! \u{1F516}`);
    } else {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">bookmark_add</span>`;
      }
      showToastNotification("Nie uda\u0142o si\u0119 doda\u0107 pozycji do listy Do obejrzenia.", "error");
    }
  } catch (err) {
    console.error("Error adding rec item:", err);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">bookmark_add</span>`;
    }
  }
}
async function renderPreviewVod(title, mediaType, tmdbId = null) {
  const container = document.getElementById("m3-add-preview-vod-container");
  const loadingEl = document.getElementById("m3-add-preview-vod-loading");
  const listEl = document.getElementById("m3-add-preview-vod-list");
  const regionEl = document.getElementById("m3-add-preview-vod-region");
  if (!container || !listEl) return;
  if (regionEl) regionEl.innerText = getCountryDisplayName(state.userVodCountry);
  container.style.display = "block";
  if (loadingEl) loadingEl.style.display = "flex";
  listEl.innerHTML = "";
  try {
    const vodData = await getWatchProvidersForTitle(title, mediaType === "series" ? "tv" : "movie", tmdbId);
    if (loadingEl) loadingEl.style.display = "none";
    const flatrate = vodData.flatrate || [];
    const free = vodData.free || [];
    const rentBuy = [...vodData.rent || [], ...vodData.buy || []];
    const uniqueAll = [];
    const seen = /* @__PURE__ */ new Set();
    [...flatrate, ...free, ...rentBuy].forEach((p) => {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        uniqueAll.push(p);
      }
    });
    if (uniqueAll.length === 0) {
      listEl.innerHTML = `<span style="font-size: 0.76rem; color: var(--md-sys-color-on-surface-variant); opacity: 0.85;">Brak informacji o streamingu w ${getCountryDisplayName(state.userVodCountry)}</span>`;
    } else {
      uniqueAll.slice(0, 10).forEach((p) => {
        const badge = document.createElement("div");
        badge.className = "m3-preview-vod-badge";
        const logoImg = p.logo ? `<img src="${p.logo}" alt="${p.name}">` : "";
        badge.innerHTML = `${logoImg}<span>${p.name}</span>`;
        listEl.appendChild(badge);
      });
    }
  } catch (e) {
    if (loadingEl) loadingEl.style.display = "none";
    listEl.innerHTML = `<span style="font-size: 0.76rem; color: var(--md-sys-color-on-surface-variant);">Brak danych VOD</span>`;
  }
}
async function openRecPreview(item) {
  const isSeries = item.type === "series" || item.media_type === "tv";
  const sheetAdd = document.getElementById("m3-sheet-add");
  const stepSearch = document.getElementById("m3-add-step-search");
  const stepResults = document.getElementById("m3-add-step-results");
  const stepPreview = document.getElementById("m3-add-step-preview");
  if (sheetAdd) {
    if (stepSearch) stepSearch.style.display = "none";
    if (stepResults) stepResults.style.display = "none";
    if (stepPreview) stepPreview.style.display = "flex";
    sheetAdd.setAttribute("data-opened-from-rec", "true");
    await selectProductionDetail({
      tmdb_id: item.tmdb_id || item.id,
      title: item.title,
      year: item.year || (item.release_date ? item.release_date.substring(0, 4) : ""),
      type: isSeries ? "series" : "movie",
      poster_url: item.poster_url || "",
      overview: item.overview || item.plot || ""
    });
    renderPreviewVod(item.title, isSeries ? "tv" : "movie", item.tmdb_id || item.id);
    sheetAdd.classList.add("active");
  }
}
function buildCarouselSection(title, subtitle, iconName, items) {
  if (!items || items.length === 0) return null;
  const section = document.createElement("div");
  section.className = "m3-carousel-section";
  const header = document.createElement("div");
  header.className = "m3-carousel-header";
  header.innerHTML = `
    <div>
      <h3 class="m3-carousel-title">
        <span class="material-symbols-rounded" style="color: var(--md-sys-color-primary); font-size: 22px;">${iconName}</span>
        ${title}
      </h3>
      ${subtitle ? `<div class="m3-carousel-subtitle">${subtitle}</div>` : ""}
    </div>
  `;
  const trackWrapper = document.createElement("div");
  trackWrapper.className = "m3-carousel-track-wrapper";
  const track = document.createElement("div");
  track.className = "m3-carousel-track";
  items.forEach((item, idx) => {
    const matchScore = Math.min(99, Math.max(90, 99 - Math.floor(idx * 0.8)));
    const card = createRecommendationCard(item, matchScore);
    track.appendChild(card);
  });
  trackWrapper.appendChild(track);
  section.appendChild(header);
  section.appendChild(trackWrapper);
  return section;
}
async function renderAiMediaCards(containerEl, fullText) {
  if (!containerEl || !fullText) return;
  const items = await resolveMentionedMediaItems(fullText);
  if (!items || items.length === 0) {
    containerEl.innerHTML = "";
    return;
  }
  let html = `
    <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--md-sys-color-outline-variant);">
      <div style="font-size: 0.78rem; font-weight: 700; color: #a855f7; margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
        <span class="material-symbols-rounded" style="font-size: 16px;">movie</span>
        <span>Polecane i wspomniane tytu\u0142y (Kliknij kafelek, aby otworzy\u0107 podgl\u0105d):</span>
      </div>
      <div class="no-scrollbar" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch;">
  `;
  items.forEach(({ item, type, inLibrary }, index) => {
    const isMovie = type === "movie";
    const poster = item.poster_url || item.poster || "";
    const title = item.title || item.name || "";
    const year = item.year || (item.release_date ? item.release_date.substring(0, 4) : "");
    const rating = item.rating ? `${item.rating}\u2605` : item.vote_average ? `${item.vote_average}\u2605` : item.is_favorite ? "\u2764\uFE0F" : "";
    const gradient = getGradientForTitle(title);
    let statusBadge = "";
    if (inLibrary) {
      if (item.status === "watched") {
        statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(16,185,129,0.9); color: #fff; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">\u2713 Obejrzane</span>`;
      } else if (item.status === "watchlist") {
        statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(234,179,8,0.9); color: #000; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">\u{1F516} Na li\u015Bcie</span>`;
      }
    } else {
      statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(168,85,247,0.9); color: #fff; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">+ Zobacz</span>`;
    }
    html += `
      <div class="m3-ai-media-mini-card" data-card-idx="${index}" data-tmdb-id="${item.tmdb_id || item.id || ""}" style="flex: 0 0 115px; width: 115px; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column;">
        <div style="width: 100%; height: 145px; position: relative; background: ${gradient};">
          ${poster ? `<img src="${poster}" alt="${title}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">` : `<div style="display:flex; height:100%; align-items:center; justify-content:center; padding:6px; font-size:0.7rem; font-weight:700; text-align:center; color:#fff;">${title}</div>`}
          ${rating ? `<span style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.75); color: #fbbf24; font-size: 0.68rem; font-weight: 800; padding: 1px 5px; border-radius: 6px;">${rating}</span>` : ""}
          <span style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.75); color: #e2e8f0; font-size: 0.62rem; font-weight: 700; padding: 1px 4px; border-radius: 4px;">${isMovie ? "Film" : "Serial"}</span>
          ${statusBadge}
        </div>
        <div style="padding: 6px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 0.75rem; font-weight: 700; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${title}">${title}</div>
          <div style="font-size: 0.65rem; color: var(--md-sys-color-on-surface-variant);">${year || (isMovie ? "Film" : "Serial")}</div>
        </div>
      </div>
    `;
  });
  html += `
      </div>
    </div>
  `;
  containerEl.innerHTML = html;
  containerEl.querySelectorAll(".m3-ai-media-mini-card").forEach((card) => {
    card.onclick = () => {
      const idx = parseInt(card.getAttribute("data-card-idx"), 10);
      const entry = items[idx];
      if (!entry) return;
      if (entry.inLibrary) {
        if (entry.type === "movie") {
          openMovieDetail(entry.item);
        } else {
          openEpisodeTracker(entry.item);
        }
      } else {
        openRecPreview(entry.item);
      }
    };
  });
}
function updateAiCardBadges(title, tmdbId, status, savedItem, type) {
  const cards = document.querySelectorAll(".m3-ai-media-mini-card");
  const normTitle = (title || "").toLowerCase().trim();
  cards.forEach((card) => {
    const cardTitleEl = card.querySelector("[title]");
    const cardTitle = cardTitleEl ? cardTitleEl.getAttribute("title").toLowerCase().trim() : "";
    const cardTmdbId = card.getAttribute("data-tmdb-id");
    const isMatch = cardTmdbId && tmdbId && String(cardTmdbId) === String(tmdbId) || cardTitle && (cardTitle === normTitle || normTitle.includes(cardTitle) || cardTitle.includes(normTitle));
    if (isMatch) {
      const posterBox = card.querySelector("div[style*='height: 145px']");
      if (posterBox) {
        const oldBadge = posterBox.querySelector("span[style*='bottom: 4px; right: 4px']");
        if (oldBadge) oldBadge.remove();
        const newBadge = document.createElement("span");
        newBadge.style.cssText = "position: absolute; bottom: 4px; right: 4px; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;";
        if (status === "watched") {
          newBadge.style.background = "rgba(16,185,129,0.9)";
          newBadge.style.color = "#fff";
          newBadge.innerText = "\u2713 Obejrzane";
        } else {
          newBadge.style.background = "rgba(234,179,8,0.9)";
          newBadge.style.color = "#000";
          newBadge.innerText = "\u{1F516} Na li\u015Bcie";
        }
        posterBox.appendChild(newBadge);
      }
      card.onclick = () => {
        if (type === "movie") {
          openMovieDetail(savedItem);
        } else {
          openEpisodeTracker(savedItem);
        }
      };
    }
  });
}
window.updateAiCardBadges = updateAiCardBadges;
var curatorConversation = [];
function initAiCuratorControls() {
  const inputEl = document.getElementById("m3-rec-ai-input");
  const sendBtn = document.getElementById("m3-rec-ai-send-btn");
  const threadEl = document.getElementById("m3-rec-ai-chat-thread");
  const resetBtn = document.getElementById("m3-rec-btn-reset-ai");
  const chips = document.querySelectorAll("#m3-rec-ai-quick-chips [data-ai-prompt]");
  if (!inputEl || !sendBtn || !threadEl) return;
  const resetChat = () => {
    curatorConversation = [];
    threadEl.innerHTML = "";
    threadEl.style.display = "none";
    if (resetBtn) resetBtn.style.display = "none";
    if (inputEl) inputEl.value = "";
  };
  if (resetBtn) {
    resetBtn.onclick = resetChat;
  }
  const sendUserMessage = async (promptType, customText = "") => {
    if (!isAiConfigured()) {
      showToastNotification("Aby korzysta\u0107 z Filmowego Asystenta AI, najpierw skonfiguruj sw\xF3j klucz API.", "info");
      openCloudSyncModal("ai");
      return;
    }
    let userPrompt = customText;
    let isSpecialDna = false;
    if (promptType === "dna") {
      isSpecialDna = true;
      userPrompt = "Stw\xF3rz profil DNA mojego gustu filmowego na podstawie moich ocen.";
    } else if (promptType === "binge90") {
      userPrompt = "Mam dok\u0142adnie 90 minut wolnego czasu. Pole\u0107 mi 2-3 zwi\u0119z\u0142e, znakomite pozycje zoptymalizowane pod ten czas.";
    } else if (promptType === "gems") {
      userPrompt = "Pole\u0107 mi 3 niedocenione pere\u0142ki (Hidden Gems) z moich platform VOD, kt\xF3re idealnie pasuj\u0105 do mojego profilu ocen.";
    } else if (promptType === "dark") {
      userPrompt = "Szukam czego\u015B g\u0119stego, mrocznego, trzymaj\u0105cego w napi\u0119ciu do ostatniej sekundy.";
    } else if (promptType === "binge_marathon") {
      userPrompt = "U\u0142\xF3\u017C mi idealny plan maratonu filmowego na 4-6 godzin z moich platform VOD. Po\u0142\u0105cz powi\u0105zane ze sob\u0105 klimatycznie filmy w logicznej kolejno\u015Bci ogl\u0105dania.";
    } else if (promptType === "vibe_search") {
      userPrompt = "Szukam filmu o unikalnym klimacie: deszczowe miasto noc\u0105, neony, melancholia, samotno\u015B\u0107 i hipnotyzuj\u0105ca muzyka (styl Blade Runner, Drive, Lost in Translation).";
    }
    if (!userPrompt || !userPrompt.trim()) return;
    inputEl.value = "";
    threadEl.style.display = "flex";
    if (resetBtn) resetBtn.style.display = "inline-flex";
    const userBubble = document.createElement("div");
    userBubble.style.cssText = "align-self: flex-end; max-width: 85%; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); padding: 10px 14px; border-radius: 16px 16px 4px 16px; font-size: 0.84rem; font-weight: 500; word-break: break-word;";
    userBubble.innerText = userPrompt;
    threadEl.appendChild(userBubble);
    const msgId = "rec-ai-msg-" + Date.now();
    const assistantBubble = document.createElement("div");
    assistantBubble.style.cssText = "align-self: flex-start; width: 100%; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 16px 16px 16px 4px; padding: 14px; font-size: 0.84rem; line-height: 1.55; color: var(--md-sys-color-on-surface); display: flex; flex-direction: column; gap: 8px;";
    assistantBubble.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--md-sys-color-outline-variant); padding-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #a855f7;">
          <span class="material-symbols-rounded" style="font-size: 18px;">auto_awesome</span>
          <span>Filmowy Asystent AI</span>
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <button type="button" class="m3-chip" id="collapse-${msgId}" style="font-size: 0.72rem; padding: 2px 8px; gap: 4px; display: inline-flex; align-items: center;" title="Rozwi\u0144 / Zwi\u0144 tekst">
            <span class="material-symbols-rounded" id="collapse-icon-${msgId}" style="font-size: 14px;">unfold_more</span>
            <span id="collapse-text-${msgId}">Rozwi\u0144</span>
          </button>
          <button type="button" class="m3-chip" id="copy-${msgId}" style="font-size: 0.72rem; padding: 2px 8px; gap: 4px; display: inline-flex; align-items: center;" title="Kopiuj do schowka">
            <span class="material-symbols-rounded" style="font-size: 14px;">content_copy</span>
            <span>Kopiuj</span>
          </button>
        </div>
      </div>
      <details class="m3-ai-thought-accordion" id="thought-${msgId}" style="display: none; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); border-radius: 8px; padding: 6px 10px; font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant);">
        <summary style="cursor: pointer; font-weight: 700; color: #a855f7; display: flex; align-items: center; gap: 6px; user-select: none;">
          <span class="material-symbols-rounded" style="font-size: 16px;">psychology</span>
          <span>Tok my\u015Blenia modelu AI (<span id="count-${msgId}">0 s\u0142\xF3w</span>)</span>
        </summary>
        <div id="text-${msgId}" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(168, 85, 247, 0.15); line-height: 1.45; font-style: italic; white-space: pre-wrap; max-height: 120px; overflow-y: auto;"></div>
      </details>
      <div id="content-${msgId}" style="line-height: 1.6; max-height: 95px; overflow-y: auto; position: relative; mask-image: linear-gradient(to bottom, black 50%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%); transition: max-height 0.25s ease;">
        <div style="display: flex; align-items: center; gap: 8px; color: #a855f7;">
          <span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 18px;">auto_awesome</span>
          <span style="font-weight: 600;">Asystent pisze odpowied\u017A...</span>
        </div>
      </div>
      <div id="cards-${msgId}"></div>
    `;
    threadEl.appendChild(assistantBubble);
    threadEl.scrollTop = threadEl.scrollHeight;
    const contentEl = document.getElementById(`content-${msgId}`);
    const thoughtBox = document.getElementById(`thought-${msgId}`);
    const thoughtTextEl = document.getElementById(`text-${msgId}`);
    const thoughtCountEl = document.getElementById(`count-${msgId}`);
    const cardsEl = document.getElementById(`cards-${msgId}`);
    const copyBtn = document.getElementById(`copy-${msgId}`);
    const collapseBtn = document.getElementById(`collapse-${msgId}`);
    const collapseIcon = document.getElementById(`collapse-icon-${msgId}`);
    const collapseText = document.getElementById(`collapse-text-${msgId}`);
    let latestFullText = "";
    let isCollapsed = true;
    if (collapseBtn && contentEl) {
      collapseBtn.onclick = () => {
        isCollapsed = !isCollapsed;
        if (isCollapsed) {
          contentEl.style.maxHeight = "95px";
          contentEl.style.overflowY = "auto";
          contentEl.style.position = "relative";
          contentEl.style.maskImage = "linear-gradient(to bottom, black 50%, transparent 100%)";
          contentEl.style.webkitMaskImage = "linear-gradient(to bottom, black 50%, transparent 100%)";
          if (collapseIcon) collapseIcon.innerText = "unfold_more";
          if (collapseText) collapseText.innerText = "Rozwi\u0144";
        } else {
          contentEl.style.maxHeight = "none";
          contentEl.style.overflowY = "visible";
          contentEl.style.maskImage = "none";
          contentEl.style.webkitMaskImage = "none";
          if (collapseIcon) collapseIcon.innerText = "unfold_less";
          if (collapseText) collapseText.innerText = "Zwi\u0144";
        }
      };
    }
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (latestFullText) {
          navigator.clipboard.writeText(latestFullText).then(() => {
            showToastNotification("Skopiowano odpowied\u017A do schowka!", "success");
          }).catch(() => {
            showToastNotification("Nie uda\u0142o si\u0119 skopiowa\u0107 do schowka.", "error");
          });
        }
      };
    }
    const onToken = (delta, fullText) => {
      latestFullText = fullText;
      if (contentEl) {
        contentEl.innerHTML = formatAiMarkdown(fullText);
        if (isCollapsed) {
          contentEl.scrollTop = contentEl.scrollHeight;
        }
        threadEl.scrollTop = threadEl.scrollHeight;
      }
    };
    const onThought = (deltaThought, fullThoughtText) => {
      if (thoughtBox && thoughtTextEl) {
        thoughtBox.style.display = "block";
        thoughtTextEl.innerText = fullThoughtText;
        if (thoughtCountEl) {
          const words = fullThoughtText.trim().split(/\s+/).length;
          thoughtCountEl.innerText = `${words} s\u0142\xF3w`;
        }
      }
    };
    let messages = [];
    if (isSpecialDna) {
      const dna = buildTasteDnaPrompt();
      messages = [
        { role: "system", content: dna.systemPrompt },
        { role: "user", content: dna.userMessage }
      ];
    } else {
      const { injectedContext } = resolveMentionTags(userPrompt);
      const userPayloadContent = injectedContext ? `${userPrompt}

Kontekst wskazany przez u\u017Cytkownika:
${injectedContext}` : userPrompt;
      const systemPromptText = buildCuratorSystemPrompt(userPrompt);
      if (curatorConversation.length === 0) {
        curatorConversation.push({ role: "system", content: systemPromptText });
      } else {
        curatorConversation[0] = { role: "system", content: systemPromptText };
      }
      curatorConversation.push({ role: "user", content: userPayloadContent });
      messages = curatorConversation;
    }
    try {
      const answer = await streamAiChat({ messages, temperature: 0.7, max_tokens: 1800, onToken, onThought });
      if (!isSpecialDna) {
        curatorConversation.push({ role: "assistant", content: answer });
      }
      if (cardsEl && latestFullText) {
        await renderAiMediaCards(cardsEl, latestFullText);
        threadEl.scrollTop = threadEl.scrollHeight;
      }
    } catch (err) {
      if (contentEl) {
        contentEl.innerHTML = `<div style="color: var(--md-sys-color-error); font-weight: 600;">\u{1F534} B\u0142\u0105d AI: ${err.message}</div>`;
      }
    }
  };
  sendBtn.onclick = () => {
    const val = inputEl.value.trim();
    if (val) sendUserMessage("custom", val);
  };
  inputEl.onkeydown = (e) => {
    if (e.key === "Enter") {
      const val = inputEl.value.trim();
      if (val) sendUserMessage("custom", val);
    }
  };
  chips.forEach((chip) => {
    chip.onclick = () => {
      const pType = chip.getAttribute("data-ai-prompt");
      sendUserMessage(pType);
    };
  });
  const mentionChips = document.querySelectorAll("#m3-rec-ai-mention-chips [data-mention]");
  mentionChips.forEach((chip) => {
    chip.onclick = () => {
      const tag = chip.getAttribute("data-mention");
      if (!inputEl.value.includes(tag)) {
        inputEl.value = inputEl.value ? `${inputEl.value.trim()} ${tag} ` : `${tag} `;
      }
      inputEl.focus();
    };
  });
  const mentionDropdown = document.getElementById("m3-ai-mention-dropdown");
  let activeMentionIndex = -1;
  const updateMentionDropdown = () => {
    if (!mentionDropdown) return;
    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart || val.length;
    const textBeforeCursor = val.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\u00C0-\u017E\s]*)$/);
    if (!atMatch) {
      mentionDropdown.style.display = "none";
      activeMentionIndex = -1;
      return;
    }
    const query = atMatch[1].trim().toLowerCase();
    const suggestions = [];
    const defaultTags = [
      { tag: "@ulubione_filmy", displayTag: "@ulubione_filmy", desc: "Twoje najwy\u017Cej ocenione filmy", icon: "movie" },
      { tag: "@planowane_filmy", displayTag: "@planowane_filmy", desc: "Twoja lista film\xF3w do obejrzenia", icon: "bookmark" },
      { tag: "@obejrzane_filmy", displayTag: "@obejrzane_filmy", desc: "Wszystkie Twoje obejrzane filmy", icon: "check_circle" },
      { tag: "@ulubione_seriale", displayTag: "@ulubione_seriale", desc: "Twoje ulubione seriale", icon: "tv" },
      { tag: "@planowane_seriale", displayTag: "@planowane_seriale", desc: "Twoja lista seriali do obejrzenia", icon: "bookmark" },
      { tag: "@obejrzane_seriale", displayTag: "@obejrzane_seriale", desc: "Wszystkie Twoje obejrzane seriale", icon: "check_circle" }
    ];
    defaultTags.forEach((t) => {
      if (!query || t.tag.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query)) {
        suggestions.push(t);
      }
    });
    if (query) {
      const matchingMovies = (state.movies || []).filter((m) => (m.title || "").toLowerCase().includes(query)).slice(0, 5).map((m) => {
        const hasSpecial = m.title.includes(" ") || m.title.includes(",") || m.title.includes(".") || m.title.includes("-");
        const insertTag = hasSpecial ? `@"${m.title}"` : `@${m.title}`;
        const yearStr = m.year ? ` (${m.year})` : "";
        const statusStr = m.status === "watched" ? "Obejrzany" : "Planowany";
        return {
          tag: insertTag,
          displayTag: `@${m.title}`,
          desc: `Film${yearStr} \u2022 ${statusStr}`,
          icon: "movie"
        };
      });
      const matchingShows = (state.shows || []).filter((s) => (s.title || "").toLowerCase().includes(query)).slice(0, 5).map((s) => {
        const hasSpecial = s.title.includes(" ") || s.title.includes(",") || s.title.includes(".") || s.title.includes("-");
        const insertTag = hasSpecial ? `@"${s.title}"` : `@${s.title}`;
        const yearStr = s.year ? ` (${s.year})` : "";
        const statusStr = s.status === "watched" ? "Uko\u0144czony" : "Planowany";
        return {
          tag: insertTag,
          displayTag: `@${s.title}`,
          desc: `Serial${yearStr} \u2022 ${statusStr}`,
          icon: "tv"
        };
      });
      suggestions.push(...matchingMovies, ...matchingShows);
    }
    if (suggestions.length === 0) {
      mentionDropdown.style.display = "none";
      activeMentionIndex = -1;
      return;
    }
    const inputRect = inputEl.getBoundingClientRect();
    const spaceAbove = inputRect.top;
    const spaceBelow = window.innerHeight - inputRect.bottom;
    const placeAbove = spaceBelow < 180 && spaceAbove >= 200;
    if (placeAbove) {
      mentionDropdown.style.top = "auto";
      mentionDropdown.style.bottom = "100%";
      mentionDropdown.style.marginTop = "0";
      mentionDropdown.style.marginBottom = "8px";
      const maxH = Math.min(220, Math.max(120, spaceAbove - 20));
      mentionDropdown.style.maxHeight = `${maxH}px`;
    } else {
      mentionDropdown.style.bottom = "auto";
      mentionDropdown.style.top = "100%";
      mentionDropdown.style.marginTop = "8px";
      mentionDropdown.style.marginBottom = "0";
      const maxH = Math.min(240, Math.max(120, spaceBelow - 20));
      mentionDropdown.style.maxHeight = `${maxH}px`;
    }
    mentionDropdown.innerHTML = suggestions.slice(0, 8).map((s, idx) => `
      <div class="m3-mention-item" data-mention-tag="${s.tag}" data-mention-idx="${idx}" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; cursor: pointer; transition: background 0.15s ease; font-size: 0.8rem;">
        <span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-sys-color-primary); flex-shrink: 0;">${s.icon}</span>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 700; color: var(--md-sys-color-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.displayTag}</div>
          <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.desc}</div>
        </div>
      </div>
    `).join("");
    mentionDropdown.style.display = "flex";
    mentionDropdown.style.flexDirection = "column";
    mentionDropdown.style.gap = "2px";
    activeMentionIndex = -1;
    const selectItem = (chosenTag) => {
      const beforeAt = textBeforeCursor.substring(0, atMatch.index);
      const afterCursor = val.substring(cursorPos);
      inputEl.value = `${beforeAt}${chosenTag} ${afterCursor}`;
      mentionDropdown.style.display = "none";
      activeMentionIndex = -1;
      inputEl.focus();
    };
    mentionDropdown.querySelectorAll(".m3-mention-item").forEach((item) => {
      item.onclick = (e) => {
        e.preventDefault();
        const chosenTag = item.getAttribute("data-mention-tag");
        selectItem(chosenTag);
      };
      item.onmouseenter = () => {
        item.style.background = "var(--md-sys-color-surface-container-highest)";
      };
      item.onmouseleave = () => {
        item.style.background = "transparent";
      };
    });
  };
  inputEl.addEventListener("input", updateMentionDropdown);
  inputEl.addEventListener("click", updateMentionDropdown);
  inputEl.addEventListener("keydown", (e) => {
    if (!mentionDropdown || mentionDropdown.style.display === "none") return;
    const items = mentionDropdown.querySelectorAll(".m3-mention-item");
    if (!items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex + 1) % items.length;
      items.forEach((it, i) => {
        it.style.background = i === activeMentionIndex ? "var(--md-sys-color-surface-container-highest)" : "transparent";
      });
      items[activeMentionIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => {
        it.style.background = i === activeMentionIndex ? "var(--md-sys-color-surface-container-highest)" : "transparent";
      });
      items[activeMentionIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && activeMentionIndex >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      const chosenTag = items[activeMentionIndex]?.getAttribute("data-mention-tag");
      if (chosenTag) {
        const val = inputEl.value;
        const cursorPos = inputEl.selectionStart || val.length;
        const textBeforeCursor = val.substring(0, cursorPos);
        const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\u00C0-\u017E\s]*)$/);
        if (atMatch) {
          const beforeAt = textBeforeCursor.substring(0, atMatch.index);
          const afterCursor = val.substring(cursorPos);
          inputEl.value = `${beforeAt}${chosenTag} ${afterCursor}`;
        }
        mentionDropdown.style.display = "none";
        activeMentionIndex = -1;
      }
    } else if (e.key === "Escape") {
      mentionDropdown.style.display = "none";
      activeMentionIndex = -1;
    }
  });
  document.addEventListener("click", (e) => {
    if (mentionDropdown && !mentionDropdown.contains(e.target) && e.target !== inputEl) {
      mentionDropdown.style.display = "none";
      activeMentionIndex = -1;
    }
  });
}
async function loadRecommendationsHub(forceRefresh = false) {
  const hub = document.getElementById("m3-rec-carousels-hub");
  if (!hub) return;
  initRouletteControls();
  initAiCuratorControls();
  const filterBtns = document.querySelectorAll("[data-rec-filter]");
  const refreshBtn = document.getElementById("m3-rec-refresh-btn");
  filterBtns.forEach((btn) => {
    btn.onclick = () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentRecFilter = btn.getAttribute("data-rec-filter");
      renderRecommendationsFeed();
    };
  });
  if (refreshBtn) {
    refreshBtn.onclick = () => loadRecommendationsHub(true);
  }
  if (recFeedData && !forceRefresh) {
    renderRecommendationsFeed();
    return;
  }
  isRecLoading = true;
  hub.innerHTML = `
    <div style="text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
      <span class="material-symbols-rounded" style="font-size: 44px; animation: spin 1s linear infinite; color: var(--md-sys-color-primary);">auto_awesome</span>
      <p style="margin-top: 14px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Generuj\u0119 spersonalizowane rekomendacje...</p>
      <p style="font-size: 0.82rem; opacity: 0.8; margin-top: 4px;">Analizuj\u0119 Twoje oceny 5\u2605, ulubione gatunki i trendy TMDb</p>
    </div>
  `;
  try {
    const fiveStarMovies = state.movies.filter((m) => m.rating === 5 || m.is_favorite);
    const fiveStarShows = state.shows.filter((s) => s.rating === 5 || s.is_favorite);
    const activeShows = state.shows.filter((s) => s.status === "watching" || s.watched_count > 0 && s.status !== "watched");
    const shuffledFavMovies = [...fiveStarMovies].sort(() => 0.5 - Math.random());
    const seedMovie1 = shuffledFavMovies[0] || state.movies[0] || null;
    const seedMovie2 = shuffledFavMovies[1] || (state.movies.length > 1 ? state.movies[1] : null);
    const seedShow1 = activeShows[0] || fiveStarShows[0] || state.shows[0] || null;
    const seedShow2 = activeShows.length > 1 ? activeShows[1] : fiveStarShows.length > 1 ? fiveStarShows[1] : null;
    const promises = [];
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&sort_by=popularity.desc&min_vote_avg=6.4&min_vote_count=200`).then((r) => r.json()).then((d) => ({ key: "popular_trending", results: d.results || [] })).catch(() => ({ key: "popular_trending", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/trending?media_type=all&time_window=week`).then((r) => r.json()).then((d) => ({ key: "trending_week", results: d.results || [] })).catch(() => ({ key: "trending_week", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&sort_by=vote_average.desc&min_vote_avg=8.3&min_vote_count=1200`).then((r) => r.json()).then((d) => ({ key: "top_classics", results: d.results || [] })).catch(() => ({ key: "top_classics", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=100&max_vote_count=2500`).then((r) => r.json()).then((d) => ({ key: "hidden_gems", results: d.results || [] })).catch(() => ({ key: "hidden_gems", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&genres=9648,53&sort_by=vote_average.desc&min_vote_avg=7.4&min_vote_count=350`).then((r) => r.json()).then((d) => ({ key: "mind_bending", results: d.results || [] })).catch(() => ({ key: "mind_bending", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=tv&sort_by=vote_average.desc&min_vote_avg=8.0&min_vote_count=120`).then((r) => r.json()).then((d) => ({ key: "binge_miniseries", results: d.results || [] })).catch(() => ({ key: "binge_miniseries", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&year_gte=1980&year_lte=1999&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=600`).then((r) => r.json()).then((d) => ({ key: "nostalgia_classics", results: d.results || [] })).catch(() => ({ key: "nostalgia_classics", results: [] }))
    );
    promises.push(
      fetch(`/api/recommendations/discover?media_type=movie&sort_by=popularity.desc&date_gte=2026-02-01&date_lte=2026-08-12&min_vote_avg=6.4&min_vote_count=80`).then((r) => r.json()).then((d) => ({ key: "vod_fresh", results: d.results || [] })).catch(() => ({ key: "vod_fresh", results: [] }))
    );
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=35,10749&sort_by=vote_average.desc&min_vote_avg=6.8&min_vote_count=150`).then((r) => r.json()).then((d) => ({ key: "genre_romcom", results: d.results || [] })).catch(() => ({ key: "genre_romcom", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=35&sort_by=vote_average.desc&min_vote_avg=7.1&min_vote_count=250`).then((r) => r.json()).then((d) => ({ key: "genre_comedy", results: d.results || [] })).catch(() => ({ key: "genre_comedy", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=80,9648&sort_by=vote_average.desc&min_vote_avg=7.4&min_vote_count=300`).then((r) => r.json()).then((d) => ({ key: "genre_crime", results: d.results || [] })).catch(() => ({ key: "genre_crime", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=53,9648&sort_by=popularity.desc&min_vote_avg=7.2&min_vote_count=300`).then((r) => r.json()).then((d) => ({ key: "genre_thriller", results: d.results || [] })).catch(() => ({ key: "genre_thriller", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=27,53&sort_by=vote_average.desc&min_vote_avg=6.8&min_vote_count=200`).then((r) => r.json()).then((d) => ({ key: "genre_horror", results: d.results || [] })).catch(() => ({ key: "genre_horror", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=878,14&sort_by=vote_average.desc&min_vote_avg=7.2&min_vote_count=350`).then((r) => r.json()).then((d) => ({ key: "genre_scifi", results: d.results || [] })).catch(() => ({ key: "genre_scifi", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=28,12&sort_by=vote_average.desc&min_vote_avg=7.3&min_vote_count=400`).then((r) => r.json()).then((d) => ({ key: "genre_action", results: d.results || [] })).catch(() => ({ key: "genre_action", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=16&sort_by=vote_average.desc&min_vote_avg=7.6&min_vote_count=300`).then((r) => r.json()).then((d) => ({ key: "genre_animation", results: d.results || [] })).catch(() => ({ key: "genre_animation", results: [] })));
    promises.push(fetch(`/api/recommendations/discover?media_type=movie&genres=18&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=350`).then((r) => r.json()).then((d) => ({ key: "genre_drama", results: d.results || [] })).catch(() => ({ key: "genre_drama", results: [] })));
    if (seedMovie1) {
      promises.push(fetch(`/api/recommendations/for_item?media_type=movie&title=${encodeURIComponent(seedMovie1.title)}`).then((r) => r.json()).then((d) => ({ key: "seed_movie_1", title: seedMovie1.title, results: d.results || [] })).catch(() => ({ key: "seed_movie_1", results: [] })));
    }
    if (seedMovie2 && seedMovie2.title !== (seedMovie1 && seedMovie1.title)) {
      promises.push(fetch(`/api/recommendations/for_item?media_type=movie&title=${encodeURIComponent(seedMovie2.title)}`).then((r) => r.json()).then((d) => ({ key: "seed_movie_2", title: seedMovie2.title, results: d.results || [] })).catch(() => ({ key: "seed_movie_2", results: [] })));
    }
    if (seedShow1) {
      promises.push(fetch(`/api/recommendations/for_item?media_type=tv&title=${encodeURIComponent(seedShow1.title)}`).then((r) => r.json()).then((d) => ({ key: "seed_show_1", title: seedShow1.title, results: d.results || [] })).catch(() => ({ key: "seed_show_1", results: [] })));
    }
    if (seedShow2 && seedShow2.title !== (seedShow1 && seedShow1.title)) {
      promises.push(fetch(`/api/recommendations/for_item?media_type=tv&title=${encodeURIComponent(seedShow2.title)}`).then((r) => r.json()).then((d) => ({ key: "seed_show_2", title: seedShow2.title, results: d.results || [] })).catch(() => ({ key: "seed_show_2", results: [] })));
    }
    const activePids = (state.userVodSubscriptions || []).map((s) => TMDB_GLOBAL_VOD_MAP[s]).filter(Boolean).join("|");
    if (activePids) {
      promises.push(fetch(`/api/recommendations/discover?media_type=movie&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}&sort_by=popularity.desc&min_vote_avg=7.0&min_vote_count=150`).then((r) => r.json()).then((d) => ({ key: "myvod_hits", results: d.results || [] })).catch(() => ({ key: "myvod_hits", results: [] })));
      promises.push(fetch(`/api/recommendations/discover?media_type=tv&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}&sort_by=popularity.desc&min_vote_avg=7.6&min_vote_count=150`).then((r) => r.json()).then((d) => ({ key: "myvod_shows", results: d.results || [] })).catch(() => ({ key: "myvod_shows", results: [] })));
    }
    const responses = await Promise.all(promises);
    recFeedData = {};
    responses.forEach((item) => {
      recFeedData[item.key] = item;
    });
    renderRecommendationsFeed();
  } catch (err) {
    console.error("Error loading recommendations hub:", err);
    hub.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 36px; color: var(--md-sys-color-error);">error</span>
        <p style="margin-top: 8px;">Nie uda\u0142o si\u0119 wczyta\u0107 rekomendacji. Sprawd\u017A po\u0142\u0105czenie z internetem.</p>
        <button type="button" class="m3-btn-action-primary" onclick="loadRecommendationsHub(true)" style="margin-top: 12px;">Spr\xF3buj ponownie</button>
      </div>
    `;
  }
}
function renderRecommendationsFeed() {
  const hub = document.getElementById("m3-rec-carousels-hub");
  if (!hub || !recFeedData) return;
  hub.innerHTML = "";
  if (currentRecFilter === "myvod" || currentRecFilter === "all") {
    if (currentRecFilter === "myvod" && (!state.userVodSubscriptions || state.userVodSubscriptions.length === 0)) {
      const banner = document.createElement("div");
      banner.style.cssText = "text-align: center; padding: 40px 20px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container); border-radius: var(--md-corner-large); border: 1px solid var(--md-sys-color-outline-variant); margin-bottom: 20px;";
      banner.innerHTML = `
        <span class="material-symbols-rounded" style="font-size: 40px; color: var(--md-sys-color-primary);">subscriptions</span>
        <p style="margin-top: 10px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Brak wybranych platform VOD</p>
        <p style="font-size: 0.82rem; margin-top: 4px; max-width: 500px; margin-inline: auto;">Otw\xF3rz <b>Ustawienia VOD i Kraj</b> i zaznacz serwisy, kt\xF3re subskrybujesz, aby widzie\u0107 propozycje dost\u0119pne na Twoich VOD.</p>
      `;
      hub.appendChild(banner);
    } else {
      if (recFeedData.myvod_hits && recFeedData.myvod_hits.results && recFeedData.myvod_hits.results.length > 0) {
        const raw = recFeedData.myvod_hits.results || [];
        const filtered = raw.filter((it) => !isItemInLibrary(it));
        const section = buildCarouselSection(
          "\u2B50 Hity filmowe na Twoich VOD",
          `Wybitne i najpopularniejsze filmy dost\u0119pne w Twoich subskrypcjach (${(state.userVodSubscriptions || []).join(", ")})`,
          "star",
          filtered
        );
        if (section) hub.appendChild(section);
      }
      if (recFeedData.myvod_shows && recFeedData.myvod_shows.results && recFeedData.myvod_shows.results.length > 0) {
        const raw = recFeedData.myvod_shows.results || [];
        const filtered = raw.filter((it) => !isItemInLibrary(it));
        const section = buildCarouselSection(
          "\u{1F4FA} Najlepsze seriale na Twoich VOD",
          "Wci\u0105gaj\u0105ce seriale z ocen\u0105 powy\u017Cej 7.6\u2605 dost\u0119pne w Twoich serwisach streamingowych",
          "tv",
          filtered
        );
        if (section) hub.appendChild(section);
      }
    }
  }
  if (recFeedData.seed_movie_1 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "movies")) {
    const raw = recFeedData.seed_movie_1.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      `Bo uwielbiasz film: ${recFeedData.seed_movie_1.title}`,
      "Produkcje o zbli\u017Conym klimacie, motywach i fabule dopasowane do Twojej oceny",
      "favorite",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.seed_movie_2 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "movies")) {
    const raw = recFeedData.seed_movie_2.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      `Bo podoba\u0142 Ci si\u0119 film: ${recFeedData.seed_movie_2.title}`,
      "Tytu\u0142y polecane przez widz\xF3w o podobnym gu\u015Bcie filmowym",
      "movie",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.seed_show_1 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "shows")) {
    const raw = recFeedData.seed_show_1.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      `Bo ogl\u0105dasz serial: ${recFeedData.seed_show_1.title}`,
      "Seriale polecane fanom tego tytu\u0142u",
      "live_tv",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.popular_trending && (currentRecFilter === "all" || currentRecFilter === "popular" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.popular_trending.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F525} Najpopularniejsze teraz",
      "Najch\u0119tniej ogl\u0105dane i najg\u0142o\u015Bniejsze produkcje filmowe na \u015Bwiecie",
      "whatshot",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.trending_week && (currentRecFilter === "all" || currentRecFilter === "popular" || currentRecFilter === "trending" || currentRecFilter === "myvod")) {
    const raw = recFeedData.trending_week.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u26A1 Trendy tygodnia",
      "Produkcje, o kt\xF3rych jest najg\u0142o\u015Bniej w ostatnich 7 dniach",
      "bolt",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_romcom && (currentRecFilter === "all" || currentRecFilter === "romcom" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_romcom.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u2764\uFE0F Komedie romantyczne & Ciep\u0142e historie",
      "Czaruj\u0105ce historie mi\u0142osne, urok i lekki humor z najwy\u017Cszymi ocenami widz\xF3w",
      "favorite",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_comedy && (currentRecFilter === "all" || currentRecFilter === "comedy" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_comedy.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F602} Komedie & Lekki humor",
      "B\u0142yskotliwe, kultowe komedie, kt\xF3re gwarantuj\u0105 mn\xF3stwo dobrego humoru",
      "sentiment_very_satisfied",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_crime && (currentRecFilter === "all" || currentRecFilter === "crime" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_crime.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F575}\uFE0F Mroczne krymina\u0142y & \u015Aledztwa",
      "Z\u0142o\u017Cone zagadki detektywistyczne, kino gangsterskie i policyjne intrygi",
      "local_police",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_thriller && (currentRecFilter === "all" || currentRecFilter === "thriller" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_thriller.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F525} Psychologiczne thrillery & Dreszczowce",
      "G\u0119sty klimat, tajemnice i nieprzewidywalne napi\u0119cie do ostatniej minuty",
      "crisis_alert",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_horror && (currentRecFilter === "all" || currentRecFilter === "horror" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_horror.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F631} Horrory & Groza",
      "Kino grozy, skoki adrenaliny i mro\u017C\u0105ce krew w \u017Cy\u0142ach historie",
      "local_fire_department",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_scifi && (currentRecFilter === "all" || currentRecFilter === "scifi" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_scifi.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F680} Sci-Fi & Epickie fantasy",
      "Niezwyk\u0142e \u015Bwiaty, kosmiczne podr\xF3\u017Ce i technologiczne wizje przysz\u0142o\u015Bci",
      "rocket_launch",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_action && (currentRecFilter === "all" || currentRecFilter === "action" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_action.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F4A5} Epickie kino akcji & Przygody",
      "Widowiskowe po\u015Bcigi, walki i pe\u0142ne adrenaliny przygody filmowe",
      "sports_martial_arts",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_animation && (currentRecFilter === "all" || currentRecFilter === "animation" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_animation.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u2728 Magiczne animacje dla ka\u017Cdego",
      "Arcydzie\u0142a animacji \u2013 zachwycaj\u0105ce pere\u0142ki od studia Ghibli po Pixara",
      "palette",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.genre_drama && (currentRecFilter === "all" || currentRecFilter === "drama" || currentRecFilter === "movies" || currentRecFilter === "myvod")) {
    const raw = recFeedData.genre_drama.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F3AD} Poruszaj\u0105ce dramaty & Wielkie emocje",
      "G\u0142\u0119bokie, nagradzane historie i wybitne kreacje aktorskie",
      "theater_comedy",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.top_classics && (currentRecFilter === "all" || currentRecFilter === "classics" || currentRecFilter === "movies")) {
    const raw = recFeedData.top_classics.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F3C6} IMDb Top Arcydzie\u0142a",
      "Najwy\u017Cej oceniane filmy wszech czas\xF3w o statusie legendy kina",
      "military_tech",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.hidden_gems && (currentRecFilter === "all" || currentRecFilter === "gems" || currentRecFilter === "movies")) {
    const raw = recFeedData.hidden_gems.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F48E} Ukryte pere\u0142ki (Hidden Gems)",
      "Wybitne kino niezale\u017Cne i festiwalowe o rewelacyjnych ocenach widz\xF3w",
      "diamond",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.mind_bending && (currentRecFilter === "all" || currentRecFilter === "gems" || currentRecFilter === "thriller" || currentRecFilter === "movies")) {
    const raw = recFeedData.mind_bending.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F92F} Szokuj\u0105ce zako\u0144czenia & Mind-Bending",
      "Tajemnice, psychologiczne \u0142amig\u0142\xF3wki i nieprzewidywalne zwroty akcji",
      "psychology",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.binge_miniseries && (currentRecFilter === "all" || currentRecFilter === "shows")) {
    const raw = recFeedData.binge_miniseries.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F37F} Binge-worthy: Miniseriale na weekend",
      "Wci\u0105gaj\u0105ce, zamkni\u0119te historie z ocen\u0105 powy\u017Cej 8.0\u2605 do obejrzenia w kilka wieczor\xF3w",
      "play_circle",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.nostalgia_classics && (currentRecFilter === "all" || currentRecFilter === "classics" || currentRecFilter === "movies")) {
    const raw = recFeedData.nostalgia_classics.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F4FC} Z\u0142ota era lat 80. i 90. (Kultowa Nostalgia)",
      "Niezapomniane hity ery VHS i pocz\u0105tk\xF3w kina cyfrowego",
      "history",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.vod_fresh && (currentRecFilter === "all" || currentRecFilter === "vod_fresh" || currentRecFilter === "movies")) {
    const raw = recFeedData.vod_fresh.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "\u{1F680} \u015Awie\u017Co po kinach \u2013 nowe hity na VOD",
      "Filmy, kt\xF3re niedawno zesz\u0142y z ekran\xF3w kinowych i trafi\u0142y do streamingu",
      "theaters",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.top_movies && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "movies")) {
    const raw = recFeedData.top_movies.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "Specjalnie dla Ciebie",
      "Wysoko oceniane filmy dopasowane do Twoich najwy\u017Cszych ocen",
      "auto_awesome",
      filtered
    );
    if (section) hub.appendChild(section);
  }
  if (recFeedData.top_shows && (currentRecFilter === "all" || currentRecFilter === "shows")) {
    const raw = recFeedData.top_shows.results || [];
    const filtered = raw.filter((it) => !isItemInLibrary(it));
    const section = buildCarouselSection(
      "Najlepsze Seriale",
      "Seriale z najwy\u017Cszymi ocenami widz\xF3w na ca\u0142ym \u015Bwiecie",
      "tv",
      filtered
    );
    if (section) hub.appendChild(section);
  }
}
window.loadRecommendationsHub = loadRecommendationsHub;
window.openRecPreview = openRecPreview;
window.openPreviewVod = renderPreviewVod;

// static/js/modules/upcoming.js
var upcomingData = [];
var upcomingFilter = "all";
var isUpcomingLoading = false;
async function loadUpcomingData(forceRefresh = false) {
  const contentEl = document.getElementById("m3-upcoming-content");
  if (!contentEl) return;
  if (upcomingData.length === 0 || forceRefresh) {
    isUpcomingLoading = true;
    contentEl.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 44px; animation: spin 1s linear infinite; color: var(--md-sys-color-primary);">sync</span>
        <p style="margin-top: 14px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Synchronizuj\u0119 harmonogram premier i emisji...</p>
        <p style="font-size: 0.82rem; opacity: 0.8; margin-top: 4px;">Sprawdzam odcinki seriali i daty kinowe w bazie TMDb</p>
      </div>
    `;
    try {
      const url = forceRefresh ? "/api/upcoming?refresh=1" : "/api/upcoming";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        upcomingData = data.items || [];
      }
    } catch (err) {
      console.error("Upcoming fetch error:", err);
    } finally {
      isUpcomingLoading = false;
    }
  }
  const allCount = upcomingData.length;
  const tvCount = upcomingData.filter((i) => i.media_type === "tv").length;
  const movieCount = upcomingData.filter((i) => i.media_type === "movie").length;
  const countAllEl = document.getElementById("m3-upcoming-count-all");
  const countTvEl = document.getElementById("m3-upcoming-count-tv");
  const countMovieEl = document.getElementById("m3-upcoming-count-movie");
  if (countAllEl) countAllEl.innerText = allCount;
  if (countTvEl) countTvEl.innerText = tvCount;
  if (countMovieEl) countMovieEl.innerText = movieCount;
  renderUpcoming();
}
function getDayOfWeekPL(dateStr) {
  if (!dateStr) return "";
  try {
    const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    const days = ["Niedziela", "Poniedzia\u0142ek", "Wtorek", "\u015Aroda", "Czwartek", "Pi\u0105tek", "Sobota"];
    const months = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Pa\u017A", "Lis", "Gru"];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  } catch (e) {
    return dateStr;
  }
}
function formatDatePL(dateStr) {
  if (!dateStr) return "";
  try {
    const d = /* @__PURE__ */ new Date(dateStr + "T00:00:00");
    const months = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Pa\u017A", "Lis", "Gru"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}
function renderUpcoming() {
  const contentEl = document.getElementById("m3-upcoming-content");
  if (!contentEl) return;
  const filtered = upcomingData.filter((it) => {
    if (upcomingFilter === "tv" && it.media_type !== "tv") return false;
    if (upcomingFilter === "movie" && it.media_type !== "movie") return false;
    return true;
  });
  if (filtered.length === 0) {
    contentEl.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container); border-radius: var(--md-corner-xl); border: 1px solid var(--md-sys-color-outline-variant);">
        <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 12px; opacity: 0.8; color: var(--md-sys-color-primary);">event_busy</span>
        <h3 style="font-size: 1.1rem; color: var(--md-sys-color-on-surface);">Brak nadchodz\u0105cych pozycji w wybranej kategorii</h3>
        <p style="font-size: 0.85rem; margin-top: 6px;">Dodaj seriale do ogl\u0105danych lub filmy do watchlisty, aby \u015Bledzi\u0107 premiery i odcinki.</p>
      </div>
    `;
    return;
  }
  const thisWeek = filtered.filter((i) => i.days_left >= 0 && i.days_left <= 7);
  const thisMonth = filtered.filter((i) => i.days_left >= 8 && i.days_left <= 30);
  const future = filtered.filter((i) => i.days_left >= 31 && i.days_left < 9999);
  const inProd = filtered.filter((i) => i.days_left === 9999);
  let html = "";
  const createCardHtml = (it) => {
    let countdownBadge = "";
    if (it.days_left === 0) {
      countdownBadge = `<span class="m3-countdown-badge today"><span class="material-symbols-rounded" style="font-size: 14px;">local_fire_department</span> Premiera Dzisiaj!</span>`;
    } else if (it.days_left === 1) {
      countdownBadge = `<span class="m3-countdown-badge urgent"><span class="material-symbols-rounded" style="font-size: 14px;">schedule</span> Jutro! (${getDayOfWeekPL(it.release_date)})</span>`;
    } else if (it.days_left <= 7) {
      countdownBadge = `<span class="m3-countdown-badge urgent"><span class="material-symbols-rounded" style="font-size: 14px;">hourglass_top</span> Za ${it.days_left} dni (${getDayOfWeekPL(it.release_date)})</span>`;
    } else if (it.days_left < 9999) {
      countdownBadge = `<span class="m3-countdown-badge normal"><span class="material-symbols-rounded" style="font-size: 14px;">calendar_month</span> Za ${it.days_left} dni \u2022 ${formatDatePL(it.release_date)}</span>`;
    } else {
      countdownBadge = `<span class="m3-countdown-badge in-prod"><span class="material-symbols-rounded" style="font-size: 14px;">movie_filter</span> Kolejny sezon potwierdzony</span>`;
    }
    const typeBadge = it.media_type === "tv" ? `<span class="m3-meta-badge" style="font-size: 11px; padding: 2px 6px;"><span class="material-symbols-rounded" style="font-size: 12px;">tv</span> Serial</span>` : `<span class="m3-meta-badge" style="font-size: 11px; padding: 2px 6px;"><span class="material-symbols-rounded" style="font-size: 12px;">movie</span> Film</span>`;
    const posterHtml = it.poster_url ? `<img src="${it.poster_url}" alt="${it.title}" class="m3-upcoming-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-upcoming-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(it.title)}; font-size: 10px; color: #fff; font-weight: 700; text-align: center; padding: 4px;">${it.title}</div>` : `<div class="m3-upcoming-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(it.title)}; font-size: 10px; color: #fff; font-weight: 700; text-align: center; padding: 4px;">${it.title}</div>`;
    return `
      <div class="m3-upcoming-card" data-id="${it.id}" data-type="${it.media_type}" data-title="${it.title}">
        ${posterHtml}
        <div class="m3-upcoming-body">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
              ${typeBadge}
              ${it.release_date ? `<span style="font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant); font-weight: 600;">${it.release_date}</span>` : ""}
            </div>
            <div class="m3-upcoming-title" title="${it.title}">${it.title}</div>
            <div class="m3-upcoming-subtitle">${it.status_label || ""}</div>
          </div>
          <div>
            ${countdownBadge}
          </div>
        </div>
      </div>
    `;
  };
  const createSection = (title, icon, items, badgeClass = "") => {
    if (items.length === 0) return "";
    return `
      <section class="m3-upcoming-section">
        <div class="m3-upcoming-section-header">
          <span class="material-symbols-rounded" style="font-size: 22px; color: var(--md-sys-color-primary);">${icon}</span>
          <span>${title}</span>
          <span class="m3-upcoming-section-badge ${badgeClass}">${items.length}</span>
        </div>
        <div class="m3-upcoming-grid">
          ${items.map(createCardHtml).join("")}
        </div>
      </section>
    `;
  };
  html += createSection("W tym tygodniu (Odcinki na bie\u017C\u0105co & premiery)", "local_fire_department", thisWeek);
  html += createSection("W tym miesi\u0105cu", "calendar_view_month", thisMonth);
  html += createSection("Wkr\xF3tce (Kolejne miesi\u0105ce)", "hourglass_empty", future);
  html += createSection("Zapowiedziane / W produkcji (Data do potwierdzenia)", "precision_manufacturing", inProd);
  contentEl.innerHTML = html;
  contentEl.querySelectorAll(".m3-upcoming-card").forEach((card) => {
    card.addEventListener("click", () => {
      const type = card.getAttribute("data-type");
      const title = card.getAttribute("data-title");
      if (type === "movie") {
        const found = state.movies.find((m) => m.title === title || m.uuid === card.getAttribute("data-id"));
        if (found) openMovieDetail(found);
      } else {
        const found = state.shows.find((s) => s.title === title || s.uuid === card.getAttribute("data-id"));
        if (found) openEpisodeTracker(found);
      }
    });
  });
}
function exportCalendarICS() {
  if (!upcomingData || upcomingData.length === 0) {
    showToastNotification("Brak nadchodz\u0105cych premier do wyeksportowania.", "info");
    return;
  }
  const validItems = upcomingData.filter((it) => it.release_date && it.release_date.match(/^\d{4}-\d{2}-\d{2}$/));
  if (validItems.length === 0) {
    showToastNotification("Brak pozycji z potwierdzon\u0105 dok\u0142adn\u0105 dat\u0105 premiery.", "info");
    return;
  }
  let ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CineLog//Harmonogram Premier i Emisji//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CineLog Premiery i Odcinki",
    "X-WR-TIMEZONE:UTC"
  ];
  validItems.forEach((it) => {
    const dStr = it.release_date.replace(/-/g, "");
    const nowStr = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const uid = `cinelog-${it.id || it.title.replace(/\s+/g, "_")}-${dStr}@cinelog.app`;
    const summary = it.media_type === "tv" ? `\u{1F4FA} Premiera odcinka: ${it.title} (${it.status_label || "Nowy odcinek"})` : `\u{1F3AC} Premiera filmu: ${it.title}`;
    const description = `Premiera w CineLog: ${it.title}\\nStatus: ${it.status_label || "Wkr\xF3tce"}\\nTyp: ${it.media_type === "tv" ? "Serial" : "Film"}`;
    ics.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${nowStr}`,
      `DTSTART;VALUE=DATE:${dStr}`,
      `DTEND;VALUE=DATE:${dStr}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  });
  ics.push("END:VCALENDAR");
  const blob = new Blob([ics.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cinelog-premiery.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToastNotification(`Wyeksportowano ${validItems.length} premier do pliku cinelog-premiery.ics!`, "success");
}
function initUpcomingFilters() {
  const chips = document.querySelectorAll("[data-upcoming-filter]");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      upcomingFilter = chip.getAttribute("data-upcoming-filter");
      renderUpcoming();
    });
  });
  const refreshBtn = document.getElementById("m3-upcoming-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadUpcomingData(true);
    });
  }
  const exportIcsBtn = document.getElementById("m3-upcoming-export-ics-btn");
  if (exportIcsBtn) {
    exportIcsBtn.addEventListener("click", () => {
      exportCalendarICS();
    });
  }
}
window.loadUpcomingData = loadUpcomingData;
window.exportCalendarICS = exportCalendarICS;

// static/js/main.js
applyMaterial3Theme();
async function loadData() {
  const container = document.getElementById("m3-movies-grid");
  const showsContainer = document.getElementById("m3-shows-grid");
  if (container && (!state.movies || state.movies.length === 0)) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 40px; animation: spin 1s linear infinite; color: var(--md-sys-color-primary);">sync</span>
        <p style="margin-top: 12px; font-weight: 500;">Wczytywanie Twojej biblioteki...</p>
      </div>
    `;
  }
  const localSaved = localStorage.getItem("cinelog_database");
  let hasLocalData = false;
  if (localSaved) {
    try {
      const parsed = JSON.parse(localSaved);
      if (parsed.movies && Array.isArray(parsed.movies) && parsed.movies.length > 0) {
        state.movies = parsed.movies;
        hasLocalData = true;
      }
      if (parsed.shows && Array.isArray(parsed.shows) && parsed.shows.length > 0) {
        state.shows = parsed.shows;
        hasLocalData = true;
      }
      syncWindowAliases();
      updateStats();
      if (state.mode === "movies") renderMovies();
      else renderShows();
    } catch (e) {
    }
  }
  let fetchedMovies = null;
  let fetchedShows = null;
  try {
    const [resMovies, resShows] = await Promise.all([
      fetch("/api/movies"),
      fetch("/api/shows")
    ]);
    if (resMovies.ok && resShows.ok) {
      fetchedMovies = await resMovies.json();
      fetchedShows = await resShows.json();
    }
  } catch (err) {
  }
  if (!fetchedMovies || !fetchedShows) {
    try {
      const res = await fetch("/api/data");
      if (res.ok) {
        const data = await res.json();
        if (data.movies && Array.isArray(data.movies)) fetchedMovies = data.movies;
        if (data.shows && Array.isArray(data.shows)) fetchedShows = data.shows;
      }
    } catch (err) {
    }
  }
  if ((!fetchedMovies || fetchedMovies.length === 0) && (!state.movies || state.movies.length === 0)) {
    const candidatePaths = [
      ["./static/data/movies_parsed.json", "./static/data/shows_parsed.json"],
      ["static/data/movies_parsed.json", "static/data/shows_parsed.json"],
      ["/static/data/movies_parsed.json", "/static/data/shows_parsed.json"],
      ["export data/movies_parsed.json", "export data/shows_parsed.json"],
      ["export%20data/movies_parsed.json", "export%20data/shows_parsed.json"],
      ["../static/data/movies_parsed.json", "../static/data/shows_parsed.json"]
    ];
    for (const [mPath, sPath] of candidatePaths) {
      try {
        const [rm, rs] = await Promise.all([fetch(mPath), fetch(sPath)]);
        if (rm.ok && rs.ok) {
          fetchedMovies = await rm.json();
          fetchedShows = await rs.json();
          break;
        }
      } catch (e) {
      }
    }
  }
  if (Array.isArray(fetchedMovies) && fetchedMovies.length > 0) {
    state.movies = fetchedMovies;
  }
  if (Array.isArray(fetchedShows) && fetchedShows.length > 0) {
    state.shows = fetchedShows;
  }
  if (state.movies.length > 0 || state.shows.length > 0) {
    saveLocalDatabase();
  }
  syncWindowAliases();
  updateStats();
  try {
    renderTopVodFilterBar(state.userVodCountry, () => {
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  } catch (e) {
    console.error("renderTopVodFilterBar error:", e);
  }
  try {
    hydrateVodCache();
  } catch (e) {
  }
  setMode(state.mode);
  if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    try {
      window.googleDriveSync.checkAutoSync((cloudMovies, cloudShows) => {
        state.movies = cloudMovies;
        state.shows = cloudShows;
        updateStats();
        if (state.mode === "movies") renderMovies();
        else renderShows();
        saveLocalDatabase();
      });
    } catch (e) {
    }
  }
}
function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("cinelog_mode", mode);
  const btnMovies = document.getElementById("m3-mode-movies");
  const btnShows = document.getElementById("m3-mode-shows");
  const navMovies = document.getElementById("m3-nav-movies");
  const navShows = document.getElementById("m3-nav-shows");
  const fabText = document.getElementById("m3-fab-text");
  const mobileToggleIcon = document.getElementById("m3-mobile-mode-icon");
  const mobileToggleLabel = document.getElementById("m3-mobile-mode-label");
  const currentTab = mode === "movies" ? state.activeMovieTab : state.activeShowTab;
  if (mode === "movies") {
    if (btnMovies) btnMovies.classList.add("active");
    if (btnShows) btnShows.classList.remove("active");
    if (navMovies) navMovies.style.display = "flex";
    if (navShows) navShows.style.display = "none";
    if (fabText) fabText.innerText = "Dodaj film";
    if (mobileToggleIcon) mobileToggleIcon.innerText = "movie";
    if (mobileToggleLabel) mobileToggleLabel.innerText = "Filmy";
    const bnav = document.querySelector(".m3-bottom-nav");
    if (bnav) {
      const items = bnav.querySelectorAll(".m3-bottom-nav-item");
      if (items[0]) {
        items[0].setAttribute("data-tab", "all");
        const icon = items[0].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "movie_filter";
        const text = items[0].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Wszystkie";
      }
      if (items[1]) {
        items[1].setAttribute("data-tab", "watched");
        const icon = items[1].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "check_circle";
        const text = items[1].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Obejrzane";
      }
      if (items[2]) {
        items[2].setAttribute("data-tab", "watchlist");
        const icon = items[2].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "bookmark";
        const text = items[2].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Do obejrzenia";
      }
      if (items[3]) {
        items[3].setAttribute("data-tab", "upcoming");
        const icon = items[3].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "event_upcoming";
        const text = items[3].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Nadchodz\u0105ce";
      }
      if (items[4]) {
        items[4].setAttribute("data-tab", "recommendations");
        const icon = items[4].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "auto_awesome";
        const text = items[4].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Dla Ciebie";
      }
    }
  } else {
    if (btnShows) btnShows.classList.add("active");
    if (btnMovies) btnMovies.classList.remove("active");
    if (navShows) navShows.style.display = "flex";
    if (navMovies) navMovies.style.display = "none";
    if (fabText) fabText.innerText = "Dodaj serial";
    if (mobileToggleIcon) mobileToggleIcon.innerText = "tv";
    if (mobileToggleLabel) mobileToggleLabel.innerText = "Seriale";
    const bnav = document.querySelector(".m3-bottom-nav");
    if (bnav) {
      const items = bnav.querySelectorAll(".m3-bottom-nav-item");
      if (items[0]) {
        items[0].setAttribute("data-tab", "all");
        const icon = items[0].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "tv";
        const text = items[0].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Wszystkie";
      }
      if (items[1]) {
        items[1].setAttribute("data-tab", "watching");
        const icon = items[1].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "play_circle";
        const text = items[1].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Ogl\u0105dane";
      }
      if (items[2]) {
        items[2].setAttribute("data-tab", "watchlist");
        const icon = items[2].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "bookmark";
        const text = items[2].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Do obejrzenia";
      }
      if (items[3]) {
        items[3].setAttribute("data-tab", "upcoming");
        const icon = items[3].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "event_upcoming";
        const text = items[3].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Nadchodz\u0105ce";
      }
      if (items[4]) {
        items[4].setAttribute("data-tab", "recommendations");
        const icon = items[4].querySelector(".material-symbols-rounded");
        if (icon) icon.innerText = "auto_awesome";
        const text = items[4].querySelector("span:not(.material-symbols-rounded)");
        if (text) text.innerText = "Dla Ciebie";
      }
    }
  }
  switchTab(currentTab);
  updateStats();
}
function switchTab(tabId) {
  const isShows = state.mode === "shows";
  if (isShows) {
    state.activeShowTab = tabId;
  } else {
    state.activeMovieTab = tabId;
  }
  const moviesGrid = document.getElementById("m3-movies-grid");
  const showsGrid = document.getElementById("m3-shows-grid");
  const recHub = document.getElementById("m3-recommendations-container");
  const upcomingHub = document.getElementById("m3-upcoming-container");
  const toolbarRow = document.querySelector(".m3-unified-toolbar-row");
  const searchBar = document.querySelector(".m3-search-bar");
  if (moviesGrid) moviesGrid.style.display = "none";
  if (showsGrid) showsGrid.style.display = "none";
  if (recHub) recHub.style.display = "none";
  if (upcomingHub) upcomingHub.style.display = "none";
  if (tabId === "recommendations" || tabId === "for_you") {
    if (recHub) recHub.style.display = "flex";
    if (toolbarRow) toolbarRow.style.display = "none";
    if (searchBar) searchBar.style.display = "none";
    loadRecommendationsHub();
  } else if (tabId === "upcoming") {
    if (upcomingHub) upcomingHub.style.display = "flex";
    if (toolbarRow) toolbarRow.style.display = "none";
    if (searchBar) searchBar.style.display = "none";
    loadUpcomingData();
  } else {
    if (toolbarRow) toolbarRow.style.display = "flex";
    if (searchBar) searchBar.style.display = "flex";
    if (isShows) {
      if (showsGrid) showsGrid.style.display = "grid";
      renderShows();
    } else {
      if (moviesGrid) moviesGrid.style.display = "grid";
      renderMovies();
    }
  }
  document.querySelectorAll(".m3-nav-item, .m3-bottom-nav-item").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-tab") === tabId);
  });
}
window.setMode = setMode;
window.switchTab = switchTab;
window.loadData = loadData;
window.openMovieDetail = openMovieDetail;
window.openEpisodeTracker = openEpisodeTracker;
window.openAnalyticsModal = openAnalyticsModal;
window.openCloudSyncModal = openCloudSyncModal;
window.applyMaterial3Theme = applyMaterial3Theme;
window.showToastNotification = showToastNotification;
window.loadUpcomingData = loadUpcomingData;
window.loadRecommendationsHub = loadRecommendationsHub;
window.renderMovies = renderMovies;
window.renderShows = renderShows;
window.updateStats = updateStats;
window.openImporterModal = openImporterModal;
function initApp() {
  try {
    const btnMovies = document.getElementById("m3-mode-movies");
    const btnShows = document.getElementById("m3-mode-shows");
    const mobileToggle = document.getElementById("m3-mobile-mode-toggle");
    if (btnMovies) btnMovies.addEventListener("click", () => setMode("movies"));
    if (btnShows) btnShows.addEventListener("click", () => setMode("shows"));
    if (mobileToggle) {
      mobileToggle.addEventListener("click", () => {
        setMode(state.mode === "movies" ? "shows" : "movies");
      });
    }
    document.querySelectorAll(".m3-nav-item, .m3-bottom-nav-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const tab = e.currentTarget.getAttribute("data-tab");
        if (tab) switchTab(tab);
      });
    });
    const searchInput = document.getElementById("m3-search-input");
    const searchClear = document.getElementById("m3-search-clear");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        if (searchClear) searchClear.style.display = searchInput.value ? "inline-block" : "none";
        if (state.mode === "movies") renderMovies();
        else renderShows();
      });
    }
    if (searchClear && searchInput) {
      searchClear.addEventListener("click", () => {
        searchInput.value = "";
        searchClear.style.display = "none";
        if (state.mode === "movies") renderMovies();
        else renderShows();
      });
    }
    const sortSelect = document.getElementById("m3-sort-select");
    if (sortSelect) {
      sortSelect.value = state.sortMode;
      sortSelect.addEventListener("change", (e) => {
        state.sortMode = e.target.value;
        localStorage.setItem("cinelog_sort_mode", state.sortMode);
        if (state.mode === "movies") renderMovies();
        else renderShows();
      });
    }
    const scrollTopBtn = document.getElementById("m3-scroll-top");
    if (scrollTopBtn) {
      window.addEventListener("scroll", () => {
        const currentScrollY = window.scrollY;
        if (currentScrollY > 280) scrollTopBtn.classList.add("show");
        else scrollTopBtn.classList.remove("show");
      }, { passive: true });
      scrollTopBtn.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    const sheetDetailClose = document.getElementById("m3-sheet-detail-close");
    if (sheetDetailClose) {
      sheetDetailClose.addEventListener("click", () => {
        const modal = document.getElementById("m3-sheet-movie-detail");
        if (modal) modal.classList.remove("active");
      });
    }
    const sheetActorClose = document.getElementById("m3-sheet-actor-close");
    if (sheetActorClose) {
      sheetActorClose.addEventListener("click", () => {
        const modal = document.getElementById("m3-sheet-actor");
        if (modal) modal.classList.remove("active");
      });
    }
    const sheetEpClose = document.getElementById("m3-sheet-ep-close");
    if (sheetEpClose) {
      sheetEpClose.addEventListener("click", () => {
        const modal = document.getElementById("m3-sheet-episodes");
        if (modal) modal.classList.remove("active");
      });
    }
    document.querySelectorAll(".m3-season-tabs, .m3-vod-filter-bar, .m3-mode-switcher").forEach((el) => {
      el.addEventListener("wheel", (evt) => {
        if (evt.deltaY !== 0 && !evt.shiftKey) {
          evt.preventDefault();
          el.scrollLeft += evt.deltaY * 0.85;
        }
      }, { passive: false });
    });
  } catch (err) {
    console.error("Error setting up core DOM events:", err);
  }
  try {
    initSearchAndAddModal();
  } catch (e) {
    console.error("Search module error:", e);
  }
  try {
    initCloudSyncHandlers();
  } catch (e) {
    console.error("Cloud sync module error:", e);
  }
  try {
    initImporterHandlers();
  } catch (e) {
    console.error("Importer module error:", e);
  }
  try {
    initVodSettingsHandlers(() => {
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  } catch (e) {
    console.error("VOD module error:", e);
  }
  try {
    initThemeControls();
  } catch (e) {
    console.error("Theme module error:", e);
  }
  try {
    initAnalyticsEvents();
  } catch (e) {
    console.error("Analytics module error:", e);
  }
  try {
    initUpcomingFilters();
  } catch (e) {
    console.error("Upcoming module error:", e);
  }
  try {
    initBackdropDismiss();
  } catch (e) {
    console.error("Backdrop module error:", e);
  }
  if (window.googleDriveSync) {
    try {
      window.googleDriveSync.init();
    } catch (e) {
    }
  }
  setMode(state.mode);
  loadData();
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
export {
  loadData,
  setMode,
  switchTab
};
