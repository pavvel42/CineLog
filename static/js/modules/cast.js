// ==========================================================================
// CineLog - Cast, Crew & Actor Profile Explorer Module
// ==========================================================================

import { state, getGradientForTitle, isItemInLibrary, saveLocalDatabase, buildLocalLibraryEntry } from './state.js';
import { showToastNotification } from './ui.js';
import { getUserLanguage } from './vod.js';

export function normalizeTitleForMatch(str) {
  if (!str) return "";
  return str.toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolveProfileUrl(obj) {
  if (!obj) return null;
  const raw = obj.profile_url || obj.photo || obj.image || obj.avatar || obj.profile_path;
  if (!raw) return null;
  if (typeof raw === "string") {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return `https://image.tmdb.org/t/p/w185${raw}`;
    return `https://image.tmdb.org/t/p/w185/${raw}`;
  }
  return null;
}

export function renderCastRail(containerId, castList = [], directorsList = []) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  const peopleMap = new Map();

  // 1. Add Directors/Crew first
  (directorsList || []).forEach(d => {
    if (!d || !d.name) return;
    const key = (d.id ? `id_${d.id}` : `name_${normalizeTitleForMatch(d.name)}`);
    const photoUrl = resolveProfileUrl(d);
    peopleMap.set(key, {
      id: d.id,
      name: d.name,
      roles: [d.job || "Reżyser"],
      isCrew: true,
      profile_url: photoUrl
    });
  });

  // 2. Add Cast members, merging roles if person already exists (e.g. Director who also acts)
  (castList || []).forEach(c => {
    if (!c || !c.name) return;
    const key = (c.id ? `id_${c.id}` : `name_${normalizeTitleForMatch(c.name)}`);
    const charRole = c.character ? `jako ${c.character}` : "Aktor";
    const photoUrl = resolveProfileUrl(c);

    if (peopleMap.has(key)) {
      const existing = peopleMap.get(key);
      if (!existing.roles.includes(charRole)) {
        existing.roles.push(charRole);
      }
      if (!existing.profile_url && photoUrl) {
        existing.profile_url = photoUrl;
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
        profile_url: photoUrl
      });
    }
  });

  const uniquePeople = Array.from(peopleMap.values());
  if (uniquePeople.length === 0) {
    const parentSection = container.closest(".m3-cast-section") || container.parentElement;
    if (parentSection) parentSection.style.display = "none";
    return;
  }

  uniquePeople.forEach(p => {
    const card = document.createElement("div");
    card.className = "m3-cast-card";
    const combinedRole = p.roles.join(" • ");
    card.title = `${p.name} (${combinedRole})`;

    const photoHtml = p.profile_url
      ? `<img src="${p.profile_url}" alt="${p.name}" loading="lazy" data-fallback-display="flex"><div class="m3-cast-photo-fallback" style="display: none;"><span class="material-symbols-rounded" style="font-size: 24px; opacity: 0.85;">person</span></div>`
      : `<div class="m3-cast-photo-fallback"><span class="material-symbols-rounded" style="font-size: 24px; opacity: 0.85;">person</span></div>`;

    card.innerHTML = `
      <div class="m3-cast-photo-box">
        ${photoHtml}
      </div>
      <div class="m3-cast-name">${p.name}</div>
      <div class="m3-cast-character" style="${p.isCrew ? 'color: var(--md-sys-color-primary); font-weight: 600;' : ''}">${combinedRole}</div>
    `;

    card.addEventListener("click", (e) => {
      e.stopPropagation();
      openActorProfile(p.id, p.name);
    });

    container.appendChild(card);
  });
}

