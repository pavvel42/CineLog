import { state, isItemInLibrary, saveLocalDatabase, getGradientForTitle, escapeHtml } from './state.js';
import { showToastNotification } from './ui.js';
import { updateStats } from './stats.js';
import { getWatchProvidersForTitle, getUserLanguage, TMDB_GLOBAL_VOD_MAP, getCountryDisplayName } from './vod.js';
import { renderMovies, openMovieDetail } from './movies.js';
import { renderShows, openEpisodeTracker } from './shows.js';
import { selectProductionDetail } from './search.js';
import { 
  streamAiChat, 
  buildCuratorSystemPrompt, 
  buildTasteDnaPrompt, 
  formatAiMarkdown, 
  resolveMentionedMediaItems, 
  resolveMentionTags,
  isAiConfigured 
} from './ai.js';
import { openCloudSyncModal } from './cloud.js';

let currentRecFilter = "all";
let rouletteSource = "watchlist";
let rouletteTime = "all";
let rouletteMood = "all";
let recFeedData = null;
let isRecLoading = false;

export function initRouletteControls() {
  const hub = document.getElementById("m3-recommendations-container");
  if (!hub) return;

  hub.querySelectorAll("[data-roulette-source]").forEach(pill => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-source]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteSource = pill.getAttribute("data-roulette-source");
    };
  });

  hub.querySelectorAll("[data-roulette-time]").forEach(pill => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-time]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteTime = pill.getAttribute("data-roulette-time");
    };
  });

  hub.querySelectorAll("[data-roulette-mood]").forEach(pill => {
    pill.onclick = () => {
      hub.querySelectorAll("[data-roulette-mood]").forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      rouletteMood = pill.getAttribute("data-roulette-mood");
    };
  });

  const spinBtn = document.getElementById("m3-rec-roulette-spin-btn");
  if (spinBtn) {
    spinBtn.onclick = spinRoulette;
  }
}

export async function spinRoulette() {
  const resultContainer = document.getElementById("m3-rec-roulette-result");
  const infoEl = document.getElementById("m3-rec-roulette-info");
  if (!resultContainer) return;

  infoEl.innerText = "Losuję najlepszy seans...";
  resultContainer.style.display = "block";
  resultContainer.innerHTML = `
    <div class="m3-roulette-result-card" style="justify-content: center; padding: 24px;">
      <span class="material-symbols-rounded" style="font-size: 32px; animation: spin 0.8s linear infinite; color: var(--md-sys-color-primary);">casino</span>
      <span style="font-weight: 600; font-size: 0.9rem;">Wybieram idealny tytuł...</span>
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
    const plannedMovies = state.movies.filter(m => m.status === "watchlist");
    const plannedShows = state.shows.filter(s => s.status === "watchlist" || s.status === "watching");
    candidates = [...plannedMovies, ...plannedShows];
    if (candidates.length === 0) {
      candidates = [...state.movies, ...state.shows];
    }
  } else if (rouletteSource === "myvod") {
    try {
      const tmdbParam = localStorage.getItem("cinelog_tmdb_key") ? `&tmdb_key=${encodeURIComponent(localStorage.getItem("cinelog_tmdb_key"))}` : "";
      const activePids = (state.userVodSubscriptions || []).map(s => TMDB_GLOBAL_VOD_MAP[s]).filter(Boolean).join("|");
      let url = `/api/recommendations/discover?media_type=movie&min_vote_avg=6.8&min_vote_count=100${tmdbParam}`;
      if (genreParam) url += `&genres=${genreParam}`;
      if (activePids) {
        url += `&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}`;
      }
      const res = await fetch(url);
      const data = await res.json();
      const raw = data.results || [];
      candidates = raw.filter(it => !isItemInLibrary(it));
    } catch (e) {
      console.error("My VOD roulette error:", e);
    }
  } else {
    try {
      const tmdbParam = localStorage.getItem("cinelog_tmdb_key") ? `&tmdb_key=${encodeURIComponent(localStorage.getItem("cinelog_tmdb_key"))}` : "";
      let url = `/api/recommendations/discover?media_type=movie&min_vote_avg=7.2&min_vote_count=150${tmdbParam}`;
      if (genreParam) url += `&genres=${genreParam}`;
      const res = await fetch(url);
      const data = await res.json();
      const raw = data.results || [];
      candidates = raw.filter(it => !isItemInLibrary(it));
    } catch (e) {
      console.error("Discovery roulette error:", e);
    }
  }

  if (!candidates || candidates.length === 0) {
    infoEl.innerText = "Brak pasujących pozycji.";
    resultContainer.innerHTML = `
      <div class="m3-roulette-result-card">
        <span class="material-symbols-rounded" style="color: var(--md-sys-color-primary);">info</span>
        <span>Nie znaleziono pozycji w tej kategorii. Dodaj więcej tytułów do listy Do obejrzenia lub spróbuj innego nastroju!</span>
      </div>
    `;
    return;
  }

  const picked = candidates[Math.floor(Math.random() * candidates.length)];
  infoEl.innerText = `Wylosowano z puli ${candidates.length} pozycji! 🎉`;

  const isMovie = picked.type === "movie" || !picked.episodes_watched;
  const poster = picked.poster_url || "static/icons/favicon.png";
  const title = picked.title || "Tytuł";
  const year = picked.year || (picked.release_date ? picked.release_date.substring(0, 4) : "");
  const rating = picked.vote_average ? `${picked.vote_average}★` : (picked.rating ? `${picked.rating}★` : "Brak oceny");
  const inLibrary = isItemInLibrary(picked);

  resultContainer.innerHTML = `
    <div class="m3-roulette-result-card">
      <div style="width: 85px; min-width: 85px; height: 120px; border-radius: 10px; overflow: hidden; background: #000; flex-shrink: 0; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
        <img src="${poster}" alt="${title}" style="width: 100%; height: 100%; object-fit: cover;">
      </div>
      <div style="display: flex; flex-direction: column; gap: 6px; flex-grow: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="m3-meta-badge highlight" style="font-size: 0.7rem;">${isMovie ? '🎬 FILM' : '📺 SERIAL'}</span>
          ${year ? `<span style="font-size: 0.78rem; font-weight: 600; color: var(--md-sys-color-on-surface-variant);">${year}</span>` : ''}
          <span style="font-size: 0.78rem; font-weight: 700; color: #f59e0b;">★ ${rating}</span>
        </div>
        <h3 style="font-size: 1.05rem; font-weight: 800; margin: 0; color: var(--md-sys-color-on-surface);">${title}</h3>
        <p style="font-size: 0.78rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0;">
          ${picked.overview || picked.plot || "Znakomity wybór na seans!"}
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
    addBtn.onclick = () => quickAddToWatchlist(picked, addBtn);
  }
  const rerollBtn = document.getElementById("m3-roulette-reroll-btn");
  if (rerollBtn) {
    rerollBtn.onclick = spinRoulette;
  }
}

