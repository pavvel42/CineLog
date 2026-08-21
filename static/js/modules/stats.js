// ==========================================================================
// CineLog - Analytics & Statistics Module
// ==========================================================================

import { state, formatWatchTimeMinutes, getGradientForTitle, saveLocalDatabase, generateUUID, normalizeTitleForLibrary } from './state.js';
import { showToastNotification } from './ui.js';
import { openMovieDetail, renderMovies } from './movies.js';
import { TOP_DIRECTORS_CATALOG } from './directors_data.js';

let m3RatingsChart = null;
let m3YearlyChart = null;
let m3GenresChart = null;
let currentAnalyticsScope = "movies";

export function updateStats() {
  const elHeading = document.getElementById("m3-stats-heading");
  const elLabel1 = document.getElementById("m3-stat-label-1");
  const elStat1 = document.getElementById("m3-stat-1");
  const elLabel2 = document.getElementById("m3-stat-label-2");
  const elStat2 = document.getElementById("m3-stat-2");
  const elLabel3 = document.getElementById("m3-stat-label-3");
  const elStat3 = document.getElementById("m3-stat-3");
  const elStatAvg = document.getElementById("m3-stat-avg");
  const elStatTime = document.getElementById("m3-stat-time");

  if (!elHeading) return;

  if (state.mode === "movies") {
    const moviesList = Array.isArray(state.movies) ? state.movies.filter(Boolean) : [];
    const total = moviesList.length;
    const watched = moviesList.filter(m => m.status === "watched").length;
    const favs = moviesList.filter(m => m.is_favorite).length;
    const rated = moviesList.filter(m => m.rating !== null && m.rating >= 1);
    const avg = rated.length > 0 ? (rated.reduce((sum, m) => sum + m.rating, 0) / rated.length).toFixed(1) : "0.0";
    const totalMins = moviesList.filter(m => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);

    elHeading.innerText = "Podsumowanie Filmów";
    if (elLabel1) elLabel1.innerText = "Kolekcja";
    if (elStat1) elStat1.innerText = total;
    if (elLabel2) elLabel2.innerText = "Obejrzane";
    if (elStat2) elStat2.innerText = watched;
    if (elLabel3) elLabel3.innerText = "Ulubione";
    if (elStat3) elStat3.innerText = favs;
    if (elStatAvg) elStatAvg.innerText = avg + "★";
    if (elStatTime) elStatTime.innerText = formatWatchTimeMinutes(totalMins);
  } else {
    const showsList = Array.isArray(state.shows) ? state.shows.filter(Boolean) : [];
    const totalShows = showsList.length;
    const watching = showsList.filter(s => s.status === "watching").length;
    const totalEps = showsList.reduce((sum, s) => sum + (s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0)), 0);
    const rated = showsList.filter(s => s.rating !== null && s.rating >= 1);
    const avg = rated.length > 0 ? (rated.reduce((sum, s) => sum + s.rating, 0) / rated.length).toFixed(1) : "0.0";
    const totalMins = showsList.reduce((sum, s) => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0);
      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      return sum + (epCount * epDuration);
    }, 0);

    elHeading.innerText = "Podsumowanie Seriali";
    if (elLabel1) elLabel1.innerText = "Wszystkie seriale";
    if (elStat1) elStat1.innerText = totalShows;
    if (elLabel2) elLabel2.innerText = "Oglądane w toku";
    if (elStat2) elStat2.innerText = watching;
    if (elLabel3) elLabel3.innerText = "Obejrzane odcinki";
    if (elStat3) elStat3.innerText = totalEps;
    if (elStatAvg) elStatAvg.innerText = avg + "★";
    if (elStatTime) elStatTime.innerText = formatWatchTimeMinutes(totalMins);
  }
}

