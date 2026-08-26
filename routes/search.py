"""CineLog - trasy search: search.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import json
import re
import logging
import urllib.request
import urllib.parse

import os
from flask import Blueprint, jsonify, request


from flask.typing import ResponseReturnValue

import app as _app

from services import client_keys

log = logging.getLogger("cinelog")

bp = Blueprint("search", __name__)

@bp.route("/api/search_preview", methods=["GET"])
def search_preview() -> ResponseReturnValue:
    title = request.args.get("q", "").strip()
    media_type = request.args.get("type", "movie").strip()
    lang = request.args.get("lang", "pl-PL").strip()

    if not title:
        return jsonify({"found": False, "message": "Podaj tytuł do wyszukania."}), 400

    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip()
    tmdb_type = "tv" if media_type == "series" else "movie"
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY
    omdb_key = client_keys.omdb_key() or os.environ.get("OMDB_API_KEY", "").strip()
    results_list = []

    # Without any API key, online search is impossible - guide the user instead of returning a dead end
    if not tmdb_key and not omdb_key:
        return jsonify({
            "found": False,
            "needs_key": True,
            "message": "Wyszukiwanie online wymaga darmowego klucza TMDb. Skonfiguruj go w zakładce „Chmura & Asystent AI” → „Klucze API” lub w pliku .env."
        })

    # 1. Primary: Search TMDb with user's language (e.g. pl-PL) if key is present
    if tmdb_key:
        try:
            url_tmdb = f"https://api.themoviedb.org/3/search/{tmdb_type}?api_key={tmdb_key}&query={urllib.parse.quote(clean_title)}&language={lang}"
            req = urllib.request.Request(url_tmdb, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                raw_results = data.get("results", [])

                # Check if any items are missing overview (fallback to English search to get original plot)
                en_overviews = {}
                if raw_results and any(not it.get("overview") for it in raw_results) and lang != "en-US":
                    try:
                        url_en = f"https://api.themoviedb.org/3/search/{tmdb_type}?api_key={tmdb_key}&query={urllib.parse.quote(clean_title)}&language=en-US"
                        with urllib.request.urlopen(urllib.request.Request(url_en, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_en:
                            en_data = json.loads(r_en.read().decode("utf-8", errors="ignore"))
                            for en_it in en_data.get("results", []):
                                if en_it.get("overview"):
                                    en_overviews[en_it.get("id")] = en_it.get("overview")
                    except Exception:
                        pass

                for item in raw_results:
                    t = item.get("title") or item.get("name")
                    poster = f"https://image.tmdb.org/t/p/w500{item.get('poster_path')}" if item.get("poster_path") else None
                    rel_date = item.get("release_date") or item.get("first_air_date") or ""
                    plot = item.get("overview") or en_overviews.get(item.get("id"), "")
                    results_list.append({
                        "tmdb_id": item.get("id"),
                        "title": t,
                        "original_title": item.get("original_title") or item.get("original_name") or t,
                        "year": rel_date[:4] if rel_date else "",
                        "release_date": rel_date,
                        "type": media_type,
                        "poster_url": poster,
                        "vote_average": item.get("vote_average", 0),
                        "vote_count": item.get("vote_count", 0),
                        "overview": plot
                    })
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return jsonify({
                    "found": False,
                    "needs_key": True,
                    "message": f"Klucz TMDb został odrzucony przez API (HTTP {e.code}). Sprawdź, czy klucz jest poprawny w zakładce „Chmura & Asystent AI” → „Klucze API”."
                })
            log.warning("TMDb search preview error: %s", e)
        except Exception as e:
            log.warning("TMDb search preview error: %s", e)

    # 2. Secondary fallback: Search OMDb if TMDb returned empty
    if not results_list:
        try:
            url_omdb_search = f"https://www.omdbapi.com/?apikey={omdb_key}&s={urllib.parse.quote(clean_title)}"
            if media_type in ["movie", "series"]:
                url_omdb_search += f"&type={media_type}"
            req = urllib.request.Request(url_omdb_search, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if data.get("Response") == "True":
                    for item in data.get("Search", []):
                        results_list.append({
                            "imdb_id": item.get("imdbID"),
                            "title": item.get("Title"),
                            "year": item.get("Year"),
                            "type": item.get("Type"),
                            "poster_url": item.get("Poster") if item.get("Poster") != "N/A" else None,
                            "overview": ""
                        })
        except Exception:
            pass

    if results_list:
        return jsonify({
            "found": True,
            "count": len(results_list),
            "results": results_list
        })
    else:
        return jsonify({
            "found": False,
            "message": f"Nie znaleziono pozycji „{title}”. Upewnij się, że tytuł jest poprawny."
        })

# --- DETAILED LOOKUP FOR A SPECIFIC PRODUCTION WITH USER LANGUAGE ---
@bp.route("/api/search_detail", methods=["GET"])
def search_detail() -> ResponseReturnValue:
    tmdb_id = request.args.get("tmdb_id", "").strip()
    imdb_id = request.args.get("id", "").strip()
    title = request.args.get("title", "").strip()
    year = request.args.get("year", "").strip()
    media_type = request.args.get("type", "movie").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    effective_tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY

    poster_url_param = request.args.get("poster_url", "").strip()

    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip()
    tmdb_type = "tv" if media_type == "series" else "movie"

    # If numeric id passed in id param, treat as tmdb_id
    if not tmdb_id and imdb_id.isdigit():
        tmdb_id = imdb_id
        imdb_id = ""

    # Helper function to build detailed response from TMDb detail payload
    def build_tmdb_response(det, current_type):
        loc_title = det.get("title") or det.get("name") or title
        plot = det.get("overview") or ""
        
        # Fallback to English plot if localized plot is empty
        if not plot and lang != "en-US" and effective_tmdb_key:
            try:
                url_en = f"https://api.themoviedb.org/3/{current_type}/{det.get('id')}?api_key={effective_tmdb_key}&language=en-US"
                with urllib.request.urlopen(urllib.request.Request(url_en, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_en:
                    det_en = json.loads(r_en.read().decode("utf-8", errors="ignore"))
                    plot = det_en.get("overview", "")
            except Exception:
                pass

        genres = ", ".join([g.get("name") for g in det.get("genres", []) if g.get("name")])
        rel_date = det.get("release_date") or det.get("first_air_date") or ""
        poster = f"https://image.tmdb.org/t/p/w500{det.get('poster_path')}" if det.get("poster_path") else None
        if not poster and lang != "en-US" and effective_tmdb_key:
            try:
                url_en = f"https://api.themoviedb.org/3/{current_type}/{det.get('id')}?api_key={effective_tmdb_key}&language=en-US"
                with urllib.request.urlopen(urllib.request.Request(url_en, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_en:
                    det_en = json.loads(r_en.read().decode("utf-8", errors="ignore"))
                    if det_en.get("poster_path"):
                        poster = f"https://image.tmdb.org/t/p/w500{det_en.get('poster_path')}"
            except Exception:
                pass
        if not poster and poster_url_param:
            poster = poster_url_param

        backdrop = f"https://image.tmdb.org/t/p/w780{det.get('backdrop_path')}" if det.get("backdrop_path") else None
        
        season_ep_counts = {}
        total_episodes = 0
        if current_type == "tv" and "seasons" in det:
            for s in det["seasons"]:
                s_num = s.get("season_number")
                if s_num is not None and s_num > 0:
                    cnt = s.get("episode_count", 0)
                    season_ep_counts[s_num] = cnt
                    total_episodes += cnt

        cast_list = []
        if "credits" in det and "cast" in det["credits"]:
            for c in det["credits"]["cast"][:10]:
                c_p = f"https://image.tmdb.org/t/p/w185{c.get('profile_path')}" if c.get("profile_path") else None
                cast_list.append({
                    "name": c.get("name"),
                    "character": c.get("character"),
                    "photo": c_p
                })

        directors = []
        if "credits" in det and "crew" in det["credits"]:
            for cr in det["credits"]["crew"]:
                if cr.get("job") == "Director" or cr.get("department") == "Directing":
                    if cr.get("name") and cr.get("name") not in directors:
                        directors.append(cr.get("name"))

        director_str = ", ".join(directors[:3]) if directors else None

        return jsonify({
            "title": loc_title,
            "original_title": det.get("original_title") or det.get("original_name") or title,
            "year": rel_date[:4] if rel_date else year,
            "release_date": rel_date,
            "runtime": det.get("runtime") or (det.get("episode_run_time")[0] if det.get("episode_run_time") else None),
            "genre": genres or "Brak danych",
            "plot": plot or "Brak opisu dla tej pozycji.",
            "director": director_str,
            "actors": ", ".join([c["name"] for c in cast_list[:4]]) if cast_list else None,
            "cast": cast_list,
            "rating": det.get("vote_average"),
            "vote_count": det.get("vote_count"),
            "poster_url": poster,
            "backdrop_url": backdrop,
            "tmdb_id": det.get("id"),
            "status": det.get("status"),
            "season_ep_counts": season_ep_counts,
            "total_episodes": total_episodes if total_episodes > 0 else det.get("number_of_episodes"),
            "source": "tmdb",
            "type": "series" if current_type == "tv" else "movie"
        })

    # 1. DIRECT LOOKUP BY TMDb ID (Most accurate - 100% 1:1 match to selected card)
    if effective_tmdb_key and tmdb_id and tmdb_id.isdigit():
        try:
            url_detail = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}?api_key={effective_tmdb_key}&language={lang}&append_to_response=credits"
            req_d = urllib.request.Request(url_detail, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_d, timeout=4) as r_det:
                det = json.loads(r_det.read().decode("utf-8", errors="ignore"))
                return build_tmdb_response(det, tmdb_type)
        except Exception:
            # Try alternate type (tv vs movie)
            try:
                alt_type = "movie" if tmdb_type == "tv" else "tv"
                url_alt = f"https://api.themoviedb.org/3/{alt_type}/{tmdb_id}?api_key={effective_tmdb_key}&language={lang}&append_to_response=credits"
                with urllib.request.urlopen(urllib.request.Request(url_alt, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_alt:
                    det = json.loads(r_alt.read().decode("utf-8", errors="ignore"))
                    return build_tmdb_response(det, alt_type)
            except Exception:
                pass

    # 2. SEARCH QUERY FALLBACK (With exact year match)
    if effective_tmdb_key and clean_title:
        try:
            url_search = f"https://api.themoviedb.org/3/search/{tmdb_type}?api_key={effective_tmdb_key}&query={urllib.parse.quote(clean_title)}&language={lang}"
            req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                s_data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                results = s_data.get("results", [])
                
                if not results:
                    alt_type = "movie" if tmdb_type == "tv" else "tv"
                    url_alt = f"https://api.themoviedb.org/3/search/{alt_type}?api_key={effective_tmdb_key}&query={urllib.parse.quote(clean_title)}&language={lang}"
                    with urllib.request.urlopen(urllib.request.Request(url_alt, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_alt:
                        alt_data = json.loads(r_alt.read().decode("utf-8", errors="ignore"))
                        if alt_data.get("results"):
                            results = alt_data.get("results")
                            tmdb_type = alt_type

                if results:
                    def score_result(r):
                        score = 0.0
                        rd = r.get("release_date") or r.get("first_air_date") or ""
                        # 1. Exact year match
                        if year and rd.startswith(year):
                            score += 80.0
                        # 2. Exact Poster match with library image
                        p_path = r.get("poster_path")
                        if poster_url_param and p_path and p_path in poster_url_param:
                            score += 1000.0
                        # 3. Popularity & Vote Count weighting (drastically prefers real movies over 0-vote student shorts)
                        vc = r.get("vote_count", 0) or 0
                        pop = r.get("popularity", 0.0) or 0.0
                        score += min(float(vc) * 0.1, 100.0) + min(float(pop), 50.0)
                        # 4. Title match quality
                        t = (r.get("title") or r.get("name") or "").lower().strip()
                        ot = (r.get("original_title") or r.get("original_name") or "").lower().strip()
                        clean_lower = clean_title.lower().strip()
                        if t == clean_lower or ot == clean_lower:
                            score += 40.0
                        return score

                    results.sort(key=score_result, reverse=True)
                    chosen = results[0]

                    target_id = chosen["id"]
                    url_detail = f"https://api.themoviedb.org/3/{tmdb_type}/{target_id}?api_key={effective_tmdb_key}&language={lang}&append_to_response=credits"
                    with urllib.request.urlopen(urllib.request.Request(url_detail, headers={"User-Agent": "Mozilla/5.0"}), timeout=4) as r_det:
                        det = json.loads(r_det.read().decode("utf-8", errors="ignore"))
                        return build_tmdb_response(det, tmdb_type)
        except Exception as e:
            log.warning("TMDb detail fetch error: %s", e)

    # 2. Fallback to OMDb / TVmaze
    effective_omdb_key = client_keys.omdb_key() or os.environ.get("OMDB_API_KEY", "").strip() or os.environ.get("IMDB_API_KEY", "").strip()
    if effective_omdb_key:
        try:
            if imdb_id:
                url_omdb = f"https://www.omdbapi.com/?apikey={effective_omdb_key}&i={imdb_id}&plot=full"
            else:
                url_omdb = f"https://www.omdbapi.com/?apikey={effective_omdb_key}&t={urllib.parse.quote(clean_title)}&plot=full"
            req = urllib.request.Request(url_omdb, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if data.get("Response") == "True":
                    total_seasons = int(data.get("totalSeasons")) if data.get("totalSeasons", "").isdigit() else 1
                    return jsonify({
                        "found": True,
                        "imdb_id": data.get("imdbID"),
                        "title": data.get("Title"),
                        "year": data.get("Year"),
                        "released": data.get("Released"),
                        "genre": data.get("Genre"),
                        "director": data.get("Director"),
                        "actors": data.get("Actors"),
                        "plot": data.get("Plot"),
                        "poster_url": data.get("Poster") if data.get("Poster") != "N/A" else None,
                        "total_seasons": total_seasons,
                        "season_ep_counts": {},
                        "type": data.get("Type")
                    })
        except Exception as e:
            log.warning("OMDb detail fetch fallback error: %s", e)

    return jsonify({"found": False, "message": "Nie udało się pobrać szczegółów pozycji."}), 404

# --- ALL DATA API ---
