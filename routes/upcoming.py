"""CineLog - trasy upcoming: upcoming.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

import json
import re
import logging
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date

import os
from flask import Blueprint, jsonify, request


import app as _app

from services import client_keys

log = logging.getLogger("cinelog")

bp = Blueprint("upcoming", __name__)

@bp.route("/api/upcoming", methods=["GET"])
def get_upcoming_schedule():
    force_refresh = request.args.get("refresh") == "1"
    effective_tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY
    movies = _app.load_movies()
    shows = _app.load_shows()
    
    today = date.today()
    all_items = []
    
    # 1. Watchlist movies with future release_date
    for m in movies:
        if m.get("status") in ["watchlist", "planowane"] and m.get("release_date"):
            rd = m.get("release_date")
            try:
                dt = datetime.strptime(rd[:10], "%Y-%m-%d").date()
                if dt >= today:
                    days_left = (dt - today).days
                    all_items.append({
                        "id": m.get("uuid"),
                        "title": m.get("title"),
                        "media_type": "movie",
                        "poster_url": m.get("poster_url"),
                        "release_date": rd[:10],
                        "days_left": days_left,
                        "badge_type": "movie_premiere",
                        "status_label": "Premiera kinowa / VOD",
                        "episode_info": None,
                        "series_status": None,
                        "my_status": m.get("status", "watchlist"),
                        "is_in_library": True
                    })
            except Exception:
                pass
                
    # 2. TV shows (watching & watchlist)
    cache = {}
    if os.path.exists(_app.UPCOMING_CACHE_FILE):
        try:
            with open(_app.UPCOMING_CACHE_FILE, "r", encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            pass
            
    watching_shows = [s for s in shows if s.get("status") in ["watching", "watchlist", "w_trakcie", "planowane"] and not s.get("archived")]
    
    def fetch_show_upcoming(s):
        if not effective_tmdb_key:
            return (None, None, False)

        t = s.get("title", "").strip()
        clean_t = re.sub(r"\s*\([^)]*\)", "", t).strip()
        k = clean_t.lower()
        tmdb_id = s.get("tmdb_id")
        
        if not force_refresh and k in cache and "data" in cache[k] and "expires_at" in cache[k]:
            try:
                exp = datetime.strptime(cache[k]["expires_at"], "%Y-%m-%d %H:%M:%S")
                if datetime.now() < exp:
                    return (k, cache[k]["data"], False)
            except Exception:
                pass
                
        try:
            tv_id = tmdb_id
            if not tv_id:
                url = f"https://api.themoviedb.org/3/search/tv?api_key={effective_tmdb_key}&query={urllib.parse.quote(clean_t)}&language=pl-PL"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    results = data.get("results", [])
                    if not results:
                        return (k, None, False)
                    
                    clean_target = clean_t.lower()
                    top = None
                    for r in results:
                        orig = (r.get("original_name") or "").lower()
                        name = (r.get("name") or "").lower()
                        if orig == clean_target or name == clean_target:
                            top = r
                            break
                    if not top:
                        top = results[0]
                    tv_id = top.get("id")

            if not tv_id:
                return (k, None, False)

            detail_url = f"https://api.themoviedb.org/3/tv/{tv_id}?api_key={effective_tmdb_key}&language=pl-PL"
            req_d = urllib.request.Request(detail_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_d, timeout=4) as r_d:
                detail = json.loads(r_d.read().decode("utf-8", errors="ignore"))
                return (k, detail, True)
        except Exception:
            return (k, None, False)

    results = []
    if effective_tmdb_key:
        with ThreadPoolExecutor(max_workers=15) as executor:
            results = list(executor.map(fetch_show_upcoming, watching_shows))
        
    cache_dirty = False
    for (k, detail, is_new), s in zip(results, watching_shows):
        if not detail:
            continue
            
        if is_new:
            status = detail.get("status")
            days_exp = 30 if status in ["Ended", "Canceled"] else 0.5
            exp_time = datetime.now().timestamp() + (days_exp * 86400)
            cache[k] = {
                "expires_at": datetime.fromtimestamp(exp_time).strftime("%Y-%m-%d %H:%M:%S"),
                "data": detail
            }
            cache_dirty = True
            
        status = detail.get("status")
        next_ep = detail.get("next_episode_to_air")
        poster = f"https://image.tmdb.org/t/p/w500{detail.get('poster_path')}" if detail.get("poster_path") else s.get("poster_url")
        
        if next_ep and next_ep.get("air_date"):
            ad = next_ep.get("air_date")
            try:
                dt = datetime.strptime(ad, "%Y-%m-%d").date()
                days_left = (dt - today).days
                ep_s = next_ep.get("season_number")
                ep_e = next_ep.get("episode_number")
                ep_name = next_ep.get("name") or ""
                ep_code = f"S{ep_s:02d}E{ep_e:02d}"
                all_items.append({
                    "id": s.get("uuid"),
                    "title": s.get("title"),
                    "tmdb_title": detail.get("name"),
                    "media_type": "tv",
                    "poster_url": poster,
                    "release_date": ad,
                    "days_left": days_left,
                    "badge_type": "episode_airing",
                    "episode_info": {
                        "season": ep_s,
                        "episode": ep_e,
                        "code": ep_code,
                        "name": ep_name,
                        "overview": next_ep.get("overview") or ""
                    },
                    "status_label": f"{ep_code} • {ep_name}" if ep_name else ep_code,
                    "series_status": status,
                    "my_status": s.get("status")
                })
            except Exception:
                pass
        elif status in ["Returning Series", "In Production", "Planned"]:
            all_items.append({
                "id": s.get("uuid"),
                "title": s.get("title"),
                "tmdb_title": detail.get("name"),
                "media_type": "tv",
                "poster_url": poster,
                "release_date": None,
                "days_left": 9999,
                "badge_type": "in_production",
                "episode_info": None,
                "status_label": "Kolejny sezon potwierdzony (W produkcji)",
                "series_status": status,
                "my_status": s.get("status")
            })
            
    if cache_dirty:
        try:
            os.makedirs(os.path.dirname(_app.UPCOMING_CACHE_FILE), exist_ok=True)
            with open(_app.UPCOMING_CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(cache, f, ensure_ascii=False, indent=2)
        except Exception:
            pass
            
    # Deduplicate items by title / ID
    seen_keys = set()
    unique_items = []
    for it in all_items:
        key = (it.get("media_type"), (it.get("tmdb_title") or it.get("title") or "").strip().lower())
        if key not in seen_keys:
            seen_keys.add(key)
            unique_items.append(it)
    all_items = unique_items

    all_items.sort(key=lambda x: (x["days_left"], x["title"].lower()))
    
    return jsonify({
        "status": "ok",
        "total": len(all_items),
        "items": all_items
    })

# --- EXPORT & RESET ---
