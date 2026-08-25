// ==========================================================================
// CineLog - Google Drive Cloud Sync, Local Backup & AI Configuration Module
// ==========================================================================

import { state, saveLocalDatabase, markUserDatabaseCustom, syncWindowAliases, escapeHtml } from './state.js';
import { showToastNotification, showM3ConfirmDialog } from './ui.js';
import { updateStats } from './stats.js';
import { renderMovies } from './movies.js';
import { renderShows } from './shows.js';
import { getAiConfig, saveAiConfig, testAiConnection, AI_PRESETS } from './ai.js';
import { handleImportFile } from './importer.js';

export function updateDriveModalUI() {
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
    if (inputClientId) inputClientId.value = localStorage.getItem("gdrive_client_id") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.GOOGLE_CLIENT_ID) || "";
  }
}

export function updateAiSettingsUI() {
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

  // Highlight provider chip
  const providerChips = document.querySelectorAll("#m3-ai-provider-chips [data-provider]");
  providerChips.forEach(chip => {
    if (chip.getAttribute("data-provider") === provider) {
      chip.classList.add("active");
    } else {
      chip.classList.remove("active");
    }
  });

  // Adjust placeholder & hint
  const preset = AI_PRESETS[provider] || AI_PRESETS.openai;
  if (apiKeyInput) apiKeyInput.placeholder = preset.placeholder;
}

export function updateApiKeysUI() {
  const tmdbInput = document.getElementById("m3-key-tmdb-input");
  const omdbInput = document.getElementById("m3-key-omdb-input");
  const statusBox = document.getElementById("m3-keys-test-status");

  if (tmdbInput) tmdbInput.value = localStorage.getItem("cinelog_tmdb_key") || "";
  if (omdbInput) omdbInput.value = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key") || "";
  if (statusBox) statusBox.style.display = "none";
}

export function openCloudSyncModal(initialTab = "drive") {
  updateDriveModalUI();
  updateApiKeysUI();
  updateAiSettingsUI();

  // 3-way Tab switching
  const tabDrive = document.getElementById("m3-tab-cloud-drive");
  const tabKeys = document.getElementById("m3-tab-cloud-keys");
  const tabAi = document.getElementById("m3-tab-cloud-ai");
  const panelDrive = document.getElementById("m3-panel-cloud-drive");
  const panelKeys = document.getElementById("m3-panel-cloud-keys");
  const panelAi = document.getElementById("m3-panel-cloud-ai");

  const tabs = [
    { name: "drive", tab: tabDrive, panel: panelDrive },
    { name: "keys", tab: tabKeys, panel: panelKeys },
    { name: "ai", tab: tabAi, panel: panelAi }
  ];

  tabs.forEach(t => {
    if (!t.tab || !t.panel) return;
    if (t.name === initialTab) {
      t.tab.classList.add("active");
      t.panel.style.display = "flex";
    } else {
      t.tab.classList.remove("active");
      t.panel.style.display = "none";
    }
  });

  const sheet = document.getElementById("m3-sheet-cloud-sync");
  if (sheet) sheet.classList.add("active");
}

export function initCloudSyncHandlers() {
  initCloudModalShell();
  initApiKeysSection();
  initAiSettingsSection();
  initDriveSection();
}

function initCloudModalShell() {
  // Otwieranie/zamykanie modala i przełącznik zakładek (Drive / Klucze / AI).

const sheetCloudSync = document.getElementById("m3-sheet-cloud-sync");
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

// Segmented Tabs Switcher (3 Tabs)
const tabDrive = document.getElementById("m3-tab-cloud-drive");
const tabKeys = document.getElementById("m3-tab-cloud-keys");
const tabAi = document.getElementById("m3-tab-cloud-ai");
const panelDrive = document.getElementById("m3-panel-cloud-drive");
const panelKeys = document.getElementById("m3-panel-cloud-keys");
const panelAi = document.getElementById("m3-panel-cloud-ai");

const switchTab = (targetName) => {
  const tabs = [
    { name: "drive", tab: tabDrive, panel: panelDrive },
    { name: "keys", tab: tabKeys, panel: panelKeys },
    { name: "ai", tab: tabAi, panel: panelAi }
  ];
  tabs.forEach(t => {
    if (!t.tab || !t.panel) return;
    if (t.name === targetName) {
      t.tab.classList.add("active");
      t.panel.style.display = "flex";
    } else {
      t.tab.classList.remove("active");
      t.panel.style.display = "none";
    }
  });
  if (targetName === "keys") updateApiKeysUI();
  if (targetName === "ai") updateAiSettingsUI();
};

if (tabDrive) tabDrive.addEventListener("click", () => switchTab("drive"));
if (tabKeys) tabKeys.addEventListener("click", () => switchTab("keys"));
if (tabAi) tabAi.addEventListener("click", () => switchTab("ai"));
}