async function fetchActorProfileFromBackend(personId, personName) {
  if (window.location.protocol === "file:" || window.location.hostname.includes("github.io")) return null;
  try {
    const res = await fetch(`/api/actor/details?id=${personId || ''}&name=${encodeURIComponent(personName)}&lang=${getUserLanguage()}`);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

function mapTmdbCastRole(c) {
  return {
    tmdb_id: c.id,
    title: c.title || c.name || "Nieznany tytuł",
    original_title: c.original_title || c.original_name || c.title || c.name,
    year: (c.release_date || c.first_air_date || "").substring(0, 4),
    release_date: c.release_date || c.first_air_date || "",
    type: c.media_type === "tv" ? "series" : "movie",
    poster_url: c.poster_path ? `https://image.tmdb.org/t/p/w342${c.poster_path}` : null,
    role: c.character ? `jako ${c.character}` : "Aktor",
    vote_average: Math.round((c.vote_average || 0) * 10) / 10,
    vote_count: c.vote_count || 0,
    popularity: c.popularity || 0
  };
}

function mapTmdbCrewRole(c) {
  return {
    tmdb_id: c.id,
    title: c.title || c.name || "Nieznany tytuł",
    original_title: c.original_title || c.original_name || c.title || c.name,
    year: (c.release_date || c.first_air_date || "").substring(0, 4),
    release_date: c.release_date || c.first_air_date || "",
    type: c.media_type === "tv" ? "series" : "movie",
    poster_url: c.poster_path ? `https://image.tmdb.org/t/p/w342${c.poster_path}` : null,
    role: c.job === "Director" ? "Reżyser" : c.job,
    vote_average: Math.round((c.vote_average || 0) * 10) / 10,
    vote_count: c.vote_count || 0,
    popularity: c.popularity || 0
  };
}

function dedupeByPopularity(entries) {
  const seen = new Set();
  const result = [];
  entries
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .forEach(f => {
      const k = `${f.type}_${f.tmdb_id}`;
      if (!seen.has(k)) {
        seen.add(k);
        result.push(f);
      }
    });
  return result;
}

async function fetchActorBioFallbackEn(resolvedId, rawTmdbKey) {
  try {
    const pResEn = await fetch(`https://api.themoviedb.org/3/person/${resolvedId}?api_key=${encodeURIComponent(rawTmdbKey)}&language=en-US`);
    if (pResEn.ok) {
      const pDataEn = await pResEn.json();
      return pDataEn.biography || "";
    }
  } catch(e) {}
  return "";
}

async function resolveTmdbPersonId(personId, personName, rawTmdbKey) {
  if (personId && !isNaN(Number(personId))) return personId;
  const sRes = await fetch(`https://api.themoviedb.org/3/search/person?api_key=${encodeURIComponent(rawTmdbKey)}&query=${encodeURIComponent(personName)}&language=${getUserLanguage()}`);
  if (!sRes.ok) return null;
  const sData = await sRes.json();
  return sData.results && sData.results.length > 0 ? sData.results[0].id : null;
}

async function fetchActorProfileFromTmdb(personId, personName, rawTmdbKey) {
  try {
    const resolvedId = await resolveTmdbPersonId(personId, personName, rawTmdbKey);
    if (!resolvedId) return null;

    const pRes = await fetch(`https://api.themoviedb.org/3/person/${resolvedId}?api_key=${encodeURIComponent(rawTmdbKey)}&language=${getUserLanguage()}&append_to_response=combined_credits`);
    if (!pRes.ok) return null;

    const pData = await pRes.json();
    let bio = pData.biography || "";
    if (!bio) bio = await fetchActorBioFallbackEn(resolvedId, rawTmdbKey);

    const castRoles = (pData.combined_credits?.cast || []).map(mapTmdbCastRole);
    const crewRoles = (pData.combined_credits?.crew || [])
      .filter(c => c.job === "Director" || c.job === "Writer")
      .map(mapTmdbCrewRole);

    return {
      name: pData.name || personName,
      biography: bio || "Twórca filmowy i telewizyjny.",
      birthday: pData.birthday || null,
      deathday: pData.deathday || null,
      place_of_birth: pData.place_of_birth || null,
      profile_url: pData.profile_path ? `https://image.tmdb.org/t/p/w300${pData.profile_path}` : null,
      known_for_department: pData.known_for_department || "Film",
      filmography: dedupeByPopularity([...crewRoles, ...castRoles])
    };
  } catch (tmdbErr) {
    console.warn("Client TMDb actor fetch error:", tmdbErr);
    return null;
  }
}

function renderActorProfileMeta(data, personName, avatarImg, avatarFallback) {
  document.getElementById("m3-actor-name").innerText = data.name || personName;
  document.getElementById("m3-actor-bio").innerText = data.biography || "Twórca niezależny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).";

  if (data.profile_url) {
    avatarImg.src = data.profile_url;
    avatarImg.style.display = "block";
    avatarFallback.style.display = "none";
  }

  const metaRow = document.getElementById("m3-actor-meta-row");
  metaRow.innerHTML = "";
  if (data.known_for_department) {
    const deptLabel = data.known_for_department === "Acting" ? "Aktor / Aktorka" : (data.known_for_department === "Directing" ? "Reżyser" : data.known_for_department);
    metaRow.innerHTML += `<span class="m3-meta-badge highlight">${deptLabel}</span>`;
  }
  if (data.birthday) {
    const birthYear = data.birthday.split("-")[0];
    const age = data.deathday ? `† (${data.birthday} - ${data.deathday})` : `${new Date().getFullYear() - parseInt(birthYear)} lat`;
    metaRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">cake</span> ${age}</span>`;
  }
  if (data.place_of_birth) {
    metaRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">location_on</span> ${data.place_of_birth.split(",").slice(-2).join(",").trim()}</span>`;
  }
}

function collectActorLibraryMatches(filmography, personName) {
  const watchedInLib = [];
  const watchlistInLib = [];
  const matchedFilmographyKeys = new Set();
  const normSearchName = normalizeTitleForMatch(personName);

  const isFilmInLib = (f, libItem) => {
    if (f.tmdb_id && libItem.tmdb_id && String(f.tmdb_id) === String(libItem.tmdb_id)) return true;
    const libTitle = normalizeTitleForMatch(libItem.title);
    const fTitle1 = normalizeTitleForMatch(f.title);
    const fTitle2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
    return (fTitle1 && libTitle === fTitle1) || (fTitle2 && libTitle === fTitle2);
  };

  const registerMatch = (match, defaultType) => {
    matchedFilmographyKeys.add(`${match.type || defaultType}_${match.tmdb_id}`);
    matchedFilmographyKeys.add(normalizeTitleForMatch(match.title));
    if (match.original_title) matchedFilmographyKeys.add(normalizeTitleForMatch(match.original_title));
  };

  state.movies.forEach(m => {
    const match = filmography.find(f => isFilmInLib(f, m));
    const textMatch = (m.director && normalizeTitleForMatch(m.director).includes(normSearchName)) ||
                      (m.actors && normalizeTitleForMatch(m.actors).includes(normSearchName));
    if (match || textMatch) {
      if (match) registerMatch(match, 'movie');
      if (m.status === "watched") watchedInLib.push({ ...m, itemType: "movie" });
      else watchlistInLib.push({ ...m, itemType: "movie" });
    }
  });

  state.shows.forEach(s => {
    const match = filmography.find(f => isFilmInLib(f, s));
    const textMatch = (s.director && normalizeTitleForMatch(s.director).includes(normSearchName)) ||
                      (s.actors && normalizeTitleForMatch(s.actors).includes(normSearchName));
    if (match || textMatch) {
      if (match) registerMatch(match, 'series');
      if (s.watched_count > 0 || s.status === "watched") watchedInLib.push({ ...s, itemType: "show" });
      else watchlistInLib.push({ ...s, itemType: "show" });
    }
  });

  return { watchedInLib, watchlistInLib, matchedFilmographyKeys };
}

function renderActorLibraryGrid(grid, section, countElId, items) {
  if (items.length === 0) return;
  document.getElementById(countElId).innerText = `${items.length} ${items.length === 1 ? 'pozycja' : 'pozycji'}`;
  items.forEach(item => {
    grid.appendChild(createActorLibCard(item));
  });
  section.style.display = "flex";
}

function buildActorRecommendationCard(rec) {
  const card = document.createElement("div");
  card.className = "m3-actor-item-card";
  const posterSrc = rec.poster_url || "";
  card.innerHTML = `
    ${posterSrc ? `<img src="${posterSrc}" alt="${rec.title}" class="m3-actor-item-poster" loading="lazy" data-fallback-display="flex"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>`}
    <div class="m3-actor-item-body">
      <div class="m3-actor-item-title">${rec.title}</div>
      <div class="m3-actor-item-meta">
        <span>${rec.year || ''}</span>
        ${rec.vote_average ? `<span style="font-weight: 700; color: #f59e0b; display: inline-flex; align-items: center; gap: 2px;">★ ${rec.vote_average}</span>` : ''}
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
    addBtn.innerHTML = `<span class="material-symbols-rounded" style="font-size: 14px; animation: spin 1s linear infinite;">sync</span> Dodaję...`;
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

  return card;
}

function renderActorRecommendations(filmography, matchedFilmographyKeys, recGrid) {
  const recommendations = filmography.filter(f => {
    const key = `${f.type || 'movie'}_${f.tmdb_id}`;
    const n1 = normalizeTitleForMatch(f.title);
    const n2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
    if (matchedFilmographyKeys.has(key) || matchedFilmographyKeys.has(n1) || (n2 && matchedFilmographyKeys.has(n2))) return false;
    return !isItemInLibrary(f);
  }).slice(0, 15);

  if (recommendations.length === 0) {
    recGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.8rem;">Brak dodatkowych rekomendacji. Masz już w bibliotece wszystkie najważniejsze dzieła tego twórcy! 🎉</div>`;
    return;
  }
  recommendations.forEach(rec => {
    recGrid.appendChild(buildActorRecommendationCard(rec));
  });
}

export async function openActorProfile(personId, personName) {
  const sheet = document.getElementById("m3-sheet-actor");
  if (!sheet) return;

  document.getElementById("m3-actor-name").innerText = personName;
  document.getElementById("m3-actor-bio").innerText = "Wczytywanie informacji o aktorze...";
  document.getElementById("m3-actor-meta-row").innerHTML = `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px; animation: spin 1s linear infinite;">sync</span> Pobieram filmografię...</span>`;

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

  const rawTmdbKey = localStorage.getItem("cinelog_tmdb_key") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.TMDB_API_KEY) || "";

  try {
    let data = await fetchActorProfileFromBackend(personId, personName);

    // 2. Direct client-side TMDb API lookup (GitHub Pages / offline mode)
    if (!data && rawTmdbKey) {
      data = await fetchActorProfileFromTmdb(personId, personName, rawTmdbKey);
    }

    if (!data) {
      data = {
        name: personName,
        biography: "Twórca niezależny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).",
        filmography: []
      };
    }

    renderActorProfileMeta(data, personName, avatarImg, avatarFallback);

    const filmography = data.filmography || [];
    const { watchedInLib, watchlistInLib, matchedFilmographyKeys } = collectActorLibraryMatches(filmography, personName);

    renderActorLibraryGrid(watchedGrid, watchedSec, "m3-actor-watched-count", watchedInLib);
    renderActorLibraryGrid(watchlistGrid, watchlistSec, "m3-actor-watchlist-count", watchlistInLib);

    recLoading.style.display = "none";
    renderActorRecommendations(filmography, matchedFilmographyKeys, recGrid);

  } catch (err) {
    console.error("Error loading actor details:", err);
    document.getElementById("m3-actor-bio").innerText = "Wystąpił błąd podczas wczytywania profilu aktora.";
    recLoading.style.display = "none";
  }
}

