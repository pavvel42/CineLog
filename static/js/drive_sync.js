// Google Drive BYO-Cloud Database & Settings Synchronization Module (Client-Side REST API)

const DRIVE_DATABASE_FILE_NAME = "cinelog_database.json";
const DRIVE_SETTINGS_FILE_NAME = "cinelog_settings.json";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.file";

class GoogleDriveSync {
  constructor() {
    this.tokenClient = null;
    this.accessToken = localStorage.getItem("gdrive_access_token") || null;
    this.tokenExpiresAt = parseInt(localStorage.getItem("gdrive_token_exp") || "0", 10);
    this.databaseFileId = localStorage.getItem("gdrive_file_id") || null;
    this.settingsFileId = localStorage.getItem("gdrive_settings_file_id") || null;
    this.lastSyncTime = localStorage.getItem("gdrive_last_sync") || null;
    this.clientId = localStorage.getItem("gdrive_client_id") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.GOOGLE_CLIENT_ID) || "";
    this.isSyncing = false;
    this.debounceTimer = null;
  }

  init() {
    this.updateStatusUI();
    if (this.clientId && !this.isAuthorized() && this.accessToken) {
      setTimeout(() => {
        this.ensureValidToken();
      }, 1000);
    }
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
    if (!window.google || !window.google.accounts) {
      console.warn("Google Identity Services script not loaded yet.");
      return;
    }

    this.clientId = clientId;
    localStorage.setItem("gdrive_client_id", clientId);

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse.error !== undefined) {
          console.error("Auth error:", tokenResponse);
          this.updateStatusUI("error", "Błąd autoryzacji Google");
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
      }
    });
  }

  connect(clientId, onSuccess) {
    this.onAuthSuccess = onSuccess;
    this.initTokenClient(clientId, () => {
      this.syncWithDrive(onSuccess);
      if (window.updateDriveModalUI) window.updateDriveModalUI();
    });

    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: "consent" });
    }
  }

  disconnect() {
    if (this.accessToken && window.google && window.google.accounts) {
      try {
        google.accounts.oauth2.revoke(this.accessToken, () => {
          console.log("Google Token revoked");
        });
      } catch (e) {}
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

    this.updateStatusUI("disconnected");
  }

  async findFileByName(fileName, cachedIdKey) {
    const cachedId = localStorage.getItem(cachedIdKey);
    if (cachedId) {
      try {
        const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${cachedId}?fields=id,name,trashed`, {
          headers: { Authorization: `Bearer ${this.accessToken}` }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (!checkData.trashed && checkData.name === fileName) return cachedId;
        }
      } catch (e) {}
    }

    const q = encodeURIComponent(`name = '${fileName}' and trashed = false`);
    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        const foundId = data.files[0].id;
        localStorage.setItem(cachedIdKey, foundId);
        return foundId;
      }
    }

    return null;
  }

  // --- DATABASE SYNC (cinelog_database.json) ---
  async downloadFromDrive() {
    await this.ensureValidToken();
    if (!this.isAuthorized()) return null;

    const fileId = await this.findFileByName(DRIVE_DATABASE_FILE_NAME, "gdrive_file_id");
    if (!fileId) return null;

    try {
      this.updateStatusUI("syncing", "Pobieram bazę z Dysku...");
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });

      if (res.ok) {
        const payload = await res.json();
        this.databaseFileId = fileId;
        this.lastSyncTime = new Date().toISOString();
        localStorage.setItem("gdrive_last_sync", this.lastSyncTime);
        this.updateStatusUI("connected", "Baza pobrana z Google Drive");
        return payload;
      }
    } catch (err) {
      console.error("Error downloading database from Drive:", err);
      this.updateStatusUI("error", "Błąd pobierania bazy z Dysku");
    }
    return null;
  }

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
        shows: shows
      };

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
        this.databaseFileId = data.id;
        localStorage.setItem("gdrive_file_id", this.databaseFileId);
        this.lastSyncTime = new Date().toISOString();
        localStorage.setItem("gdrive_last_sync", this.lastSyncTime);
        this.updateStatusUI("connected", "Zsynchronizowano z Google Drive");
        return true;
      }
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

    const fileId = await this.findFileByName(DRIVE_SETTINGS_FILE_NAME, "gdrive_settings_file_id");
    if (!fileId) return null;

    try {
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

  async uploadSettingsToDrive(country, subscriptions) {
    if (!this.isAuthorized()) return false;

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
    } catch (err) {
      console.error("Error uploading settings to Drive:", err);
    }
    return false;
  }

  triggerAutoSave(movies, shows) {
    if (!this.isAuthorized()) return;

    // 🛡️ CRITICAL SAFETY GUARD: Never auto-sync to Google Drive if local database is marked as Demo/default
    const isCustom = localStorage.getItem("cinelog_user_imported") === "true";
    if (!isCustom) {
      console.warn("🛡️ Google Drive Auto-Save wstrzymany: aktywna baza jest bazą demonstracyjną (Demo).");
      return;
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.updateStatusUI("syncing", "Oczekuję na zapis...");

    this.debounceTimer = setTimeout(() => {
      this.uploadToDrive(movies, shows);
    }, 2000);
  }

  mergeLibraries(localMovies, localShows, cloudMovies, cloudShows) {
    const movieMap = new Map();
    (cloudMovies || []).forEach(m => {
      const key = (m.title || "").trim().toLowerCase();
      if (key) movieMap.set(key, m);
    });
    (localMovies || []).forEach(m => {
      const key = (m.title || "").trim().toLowerCase();
      if (!key) return;
      if (!movieMap.has(key)) {
        movieMap.set(key, m);
      } else {
        const existing = movieMap.get(key);
        movieMap.set(key, {
          ...existing,
          ...m,
          is_favorite: m.is_favorite || existing.is_favorite,
          rating: m.rating !== null ? m.rating : existing.rating,
          status: m.status || existing.status
        });
      }
    });

    const showMap = new Map();
    (cloudShows || []).forEach(s => {
      const key = (s.title || "").trim().toLowerCase();
      if (key) showMap.set(key, s);
    });
    (localShows || []).forEach(s => {
      const key = (s.title || "").trim().toLowerCase();
      if (!key) return;
      if (!showMap.has(key)) {
        showMap.set(key, s);
      } else {
        const existing = showMap.get(key);
        const epSet = new Set();
        const mergedEps = [];
        (existing.episodes_watched || []).forEach(ep => {
          const epKey = `${ep.season}_${ep.episode}`;
          if (!epSet.has(epKey)) {
            epSet.add(epKey);
            mergedEps.push(ep);
          }
        });
        (s.episodes_watched || []).forEach(ep => {
          const epKey = `${ep.season}_${ep.episode}`;
          if (!epSet.has(epKey)) {
            epSet.add(epKey);
            mergedEps.push(ep);
          }
        });

        showMap.set(key, {
          ...existing,
          ...s,
          episodes_watched: mergedEps,
          watched_count: mergedEps.length,
          rating: s.rating !== null ? s.rating : existing.rating
        });
      }
    });

    return {
      movies: Array.from(movieMap.values()),
      shows: Array.from(showMap.values())
    };
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
    const driveData = await this.downloadFromDrive();
    if (driveData && (driveData.movies || driveData.shows)) {
      if (onDataUpdated) {
        onDataUpdated(driveData.movies || [], driveData.shows || [], driveData);
      }
    } else {
      // If file doesn't exist yet, immediately upload local library to create the initial file on Drive
      if (window.allMovies && window.allShows && (window.allMovies.length > 0 || window.allShows.length > 0)) {
        await this.uploadToDrive(window.allMovies, window.allShows);
      }
    }
  }

  updateStatusUI(state, customMessage) {
    const chip = document.getElementById("m3-chip-drive-status");
    const chipText = document.getElementById("m3-drive-status-text");
    const chipIcon = document.getElementById("m3-drive-status-icon");

    if (!chip || !chipText || !chipIcon) return;

    if (!this.isAuthorized()) {
      chip.className = "m3-chip";
      chipIcon.innerText = "cloud_off";
      chipText.innerText = "Dysk Google: Rozłączony";
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
