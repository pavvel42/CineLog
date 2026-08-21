// ==========================================================================
// CineLog - Movies Management & Details Modal Module
// ==========================================================================

import { state, getGradientForTitle, saveLocalDatabase, syncWindowAliases, normalizeTitleForLibrary } from './state.js';
import { showToastNotification, showM3ConfirmDialog } from './ui.js';
import { updateStats } from './stats.js';
import { getWatchProvidersForTitle, matchVodFilter, ensureVodDataForVisible, getUserLanguage, getCountryDisplayName } from './vod.js';
import { renderCastRail, normalizeTitleForMatch } from './cast.js';

export function getItemWatchDate(item, type) {
  if (type === "movie") {
    return item.watch_date || item.follow_date || item.created_at || "";
  } else {
    if (item.episodes_watched && item.episodes_watched.length > 0) {
      let maxEpDate = "";
      for (const ep of item.episodes_watched) {
        if (ep.created_at && ep.created_at > maxEpDate) {
          maxEpDate = ep.created_at;
        }
      }
      if (maxEpDate) return maxEpDate;
    }
    return item.updated_at || item.created_at || "";
  }
}

export function sortItems(items, sortMode, type = "movie") {
  return [...items].sort((a, b) => {
    if (sortMode === "default" || sortMode === "watched_desc") {
      const dateA = getItemWatchDate(a, type);
      const dateB = getItemWatchDate(b, type);
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (dateA && dateB && dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "watched_asc") {
      const dateA = getItemWatchDate(a, type);
      const dateB = getItemWatchDate(b, type);
      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (dateA && dateB && dateA !== dateB) {
        return dateA.localeCompare(dateB);
      }
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "title_asc") {
      return (a.title || "").localeCompare(b.title || "", "pl", { sensitivity: "base" });
    }
    if (sortMode === "title_desc") {
      return (b.title || "").localeCompare(a.title || "", "pl", { sensitivity: "base" });
    }
    if (sortMode === "rating_desc") {
      const rA = a.rating !== null && a.rating !== undefined ? a.rating : -1;
      const rB = b.rating !== null && b.rating !== undefined ? b.rating : -1;
      if (rB !== rA) return rB - rA;
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "rating_asc") {
      const rA = a.rating !== null && a.rating !== undefined ? a.rating : 99;
      const rB = b.rating !== null && b.rating !== undefined ? b.rating : 99;
      if (rA !== rB) return rA - rB;
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "release_desc") {
      const yA = a.release_date || (a.release_year ? `${a.release_year}-01-01` : "") || "";
      const yB = b.release_date || (b.release_year ? `${b.release_year}-01-01` : "") || "";
      if (yA && !yB) return -1;
      if (!yA && yB) return 1;
      if (yA && yB && yA !== yB) return yB.localeCompare(yA);
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    if (sortMode === "release_asc") {
      const yA = a.release_date || (a.release_year ? `${a.release_year}-01-01` : "") || "";
      const yB = b.release_date || (b.release_year ? `${b.release_year}-01-01` : "") || "";
      if (yA && !yB) return -1;
      if (!yA && yB) return 1;
      if (yA && yB && yA !== yB) return yA.localeCompare(yB);
      return (a.title || "").localeCompare(b.title || "", "pl");
    }
    return 0;
  });
}

export async function renderMovies() {
  const grid = document.getElementById("m3-movies-grid");
  if (!grid) return;
  const searchInput = document.getElementById("m3-search-input");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : "";

  let filtered = (state.movies || []).filter(m => {
    if (!m) return false;
    if (state.activeMovieTab === "watched" && m.status !== "watched") return false;
    if (state.activeMovieTab === "watchlist" && m.status !== "watchlist") return false;
    if (state.activeMovieTab === "favorites" && !m.is_favorite) return false;
    if (state.activeVodFilter === "fav" && !m.is_favorite) return false;
    if (state.activeMovieTab === "top_rated" && (m.rating === null || m.rating < 4)) return false;
    
    if (searchQuery) {
      return m.title && m.title.toLowerCase().includes(searchQuery);
    }
    return true;
  });

  if (state.activeVodFilter !== "all" && state.activeVodFilter !== "fav") {
    await ensureVodDataForVisible(filtered, "movie");
    filtered = filtered.filter(m => matchVodFilter(m.title, "movie"));
  }

  filtered = sortItems(filtered, state.sortMode, "movie");

  const countEl = document.getElementById("m3-visible-count");
  if (countEl) countEl.innerText = filtered.length;

  grid.innerHTML = "";

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 48px; margin-bottom: 12px;">search_off</span>
        <p>Brak filmów spełniających wybrane kryteria i filtr VOD.</p>
      </div>
    `;
    return;
  }

  filtered.forEach(m => {
    const card = document.createElement("article");
    card.className = "m3-card";

    let coverHtml = "";
    if (m.poster_url) {
      coverHtml = `
        <img src="${m.poster_url}" alt="${m.title}" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
        <div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(m.title)}; display: none;">${m.title}</div>
      `;
    } else {
      coverHtml = `<div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(m.title)}">${m.title}</div>`;
    }

    let starsHtml = "";
    for (let i = 1; i <= 5; i++) {
      const active = (m.rating && i <= m.rating) ? "active" : "";
      starsHtml += `<span class="material-symbols-rounded m3-star ${active}" data-val="${i}">star</span>`;
    }

    const isFav = Boolean(m.is_favorite);
    const favActiveClass = isFav ? "is-fav active" : "";
    const favIconStyle = isFav ? "font-variation-settings: 'FILL' 1; color: var(--md-sys-color-favorite);" : "";

    let statusText = "Do obejrzenia";
    let statusColor = "#a855f7";
    if (m.status === "watched") {
      statusText = "Obejrzane";
      statusColor = "#10b981";
    }

    card.innerHTML = `
      <div class="m3-card-cover">
        ${coverHtml}
        <button class="m3-card-fav-btn ${favActiveClass}" data-uuid="${m.uuid}" title="${isFav ? 'Usuń z ulubionych' : 'Dodaj do ulubionych'}">
          <span class="material-symbols-rounded" style="${favIconStyle}">favorite</span>
        </button>
      </div>
      <div class="m3-card-body">
        <div class="m3-card-title">${m.title}</div>
        <div class="m3-card-meta">
          <span>${m.release_date ? m.release_date.split("-")[0] : (m.release_year || '')}</span>
          <span class="m3-status-btn" style="cursor: pointer; font-weight: 700; color: ${statusColor}; display: inline-flex; align-items: center; gap: 4px;">
            <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: ${statusColor};"></span>
            ${statusText}
          </span>
        </div>
        <div class="m3-stars" data-uuid="${m.uuid}">
          ${starsHtml}
        </div>
      </div>
    `;

    card.addEventListener("click", () => {
      openMovieDetail(m);
    });

    const favBtn = card.querySelector(".m3-card-fav-btn");
    favBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMovieFavorite(m.uuid, isFav);
    });

    const statusBtn = card.querySelector(".m3-status-btn");
    statusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextStatus = m.status === "watched" ? "watchlist" : "watched";
      updateMovieStatus(m.uuid, nextStatus);
    });

    const starSpans = card.querySelectorAll(".m3-star");
    starSpans.forEach(star => {
      star.addEventListener("click", (e) => {
        e.stopPropagation();
        const val = parseInt(star.getAttribute("data-val"), 10);
        const nextVal = m.rating === val ? null : val;
        updateMovieRating(m.uuid, nextVal);
      });
    });

    grid.appendChild(card);
  });
}