function initApiKeysSection() {
  // Zakładka "Klucze API": widoczność pól, walidacja, zapis, czyszczenie, test.
// API Keys Visibility Toggles
const setupKeyVisToggle = (btnId, inputId) => {
  const btn = document.getElementById(btnId);
  const inp = document.getElementById(inputId);
  if (btn && inp) {
    btn.addEventListener("click", () => {
      const isMasked = inp.style.webkitTextSecurity === "disc" || !inp.style.webkitTextSecurity;
      if (isMasked) {
        inp.style.webkitTextSecurity = "none";
        btn.innerText = "visibility_off";
      } else {
        inp.style.webkitTextSecurity = "disc";
        btn.innerText = "visibility";
      }
    });
  }
};
setupKeyVisToggle("m3-key-tmdb-vis", "m3-key-tmdb-input");
setupKeyVisToggle("m3-key-omdb-vis", "m3-key-omdb-input");

// Helper for testing & validating API keys
const validateApiKeys = async (tmdbVal, omdbVal) => {
  let tmdbStatus = { ok: null, message: "" };
  let omdbStatus = { ok: null, message: "" };

  // Test TMDb
  if (tmdbVal) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/authentication?api_key=${tmdbVal}`);
      if (res.ok) {
        tmdbStatus = { ok: true, message: "🟢 <strong>TMDb API:</strong> Klucz poprawny (Połączono)" };
      } else {
        tmdbStatus = { ok: false, message: `🔴 <strong>TMDb API:</strong> Błąd autoryzacji (${res.status})` };
      }
    } catch (e) {
      tmdbStatus = { ok: false, message: `🟡 <strong>TMDb API:</strong> Błąd sieci: ${e.message}` };
    }
  }

  // Test OMDb
  if (omdbVal) {
    try {
      const res = await fetch(`https://www.omdbapi.com/?apikey=${omdbVal}&s=Inception`);
      const data = await res.json();
      if (data.Response === "True") {
        omdbStatus = { ok: true, message: "🟢 <strong>OMDb / IMDb API:</strong> Klucz poprawny (Połączono)" };
      } else {
        omdbStatus = { ok: false, message: `🔴 <strong>OMDb / IMDb API:</strong> ${data.Error || "Błąd klucza"}` };
      }
    } catch (e) {
      omdbStatus = { ok: false, message: `🟡 <strong>OMDb / IMDb API:</strong> Błąd sieci: ${e.message}` };
    }
  }

  return { tmdbStatus, omdbStatus };
};

// Save API Keys with Live Validation & Auto-Refresh
const btnSaveKeys = document.getElementById("m3-btn-save-api-keys");
const keysStatusBox = document.getElementById("m3-keys-test-status");
const tmdbInputEl = document.getElementById("m3-key-tmdb-input");
const omdbInputEl = document.getElementById("m3-key-omdb-input");

