import { state, getGradientForTitle } from './state.js';
import { showToastNotification } from './ui.js';
import { openMovieDetail } from './movies.js';
import { openEpisodeTracker } from './shows.js';

let upcomingData = [];
let upcomingFilter = "all";
let isUpcomingLoading = false;

export async function loadUpcomingData(forceRefresh = false) {
  const contentEl = document.getElementById("m3-upcoming-content");
  if (!contentEl) return;

  if (upcomingData.length === 0 || forceRefresh) {
    isUpcomingLoading = true;
    contentEl.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: var(--md-sys-color-on-surface-variant);">
        <span class="material-symbols-rounded" style="font-size: 44px; animation: spin 1s linear infinite; color: var(--md-sys-color-primary);">sync</span>
        <p style="margin-top: 14px; font-weight: 700; font-size: 1rem; color: var(--md-sys-color-on-surface);">Sprawdzam premiery dla Twojej biblioteki...</p>
        <p style="font-size: 0.82rem; opacity: 0.8; margin-top: 4px;">Sprawdzam nowe odcinki oglądanych seriali oraz daty premier filmów z Twojej listy</p>
      </div>
    `;

    try {
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const localKey = localStorage.getItem("cinelog_tmdb_key");
      const tmdbParam = localKey ? `&tmdb_key=${encodeURIComponent(localKey)}` : "";

      let items = [];

      // 1. Try Flask API /api/upcoming first
      try {
        const res = await fetch(forceRefresh ? `/api/upcoming?refresh=1${tmdbParam}` : `/api/upcoming${tmdbParam}`);
        if (res.ok) {
          const data = await res.json();
          items = data.items || [];
        }
      } catch (e) {}

      // 2. Always ensure all watchlist movies from client state.movies are present (e.g. Avatar 4, 5, etc.)
      const existingMovieIds = new Set(items.filter(i => i.media_type === "movie").map(i => i.id || i.title));
      (state.movies || []).forEach(m => {
        const st = (m.status || "").toLowerCase();
        if (st === "watchlist" || st === "planowane" || st === "do obejrzenia") {
          const rd = m.release_date || (m.release_year ? `${m.release_year}-12-31` : null);
          if (rd) {
            try {
              const targetDate = new Date(rd.substring(0, 10) + "T00:00:00");
              const diffTime = targetDate - today;
              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
              if (daysLeft >= 0 && !existingMovieIds.has(m.uuid) && !existingMovieIds.has(m.title)) {
                existingMovieIds.add(m.uuid);
                existingMovieIds.add(m.title);
                items.push({
                  id: m.uuid,
                  title: m.title,
                  media_type: "movie",
                  poster_url: m.poster_url,
                  release_date: rd.substring(0, 10),
                  days_left: daysLeft,
                  badge_type: "movie_premiere",
                  status_label: "Premiera kinowa / VOD",
                  episode_info: null,
                  series_status: null,
                  my_status: m.status
                });
              }
            } catch (err) {}
          }
        }
      });

      // 3. Client-side fallback for TV shows if Flask returned none
      const existingTvTitles = new Set(items.filter(i => i.media_type === "tv").map(i => i.title.toLowerCase().trim()));
      const candidateShows = (state.shows || []).filter(s => {
        const st = (s.status || "").toLowerCase();
        return st === "watching" || st === "watchlist" || st === "w_trakcie" || st === "planowane" || st === "w trakcie";
      });

      if (localKey && candidateShows.length > 0 && existingTvTitles.size === 0) {
        const showPromises = candidateShows.slice(0, 25).map(async s => {
          let tmdbId = s.tmdb_id;
          try {
            if (!tmdbId) {
              const cleanTitle = s.title.replace(/\s*\([^)]*\)/g, "").trim();
              const sRes = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${localKey}&query=${encodeURIComponent(cleanTitle)}&language=pl-PL`);
              if (sRes.ok) {
                const sData = await sRes.json();
                if (sData.results && sData.results.length > 0) {
                  tmdbId = sData.results[0].id;
                  s.tmdb_id = tmdbId;
                }
              }
            }
            if (!tmdbId) return null;

            const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${localKey}&language=pl-PL`);
            if (!r.ok) return null;
            const detail = await r.json();
            const nextEp = detail.next_episode_to_air;
            const status = detail.status;
            const poster = detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : s.poster_url;

            if (nextEp && nextEp.air_date) {
              const targetDate = new Date(nextEp.air_date + "T00:00:00");
              const diffTime = targetDate - today;
              const daysLeft = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
              const epCode = `S${String(nextEp.season_number).padStart(2, '0')}E${String(nextEp.episode_number).padStart(2, '0')}`;
              return {
                id: s.uuid,
                title: s.title,
                media_type: "tv",
                poster_url: poster,
                release_date: nextEp.air_date,
                days_left: daysLeft,
                badge_type: "episode_airing",
                episode_info: {
                  season: nextEp.season_number,
                  episode: nextEp.episode_number,
                  code: epCode,
                  name: nextEp.name || ""
                },
                status_label: nextEp.name ? `${epCode} • ${nextEp.name}` : epCode,
                series_status: status,
                my_status: s.status
              };
            } else if (status === "Returning Series" || status === "In Production") {
              return {
                id: s.uuid,
                title: s.title,
                media_type: "tv",
                poster_url: poster,
                release_date: "",
                days_left: 9999,
                badge_type: "in_production",
                episode_info: null,
                status_label: "Kolejny sezon zapowiedziany",
                series_status: status,
                my_status: s.status
              };
            }
          } catch (err) {
            return null;
          }
          return null;
        });

        const fetchedShows = (await Promise.all(showPromises)).filter(Boolean);
        fetchedShows.forEach(fs => {
          if (!existingTvTitles.has(fs.title.toLowerCase().trim())) {
            existingTvTitles.add(fs.title.toLowerCase().trim());
            items.push(fs);
          }
        });
      }

      items.sort((a, b) => a.days_left - b.days_left);
      upcomingData = items;
    } catch (err) {
      console.error("Upcoming fetch error:", err);
    } finally {
      isUpcomingLoading = false;
    }
  }

  const allCount = upcomingData.length;
  const tvCount = upcomingData.filter(i => i.media_type === "tv").length;
  const movieCount = upcomingData.filter(i => i.media_type === "movie").length;

  const countAllEl = document.getElementById("m3-upcoming-count-all");
  const countTvEl = document.getElementById("m3-upcoming-count-tv");
  const countMovieEl = document.getElementById("m3-upcoming-count-movie");

  if (countAllEl) countAllEl.innerText = allCount;
  if (countTvEl) countTvEl.innerText = tvCount;
  if (countMovieEl) countMovieEl.innerText = movieCount;

  renderUpcoming();
}

export function getDayOfWeekPL(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const days = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
    const months = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
  } catch (e) {
    return dateStr;
  }
}

export function formatDatePL(dateStr) {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const months = ["Sty", "Lut", "Mar", "Kwi", "Maj", "Cze", "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru"];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

export function renderUpcoming() {
  const contentEl = document.getElementById("m3-upcoming-content");
  if (!contentEl) return;

  const filtered = upcomingData.filter(it => {
    if (upcomingFilter === "tv" && it.media_type !== "tv") return false;
    if (upcomingFilter === "movie" && it.media_type !== "movie") return false;
    return true;
  });

  if (filtered.length === 0) {
    contentEl.innerHTML = `
      <div style="text-align: center; padding: 60px 24px; color: var(--md-sys-color-on-surface-variant); background: var(--md-sys-color-surface-container); border-radius: var(--md-corner-xl); border: 1px solid var(--md-sys-color-outline-variant); max-width: 650px; margin: 20px auto;">
        <div style="width: 56px; height: 56px; border-radius: 16px; background: var(--md-sys-color-primary-container); color: var(--md-sys-color-on-primary-container); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px auto;">
          <span class="material-symbols-rounded" style="font-size: 32px;">calendar_month</span>
        </div>
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--md-sys-color-on-surface); margin-bottom: 6px;">Jesteś na bieżąco!</h3>
        <p style="font-size: 0.86rem; line-height: 1.5; color: var(--md-sys-color-on-surface-variant); margin-bottom: 14px;">
          Wszystkie seriale i filmy z Twojej biblioteki miały już premierę lub czekają na ogłoszenie daty kolejnego sezonu w TMDb.<br>
          Gdy stacja lub platforma VOD zapowie nowy odcinek, pojawi się on tutaj z odliczaniem dni.
        </p>
        <button type="button" class="m3-btn-action-primary" onclick="loadUpcomingData(true)" style="padding: 9px 18px; font-weight: 700;">
          <span class="material-symbols-rounded" style="font-size: 18px;">sync</span>
          <span>Odśwież harmonogram</span>
        </button>
      </div>
    `;
    return;
  }

  const thisWeek = filtered.filter(i => i.days_left >= 0 && i.days_left <= 7);
  const thisMonth = filtered.filter(i => i.days_left >= 8 && i.days_left <= 30);
  const future = filtered.filter(i => i.days_left >= 31 && i.days_left < 9999);
  const inProd = filtered.filter(i => i.days_left === 9999);

  let html = "";

  const createCardHtml = (it) => {
    let countdownBadge = "";
    if (it.days_left === 0) {
      countdownBadge = `<span class="m3-countdown-badge today"><span class="material-symbols-rounded" style="font-size: 14px;">local_fire_department</span> Premiera Dzisiaj!</span>`;
    } else if (it.days_left === 1) {
      countdownBadge = `<span class="m3-countdown-badge urgent"><span class="material-symbols-rounded" style="font-size: 14px;">schedule</span> Jutro! (${getDayOfWeekPL(it.release_date)})</span>`;
    } else if (it.days_left <= 7) {
      countdownBadge = `<span class="m3-countdown-badge urgent"><span class="material-symbols-rounded" style="font-size: 14px;">hourglass_top</span> Za ${it.days_left} dni (${getDayOfWeekPL(it.release_date)})</span>`;
    } else if (it.days_left < 9999) {
      countdownBadge = `<span class="m3-countdown-badge normal"><span class="material-symbols-rounded" style="font-size: 14px;">calendar_month</span> Za ${it.days_left} dni • ${formatDatePL(it.release_date)}</span>`;
    } else {
      countdownBadge = `<span class="m3-countdown-badge in-prod"><span class="material-symbols-rounded" style="font-size: 14px;">movie_filter</span> Kolejny sezon zapowiedziany</span>`;
    }

    const typeBadge = it.media_type === "tv"
      ? `<span class="m3-meta-badge" style="font-size: 11px; padding: 2px 6px;"><span class="material-symbols-rounded" style="font-size: 12px;">tv</span> Serial</span>`
      : `<span class="m3-meta-badge" style="font-size: 11px; padding: 2px 6px;"><span class="material-symbols-rounded" style="font-size: 12px;">movie</span> Film</span>`;

    const posterHtml = it.poster_url 
      ? `<img src="${it.poster_url}" alt="${it.title}" class="m3-upcoming-poster" loading="lazy" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"><div class="m3-upcoming-poster" style="display: none; align-items: center; justify-content: center; background: ${getGradientForTitle(it.title)}; font-size: 10px; color: #fff; font-weight: 700; text-align: center; padding: 4px;">${it.title}</div>`
      : `<div class="m3-upcoming-poster" style="display: flex; align-items: center; justify-content: center; background: ${getGradientForTitle(it.title)}; font-size: 10px; color: #fff; font-weight: 700; text-align: center; padding: 4px;">${it.title}</div>`;

    return `
      <div class="m3-upcoming-card" data-id="${it.id}" data-type="${it.media_type}" data-title="${it.title}">
        ${posterHtml}
        <div class="m3-upcoming-body">
          <div>
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
              ${typeBadge}
              ${it.release_date ? `<span style="font-size: 0.72rem; color: var(--md-sys-color-on-surface-variant); font-weight: 600;">${it.release_date}</span>` : ''}
            </div>
            <div class="m3-upcoming-title" title="${it.title}">${it.title}</div>
            <div class="m3-upcoming-subtitle">${it.status_label || ''}</div>
          </div>
          <div>
            ${countdownBadge}
          </div>
        </div>
      </div>
    `;
  };

  const createSection = (title, icon, items, badgeClass = "") => {
    if (items.length === 0) return "";
    return `
      <section class="m3-upcoming-section">
        <div class="m3-upcoming-section-header">
          <span class="material-symbols-rounded" style="font-size: 22px; color: var(--md-sys-color-primary);">${icon}</span>
          <span>${title}</span>
          <span class="m3-upcoming-section-badge ${badgeClass}">${items.length}</span>
        </div>
        <div class="m3-upcoming-grid">
          ${items.map(createCardHtml).join("")}
        </div>
      </section>
    `;
  };

  html += createSection("W tym tygodniu (Odcinki na bieżąco & premiery)", "local_fire_department", thisWeek);
  html += createSection("W tym miesiącu", "calendar_view_month", thisMonth);
  html += createSection("Wkrótce (Kolejne miesiące)", "hourglass_empty", future);
  html += createSection("Zapowiedziane / W produkcji (Data do potwierdzenia)", "precision_manufacturing", inProd);

  contentEl.innerHTML = html;

  contentEl.querySelectorAll(".m3-upcoming-card").forEach(card => {
    card.addEventListener("click", () => {
      const type = card.getAttribute("data-type");
      const title = card.getAttribute("data-title");
      if (type === "movie") {
        const found = state.movies.find(m => m.title === title || m.uuid === card.getAttribute("data-id"));
        if (found) openMovieDetail(found);
      } else {
        const found = state.shows.find(s => s.title === title || s.uuid === card.getAttribute("data-id"));
        if (found) openEpisodeTracker(found);
      }
    });
  });
}