export async function openMovieDetail(movie) {
  document.getElementById("m3-detail-title").innerText = movie.title;
  document.getElementById("m3-detail-meta").innerText = `${movie.release_date ? movie.release_date.split("-")[0] : 'Film'} • Film kinowy`;
  document.getElementById("m3-detail-plot").innerText = "Wczytywanie szczegółów filmu...";

  const badgesRow = document.getElementById("m3-detail-badges-row");
  if (badgesRow) {
    badgesRow.innerHTML = "";
    const y = movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : null);
    if (y) badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${y}</span>`;
    if (movie.watch_date && movie.status === "watched") {
      const formattedDate = movie.watch_date.split(" ")[0];
      badgesRow.innerHTML += `<span class="m3-meta-badge highlight" title="Data oznaczenia jako obejrzany: ${movie.watch_date}"><span class="material-symbols-rounded" style="font-size: 13px;">visibility</span> Obejrzano: ${formattedDate}</span>`;
    }
  }

  const imgEl = document.getElementById("m3-detail-img");
  if (movie.poster_url) {
    imgEl.src = movie.poster_url;
    imgEl.style.display = "block";
  } else {
    imgEl.style.display = "none";
  }

  const favBtn = document.getElementById("m3-detail-fav-btn");
  if (favBtn) {
    const updateFavBtnUI = () => {
      const isFav = Boolean(movie.is_favorite);
      favBtn.className = `m3-card-fav-btn ${isFav ? 'is-fav active' : ''}`;
      favBtn.innerHTML = `<span class="material-symbols-rounded" style="${isFav ? 'font-variation-settings: \'FILL\' 1; color: var(--md-sys-color-favorite);' : ''}">favorite</span>`;
      favBtn.title = isFav ? "Usuń z ulubionych" : "Dodaj do ulubionych";
    };
    updateFavBtnUI();
    favBtn.onclick = () => {
      toggleMovieFavorite(movie.uuid, Boolean(movie.is_favorite));
      movie.is_favorite = !movie.is_favorite;
      updateFavBtnUI();
    };
  }

  const btnWatched = document.getElementById("m3-detail-btn-watched");
  const btnWatchlist = document.getElementById("m3-detail-btn-watchlist");
  const starsContainer = document.getElementById("m3-detail-stars");

  const updateStatusUI = () => {
    if (movie.status === "watched") {
      btnWatched.classList.add("active");
      btnWatchlist.classList.remove("active");
      starsContainer.style.opacity = "1";
      starsContainer.style.pointerEvents = "auto";
      starsContainer.title = "Kliknij gwiazdkę, aby ocenić film (1-5★)";
    } else {
      btnWatchlist.classList.add("active");
      btnWatched.classList.remove("active");
      starsContainer.style.opacity = "0.35";
      starsContainer.style.pointerEvents = "none";
      starsContainer.title = "Oznacz film jako obejrzany, aby wystawić ocenę";
    }
  };

  btnWatched.onclick = () => {
    if (movie.status !== "watched") {
      updateMovieStatus(movie.uuid, "watched");
      movie.status = "watched";
      updateStatusUI();
      renderMovies();
      updateStats();
    }
  };

  btnWatchlist.onclick = () => {
    if (movie.status !== "watchlist") {
      updateMovieStatus(movie.uuid, "watchlist");
      movie.status = "watchlist";
      if (movie.rating) {
        updateMovieRating(movie.uuid, null);
        movie.rating = null;
      }
      openMovieDetail(movie);
      renderMovies();
      updateStats();
    }
  };

  updateStatusUI();

  const deleteBtn = document.getElementById("m3-detail-delete-btn");
  if (deleteBtn) {
    deleteBtn.onclick = async () => {
      const confirmed = await showM3ConfirmDialog({
        title: "Usunąć film z biblioteki?",
        message: `Czy na pewno chcesz usunąć film <b>"${movie.title}"</b>? Ta operacja usunie go z Twojej kolekcji.`,
        confirmText: "Usuń film",
        cancelText: "Anuluj",
        icon: "delete_forever",
        isDestructive: true
      });
      if (!confirmed) return;
      await deleteMovie(movie);
    };
  }

  starsContainer.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const active = (movie.status === "watched" && movie.rating && i <= movie.rating) ? "active" : "";
    const star = document.createElement("span");
    star.className = `material-symbols-rounded m3-star ${active}`;
    star.innerText = "star";
    star.addEventListener("click", () => {
      if (movie.status !== "watched") return;
      const nextRating = movie.rating === i ? null : i;
      updateMovieRating(movie.uuid, nextRating);
      movie.rating = nextRating;
      openMovieDetail(movie);
      renderMovies();
    });
    starsContainer.appendChild(star);
  }

  const regionEl = document.getElementById("m3-detail-vod-region");
  if (regionEl) regionEl.innerText = getCountryDisplayName(state.userVodCountry);
  
  const vodLoading = document.getElementById("m3-detail-vod-loading");
  const vodResults = document.getElementById("m3-detail-vod-results");
  const boxFlat = document.getElementById("m3-vod-box-flatrate");
  const boxRent = document.getElementById("m3-vod-box-rent");
  const boxFree = document.getElementById("m3-vod-box-free");
  const boxEmpty = document.getElementById("m3-vod-box-empty");

  vodLoading.style.display = "flex";
  vodResults.style.display = "none";
  boxFlat.style.display = "none";
  boxRent.style.display = "none";
  document.getElementById("m3-sheet-movie-detail").classList.add("active");

  const rematchBtn = document.getElementById("m3-detail-rematch-btn");
  if (rematchBtn) {
    rematchBtn.onclick = () => {
      openMovieRematchPicker(movie);
    };
  }

  try {
    const localTmdbKey = localStorage.getItem("cinelog_tmdb_key") || "";
    const localOmdbKey = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key") || "";
    const tmdbKeyParam = localTmdbKey ? `&tmdb_key=${encodeURIComponent(localTmdbKey)}` : "";
    const omdbKeyParam = localOmdbKey ? `&omdb_key=${encodeURIComponent(localOmdbKey)}&imdb_key=${encodeURIComponent(localOmdbKey)}` : "";
    const movieYear = movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : "");
    const tmdbParam = movie.tmdb_id ? `&tmdb_id=${movie.tmdb_id}` : "";
    const yearParam = movieYear ? `&year=${movieYear}` : "";
    const posterParam = movie.poster_url ? `&poster_url=${encodeURIComponent(movie.poster_url)}` : "";
    const detailFetchUrl = `/api/search_detail?title=${encodeURIComponent(movie.title)}&type=movie&lang=${getUserLanguage()}${tmdbParam}${yearParam}${posterParam}${tmdbKeyParam}${omdbKeyParam}`;

    const [detailRes, vodData] = await Promise.all([
      fetch(detailFetchUrl).catch(() => ({ ok: false })),
      getWatchProvidersForTitle(movie.title, "movie", movie.tmdb_id)
    ]);

    let detail = null;
    if (detailRes.ok) {
      detail = await detailRes.json();
    } else if (localTmdbKey && movie.tmdb_id) {
      try {
        const tmdbRes = await fetch(`https://api.themoviedb.org/3/movie/${movie.tmdb_id}?api_key=${encodeURIComponent(localTmdbKey)}&language=${getUserLanguage()}&append_to_response=credits,release_dates`);
        if (tmdbRes.ok) {
          const tData = await tmdbRes.json();
          detail = {
            plot: tData.overview || movie.plot || "",
            genre: (tData.genres || []).map(g => g.name).join(", "),
            year: (tData.release_date || movie.release_year || "").substring(0, 4),
            runtime: tData.runtime,
            vote_average: tData.vote_average,
            cast: (tData.credits && tData.credits.cast) ? tData.credits.cast.slice(0, 10).map(c => ({
              id: c.id,
              name: c.name,
              character: c.character,
              profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
            })) : [],
            directors: (tData.credits && tData.credits.crew) ? tData.credits.crew.filter(c => c.job === "Director").map(c => ({
              id: c.id,
              name: c.name,
              job: "Reżyser",
              profile_url: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
            })) : []
          };
        }
      } catch(e) {}
    }

    if (detail) {
      if (detail.plot) document.getElementById("m3-detail-plot").innerText = detail.plot;
      else if (movie.plot) document.getElementById("m3-detail-plot").innerText = movie.plot;
      else document.getElementById("m3-detail-plot").innerText = "Brak szczegółowego opisu filmu.";

      if (detail.genre) document.getElementById("m3-detail-meta").innerText = `${detail.year || ''} • ${detail.genre}`;

      if (badgesRow) {
        badgesRow.innerHTML = "";
        const y = detail.year || movie.release_year || (movie.release_date ? movie.release_date.split("-")[0] : null);
        if (y) badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">calendar_today</span> ${y}</span>`;
        if (detail.runtime) {
          const hrs = Math.floor(detail.runtime / 60);
          const mins = detail.runtime % 60;
          const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins} min`;
          badgesRow.innerHTML += `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 13px;">schedule</span> ${timeStr}</span>`;
        }
        if (detail.vote_average && detail.vote_average > 0) {
          badgesRow.innerHTML += `<span class="m3-meta-badge tmdb-score"><span class="material-symbols-rounded" style="font-size: 13px;">star</span> ${detail.vote_average.toFixed(1)}</span>`;
        }
        if (detail.genre) {
          const firstGenre = detail.genre.split(",")[0].trim();
          badgesRow.innerHTML += `<span class="m3-meta-badge highlight">${firstGenre}</span>`;
        }
      }

      const castSection = document.getElementById("m3-detail-cast-section");
      if (castSection) {
        if (detail.cast && detail.cast.length > 0) {
          renderCastRail("m3-detail-cast-rail", detail.cast, detail.directors);
          castSection.style.display = "block";
        } else {
          castSection.style.display = "none";
        }
      }
    } else {
      if (movie.plot) document.getElementById("m3-detail-plot").innerText = movie.plot;
      else document.getElementById("m3-detail-plot").innerText = "Brak szczegółowego opisu.";
    }

    vodLoading.style.display = "none";
    vodResults.style.display = "flex";

    const flatrates = vodData.flatrate || [];
    const rents = [...(vodData.rent || []), ...(vodData.buy || [])];
    const uniqueRents = [];
    const seen = new Set();
    rents.forEach(r => {
      if (!seen.has(r.name)) {
        seen.add(r.name);
        uniqueRents.push(r);
      }
    });
    const frees = vodData.free || [];

    const renderLogos = (containerId, list) => {
      const cont = document.getElementById(containerId);
      cont.innerHTML = "";
      list.forEach(p => {
        const badge = document.createElement("div");
        badge.className = "m3-vod-logo-badge";
        badge.title = p.name;
        badge.innerHTML = `
          ${p.logo_url ? `<img src="${p.logo_url}" alt="${p.name}">` : `<span class="material-symbols-rounded" style="font-size: 18px;">movie</span>`}
          <span>${p.name}</span>
        `;
        cont.appendChild(badge);
      });
    };

    let hasAny = false;
    if (flatrates.length > 0) {
      boxFlat.style.display = "block";
      renderLogos("m3-vod-logos-flatrate", flatrates);
      hasAny = true;
    }
    if (uniqueRents.length > 0) {
      boxRent.style.display = "block";
      renderLogos("m3-vod-logos-rent", uniqueRents);
      hasAny = true;
    }
    if (frees.length > 0) {
      boxFree.style.display = "block";
      renderLogos("m3-vod-logos-free", frees);
      hasAny = true;
    }

    if (!hasAny) {
      boxEmpty.style.display = "block";
    } else {
      boxEmpty.style.display = "none";
    }

    const jwBtn = document.getElementById("m3-btn-justwatch-link");
    if (jwBtn) {
      if (vodData && vodData.link) {
        jwBtn.href = vodData.link;
        jwBtn.style.display = "inline-flex";
      } else {
        jwBtn.style.display = "none";
      }
    }

  } catch (err) {
    console.warn("Error rendering VOD detail:", err);
    vodLoading.style.display = "none";
    vodResults.style.display = "flex";
  }
}