if (btnSaveKeys) {
  btnSaveKeys.addEventListener("click", async () => {
    const tmdbVal = tmdbInputEl?.value.trim() || "";
    const omdbVal = omdbInputEl?.value.trim() || "";

    if (!tmdbVal && !omdbVal) {
      localStorage.removeItem("cinelog_tmdb_key");
      localStorage.removeItem("cinelog_omdb_key");
      localStorage.removeItem("cinelog_imdb_key");
      if (keysStatusBox) {
        keysStatusBox.style.display = "block";
        keysStatusBox.style.background = "var(--md-sys-color-surface-container)";
        keysStatusBox.style.color = "var(--md-sys-color-on-surface)";
        keysStatusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
        keysStatusBox.innerHTML = "Wyczyszczono wszystkie klucze API.";
      }
      showToastNotification("Wyczyszczono zapisane klucze API.", "info");
      return;
    }

    const origBtnHtml = btnSaveKeys.innerHTML;
    btnSaveKeys.disabled = true;
    btnSaveKeys.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 18px; vertical-align: middle;">sync</span> Sprawdzam klucze...`;

    if (keysStatusBox) {
      keysStatusBox.style.display = "block";
      keysStatusBox.style.background = "var(--md-sys-color-surface-container-high)";
      keysStatusBox.style.color = "var(--md-sys-color-primary)";
      keysStatusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
      keysStatusBox.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; vertical-align: middle; font-size: 16px;">sync</span> Weryfikuję poprawność wprowadzonych kluczy...`;
    }

    const { tmdbStatus, omdbStatus } = await validateApiKeys(tmdbVal, omdbVal);
    const results = [];
    let anyFailed = false;
    let anySaved = false;

    // Handle TMDb
    if (tmdbVal) {
      if (tmdbStatus.ok) {
        localStorage.setItem("cinelog_tmdb_key", tmdbVal);
        results.push(tmdbStatus.message);
        anySaved = true;
      } else {
        localStorage.removeItem("cinelog_tmdb_key");
        if (tmdbInputEl) tmdbInputEl.value = "";
        results.push(tmdbStatus.message + " — <em>Klucz wyczyszczony (niepoprawny)</em>");
        anyFailed = true;
      }
    } else {
      localStorage.removeItem("cinelog_tmdb_key");
    }

    // Handle OMDb / IMDb
    if (omdbVal) {
      if (omdbStatus.ok) {
        localStorage.setItem("cinelog_omdb_key", omdbVal);
        localStorage.setItem("cinelog_imdb_key", omdbVal);
        results.push(omdbStatus.message);
        anySaved = true;
      } else {
        localStorage.removeItem("cinelog_omdb_key");
        localStorage.removeItem("cinelog_imdb_key");
        if (omdbInputEl) omdbInputEl.value = "";
        results.push(omdbStatus.message + " — <em>Klucz wyczyszczony (niepoprawny)</em>");
        anyFailed = true;
      }
    } else {
      localStorage.removeItem("cinelog_omdb_key");
      localStorage.removeItem("cinelog_imdb_key");
    }

    btnSaveKeys.disabled = false;
    btnSaveKeys.innerHTML = origBtnHtml;

    if (keysStatusBox) {
      keysStatusBox.style.background = anyFailed && !anySaved 
        ? "rgba(239, 68, 68, 0.12)" 
        : "var(--md-sys-color-surface-container)";
      keysStatusBox.style.color = anyFailed && !anySaved ? "#ef4444" : "var(--md-sys-color-on-surface)";
      keysStatusBox.style.border = anyFailed && !anySaved 
        ? "1px solid rgba(239, 68, 68, 0.35)" 
        : "1px solid var(--md-sys-color-outline-variant)";
      keysStatusBox.innerHTML = results.join("<br>");
    }

    if (anyFailed && !anySaved) {
      showToastNotification("Wprowadzony klucz jest niepoprawny i został wyczyszczony.", "error");
    } else if (anyFailed && anySaved) {
      showToastNotification("Zapisano poprawny klucz. Niepoprawne klucze zostały wyczyszczone.", "warning");
    } else {
      showToastNotification("Klucze zweryfikowane pomyślnie! Odświeżono powiązane dane.", "success");
    }

    // Auto-refresh dependent views (Recommendations "Dla Ciebie", VOD bar, etc.)
    if (anySaved) {
      if (typeof window.loadRecommendationsHub === "function") {
        window.loadRecommendationsHub(true);
      }
      if (typeof window.renderTopVodFilterBar === "function") {
        window.renderTopVodFilterBar();
      }
    }
  });
}

