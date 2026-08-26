// ==========================================================================
// CineLog - Main Application Coordinator (ES6 Modular Architecture)
// ==========================================================================

import { state, saveLocalDatabase, syncWindowAliases, getGradientForTitle, resetToDemoDatabase, markUserDatabaseCustom, isUserDatabaseDemo, getActiveEnvMode, setActiveEnvMode } from './modules/state.js';
import { applyMaterial3Theme, showToastNotification, initBackdropDismiss, initThemeControls, initDemoBannerHandlers, updateDemoBannerVisibility, updateEnvStatusModalContent, openEnvStatusModal, closeEnvStatusModal, showM3ConfirmDialog } from './modules/ui.js';
import { updateStats, initCharts, openAnalyticsModal, initAnalyticsEvents } from './modules/stats.js';
import { hydrateVodCache, renderTopVodFilterBar, initVodSettingsHandlers } from './modules/vod.js';
import { renderMovies, openMovieDetail } from './modules/movies.js';
import { renderShows, openEpisodeTracker, toggleEpisodeWatch } from './modules/shows.js';
import { loadRecommendationsHub, renderRecommendationsFeed } from './modules/recommendations.js';
import { loadUpcomingData, initUpcomingFilters } from './modules/upcoming.js';
import { initSearchAndAddModal } from './modules/search.js';
import { initCloudSyncHandlers, openCloudSyncModal, updateDriveModalUI } from './modules/cloud.js';
import { initImporterHandlers, openImporterModal } from './modules/importer.js';

// Apply initial M3 theme
applyMaterial3Theme();