export function exportCalendarICS() {
  if (!upcomingData || upcomingData.length === 0) {
    showToastNotification("Brak nadchodzących premier do wyeksportowania.", "info");
    return;
  }

  const validItems = upcomingData.filter(it => it.release_date && it.release_date.match(/^\d{4}-\d{2}-\d{2}$/));
  if (validItems.length === 0) {
    showToastNotification("Brak pozycji z potwierdzoną dokładną datą premiery.", "info");
    return;
  }

  let ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CineLog//Harmonogram Premier i Emisji//PL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CineLog Premiery i Odcinki",
    "X-WR-TIMEZONE:UTC"
  ];

  validItems.forEach(it => {
    const dStr = it.release_date.replace(/-/g, "");
    const nowStr = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    const uid = `cinelog-${it.id || it.title.replace(/\s+/g, "_")}-${dStr}@cinelog.app`;
    const summary = it.media_type === "tv"
      ? `📺 Premiera odcinka: ${it.title} (${it.status_label || 'Nowy odcinek'})`
      : `🎬 Premiera filmu: ${it.title}`;
    const description = `Premiera w CineLog: ${it.title}\\nStatus: ${it.status_label || 'Wkrótce'}\\nTyp: ${it.media_type === 'tv' ? 'Serial' : 'Film'}`;

    ics.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${nowStr}`,
      `DTSTART;VALUE=DATE:${dStr}`,
      `DTEND;VALUE=DATE:${dStr}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      "STATUS:CONFIRMED",
      "TRANSP:TRANSPARENT",
      "END:VEVENT"
    );
  });

  ics.push("END:VCALENDAR");

  const blob = new Blob([ics.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cinelog-premiery.ics";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToastNotification(`Wyeksportowano ${validItems.length} premier do pliku cinelog-premiery.ics!`, "success");
}

export function initUpcomingFilters() {
  const chips = document.querySelectorAll("[data-upcoming-filter]");
  chips.forEach(chip => {
    chip.addEventListener("click", () => {
      chips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      upcomingFilter = chip.getAttribute("data-upcoming-filter");
      renderUpcoming();
    });
  });

  const refreshBtn = document.getElementById("m3-upcoming-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadUpcomingData(true);
    });
  }

  const exportIcsBtn = document.getElementById("m3-upcoming-export-ics-btn");
  if (exportIcsBtn) {
    exportIcsBtn.addEventListener("click", () => {
      exportCalendarICS();
    });
  }
}

window.loadUpcomingData = loadUpcomingData;
window.exportCalendarICS = exportCalendarICS;

