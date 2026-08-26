// ==========================================================================
// CineLog - UI, Theming, Navigation & Modals Module
// ==========================================================================

import { state, isUserDatabaseDemo, getActiveEnvMode } from './state.js';

export function hexToHsl(hex) {
  if (!hex || typeof hex !== "string") hex = "#9333ea";
  let c = hex.replace(/^#/, '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  if (c.length !== 6) c = "9333ea";
  const num = parseInt(c, 16);
  if (isNaN(num)) return { h: 270, s: 70, l: 60 };

  let r = (num >> 16) / 255;
  let g = ((num >> 8) & 255) / 255;
  let b = (num & 255) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

export function applyMaterial3Theme() {
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

    document.querySelectorAll(".m3-theme-mode-btn").forEach(btn => {
      const modeAttr = btn.getAttribute("data-theme-mode");
      if (modeAttr) btn.classList.toggle("active", modeAttr === state.themeMode);
    });

    document.querySelectorAll(".m3-color-seed-btn").forEach(btn => {
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

export function showToastNotification(message, type = "success") {
  let toast = document.getElementById("m3-toast-notification");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "m3-toast-notification";
    toast.className = "m3-toast-notification";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }

  const iconName = type === "error" ? "error" : (type === "warning" ? "warning" : (type === "info" ? "info" : "check_circle"));
  const iconColor = type === "error" ? "#f43f5e" : (type === "warning" ? "#f59e0b" : "var(--md-sys-color-inverse-primary)");

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

export function openModal(sheetId) {
  const sheet = document.getElementById(sheetId);
  if (sheet) sheet.classList.add("active");
}

export function closeModal(sheetId) {
  const sheet = document.getElementById(sheetId);
  if (sheet) sheet.classList.remove("active");
}

export function initBackdropDismiss() {
  document.querySelectorAll(".m3-bottom-sheet").forEach(sheet => {
    sheet.addEventListener("click", (e) => {
      if (e.target === sheet) {
        sheet.classList.remove("active");
      }
    });
  });
}

export function initThemeControls() {
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

  document.querySelectorAll(".m3-theme-mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      state.themeMode = btn.getAttribute("data-theme-mode");
      localStorage.setItem("cinelog_theme_mode", state.themeMode);
      applyMaterial3Theme();
    });
  });

  document.querySelectorAll(".m3-color-seed-btn").forEach(btn => {
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

export function updateDemoBannerVisibility() {
  const banner = document.getElementById("m3-demo-notice-banner");
  if (!banner) return;
  const isDemo = isUserDatabaseDemo();
  const isDismissed = sessionStorage.getItem("cinelog_demo_banner_dismissed") === "true";
  if (isDemo && !isDismissed && !state.backendAvailable) {
    banner.style.display = "flex";
  } else {
    banner.style.display = "none";
  }
}

export function initDemoBannerHandlers(onOpenImporter) {
  const banner = document.getElementById("m3-demo-notice-banner");
  const btnImport = document.getElementById("m3-btn-demo-banner-import");
  const btnKeys = document.getElementById("m3-btn-demo-banner-keys");
  const btnDismiss = document.getElementById("m3-btn-demo-banner-dismiss");

  if (btnImport) {
    btnImport.addEventListener("click", () => {
      if (typeof onOpenImporter === "function") {
        onOpenImporter();
      }
    });
  }

  if (btnKeys) {
    btnKeys.addEventListener("click", () => {
      openEnvStatusModal();
    });
  }

  if (btnDismiss && banner) {
    btnDismiss.addEventListener("click", () => {
      banner.style.display = "none";
      sessionStorage.setItem("cinelog_demo_banner_dismissed", "true");
    });
  }

  updateDemoBannerVisibility();
}

export function updateEnvStatusModalContent(isBackendAvailable) {
  const badge = document.getElementById("m3-env-detected-badge");
  const desc = document.getElementById("m3-env-description-text");
  const list = document.getElementById("m3-env-features-list");
  const toggleText = document.getElementById("m3-env-toggle-text");
  const guideBox = document.getElementById("m3-env-key-guide-box");

  const versionEl = document.getElementById("m3-app-version");
  if (versionEl) {
    let version = "";
    const appScript = document.querySelector('script[src*="app.min.js?v="]');
    if (appScript) version = (appScript.src.match(/v=([\d.]+)/) || [])[1] || "";
    if (!version && navigator.serviceWorker?.controller) {
      version = new URL(navigator.serviceWorker.controller.scriptURL).searchParams.get("v") || "";
    }
    versionEl.textContent = version ? `v${version}` : "nieznana";
  }

  const cardFlask = document.getElementById("m3-mode-card-flask");
  const btnFlask = document.getElementById("m3-btn-switch-flask");
  const iconFlask = document.getElementById("m3-flask-card-icon");
  const descFlask = document.getElementById("m3-flask-card-desc");
  const cardDemo = document.getElementById("m3-mode-card-demo");
  const btnDemo = document.getElementById("m3-btn-switch-demo");
  const cardClient = document.getElementById("m3-mode-card-client");
  const btnClient = document.getElementById("m3-btn-switch-client");

  const currentMode = getActiveEnvMode();

  if (currentMode === "flask" && isBackendAvailable) {
    if (toggleText) toggleText.innerText = "Tryb: Flask API";
  } else if (currentMode === "demo") {
    if (toggleText) toggleText.innerText = "Tryb: Demo";
  } else {
    if (toggleText) toggleText.innerText = "Tryb: LocalStorage";
  }

  if (isBackendAvailable) {
    if (badge) {
      badge.innerText = "Połączono (Flask Backend)";
      badge.style.background = "rgba(16, 185, 129, 0.2)";
      badge.style.color = "#10b981";
      badge.style.border = "1px solid rgba(16, 185, 129, 0.4)";
    }
    if (desc) {
      desc.innerHTML = `🟢 <strong>Lokalny serwer Flask jest aktywny.</strong> Aplikacja może korzystać z backendu Python – dostępne jest wyszukiwanie filmów i seriali live z bazy TMDb oraz bezpośredni zapis na dysku.`;
    }
    if (list) {
      list.innerHTML = `
        <li>✅ Wyszukiwanie online i automatyczne pobieranie metadanych (TMDb)</li>
        <li>✅ Rekomendacje "Odkrywaj" i "Trendy" na żywo z TMDb</li>
        <li>✅ Lokalny magazyn JSON w katalogu <code>data/</code></li>
        <li>✅ Przeglądanie biblioteki, statystyki, śledzenie odcinków</li>
        <li>✅ Asystent AI (BYOK) i Google Drive Sync</li>
      `;
    }

    if (cardFlask) {
      cardFlask.style.opacity = "1";
      cardFlask.style.filter = "none";
      cardFlask.style.cursor = "default";
    }
    if (iconFlask) iconFlask.style.color = "var(--md-sys-color-primary)";
    if (descFlask) descFlask.innerHTML = `Baza danych z plików na Twoim dysku (data/)`;
    if (btnFlask) {
      btnFlask.disabled = false;
      btnFlask.style.cursor = "pointer";
      btnFlask.style.opacity = "1";
      btnFlask.innerText = (currentMode === "flask") ? "✓ Aktywny" : "Wczytaj";
    }
  } else {
    if (badge) {
      badge.innerText = "Statyczny (GitHub Pages / Klient)";
      badge.style.background = "var(--md-sys-color-surface-container-high)";
      badge.style.color = "var(--md-sys-color-on-surface)";
      badge.style.border = "1px solid var(--md-sys-color-outline-variant)";
    }
    if (desc) {
      desc.innerHTML = `🌐 <strong>Tryb klienta (statyczny / offline).</strong> Brak aktywnego połączenia z serwerem Flask. Baza danych i wszystkie operacje są w 100% przetwarzane lokalnie w Twojej przeglądarce (LocalStorage).`;
    }
    if (list) {
      list.innerHTML = `
        <li>✅ 100% prywatności – dane przechowywane wyłącznie w Twojej przeglądarce</li>
        <li>✅ Pełne przeglądanie, sortowanie, filtry VOD i statystyki biblioteki</li>
        <li>✅ Wyszukiwarka online TMDb – bezpośrednie dodawanie pozycji po wpisaniu klucza API</li>
        <li>✅ Uniwersalny import (Filmweb, TV Time, Letterboxd, IMDb, JSON)</li>
        <li>✅ Eksport do JSON, CSV oraz kalendarza iCal</li>
        <li>✅ Asystent AI (własny klucz API w przeglądarce) i kopia zapasowa Google Drive</li>
      `;
    }

    if (cardFlask) {
      cardFlask.style.opacity = "0.55";
      cardFlask.style.filter = "grayscale(50%)";
      cardFlask.style.cursor = "not-allowed";
    }
    if (iconFlask) iconFlask.style.color = "var(--md-sys-color-outline)";
    if (descFlask) descFlask.innerHTML = `<span style="color: var(--md-sys-color-error); font-weight: 600; font-size: 0.72rem;">Wymaga uruchomienia lokalnego backendu (<code>python app.py</code>)</span>`;
    if (btnFlask) {
      btnFlask.disabled = true;
      btnFlask.style.cursor = "not-allowed";
      btnFlask.style.opacity = "0.6";
      btnFlask.innerText = "Niedostępny (Offline)";
    }
  }

  // Reset all mode cards
  [cardFlask, cardDemo, cardClient].forEach(c => {
    if (c) {
      c.style.border = "1px solid var(--md-sys-color-outline-variant)";
      c.style.background = "var(--md-sys-color-surface-container)";
    }
  });

  if (btnDemo) btnDemo.innerText = (currentMode === "demo") ? "✓ Aktywne Demo" : "Załaduj Demo";
  if (btnClient) btnClient.innerText = (currentMode === "client") ? "✓ Aktywny" : "Wybierz";

  if (currentMode === "flask" && cardFlask && isBackendAvailable) {
    cardFlask.style.border = "1.5px solid #10b981";
    cardFlask.style.background = "rgba(16, 185, 129, 0.08)";
  } else if (currentMode === "demo" && cardDemo) {
    cardDemo.style.border = "1.5px solid #f59e0b";
    cardDemo.style.background = "rgba(245, 158, 11, 0.08)";
  } else if (currentMode === "client" && cardClient) {
    cardClient.style.border = "1.5px solid #38bdf8";
    cardClient.style.background = "rgba(56, 189, 248, 0.08)";
  }

  // Quick Key Setup Guide
  if (guideBox) {
    guideBox.innerHTML = `
      <div style="padding: 12px 14px; border-radius: 12px; background: var(--md-sys-color-surface-container-high); border: 1px solid var(--md-sys-color-outline-variant); font-size: 0.78rem; line-height: 1.55;">
        <div style="font-weight: 700; margin-bottom: 6px; color: var(--md-sys-color-primary); display: flex; align-items: center; gap: 6px;">
          <span class="material-symbols-rounded" style="font-size: 16px;">key</span> Konfiguracja kluczy API:
        </div>
        <div>• <strong>TMDb API (Odkrywaj & Nadchodzące):</strong> Wprowadź klucz w zakładce <em>Chmura & Asystent AI → Klucze API</em>.</div>
        <div>• <strong>OMDb / IMDb API:</strong> Podaj klucz OMDb w tej samej zakładce, aby pobierać oceny IMDb.</div>
        <div>• <strong>Asystent AI & Google Drive:</strong> Skonfiguruj w oknie <em>Chmura & Asystent AI</em>.</div>
      </div>
    `;
  }
}

export function openEnvStatusModal() {
  openModal("m3-sheet-env-status");
}

export function closeEnvStatusModal() {
  closeModal("m3-sheet-env-status");
}

export function showM3ConfirmDialog({
  title = "Czy na pewno?",
  message = "",
  confirmText = "Potwierdź",
  cancelText = "Anuluj",
  icon = "help_outline",
  isDestructive = false
} = {}) {
  return new Promise((resolve) => {
    let dialogEl = document.getElementById("m3-confirm-dialog-modal");
    if (!dialogEl) {
      dialogEl = document.createElement("div");
      dialogEl.id = "m3-confirm-dialog-modal";
      dialogEl.className = "m3-modal-backdrop";
      document.body.appendChild(dialogEl);
    }

    const iconBg = isDestructive ? "rgba(239, 68, 68, 0.15)" : "var(--md-sys-color-primary-container)";
    const iconFg = isDestructive ? "#ef4444" : "var(--md-sys-color-on-primary-container)";
    const confirmBtnBg = isDestructive ? "#ef4444" : "var(--md-sys-color-primary)";
    const confirmBtnFg = isDestructive ? "#ffffff" : "var(--md-sys-color-on-primary)";

    dialogEl.innerHTML = `
      <div class="m3-dialog-card" role="dialog" aria-modal="true">
        <div style="width: 48px; height: 48px; border-radius: 14px; background: ${iconBg}; color: ${iconFg}; display: flex; align-items: center; justify-content: center; margin-bottom: 14px;">
          <span class="material-symbols-rounded" style="font-size: 26px;">${icon}</span>
        </div>
        <h3 class="m3-dialog-title">${title}</h3>
        <div class="m3-dialog-message">${message}</div>
        <div class="m3-dialog-actions">
          <button type="button" class="m3-chip" id="m3-dialog-btn-cancel" style="padding: 10px 18px; font-weight: 700; border-radius: var(--md-corner-full);">${cancelText}</button>
          <button type="button" class="m3-btn-action-primary" id="m3-dialog-btn-confirm" style="background: ${confirmBtnBg}; color: ${confirmBtnFg}; padding: 10px 22px; font-weight: 700; border-radius: var(--md-corner-full);">${confirmText}</button>
        </div>
      </div>
    `;

    dialogEl.classList.add("active");

    const closeDialog = (result) => {
      dialogEl.classList.remove("active");
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    };

    const cancelBtn = dialogEl.querySelector("#m3-dialog-btn-cancel");
    const confirmBtn = dialogEl.querySelector("#m3-dialog-btn-confirm");

    if (cancelBtn) cancelBtn.onclick = () => closeDialog(false);
    if (confirmBtn) confirmBtn.onclick = () => closeDialog(true);
    dialogEl.onclick = (e) => {
      if (e.target === dialogEl) closeDialog(false);
    };

    const onKeyDown = (e) => {
      if (e.key === "Escape") closeDialog(false);
      if (e.key === "Enter") closeDialog(true);
    };
    document.addEventListener("keydown", onKeyDown);
    if (confirmBtn) confirmBtn.focus();
  });
}

window.showM3ConfirmDialog = showM3ConfirmDialog;


