// ==========================================================================
// CineLog - TV Shows Management & Episode Tracker Module
// ==========================================================================

import { state, getGradientForTitle, saveLocalDatabase } from './state.js';
import { showToastNotification, showM3ConfirmDialog } from './ui.js';
import { updateStats } from './stats.js';
import { getWatchProvidersForTitle, matchVodFilter, ensureVodDataForVisible, getUserLanguage, getCountryDisplayName } from './vod.js';
import { renderCastRail } from './cast.js';
import { sortItems } from './movies.js';
import { openRematchPicker } from './movies.js';
import { streamAiChat, buildSeriesSystemPrompt, formatAiMarkdown, isAiConfigured } from './ai.js';
import { openCloudSyncModal } from './cloud.js';

let selectedShow = null;
let selectedSeason = 1;
let currentShowMeta = {};

export async function renderShows() {
  const grid = document.getElementById("m3-shows-grid");
  if (!grid) return;
  const searchInput = document.getElementById("m3-search-input");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";

  let filtered = (state.shows || []).filter(s => {
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
    filtered = filtered.filter(s => matchVodFilter(s.title, "tv"));
  }

  filtered = sortItems(filtered, state.sortMode, "series");

  const countEl = document.getElementById("m3-visible-count");
  if (countEl) countEl.innerText = filtered.length;

  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 12px;">search_off</span>
        <p>Brak seriali spełniających wybrane kryteria i filtr VOD.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(s => {
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
      const active = (s.rating && i <= s.rating) ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}">star</span>`;
    }

    const isFav = Boolean(s.is_favorite);
    const favActiveClass = isFav ? "is-fav active" : "";
    const favIconStyle = isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : "";
    const epCount = s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0);
    let statusText = "Do obejrzenia";
    let statusColor = "var(--md-sys-color-on-surface-variant)";
    if (s.status === "watched") {
      statusText = "Ukończony";
      statusColor = "#10b981";
    } else if (s.status === "watching") {
      statusText = s.caught_up ? "Na bieżąco" : "W trakcie";
      statusColor = s.caught_up ? "#38bdf8" : "var(--md-sys-color-primary)";
    }

    card.innerHTML = `
      <div class="m3-card-cover">
        ${coverHtml}
        <button class="m3-card-fav-btn ${favActiveClass}" data-uuid="${s.uuid}" title="${isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
          <span class="material-symbols-rounded" style="${favIconStyle}">favorite</span>
        </button>
      </div>
      <div class="m3-card-body">
        <div class="m3-card-title">${s.title}</div>
        <div class="m3-card-meta">
          <span>${s.release_date ? s.release_date.split("-")[0] : (s.release_year || '')}</span>
          <span style="font-weight: 700; color: ${statusColor}; display: inline-flex; align-items: center; gap: 4px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusColor};"></span>
            ${statusText}
          </span>
          <span>•</span>
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
    starSpans.forEach(star => {
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
        } catch (err){}
      });
    });

    grid.appendChild(card);
  });
}

export async function openEpisodeTracker(show) {
  selectedShow = show;
  selectedSeason = Math.max(show.latest_season || 1, 1);
  currentShowMeta = {};

  document.getElementById("m3-ep-show-title").innerText = show.title;
  const progressText = show.latest_progress ? `Postęp: ${show.latest_progress} (${show.watched_count || 0} odcinków)` : "Brak obejrzanych odcinków";
  document.getElementById("m3-ep-show-meta").innerText = progressText;

  // Series Preview Card Elements (Poster, Plot, Metadata, Stars)
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
    const y = show.release_date ? show.release_date.split("-")[0] : (show.release_year || "");
    detailMeta.innerText = y ? `${y} • Serial` : "Serial telewizyjny";
  }
  if (detailPlot) {
    detailPlot.innerText = show.plot || "Wczytywanie szczegółów serialu z TMDb...";
  }

  if (detailStars) {
    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
      const active = (show.rating && i <= show.rating) ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}" style="cursor: pointer; font-size: 18px;">star</span>`;
    }
    detailStars.innerHTML = starsHtml;
    detailStars.querySelectorAll(".m3-star").forEach(star => {
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
        } catch (err){}
      });
    });
  }

  const showBadgesRow = document.getElementById("m3-ep-show-badges-row");
  if (showBadgesRow) {
    showBadgesRow.innerHTML = "";
    if (show.status === "watched") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(16, 185, 129, 0.18); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4);"><span class="material-symbols-rounded" style="font-size: 13px;">task_alt</span> Ukończony (${show.watched_count || 0} odc.)</span>`;
    } else if (show.caught_up) {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4);"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> Na bieżąco (${show.watched_count || 0} odc.)</span>`;
    } else if (show.watched_count) {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge highlight"><span class="material-symbols-rounded" style="font-size: 13px;">play_circle</span> W trakcie (${show.watched_count} odc.)</span>`;
    } else {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">bookmark</span> Do obejrzenia</span>`;
    }

    if (show.series_status === "Ended" || show.series_status === "Canceled") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">flag</span> Zakończony serial</span>`;
    } else if (show.in_production || show.series_status === "Returning Series") {
      showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">autorenew</span> W produkcji</span>`;
    }
  }

  const favShowBtn = document.getElementById("m3-btn-fav-show");
  if (favShowBtn) {
    const updateShowFavUI = () => {
      const isFav = Boolean(show.is_favorite);
      favShowBtn.className = `m3-card-fav-btn ${isFav ? 'is-fav active' : ''}`;
      favShowBtn.innerHTML = `<span class="material-symbols-rounded" style="${isFav ? 'font-variation-settings: \'FILL\' 1; color: var(--md-sys-color-favorite);' : ''}">favorite</span>`;
      favShowBtn.title = isFav ? "Usuń z ulubionych" : "Dodaj do ulubionych";
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
      const confirmed = await showM3ConfirmDialog({
        title: "Usunąć serial z biblioteki?",
        message: `Czy na pewno chcesz usunąć serial <b>"${show.title}"</b> wraz z całą historią i postępem oglądania?`,
        confirmText: "Usuń serial",
        cancelText: "Anuluj",
        icon: "delete_forever",
        isDestructive: true
      });
      if (!confirmed) return;
      await deleteShow(show.uuid);
    };
  }

  const vodLogosContainer = document.getElementById("m3-show-vod-logos");
  vodLogosContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant);">Szukam VOD...</span>`;

  renderSeasonTabs();
  renderSeasonEpisodes(true);
  document.getElementById("m3-sheet-episodes").classList.add("active");

  getWatchProvidersForTitle(show.title, "tv").then(data => {
    vodLogosContainer.innerHTML = "";
    const flat = data.flatrate || [];
    const free = data.free || [];
    const rent = [...(data.rent || []), ...(data.buy || [])];
    const uniqueRents = [];
    const seen = new Set();
    rent.forEach(r => {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        uniqueRents.push(r);
      }
    });

    const streaming = [...flat, ...free];
    const displayList = streaming.length > 0 ? streaming : uniqueRents;

    if (displayList.length > 0) {
      displayList.forEach(p => {
        const item = document.createElement("a");
        item.className = "m3-vod-logo-badge";
        item.href = data.link || "#";
        item.target = "_blank";
        item.rel = "noopener noreferrer";
        const isFreeService = p.is_free || free.some(f => f.name === p.name);
        const typeLabel = isFreeService ? '(Darmowe / Reklamy)' : (flat.some(f => f.name === p.name) ? '(Abonament)' : '(Wypożycz/Kup)');
        item.title = `${p.name} ${typeLabel}`;
        item.innerHTML = `
          ${p.logo_url ? `<img src="${p.logo_url}" alt="${p.name}">` : `<span class="material-symbols-rounded" style="font-size: 16px;">tv</span>`}
          <span>${p.name}</span>
          ${isFreeService ? `<span style="font-size: 0.65rem; font-weight: 800; color: var(--md-sys-color-primary); background: var(--md-sys-color-primary-container); padding: 1px 6px; border-radius: 999px; margin-left: 2px;">FREE</span>` : ''}
        `;
        vodLogosContainer.appendChild(item);
      });
    } else {
      vodLogosContainer.innerHTML = `<span style="font-size: 0.75rem; color: var(--md-sys-color-on-surface-variant); font-weight: 500;">Brak danych VOD (${getCountryDisplayName(state.userVodCountry)})</span>`;
    }
  });

  try {
    const localTmdbKey = localStorage.getItem("cinelog_tmdb_key") || "";
    const tmdbKeyParam = localTmdbKey ? `&tmdb_key=${encodeURIComponent(localTmdbKey)}` : "";
    const showYear = show.release_year || (show.release_date ? show.release_date.split("-")[0] : "");
    const tmdbParam = show.tmdb_id ? `&tmdb_id=${show.tmdb_id}` : "";
    const yearParam = showYear ? `&year=${showYear}` : "";
    const posterParam = show.poster_url ? `&poster_url=${encodeURIComponent(show.poster_url)}` : "";
    const detailFetchUrl = `/api/search_detail?title=${encodeURIComponent(show.title)}&type=series&lang=${getUserLanguage()}${tmdbParam}${yearParam}${posterParam}${tmdbKeyParam}`;
    const metaFetchUrl = `/api/shows/${show.uuid}/episodes_meta?lang=${getUserLanguage()}${tmdbParam}${tmdbKeyParam}`;

    const [metaRes, detailRes] = await Promise.all([
      fetch(metaFetchUrl).catch(() => ({ ok: false })),
      fetch(detailFetchUrl).catch(() => ({ ok: false }))
    ]);

    if (metaRes && metaRes.ok) {
      currentShowMeta = await metaRes.json();
    }

    // Direct client fallback for episode metadata if empty or running offline
    if (Object.keys(currentShowMeta).length === 0 && localTmdbKey) {
      let tid = show.tmdb_id;
      if (!tid) {
        try {
          const sRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${localTmdbKey}&query=${encodeURIComponent(show.title.replace(/\s*\([^)]*\)/g, '').trim())}&language=${getUserLanguage()}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData.results && sData.results.length > 0) {
              tid = sData.results[0].id;
              show.tmdb_id = tid;
            }
          }
        } catch (e) {}
      }
      if (tid) {
        await ensureSeasonMeta(tid, selectedSeason);
      }
    }

    renderSeasonTabs();
    renderSeasonEpisodes(false);

    if (detailRes && detailRes.ok) {
      const detail = await detailRes.json();

      if (detail.poster_url && (!show.poster_url || show.poster_url.includes("amazon") || show.poster_url.includes("favicon"))) {
        show.poster_url = detail.poster_url;
        if (detailImg) {
          detailImg.src = detail.poster_url;
          detailImg.style.display = "block";
        }
      }
      if (detailMeta) {
        detailMeta.innerText = `${detail.year || ''} • ${detail.genre || 'Serial telewizyjny'}`;
      }
      if (detailPlot) {
        detailPlot.innerText = detail.plot || "Brak opisu.";
      }

      if (showBadgesRow) {
        showBadgesRow.innerHTML = "";
        if (show.status === "watched") {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(16, 185, 129, 0.18); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;"><span class="material-symbols-rounded" style="font-size: 13px;">task_alt</span> Ukończony</span>`;
        } else if (show.caught_up) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="background: rgba(56, 189, 248, 0.18); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); font-weight: 700;"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> Na bieżąco</span>`;
        }

        if (detail.year) {
          showBadgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${detail.year}</span>`;
        }
        if (detail.total_seasons) {
          const sCount = detail.total_seasons;
          const sWord = sCount === 1 ? 'Sezon' : (sCount < 5 ? 'Sezony' : 'Sezonów');
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
          showBadgesRow.innerHTML += `<span class="m3-meta-badge" style="opacity: 0.85;"><span class="material-symbols-rounded" style="font-size: 12px;">flag</span> Zakończony</span>`;
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
  } catch (e){}
}