export function createRecommendationCard(item, matchPct = 96) {
  const card = document.createElement("div");
  card.className = "m3-rec-card";
  const poster = item.poster_url || "static/icons/favicon.png";
  const title = item.title || "Tytuł";
  const year = item.year || (item.release_date ? item.release_date.substring(0, 4) : "");
  const rating = item.vote_average ? `${item.vote_average}★` : "7.5★";

  card.innerHTML = `
    <div class="m3-rec-poster-box">
      <img src="${poster}" alt="${title}" loading="lazy">
      <span class="m3-rec-match-badge">${matchPct}% Zgodności</span>
      <button type="button" class="m3-rec-quick-add" title="Dodaj do Planowanych">
        <span class="material-symbols-rounded" style="font-size: 20px;">bookmark_add</span>
      </button>
    </div>
    <div class="m3-rec-info">
      <h4 class="m3-rec-title" title="${title}">${title}</h4>
      <div class="m3-rec-meta">
        ${year ? `<span>${year}</span>` : ''}
        <span>•</span>
        <span class="m3-rec-rating-badge"><span class="material-symbols-rounded" style="font-size: 13px;">star</span> ${rating}</span>
      </div>
    </div>
  `;

  const addBtn = card.querySelector(".m3-rec-quick-add");
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    quickAddToWatchlist(item, addBtn);
  });

  card.addEventListener("click", () => {
    openRecPreview(item);
  });

  return card;
}

export async function quickAddToWatchlist(item, btnElement) {
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
      showToastNotification(`Dodano "${item.title}" do listy Do obejrzenia! 🔖`);
    } else {
      if (btnElement) {
        btnElement.disabled = false;
        btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">bookmark_add</span>`;
      }
      showToastNotification("Nie udało się dodać pozycji do listy Do obejrzenia.", "error");
    }
  } catch (err) {
    console.error("Error adding rec item:", err);
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.innerHTML = `<span class="material-symbols-rounded" style="font-size: 18px;">bookmark_add</span>`;
    }
  }
}

export async function renderPreviewVod(title, mediaType, tmdbId = null) {
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
    const rentBuy = [...(vodData.rent || []), ...(vodData.buy || [])];
    
    const uniqueAll = [];
    const seen = new Set();
    [...flatrate, ...free, ...rentBuy].forEach(p => {
      if (!seen.has(p.name)) {
        seen.add(p.name);
        uniqueAll.push(p);
      }
    });

    if (uniqueAll.length === 0) {
      listEl.innerHTML = `<span style="font-size: 0.76rem; color: var(--md-sys-color-on-surface-variant); opacity: 0.85;">Brak informacji o streamingu w ${getCountryDisplayName(state.userVodCountry)}</span>`;
    } else {
      uniqueAll.slice(0, 10).forEach(p => {
        const badge = document.createElement("div");
        badge.className = "m3-preview-vod-badge";
        const logoImg = p.logo ? `<img src="${p.logo}" alt="${p.name}">` : '';
        badge.innerHTML = `${logoImg}<span>${p.name}</span>`;
        listEl.appendChild(badge);
      });
    }
  } catch (e) {
    if (loadingEl) loadingEl.style.display = "none";
    listEl.innerHTML = `<span style="font-size: 0.76rem; color: var(--md-sys-color-on-surface-variant);">Brak danych VOD</span>`;
  }
}

