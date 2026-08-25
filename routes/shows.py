"""CineLog - trasy shows: shows.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

import json
import re
import uuid
import logging
import shutil
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta

from flask import Blueprint, jsonify, request, Response

import app as _app

log = logging.getLogger("cinelog")

bp = Blueprint("shows", __name__)

@bp.route("/api/shows", methods=["GET"])
def get_shows():
    shows = _app.load_shows()
    return jsonify(shows)

@bp.route("/api/shows/<show_uuid>", methods=["GET"])
def get_show_detail(show_uuid):
    shows = _app.load_shows()
    for s in shows:
        if s.get("uuid") == show_uuid:
            return jsonify(s)
    return jsonify({"error": "Show not found"}), 404

@bp.route("/api/shows/<show_uuid>/episodes_meta", methods=["GET"])
def get_show_episodes_meta(show_uuid):
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

    effective_tmdb_key = request.args.get("tmdb_key", "").strip() or _app.TMDB_API_KEY
    show_id = req_tmdb_id or target_show.get("tmdb_id")
    title = target_show.get("title", "")
    cache_key = f"{show_uuid}_{show_id}_{lang}"
    if cache_key in _app.EPISODES_CACHE:
        return jsonify(_app.EPISODES_CACHE[cache_key])

    clean_t = re.sub(r"\s*\([^)]*\)", "", title).strip()
    meta = _app.fetch_episodes_meta(clean_t, show_id, lang, effective_tmdb_key)

    if meta:
        _app.EPISODES_CACHE[cache_key] = meta
        return jsonify(meta)
    return jsonify({})

@bp.route("/api/shows/<show_uuid>", methods=["PUT"])
def update_show(show_uuid):
    data = request.get_json() or {}
    with _app.DATA_LOCK:
        shows = _app.load_shows()

        show_to_update = None
        for s in shows:
            if s.get("uuid") == show_uuid:
                show_to_update = s
                break

        if not show_to_update:
            return jsonify({"error": "Show not found"}), 404

        if "title" in data and isinstance(data["title"], str) and data["title"].strip():
            show_to_update["title"] = data["title"].strip()
        if "status" in data and data["status"] in ["watching", "watchlist", "archived"]:
            show_to_update["status"] = data["status"]
            show_to_update["archived"] = (data["status"] == "archived")
        if "rating" in data:
            rating = data["rating"]
            if rating is None or (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
                show_to_update["rating"] = rating
        if "poster_url" in data and _app._is_safe_media_url(data["poster_url"]):
            show_to_update["poster_url"] = data["poster_url"]
        if "tmdb_id" in data:
            show_to_update["tmdb_id"] = data["tmdb_id"]
        if "release_date" in data:
            show_to_update["release_date"] = data["release_date"]
        if "is_favorite" in data:
            show_to_update["is_favorite"] = bool(data["is_favorite"])

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save shows"}), 500

@bp.route("/api/shows/<show_uuid>/episodes", methods=["POST"])
def toggle_episode(show_uuid):
    data = request.get_json() or {}
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

        eps = show_to_update.get("episodes_watched", [])
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

        eps.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))
        show_to_update["episodes_watched"] = eps
        show_to_update["watched_count"] = len(eps)

        if eps:
            highest_s = max(e["season"] for e in eps)
            highest_e = max(e["episode"] for e in eps if e["season"] == highest_s)
            show_to_update["latest_progress"] = f"S{highest_s:02d}E{highest_e:02d}"
            show_to_update["latest_season"] = highest_s
            show_to_update["latest_episode"] = highest_e
        else:
            show_to_update["latest_progress"] = None
            show_to_update["latest_season"] = 0
            show_to_update["latest_episode"] = 0

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save episode"}), 500

@bp.route("/api/shows/<show_uuid>/batch_episodes", methods=["POST"])
def batch_episodes(show_uuid):
    data = request.get_json() or {}
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

        eps = show_to_update.get("episodes_watched", [])
        existing = set((e.get("season"), e.get("episode")) for e in eps)

        for item in items_to_add:
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

        eps.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))
        show_to_update["episodes_watched"] = eps
        show_to_update["watched_count"] = len(eps)

        if eps:
            highest_s = max(e["season"] for e in eps)
            highest_e = max(e["episode"] for e in eps if e["season"] == highest_s)
            show_to_update["latest_progress"] = f"S{highest_s:02d}E{highest_e:02d}"
            show_to_update["latest_season"] = highest_s
            show_to_update["latest_episode"] = highest_e

        if _app.save_shows(shows):
            return jsonify(show_to_update)
        else:
            return jsonify({"error": "Failed to save batch episodes"}), 500

@bp.route("/api/shows/verify_completion", methods=["POST", "GET"])
def verify_shows_completion():
    with _app.DATA_LOCK:
        shows = _app.load_shows()
        updated_count = 0
        for s in shows:
            ep_count = len(s.get("episodes_watched") or [])
            total_eps = s.get("total_episodes") or 0
            series_status = s.get("series_status")
            in_prod = s.get("in_production")

            if ep_count == 0:
                if s.get("status") != "watchlist":
                    s["status"] = "watchlist"
                    updated_count += 1
            elif total_eps > 0 and ep_count >= total_eps and (series_status in ["Ended", "Canceled"] or in_prod is False):
                if s.get("status") != "watched":
                    s["status"] = "watched"
                    updated_count += 1
            elif total_eps > 0 and ep_count >= total_eps and (series_status == "Returning Series" or in_prod is True):
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
def add_show():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    
    if not title:
        return jsonify({"error": "Title is required"}), 400

    poster_url = data.get("poster_url")
    if not poster_url:
        poster_url, _ = _app.fetch_online_metadata(title, "series")
        
    shows = _app.load_shows()
    
    watched_episodes = []

    # 1. Direct list of episodes passed from UI checkbox selector
    raw_watched_list = data.get("episodes_watched")
    if raw_watched_list and isinstance(raw_watched_list, list):
        for item in raw_watched_list:
            watched_episodes.append({
                "episode_id": str(uuid.uuid4()),
                "season": _app._safe_int(item.get("season", 1), 1),
                "episode": _app._safe_int(item.get("episode", 1), 1),
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
    else:
        # Fallback to up_to_season / up_to_episode
        up_to_season = _app._safe_int(data.get("up_to_season", 0))
        up_to_episode = _app._safe_int(data.get("up_to_episode", 0))
        if up_to_season > 0 and up_to_episode > 0:
            for s in range(1, up_to_season):
                for e in range(1, 25):
                    watched_episodes.append({
                        "episode_id": str(uuid.uuid4()),
                        "season": s,
                        "episode": e,
                        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    })
            for e in range(1, up_to_episode + 1):
                watched_episodes.append({
                    "episode_id": str(uuid.uuid4()),
                    "season": up_to_season,
                    "episode": e,
                    "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                })

    watched_episodes.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))

    highest_s = max([e["season"] for e in watched_episodes], default=0)
    highest_e = max([e["episode"] for e in watched_episodes if e["season"] == highest_s], default=0)
    latest_progress = f"S{highest_s:02d}E{highest_e:02d}" if (highest_s > 0 and highest_e > 0) else None

    status = data.get("status", "watching" if len(watched_episodes) > 0 else "watchlist")
    rating = data.get("rating") or None
    if status == "watchlist":
        rating = None
    elif not (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
        rating = None

    with _app.DATA_LOCK:
        shows = _app.load_shows()
        norm_title = _app.normalize_title(title)
        tmdb_id = data.get("tmdb_id")
        existing_show = next((s for s in shows if (tmdb_id and s.get("tmdb_id") and str(s.get("tmdb_id")) == str(tmdb_id)) or (_app.normalize_title(s.get("title")) and _app.normalize_title(s.get("title")) == norm_title)), None)

        if existing_show:
            existing_show["status"] = status
            if rating is not None:
                existing_show["rating"] = rating
            elif status == "watchlist":
                existing_show["rating"] = None
            if poster_url and (not existing_show.get("poster_url") or "favicon" in existing_show.get("poster_url", "")):
                existing_show["poster_url"] = poster_url
            if watched_episodes:
                existing_eps = existing_show.get("episodes_watched") or []
                existing_keys = {f"{e.get('season')}_{e.get('episode')}" for e in existing_eps}
                for we in watched_episodes:
                    k = f"{we.get('season')}_{we.get('episode')}"
                    if k not in existing_keys:
                        existing_eps.append(we)
                        existing_keys.add(k)
                existing_eps.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))
                existing_show["episodes_watched"] = existing_eps
                highest_s = max([e["season"] for e in existing_eps], default=0)
                highest_e = max([e["episode"] for e in existing_eps if e["season"] == highest_s], default=0)
                existing_show["latest_progress"] = f"S{highest_s:02d}E{highest_e:02d}" if (highest_s > 0 and highest_e > 0) else None
                existing_show["watched_count"] = len(existing_eps)
                if len(existing_eps) > 0 and status == "watchlist":
                    existing_show["status"] = "watching"
            existing_show["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            if _app.save_shows(shows):
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
            "watched_count": len(watched_episodes),
            "latest_progress": latest_progress,
            "latest_season": highest_s,
            "latest_episode": highest_e,
            "status": status
        }

        shows.insert(0, new_show)
        if _app.save_shows(shows):
            return jsonify(new_show), 201
        else:
            return jsonify({"error": "Failed to save show"}), 500

@bp.route("/api/shows/<show_uuid>", methods=["DELETE"])
def delete_show(show_uuid):
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
