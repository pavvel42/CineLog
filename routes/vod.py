"""CineLog - trasy vod: vod.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

import re
import logging
from datetime import datetime

from flask import Blueprint, jsonify, request

import app as _app

log = logging.getLogger("cinelog")

bp = Blueprint("vod", __name__)

@bp.route("/api/watch_providers", methods=["GET"])
def get_watch_providers():
    title = request.args.get("title", "").strip()
    media_type = request.args.get("type", "movie").strip().lower()
    region = request.args.get("region", "PL").strip().upper()
    tmdb_id = request.args.get("tmdb_id", "").strip()
    
    if media_type == "series":
        media_type = "tv"
    
    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip().lower()
    cache_key = f"{media_type}_{region}_{clean_title}"
    
    cache = _app.load_vod_cache()
    cached_entry = cache.get(cache_key)
    
    # Check TTL (7 days)
    if cached_entry and "expires_at" in cached_entry and not tmdb_id:
        try:
            exp_time = datetime.strptime(cached_entry["expires_at"], "%Y-%m-%d %H:%M:%S")
            if datetime.now() < exp_time and cached_entry.get("found"):
                return jsonify(cached_entry)
        except Exception:
            pass

    # Fetch live and update cache
    fresh_data = _app.fetch_live_watch_providers(clean_title, media_type, region, tmdb_id=tmdb_id if tmdb_id else None)
    if fresh_data.get("found") or not cached_entry:
        cache[cache_key] = fresh_data
        _app.save_vod_cache(cache)
    return jsonify(fresh_data)

@bp.route("/api/vod_cache_all", methods=["GET"])
def get_all_vod_cache():
    region = request.args.get("region", "PL").strip().upper()
    cache = _app.load_vod_cache()

    # Filter for active region
    region_cache = {}
    for key, val in cache.items():
        if f"_{region}_" in key:
            region_cache[key] = val
            
    return jsonify(region_cache)

@bp.route("/api/vod_precache", methods=["POST"])
def precache_vod_batch():
    data = request.json or {}
    items = data.get("items", [])
    region = data.get("region", "PL").strip().upper()

    # Hard cap to prevent abuse / TMDb rate-limit exhaustion via huge batches
    MAX_PRECACHE_ITEMS = 50
    if not isinstance(items, list):
        return jsonify({"error": "Invalid items payload"}), 400
    if len(items) > MAX_PRECACHE_ITEMS:
        return jsonify({"error": f"Too many items ({len(items)}). Limit is {MAX_PRECACHE_ITEMS} per request."}), 400

    with _app.DATA_LOCK:
        cache = _app.load_vod_cache()
        updated_count = 0

        for it in items:
            title = it.get("title", "").strip()
            m_type = "tv" if it.get("type") in ["series", "tv"] else "movie"
            clean_t = re.sub(r"\s*\([^)]*\)", "", title).strip().lower()
            k = f"{m_type}_{region}_{clean_t}"

            needs_fetch = True
            if k in cache and "expires_at" in cache[k]:
                try:
                    exp = datetime.strptime(cache[k]["expires_at"], "%Y-%m-%d %H:%M:%S")
                    if datetime.now() < exp:
                        needs_fetch = False
                except Exception:
                    pass

            if needs_fetch:
                res = _app.fetch_live_watch_providers(clean_t, m_type, region)
                cache[k] = res
                updated_count += 1

        if updated_count:
            _app.save_vod_cache(cache)

        return jsonify({"status": "ok", "updated": updated_count, "total": len(items)})

# --- UPCOMING & RELEASE RADAR API ---
