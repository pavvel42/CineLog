import { state, saveLocalDatabase, getGradientForTitle, findDuplicateInLibrary, normalizeTitleForLibrary, escapeHtml, safeUrl } from './state.js';
import { showToastNotification } from './ui.js';
import { updateStats } from './stats.js';
import { getUserLanguage } from './vod.js';
import { renderPreviewVod } from './recommendations.js';
import { renderMovies } from './movies.js';
import { renderShows } from './shows.js';

let searchType = "movie";
let confirmedType = "movie";
let confirmedStatus = "watched";
let currentAddRating = null;
let currentPreviewData = null;
let lastSearchResults = [];

const preAddWatchedSet = new Set();
let preAddSelectedSeason = 1;
let preAddSeasonCounts = {};

const ratingLabels = [
  "Brak oceny",
  "1/5 ★ Słaby",
  "2/5 ★★ Przeciętny",
  "3/5 ★★★ Dobry",
  "4/5 ★★★★ Bardzo dobry",
  "5/5 ★★★★★ Arcydzieło!"
];

export function setConfirmedType(type) {
  confirmedType = type;
  const progressBox = document.getElementById("m3-series-progress-box");
  const typeBadge = document.getElementById("m3-preview-type-badge");
  const labelWatched = document.getElementById("m3-status-label-watched");
  const iconWatched = document.getElementById("m3-status-icon-watched");
  const labelWatchlist = document.getElementById("m3-status-label-watchlist");

  if (type === "series") {
    if (labelWatched) labelWatched.innerText = "W trakcie oglądania";
    if (iconWatched) iconWatched.innerText = "play_circle";
    if (labelWatchlist) labelWatchlist.innerText = "Planowane";
    if (confirmedStatus === "watched" || confirmedStatus === "watching") {
      if (progressBox) progressBox.style.display = "block";
    } else {
      if (progressBox) progressBox.style.display = "none";
    }
    if (typeBadge) typeBadge.innerHTML = `📺 SERIAL`;
  } else {
    if (labelWatched) labelWatched.innerText = "Obejrzane";
    if (iconWatched) iconWatched.innerText = "check_circle";
    if (labelWatchlist) labelWatchlist.innerText = "Planowane";
    if (progressBox) progressBox.style.display = "none";
    if (typeBadge) typeBadge.innerHTML = `🎬 FILM`;
  }
}

