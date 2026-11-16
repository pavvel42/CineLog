// ==========================================================================
// CineLog - szybkie dodawanie „+ Do obejrzenia” (rekomendacje, ruletka, profil aktora)
// Jedna ścieżka zamiast dwóch kopii: dociąga szczegóły produkcji jak okno
// dodawania, więc serial trafia do biblioteki z liczbą sezonów i odcinków.
// ==========================================================================

import { state, saveLocalDatabase, apiFetch, buildLocalLibraryEntry, getActiveEnvMode, tmdbIdOf, taSamaPozycja } from './state.js';
import { showToastNotification } from './ui.js';
import { updateStats } from './stats.js';
import { renderMovies } from './movies.js';
import { renderShows } from './shows.js';
import { pobierzSzczegolyProdukcji } from './production-detail.js';

/** @param {object} item */
function jestSerialem(item) {
  return item.type === "series" || item.type === "tv" || item.media_type === "tv";
}

/**
 * Treść POST /api/movies albo /api/shows dla pozycji „Do obejrzenia”.
 * @param {object} detail szczegóły produkcji
 * @param {boolean} serial
 */
function zbudujZapis(detail, serial) {
  const wspolne = {
    title: detail.title,
    poster_url: detail.poster_url || "",
    status: "watchlist",
    rating: null,
    tmdb_id: tmdbIdOf(detail.tmdb_id) || tmdbIdOf(detail.id),
    is_favorite: false
  };
  if (!serial) {
    return {
      ...wspolne,
      release_date: detail.release_date || detail.released || (detail.year ? `${String(detail.year).substring(0, 4)}-01-01` : null)
    };
  }
  return {
    ...wspolne,
    episodes_watched: [],
    // Bez tych pól tracker pokazuje jeden sezon, a backend nie rozpozna
    // zakończonego serialu (/api/shows/verify_completion).
    total_seasons: detail.total_seasons || 1,
    total_episodes: detail.total_episodes || 0,
    season_ep_counts: detail.season_ep_counts || {},
    series_status: detail.series_status || null,
    in_production: typeof detail.in_production === "boolean" ? detail.in_production : null
  };
}

/**
 * Dodaje pozycję do listy „Do obejrzenia”: serwer w trybie Flask, w pozostałych
 * trybach (albo gdy serwer odrzuci zapis) — biblioteka w przeglądarce.
 * @param {object} item pozycja z rekomendacji / filmografii (title, year, tmdb_id|id, type|media_type)
 * Pozycja już obecna w bibliotece zostaje bez zmian statusu i oceny.
 * @returns {Promise<object>} wpis biblioteki (nowy albo istniejący)
 */
export async function dodajDoKolejki(item) {
  const serial = jestSerialem(item);
  const typ = serial ? "series" : "movie";
  const detail = { ...item, ...(await pobierzSzczegolyProdukcji({ ...item, type: typ }, typ)) };
  if (!detail.title) detail.title = item.title;

  let zapisany = null;
  let tylkoLokalnie = false;
  try {
    const res = await apiFetch(serial ? "/api/shows" : "/api/movies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(zbudujZapis(detail, serial))
    });
    zapisany = await res.json();
  } catch (err) {
    // Tryb klienta (GitHub Pages / offline) albo odrzucony zapis: pozycja zostaje
    // lokalnie, żeby kliknięcie nie przepadło. W trybie serwera mówimy to wprost.
    console.warn("Szybkie dodawanie: zapis na serwerze nie powiódł się:", err);
    zapisany = buildLocalLibraryEntry(detail, typ, "watchlist");
    tylkoLokalnie = true;
  }

  // `already_exists` to informacja odpowiedzi serwera, nie pole wpisu biblioteki.
  const { already_exists: serwerJuzMial, ...wpis } = zapisany;
  const lista = serial ? state.shows : state.movies;
  const idx = lista.findIndex(w => (w.uuid && w.uuid === wpis.uuid) || taSamaPozycja(w, wpis));
  const juzByl = Boolean(serwerJuzMial) || idx !== -1;
  if (idx === -1) {
    lista.unshift(wpis);
  } else if (!tylkoLokalnie) {
    // Serwer zwrócił aktualny stan wpisu (status i ocena zostają jego); lokalnego
    // wpisu nie nadpisujemy świeżo zbudowanym „watchlist” bez oceny.
    lista[idx] = { ...lista[idx], ...wpis };
  }
  zapisany = idx === -1 || !tylkoLokalnie ? wpis : lista[idx];
  if (state.mode === (serial ? "shows" : "movies")) (serial ? renderShows : renderMovies)();
  updateStats();
  saveLocalDatabase();
  showToastNotification(juzByl
    ? `„${zapisany.title}” jest już w bibliotece.`
    : `Dodano "${zapisany.title}" do listy Do obejrzenia! 🔖`, juzByl ? "info" : "success");
  // Ostrzeżenie po toaście sukcesu: oba dzielą jeden element, wcześniejsze by zniknęło.
  if (tylkoLokalnie && getActiveEnvMode() === "flask") {
    showToastNotification("Nie udało się zapisać na serwerze — pozycja jest tylko w tej przeglądarce.", "error");
  }
  return zapisany;
}