export function initCharts(scope = currentAnalyticsScope) {
  currentAnalyticsScope = scope;
  const ctxRatings = document.getElementById("m3RatingsChart");
  const ctxYearly = document.getElementById("m3YearlyChart");
  const ctxGenres = document.getElementById("m3GenresChart");
  if (!ctxRatings || !ctxYearly) return;

  const btnMovies = document.getElementById("m3-analytics-mode-movies");
  const btnShows = document.getElementById("m3-analytics-mode-shows");
  const btnAll = document.getElementById("m3-analytics-mode-all");
  if (btnMovies) btnMovies.classList.toggle("active", scope === "movies");
  if (btnShows) btnShows.classList.toggle("active", scope === "shows");
  if (btnAll) btnAll.classList.toggle("active", scope === "all");

  const totalLabel = document.getElementById("m3-analytics-total-label");
  const watchedLabel = document.getElementById("m3-analytics-watched-label");
  const elTotal = document.getElementById("m3-analytics-total-count");
  const elWatched = document.getElementById("m3-analytics-watched-count");
  const elTime = document.getElementById("m3-analytics-time-count");
  const elAvg = document.getElementById("m3-analytics-avg-rating");
  const elFav = document.getElementById("m3-analytics-fav-count");
  const elWatchlist = document.getElementById("m3-analytics-watchlist-count");

  let totalCount = 0;
  let watchedCount = 0;
  let favCount = 0;
  let watchlistCount = 0;
  let totalMinutes = 0;
  let allRatings = [];
  const genreCountMap = {};
  const yearlyMap = {};

  if (scope === "movies") {
    if (totalLabel) totalLabel.innerText = "Filmy w kolekcji";
    if (watchedLabel) watchedLabel.innerText = "Obejrzane filmy";

    totalCount = state.movies.length;
    watchedCount = state.movies.filter(m => m.status === "watched").length;
    favCount = state.movies.filter(m => m.is_favorite).length;
    watchlistCount = state.movies.filter(m => m.status === "watchlist").length;

    totalMinutes = state.movies.filter(m => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);

    state.movies.forEach(m => {
      if (m.rating && m.rating >= 1 && m.rating <= 5) allRatings.push(m.rating);

      const gList = m.genres || (m.genre ? m.genre.split(",") : []);
      gList.forEach(g => {
        const cleanG = (typeof g === "string" ? g : (g.name || "")).trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });

      const d = m.watch_date || m.created_at || m.release_date || (m.year ? `${m.year}-01-01` : null);
      if (d) {
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });

  } else if (scope === "shows") {
    if (totalLabel) totalLabel.innerText = "Seriale ogółem";
    if (watchedLabel) watchedLabel.innerText = "Obejrzane odcinki";

    totalCount = state.shows.length;
    favCount = state.shows.filter(s => s.is_favorite).length;
    watchlistCount = state.shows.filter(s => s.status === "watchlist").length;

    state.shows.forEach(s => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0);
      watchedCount += epCount;

      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      totalMinutes += epCount * epDuration;

      if (s.rating && s.rating >= 1 && s.rating <= 5) allRatings.push(s.rating);

      const gList = s.genres || (s.genre ? s.genre.split(",") : []);
      gList.forEach(g => {
        const cleanG = (typeof g === "string" ? g : (g.name || "")).trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });

      if (s.episodes_watched && s.episodes_watched.length > 0) {
        s.episodes_watched.forEach(ep => {
          const d = ep.created_at || ep.date;
          if (d) {
            const y = d.split("-")[0].substring(0, 4);
            if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
              yearlyMap[y] = (yearlyMap[y] || 0) + 1;
            }
          }
        });
      } else if (s.created_at || s.year) {
        const d = s.created_at || `${s.year}-01-01`;
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });

  } else {
    if (totalLabel) totalLabel.innerText = "Łączna kolekcja";
    if (watchedLabel) watchedLabel.innerText = "Wszystkie seanse";

    totalCount = state.movies.length + state.shows.length;
    const watchedMoviesCount = state.movies.filter(m => m.status === "watched").length;
    const totalEps = state.shows.reduce((sum, s) => sum + (s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0)), 0);
    watchedCount = watchedMoviesCount + totalEps;

    favCount = state.movies.filter(m => m.is_favorite).length + state.shows.filter(s => s.is_favorite).length;
    watchlistCount = state.movies.filter(m => m.status === "watchlist").length + state.shows.filter(s => s.status === "watchlist").length;

    const movieMins = state.movies.filter(m => m.status === "watched").reduce((sum, m) => sum + (parseInt(m.runtime) || 105), 0);
    const showMins = state.shows.reduce((sum, s) => {
      const epCount = s.episodes_watched ? s.episodes_watched.length : (s.watched_count || 0);
      const epDuration = parseInt(s.runtime) || parseInt(s.episode_runtime) || 45;
      return sum + (epCount * epDuration);
    }, 0);
    totalMinutes = movieMins + showMins;

    [...state.movies, ...state.shows].forEach(it => {
      if (it.rating && it.rating >= 1 && it.rating <= 5) allRatings.push(it.rating);

      const gList = it.genres || (it.genre ? it.genre.split(",") : []);
      gList.forEach(g => {
        const cleanG = (typeof g === "string" ? g : (g.name || "")).trim();
        if (cleanG) genreCountMap[cleanG] = (genreCountMap[cleanG] || 0) + 1;
      });
    });

    state.movies.forEach(m => {
      const d = m.watch_date || m.created_at || m.release_date || (m.year ? `${m.year}-01-01` : null);
      if (d) {
        const y = d.split("-")[0].substring(0, 4);
        if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
          yearlyMap[y] = (yearlyMap[y] || 0) + 1;
        }
      }
    });
    state.shows.forEach(s => {
      if (s.episodes_watched && s.episodes_watched.length > 0) {
        s.episodes_watched.forEach(ep => {
          const d = ep.created_at || ep.date;
          if (d) {
            const y = d.split("-")[0].substring(0, 4);
            if (y && y.length === 4 && parseInt(y) >= 1970 && parseInt(y) <= 2030) {
              yearlyMap[y] = (yearlyMap[y] || 0) + 1;
            }
          }
        });
      }
    });
  }

  const avgRating = allRatings.length > 0 ? (allRatings.reduce((acc, r) => acc + r, 0) / allRatings.length).toFixed(1) + "★" : "0.0★";

  if (elTotal) elTotal.innerText = totalCount;
  if (elWatched) elWatched.innerText = watchedCount;
  if (elTime) elTime.innerText = formatWatchTimeMinutes(totalMinutes);
  if (elAvg) elAvg.innerText = avgRating;
  if (elFav) elFav.innerText = favCount;
  if (elWatchlist) elWatchlist.innerText = watchlistCount;

  const isDark = document.documentElement.getAttribute("data-theme") !== "light";
  const textColor = isDark ? "rgba(255, 255, 255, 0.88)" : "rgba(28, 27, 31, 0.88)";
  const textMutedColor = isDark ? "rgba(255, 255, 255, 0.60)" : "rgba(28, 27, 31, 0.60)";
  const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.08)";

  // 1. Ratings Histogram Bar Chart
  const counts = [0, 0, 0, 0, 0];
  allRatings.forEach(r => {
    if (r >= 1 && r <= 5) counts[r - 1]++;
  });

  if (m3RatingsChart) m3RatingsChart.destroy();
  if (ctxRatings && window.Chart) {
    m3RatingsChart = new Chart(ctxRatings, {
      type: "bar",
      data: {
        labels: ["1★", "2★", "3★", "4★", "5★"],
        datasets: [{
          label: "Liczba ocen",
          data: counts,
          backgroundColor: ["#f2b8b5", "#e8def8", "#d0bcff", "#8b5cf6", "#6750a4"],
          borderRadius: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: gridColor },
            ticks: { color: textMutedColor, font: { size: 11 } }
          },
          x: { 
            grid: { display: false },
            ticks: { color: textColor, font: { size: 12, weight: '600' } }
          }
        }
      }
    });
  }

  // 2. Top Genres Doughnut Chart
  if (ctxGenres) {
    const sortedGenres = Object.entries(genreCountMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    const genreLabels = sortedGenres.map(g => g[0]);
    const genreValues = sortedGenres.map(g => g[1]);
    const hasGenres = genreLabels.length > 0;

    const chartCard = ctxGenres.closest("div") || ctxGenres.parentElement;
    let emptyState = chartCard ? chartCard.querySelector(".m3-genres-empty-state") : null;

    if (m3GenresChart) {
      m3GenresChart.destroy();
      m3GenresChart = null;
    }

    if (!hasGenres) {
      ctxGenres.style.display = "none";
      if (!emptyState && chartCard) {
        emptyState = document.createElement("div");
        emptyState.className = "m3-genres-empty-state";
        emptyState.style.cssText = "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 180px; text-align: center; color: var(--md-sys-color-on-surface-variant); padding: 12px;";
        emptyState.innerHTML = `
          <span class="material-symbols-rounded" style="font-size: 38px; opacity: 0.35; margin-bottom: 6px;">category</span>
          <div style="font-size: 0.88rem; font-weight: 700; color: var(--md-sys-color-on-surface);">Brak danych o gatunkach</div>
          <div style="font-size: 0.76rem; opacity: 0.7; margin-top: 4px; max-width: 220px; line-height: 1.3;">Gatunki zostaną uzupełnione automatycznie przy dodawaniu i synchronizacji z TMDb.</div>
        `;
        chartCard.appendChild(emptyState);
      } else if (emptyState) {
        emptyState.style.display = "flex";
      }
    } else {
      ctxGenres.style.display = "block";
      if (emptyState) emptyState.style.display = "none";

      if (window.Chart) {
        m3GenresChart = new Chart(ctxGenres, {
          type: "doughnut",
          data: {
            labels: genreLabels,
            datasets: [{
              data: genreValues,
              backgroundColor: ["#d0bcff", "#38bdf8", "#34d399", "#f59e0b", "#f43f5e", "#a78bfa"],
              borderWidth: 2,
              borderColor: isDark ? "#1e1b24" : "#ffffff"
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "bottom",
                labels: {
                  boxWidth: 12,
                  font: { size: 11, weight: '600' },
                  color: textColor,
                  padding: 8,
                  usePointStyle: true
                }
              }
            },
            cutout: "65%"
          }
        });
      }
    }
  }

  // 3. Yearly Timeline Line Chart
  const years = Object.keys(yearlyMap).sort();
  const yearlyCounts = years.map(y => yearlyMap[y]);

  if (m3YearlyChart) m3YearlyChart.destroy();
  if (ctxYearly && window.Chart) {
    m3YearlyChart = new Chart(ctxYearly, {
      type: "line",
      data: {
        labels: years.length > 0 ? years : ["2022", "2023", "2024", "2025", "2026"],
        datasets: [{
          label: "Liczba seansów",
          data: yearlyCounts.length > 0 ? yearlyCounts : [0, 0, 0, 0, 0],
          borderColor: "#d0bcff",
          backgroundColor: "rgba(208, 188, 255, 0.15)",
          fill: true,
          tension: 0.35,
          pointBackgroundColor: "#8b5cf6",
          pointRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { 
            beginAtZero: true, 
            grid: { color: gridColor },
            ticks: { color: textMutedColor, font: { size: 11 } }
          },
          x: { 
            grid: { display: false },
            ticks: { color: textColor, font: { size: 11 } }
          }
        }
      }
    });
  }

  // 4. Render Yearly Goal Challenge and Director Badges
  renderYearlyGoalCard();
  renderDirectorMasteryBadges();
}



export function renderYearlyGoalCard() {
  const container = document.getElementById("m3-analytics-yearly-goal-box");
  if (!container) return;

  const currentYear = new Date().getFullYear();
  const savedGoal = parseInt(localStorage.getItem("cinelog_yearly_goal")) || 52;

  const watchedThisYear = state.movies.filter(m => {
    if (m.status !== "watched") return false;
    const date = m.watch_date || m.created_at || "";
    return date.startsWith(String(currentYear));
  }).length;

  const pct = Math.min(Math.round((watchedThisYear / savedGoal) * 100), 100);

  container.innerHTML = `
    <div style="background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-xl); padding: 14px; display: flex; flex-direction: column; gap: 10px;">
      <div style="display: flex; align-items: center; justify-content: space-between;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="material-symbols-rounded" style="color: #eab308; font-size: 22px;">military_tech</span>
          <div>
            <div style="font-weight: 700; font-size: 0.88rem;">Wyzwanie Filmowe ${currentYear}</div>
            <div style="font-size: 0.74rem; color: var(--md-sys-color-on-surface-variant);">Twój osobisty cel liczby seansów w tym roku</div>
          </div>
        </div>
        <button type="button" class="m3-chip" id="m3-btn-change-yearly-goal" style="font-size: 0.72rem; padding: 3px 8px;">
          <span class="material-symbols-rounded" style="font-size: 14px;">edit</span> Cel: ${savedGoal}
        </button>
      </div>

      <div style="display: flex; align-items: baseline; justify-content: space-between;">
        <div style="font-size: 1.3rem; font-weight: 800; color: var(--md-sys-color-primary);">
          ${watchedThisYear} <span style="font-size: 0.85rem; font-weight: 600; color: var(--md-sys-color-on-surface-variant);">/ ${savedGoal} filmów (${pct}%)</span>
        </div>
        <div style="font-size: 0.75rem; font-weight: 600; color: ${pct >= 100 ? '#10b981' : 'var(--md-sys-color-primary)'};">
          ${pct >= 100 ? '🎉 Cel osiągnięty!' : `Pozostało ${Math.max(savedGoal - watchedThisYear, 0)} filmów`}
        </div>
      </div>

      <div style="width: 100%; height: 8px; background: var(--md-sys-color-surface-container-highest); border-radius: 999px; overflow: hidden;">
        <div style="width: ${pct}%; height: 100%; background: linear-gradient(90deg, #8b5cf6, #3b82f6); border-radius: 999px; transition: width 0.3s ease;"></div>
      </div>
    </div>
  `;

  const btnEdit = container.querySelector("#m3-btn-change-yearly-goal");
  if (btnEdit) {
    btnEdit.addEventListener("click", () => {
      const input = prompt(`Ustaw swój roczny cel filmowy na ${currentYear} rok (liczba filmów):`, savedGoal);
      if (input && !isNaN(parseInt(input)) && parseInt(input) > 0) {
        localStorage.setItem("cinelog_yearly_goal", parseInt(input));
        renderYearlyGoalCard();
      }
    });
  }
}

let currentDirectorModal = null;
let currentDirectorTab = "watched";

function cleanPartSuffix(str) {
  return (str || '').replace(/(partone|part1|czesc1|czescpierwsza|volume1|vol1|chapter1|parti|parttwo|part2|czesc2|czescdruga|volume2|vol2|chapter2|partii|partthree|part3|czesc3|czesctrzecia|volume3|vol3|chapter3|partiii|[123])$/g, '');
}

export function isDirectorMovieMatch(dm, m) {
  if (!dm || !m) return false;
  if (dm.tmdb_id && m.tmdb_id && String(dm.tmdb_id) === String(m.tmdb_id)) return true;

  const mNorm = normalizeTitleForLibrary(m.title);
  if (!mNorm) return false;

  const dmNorm = normalizeTitleForLibrary(dm.title);
  const dmOrigNorm = normalizeTitleForLibrary(dm.original_title);

  if (dmNorm && mNorm === dmNorm) return true;
  if (dmOrigNorm && mNorm === dmOrigNorm) return true;

  if (Array.isArray(dm.aliases)) {
    for (const alias of dm.aliases) {
      const aNorm = normalizeTitleForLibrary(alias);
      if (aNorm && mNorm === aNorm) return true;
    }
  }

  const mYear = m.release_date ? m.release_date.split('-')[0] : (m.year || '');
  const dmYear = dm.year || '';
  const yearMatches = Boolean(mYear && dmYear && Math.abs(parseInt(mYear) - parseInt(dmYear)) <= 1);

  const isPart1_m = /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(mNorm);
  const isPart2_m = /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(mNorm);
  const isPart1_dm = /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(dmNorm) || /partone|part1|czesc1|czescpierwsza|vol1|volume1|parti|1$/i.test(dmOrigNorm);
  const isPart2_dm = /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(dmNorm) || /parttwo|part2|czesc2|czescdruga|vol2|volume2|partii|2$/i.test(dmOrigNorm);

  if ((isPart2_m && !isPart2_dm) || (!isPart2_m && isPart2_dm)) {
    return false;
  }
  if ((isPart1_m && isPart2_dm) || (isPart2_m && isPart1_dm)) {
    return false;
  }

  const mClean = cleanPartSuffix(mNorm);
  const dmOrigClean = cleanPartSuffix(dmOrigNorm);
  const dmClean = cleanPartSuffix(dmNorm);

  if (mClean && (mClean === dmOrigClean || mClean === dmClean)) {
    if (yearMatches || !mYear || !dmYear) return true;
  }

  if (yearMatches) {
    if (dmOrigNorm.length >= 4 && (mNorm.includes(dmOrigNorm) || dmOrigNorm.includes(mNorm))) {
      return true;
    }
    if (dmNorm.length >= 4 && (mNorm.includes(dmNorm) || dmNorm.includes(mNorm))) {
      return true;
    }
  }

  return false;
}

export function renderDirectorMasteryBadges() {
  const container = document.getElementById("m3-analytics-directors-grid");
  if (!container) return;

  container.innerHTML = "";

  const directorsWithStats = TOP_DIRECTORS_CATALOG.map(dir => {
    let watchedCount = 0;
    const totalTitles = dir.movies.length;

    dir.movies.forEach(dm => {
      const match = state.movies.find(m => m.status === "watched" && isDirectorMovieMatch(dm, m));
      if (match) watchedCount++;
    });

    const pct = totalTitles > 0 ? Math.round((watchedCount / totalTitles) * 100) : 0;

    let badgeIcon = "military_tech";
    let badgeColor = "#71717a";
    let badgeRank = "Początkujący";

    if (pct === 100) {
      badgeIcon = "diamond";
      badgeColor = "#06b6d4";
      badgeRank = "💎 Komplet (100%)";
    } else if (pct >= 75) {
      badgeIcon = "workspace_premium";
      badgeColor = "#eab308";
      badgeRank = "🥇 Złota Odznaka";
    } else if (pct >= 50) {
      badgeIcon = "military_tech";
      badgeColor = "#94a3b8";
      badgeRank = "🥈 Srebrna Odznaka";
    } else if (pct >= 25) {
      badgeIcon = "military_tech";
      badgeColor = "#b45309";
      badgeRank = "🥉 Brązowa Odznaka";
    }

    return {
      ...dir,
      watchedCount,
      totalTitles,
      pct,
      badgeIcon,
      badgeColor,
      badgeRank
    };
  });

  // Sort directors dynamically: highest percentage first, then watched count, then alphabetical
  directorsWithStats.sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    if (b.watchedCount !== a.watchedCount) return b.watchedCount - a.watchedCount;
    return a.name.localeCompare(b.name, 'pl');
  });

  directorsWithStats.forEach(dir => {
    const card = document.createElement("div");
    card.className = "m3-director-badge-card";
    card.style.cssText = "background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-lg); padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; cursor: pointer; transition: transform 0.2s ease, border-color 0.2s ease; user-select: none;";
    
    card.onmouseenter = () => { card.style.borderColor = dir.badgeColor; card.style.transform = "translateY(-2px)"; };
    card.onmouseleave = () => { card.style.borderColor = "var(--md-sys-color-outline-variant)"; card.style.transform = "translateY(0)"; };

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
        <img src="${dir.avatar}" alt="${dir.name}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid ${dir.badgeColor}; flex-shrink: 0; background: var(--md-sys-color-surface-container-highest);" onerror="this.onerror=null; this.src='static/icons/favicon.png';">
        <div style="min-width: 0;">
          <div style="font-weight: 700; font-size: 0.86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${dir.name}</div>
          <div style="font-size: 0.72rem; color: ${dir.badgeColor}; font-weight: 600;">${dir.badgeRank}</div>
        </div>
      </div>
      <div style="text-align: right; flex-shrink: 0;">
        <div style="font-size: 0.88rem; font-weight: 800; color: var(--md-sys-color-primary);">${dir.watchedCount}/${dir.totalTitles}</div>
        <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); font-weight: 600;">${dir.pct}%</div>
      </div>
    `;

    card.addEventListener("click", () => {
      openDirectorDetailModal(dir, "watched");
    });

    container.appendChild(card);
  });
}

export function openDirectorDetailModal(dir, activeTab = "watched") {
  currentDirectorModal = dir;
  currentDirectorTab = activeTab;

  const sheet = document.getElementById("m3-sheet-director-detail");
  if (!sheet) return;

  const avatarEl = document.getElementById("m3-director-modal-avatar");
  const nameEl = document.getElementById("m3-director-modal-name");
  const badgeEl = document.getElementById("m3-director-modal-badge");
  const statsEl = document.getElementById("m3-director-modal-stats");

  if (avatarEl) {
    avatarEl.src = dir.avatar;
    avatarEl.onerror = () => { avatarEl.src = "static/icons/favicon.png"; };
  }
  if (nameEl) nameEl.textContent = dir.name;

  // Process director movies against state.movies
  const totalTitles = dir.movies.length;
  const processedMovies = dir.movies.map(dm => {
    const matchedMovie = state.movies.find(m => isDirectorMovieMatch(dm, m));

    const isWatched = Boolean(matchedMovie && matchedMovie.status === "watched");
    const isWatchlist = Boolean(matchedMovie && matchedMovie.status === "watchlist");

    return {
      ...dm,
      isWatched,
      isWatchlist,
      matchedMovie,
      userRating: matchedMovie ? matchedMovie.rating : null
    };
  });

  const watchedList = processedMovies.filter(m => m.isWatched);
  const missingList = processedMovies.filter(m => !m.isWatched);

  const watchedCount = watchedList.length;
  const pct = totalTitles > 0 ? Math.round((watchedCount / totalTitles) * 100) : 0;

  let badgeColor = "#71717a";
  let badgeRank = "🎬 Początkujący Kinoman";
  if (pct === 100) {
    badgeColor = "#06b6d4";
    badgeRank = "💎 Komplet Mistrza (100%)";
  } else if (pct >= 75) {
    badgeColor = "#eab308";
    badgeRank = "🥇 Złota Odznaka Reżyserska";
  } else if (pct >= 50) {
    badgeColor = "#94a3b8";
    badgeRank = "🥈 Srebrna Odznaka Reżyserska";
  } else if (pct >= 25) {
    badgeColor = "#b45309";
    badgeRank = "🥉 Brązowa Odznaka Reżyserska";
  }

  if (badgeEl) {
    badgeEl.textContent = badgeRank;
    badgeEl.style.borderColor = badgeColor;
    badgeEl.style.color = badgeColor;
  }
  if (statsEl) {
    statsEl.textContent = `Obejrzano ${watchedCount} z ${totalTitles} filmów (${pct}%) • Reżyseria: ${dir.name}`;
  }

  // Update tab counts
  const countWatchedEl = document.getElementById("m3-dir-count-watched");
  const countMissingEl = document.getElementById("m3-dir-count-missing");
  const countAllEl = document.getElementById("m3-dir-count-all");
  if (countWatchedEl) countWatchedEl.textContent = watchedList.length;
  if (countMissingEl) countMissingEl.textContent = missingList.length;
  if (countAllEl) countAllEl.textContent = totalTitles;

  const tabWatched = document.getElementById("m3-dir-tab-watched");
  const tabMissing = document.getElementById("m3-dir-tab-missing");
  const tabAll = document.getElementById("m3-dir-tab-all");

  if (tabWatched) tabWatched.classList.toggle("active", activeTab === "watched");
  if (tabMissing) tabMissing.classList.toggle("active", activeTab === "missing");
  if (tabAll) tabAll.classList.toggle("active", activeTab === "all");

  // Render grid
  const grid = document.getElementById("m3-director-movies-container");
  if (grid) {
    grid.innerHTML = "";

    let listToRender = processedMovies;
    if (activeTab === "watched") listToRender = watchedList;
    else if (activeTab === "missing") listToRender = missingList;

    if (listToRender.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px 16px; color: var(--md-sys-color-on-surface-variant);">
          <span class="material-symbols-rounded" style="font-size: 36px; margin-bottom: 8px;">check_circle</span>
          <p style="margin: 0; font-size: 0.85rem; font-weight: 600;">
            ${activeTab === "missing" ? "🎉 Gratulacje! Obejrzałeś wszystkie filmy z filmografii tego reżysera!" : "Brak pozycji w tej kategorii."}
          </p>
        </div>
      `;
    } else {
      listToRender.forEach(item => {
        const itemCard = document.createElement("div");
        itemCard.style.cssText = "background: var(--md-sys-color-surface-container); border: 1px solid var(--md-sys-color-outline-variant); border-radius: var(--md-corner-lg); overflow: hidden; display: flex; flex-direction: column; transition: transform 0.2s ease;";

        let posterHtml = "";
        if (item.poster_url) {
          posterHtml = `
            <div style="position: relative; width: 100%; aspect-ratio: 2/3; background: var(--md-sys-color-surface-container-highest);">
              <img src="${item.poster_url}" alt="${item.title}" loading="lazy" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
              <div class="m3-card-cover-fallback" style="background: ${getGradientForTitle(item.title)}; display: none; width: 100%; height: 100%; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; font-weight: 700; padding: 6px;">${item.title}</div>
            </div>
          `;
        } else {
          posterHtml = `
            <div style="width: 100%; aspect-ratio: 2/3; background: ${getGradientForTitle(item.title)}; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 0.75rem; font-weight: 700; padding: 6px;">${item.title}</div>
          `;
        }

        let footerHtml = "";
        if (item.isWatched) {
          const stars = item.userRating ? `★ ${item.userRating}/5` : "✓ Obejrzano";
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 6px 8px 8px 8px;">
              <span style="font-size: 0.72rem; font-weight: 700; color: #10b981; display: flex; align-items: center; gap: 3px;">
                <span class="material-symbols-rounded" style="font-size: 14px;">check_circle</span> ${stars}
              </span>
              <button type="button" class="m3-chip" style="font-size: 0.65rem; padding: 2px 6px;">Szczegóły</button>
            </div>
          `;
          itemCard.style.cursor = "pointer";
          itemCard.addEventListener("click", () => {
            if (item.matchedMovie) {
              openMovieDetail(item.matchedMovie);
            }
          });
        } else if (item.isWatchlist) {
          footerHtml = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 6px 8px 8px 8px;">
              <span style="font-size: 0.7rem; font-weight: 700; color: var(--md-sys-color-primary); display: flex; align-items: center; gap: 3px;">
                <span class="material-symbols-rounded" style="font-size: 14px;">bookmark</span> Na liście
              </span>
              <button type="button" class="m3-chip" style="font-size: 0.65rem; padding: 2px 6px;">Szczegóły</button>
            </div>
          `;
          itemCard.style.cursor = "pointer";
          itemCard.addEventListener("click", () => {
            if (item.matchedMovie) {
              openMovieDetail(item.matchedMovie);
            }
          });
        } else {
          footerHtml = `
            <div style="margin-top: auto; padding: 6px 8px 8px 8px;">
              <button type="button" class="m3-btn-action-primary m3-btn-add-dir-movie" style="width: 100%; justify-content: center; font-size: 0.7rem; padding: 4px 6px; border-radius: var(--md-corner-full); font-weight: 700; background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary);">
                <span class="material-symbols-rounded" style="font-size: 14px;">add</span> Do listy
              </button>
            </div>
          `;
        }

        itemCard.innerHTML = `
          ${posterHtml}
          <div style="padding: 6px 8px 0 8px;">
            <div style="font-weight: 700; font-size: 0.78rem; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;" title="${item.title}">${item.title}</div>
            <div style="font-size: 0.68rem; color: var(--md-sys-color-on-surface-variant); margin-top: 2px;">${item.year || ''}</div>
          </div>
          ${footerHtml}
        `;

        const btnAdd = itemCard.querySelector(".m3-btn-add-dir-movie");
        if (btnAdd) {
          btnAdd.addEventListener("click", (e) => {
            e.stopPropagation();
            const newMovie = {
              uuid: generateUUID(),
              tmdb_id: item.tmdb_id,
              title: item.title,
              original_title: item.original_title,
              release_date: item.year ? `${item.year}-01-01` : "",
              poster_url: item.poster_url,
              director: dir.name,
              status: "watchlist",
              rating: null,
              created_at: new Date().toISOString()
            };
            state.movies.unshift(newMovie);
            saveLocalDatabase();
            updateStats();
            if (state.mode === "movies") renderMovies();
            showToastNotification(`Dodano „${item.title}” do listy Do obejrzenia!`, "success");
            openDirectorDetailModal(dir, activeTab);
            renderDirectorMasteryBadges();
          });
        }

        grid.appendChild(itemCard);
      });
    }
  }

  sheet.classList.add("active");
}