export function createActorLibCard(item) {
  const card = document.createElement("div");
  card.className = "m3-actor-item-card";
  const posterSrc = item.poster_url || "";
  const isShow = item.itemType === "show";
  const statusLabel = item.status === "watched" || item.watched_count > 0 
    ? (item.rating ? `${item.rating}★` : "Obejrzane")
    : "Do obejrzenia";

  card.innerHTML = `
    ${posterSrc ? `<img src="${posterSrc}" alt="${item.title}" class="m3-actor-item-poster" loading="lazy" data-fallback-display="flex"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>`}
    <div class="m3-actor-item-body">
      <div class="m3-actor-item-title">${item.title}</div>
      <div class="m3-actor-item-meta">
        <span>${item.release_date ? item.release_date.split("-")[0] : (item.release_year || '')}</span>
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

export async function quickAddToWatchlist(item) {
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

  const finishAdd = (added) => {
    if (isShow) {
      state.shows.unshift(added);
    } else {
      state.movies.unshift(added);
    }
    saveLocalDatabase();
    showToastNotification(`Dodano "${item.title}" do listy Do obejrzenia! 🎬`);
  };

  try {
    const endpoint = isShow ? "/api/shows" : "/api/movies";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      finishAdd(await res.json());
    } else {
      // Tryb klienta (GitHub Pages / offline): zapis lokalny zamiast cichej porażki.
      finishAdd(buildLocalLibraryEntry(item, isShow ? "series" : "movie", "watchlist"));
    }
  } catch (err) {
    console.error("Error quick adding to watchlist:", err);
    finishAdd(buildLocalLibraryEntry(item, isShow ? "series" : "movie", "watchlist"));
  }
}