// Clear API Keys
const btnClearKeys = document.getElementById("m3-btn-clear-api-keys");
if (btnClearKeys) {
  btnClearKeys.addEventListener("click", async () => {
    const confirmed = await showM3ConfirmDialog({
      title: "Wyczyścić klucze API?",
      message: "Czy na pewno chcesz usunąć zapisane w przeglądarce klucze TMDb i OMDb/IMDb?",
      confirmText: "Wyczyść klucze",
      cancelText: "Anuluj",
      icon: "vpn_key_off",
      isDestructive: true
    });
    if (!confirmed) return;
    localStorage.removeItem("cinelog_tmdb_key");
    localStorage.removeItem("cinelog_omdb_key");
    updateApiKeysUI();
    if (keysStatusBox) {
      keysStatusBox.style.display = "block";
      keysStatusBox.style.background = "var(--md-sys-color-surface-container)";
      keysStatusBox.style.color = "var(--md-sys-color-on-surface)";
      keysStatusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
      keysStatusBox.innerHTML = "Wyczyszczono zapisane klucze API.";
    }
    showToastNotification("Wyczyszczono zapisane klucze API.", "info");
    if (typeof window.loadRecommendationsHub === "function") {
      window.loadRecommendationsHub(true);
    }
  });
}

// Test API Keys (Standalone Test Button)
const btnTestKeys = document.getElementById("m3-btn-test-api-keys");
if (btnTestKeys) {
  btnTestKeys.addEventListener("click", async () => {
    const tmdbVal = tmdbInputEl?.value.trim() || "";
    const omdbVal = omdbInputEl?.value.trim() || "";

    if (!tmdbVal && !omdbVal) {
      if (keysStatusBox) {
        keysStatusBox.style.display = "block";
        keysStatusBox.style.background = "rgba(239, 68, 68, 0.12)";
        keysStatusBox.style.color = "#ef4444";
        keysStatusBox.style.border = "1px solid rgba(239, 68, 68, 0.35)";
        keysStatusBox.innerHTML = "Wprowadź co najmniej jeden klucz API, aby przeprowadzić test.";
      }
      return;
    }

    if (keysStatusBox) {
      keysStatusBox.style.display = "block";
      keysStatusBox.style.background = "var(--md-sys-color-surface-container-high)";
      keysStatusBox.style.color = "var(--md-sys-color-primary)";
      keysStatusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
      keysStatusBox.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; vertical-align: middle; font-size: 16px;">sync</span> Testuję połączenie z zewnętrznymi API...`;
    }

    const { tmdbStatus, omdbStatus } = await validateApiKeys(tmdbVal, omdbVal);
    const results = [];
    if (tmdbVal) results.push(tmdbStatus.message);
    if (omdbVal) results.push(omdbStatus.message);

    if (keysStatusBox) {
      keysStatusBox.style.background = "var(--md-sys-color-surface-container)";
      keysStatusBox.style.color = "var(--md-sys-color-on-surface)";
      keysStatusBox.style.border = "1px solid var(--md-sys-color-outline-variant)";
      keysStatusBox.innerHTML = results.join("<br>");
    }
  });
}
}