export function openAnalyticsModal() {
  const sheet = document.getElementById("m3-sheet-analytics");
  if (sheet) {
    sheet.classList.add("active");
    setTimeout(() => initCharts(state.mode === "shows" ? "shows" : "movies"), 80);
  }
}

export function initAnalyticsEvents() {
  const btnOpenAnalytics = document.getElementById("m3-btn-open-analytics");
  const btnMobileAnalytics = document.getElementById("m3-mobile-analytics");
  const btnCloseAnalytics = document.getElementById("m3-sheet-analytics-close");
  const sheetAnalytics = document.getElementById("m3-sheet-analytics");

  if (btnOpenAnalytics) btnOpenAnalytics.addEventListener("click", openAnalyticsModal);
  if (btnMobileAnalytics) btnMobileAnalytics.addEventListener("click", openAnalyticsModal);
  if (btnCloseAnalytics && sheetAnalytics) {
    btnCloseAnalytics.addEventListener("click", () => {
      sheetAnalytics.classList.remove("active");
    });
  }

  const btnAnalyticsMovies = document.getElementById("m3-analytics-mode-movies");
  const btnAnalyticsShows = document.getElementById("m3-analytics-mode-shows");
  const btnAnalyticsAll = document.getElementById("m3-analytics-mode-all");
  if (btnAnalyticsMovies) btnAnalyticsMovies.addEventListener("click", () => initCharts("movies"));
  if (btnAnalyticsShows) btnAnalyticsShows.addEventListener("click", () => initCharts("shows"));
  if (btnAnalyticsAll) btnAnalyticsAll.addEventListener("click", () => initCharts("all"));

  // Director Detail Modal Events
  const btnCloseDirModal = document.getElementById("m3-director-modal-close");
  const sheetDirDetail = document.getElementById("m3-sheet-director-detail");
  if (btnCloseDirModal && sheetDirDetail) {
    btnCloseDirModal.addEventListener("click", () => {
      sheetDirDetail.classList.remove("active");
    });
  }

  const tabWatched = document.getElementById("m3-dir-tab-watched");
  const tabMissing = document.getElementById("m3-dir-tab-missing");
  const tabAll = document.getElementById("m3-dir-tab-all");

  if (tabWatched) {
    tabWatched.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "watched");
    });
  }
  if (tabMissing) {
    tabMissing.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "missing");
    });
  }
  if (tabAll) {
    tabAll.addEventListener("click", () => {
      if (currentDirectorModal) openDirectorDetailModal(currentDirectorModal, "all");
    });
  }
}