export async function openRecPreview(item) {
  const isSeries = item.type === "series" || item.media_type === "tv";

  const sheetAdd = document.getElementById("m3-sheet-add");
  const stepSearch = document.getElementById("m3-add-step-search");
  const stepResults = document.getElementById("m3-add-step-results");
  const stepPreview = document.getElementById("m3-add-step-preview");

  if (sheetAdd) {
    if (stepSearch) stepSearch.style.display = "none";
    if (stepResults) stepResults.style.display = "none";
    if (stepPreview) stepPreview.style.display = "flex";

    // Set flag so back button returns directly to recommendations
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

export function buildCarouselSection(title, subtitle, iconName, items) {
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
      ${subtitle ? `<div class="m3-carousel-subtitle">${subtitle}</div>` : ''}
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
        <span>Polecane i wspomniane tytuły (Kliknij kafelek, aby otworzyć podgląd):</span>
      </div>
      <div class="no-scrollbar" style="display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; -webkit-overflow-scrolling: touch;">
  `;

  items.forEach(({ item, type, inLibrary }, index) => {
    const isMovie = type === "movie";
    const poster = item.poster_url || item.poster || "";
    const title = item.title || item.name || "";
    const year = item.year || (item.release_date ? item.release_date.substring(0, 4) : "");
    const rating = item.rating ? `${item.rating}★` : (item.vote_average ? `${item.vote_average}★` : (item.is_favorite ? '❤️' : ''));
    const gradient = getGradientForTitle(title);

    let statusBadge = '';
    if (inLibrary) {
      if (item.status === 'watched') {
        statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(16,185,129,0.9); color: #fff; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">✓ Obejrzane</span>`;
      } else if (item.status === 'watchlist') {
        statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(234,179,8,0.9); color: #000; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">🔖 Na liście</span>`;
      }
    } else {
      statusBadge = `<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(168,85,247,0.9); color: #fff; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;">+ Zobacz</span>`;
    }

    html += `
      <div class="m3-ai-media-mini-card" data-card-idx="${index}" data-tmdb-id="${item.tmdb_id || item.id || ''}" style="flex: 0 0 115px; width: 115px; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: 10px; overflow: hidden; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; display: flex; flex-direction: column;">
        <div style="width: 100%; height: 145px; position: relative; background: ${gradient};">
          ${poster ? `<img src="${poster}" alt="${title}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;">` : `<div style="display:flex; height:100%; align-items:center; justify-content:center; padding:6px; font-size:0.7rem; font-weight:700; text-align:center; color:#fff;">${title}</div>`}
          ${rating ? `<span style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.75); color: #fbbf24; font-size: 0.68rem; font-weight: 800; padding: 1px 5px; border-radius: 6px;">${rating}</span>` : ''}
          <span style="position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.75); color: #e2e8f0; font-size: 0.62rem; font-weight: 700; padding: 1px 4px; border-radius: 4px;">${isMovie ? 'Film' : 'Serial'}</span>
          ${statusBadge}
        </div>
        <div style="padding: 6px; display: flex; flex-direction: column; gap: 2px;">
          <div style="font-size: 0.75rem; font-weight: 700; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${title}">${title}</div>
          <div style="font-size: 0.65rem; color: var(--md-sys-color-on-surface-variant);">${year || (isMovie ? 'Film' : 'Serial')}</div>
        </div>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  containerEl.innerHTML = html;

  containerEl.querySelectorAll(".m3-ai-media-mini-card").forEach(card => {
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

// Dynamically update card badge and click handler after adding from AI
export function updateAiCardBadges(title, tmdbId, status, savedItem, type) {
  const cards = document.querySelectorAll(".m3-ai-media-mini-card");
  const normTitle = (title || "").toLowerCase().trim();

  cards.forEach(card => {
    const cardTitleEl = card.querySelector("[title]");
    const cardTitle = cardTitleEl ? cardTitleEl.getAttribute("title").toLowerCase().trim() : "";
    const cardTmdbId = card.getAttribute("data-tmdb-id");

    const isMatch = (cardTmdbId && tmdbId && String(cardTmdbId) === String(tmdbId)) ||
                    (cardTitle && (cardTitle === normTitle || normTitle.includes(cardTitle) || cardTitle.includes(normTitle)));

    if (isMatch) {
      // Find or update status badge
      const posterBox = card.querySelector("div[style*='height: 145px']");
      if (posterBox) {
        const oldBadge = posterBox.querySelector("span[style*='bottom: 4px; right: 4px']");
        if (oldBadge) oldBadge.remove();

        const newBadge = document.createElement("span");
        newBadge.style.cssText = "position: absolute; bottom: 4px; right: 4px; font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 4px;";
        if (status === 'watched') {
          newBadge.style.background = "rgba(16,185,129,0.9)";
          newBadge.style.color = "#fff";
          newBadge.innerText = "✓ Obejrzane";
        } else {
          newBadge.style.background = "rgba(234,179,8,0.9)";
          newBadge.style.color = "#000";
          newBadge.innerText = "🔖 Na liście";
        }
        posterBox.appendChild(newBadge);
      }

      // Update click handler to open movie detail / episode tracker directly
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

let curatorConversation = [];
let aiCuratorListenersBound = false;

export function initAiCuratorControls() {
  initAiChatCore();
  initMentionChips();
  initMentionAutocomplete();
}

function initAiChatCore() {
  // Wątek czatu AI: reset, wysyłanie promptów (szybkie chipy + własne), streaming odpowiedzi.
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
    showToastNotification("Aby korzystać z Filmowego Asystenta AI, najpierw skonfiguruj swój klucz API.", "info");
    openCloudSyncModal("ai");
    return;
  }

  let userPrompt = customText;
  let isSpecialDna = false;

  if (promptType === "dna") {
    isSpecialDna = true;
    userPrompt = "Stwórz profil DNA mojego gustu filmowego na podstawie moich ocen.";
  } else if (promptType === "binge90") {
    userPrompt = "Mam dokładnie 90 minut wolnego czasu. Poleć mi 2-3 zwięzłe, znakomite pozycje zoptymalizowane pod ten czas.";
  } else if (promptType === "gems") {
    userPrompt = "Poleć mi 3 niedocenione perełki (Hidden Gems) z moich platform VOD, które idealnie pasują do mojego profilu ocen.";
  } else if (promptType === "dark") {
    userPrompt = "Szukam czegoś gęstego, mrocznego, trzymającego w napięciu do ostatniej sekundy.";
  } else if (promptType === "binge_marathon") {
    userPrompt = "Ułóż mi idealny plan maratonu filmowego na 4-6 godzin z moich platform VOD. Połącz powiązane ze sobą klimatycznie filmy w logicznej kolejności oglądania.";
  } else if (promptType === "vibe_search") {
    userPrompt = "Szukam filmu o unikalnym klimacie: deszczowe miasto nocą, neony, melancholia, samotność i hipnotyzująca muzyka (styl Blade Runner, Drive, Lost in Translation).";
  }

  if (!userPrompt || !userPrompt.trim()) return;

  inputEl.value = "";
  threadEl.style.display = "flex";
  if (resetBtn) resetBtn.style.display = "inline-flex";

  // 1. User Message Bubble
  const userBubble = document.createElement("div");
  userBubble.style.cssText = "align-self: flex-end; max-width: 85%; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); padding: 10px 14px; border-radius: 16px 16px 4px 16px; font-size: 0.84rem; font-weight: 500; word-break: break-word;";
  userBubble.innerText = userPrompt;
  threadEl.appendChild(userBubble);

  // 2. Assistant Message Bubble (starts collapsed by default for compact live streaming)
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
        <button type="button" class="m3-chip" id="collapse-${msgId}" style="font-size: 0.72rem; padding: 2px 8px; gap: 4px; display: inline-flex; align-items: center;" title="Rozwiń / Zwiń tekst">
          <span class="material-symbols-rounded" id="collapse-icon-${msgId}" style="font-size: 14px;">unfold_more</span>
          <span id="collapse-text-${msgId}">Rozwiń</span>
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
        <span>Tok myślenia modelu AI (<span id="count-${msgId}">0 słów</span>)</span>
      </summary>
      <div id="text-${msgId}" style="margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(168, 85, 247, 0.15); line-height: 1.45; font-style: italic; white-space: pre-wrap; max-height: 120px; overflow-y: auto;"></div>
    </details>
    <div id="content-${msgId}" style="line-height: 1.6; max-height: 95px; overflow-y: auto; position: relative; mask-image: linear-gradient(to bottom, black 50%, transparent 100%); -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%); transition: max-height 0.25s ease;">
      <div style="display: flex; align-items: center; gap: 8px; color: #a855f7;">
        <span class="material-symbols-rounded" style="animation: spin 1s linear infinite; font-size: 18px;">auto_awesome</span>
        <span style="font-weight: 600;">Asystent pisze odpowiedź...</span>
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
      threadEl.scrollTop = threadEl.scrollHeight;
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

  // Prepare payload
  let messages = [];
  if (isSpecialDna) {
    const dna = buildTasteDnaPrompt();
    messages = [
      { role: "system", content: dna.systemPrompt },
      { role: "user", content: dna.userMessage }
    ];
  } else {
    // 1. Resolve @ mentions and custom item context
    const { injectedContext } = resolveMentionTags(userPrompt);
    const userPayloadContent = injectedContext 
      ? `${userPrompt}\n\nKontekst wskazany przez użytkownika:\n${injectedContext}` 
      : userPrompt;

    // 2. Build or refresh dynamic system prompt tailored to userPrompt
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
      contentEl.innerHTML = `<div style="color: var(--md-sys-color-error); font-weight: 600;">🔴 Błąd AI: ${escapeHtml(err.message)}</div>`;
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

chips.forEach(chip => {
  chip.onclick = () => {
    const pType = chip.getAttribute("data-ai-prompt");
    sendUserMessage(pType);
  };
});
}

function initMentionChips() {
  // Chipy @wzmianek wstawiające tytuł do pola wiadomości.
const inputEl = document.getElementById("m3-rec-ai-input");
// 3. Mention Chips Click Handler
const mentionChips = document.querySelectorAll("#m3-rec-ai-mention-chips [data-mention]");
mentionChips.forEach(chip => {
  chip.onclick = () => {
    const tag = chip.getAttribute("data-mention");
    if (!inputEl.value.includes(tag)) {
      inputEl.value = inputEl.value ? `${inputEl.value.trim()} ${tag} ` : `${tag} `;
    }
    inputEl.focus();
  };
});
}

function initMentionAutocomplete() {
  // Pływające autouzupełnianie @z pozycjami biblioteki; trwałe listenery tylko raz (guard).
const inputEl = document.getElementById("m3-rec-ai-input");
// 4. Floating Autocomplete on typing @ with Smart Dynamic Positioning
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

  // Predefined tags
  const defaultTags = [
    { tag: "@ulubione_filmy", displayTag: "@ulubione_filmy", desc: "Twoje najwyżej ocenione filmy", icon: "movie" },
    { tag: "@planowane_filmy", displayTag: "@planowane_filmy", desc: "Twoja lista filmów do obejrzenia", icon: "bookmark" },
    { tag: "@obejrzane_filmy", displayTag: "@obejrzane_filmy", desc: "Wszystkie Twoje obejrzane filmy", icon: "check_circle" },
    { tag: "@ulubione_seriale", displayTag: "@ulubione_seriale", desc: "Twoje ulubione seriale", icon: "tv" },
    { tag: "@planowane_seriale", displayTag: "@planowane_seriale", desc: "Twoja lista seriali do obejrzenia", icon: "bookmark" },
    { tag: "@obejrzane_seriale", displayTag: "@obejrzane_seriale", desc: "Wszystkie Twoje obejrzane seriale", icon: "check_circle" },
  ];

  defaultTags.forEach(t => {
    if (!query || t.tag.toLowerCase().includes(query) || t.desc.toLowerCase().includes(query)) {
      suggestions.push(t);
    }
  });

  // Matching titles from library
  if (query) {
    const matchingMovies = (state.movies || [])
      .filter(m => (m.title || "").toLowerCase().includes(query))
      .slice(0, 5)
      .map(m => {
        const hasSpecial = m.title.includes(" ") || m.title.includes(",") || m.title.includes(".") || m.title.includes("-");
        const insertTag = hasSpecial ? `@\"${m.title}\"` : `@${m.title}`;
        const yearStr = m.year ? ` (${m.year})` : "";
        const statusStr = m.status === "watched" ? "Obejrzany" : "Planowany";
        return {
          tag: insertTag,
          displayTag: `@${m.title}`,
          desc: `Film${yearStr} • ${statusStr}`,
          icon: "movie"
        };
      });
    
    const matchingShows = (state.shows || [])
      .filter(s => (s.title || "").toLowerCase().includes(query))
      .slice(0, 5)
      .map(s => {
        const hasSpecial = s.title.includes(" ") || s.title.includes(",") || s.title.includes(".") || s.title.includes("-");
        const insertTag = hasSpecial ? `@\"${s.title}\"` : `@${s.title}`;
        const yearStr = s.year ? ` (${s.year})` : "";
        const statusStr = s.status === "watched" ? "Ukończony" : "Planowany";
        return {
          tag: insertTag,
          displayTag: `@${s.title}`,
          desc: `Serial${yearStr} • ${statusStr}`,
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

  // Dynamic Viewport-Aware Positioning (Top vs Bottom)
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
    <div class="m3-mention-item" data-mention-tag="${escapeHtml(s.tag)}" data-mention-idx="${idx}" style="display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; cursor: pointer; transition: background 0.15s ease; font-size: 0.8rem;">
      <span class="material-symbols-rounded" style="font-size: 16px; color: var(--md-sys-color-primary); flex-shrink: 0;">${escapeHtml(s.icon)}</span>
      <div style="flex: 1; min-width: 0;">
        <div style="font-weight: 700; color: var(--md-sys-color-on-surface); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.displayTag)}</div>
        <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(s.desc)}</div>
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

  mentionDropdown.querySelectorAll(".m3-mention-item").forEach(item => {
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

// Bind persistent listeners only once (guard against accumulation on repeated tab switches)
if (!aiCuratorListenersBound) {
  aiCuratorListenersBound = true;
  inputEl.addEventListener("input", updateMentionDropdown);
  inputEl.addEventListener("click", updateMentionDropdown);

  // Keyboard navigation inside dropdown (ArrowUp, ArrowDown, Enter, Escape)
  inputEl.addEventListener("keydown", (e) => {
    if (!mentionDropdown || mentionDropdown.style.display === "none") return;

    const items = mentionDropdown.querySelectorAll(".m3-mention-item");
    if (!items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex + 1) % items.length;
      items.forEach((it, i) => {
        it.style.background = (i === activeMentionIndex) ? "var(--md-sys-color-surface-container-highest)" : "transparent";
      });
      items[activeMentionIndex]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeMentionIndex = (activeMentionIndex - 1 + items.length) % items.length;
      items.forEach((it, i) => {
        it.style.background = (i === activeMentionIndex) ? "var(--md-sys-color-surface-container-highest)" : "transparent";
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
}

export async function loadRecommendationsHub(forceRefresh = false) {
  const hub = document.getElementById("m3-rec-carousels-hub");
  if (!hub) return;

  initRouletteControls();
  initAiCuratorControls();

  const filterBtns = document.querySelectorAll("[data-rec-filter]");
  const refreshBtn = document.getElementById("m3-rec-refresh-btn");

  filterBtns.forEach(btn => {
    btn.onclick = () => {
      filterBtns.forEach(b => b.classList.remove("active"));
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
      <p style="margin-top: 14px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Generuję spersonalizowane rekomendacje...</p>
      <p style="font-size: 0.82rem; opacity: 0.8; margin-top: 4px;">Analizuję Twoje oceny 5★, ulubione gatunki i trendy TMDb</p>
    </div>
  `;

  try {
    const fiveStarMovies = state.movies.filter(m => m.rating === 5 || m.is_favorite);
    const fiveStarShows = state.shows.filter(s => s.rating === 5 || s.is_favorite);
    const activeShows = state.shows.filter(s => s.status === "watching" || (s.watched_count > 0 && s.status !== "watched"));

    const shuffledFavMovies = [...fiveStarMovies].sort(() => 0.5 - Math.random());
    const seedMovie1 = shuffledFavMovies[0] || state.movies[0] || null;
    const seedMovie2 = shuffledFavMovies[1] || (state.movies.length > 1 ? state.movies[1] : null);

    const seedShow1 = activeShows[0] || fiveStarShows[0] || state.shows[0] || null;
    const seedShow2 = activeShows.length > 1 ? activeShows[1] : (fiveStarShows.length > 1 ? fiveStarShows[1] : null);

    const tmdbParam = localStorage.getItem("cinelog_tmdb_key") ? `&tmdb_key=${encodeURIComponent(localStorage.getItem("cinelog_tmdb_key"))}` : "";
    const promises = [];

    // Helper for robust dual-mode fetching (Flask API -> Direct TMDb Client Fetch Fallback)
    const fetchRecSection = async (key, apiPath, tmdbPath, tmdbParams = {}) => {
      const localKey = localStorage.getItem("cinelog_tmdb_key");
      const tmdbParam = localKey ? `&tmdb_key=${encodeURIComponent(localKey)}` : "";

      // 1. Try Flask endpoint
      try {
        const res = await fetch(`${apiPath}${tmdbParam}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.results && data.results.length > 0) {
            return { key, ...data };
          }
        }
      } catch (e) {}

      // 2. Direct TMDb Client Fetch Fallback
      if (localKey && tmdbPath) {
        try {
          const query = new URLSearchParams({
            api_key: localKey,
            language: "pl-PL",
            ...tmdbParams
          });
          const res = await fetch(`https://api.themoviedb.org/3/${tmdbPath}?${query.toString()}`);
          if (res.ok) {
            const data = await res.json();
            const results = (data.results || []).map(it => {
              const isTv = tmdbPath.includes("tv") || it.media_type === "tv";
              const title = it.title || it.name || "Nieznany tytuł";
              const pPath = it.poster_path;
              const bPath = it.backdrop_path;
              const relDate = it.release_date || it.first_air_date || "";
              return {
                tmdb_id: it.id,
                title: title,
                original_title: it.original_title || it.original_name || title,
                poster_url: pPath ? `https://image.tmdb.org/t/p/w500${pPath}` : null,
                backdrop_url: bPath ? `https://image.tmdb.org/t/p/w780${bPath}` : null,
                release_date: relDate,
                year: relDate ? relDate.substring(0, 4) : "",
                type: isTv ? "series" : "movie",
                vote_average: Math.round((it.vote_average || 0) * 10) / 10,
                vote_count: it.vote_count || 0,
                overview: it.overview || "",
                genre_ids: it.genre_ids || []
              };
            });
            return { key, results };
          }
        } catch (e) {
          console.warn("Direct TMDb API fetch error:", e);
        }
      }

      return { key, results: [] };
    };

    // Global Popularity & Trends
    promises.push(fetchRecSection(
      "popular_trending",
      "/api/recommendations/discover?media_type=movie&sort_by=popularity.desc&min_vote_avg=6.4&min_vote_count=200",
      "discover/movie",
      { sort_by: "popularity.desc", "vote_average.gte": "6.4", "vote_count.gte": "200" }
    ));

    // Trending This Week
    promises.push(fetchRecSection(
      "trending_week",
      "/api/recommendations/trending?media_type=all&time_window=week",
      "trending/all/week",
      {}
    ));

    // IMDb Top 250 / Timeless Masterpieces
    promises.push(fetchRecSection(
      "top_classics",
      "/api/recommendations/discover?media_type=movie&sort_by=vote_average.desc&min_vote_avg=8.3&min_vote_count=1200",
      "discover/movie",
      { sort_by: "vote_average.desc", "vote_average.gte": "8.3", "vote_count.gte": "1200" }
    ));

    // Hidden Gems
    promises.push(fetchRecSection(
      "hidden_gems",
      "/api/recommendations/discover?media_type=movie&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=100&max_vote_count=2500",
      "discover/movie",
      { sort_by: "vote_average.desc", "vote_average.gte": "7.8", "vote_count.gte": "100", "vote_count.lte": "2500" }
    ));

    // Mind-Bending & Plot Twists
    promises.push(fetchRecSection(
      "mind_bending",
      "/api/recommendations/discover?media_type=movie&genres=9648,53&sort_by=vote_average.desc&min_vote_avg=7.4&min_vote_count=350",
      "discover/movie",
      { with_genres: "9648,53", sort_by: "vote_average.desc", "vote_average.gte": "7.4", "vote_count.gte": "350" }
    ));

    // Binge-worthy Miniseries
    promises.push(fetchRecSection(
      "binge_miniseries",
      "/api/recommendations/discover?media_type=tv&sort_by=vote_average.desc&min_vote_avg=8.0&min_vote_count=120",
      "discover/tv",
      { sort_by: "vote_average.desc", "vote_average.gte": "8.0", "vote_count.gte": "120" }
    ));

    // 80s & 90s Cult Era
    promises.push(fetchRecSection(
      "nostalgia_classics",
      "/api/recommendations/discover?media_type=movie&year_gte=1980&year_lte=1999&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=600",
      "discover/movie",
      { "primary_release_date.gte": "1980-01-01", "primary_release_date.lte": "1999-12-31", sort_by: "vote_average.desc", "vote_average.gte": "7.8", "vote_count.gte": "600" }
    ));

    // Fresh off theaters / New on VOD
    promises.push(fetchRecSection(
      "vod_fresh",
      "/api/recommendations/discover?media_type=movie&sort_by=popularity.desc&min_vote_avg=6.4&min_vote_count=80",
      "discover/movie",
      { sort_by: "popularity.desc", "vote_average.gte": "6.4", "vote_count.gte": "80" }
    ));

    // Genres
    promises.push(fetchRecSection("genre_romcom", "/api/recommendations/discover?media_type=movie&genres=35,10749&sort_by=vote_average.desc&min_vote_avg=6.8&min_vote_count=150", "discover/movie", { with_genres: "35,10749", sort_by: "vote_average.desc", "vote_average.gte": "6.8", "vote_count.gte": "150" }));
    promises.push(fetchRecSection("genre_comedy", "/api/recommendations/discover?media_type=movie&genres=35&sort_by=vote_average.desc&min_vote_avg=7.1&min_vote_count=250", "discover/movie", { with_genres: "35", sort_by: "vote_average.desc", "vote_average.gte": "7.1", "vote_count.gte": "250" }));
    promises.push(fetchRecSection("genre_crime", "/api/recommendations/discover?media_type=movie&genres=80,9648&sort_by=vote_average.desc&min_vote_avg=7.4&min_vote_count=300", "discover/movie", { with_genres: "80,9648", sort_by: "vote_average.desc", "vote_average.gte": "7.4", "vote_count.gte": "300" }));
    promises.push(fetchRecSection("genre_thriller", "/api/recommendations/discover?media_type=movie&genres=53,9648&sort_by=popularity.desc&min_vote_avg=7.2&min_vote_count=300", "discover/movie", { with_genres: "53,9648", sort_by: "popularity.desc", "vote_average.gte": "7.2", "vote_count.gte": "300" }));
    promises.push(fetchRecSection("genre_horror", "/api/recommendations/discover?media_type=movie&genres=27,53&sort_by=vote_average.desc&min_vote_avg=6.8&min_vote_count=200", "discover/movie", { with_genres: "27,53", sort_by: "vote_average.desc", "vote_average.gte": "6.8", "vote_count.gte": "200" }));
    promises.push(fetchRecSection("genre_scifi", "/api/recommendations/discover?media_type=movie&genres=878,14&sort_by=vote_average.desc&min_vote_avg=7.2&min_vote_count=350", "discover/movie", { with_genres: "878,14", sort_by: "vote_average.desc", "vote_average.gte": "7.2", "vote_count.gte": "350" }));
    promises.push(fetchRecSection("genre_action", "/api/recommendations/discover?media_type=movie&genres=28,12&sort_by=vote_average.desc&min_vote_avg=7.3&min_vote_count=400", "discover/movie", { with_genres: "28,12", sort_by: "vote_average.desc", "vote_average.gte": "7.3", "vote_count.gte": "400" }));
    promises.push(fetchRecSection("genre_animation", "/api/recommendations/discover?media_type=movie&genres=16&sort_by=vote_average.desc&min_vote_avg=7.6&min_vote_count=300", "discover/movie", { with_genres: "16", sort_by: "vote_average.desc", "vote_average.gte": "7.6", "vote_count.gte": "300" }));
    promises.push(fetchRecSection("genre_drama", "/api/recommendations/discover?media_type=movie&genres=18&sort_by=vote_average.desc&min_vote_avg=7.8&min_vote_count=350", "discover/movie", { with_genres: "18", sort_by: "vote_average.desc", "vote_average.gte": "7.8", "vote_count.gte": "350" }));

    if (seedMovie1) {
      promises.push(fetchRecSection(`seed_movie_1`, `/api/recommendations/for_item?media_type=movie&title=${encodeURIComponent(seedMovie1.title)}`, `search/movie`, { query: seedMovie1.title }).then(res => ({ ...res, title: seedMovie1.title })));
    }
    if (seedMovie2 && seedMovie2.title !== (seedMovie1 && seedMovie1.title)) {
      promises.push(fetchRecSection(`seed_movie_2`, `/api/recommendations/for_item?media_type=movie&title=${encodeURIComponent(seedMovie2.title)}`, `search/movie`, { query: seedMovie2.title }).then(res => ({ ...res, title: seedMovie2.title })));
    }
    if (seedShow1) {
      promises.push(fetchRecSection(`seed_show_1`, `/api/recommendations/for_item?media_type=tv&title=${encodeURIComponent(seedShow1.title)}`, `search/tv`, { query: seedShow1.title }).then(res => ({ ...res, title: seedShow1.title })));
    }
    if (seedShow2 && seedShow2.title !== (seedShow1 && seedShow1.title)) {
      promises.push(fetchRecSection(`seed_show_2`, `/api/recommendations/for_item?media_type=tv&title=${encodeURIComponent(seedShow2.title)}`, `search/tv`, { query: seedShow2.title }).then(res => ({ ...res, title: seedShow2.title })));
    }

    const activePids = (state.userVodSubscriptions || []).map(s => TMDB_GLOBAL_VOD_MAP[s]).filter(Boolean).join("|");

    if (activePids) {
      promises.push(fetchRecSection(
        "myvod_hits",
        `/api/recommendations/discover?media_type=movie&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}&sort_by=popularity.desc&min_vote_avg=7.0&min_vote_count=150`,
        "discover/movie",
        { with_watch_providers: activePids, watch_region: state.userVodCountry, sort_by: "popularity.desc", "vote_average.gte": "7.0", "vote_count.gte": "150" }
      ));
      promises.push(fetchRecSection(
        "myvod_shows",
        `/api/recommendations/discover?media_type=tv&with_watch_providers=${encodeURIComponent(activePids)}&watch_region=${state.userVodCountry}&sort_by=popularity.desc&min_vote_avg=7.6&min_vote_count=150`,
        "discover/tv",
        { with_watch_providers: activePids, watch_region: state.userVodCountry, sort_by: "popularity.desc", "vote_average.gte": "7.6", "vote_count.gte": "150" }
      ));
    }

    const responses = await Promise.all(promises);
    recFeedData = {};
    responses.forEach(item => {
      recFeedData[item.key] = item;
    });

    renderRecommendationsFeed();
  } catch (err) {
    console.error("Error loading recommendations hub:", err);
    renderRecommendationsFeed();
  }
}

export function renderRecommendationsFeed() {
  const hub = document.getElementById("m3-rec-carousels-hub");
  if (!hub || !recFeedData) return;

  hub.innerHTML = "";

  const hasTmdbKey = Boolean(localStorage.getItem("cinelog_tmdb_key"));
  if (!hasTmdbKey) {
    const banner = document.createElement("div");
    banner.className = "m3-cloud-info-card";
    banner.style.cssText = "margin-bottom: 24px; background: linear-gradient(135deg, rgba(168, 85, 247, 0.12), rgba(56, 189, 248, 0.08)); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: var(--md-corner-xl); padding: 16px 18px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;";
    banner.innerHTML = `
      <div style="display: flex; align-items: center; gap: 14px; min-width: 260px; flex: 1;">
        <div style="width: 44px; height: 44px; border-radius: 12px; background: var(--md-sys-color-primary); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
          <span class="material-symbols-rounded" style="font-size: 24px;">auto_awesome</span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="font-weight: 700; font-size: 0.92rem; color: var(--md-sys-color-on-surface);">Odblokuj pełny silnik rekomendacji online & VOD</div>
          <div style="font-size: 0.78rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.4;">
            Wprowadź darmowy klucz <b>TMDb API (The Movie Database)</b>, aby odkrywać trendy tygodnia, hity na Twoich VOD i ponad 10 000+ tytułów. (Klucz OMDb/IMDb odpowiada za oceny i recenzje).
          </div>
        </div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="button" class="m3-btn-action-primary" onclick="if(window.openCloudSyncModal) window.openCloudSyncModal('keys');" style="font-weight: 700; padding: 9px 16px; font-size: 0.82rem;">
          <span class="material-symbols-rounded" style="font-size: 18px;">key</span>
          <span>Wprowadź klucz TMDb</span>
        </button>
        <a href="https://www.themoviedb.org/settings/api" target="_blank" class="m3-chip" style="text-decoration: none; font-weight: 700; padding: 9px 14px; font-size: 0.82rem;">
          <span>Darmowy klucz ↗</span>
        </a>
      </div>
    `;
    hub.appendChild(banner);
  }

  if (currentRecFilter === "myvod" || currentRecFilter === "all") {
    if (currentRecFilter === "myvod" && (!state.userVodSubscriptions || state.userVodSubscriptions.length === 0)) {
      const banner = document.createElement("div");
      banner.style.cssText = "text-align: center; padding: 40px 20px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container); border-radius: var(--md-corner-large); border: 1px solid var(--md-sys-color-outline-variant); margin-bottom: 20px;";
      banner.innerHTML = `
        <span class="material-symbols-rounded" style="font-size: 40px; color: var(--md-sys-color-primary);">subscriptions</span>
        <p style="margin-top: 10px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Brak wybranych platform VOD</p>
        <p style="font-size: 0.82rem; margin-top: 4px; max-width: 500px; margin-inline: auto;">Otwórz <b>Ustawienia VOD i Kraj</b> i zaznacz serwisy, które subskrybujesz, aby widzieć propozycje dostępne na Twoich VOD.</p>
      `;
      hub.appendChild(banner);
    } else {
      if (recFeedData.myvod_hits && recFeedData.myvod_hits.results && recFeedData.myvod_hits.results.length > 0) {
        const raw = recFeedData.myvod_hits.results || [];
        const filtered = raw.filter(it => !isItemInLibrary(it));
        const section = buildCarouselSection(
          "⭐ Hity filmowe na Twoich VOD",
          `Wybitne i najpopularniejsze filmy dostępne w Twoich subskrypcjach (${(state.userVodSubscriptions || []).join(", ")})`,
          "star",
          filtered
        );
        if (section) hub.appendChild(section);
      }
      if (recFeedData.myvod_shows && recFeedData.myvod_shows.results && recFeedData.myvod_shows.results.length > 0) {
        const raw = recFeedData.myvod_shows.results || [];
        const filtered = raw.filter(it => !isItemInLibrary(it));
        const section = buildCarouselSection(
          "📺 Najlepsze seriale na Twoich VOD",
          "Wciągające seriale z oceną powyżej 7.6★ dostępne w Twoich serwisach streamingowych",
          "tv",
          filtered
        );
        if (section) hub.appendChild(section);
      }
    }
  }

  const FEED_SECTIONS = [
  { key: "seed_movie_1", filters: ["all", "personalized", "movies"], title: () => (`Bo uwielbiasz film: ${recFeedData.seed_movie_1.title}`),
    subtitle: () => ("Produkcje o zbliżonym klimacie, motywach i fabule dopasowane do Twojej oceny"), icon: "favorite" },
  { key: "seed_movie_2", filters: ["all", "personalized", "movies"], title: () => (`Bo podobał Ci się film: ${recFeedData.seed_movie_2.title}`),
    subtitle: () => ("Tytuły polecane przez widzów o podobnym guście filmowym"), icon: "movie" },
  { key: "seed_show_1", filters: ["all", "personalized", "shows"], title: () => (`Bo oglądasz serial: ${recFeedData.seed_show_1.title}`),
    subtitle: () => ("Seriale polecane fanom tego tytułu"), icon: "live_tv" },
  { key: "popular_trending", filters: ["all", "popular", "movies", "myvod"], title: () => ("🔥 Najpopularniejsze teraz"),
    subtitle: () => ("Najchętniej oglądane i najgłośniejsze produkcje filmowe na świecie"), icon: "whatshot" },
  { key: "trending_week", filters: ["all", "popular", "trending", "myvod"], title: () => ("⚡ Trendy tygodnia"),
    subtitle: () => ("Produkcje, o których jest najgłośniej w ostatnich 7 dniach"), icon: "bolt" },
  { key: "genre_romcom", filters: ["all", "romcom", "movies", "myvod"], title: () => ("❤️ Komedie romantyczne & Ciepłe historie"),
    subtitle: () => ("Czarujące historie miłosne, urok i lekki humor z najwyższymi ocenami widzów"), icon: "favorite" },
  { key: "genre_comedy", filters: ["all", "comedy", "movies", "myvod"], title: () => ("😂 Komedie & Lekki humor"),
    subtitle: () => ("Błyskotliwe, kultowe komedie, które gwarantują mnóstwo dobrego humoru"), icon: "sentiment_very_satisfied" },
  { key: "genre_crime", filters: ["all", "crime", "movies", "myvod"], title: () => ("🕵️ Mroczne kryminały & Śledztwa"),
    subtitle: () => ("Złożone zagadki detektywistyczne, kino gangsterskie i policyjne intrygi"), icon: "local_police" },
  { key: "genre_thriller", filters: ["all", "thriller", "movies", "myvod"], title: () => ("🔥 Psychologiczne thrillery & Dreszczowce"),
    subtitle: () => ("Gęsty klimat, tajemnice i nieprzewidywalne napięcie do ostatniej minuty"), icon: "crisis_alert" },
  { key: "genre_horror", filters: ["all", "horror", "movies", "myvod"], title: () => ("😱 Horrory & Groza"),
    subtitle: () => ("Kino grozy, skoki adrenaliny i mrożące krew w żyłach historie"), icon: "local_fire_department" },
  { key: "genre_scifi", filters: ["all", "scifi", "movies", "myvod"], title: () => ("🚀 Sci-Fi & Epickie fantasy"),
    subtitle: () => ("Niezwykłe światy, kosmiczne podróże i technologiczne wizje przyszłości"), icon: "rocket_launch" },
  { key: "genre_action", filters: ["all", "action", "movies", "myvod"], title: () => ("💥 Epickie kino akcji & Przygody"),
    subtitle: () => ("Widowiskowe pościgi, walki i pełne adrenaliny przygody filmowe"), icon: "sports_martial_arts" },
  { key: "genre_animation", filters: ["all", "animation", "movies", "myvod"], title: () => ("✨ Magiczne animacje dla każdego"),
    subtitle: () => ("Arcydzieła animacji – zachwycające perełki od studia Ghibli po Pixara"), icon: "palette" },
  { key: "genre_drama", filters: ["all", "drama", "movies", "myvod"], title: () => ("🎭 Poruszające dramaty & Wielkie emocje"),
    subtitle: () => ("Głębokie, nagradzane historie i wybitne kreacje aktorskie"), icon: "theater_comedy" },
  { key: "top_classics", filters: ["all", "classics", "movies"], title: () => ("🏆 IMDb Top Arcydzieła"),
    subtitle: () => ("Najwyżej oceniane filmy wszech czasów o statusie legendy kina"), icon: "military_tech" },
  { key: "hidden_gems", filters: ["all", "gems", "movies"], title: () => ("💎 Ukryte perełki (Hidden Gems)"),
    subtitle: () => ("Wybitne kino niezależne i festiwalowe o rewelacyjnych ocenach widzów"), icon: "diamond" },
  { key: "mind_bending", filters: ["all", "gems", "thriller", "movies"], title: () => ("🤯 Szokujące zakończenia & Mind-Bending"),
    subtitle: () => ("Tajemnice, psychologiczne łamigłówki i nieprzewidywalne zwroty akcji"), icon: "psychology" },
  { key: "binge_miniseries", filters: ["all", "shows"], title: () => ("🍿 Binge-worthy: Miniseriale na weekend"),
    subtitle: () => ("Wciągające, zamknięte historie z oceną powyżej 8.0★ do obejrzenia w kilka wieczorów"), icon: "play_circle" },
  { key: "nostalgia_classics", filters: ["all", "classics", "movies"], title: () => ("📼 Złota era lat 80. i 90. (Kultowa Nostalgia)"),
    subtitle: () => ("Niezapomniane hity ery VHS i początków kina cyfrowego"), icon: "history" },
  { key: "vod_fresh", filters: ["all", "vod_fresh", "movies"], title: () => ("🚀 Świeżo po kinach – nowe hity na VOD"),
    subtitle: () => ("Filmy, które niedawno zeszły z ekranów kinowych i trafiły do streamingu"), icon: "theaters" },
  { key: "top_movies", filters: ["all", "personalized", "movies"], title: () => ("Specjalnie dla Ciebie"),
    subtitle: () => ("Wysoko oceniane filmy dopasowane do Twoich najwyższych ocen"), icon: "auto_awesome" },
  { key: "top_shows", filters: ["all", "shows"], title: () => ("Najlepsze Seriale"),
    subtitle: () => ("Seriale z najwyższymi ocenami widzów na całym świecie"), icon: "tv" },
];

for (const cfg of FEED_SECTIONS) {
  if (!cfg.filters.includes(currentRecFilter)) continue;
  const src = recFeedData[cfg.key];
  if (!src) continue;
  const filtered = (src.results || []).filter(it => !isItemInLibrary(it));
  const section = buildCarouselSection(cfg.title(), cfg.subtitle(), cfg.icon, filtered);
  if (section) hub.appendChild(section);
}

  // Smart Offline / Library Fallback if online discovery returned empty
  const carouselSections = hub.querySelectorAll(".m3-carousel-section");
  if (carouselSections.length === 0) {
    const watchlistMovies = (state.movies || []).filter(m => m.status === "watchlist" || m.status === "planowane");
    if (watchlistMovies.length > 0 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "movies")) {
      const section = buildCarouselSection(
        "🍿 Do obejrzenia z Twojej biblioteki",
        "Tytuły oczekujące w Twojej bibliotece na seans",
        "schedule",
        watchlistMovies.slice(0, 15)
      );
      if (section) hub.appendChild(section);
    }

    const fiveStarFavs = (state.movies || []).filter(m => m.rating === 5 || m.is_favorite);
    if (fiveStarFavs.length > 0 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "classics" || currentRecFilter === "movies")) {
      const section = buildCarouselSection(
        "⭐ Twoje ulubione i najwyżej ocenione (5★)",
        "Klasyki i hity z Twojej prywatnej kolekcji",
        "star",
        fiveStarFavs.slice(0, 15)
      );
      if (section) hub.appendChild(section);
    }

    const watchingShows = (state.shows || []).filter(s => s.status === "watching" || (s.watched_count > 0 && s.status !== "watched"));
    if (watchingShows.length > 0 && (currentRecFilter === "all" || currentRecFilter === "personalized" || currentRecFilter === "shows")) {
      const section = buildCarouselSection(
        "📺 Seriale w trakcie oglądania",
        "Kontynuuj seans rozpoczętych sezonów i odcinków",
        "live_tv",
        watchingShows.slice(0, 15)
      );
      if (section) hub.appendChild(section);
    }
  }

  // If still completely empty after checking everything
  if (hub.querySelectorAll(".m3-carousel-section").length === 0) {
    const hasTmdb = Boolean(localStorage.getItem("cinelog_tmdb_key"));
    const emptyCard = document.createElement("div");
    emptyCard.className = "m3-surface-card";
    emptyCard.style.cssText = "text-align: center; padding: 48px 24px; margin: 20px auto; max-width: 620px; background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-xl); display: flex; flex-direction: column; align-items: center; gap: 14px;";

    if (!hasTmdb) {
      emptyCard.innerHTML = `
        <div style="width: 56px; height: 56px; border-radius: 16px; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); display: flex; align-items: center; justify-content: center;">
          <span class="material-symbols-rounded" style="font-size: 32px;">key</span>
        </div>
        <div>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--md-sys-color-on-surface); margin-bottom: 6px;">Wymagany darmowy klucz TMDb API</h3>
          <p style="font-size: 0.84rem; color: var(--md-sys-color-on-surface-variant); line-height: 1.5; max-width: 480px;">
            Sekcja <b>Dla Ciebie</b>, trendy tygodnia i katalogi VOD pobierają propozycje z bazy <b>The Movie Database (TMDb)</b>.<br>
            <span style="font-size: 0.76rem; opacity: 0.85;">(Klucz OMDb/IMDb służy wyłącznie do pobierania ocen punktowych dla pojedynczych filmów).</span>
          </p>
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px;">
          <button type="button" class="m3-btn-action-primary" onclick="if(window.openCloudSyncModal) window.openCloudSyncModal('keys');" style="font-weight: 700; padding: 10px 20px;">
            <span class="material-symbols-rounded">key</span>
            <span>Wprowadź klucz TMDb</span>
          </button>
          <a href="https://www.themoviedb.org/settings/api" target="_blank" class="m3-chip" style="font-weight: 700; padding: 10px 16px; text-decoration: none;">
            <span>Darmowy klucz TMDb ↗</span>
          </a>
        </div>
      `;
    } else {
      emptyCard.innerHTML = `
        <span class="material-symbols-rounded" style="font-size: 40px; color: var(--md-sys-color-on-surface-variant);">movie_filter</span>
        <h3 style="font-size: 1.05rem; font-weight: 700; color: var(--md-sys-color-on-surface);">Brak pasujących propozycji</h3>
        <p style="font-size: 0.84rem; color: var(--md-sys-color-on-surface-variant); max-width: 480px;">Wszystkie propozycje z tej kategorii znajdują się już w Twojej bibliotece lub filtr nie zwrócił wyników.</p>
        <button type="button" class="m3-btn-action-primary" onclick="loadRecommendationsHub(true)" style="margin-top: 6px;">
          <span class="material-symbols-rounded">refresh</span>
          <span>Odśwież propozycje</span>
        </button>
      `;
    }
    hub.appendChild(emptyCard);
  }
}

window.loadRecommendationsHub = loadRecommendationsHub;
window.openRecPreview = openRecPreview;
window.openPreviewVod = renderPreviewVod;