export async function loadData(targetMode = null) {
  const currentMode = targetMode || getActiveEnvMode();

  if (currentMode === "flask" && state.backendAvailable) {
    try {
      const [resMovies, resShows] = await Promise.all([
        fetch("/api/movies"),
        fetch("/api/shows")
      ]);
      if (resMovies.ok && resShows.ok) {
        state.movies = await resMovies.json();
        state.shows = await resShows.json();
        saveLocalDatabase(true);
      }
    } catch (e) {}
  } else if (currentMode === "demo") {
    await resetToDemoDatabase();
  } else {
    // Client mode (LocalStorage / custom imported)
    const localSaved = localStorage.getItem("cinelog_database");
    if (localSaved) {
      try {
        const parsed = JSON.parse(localSaved);
        if (parsed.movies && Array.isArray(parsed.movies)) state.movies = parsed.movies;
        if (parsed.shows && Array.isArray(parsed.shows)) state.shows = parsed.shows;
      } catch(e){}
    } else {
      await resetToDemoDatabase();
    }
  }

  syncWindowAliases();
  updateStats();
  try {
    renderTopVodFilterBar(state.userVodCountry, () => {
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  } catch (e) {}
  try {
    hydrateVodCache();
  } catch (e) {}

  setMode(state.mode);

  // Google Drive Auto-Sync check (only in client/custom mode)
  if (currentMode === "client" && window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    try {
      window.googleDriveSync.checkAutoSync((cloudMovies, cloudShows) => {
        state.movies = cloudMovies;
        state.shows = cloudShows;
        updateStats();
        if (state.mode === "movies") renderMovies();
        else renderShows();
        saveLocalDatabase();
        updateDemoBannerVisibility();
      });
    } catch (e) {}
  }

  updateDemoBannerVisibility();
}

export function setMode(mode) {
  state.mode = mode;
  localStorage.setItem("cinelog_mode", mode);

  const btnMovies = document.getElementById("m3-mode-movies");
  const btnShows = document.getElementById("m3-mode-shows");
  const navMovies = document.getElementById("m3-nav-movies");
  const navShows = document.getElementById("m3-nav-shows");
  const fabText = document.getElementById("m3-fab-text");
  
  const mobileBtnMovies = document.getElementById("m3-mobile-btn-movies");
  const mobileBtnShows = document.getElementById("m3-mobile-btn-shows");

  if (mode === "movies") {
    if (btnMovies) btnMovies.classList.add("active");
    if (btnShows) btnShows.classList.remove("active");
    if (mobileBtnMovies) {
      mobileBtnMovies.style.background = "var(--md-sys-color-primary)";
      mobileBtnMovies.style.color = "var(--md-sys-color-on-primary)";
    }
    if (mobileBtnShows) {
      mobileBtnShows.style.background = "transparent";
      mobileBtnShows.style.color = "var(--md-sys-color-on-surface-variant)";
    }
    if (navMovies) navMovies.style.display = "flex";
    if (navShows) navShows.style.display = "none";
    if (fabText) fabText.innerText = "Dodaj film";

    const bnav = document.querySelector(".m3-bottom-nav");
    if (bnav) {
      const items = bnav.querySelectorAll(".m3-bottom-nav-item");
      if (items[0]) { items[0].setAttribute("data-tab", "all"); const icon = items[0].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "movie_filter"; const text = items[0].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Wszystkie"; }
      if (items[1]) { items[1].setAttribute("data-tab", "watched"); const icon = items[1].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "check_circle"; const text = items[1].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Obejrzane"; }
      if (items[2]) { items[2].setAttribute("data-tab", "watchlist"); const icon = items[2].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "bookmark"; const text = items[2].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Do obejrzenia"; }
      if (items[3]) { items[3].setAttribute("data-tab", "upcoming"); const icon = items[3].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "event_upcoming"; const text = items[3].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Nadchodzące"; }
      if (items[4]) { items[4].setAttribute("data-tab", "recommendations"); const icon = items[4].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "auto_awesome"; const text = items[4].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Dla Ciebie"; }
    }

    if (state.activeMovieTab === "watching") state.activeMovieTab = "watched";
    switchTab(state.activeMovieTab || "all");
  } else {
    if (btnShows) btnShows.classList.add("active");
    if (btnMovies) btnMovies.classList.remove("active");
    if (mobileBtnShows) {
      mobileBtnShows.style.background = "var(--md-sys-color-primary)";
      mobileBtnShows.style.color = "var(--md-sys-color-on-primary)";
    }
    if (mobileBtnMovies) {
      mobileBtnMovies.style.background = "transparent";
      mobileBtnMovies.style.color = "var(--md-sys-color-on-surface-variant)";
    }
    if (navShows) navShows.style.display = "flex";
    if (navMovies) navMovies.style.display = "none";
    if (fabText) fabText.innerText = "Dodaj serial";

    const bnav = document.querySelector(".m3-bottom-nav");
    if (bnav) {
      const items = bnav.querySelectorAll(".m3-bottom-nav-item");
      if (items[0]) { items[0].setAttribute("data-tab", "all"); const icon = items[0].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "tv"; const text = items[0].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Wszystkie"; }
      if (items[1]) { items[1].setAttribute("data-tab", "watching"); const icon = items[1].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "play_circle"; const text = items[1].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Oglądane"; }
      if (items[2]) { items[2].setAttribute("data-tab", "watchlist"); const icon = items[2].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "bookmark"; const text = items[2].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Do obejrzenia"; }
      if (items[3]) { items[3].setAttribute("data-tab", "upcoming"); const icon = items[3].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "event_upcoming"; const text = items[3].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Nadchodzące"; }
      if (items[4]) { items[4].setAttribute("data-tab", "recommendations"); const icon = items[4].querySelector(".material-symbols-rounded"); if (icon) icon.innerText = "auto_awesome"; const text = items[4].querySelector("span:not(.material-symbols-rounded)"); if (text) text.innerText = "Dla Ciebie"; }
    }

    if (state.activeShowTab === "watched") state.activeShowTab = "watching";
    switchTab(state.activeShowTab || "all");
  }

  updateStats();
}

export function switchTab(tabId) {
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

    const sortOptDefault = document.getElementById("m3-sort-opt-default");
    const sortOptAsc = document.getElementById("m3-sort-opt-asc");
    if (sortOptDefault) {
      if (tabId === "watchlist") {
        sortOptDefault.innerText = "Ostatnio dodane do listy (Domyślne)";
        if (sortOptAsc) sortOptAsc.innerText = "Data dodania: od najstarszych";
      } else if (tabId === "watched") {
        sortOptDefault.innerText = "Ostatnio obejrzane (Domyślne)";
        if (sortOptAsc) sortOptAsc.innerText = "Data obejrzenia: od najstarszych";
      } else if (tabId === "watching") {
        sortOptDefault.innerText = "Ostatnio kontynuowane (Domyślne)";
        if (sortOptAsc) sortOptAsc.innerText = "Data: od najstarszych";
      } else {
        sortOptDefault.innerText = "Ostatnio dodane / aktywność (Domyślne)";
        if (sortOptAsc) sortOptAsc.innerText = "Data: od najstarszych";
      }
    }

    if (isShows) {
      if (showsGrid) showsGrid.style.display = "grid";
      renderShows();
    } else {
      if (moviesGrid) moviesGrid.style.display = "grid";
      renderMovies();
    }
  }

  document.querySelectorAll(".m3-nav-item, .m3-bottom-nav-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-tab") === tabId);
  });
}

// Attach globals for HTML handlers
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
window.updateDriveModalUI = updateDriveModalUI;

// --- Accessibility: bottom sheets (Escape to close + focus management) ---
function initSheetAccessibility() {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const openSheets = Array.from(document.querySelectorAll(".m3-bottom-sheet.active"));
    if (!openSheets.length) return;
    // Close only the top-most sheet (highest z-index wins)
    const top = openSheets.sort((a, b) =>
      (parseInt(b.style.zIndex, 10) || 200) - (parseInt(a.style.zIndex, 10) || 200)
    )[0];
    top.classList.remove("active");
  });

  if (!("MutationObserver" in window)) return;

  let lastFocused = null;
  const focusablesSel = "button:not([disabled]), [href], input:not([type='hidden']), select, textarea, [tabindex]:not([tabindex='-1'])";
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!(el instanceof HTMLElement)) continue;
      if (el.classList.contains("active")) {
        lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const target = el.querySelector(focusablesSel);
        if (target) setTimeout(() => target.focus({ preventScroll: true }), 120);
      } else if (lastFocused && lastFocused.isConnected && el.contains(document.activeElement)) {
        lastFocused.focus({ preventScroll: true });
        lastFocused = null;
      }
    }
  });
  document.querySelectorAll(".m3-bottom-sheet").forEach(sheet => {
    observer.observe(sheet, { attributes: true, attributeFilter: ["class"] });
  });
}

// Setup DOM Events
function initImageErrorFallbacks() {
  const applyFallback = (img) => {
    const fbSrc = img.dataset.fallbackSrc;
    if (fbSrc) {
      if (img.dataset.fallbackApplied) return;
      img.dataset.fallbackApplied = "1";
      img.src = fbSrc;
      return;
    }
    const sib = img.nextElementSibling;
    if (sib) {
      img.style.display = "none";
      sib.style.display = img.dataset.fallbackDisplay || "";
    }
  };
  document.addEventListener(
    "error",
    (e) => {
      if (e.target instanceof HTMLImageElement) applyFallback(e.target);
    },
    true
  );
  document.querySelectorAll("img").forEach((img) => {
    if (img.complete && img.naturalWidth === 0 && img.naturalHeight === 0) applyFallback(img);
  });
}

function applyInitialUrlState() {
  const urlParams = new URLSearchParams(window.location.search);
  const qMode = urlParams.get("mode");
  if (qMode === "movies" || qMode === "shows") {
    state.mode = qMode;
  }
  const qTab = urlParams.get("tab");
  if (qTab) {
    if (state.mode === "shows") state.activeShowTab = qTab;
    else state.activeMovieTab = qTab;
  }
}

function initModeSwitcherListeners() {
  const btnMovies = document.getElementById("m3-mode-movies");
  const btnShows = document.getElementById("m3-mode-shows");
  const mobileBtnMovies = document.getElementById("m3-mobile-btn-movies");
  const mobileBtnShows = document.getElementById("m3-mobile-btn-shows");

  if (btnMovies) btnMovies.addEventListener("click", () => setMode("movies"));
  if (btnShows) btnShows.addEventListener("click", () => setMode("shows"));
  if (mobileBtnMovies) mobileBtnMovies.addEventListener("click", () => setMode("movies"));
  if (mobileBtnShows) mobileBtnShows.addEventListener("click", () => setMode("shows"));
}

function initNavTabListeners() {
  document.querySelectorAll(".m3-nav-item, .m3-bottom-nav-item").forEach(item => {
    item.addEventListener("click", (e) => {
      const tab = e.currentTarget.getAttribute("data-tab");
      if (tab) switchTab(tab);
    });
  });
}

function renderCurrentMode() {
  if (state.mode === "movies") renderMovies();
  else renderShows();
}

function initHeaderSearchHandlers() {
  const searchInput = document.getElementById("m3-search-input");
  const searchClear = document.getElementById("m3-search-clear");
  if (searchInput) {
    let searchRenderTimer = null;
    searchInput.addEventListener("input", () => {
      if (searchClear) searchClear.style.display = searchInput.value ? "inline-block" : "none";
      clearTimeout(searchRenderTimer);
      searchRenderTimer = setTimeout(renderCurrentMode, 180);
    });
  }
  if (searchClear && searchInput) {
    searchClear.addEventListener("click", () => {
      searchInput.value = "";
      searchClear.style.display = "none";
      renderCurrentMode();
    });
  }
}

function initSortSelectorHandler() {
  const sortSelect = document.getElementById("m3-sort-select");
  if (!sortSelect) return;
  sortSelect.value = state.sortMode;
  sortSelect.addEventListener("change", (e) => {
    state.sortMode = e.target.value;
    localStorage.setItem("cinelog_sort_mode", state.sortMode);
    renderCurrentMode();
  });
}

function initScrollTopButton() {
  const scrollTopBtn = document.getElementById("m3-scroll-top");
  if (!scrollTopBtn) return;
  window.addEventListener("scroll", () => {
    const currentScrollY = window.scrollY;
    if (currentScrollY > 280) scrollTopBtn.classList.add("show");
    else scrollTopBtn.classList.remove("show");
  }, { passive: true });

  scrollTopBtn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function bindSheetCloseButton(buttonId, sheetId) {
  const closeBtn = document.getElementById(buttonId);
  if (!closeBtn) return;
  closeBtn.addEventListener("click", () => {
    const modal = document.getElementById(sheetId);
    if (modal) modal.classList.remove("active");
  });
}

function initModalCloseHandlers() {
  bindSheetCloseButton("m3-sheet-detail-close", "m3-sheet-movie-detail");
  bindSheetCloseButton("m3-sheet-actor-close", "m3-sheet-actor");
  bindSheetCloseButton("m3-sheet-ep-close", "m3-sheet-episodes");
}

function initHorizontalWheelScrolling() {
  document.querySelectorAll(".m3-season-tabs, .m3-vod-filter-bar, .m3-mode-switcher").forEach(el => {
    el.addEventListener("wheel", (evt) => {
      if (evt.deltaY !== 0 && !evt.shiftKey) {
        evt.preventDefault();
        el.scrollLeft += evt.deltaY * 0.85;
      }
    }, { passive: false });
  });
}

async function switchToFlaskEnvironment() {
  if (!state.backendAvailable) {
    showToastNotification("Serwer Flask nie odpowiada. Uruchom 'python app.py' w terminalu.", "warning");
    return;
  }
  setActiveEnvMode("flask");
  showToastNotification("Ładowanie bazy z serwera Flask...", "info");
  try {
    await loadData("flask");
    detectBackendEnvironment(false);
    closeEnvStatusModal();
    showToastNotification("🟢 Pomyślnie wczytano bazę z serwera Flask!", "success");
  } catch (e) {
    showToastNotification("Błąd wczytywania danych z serwera Flask.", "error");
  }
}

async function switchToDemoEnvironment() {
  const isDriveAuth = window.googleDriveSync && window.googleDriveSync.isAuthorized();
  const confirmMsg = isDriveAuth
    ? "Twoje lokalne dane zostaną zastąpione przykładową kolekcją filmów i seriali.<br><br><div style='background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 10px; padding: 10px 12px; font-size: 0.8rem; color: var(--md-sys-color-on-surface);'>🛡️ <b>Twoja kopia na Dysku Google jest bezpieczna</b> (synchronizacja w chmurze została wstrzymana dla bazy demonstracyjnej).</div>"
    : "Twoje lokalne dane w pamięci przeglądarki zostaną zresetowane do bazy demonstracyjnej.";

  const confirmed = await showM3ConfirmDialog({
    title: "Załadować bazę demonstracyjną?",
    message: confirmMsg,
    confirmText: "Załaduj Demo",
    cancelText: "Anuluj",
    icon: "science",
    isDestructive: false
  });
  if (!confirmed) return;

  try {
    setActiveEnvMode("demo");
    showToastNotification("Ładowanie bazy demonstracyjnej...", "info");
    await loadData("demo");
    detectBackendEnvironment(false);
    closeEnvStatusModal();
    showToastNotification("🎉 Załadowano bazę demonstracyjną (Demo)!", "success");
  } catch (err) {
    console.error("Błąd podczas resetowania bazy:", err);
    showToastNotification("Wystąpił błąd podczas ładowania bazy demo.", "error");
  }
}

async function switchToClientEnvironment() {
  setActiveEnvMode("client");
  markUserDatabaseCustom();
  showToastNotification("Wczytywanie lokalnej bazy...", "info");
  await loadData("client");
  detectBackendEnvironment(false);
  closeEnvStatusModal();
  showToastNotification("🌐 Przełączono na lokalną bazę przeglądarki (LocalStorage)!", "info");
}

function initEnvSwitcherHandlers() {
  const btnSwitchFlask = document.getElementById("m3-btn-switch-flask");
  if (btnSwitchFlask) {
    btnSwitchFlask.addEventListener("click", switchToFlaskEnvironment);
  }

  const btnSwitchDemo = document.getElementById("m3-btn-switch-demo");
  if (btnSwitchDemo) {
    btnSwitchDemo.addEventListener("click", switchToDemoEnvironment);
  }

  const btnSwitchClient = document.getElementById("m3-btn-switch-client");
  if (btnSwitchClient) {
    btnSwitchClient.addEventListener("click", switchToClientEnvironment);
  }
}

function initEnvModalHandlers() {
  const btnEnvToggle = document.getElementById("m3-btn-env-toggle");
  if (btnEnvToggle) {
    btnEnvToggle.addEventListener("click", openEnvStatusModal);
  }

  const btnEnvClose = document.getElementById("m3-env-status-close");
  if (btnEnvClose) {
    btnEnvClose.addEventListener("click", closeEnvStatusModal);
  }

  const btnRecheckEnv = document.getElementById("m3-btn-recheck-env");
  if (btnRecheckEnv) {
    btnRecheckEnv.addEventListener("click", () => detectBackendEnvironment(true));
  }
}

function initSubmodules() {
  try { initSearchAndAddModal(); } catch (e) { console.error("Search module error:", e); }
  try { initCloudSyncHandlers(); } catch (e) { console.error("Cloud sync module error:", e); }
  try { initImporterHandlers(); } catch (e) { console.error("Importer module error:", e); }
  try { initVodSettingsHandlers(renderCurrentMode); } catch (e) { console.error("VOD module error:", e); }
  try { initThemeControls(); } catch (e) { console.error("Theme module error:", e); }
  try { initAnalyticsEvents(); } catch (e) { console.error("Analytics module error:", e); }
  try { initUpcomingFilters(); } catch (e) { console.error("Upcoming module error:", e); }
  try { initBackdropDismiss(); } catch (e) { console.error("Backdrop module error:", e); }
  try { initDemoBannerHandlers(openImporterModal); } catch (e) { console.error("Demo banner module error:", e); }
}

function handlePwaShareTarget() {
  try {
    const sp = new URLSearchParams(window.location.search);
    const sharedText = (sp.get("text") || "").trim();
    const sharedTitle = (sp.get("title") || "").trim();
    const sharedUrl = (sp.get("url") || "").trim();
    if (sharedText || sharedTitle || sharedUrl) {
      const query = [sharedTitle, sharedText].filter(Boolean).join(" ").trim();
      const keep = new URLSearchParams();
      const qMode = sp.get("mode");
      if (qMode) keep.set("mode", qMode);
      history.replaceState({}, "", `${window.location.pathname}?${keep.toString()}`.replace(/\?$/, ""));
      if (window.openAddModalWithQuery) {
        window.openAddModalWithQuery(query || sharedUrl);
      }
    }
  } catch (e) {}
}

function initApp() {
  try {
    applyInitialUrlState();
    initModeSwitcherListeners();
    initNavTabListeners();
    initHeaderSearchHandlers();
    initSortSelectorHandler();
    initScrollTopButton();
    initModalCloseHandlers();
    initHorizontalWheelScrolling();
    initEnvSwitcherHandlers();
    initEnvModalHandlers();

    // Accessibility: Escape closes sheets, focus moves in/out
    initSheetAccessibility();
  } catch (err) {
    console.error("Error setting up core DOM events:", err);
  }

  initSubmodules();

  // PWA share_target: tytuł/URL udostępniony do aplikacji -> prefill wyszukiwania
  handlePwaShareTarget();

  if (window.googleDriveSync) {
    try { window.googleDriveSync.init(); } catch (e) {}
  }

  detectBackendEnvironment(false);

  setMode(state.mode);

  loadData();
}

/**
 * Check whether local Flask backend is reachable or running as static GitHub Pages
 */
export async function detectBackendEnvironment(showFeedbackToast = false) {
  let isAvailable = false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("/api/movies", { method: "GET", signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      isAvailable = true;
    }
  } catch (e) {
    isAvailable = false;
  }

  state.backendAvailable = isAvailable;
  updateEnvStatusModalContent(isAvailable);
  updateDemoBannerVisibility();

  if (showFeedbackToast) {
    if (isAvailable) {
      showToastNotification("🟢 Połączono z serwerem Flask API!", "success");
    } else {
      showToastNotification("🌐 Tryb klienta statycznego (GitHub Pages)", "info");
    }
  }

  return isAvailable;
}

// Bridge: Drive sync reads the live library through an injected provider
// instead of legacy window.allMovies/window.allShows aliases.
if (window.googleDriveSync) {
  window.googleDriveSync.localLibraryProvider = () => ({
    movies: state.movies,
    shows: state.shows
  });
}

initImageErrorFallbacks();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