function initAiSettingsSection() {
  // Zakładka "Asystent AI": dostawcy, klucz, test, zapis, czyszczenie.

const sheetCloudSync = document.getElementById("m3-sheet-cloud-sync");
// AI Provider Chips Selection
const providerChips = document.querySelectorAll("#m3-ai-provider-chips [data-provider]");
providerChips.forEach(chip => {
  chip.addEventListener("click", () => {
    providerChips.forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    const pKey = chip.getAttribute("data-provider");
    const preset = AI_PRESETS[pKey] || AI_PRESETS.openai;

    const modelInput = document.getElementById("m3-ai-model");
    const baseUrlInput = document.getElementById("m3-ai-base-url");
    const apiKeyInput = document.getElementById("m3-ai-api-key");

    if (modelInput) modelInput.value = preset.defaultModel;
    if (baseUrlInput) baseUrlInput.value = preset.baseUrl;
    if (apiKeyInput) apiKeyInput.placeholder = preset.placeholder;
  });
});

// Toggle API Key Visibility (without triggering browser password managers)
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

// Test AI Connection
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
      statusBox.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; vertical-align: middle; font-size: 16px;">sync</span> Testuję połączenie z modelem <strong>${modelVal}</strong>...`;
    }

    const res = await testAiConnection({
      provider: provider,
      apiKey: keyVal,
      baseUrl: baseUrlVal,
      model: modelVal
    });

    if (statusBox) {
      if (res.success) {
        statusBox.style.background = "rgba(16, 185, 129, 0.12)";
        statusBox.style.color = "#10b981";
        statusBox.style.border = "1px solid rgba(16, 185, 129, 0.35)";
        statusBox.innerHTML = `🟢 <strong>Połączono pomyślnie!</strong> Model <em>${escapeHtml(res.model)}</em> odpowiedział w ${escapeHtml(res.elapsed)}ms.`;
      } else {
        statusBox.style.background = "rgba(239, 68, 68, 0.12)";
        statusBox.style.color = "#ef4444";
        statusBox.style.border = "1px solid rgba(239, 68, 68, 0.35)";
        statusBox.innerHTML = `🔴 <strong>Błąd połączenia:</strong> ${escapeHtml(res.error)}`;
      }
    }
  });
}

// Save AI Config
const btnAiSave = document.getElementById("m3-btn-ai-save");
if (btnAiSave) {
  btnAiSave.addEventListener("click", () => {
    const activeChip = document.querySelector("#m3-ai-provider-chips [data-provider].active");
    const provider = activeChip ? activeChip.getAttribute("data-provider") : "openai";
    const keyVal = apiKeyInput ? apiKeyInput.value.trim() : "";
    const modelVal = document.getElementById("m3-ai-model") ? document.getElementById("m3-ai-model").value.trim() : "gpt-4o-mini";
    const baseUrlVal = document.getElementById("m3-ai-base-url") ? document.getElementById("m3-ai-base-url").value.trim() : "https://api.openai.com/v1";

    saveAiConfig({
      provider: provider,
      apiKey: keyVal,
      baseUrl: baseUrlVal,
      model: modelVal,
      enabled: true
    });

    showToastNotification("Zapisano ustawienia asystenta AI!", "success");
    if (sheetCloudSync) sheetCloudSync.classList.remove("active");
  });
}

// Clear AI Config
const btnAiClear = document.getElementById("m3-btn-ai-clear");
if (btnAiClear) {
  btnAiClear.addEventListener("click", async () => {
    const confirmed = await showM3ConfirmDialog({
      title: "Usunąć konfigurację AI?",
      message: "Czy na pewno chcesz usunąć klucz API i przywrócić domyślne ustawienia asystenta AI?",
      confirmText: "Usuń i zresetuj",
      cancelText: "Anuluj",
      icon: "delete_sweep",
      isDestructive: true
    });
    if (!confirmed) return;
    localStorage.removeItem("cinelog_ai_config");
    updateAiSettingsUI();
    showToastNotification("Usunięto klucz i zresetowano konfigurację AI.", "info");
  });
}
}

