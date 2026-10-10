// ==========================================================================
// CineLog - szczegóły produkcji (backend → TMDb w przeglądarce → OMDb)
// Wspólne dla okna dodawania i szybkiego dodawania z rekomendacji/obsady —
// wcześniej szybkie dodawanie zapisywało serial bez liczby sezonów i odcinków.
// ==========================================================================

import { apiFetch, fetchWithTimeout, isRealDetail, wybierzTrafienieWTmdb } from './state.js';
import { getUserLanguage } from './vod.js';

async function fetchBackendProductionDetail(item, typDomyslny) {
  if (window.location.protocol === "file:" || window.location.hostname.includes("github.io")) {
    return { detail: null, backendSuccess: false };
  }
  try {
    const params = new URLSearchParams({
      tmdb_id: item.tmdb_id || "",
      id: item.imdb_id || "",
      title: item.title || "",
      year: item.year || "",
      type: item.type || typDomyslny,
      lang: getUserLanguage()
    });
    const res = await apiFetch(`/api/search_detail?${params.toString()}`);
    if (res.ok) {
      const body = await res.json();
      // 200 z `needs_key` to prośba o klucz API, nie dane — nie blokuj fallbacku klienckiego
      if (isRealDetail(body)) {
        return { detail: body, backendSuccess: true };
      }
    }
  } catch (e) {
    console.warn("Backend detail fetch error, trying client TMDb API:", e);
  }
  return { detail: null, backendSuccess: false };
}

async function resolveTmdbProductionId(item, tmdbType, localTmdbKey) {
  let tmdbId = item.tmdb_id || (item.id && !String(item.id).startsWith("tt") ? item.id : null);
  const imdbId = item.imdb_id || (item.id && String(item.id).startsWith("tt") ? item.id : null);

  // If we have an IMDb ID but no numeric TMDb ID, resolve it via /find/tt...
  if (!tmdbId && imdbId) {
    try {
      const findRes = await fetchWithTimeout(`https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?api_key=${encodeURIComponent(localTmdbKey)}&external_source=imdb_id&language=${getUserLanguage()}`);
      if (findRes.ok) {
        const findJson = await findRes.json();
        const resArr = tmdbType === "tv" ? findJson.tv_results : findJson.movie_results;
        if (resArr && resArr.length > 0) tmdbId = resArr[0].id;
      }
    } catch (e) { console.debug("CineLog: TMDb /find po IMDb ID nie odpowiedział", e); }
  }

  // If still no tmdbId, search TMDb by title
  if (!tmdbId && item.title) {
    try {
      const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
      const sUrl = `https://api.themoviedb.org/3/search/${tmdbType}?api_key=${encodeURIComponent(localTmdbKey)}&query=${encodeURIComponent(cleanTitle)}&language=${getUserLanguage()}${item.year ? (tmdbType === 'tv' ? `&first_air_date_year=${item.year}` : `&year=${item.year}`) : ''}`;
      const sRes = await fetchWithTimeout(sUrl);
      if (sRes.ok) {
        const sData = await sRes.json();
        // Tylko pewne trafienie (tytuł + rok) — pierwszy wynik bywa inną produkcją o podobnym tytule.
        const trafienie = wybierzTrafienieWTmdb(sData.results, item.title || cleanTitle, item.year || (item.release_date || "").slice(0, 4));
        if (trafienie) tmdbId = trafienie.id;
      }
    } catch (e) { console.debug("CineLog: wyszukiwanie w TMDb nie odpowiedziało", e); }
  }

  return { tmdbId, imdbId };
}

async function fetchTmdbPlotEn(tmdbType, tmdbId, localTmdbKey) {
  try {
    const tmdbResEn = await fetchWithTimeout(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${encodeURIComponent(localTmdbKey)}&language=en-US`);
    if (tmdbResEn.ok) {
      const tDataEn = await tmdbResEn.json();
      return tDataEn.overview || "";
    }
  } catch (e) { console.debug("CineLog: angielski opis z TMDb niedostępny", e); }
  return "";
}

function mapTmdbDetailToPreview(tData, item, tmdbType, imdbId, plot) {
  const detail = {
    id: item.id || tData.id || null,
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
    // 0 = TMDb nie podał liczby sezonów; nie zmyślamy tu „1” (to dawało jedną
    // zakładkę sezonu w oknie dodawania) — uzupełnia to ustalLiczbeSezonow().
    total_seasons: tData.number_of_seasons || 0,
    total_episodes: tData.number_of_episodes || 0,
    // TMDb podaje status emisji ("Returning Series", "Ended", "Canceled") oraz
    // flagę in_production - bez nich nie da się odróżnić serialu obejrzanego do
    // końca od takiego, który wciąż wychodzi.
    series_status: tData.status || null,
    in_production: typeof tData.in_production === "boolean" ? tData.in_production : null,
    season_ep_counts: {}
  };
  if (tData.seasons && Array.isArray(tData.seasons)) {
    tData.seasons.forEach(s => {
      if (s.season_number > 0) {
        detail.season_ep_counts[s.season_number] = s.episode_count || 10;
      }
    });
  }
  return detail;
}

async function fetchTmdbProductionDetail(item, localTmdbKey, typDomyslny) {
  const result = { detail: null };
  try {
    const tmdbType = (item.type === "series" || typDomyslny === "series") ? "tv" : "movie";
    const { tmdbId, imdbId } = await resolveTmdbProductionId(item, tmdbType, localTmdbKey);

    if (!tmdbId) return result;

    const tmdbRes = await fetchWithTimeout(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}?api_key=${encodeURIComponent(localTmdbKey)}&language=${getUserLanguage()}&append_to_response=credits,watch/providers,release_dates`);
    if (!tmdbRes.ok) return result;

    const tData = await tmdbRes.json();
    let plot = tData.overview || item.plot || "";
    if (!plot) plot = await fetchTmdbPlotEn(tmdbType, tmdbId, localTmdbKey);

    result.detail = mapTmdbDetailToPreview(tData, item, tmdbType, imdbId, plot);
    return result;
  } catch (tmdbErr) {
    console.warn("Direct TMDb detail fetch failed:", tmdbErr);
    return result;
  }
}

