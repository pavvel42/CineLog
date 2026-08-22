// ==========================================================================
// CineLog - Universal Importer Module (Filmweb, Letterboxd, IMDb, JSON)
// ==========================================================================

import { state, saveLocalDatabase, isItemInLibrary, generateUUID, markUserDatabaseCustom, escapeHtml } from './state.js';
import { showToastNotification } from './ui.js';
import { updateStats } from './stats.js';
import { renderMovies } from './movies.js';
import { renderShows } from './shows.js';
import { getUserLanguage } from './vod.js';

let parsedImportCandidates = [];
let detectedFormat = null;
let isImporting = false;
let shouldCancelImport = false;

/**
 * Universal CSV Parser handling quotes, commas, semicolons, and CRLF
 */
export function parseCSV(text) {
  // Remove UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
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
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === ',' || char === ';') && !inQuotes) {
      row.push("");
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      if (row.length > 1 || row[0].trim() !== "") {
        lines.push(row.map(c => c.trim()));
      }
      row = [""];
    } else {
      row[row.length - 1] += char;
    }
  }

  if (row.length > 1 || (row[0] && row[0].trim() !== "")) {
    lines.push(row.map(c => c.trim()));
  }

  if (lines.length < 2) return [];

  const headers = lines[0].map(h => h.toLowerCase().replace(/['"]/g, ''));
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

/**
 * Identify format and normalize items to unified candidate list
 */
export function detectAndNormalizeFile(filename, content) {
  const ext = filename.split('.').pop().toLowerCase();
  
  // Try JSON first
  if (ext === 'json') {
    try {
      const json = JSON.parse(content);
      let movies = json.movies || (Array.isArray(json) ? json : []);
      let shows = json.shows || [];
      
      const candidates = [];
      movies.forEach(m => {
        candidates.push({
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
      shows.forEach(s => {
        candidates.push({
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

      return { format: "CineLog JSON", candidates };
    } catch (e) {
      console.warn("Not valid CineLog JSON:", e);
    }
  }

  // Parse CSV
  const rows = parseCSV(content);
  if (rows.length === 0) {
    throw new Error("Plik jest pusty lub nie udało się odczytać wierszy CSV.");
  }

  const sample = rows[0];
  const keys = Object.keys(sample);

  // 1. IMDb Detection
  // Headers: const, your rating, date rated, title, url, title type, imdb rating, runtime (mins), year, genres...
  if (keys.some(k => k === "const") || keys.some(k => k === "your rating") || keys.some(k => k === "title type")) {
    const candidates = rows.map(r => {
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
        title: title,
        original_title: title,
        year: year,
        rating: rating,
        status: rating ? "watched" : "watchlist",
        watch_date: watchDate,
        imdb_id: imdbId.startsWith("tt") ? imdbId : null,
        tmdb_id: null
      };
    }).filter(c => c.title);

    return { format: "IMDb CSV (ratings / watchlist)", candidates };
  }

  // 2. Letterboxd Detection
  // Headers: name, year, rating, letterboxd uri, date, watched date
  if (keys.some(k => k === "letterboxd uri") || (keys.some(k => k === "name") && keys.some(k => k === "year"))) {
    const candidates = rows.map(r => {
      const title = r["name"] || "";
      const year = r["year"] || "";
      let ratingRaw = parseFloat(r["rating"]);
      let rating = null;
      if (!isNaN(ratingRaw) && ratingRaw > 0) {
        // Letterboxd is 0.5 - 5.0 stars, scale to 1-10
        rating = Math.round(ratingRaw * 2);
      }
      const watchDate = r["watched date"] || r["date"] || "";

      return {
        type: "movie",
        title: title,
        original_title: title,
        year: year,
        rating: rating,
        status: "watched",
        watch_date: watchDate,
        imdb_id: null,
        tmdb_id: null
      };
    }).filter(c => c.title);

    return { format: "Letterboxd CSV", candidates };
  }

  // 3. Filmweb Detection
  // Headers in Polish or English: tytuł, oryginalny tytuł, rok, ocena, data, typ
  if (keys.some(k => k.includes("tytuł") || k.includes("tytul") || k.includes("ocena") || k.includes("filmweb"))) {
    const candidates = rows.map(r => {
      const title = r["tytuł"] || r["tytul"] || r["title"] || "";
      const originalTitle = r["oryginalny tytuł"] || r["oryginalny tytul"] || r["original title"] || title;
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
        year: year,
        rating: rating,
        status: rating ? "watched" : "watchlist",
        watch_date: watchDate,
        imdb_id: null,
        tmdb_id: null
      };
    }).filter(c => c.title);

    return { format: "Filmweb CSV", candidates };
  }

  // Generic fallback CSV
  const candidates = rows.map(r => {
    const title = r["title"] || r["name"] || r["tytuł"] || r["tytul"] || Object.values(r)[0] || "";
    const year = r["year"] || r["rok"] || "";
    let rating = parseInt(r["rating"] || r["ocena"]);
    if (isNaN(rating) || rating <= 0) rating = null;

    return {
      type: "movie",
      title: title,
      original_title: title,
      year: year,
      rating: rating,
      status: rating ? "watched" : "watchlist",
      watch_date: "",
      imdb_id: null,
      tmdb_id: null
    };
  }).filter(c => c.title);

  return { format: "Ogólny plik CSV", candidates };
}

/**
 * Open and render the Universal Importer Modal
 */
export function openImporterModal() {
  const modal = document.getElementById("m3-sheet-importer");
  if (!modal) return;

  resetImporterUI();
  modal.classList.add("active");
}

export function closeImporterModal() {
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

/**
 * Handle chosen file
 */
export function handleImportFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target.result;

      // 1. Direct CineLog JSON Import check
      try {
        const json = JSON.parse(content);
        const importedMovies = json.movies && Array.isArray(json.movies) ? json.movies : (Array.isArray(json) ? json : []);
        const importedShows = json.shows && Array.isArray(json.shows) ? json.shows : [];

        if (importedMovies.length > 0 || importedShows.length > 0) {
          if (importedMovies.length > 0) state.movies = importedMovies;
          if (importedShows.length > 0) state.shows = importedShows;

          updateStats();
          if (state.mode === "movies") renderMovies();
          else renderShows();

          saveLocalDatabase();
          showToastNotification(`🎉 Wczytano kopię CineLog: ${importedMovies.length} filmów i ${importedShows.length} seriali!`, "success");

          const sheetCloud = document.getElementById("m3-sheet-cloud-sync");
          if (sheetCloud) sheetCloud.classList.remove("active");
          closeImporterModal();
          return;
        }
      } catch (errJson) {
        // Not a direct CineLog JSON, proceed to CSV format parser
      }

      // 2. CSV Parser (Filmweb, Letterboxd, IMDb)
      const { format, candidates } = detectAndNormalizeFile(file.name, content);

      if (candidates.length === 0) {
        showToastNotification("Nie znaleziono żadnych pozycji w pliku.", "error");
        return;
      }

      detectedFormat = format;
      parsedImportCandidates = candidates;
      openImporterModal();
      renderImportPreview();
    } catch (err) {
      console.error("Import file error:", err);
      showToastNotification(`Błąd odczytu pliku: ${err.message}`, "error");
    }
  };

  reader.readAsText(file);
}

/**
 * Render preview of what will be imported
 */
function renderImportPreview() {
  const dropzone = document.getElementById("m3-import-dropzone");
  const previewBox = document.getElementById("m3-import-preview-box");
  const btnStart = document.getElementById("m3-btn-start-import");

  if (!previewBox) return;

  let newMovies = 0;
  let newShows = 0;
  let duplicates = 0;

  parsedImportCandidates.forEach(cand => {
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

  // Sample items preview
  const listEl = document.getElementById("m3-import-sample-list");
  if (listEl) {
    listEl.innerHTML = "";
    parsedImportCandidates.slice(0, 8).forEach(item => {
      const row = document.createElement("div");
      row.className = "m3-import-sample-row";
      row.style.cssText = "display: flex; align-items: center; justify-content: space-between; padding: 6px 10px; background: var(--md-sys-color-surface-container); border-radius: 8px; font-size: 0.78rem; gap: 8px;";
      
      const starHtml = item.rating 
        ? `<span style="color: var(--md-sys-color-primary); font-weight: 700;">★ ${item.rating}/10</span>` 
        : `<span style="color: var(--md-sys-color-outline-variant);">Brak oceny</span>`;

      const dupBadge = item._isDuplicate 
        ? `<span style="font-size: 0.65rem; background: var(--md-sys-color-outline-variant); color: var(--md-sys-color-on-surface); padding: 1px 6px; border-radius: 999px;">Duplikat (pomiń)</span>` 
        : `<span style="font-size: 0.65rem; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-primary); padding: 1px 6px; border-radius: 999px; font-weight: 700;">NOWY</span>`;

      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0;">
          <span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-sys-color-primary);">${item.type === 'series' ? 'tv' : 'movie'}</span>
          <span style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(item.title)}</span>
          ${item.year ? `<span style="color: var(--md-sys-color-outline); font-size: 0.72rem;">(${escapeHtml(item.year)})</span>` : ''}
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
    const countToImport = parsedImportCandidates.filter(c => !c._isDuplicate).length;
    btnStart.innerText = `Rozpocznij import (${countToImport} pozycji)`;
    btnStart.style.display = "flex";
  }
}

/**
 * Execute batch import with TMDb fetching
 */
export async function executeBatchImport() {
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

  const itemsToProcess = parsedImportCandidates.filter(c => !c._isDuplicate);
  const total = itemsToProcess.length;
  let processed = 0;
  let successCount = 0;

  const userLang = getUserLanguage();

  for (const item of itemsToProcess) {
    if (shouldCancelImport) break;

    processed++;
    if (progressText) progressText.innerText = `Przetwarzanie: ${processed} z ${total} (${Math.round((processed / total) * 100)}%)`;
    if (currentTitleText) currentTitleText.innerText = `Pobieram: „${item.title}”...`;
    if (progressBar) progressBar.style.width = `${(processed / total) * 100}%`;

    try {
      // 1. Fetch metadata from TMDb
      const params = new URLSearchParams({
        title: item.title,
        year: item.year || "",
        type: item.type === "series" ? "series" : "movie",
        lang: userLang
      });
      if (item.imdb_id) params.append("id", item.imdb_id);
      if (item.tmdb_id) params.append("tmdb_id", item.tmdb_id);
      const localTmdb = localStorage.getItem("cinelog_tmdb_key");
      const localOmdb = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key");
      if (localTmdb) params.append("tmdb_key", localTmdb);
      if (localOmdb) {
        params.append("omdb_key", localOmdb);
        params.append("imdb_key", localOmdb);
      }

      let detail = null;
      if (window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
        try {
          const res = await fetch(`/api/search_detail?${params.toString()}`);
          if (res.ok) detail = await res.json();
        } catch (e) {
          console.warn("Failed detail fetch for", item.title, e);
        }
      }

      // Direct client-side enrichment on GitHub Pages / offline
      if (!detail && localTmdb) {
        try {
          const isSeries = item.type === "series";
          let resolvedTid = item.tmdb_id;

          if (!resolvedTid && item.imdb_id) {
            try {
              const findRes = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(item.imdb_id)}?api_key=${encodeURIComponent(localTmdb)}&external_source=imdb_id&language=${userLang}`);
              if (findRes.ok) {
                const findJson = await findRes.json();
                const resArr = isSeries ? findJson.tv_results : findJson.movie_results;
                if (resArr && resArr.length > 0) resolvedTid = resArr[0].id;
              }
            } catch(e) {}
          }

          if (!resolvedTid) {
            const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
            const sUrl = `https://api.themoviedb.org/3/search/${isSeries ? 'tv' : 'movie'}?api_key=${encodeURIComponent(localTmdb)}&query=${encodeURIComponent(cleanTitle)}&language=${userLang}${item.year ? (isSeries ? `&first_air_date_year=${item.year}` : `&year=${item.year}`) : ''}`;
            const sRes = await fetch(sUrl);
            if (sRes.ok) {
              const sData = await sRes.json();
              if (sData.results && sData.results.length > 0) resolvedTid = sData.results[0].id;
            }
          }

          if (resolvedTid) {
            const dUrl = `https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${resolvedTid}?api_key=${encodeURIComponent(localTmdb)}&language=${userLang}&append_to_response=credits`;
            const dRes = await fetch(dUrl);
            if (dRes.ok) {
              const dData = await dRes.json();
              let plot = dData.overview || "";
              if (!plot) {
                try {
                  const dResEn = await fetch(`https://api.themoviedb.org/3/${isSeries ? 'tv' : 'movie'}/${resolvedTid}?api_key=${encodeURIComponent(localTmdb)}&language=en-US`);
                  if (dResEn.ok) {
                    const dDataEn = await dResEn.json();
                    plot = dDataEn.overview || "";
                  }
                } catch(e) {}
              }

              detail = {
                title: dData.title || dData.name || item.title,
                original_title: dData.original_title || dData.original_name || item.title,
                year: (dData.release_date || dData.first_air_date || item.year || "").substring(0, 4),
                genre: (dData.genres || []).map(g => g.name).join(", "),
                poster_url: dData.poster_path ? `https://image.tmdb.org/t/p/w500${dData.poster_path}` : "",
                tmdb_id: dData.id,
                imdb_id: (dData.imdb_id || (dData.external_ids && dData.external_ids.imdb_id)) || item.imdb_id || null,
                plot: plot || "",
                runtime: dData.runtime || (dData.episode_run_time ? dData.episode_run_time[0] : 0),
                vote_average: dData.vote_average || 0,
                total_seasons: dData.number_of_seasons || (dData.seasons ? dData.seasons.filter(s => s.season_number > 0).length : 1),
                cast: (dData.credits && dData.credits.cast) ? dData.credits.cast.slice(0, 10).map(c => ({
                  id: c.id,
                  name: c.name,
                  character: c.character,
                  profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
                })) : [],
                director: (dData.credits && dData.credits.crew) ? (dData.credits.crew.find(c => c.job === "Director")?.name || "") : ""
              };
            }
          }
        } catch(e) {}
      }

      const finalTitle = (detail && detail.title) || item.title;
      const finalYear = (detail && detail.year) || item.year || "";
      const finalGenre = (detail && detail.genre) || (item.type === "series" ? "Serial" : "Film");
      const finalPoster = (detail && detail.poster_url) || "";
      const finalTmdbId = (detail && detail.tmdb_id) || item.tmdb_id || null;
      const finalImdbId = (detail && detail.imdb_id) || item.imdb_id || null;
      const finalOverview = (detail && detail.plot) || "";
      const finalRuntime = (detail && detail.runtime) || 0;
      const finalCast = (detail && detail.cast) || [];
      const finalDirector = (detail && detail.director) || "";

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
          created_at: item.watch_date || new Date().toISOString().split("T")[0],
          updated_at: new Date().toISOString().split("T")[0],
          tmdb_id: finalTmdbId,
          imdb_id: finalImdbId,
          plot: finalOverview,
          cast: finalCast,
          total_seasons: (detail && detail.total_seasons) || 1,
          season_ep_counts: (detail && detail.season_ep_counts) || {},
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
          watch_date: item.watch_date || (item.status === "watched" ? new Date().toISOString().split("T")[0] : ""),
          created_at: item.watch_date || new Date().toISOString().split("T")[0],
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

  // Finalize
  markUserDatabaseCustom();
  const demoBanner = document.getElementById("m3-demo-notice-banner");
  if (demoBanner) demoBanner.style.display = "none";
  
  saveLocalDatabase();
  updateStats();
  if (state.mode === "movies") renderMovies();
  else renderShows();

  if (window.googleDriveSync && window.googleDriveSync.isAuthorized()) {
    window.googleDriveSync.uploadToDrive(state.movies, state.shows);
  }

  showToastNotification(`🎉 Sukces! Pomyślnie zaimportowano ${successCount} pozycji do Twojej biblioteki.`, "success");
  closeImporterModal();
}

/**
 * Initialize Importer UI Event Listeners
 */
export function initImporterHandlers() {
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
