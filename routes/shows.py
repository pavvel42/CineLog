"""CineLog - trasy shows: shows.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import re
import time
import uuid
import logging
from datetime import datetime

from flask import Blueprint, jsonify, request

from typing import Any

from flask.typing import ResponseReturnValue

import app as _app

from routes._http import json_object
from services import client_keys
from services.data_store import find_same_item, safe_int
from services.validation import (
    episode_list,
    optional_year,
    parse_status,
    parse_tmdb_id,
    require_title,
    safe_poster_url,
    series_metadata,
)

log = logging.getLogger("cinelog")

bp = Blueprint("shows", __name__)

# Cache metadanych odcinków: wpisy (timestamp_monotonic, meta) z TTL i limitem —
# wcześniej rosły bez ograniczenia i serwowały stare dane do restartu procesu.
_EPISODES_CACHE_TTL_SECONDS = 24 * 60 * 60
_EPISODES_CACHE_MAX_ENTRIES = 200

def _now() -> float:
    return time.monotonic()

def _episodes_cache_get(cache_key: str):
    cached = _app.EPISODES_CACHE.get(cache_key)
    if not cached:
        return None
    ts, meta = cached
    if _now() - ts > _EPISODES_CACHE_TTL_SECONDS:
        _app.EPISODES_CACHE.pop(cache_key, None)
        return None
    return meta

def _episodes_cache_set(cache_key: str, meta: dict) -> None:
    _app.EPISODES_CACHE[cache_key] = (_now(), meta)
    while len(_app.EPISODES_CACHE) > _EPISODES_CACHE_MAX_ENTRIES:
        _app.EPISODES_CACHE.pop(next(iter(_app.EPISODES_CACHE)))

def _episode_key(episode: dict) -> tuple[int, int]:
    return (safe_int(episode.get("season")), safe_int(episode.get("episode")))


def _recalculate_show_progress(show: dict) -> dict:
    """Jedyne miejsce w backendzie przeliczające postęp serialu z episodes_watched.
    Reguła 1:1 z frontendowym recalculateShowProgress (modules/state.js) —
    używane przez /episodes, /batch_episodes i dodawanie serialu zamiast kopii logiki.
    `episodes_watched` niebędące listą traktujemy jak pustą listę."""
    eps = episode_list(show.get("episodes_watched"))
    eps.sort(key=_episode_key)
    show["episodes_watched"] = eps
    show["watched_count"] = len(eps)
    if eps:
        highest_s = max(_episode_key(e)[0] for e in eps)
        highest_e = max(_episode_key(e)[1] for e in eps if _episode_key(e)[0] == highest_s)
        show["latest_progress"] = f"S{highest_s:02d}E{highest_e:02d}"
        show["latest_season"] = highest_s
        show["latest_episode"] = highest_e
    else:
        show["latest_progress"] = None
        show["latest_season"] = 0
        show["latest_episode"] = 0
    return show

@bp.route("/api/shows", methods=["GET"])
def get_shows() -> ResponseReturnValue:
    shows = _app.load_shows()
    return jsonify(shows)

@bp.route("/api/shows/<show_uuid>/episodes_meta", methods=["GET"])
def get_show_episodes_meta(show_uuid: str) -> ResponseReturnValue:
    lang = request.args.get("lang", "pl-PL").strip()
    req_tmdb_id = request.args.get("tmdb_id", "").strip()
    shows = _app.load_shows()
    target_show = None
    for s in shows:
        if s.get("uuid") == show_uuid:
            target_show = s
            break
    if not target_show:
        return jsonify({"error": "Show not found"}), 404

    effective_tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY
    show_id = req_tmdb_id or target_show.get("tmdb_id")
    title = target_show.get("title", "")
    cache_key = f"{show_uuid}_{show_id}_{lang}"
    cached_meta = _episodes_cache_get(cache_key)
    if cached_meta is not None:
        return jsonify(cached_meta)

    clean_t = re.sub(r"\s*\([^)]*\)", "", title).strip()
    meta = _app.fetch_episodes_meta(clean_t, show_id, lang, effective_tmdb_key)

    if meta:
        _episodes_cache_set(cache_key, meta)
        return jsonify(meta)
    return jsonify({})

@bp.route("/api/shows/<show_uuid>", methods=["PUT"])
def update_show(show_uuid: str) -> ResponseReturnValue:
    data = json_object()
    # Walidacja przed jakimkolwiek zapisem: niepoprawne pole = 400 i żadna część żądania nie trafia do bazy.
    new_title = require_title(data["title"]) if "title" in data else None
    new_status = parse_status(data["status"]) if "status" in data else None
    new_tmdb_id = parse_tmdb_id(data["tmdb_id"]) if "tmdb_id" in data else None
    with _app.DATA_LOCK:
        shows = _app.load_shows()

        show_to_update = None
        for s in shows:
            if s.get("uuid") == show_uuid:
                show_to_update = s
                break

        if not show_to_update:
            return jsonify({"error": "Show not found"}), 404

        if new_title is not None:
            show_to_update["title"] = new_title
        if new_status is not None:
            show_to_update["status"] = new_status
            show_to_update["archived"] = (new_status == "archived")
        if "rating" in data:
            rating = data["rating"]
            if rating is None or (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
                show_to_update["rating"] = rating
        if "poster_url" in data and _app._is_safe_media_url(data["poster_url"]):
            show_to_update["poster_url"] = data["poster_url"]
        if new_tmdb_id is not None:
            show_to_update["tmdb_id"] = new_tmdb_id
        if "release_date" in data:
            show_to_update["release_date"] = data["release_date"]
        if "is_favorite" in data:
            show_to_update["is_favorite"] = bool(data["is_favorite"])
        # Tracker odświeża tędy przestarzałe metadane wpisu (liczba sezonów, lista odcinków).
        show_to_update.update(series_metadata(data))

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save shows"}), 500

@bp.route("/api/shows/<show_uuid>/episodes", methods=["POST"])
def toggle_episode(show_uuid: str) -> ResponseReturnValue:
    data = json_object()
    season = _app._safe_int(data.get("season", 1), 1)
    episode = _app._safe_int(data.get("episode", 1), 1)
    if season < 0 or episode < 0:
        return jsonify({"error": "Invalid season/episode"}), 400

    with _app.DATA_LOCK:
        shows = _app.load_shows()
        show_to_update = None
        for s in shows:
            if s.get("uuid") == show_uuid:
                show_to_update = s
                break

        if not show_to_update:
            return jsonify({"error": "Show not found"}), 404

        eps = episode_list(show_to_update.get("episodes_watched"))
        found_idx = -1
        for i, ep in enumerate(eps):
            if ep.get("season") == season and ep.get("episode") == episode:
                found_idx = i
                break

        if found_idx != -1:
            eps.pop(found_idx)
        else:
            eps.append({
                "episode_id": str(uuid.uuid4()),
                "season": season,
                "episode": episode,
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })

        show_to_update["episodes_watched"] = eps
        _recalculate_show_progress(show_to_update)

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save episode"}), 500

@bp.route("/api/shows/<show_uuid>/batch_episodes", methods=["POST"])
def batch_episodes(show_uuid: str) -> ResponseReturnValue:
    data = json_object()
    items_to_add = data.get("episodes", [])
    if not isinstance(items_to_add, list):
        return jsonify({"error": "Invalid episodes payload"}), 400

    with _app.DATA_LOCK:
        shows = _app.load_shows()
        show_to_update = None
        for s in shows:
            if s.get("uuid") == show_uuid:
                show_to_update = s
                break

        if not show_to_update:
            return jsonify({"error": "Show not found"}), 404

        eps = episode_list(show_to_update.get("episodes_watched"))
        existing = set((e.get("season"), e.get("episode")) for e in eps)

        for item in episode_list(items_to_add):
            s_num = _app._safe_int(item.get("season", 1), 1)
            e_num = _app._safe_int(item.get("episode", 1), 1)
            if (s_num, e_num) not in existing:
                eps.append({
                    "episode_id": str(uuid.uuid4()),
                    "season": s_num,
                    "episode": e_num,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })
                existing.add((s_num, e_num))

        show_to_update["episodes_watched"] = eps
        _recalculate_show_progress(show_to_update)

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save batch episodes"}), 500

@bp.route("/api/shows/verify_completion", methods=["POST"])
def verify_shows_completion() -> ResponseReturnValue:
    """Uzgadnia status seriali z listą obejrzanych odcinków.

    Brak danych nie jest dowodem: serial bez listy odcinków (np. z importu) albo bez znanej
    liczby odcinków nie traci statusu. Wpisów zarchiwizowanych nie ruszamy w ogóle.
    """
    with _app.DATA_LOCK:
        shows = _app.load_shows()
        updated_count = 0
        for s in shows:
            if s.get("archived") or s.get("status") == "archived":
                continue
            watched = s.get("episodes_watched")
            ep_count = len(watched) if isinstance(watched, list) else 0
            if ep_count == 0:
                continue
            total_eps = _app._safe_int(s.get("total_episodes"), 0)
            series_status = s.get("series_status")
            in_prod = s.get("in_production")

            if total_eps <= 0:
                # Nieznana liczba odcinków: jedyny pewny wniosek to „zaczęty serial z listy chcę obejrzeć”.
                if s.get("status") == "watchlist":
                    s["status"] = "watching"
                    updated_count += 1
            elif ep_count >= total_eps and (series_status in ["Ended", "Canceled"] or in_prod is False):
                if s.get("status") != "watched":
                    s["status"] = "watched"
                    updated_count += 1
                # Serial obejrzany do końca nie jest już "nadrobiony".
                if s.get("caught_up"):
                    s["caught_up"] = False
            elif ep_count >= total_eps and (series_status == "Returning Series" or in_prod is True):
                s["caught_up"] = True
                if s.get("status") != "watching":
                    s["status"] = "watching"
                    updated_count += 1
            else:
                if s.get("status") != "watching":
                    s["status"] = "watching"
                    updated_count += 1
        if updated_count > 0:
            _app.save_shows(shows)
        return jsonify({
            "success": True,
            "updated": updated_count,
            "shows": shows
        })

@bp.route("/api/shows/add", methods=["POST"])
@bp.route("/api/shows", methods=["POST"])
def add_show() -> ResponseReturnValue:
    data = json_object()
    title = require_title(data.get("title"))

    watched_episodes: list[dict[str, Any]] = []
    # Lista odcinków przekazana z selektora w UI (checkboxy).
    for item in episode_list(data.get("episodes_watched")):
        watched_episodes.append({
            "episode_id": str(uuid.uuid4()),
            "season": _app._safe_int(item.get("season", 1), 1),
            "episode": _app._safe_int(item.get("episode", 1), 1),
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    status = parse_status(data["status"]) if "status" in data else ("watching" if watched_episodes else "watchlist")
    tmdb_id = _app.normalize_tmdb_id(data.get("tmdb_id"))
    year = optional_year(data.get("year"))

    poster_url = safe_poster_url(data.get("poster_url"))
    if not poster_url:
        poster_url, _ = _app.fetch_online_metadata(title, "series", client_keys.omdb_key())

    rating = data.get("rating") or None
    if status == "watchlist":
        rating = None
    elif not (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
        rating = None

    # Metadane serialu: /api/shows/verify_completion rozpoznaje z nich "obejrzane wszystko"
    # i "serial wciąż w emisji", a tracker liczy z listy odcinków liczbę wierszy sezonu.
    # Nie nadpisują znanych wartości zerem ani pustką (patrz `series_metadata`).
    metadane = series_metadata(data)

    with _app.DATA_LOCK:
        shows = _app.load_shows()
        existing_show = find_same_item(shows, {"title": title, "tmdb_id": tmdb_id, "year": year})

        if existing_show:
            existing_show.update(metadane)
            if poster_url and (not existing_show.get("poster_url") or "favicon" in existing_show.get("poster_url", "")):
                existing_show["poster_url"] = poster_url
            if tmdb_id and not existing_show.get("tmdb_id"):
                existing_show["tmdb_id"] = tmdb_id
            # Szybkie „+ Do obejrzenia” na serialu, który już jest w bibliotece, niczego nie cofa:
            # status i ocena zostają (wcześniej kasowało ocenę i zmieniało status).
            if status != "watchlist":
                existing_show["status"] = status
                if rating is not None:
                    existing_show["rating"] = rating
            if watched_episodes:
                existing_eps = episode_list(existing_show.get("episodes_watched"))
                existing_keys = {f"{e.get('season')}_{e.get('episode')}" for e in existing_eps}
                for we in watched_episodes:
                    k = f"{we.get('season')}_{we.get('episode')}"
                    if k not in existing_keys:
                        existing_eps.append(we)
                        existing_keys.add(k)
                existing_show["episodes_watched"] = existing_eps
                _recalculate_show_progress(existing_show)
                if existing_eps and existing_show.get("status") == "watchlist":
                    existing_show["status"] = "watching"
            existing_show["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if _app.save_shows(shows):
                if status == "watchlist":
                    return jsonify({**existing_show, "already_exists": True}), 200
                return jsonify(existing_show), 200
            return jsonify({"error": "Failed to save database"}), 500

        new_show = {
            "uuid": str(uuid.uuid4()),
            "show_id": None,
            "title": title,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "active": True,
            "archived": False,
            "rating": rating,
            "poster_url": poster_url,
            "episodes_watched": watched_episodes,
            "status": status,
            "tmdb_id": tmdb_id
        }
        if year:
            new_show["year"] = year
        _recalculate_show_progress(new_show)

        new_show.update(metadane)

        shows.insert(0, new_show)
        if _app.save_shows(shows):
            return jsonify(new_show), 201
        else:
            return jsonify({"error": "Failed to save show"}), 500

@bp.route("/api/shows/<show_uuid>", methods=["DELETE"])
def delete_show(show_uuid: str) -> ResponseReturnValue:
    with _app.DATA_LOCK:
        shows = _app.load_shows()
        found_idx = -1
        for i, s in enumerate(shows):
            if s.get("uuid") == show_uuid:
                found_idx = i
                break

        if found_idx == -1:
            return jsonify({"error": "Show not found"}), 404

        deleted_show = shows.pop(found_idx)
        if _app.save_shows(shows):
            return jsonify({"success": True, "deleted": deleted_show})
        else:
            return jsonify({"error": "Failed to save database"}), 500