async function applyOmdbFallback(item, detail, localOmdbKey) {
  if ((detail && detail.plot && detail.plot !== "Brak opisu.") || !localOmdbKey) return detail;
  try {
    const cleanTitle = (item.title || "").replace(/\s*\([^)]*\)/g, "").trim();
    const omdbParam = item.imdb_id ? `i=${encodeURIComponent(item.imdb_id)}` : `t=${encodeURIComponent(cleanTitle)}${item.year ? `&y=${item.year}` : ''}`;
    const omdbRes = await fetchWithTimeout(`https://www.omdbapi.com/?apikey=${encodeURIComponent(localOmdbKey)}&${omdbParam}&plot=full`, {}, 6000);
    if (!omdbRes.ok) return detail;
    const omdbData = await omdbRes.json();
    if (omdbData.Response !== "True") return detail;
    const merged = detail || { ...item };
    if (omdbData.Plot && omdbData.Plot !== "N/A") merged.plot = omdbData.Plot;
    if (omdbData.Genre && omdbData.Genre !== "N/A") merged.genre = omdbData.Genre;
    if (omdbData.Director && omdbData.Director !== "N/A") merged.director = omdbData.Director;
    if (omdbData.Actors && omdbData.Actors !== "N/A") merged.cast = omdbData.Actors;
    return merged;
  } catch (e) { console.debug("CineLog: OMDb niedostępny", e); }
  return detail;
}

export function ustalLiczbeSezonow(detail) {
  if (!detail) return 1;
  const podane = parseInt(detail.total_seasons, 10) || parseInt(detail.totalSeasons, 10) || parseInt(detail.number_of_seasons, 10) || 0;
  if (podane > 0) return podane;
  const zListy = Object.keys(detail.season_ep_counts || {})
    .map(k => parseInt(k, 10))
    .filter(n => n > 0);
  return zListy.length ? Math.max(...zListy) : 1;
}

/**
 * Szczegóły produkcji z najlepszego dostępnego źródła: backend (klucz serwera
 * lub BYOK), potem TMDb wprost z przeglądarki (GitHub Pages / offline), na końcu
 * OMDb dla brakującego opisu. Liczba sezonów jest zawsze ustalona.
 * @param {object} item pozycja z wyszukiwania / rekomendacji (title, year, tmdb_id, imdb_id, type)
 * @param {"movie"|"series"} typDomyslny typ, gdy pozycja go nie podaje
 * @returns {Promise<object>} szczegóły (albo sama pozycja, gdy żadne źródło nie odpowiedziało)
 */
export async function pobierzSzczegolyProdukcji(item, typDomyslny) {
  const localTmdbKey = localStorage.getItem("cinelog_tmdb_key") || (window.CINELOG_CONFIG && window.CINELOG_CONFIG.TMDB_API_KEY) || "";
  const localOmdbKey = localStorage.getItem("cinelog_omdb_key") || localStorage.getItem("cinelog_imdb_key") || "";

  let detail = item;
  const backendResult = await fetchBackendProductionDetail(item, typDomyslny);
  if (backendResult.detail) detail = backendResult.detail;

  if (!backendResult.backendSuccess && localTmdbKey) {
    const tmdbResult = await fetchTmdbProductionDetail(item, localTmdbKey, typDomyslny);
    if (tmdbResult.detail) detail = tmdbResult.detail;
  }

  detail = await applyOmdbFallback(item, detail, localOmdbKey);

  // Liczba sezonów musi być odporna na kształt odpowiedzi: backend zwraca
  // total_seasons, TMDb number_of_seasons, OMDb totalSeasons (tekst). Bez tego
  // serial z 9 sezonami pokazywał jedną zakładkę i zapisywał 1 sezon.
  return { ...detail, total_seasons: ustalLiczbeSezonow(detail) };
}
