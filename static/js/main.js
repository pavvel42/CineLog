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

// Setup DOM Events
function initApp() {
  try {
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

    // 1. Mode switcher listeners
    const btnMovies = document.getElementById("m3-mode-movies");
    const btnShows = document.getElementById("m3-mode-shows");
    const mobileBtnMovies = document.getElementById("m3-mobile-btn-movies");
    const mobileBtnShows = document.getElementById("m3-mobile-btn-shows");

    if (btnMovies) btnMovies.addEventListener("click", () => setMode("movies"));
    if (btnShows) btnShows.addEventListener("click", () => setMode("shows"));
    if (mobileBtnMovies) mobileBtnMovies.addEventListener("click", () => setMode("movies"));
    if (mobileBtnShows) mobileBtnShows.addEventListener("click", () => setMode("shows"));

    // 2. Navigation tab listeners
    document.querySelectorAll(".m3-nav-item, .m3-bottom-nav-item").forEach(item => {
      item.addEventListener("click", (e) => {
        const tab = e.currentTarget.getAttribute("data-tab");
        if (tab) switchTab(tab);
      });
    });

    // 3. Search Input in Header
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

    // 4. Sort Selector Handler
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

    // 5. Scroll To Top button handler
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

    // 6. Modal Close Handlers
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

    // 7. Smooth mouse-wheel horizontal scrolling
    document.querySelectorAll(".m3-season-tabs, .m3-vod-filter-bar, .m3-mode-switcher").forEach(el => {
      el.addEventListener("wheel", (evt) => {
        if (evt.deltaY !== 0 && !evt.shiftKey) {
          evt.preventDefault();
          el.scrollLeft += evt.deltaY * 0.85;
        }
      }, { passive: false });
    });

    // 8. Environment & Mode Switchers
    const btnSwitchFlask = document.getElementById("m3-btn-switch-flask");
    if (btnSwitchFlask) {
      btnSwitchFlask.addEventListener("click", async () => {
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
      });
    }

    const btnSwitchDemo = document.getElementById("m3-btn-switch-demo");
    if (btnSwitchDemo) {
      btnSwitchDemo.addEventListener("click", async () => {
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
      });
    }

    const btnSwitchClient = document.getElementById("m3-btn-switch-client");
    if (btnSwitchClient) {
      btnSwitchClient.addEventListener("click", async () => {
        setActiveEnvMode("client");
        markUserDatabaseCustom();
        showToastNotification("Wczytywanie lokalnej bazy...", "info");
        await loadData("client");
        detectBackendEnvironment(false);
        closeEnvStatusModal();
        showToastNotification("🌐 Przełączono na lokalną bazę przeglądarki (LocalStorage)!", "info");
      });
    }

    // 9. Environment Toggle & Status Modal Handlers
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
  } catch (err) {
    console.error("Error setting up core DOM events:", err);
  }

  // 10. Initialize Submodules safely
  try { initSearchAndAddModal(); } catch (e) { console.error("Search module error:", e); }
  try { initCloudSyncHandlers(); } catch (e) { console.error("Cloud sync module error:", e); }
  try { initImporterHandlers(); } catch (e) { console.error("Importer module error:", e); }
  try { 
    initVodSettingsHandlers(() => {
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  } catch (e) { console.error("VOD module error:", e); }
  try { initThemeControls(); } catch (e) { console.error("Theme module error:", e); }
  try { initAnalyticsEvents(); } catch (e) { console.error("Analytics module error:", e); }
  try { initUpcomingFilters(); } catch (e) { console.error("Upcoming module error:", e); }
  try { initBackdropDismiss(); } catch (e) { console.error("Backdrop module error:", e); }
  try { initDemoBannerHandlers(openImporterModal); } catch (e) { console.error("Demo banner module error:", e); }

  if (window.googleDriveSync) {
    try { window.googleDriveSync.init(); } catch (e) {}
  }

  // 11. Detect Backend vs Static Client Environment
  detectBackendEnvironment(false);

  // 12. Synchronize initial UI mode and navigation
  setMode(state.mode);

  // 13. Load Initial Library Data
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