async function ensureSeasonMeta(tmdbId, seasonNum) {
  if (!tmdbId || !seasonNum) return;
  const localKey = localStorage.getItem("cinelog_tmdb_key");
  if (!localKey) return;
  try {
    const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}?api_key=${localKey}&language=${getUserLanguage()}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    (data.episodes || []).forEach(ep => {
      const eNum = ep.episode_number;
      if (eNum !== undefined) {
        const key = `${seasonNum}_${eNum}`;
        const still = ep.still_path ? `https://image.tmdb.org/t/p/w300${ep.still_path}` : null;
        currentShowMeta[key] = {
          season: seasonNum,
          episode: eNum,
          name: ep.name || `Odcinek ${eNum}`,
          airdate: ep.air_date,
          runtime: ep.runtime,
          summary: ep.overview || "",
          image: still
        };
      }
    });
  } catch (e) {}
}

export function renderSeasonTabs() {
  const tabsContainer = document.getElementById("m3-season-tabs");
  if (!tabsContainer || !selectedShow) return;
  tabsContainer.innerHTML = "";

  const watched = selectedShow.episodes_watched || [];
  const latestSeason = selectedShow.latest_season || 1;

  const seasonMap = {};
  watched.forEach(ep => {
    if (!seasonMap[ep.season]) seasonMap[ep.season] = new Set();
    seasonMap[ep.season].add(ep.episode);
  });

  let totalSeasons = Math.max(latestSeason, 1);
  Object.keys(currentShowMeta).forEach(key => {
    const sNum = parseInt(key.split("_")[0]);
    if (sNum > totalSeasons) totalSeasons = sNum;
  });

  for (let s = 1; s <= totalSeasons; s++) {
    const watchedSet = seasonMap[s] || new Set();
    const hasEp0 = watchedSet.has(0) || Boolean(currentShowMeta[`${s}_0`]);
    const watchedInSeason = watchedSet.size;

    let maxEpInSeason = 0;
    Object.keys(currentShowMeta).forEach(key => {
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
    tabBtn.className = `m3-season-tab ${s === selectedSeason ? 'active' : ''}`;
    tabBtn.id = `tab-season-${s}`;
    tabBtn.innerHTML = `
      <span>Sezon ${s}</span>
      <span class="m3-season-tab-badge">(${watchedInSeason}/${totalEps})</span>
    `;

    tabBtn.addEventListener("click", async () => {
      selectedSeason = s;
      document.querySelectorAll(".m3-season-tab").forEach(t => t.classList.remove("active"));
      tabBtn.classList.add("active");
      renderSeasonEpisodes(true);

      const tid = selectedShow.tmdb_id;
      if (tid && !currentShowMeta[`${s}_1`]) {
        await ensureSeasonMeta(tid, s);
        renderSeasonEpisodes(false);
      }
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

export function renderSeasonEpisodes(shouldScroll = true) {
  const container = document.getElementById("m3-episodes-list");
  if (!container || !selectedShow) return;
  container.innerHTML = "";

  const watched = selectedShow.episodes_watched || [];
  const latestSeason = selectedShow.latest_season || 1;
  const latestEpisode = selectedShow.latest_episode || 0;

  const watchedInThisSeason = new Set();
  watched.forEach(ep => {
    if (ep.season === selectedSeason) {
      watchedInThisSeason.add(ep.episode);
    }
  });

  const hasEp0 = watchedInThisSeason.has(0) || Boolean(currentShowMeta[`${selectedSeason}_0`]);
  let maxEpInSeason = 0;
  Object.keys(currentShowMeta).forEach(key => {
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

    const epTitle = epMeta && epMeta.name ? epMeta.name : (e === 0 ? "Odcinek specjalny / Prolog" : `Odcinek ${e}`);
    const epMetaInfo = epMeta && epMeta.airdate ? `${epMeta.airdate}${epMeta.runtime ? ' • ' + epMeta.runtime + ' min' : ''}` : `S${selectedSeason < 10 ? '0' + selectedSeason : selectedSeason}E${e < 10 ? '0' + e : e}`;
    const epSummary = epMeta && epMeta.summary ? epMeta.summary : "";

    const epId = `ep-${selectedSeason}-${e}`;
    const isLatestTarget = (selectedSeason === latestSeason && e === latestEpisode);
    if (isLatestTarget) {
      targetElementId = epId;
    }

    const epRow = document.createElement("div");
    epRow.id = epId;
    epRow.className = `m3-ep-item ${isWatched ? 'watched' : ''} ${isLatestTarget ? 'highlight-target' : ''}`;
    
    let summaryHtml = "";
    if (epSummary) {
      const isLong = epSummary.length > 125;
      if (isLong) {
        summaryHtml = `
          <div class="m3-ep-desc" id="desc-${epId}" title="Kliknij, aby rozwinąć pełny opis">${epSummary}</div>
          <button type="button" class="m3-ep-desc-toggle" data-target="desc-${epId}">
            <span>Rozwiń</span>
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
          <span class="material-symbols-rounded ${isWatched ? 'filled' : ''}" style="color: ${isWatched ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)'}; flex-shrink: 0; font-size: 24px;">
            ${isWatched ? 'check_box' : 'check_box_outline_blank'}
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
          ${isWatched ? 'Obejrzany' : 'Oznacz'}
        </span>
      </div>
    `;

    epRow.addEventListener("click", (evt) => {
      if (evt.target.closest(".m3-ep-desc-toggle") || evt.target.closest(".m3-ep-desc")) {
        return;
      }

      if (!isWatched) {
        const hasPrevInSeason = (e > 1);
        const hasPrevSeasons = (selectedSeason > 1);

        if (hasPrevInSeason || hasPrevSeasons) {
          askBatchConfirmation({
            message: `Zaznaczyłeś odcinek ${e} (Sezon ${selectedSeason}). Jak chcesz oznaczyć postęp oglądania?`,
            season: selectedSeason,
            episode: e,
            onAllSeasons: async () => {
              const batchList = [];
              for (let s = 1; s < selectedSeason; s++) {
                let seasonMax = 10;
                Object.keys(currentShowMeta).forEach(key => {
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
          descToggle.innerHTML = isExp 
            ? `<span>Zwiń</span><span class="material-symbols-rounded" style="font-size: 14px;">expand_less</span>`
            : `<span>Rozwiń</span><span class="material-symbols-rounded" style="font-size: 14px;">expand_more</span>`;
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

export async function toggleEpisodeWatch(season, episode) {
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
      const idx = state.shows.findIndex(s => s.uuid === updated.uuid);
      if (idx !== -1) state.shows[idx] = updated;

      const progressText = updated.latest_progress ? `Postęp: ${updated.latest_progress} (${updated.watched_count} odcinków)` : "Brak obejrzanych odcinków";
      document.getElementById("m3-ep-show-meta").innerText = progressText;

      renderSeasonTabs();
      renderSeasonEpisodes(false);
      updateStats();
      renderShows();
      saveLocalDatabase();
    }
  } catch(e){}
}

export async function batchMarkEpisodes(showUuid, episodesList) {
  try {
    const res = await fetch(`/api/shows/${showUuid}/batch_episodes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ episodes: episodesList })
    });
    if (res.ok) {
      const updated = await res.json();
      selectedShow = updated;
      const idx = state.shows.findIndex(s => s.uuid === updated.uuid);
      if (idx !== -1) state.shows[idx] = updated;

      const progressText = updated.latest_progress ? `Postęp: ${updated.latest_progress} (${updated.watched_count} odcinków)` : "Brak obejrzanych odcinków";
      document.getElementById("m3-ep-show-meta").innerText = progressText;

      renderSeasonTabs();
      renderSeasonEpisodes(false);
      updateStats();
      renderShows();
      saveLocalDatabase();
    }
  } catch(e){}
}

export function askBatchConfirmation({ message, season, episode, onAllSeasons, onThisSeason, onSingle }) {
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
      if (textAllSeasons) textAllSeasons.innerText = `Wszystkie poprzednie sezony (1–${season - 1}) + Sezon ${season} (1–${episode})`;
    } else {
      btnAllSeasons.style.display = "none";
    }
  }

  if (btnThisSeason) {
    if (episode > 1) {
      btnThisSeason.style.display = "flex";
      if (textThisSeason) textThisSeason.innerText = season > 1 ? `Tylko w Sezonie ${season} (Odcinki 1–${episode})` : `Wszystkie poprzednie odcinki (1–${episode})`;
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

export async function toggleShowFavorite(uuid, currentFav) {
  const nextFav = !currentFav;
  try {
    const res = await fetch(`/api/shows/${uuid}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: nextFav })
    });
    if (res.ok) {
      const found = state.shows.find(s => s.uuid === uuid);
      if (found) found.is_favorite = nextFav;
      renderShows();
      updateStats();
      saveLocalDatabase();
    }
  } catch (e) {}
}

export async function deleteShow(uuid) {
  try {
    const res = await fetch(`/api/shows/${uuid}`, { method: "DELETE" });
    if (res.ok) {
      state.shows = state.shows.filter(s => s.uuid !== uuid);
      updateStats();
      renderShows();
      document.getElementById("m3-sheet-episodes").classList.remove("active");
      saveLocalDatabase();
      showToastNotification("Serial został usunięty z biblioteki.", "info");
    } else {
      showToastNotification("Błąd podczas usuwania serialu.", "error");
    }
  } catch (err) {
    console.error("Error deleting show:", err);
  }
}

export function openShowRematchPicker(show) {
  openRematchPicker(show, "series");
}

let seriesConversations = {};

export function openSeriesAiModal(show) {
  if (!isAiConfigured()) {
    showToastNotification("Aby korzystać z Asystenta AI, najpierw skonfiguruj swój klucz API.", "info");
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
  if (progressEl) progressEl.innerText = `Postęp: ${show.latest_progress || 'Początek serialu'} • 🛡️ 100% Bez spoilerów`;
  if (inputEl) inputEl.value = "";

  const resetThread = () => {
    seriesConversations[show.uuid] = [];
    if (outputEl) {
      outputEl.innerHTML = `<span style="color: var(--md-sys-color-on-surface-variant); font-style: italic;">Kliknij jedno z szybkich zapytań lub zadaj pytanie. Możesz swobodnie kontynuować rozmowę i dopytywać o wątki!</span>`;
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

    // If initial empty state, clear it
    if (outputEl && seriesConversations[show.uuid].length === 0) {
      outputEl.innerHTML = "";
    }

    // 1. User Bubble
    const userBubble = document.createElement("div");
    userBubble.style.cssText = "align-self: flex-end; max-width: 85%; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); padding: 8px 12px; border-radius: 14px 14px 4px 14px; font-size: 0.82rem; font-weight: 500; margin-bottom: 8px; word-break: break-word;";
    userBubble.innerText = queryText;
    outputEl.appendChild(userBubble);

    // 2. Assistant Bubble
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
          <button type="button" class="m3-chip" id="collapse-${msgId}" style="font-size: 0.7rem; padding: 2px 6px; gap: 4px; display: inline-flex; align-items: center;" title="Rozwiń / Zwiń tekst">
            <span class="material-symbols-rounded" id="collapse-icon-${msgId}" style="font-size: 13px;">unfold_more</span>
            <span id="collapse-text-${msgId}">Rozwiń</span>
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
          <span>Tok myślenia (<span id="count-${msgId}">0 słów</span>)</span>
        </summary>
        <div id="text-${msgId}" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(168, 85, 247, 0.15); line-height: 1.4; font-style: italic; white-space: pre-wrap; max-height: 100px; overflow-y: auto;"></div>
      </details>
      <div id="content-${msgId}" style="line-height: 1.55; max-height: 90px; overflow-y: auto; position: relative; mask-image: linear-gradient(to bottom, black 50%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%); transition: max-height 0.25s ease;">
        <div style="display: flex; align-items: center; gap: 6px; color: #a855f7;">
          <span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 16px;">auto_awesome</span>
          <span style="font-weight: 600;">Asystent analizuje fabułę bez spoilerów...</span>
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
          if (collapseText) collapseText.innerText = "Rozwiń";
        } else {
          contentEl.style.maxHeight = "none";
          contentEl.style.overflowY = "visible";
          contentEl.style.maskImage = "none";
          contentEl.style.webkitMaskImage = "none";
          if (collapseIcon) collapseIcon.innerText = "unfold_less";
          if (collapseText) collapseText.innerText = "Zwiń";
        }
      };
    }

    if (copyBtn) {
      copyBtn.onclick = () => {
        if (latestFullText) {
          navigator.clipboard.writeText(latestFullText).then(() => {
            showToastNotification("Skopiowano odpowiedź do schowka!", "success");
          }).catch(() => {
            showToastNotification("Nie udało się skopiować do schowka.", "error");
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
          thoughtCountEl.innerText = `${words} słów`;
        }
      }
    };

    // Prepare multi-turn messages
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
        contentEl.innerHTML = `<span style="color: var(--md-sys-color-error); font-weight: 600;">🔴 Błąd: ${err.message}</span>`;
      }
    }
  };

  const btnRecap = document.getElementById("m3-ai-btn-recap-previous");
  const btnWhoIsWho = document.getElementById("m3-ai-btn-who-is-who");
  const btnLastEvents = document.getElementById("m3-ai-btn-last-events");

  if (btnRecap) {
    btnRecap.onclick = () => sendSeriesMessage(`Podsumuj najważniejsze wydarzenia z poprzednich sezonów, które doprowadziły do stanu na odcinku ${show.latest_progress || 'początek serialu'}, bez żadnych spoilerów do przodu.`);
  }
  if (btnWhoIsWho) {
    btnWhoIsWho.onclick = () => sendSeriesMessage(`Kto jest kim w serialu na etapie odcinka ${show.latest_progress || 'początek serialu'}? Wyjaśnij krótko relacje głównych bohaterów.`);
  }
  if (btnLastEvents) {
    btnLastEvents.onclick = () => sendSeriesMessage(`Co wydarzyło się w ostatnich odcinkach przed obecnym stanem (${show.latest_progress || 'początek serialu'})? Przypomnij kluczowe wątki.`);
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