export async function toggleMovieFavorite(uuid, currentFav) {
  const nextFav = !currentFav;
  const found = state.movies.find(m => m.uuid === uuid || m.id === uuid || String(m.tmdb_id) === String(uuid));
  if (found) found.is_favorite = nextFav;
  renderMovies();
  updateStats();
  saveLocalDatabase();

  if (window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
    try {
      await fetch(`/api/movies/${encodeURIComponent(uuid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorite: nextFav })
      });
    } catch (e) {}
  }
}

export async function updateMovieStatus(uuid, status) {
  const payload = { status };
  if (status === "watched") {
    payload.watch_date = new Date().toISOString().replace("T", " ").substring(0, 19);
  }
  const found = state.movies.find(m => m.uuid === uuid || m.id === uuid || String(m.tmdb_id) === String(uuid));
  if (found) {
    found.status = status;
    if (status === "watched" && !found.watch_date) {
      found.watch_date = payload.watch_date;
    }
  }
  renderMovies();
  updateStats();
  saveLocalDatabase();
  showToastNotification(status === "watched" ? "Oznaczono jako obejrzane! 🎉" : "Przeniesiono do Do obejrzenia.");

  if (window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
    try {
      await fetch(`/api/movies/${encodeURIComponent(uuid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {}
  }
}

export async function updateMovieRating(uuid, rating) {
  const found = state.movies.find(m => m.uuid === uuid || m.id === uuid || String(m.tmdb_id) === String(uuid));
  if (found) found.rating = rating;
  renderMovies();
  updateStats();
  saveLocalDatabase();
  showToastNotification(rating ? `Oceniono na ${rating}★` : "Usunięto ocenę.");

  if (window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
    try {
      await fetch(`/api/movies/${encodeURIComponent(uuid)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating })
      });
    } catch (e) {}
  }
}

export async function deleteMovie(itemOrUuid) {
  const isObj = typeof itemOrUuid === "object" && itemOrUuid !== null;
  const targetUuid = isObj ? itemOrUuid.uuid : itemOrUuid;
  const targetId = isObj ? itemOrUuid.id : itemOrUuid;
  const targetTmdb = isObj ? itemOrUuid.tmdb_id : null;
  const targetTitle = isObj ? itemOrUuid.title : (typeof itemOrUuid === "string" ? itemOrUuid : null);
  const targetNorm = targetTitle ? normalizeTitleForLibrary(targetTitle) : null;

  state.movies = state.movies.filter(m => {
    if (isObj && m === itemOrUuid) return false;
    if (targetUuid && m.uuid && String(m.uuid) === String(targetUuid)) return false;
    if (targetId && m.id && String(m.id) === String(targetId)) return false;
    if (targetTmdb && m.tmdb_id && String(m.tmdb_id) === String(targetTmdb)) return false;
    if (targetNorm && m.title && normalizeTitleForLibrary(m.title) === targetNorm) return false;
    return true;
  });

  saveLocalDatabase();
  syncWindowAliases();
  updateStats();
  renderMovies();

  const sheet = document.getElementById("m3-sheet-movie-detail");
  if (sheet) sheet.classList.remove("active");

  showToastNotification("Film został usunięty z biblioteki.", "info");

  const backendId = targetUuid || targetId || targetTmdb;
  if (backendId && window.location.protocol !== "file:" && !window.location.hostname.includes("github.io")) {
    try {
      await fetch(`/api/movies/${encodeURIComponent(backendId)}`, { method: "DELETE" });
    } catch (err) {}
  }
}

export function openMovieRematchPicker(movie) {
  openRematchPicker(movie, "movie");
}

export async function openRematchPicker(item, itemType = "movie") {
  if (itemType === "movie") {
    const movieSheet = document.getElementById("m3-sheet-movie-detail");
    if (movieSheet) movieSheet.classList.remove("active");
  } else {
    const showSheet = document.getElementById("m3-sheet-episodes");
    if (showSheet) showSheet.classList.remove("active");
  }

  const sheetRematch = document.getElementById("m3-sheet-rematch");
  const titleEl = document.getElementById("m3-rematch-title");
  const inputEl = document.getElementById("m3-rematch-search-input");
  const loadingEl = document.getElementById("m3-rematch-loading");
  const resultsContainer = document.getElementById("m3-rematch-results-list");
  const closeBtn = document.getElementById("m3-rematch-close-btn");
  const searchBtn = document.getElementById("m3-rematch-search-btn");

  const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
  titleEl.innerText = `Zmień wersję: ${item.title}`;
  inputEl.value = cleanTitle;
  resultsContainer.innerHTML = "";
  loadingEl.style.display = "flex";

  closeBtn.onclick = () => {
    sheetRematch.classList.remove("active");
    if (itemType === "movie") {
      openMovieDetail(item);
    } else if (window.openEpisodeTracker) {
      window.openEpisodeTracker(item);
    }
  };

  const doSearch = async (query) => {
    if (!query) return;
    loadingEl.style.display = "flex";
    resultsContainer.innerHTML = "";

    try {
      const typeParam = itemType === "series" ? "series" : "movie";
      const res = await fetch(`/api/search_preview?q=${encodeURIComponent(query)}&type=${typeParam}&lang=${getUserLanguage()}`);
      loadingEl.style.display = "none";

      if (!res.ok) {
        resultsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.85rem;">Nie znaleziono pozycji w TMDb.</div>`;
        return;
      }

      const data = await res.json();
      const results = data.results || (data.item ? [data.item] : []);
      if (results.length === 0) {
        resultsContainer.innerHTML = `<div style="padding: 16px; text-align: center; color: var(--md-sys-color-on-surface-variant); font-size: 0.85rem;">Brak innych wersji pasujących do "${query}".</div>`;
        return;
      }

      results.forEach(it => {
        const card = document.createElement("div");
        const pUrl = it.poster_url || "";
        const yearStr = it.year || (it.release_date ? it.release_date.split("-")[0] : "");
        const isCurrentMatch = (it.tmdb_id && item.tmdb_id && String(it.tmdb_id) === String(item.tmdb_id)) || (it.poster_url && item.poster_url && it.poster_url === item.poster_url);
        card.className = `m3-rematch-card ${isCurrentMatch ? 'is-active-match' : ''}`;

        card.innerHTML = `
          <div class="m3-rematch-poster">
            ${pUrl ? `<img src="${pUrl}" alt="${it.title}" loading="lazy">` : `<span class="material-symbols-rounded" style="font-size: 26px; color: var(--md-sys-color-on-surface-variant);">${itemType === 'series' ? 'tv' : 'movie'}</span>`}
          </div>
          <div class="m3-rematch-body">
            <div class="m3-rematch-title-row">
              <span class="m3-rematch-card-title">${it.title}</span>
              ${isCurrentMatch ? `<span class="m3-meta-badge highlight" style="font-size: 0.68rem; padding: 2px 8px;"><span class="material-symbols-rounded" style="font-size: 13px;">check_circle</span> Aktualna wersja</span>` : ''}
            </div>
            <div class="m3-rematch-badges-row">
              ${yearStr ? `<span class="m3-meta-badge"><span class="material-symbols-rounded" style="font-size: 12px;">calendar_today</span> ${yearStr}</span>` : ''}
              ${it.original_title && it.original_title !== it.title ? `<span class="m3-meta-badge">${it.original_title}</span>` : ''}
              ${it.vote_average && it.vote_average > 0 ? `<span class="m3-meta-badge tmdb-score"><span class="material-symbols-rounded" style="font-size: 12px;">star</span> ${Number(it.vote_average).toFixed(1)}</span>` : ''}
            </div>
            <p class="m3-rematch-plot">${it.overview || it.plot || 'Brak opisu fabuły w bazie TMDb.'}</p>
          </div>
          <button type="button" class="m3-rematch-select-btn ${isCurrentMatch ? 'is-current' : ''}">
            <span class="material-symbols-rounded" style="font-size: 16px;">${isCurrentMatch ? 'check' : 'sync'}</span>
            <span>${isCurrentMatch ? 'Wybrana' : 'Wybierz'}</span>
          </button>
        `;

        card.addEventListener("click", async () => {
          const payload = {
            title: it.title,
            poster_url: it.poster_url || item.poster_url,
            release_date: it.release_date || item.release_date,
            tmdb_id: it.tmdb_id || it.id
          };

          try {
            const endpoint = itemType === "series" ? `/api/shows/${item.uuid}` : `/api/movies/${item.uuid}`;
            const updateRes = await fetch(endpoint, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });

            if (updateRes.ok) {
              const updated = await updateRes.json();
              Object.assign(item, updated);

              sheetRematch.classList.remove("active");

              if (itemType === "series") {
                if (window.renderShows) window.renderShows();
                updateStats();
                if (window.openEpisodeTracker) window.openEpisodeTracker(item);
                showToastNotification(`Zaktualizowano wersję serialu: "${item.title}" (${yearStr})! ✨`);
              } else {
                renderMovies();
                updateStats();
                openMovieDetail(item);
                showToastNotification(`Zaktualizowano wersję filmu: "${item.title}" (${yearStr})! ✨`);
              }
              saveLocalDatabase();
            }
          } catch (err) {
            console.error("Error saving rematch:", err);
          }
        });

        resultsContainer.appendChild(card);
      });
    } catch (e) {
      console.error("Error executing rematch search:", e);
      loadingEl.style.display = "none";
    }
  };

  searchBtn.onclick = () => doSearch(inputEl.value.trim());
  inputEl.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSearch(inputEl.value.trim());
    }
  };

  sheetRematch.classList.add("active");
  doSearch(cleanTitle);
}

window.openMovieDetail = openMovieDetail;
window.renderMovies = renderMovies;