function initDriveSection() {
  // Zakładka "Dysk Google": connect/disconnect/pull oraz import z pliku.

const inputClientId = document.getElementById("m3-gdrive-client-id");
// Google Drive Connect
const btnConnect = document.getElementById("m3-btn-gdrive-connect");
if (btnConnect) {
  btnConnect.addEventListener("click", () => {
    const inputId = inputClientId ? inputClientId.value.trim() : "";
    const configId = (window.CINELOG_CONFIG && window.CINELOG_CONFIG.GOOGLE_CLIENT_ID) ? window.CINELOG_CONFIG.GOOGLE_CLIENT_ID.trim() : "";
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
        saveLocalDatabase();
        markUserDatabaseCustom();
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
      btnPull.disabled = true;
      const origText = btnPull.innerHTML;
      btnPull.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 16px;">sync</span> Pobieram...`;
      
      try {
        const data = await window.googleDriveSync.downloadFromDrive();
        if (data && (data.movies || data.shows)) {
          state.movies = Array.isArray(data.movies) ? data.movies : [];
          state.shows = Array.isArray(data.shows) ? data.shows : [];
          saveLocalDatabase();
          markUserDatabaseCustom();
          syncWindowAliases();
          updateStats();

          // Re-render library immediately
          if (state.mode === "movies") renderMovies();
          else renderShows();

          // Refresh recommendations if active
          if (typeof window.loadRecommendationsHub === "function") {
            window.loadRecommendationsHub(true);
          }

          // Close sheet and show confirmation
          const sheet = document.getElementById("m3-sheet-cloud-sync");
          if (sheet) sheet.classList.remove("active");

          showToastNotification(`Wczytano z Dysku Google: ${state.movies.length} filmów, ${state.shows.length} seriali! ✨`, "success");
        } else {
          showToastNotification("Nie znaleziono pliku bazy na Dysku. Upewnij się, że na drugim urządzeniu kliknięto 'Wyślij do Chmury'.", "warning");
        }
      } catch (e) {
        showToastNotification("Błąd podczas pobierania bazy z Dysku Google.", "error");
      } finally {
        btnPull.innerHTML = origText;
        btnPull.disabled = false;
      }
    }
  });
}

const btnPush = document.getElementById("m3-btn-gdrive-push");
if (btnPush) {
  btnPush.addEventListener("click", async () => {
    if (window.googleDriveSync) {
      btnPush.disabled = true;
      const origText = btnPush.innerHTML;
      btnPush.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 18px;">sync</span> Zapisuję na Dysku...`;
      
      try {
        const ok = await window.googleDriveSync.uploadToDrive(state.movies, state.shows);
        if (ok) {
          showToastNotification(`Przesłano bibliotekę (${state.movies.length} filmów, ${state.shows.length} seriali) na Dysk Google! ☁️`, "success");
        } else {
          showToastNotification("Błąd zapisu na Dysku Google. Spróbuj zalogować się ponownie.", "error");
        }
      } catch (e) {
        showToastNotification("Błąd zapisu na Dysku Google.", "error");
      } finally {
        btnPush.innerHTML = origText;
        btnPush.disabled = false;
      }
    }
  });
}

const btnMerge = document.getElementById("m3-btn-gdrive-merge");
if (btnMerge) {
  btnMerge.addEventListener("click", async () => {
    if (window.googleDriveSync) {
      btnMerge.disabled = true;
      const origText = btnMerge.innerHTML;
      btnMerge.innerHTML = `<span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 16px;">sync</span> Scalam...`;

      try {
        const cloudData = await window.googleDriveSync.downloadFromDrive();
        if (cloudData) {
          const merged = window.googleDriveSync.mergeLibraries(state.movies, state.shows, cloudData.movies, cloudData.shows);
          state.movies = merged.movies;
          state.shows = merged.shows;
          saveLocalDatabase();
          markUserDatabaseCustom();
          syncWindowAliases();
          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();

          if (typeof window.loadRecommendationsHub === "function") {
            window.loadRecommendationsHub(true);
          }
          
          await window.googleDriveSync.uploadToDrive(state.movies, state.shows);

          const sheet = document.getElementById("m3-sheet-cloud-sync");
          if (sheet) sheet.classList.remove("active");

          showToastNotification(`Pomyślnie scalono bazę! Stan: ${state.movies.length} filmów, ${state.shows.length} seriali. ✨`, "success");
        } else {
          await window.googleDriveSync.uploadToDrive(state.movies, state.shows);
          showToastNotification("Utworzono nową bazę na Dysku Google z Twojej aktualnej biblioteki.", "success");
        }
      } catch(e) {
        showToastNotification("Błąd podczas scalania bazy.", "error");
      } finally {
        btnMerge.innerHTML = origText;
        btnMerge.disabled = false;
      }
    }
  });
}

// Local File Import (Universal: JSON, Filmweb CSV, Letterboxd CSV, IMDb CSV)
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
}


window.openCloudSyncModal = openCloudSyncModal;
window.updateDriveModalUI = updateDriveModalUI;
window.updateApiKeysUI = updateApiKeysUI;
window.updateAiSettingsUI = updateAiSettingsUI;