export function setConfirmedStatus(status) {
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

export function setAddRating(val) {
  currentAddRating = val ? parseInt(val) : null;
  const hiddenInput = document.getElementById("m3-confirm-rating");
  const labelEl = document.getElementById("m3-add-rating-label");
  const clearBtn = document.getElementById("m3-add-rating-clear");
  const stars = document.querySelectorAll(".m3-interactive-star");

  if (hiddenInput) hiddenInput.value = currentAddRating || "";
  if (labelEl) labelEl.innerText = currentAddRating ? ratingLabels[currentAddRating] : ratingLabels[0];
  if (clearBtn) clearBtn.style.display = currentAddRating ? "inline-flex" : "none";

  stars.forEach(s => {
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

export function initPreAddEpisodeSelector(totalSeasons, seasonCounts) {
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
    const countInSeason = Array.from(preAddWatchedSet).filter(k => k.startsWith(`${s}_`)).length;
    const totalInSeason = preAddSeasonCounts[String(s)] || 10;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `m3-season-tab ${s === preAddSelectedSeason ? 'active' : ''}`;
    btn.innerHTML = `
      <span>Sezon ${s}</span>
      <span class="m3-season-tab-badge">(${countInSeason}/${totalInSeason})</span>
    `;

    btn.addEventListener("click", () => {
      preAddSelectedSeason = s;
      document.querySelectorAll("#m3-add-season-tabs .m3-season-tab").forEach(t => t.classList.remove("active"));
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
    chip.className = `m3-ep-chip ${isChecked ? 'checked' : ''}`;
    chip.innerHTML = `
      <span class="material-symbols-rounded" style="font-size: 16px;">${isChecked ? 'check' : 'add'}</span>
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
    countEl.innerText = `${preAddWatchedSet.size} ${preAddWatchedSet.size === 1 ? 'odcinek' : 'odcinków'}`;
  }
}

export async function selectProductionDetail(item) {
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
    
    const localTmdbKey = localStorage.getItem("cinelog_tmdb_key") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.TMDB_API_KEY) || "";
    const localOmdbKey = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key") || "";
    if (localTmdbKey) params.append("tmdb_key", localTmdbKey);
    if (localOmdbKey) {
      params.append("omdb_key", localOmdbKey);
      params.append("imdb_key", localOmdbKey);
    }

    let detail = item;
    let backendSuccess = false;

    // Try backend if not purely static
    if (window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
      try {
        const url = `/api/search_detail?${params.toString()}`;
        const res = await fetch(url);
        if (res.ok) {
          detail = await res.json();
          backendSuccess = true;
        }
      } catch (e) {
        console.warn("Backend detail fetch error, trying client TMDb API:", e);
      }
    }

    // Direct TMDb client-side fetch for GitHub Pages / offline
    if (!backendSuccess && localTmdbKey) {
      try {
        const tmdbType = (item.type === "series" || searchType === "series") ? "tv" : "movie";
        let tmdbId = item.tmdb_id || (item.id && !String(item.id).startsWith("tt") ? item.id : null);
        const imdbId = item.imdb_id || (item.id && String(item.id).startsWith("tt") ? item.id : null);

        // If we have an IMDb ID but no numeric TMDb ID, resolve it via /find/tt...
        if (!tmdbId && imdbId) {
          try {
            const findRes = await fetch(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(localTmdbKey)}&external_source=imdb_id&language=${getUserLanguage()}`);
            if (findRes.ok) {
              const findJson = await findRes.json();
              const resArr = tmdbType === "tv" ? findJson.tv_results : findJson.movie_results;
              if (resArr && resArr.length > 0) tmdbId = resArr[0].id;
            }
          } catch(e) {}
        }

        // If still no tmdbId, search TMDb by title
        if (!tmdbId && item.title) {
          try {
            const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
            const sUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${encodeURIComponent(localTmdbKey)}&query=${encodeURIComponent(cleanTitle)}&language=${getUserLanguage()}${item.year ? (tmdbType === 'tv' ? `&first_air_date_year=${item.year}` : `&year=${item.year}`) : ''}`;
            const sRes = await fetch(sUrl);
            if (sRes.ok) {
              const sData = await sRes.json();
              if (sData.results && sData.results.length > 0) tmdbId = sData.results[0].id;
            }
          } catch(e) {}
        }

        if (tmdbId) {
          const tmdbRes = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${encodeURIComponent(localTmdbKey)}&language=${getUserLanguage()}&append_to_response=credits,watch/providers,release_dates`);
          if (tmdbRes.ok) {
            const tData = await tmdbRes.json();
            let plot = tData.overview || item.plot || "";
            if (!plot) {
              try {
                const tmdbResEn = await fetch(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${encodeURIComponent(localTmdbKey)}&language=en-US`);
                if (tmdbResEn.ok) {
                  const tDataEn = await tmdbResEn.json();
                  plot = tDataEn.overview || "";
                }
              } catch(e) {}
            }

            detail = {
              id: item.id || `tmdb_${tData.id}`,
              tmdb_id: tData.id,
              imdb_id: tData.imdb_id || (tData.external_ids && tData.external_ids.imdb_id) || imdbId || "",
              title: tData.title || tData.name || item.title,
              original_title: tData.original_title || tData.original_name || item.original_title || "",
              year: (tData.release_date || tData.first_air_date || item.year || "").substring(0, 4),
              type: tmdbType === "tv" ? "series" : "movie",
              genre: (tData.genres || []).map(g => g.name).join(", "),
              director: (tData.credits && tData.credits.crew) ? (tData.credits.crew.find(c => c.job === "Director")?.name || "") : "",
              cast: (tData.credits && tData.credits.cast) ? tData.credits.cast.slice(0, 8).map(c => c.name).join(", ") : "",
              plot: plot || "Brak opisu.",
              runtime: tData.runtime ? `${tData.runtime} min` : (tData.episode_run_time && tData.episode_run_time[0] ? `${tData.episode_run_time[0]} min` : ""),
              poster_url: tData.poster_path ? `https://image.tmdb.org/t/p/w500${tData.poster_path}` : (item.poster_url || ""),
              total_seasons: tData.number_of_seasons || 1,
              total_episodes: tData.number_of_episodes || 0,
              season_ep_counts: {}
            };
            if (tData.seasons && Array.isArray(tData.seasons)) {
              tData.seasons.forEach(s => {
                if (s.season_number > 0) {
                  detail.season_ep_counts[s.season_number] = s.episode_count || 10;
                }
              });
            }
          }
        }
      } catch (tmdbErr) {
        console.warn("Direct TMDb detail fetch failed:", tmdbErr);
      }
    }

    // Direct client OMDb fallback
    if ((!detail || !detail.plot || detail.plot === "Brak opisu.") && localOmdbKey) {
      try {
        const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
        const omdbParam = item.imdb_id ? `i=${encodeURIComponent(item.imdb_id)}` : `t=${encodeURIComponent(cleanTitle)}${item.year ? `&y=${item.year}` : ''}`;
        const omdbRes = await fetch(`https://www.omdbapi.com/?apikey=${encodeURIComponent(localOmdbKey)}&${omdbParam}&plot=full`);
        if (omdbRes.ok) {
          const omdbData = await omdbRes.json();
          if (omdbData.Response === "True") {
            if (!detail) detail = { ...item };
            if (omdbData.Plot && omdbData.Plot !== "N/A") detail.plot = omdbData.Plot;
            if (omdbData.Genre && omdbData.Genre !== "N/A") detail.genre = omdbData.Genre;
            if (omdbData.Director && omdbData.Director !== "N/A") detail.director = omdbData.Director;
            if (omdbData.Actors && omdbData.Actors !== "N/A") detail.cast = omdbData.Actors;
          }
        }
      } catch(e) {}
    }

    currentPreviewData = detail;

    const detectedType = detail.type === "series" ? "series" : (searchType === "series" ? "series" : "movie");
    setConfirmedType(detectedType);

    const existing = findDuplicateInLibrary(detail.title, detectedType, detail.tmdb_id || detail.id);
    const confirmBtn = document.querySelector("#m3-confirm-add-form button[type='submit']");
    const confirmBtnText = confirmBtn ? (confirmBtn.querySelector("span:not(.material-symbols-rounded)") || confirmBtn) : null;

    if (existing) {
      setConfirmedStatus(existing.status || "watched");
      setAddRating(existing.rating || null);
      if (confirmBtnText) confirmBtnText.innerText = "Zaktualizuj w bibliotece";
      showToastNotification(`ℹ️ Pozycja („${detail.title}”) jest już w bibliotece. Możesz zaktualizować status lub ocenę.`, "info");
    } else {
      setConfirmedStatus("watched");
      setAddRating(null);
      if (confirmBtnText) confirmBtnText.innerText = "Dodaj do mojej listy";
    }

    document.getElementById("m3-preview-title").innerText = detail.title;
    document.getElementById("m3-preview-year").innerText = detail.year || '';
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

export function initSearchAndAddModal() {
  const searchInput = document.getElementById("m3-search-input");
  const searchClearBtn = document.getElementById("m3-search-clear");

  // NOTE: header search input filtering/rendering is bound once in main.js
  // (previously duplicated here, causing double grid re-renders per keystroke).
  if (searchInput && searchClearBtn) {
    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      searchClearBtn.style.display = "none";
      searchInput.focus();
      if (state.mode === "movies") renderMovies();
      else renderShows();
    });
  }

  // TMDb Add Modal Elements
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

  // Type Switchers
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

  // Back buttons
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

  // Search Online Form Submit
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

      const rawTmdbKey = localStorage.getItem("cinelog_tmdb_key") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.TMDB_API_KEY) || "";
      const rawOmdbKey = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key") || "";
      const isStaticEnv = window.location.protocol === "file:" || window.location.hostname.includes("github.io");

      let data = null;

      // 1. If backend server might be available, try it
      if (!isStaticEnv) {
        try {
          const tmdbKeyParam = rawTmdbKey ? `&tmdb_key=${encodeURIComponent(rawTmdbKey)}` : "";
          const omdbKeyParam = rawOmdbKey ? `&omdb_key=${encodeURIComponent(rawOmdbKey)}&imdb_key=${encodeURIComponent(rawOmdbKey)}` : "";
          const res = await fetch(`/api/search_preview?q=${encodeURIComponent(query)}&type=${searchType}&lang=${getUserLanguage()}${tmdbKeyParam}${omdbKeyParam}`);
          if (res.ok) {
            data = await res.json();
          }
        } catch (backendErr) {
          console.warn("Backend search failed, falling back to client TMDb API:", backendErr);
        }
      }

      // 2. Direct client-side TMDb API call (for GitHub Pages / offline mode)
      if (!data && rawTmdbKey) {
        try {
          const tmdbEndpoint = searchType === "series" ? "tv" : "movie";
          const res = await fetch(`https://api.themoviedb.org/3/search/${tmdbEndpoint}?api_key=${encodeURIComponent(rawTmdbKey)}&query=${encodeURIComponent(query)}&language=${getUserLanguage()}&include_adult=false`);
          if (res.ok) {
            const tmdbJson = await res.json();
            const results = (tmdbJson.results || []).map(item => ({
              title: item.title || item.name || "",
              original_title: item.original_title || item.original_name || "",
              year: (item.release_date || item.first_air_date || "").substring(0, 4),
              poster_url: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : "",
              type: searchType === "series" ? "series" : "movie",
              tmdb_id: item.id,
              plot: item.overview || "",
              rating: item.vote_average || null
            }));
            data = {
              found: results.length > 0,
              results: results
            };
          }
        } catch (tmdbErr) {
          console.error("Direct TMDb API fetch failed:", tmdbErr);
        }
      }

      try {
        if (data && data.found && data.results && data.results.length > 0) {
          lastSearchResults = data.results;

          if (data.results.length === 1) {
            selectProductionDetail(data.results[0]);
          } else {
            if (resultsContainer) {
              resultsContainer.innerHTML = "";
              data.results.forEach(item => {
                const isSeries = item.type === "series";
                const row = document.createElement("div");
                row.className = "m3-result-item";
                
                let posterHtml = item.poster_url
                  ? `<img src="${safeUrl(item.poster_url)}" class="m3-result-poster" alt="${escapeHtml(item.title)}">`
                  : `<div class="m3-result-poster" style="background: ${getGradientForTitle(item.title)}; display: flex; align-items: center; justify-content: center; font-size: 0.65rem; text-align: center; color: white;">${escapeHtml(item.title.substring(0, 10))}</div>`;

                row.innerHTML = `
                  ${posterHtml}
                  <div style="flex-grow: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span class="m3-preview-type-badge" style="font-size: 0.65rem; padding: 2px 6px;">
                        ${isSeries ? '📺 SERIAL' : '🎬 FILM'}
                      </span>
                      <span style="font-size: 0.8rem; font-weight: 700; color: var(--md-sys-color-on-surface-variant);">${escapeHtml(item.year || '')}</span>
                    </div>
                    <div style="font-weight: 700; font-size: 0.95rem; color: var(--md-sys-color-on-surface); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      ${escapeHtml(item.title)}
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
        } else if (data && data.needs_key) {
          // Backend has no TMDb/OMDb key configured - show the key setup panel
          if (searchErrorText) {
            searchErrorText.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%;">
                <div style="font-weight: 700; font-size: 0.9rem; color: #fff;">
                  🔑 Wyszukiwanie online wymaga darmowego klucza TMDb API
                </div>
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.88); line-height: 1.4;">
                  Darmowy klucz TMDb API możesz wpisać w 10 sekund w oknie <em>Klucze & Funkcje</em> (Chmura & Asystent AI → Klucze API) lub w pliku <code>.env</code> na serwerze.
                </div>
                <div style="display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
                  <button type="button" id="m3-btn-err-open-keys" class="m3-chip" style="background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); font-weight: 700; padding: 6px 12px; border: none; cursor: pointer;">
                    <span class="material-symbols-rounded" style="font-size: 16px;">key</span> Wpisz klucz TMDb
                  </button>
                  <button type="button" id="m3-btn-err-open-import" class="m3-chip" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); font-weight: 700; padding: 6px 12px; border: none; cursor: pointer;">
                    <span class="material-symbols-rounded" style="font-size: 16px;">upload_file</span> Otwórz Importer
                  </button>
                </div>
              </div>
            `;
            setTimeout(() => {
              const btnKeys = document.getElementById("m3-btn-err-open-keys");
              const btnImport = document.getElementById("m3-btn-err-open-import");
              if (btnKeys) {
                btnKeys.addEventListener("click", () => {
                  if (window.openCloudSyncModal) window.openCloudSyncModal('keys');
                });
              }
              if (btnImport) {
                btnImport.addEventListener("click", () => {
                  if (window.openImporterModal) window.openImporterModal();
                });
              }
            }, 50);
          }
          if (searchError) searchError.style.display = "flex";
        } else if (data && !data.found) {
          if (searchErrorText) searchErrorText.innerText = "Nie znaleziono pozycji o podanym tytule. Sprawdź pisownię.";
          if (searchError) searchError.style.display = "flex";
        } else {
          // If no key and on static host
          if (searchErrorText) {
            searchErrorText.innerHTML = `
              <div style="display: flex; flex-direction: column; gap: 8px; text-align: left; width: 100%;">
                <div style="font-weight: 700; font-size: 0.9rem; color: #fff;">
                  🔑 Wyszukiwanie online na GitHub Pages wymaga darmowego klucza TMDb API
                </div>
                <div style="font-size: 0.8rem; color: rgba(255,255,255,0.88); line-height: 1.4;">
                  W wersji hostowanej (GitHub Pages) zapytania wyszukiwarki wykonuje bezpośrednio Twoja przeglądarka. Darmowy klucz TMDb API możesz wpisać w 10 sekund w oknie <em>Klucze & Funkcje</em>.
                </div>
                <div style="display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap;">
                  <button type="button" id="m3-btn-err-open-keys" class="m3-chip" style="background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); font-weight: 700; padding: 6px 12px; border: none; cursor: pointer;">
                    <span class="material-symbols-rounded" style="font-size: 16px;">key</span> Wpisz klucz TMDb
                  </button>
                  <button type="button" id="m3-btn-err-open-import" class="m3-chip" style="background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); font-weight: 700; padding: 6px 12px; border: none; cursor: pointer;">
                    <span class="material-symbols-rounded" style="font-size: 16px;">upload_file</span> Otwórz Importer
                  </button>
                </div>
              </div>
            `;
            setTimeout(() => {
              const btnKeys = document.getElementById("m3-btn-err-open-keys");
              const btnImport = document.getElementById("m3-btn-err-open-import");
              if (btnKeys) {
                btnKeys.addEventListener("click", () => {
                  if (window.openCloudSyncModal) window.openCloudSyncModal('keys');
                });
              }
              if (btnImport) {
                btnImport.addEventListener("click", () => {
                  if (window.openImporterModal) window.openImporterModal();
                });
              }
            }, 50);
          }
          if (searchError) searchError.style.display = "flex";
        }
      } catch (err) {
        console.error("Search preview process error:", err);
      } finally {
        if (btnSearchTrigger) {
          btnSearchTrigger.innerHTML = origHtml;
          btnSearchTrigger.disabled = false;
        }
      }
    });
  }

  // Status buttons (Watched vs Watchlist)
  const btnStatusWatched = document.getElementById("m3-status-btn-watched");
  const btnStatusWatchlist = document.getElementById("m3-status-btn-watchlist");
  if (btnStatusWatched) btnStatusWatched.addEventListener("click", () => setConfirmedStatus("watched"));
  if (btnStatusWatchlist) btnStatusWatchlist.addEventListener("click", () => setConfirmedStatus("watchlist"));

  // Interactive stars
  const starElements = document.querySelectorAll(".m3-interactive-star");
  const starBar = document.getElementById("m3-add-star-bar");
  const ratingClearBtn = document.getElementById("m3-add-rating-clear");

  starElements.forEach(star => {
    star.addEventListener("click", () => {
      const val = parseInt(star.getAttribute("data-val"));
      setAddRating(val === currentAddRating ? null : val);
    });

    star.addEventListener("mouseenter", () => {
      const hoverVal = parseInt(star.getAttribute("data-val"));
      starElements.forEach(s => {
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

  // Confirm Add Form Handler
  const confirmForm = document.getElementById("m3-confirm-add-form");
  if (confirmForm) {
    confirmForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentPreviewData) return;

      const status = document.getElementById("m3-confirm-status").value;
      const ratingVal = document.getElementById("m3-confirm-rating").value;
      const rating = (status === "watchlist") ? null : (ratingVal ? parseInt(ratingVal) : null);

      if (confirmedType === "movie") {
        const payload = {
          title: currentPreviewData.title,
          poster_url: currentPreviewData.poster_url,
          release_date: currentPreviewData.released || (currentPreviewData.year ? `${currentPreviewData.year.substring(0, 4)}-01-01` : null),
          status: status,
          rating: rating,
          tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
          is_favorite: false
        };

        let savedMovie = null;
        try {
          const res = await fetch("/api/movies/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            savedMovie = await res.json();
          }
        } catch (backendErr) {
          console.warn("Backend add movie failed, using client storage:", backendErr);
        }

        // Client-side save for GitHub Pages & offline
        if (!savedMovie) {
          savedMovie = {
            uuid: `movie_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: currentPreviewData.title,
            original_title: currentPreviewData.original_title || currentPreviewData.title,
            year: currentPreviewData.year || "",
            genre: currentPreviewData.genre || "",
            director: currentPreviewData.director || "",
            cast: currentPreviewData.cast || "",
            plot: currentPreviewData.plot || "",
            runtime: currentPreviewData.runtime || "",
            poster_url: currentPreviewData.poster_url || "",
            status: status,
            rating: rating,
            tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
            imdb_id: currentPreviewData.imdb_id || "",
            is_favorite: false,
            user_date: new Date().toISOString().split("T")[0]
          };
        }

        const existingIdx = state.movies.findIndex(m => 
          (m.uuid && m.uuid === savedMovie.uuid) || 
          (savedMovie.tmdb_id && m.tmdb_id && String(m.tmdb_id) === String(savedMovie.tmdb_id)) || 
          (normalizeTitleForLibrary(m.title) === normalizeTitleForLibrary(savedMovie.title))
        );

        if (existingIdx !== -1) {
          state.movies[existingIdx] = { ...state.movies[existingIdx], ...savedMovie };
          showToastNotification(`Zaktualizowano "${savedMovie.title}" w bibliotece! ✨`);
        } else {
          state.movies.unshift(savedMovie);
          showToastNotification(`Zapisano "${savedMovie.title}" w bibliotece! 🎬`);
        }

        if (state.mode === "movies") renderMovies();
        updateStats();
        saveLocalDatabase();
        if (window.updateAiCardBadges) {
          window.updateAiCardBadges(savedMovie.title, savedMovie.tmdb_id, savedMovie.status, savedMovie, "movie");
        }
        if (sheetAdd) sheetAdd.classList.remove("active");
      } else {
        const episodesList = (status === "watchlist") ? [] : Array.from(preAddWatchedSet).map(key => {
          const [s, ep] = key.split("_");
          return { season: parseInt(s), episode: parseInt(ep) };
        });

        const payload = {
          title: currentPreviewData.title,
          poster_url: currentPreviewData.poster_url,
          status: status,
          rating: rating,
          tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
          episodes_watched: episodesList
        };

        let savedShow = null;
        try {
          const res = await fetch("/api/shows/add", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (res.ok) {
            savedShow = await res.json();
          }
        } catch (backendErr) {
          console.warn("Backend add show failed, using client storage:", backendErr);
        }

        // Client-side save for GitHub Pages & offline
        if (!savedShow) {
          savedShow = {
            uuid: `show_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            title: currentPreviewData.title,
            original_title: currentPreviewData.original_title || currentPreviewData.title,
            year: currentPreviewData.year || "",
            genre: currentPreviewData.genre || "",
            plot: currentPreviewData.plot || "",
            poster_url: currentPreviewData.poster_url || "",
            status: status,
            rating: rating,
            tmdb_id: currentPreviewData.tmdb_id || currentPreviewData.id,
            imdb_id: currentPreviewData.imdb_id || "",
            total_seasons: currentPreviewData.total_seasons || 1,
            total_episodes: currentPreviewData.total_episodes || 0,
            season_ep_counts: currentPreviewData.season_ep_counts || {},
            episodes_watched: episodesList,
            user_date: new Date().toISOString().split("T")[0]
          };
        }

        const existingIdx = state.shows.findIndex(s => 
          (s.uuid && s.uuid === savedShow.uuid) || 
          (savedShow.tmdb_id && s.tmdb_id && String(s.tmdb_id) === String(savedShow.tmdb_id)) || 
          (normalizeTitleForLibrary(s.title) === normalizeTitleForLibrary(savedShow.title))
        );

        if (existingIdx !== -1) {
          state.shows[existingIdx] = { ...state.shows[existingIdx], ...savedShow };
          showToastNotification(`Zaktualizowano "${savedShow.title}" w bibliotece! ✨`);
        } else {
          state.shows.unshift(savedShow);
          showToastNotification(`Zapisano "${savedShow.title}" w bibliotece! 📺`);
        }

        if (state.mode === "shows") renderShows();
        updateStats();
        saveLocalDatabase();
        if (window.updateAiCardBadges) {
          window.updateAiCardBadges(savedShow.title, savedShow.tmdb_id, savedShow.status, savedShow, "series");
        }
        if (sheetAdd) sheetAdd.classList.remove("active");
      }
    });
  }
}

window.setConfirmedType = setConfirmedType;
window.setConfirmedStatus = setConfirmedStatus;
window.setAddRating = setAddRating;
