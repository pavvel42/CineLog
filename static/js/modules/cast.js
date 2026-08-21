// ==========================================================================
// CineLog - Cast, Crew & Actor Profile Explorer Module
// ==========================================================================

import { state, getGradientForTitle, isItemInLibrary, saveLocalDatabase } from './state.js';
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
      ? `<img src="${p.profile_url}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-cast-photo-fallback" style="display: none;"><span class="material-symbols-rounded" style="font-size: 24px; opacity: 0.85;">person</span></div>`
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

  try {
    const res = await fetch(`/api/actor/details?id=${personId || ''}&name=${encodeURIComponent(personName)}&lang=${getUserLanguage()}`);
    const data = res.ok ? await res.json() : {
      name: personName,
      biography: "Twórca niezależny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).",
      filmography: []
    };

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

    const filmography = data.filmography || [];

    const isFilmInLib = (f, libItem) => {
      if (f.tmdb_id && libItem.tmdb_id && String(f.tmdb_id) === String(libItem.tmdb_id)) return true;
      const libTitle = normalizeTitleForMatch(libItem.title);
      const fTitle1 = normalizeTitleForMatch(f.title);
      const fTitle2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
      return (fTitle1 && libTitle === fTitle1) || (fTitle2 && libTitle === fTitle2);
    };

    const watchedInLib = [];
    const watchlistInLib = [];
    const matchedFilmographyKeys = new Set();
    const normSearchName = normalizeTitleForMatch(personName);

    state.movies.forEach(m => {
      const match = filmography.find(f => isFilmInLib(f, m));
      const textMatch = (m.director && normalizeTitleForMatch(m.director).includes(normSearchName)) ||
                        (m.actors && normalizeTitleForMatch(m.actors).includes(normSearchName));
      if (match || textMatch) {
        if (match) {
          matchedFilmographyKeys.add(`${match.type || 'movie'}_${match.tmdb_id}`);
          matchedFilmographyKeys.add(normalizeTitleForMatch(match.title));
          if (match.original_title) matchedFilmographyKeys.add(normalizeTitleForMatch(match.original_title));
        }
        if (m.status === "watched") watchedInLib.push({ ...m, itemType: "movie" });
        else watchlistInLib.push({ ...m, itemType: "movie" });
      }
    });

    state.shows.forEach(s => {
      const match = filmography.find(f => isFilmInLib(f, s));
      const textMatch = (s.director && normalizeTitleForMatch(s.director).includes(normSearchName)) ||
                        (s.actors && normalizeTitleForMatch(s.actors).includes(normSearchName));
      if (match || textMatch) {
        if (match) {
          matchedFilmographyKeys.add(`${match.type || 'series'}_${match.tmdb_id}`);
          matchedFilmographyKeys.add(normalizeTitleForMatch(match.title));
          if (match.original_title) matchedFilmographyKeys.add(normalizeTitleForMatch(match.original_title));
        }
        if (s.watched_count > 0 || s.status === "watched") watchedInLib.push({ ...s, itemType: "show" });
        else watchlistInLib.push({ ...s, itemType: "show" });
      }
    });

    if (watchedInLib.length > 0) {
      document.getElementById("m3-actor-watched-count").innerText = `${watchedInLib.length} ${watchedInLib.length === 1 ? 'pozycja' : 'pozycji'}`;
      watchedInLib.forEach(item => {
        watchedGrid.appendChild(createActorLibCard(item));
      });
      watchedSec.style.display = "flex";
    }

    if (watchlistInLib.length > 0) {
      document.getElementById("m3-actor-watchlist-count").innerText = `${watchlistInLib.length} ${watchlistInLib.length === 1 ? 'pozycja' : 'pozycji'}`;
      watchlistInLib.forEach(item => {
        watchlistGrid.appendChild(createActorLibCard(item));
      });
      watchlistSec.style.display = "flex";
    }

    recLoading.style.display = "none";
    const recommendations = filmography.filter(f => {
      const key = `${f.type || 'movie'}_${f.tmdb_id}`;
      const n1 = normalizeTitleForMatch(f.title);
      const n2 = f.original_title ? normalizeTitleForMatch(f.original_title) : "";
      if (matchedFilmographyKeys.has(key) || matchedFilmographyKeys.has(n1) || (n2 && matchedFilmographyKeys.has(n2))) return false;
      return !isItemInLibrary(f);
    }).slice(0, 15);

    if (recommendations.length > 0) {
      recommendations.forEach(rec => {
        const card = document.createElement("div");
        card.className = "m3-actor-item-card";
        const posterSrc = rec.poster_url || "";
        card.innerHTML = `
          ${posterSrc ? `<img src="${posterSrc}" alt="${rec.title}" class="m3-actor-item-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(rec.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${rec.title}</div>`}
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

        recGrid.appendChild(card);
      });
    } else {
      recGrid.innerHTML = `<div style="grid-column: 1 / -1; padding: 14px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.8rem;">Brak dodatkowych rekomendacji. Masz już w bibliotece wszystkie najważniejsze dzieła tego twórcy! 🎉</div>`;
    }

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
    ${posterSrc ? `<img src="${posterSrc}" alt="${item.title}" class="m3-actor-item-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-actor-item-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>` : `<div class="m3-actor-item-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(item.title)}; color: #fff; font-weight: 700; font-size: 0.75rem; text-align: center; padding: 4px;">${item.title}</div>`}
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

  try {
    const endpoint = isShow ? "/api/shows" : "/api/movies";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const added = await res.json();
      if (isShow) {
        state.shows.unshift(added);
      } else {
        state.movies.unshift(added);
      }
      saveLocalDatabase();
      showToastNotification(`Dodano "${item.title}" do listy Do obejrzenia! 🎬`);
    }
  } catch (err) {
    console.error("Error quick adding to watchlist:", err);
  }
}
