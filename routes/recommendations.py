"""CineLog - trasy recommendations: recommendations.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import json
import logging
import urllib.request
import urllib.parse

from flask import Blueprint, jsonify, request

from flask.typing import ResponseReturnValue

import app as _app

from services import client_keys

log = logging.getLogger("cinelog")

bp = Blueprint("recommendations", __name__)

@bp.route("/api/recommendations/for_item", methods=["GET"])
def get_recommendations_for_item() -> ResponseReturnValue:
    media_type = request.args.get("media_type", "movie").strip().lower()
    tmdb_type = "tv" if media_type in ["tv", "series", "shows"] else "movie"
    tmdb_id = request.args.get("tmdb_id", "").strip()
    title = request.args.get("title", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY

    cache_key = f"rec_item_{tmdb_type}_{tmdb_id}_{title}_{lang}_{tmdb_key}"
    if cache_key in _app.RECOMMENDATIONS_CACHE:
        return jsonify(_app.RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        return jsonify({"status": "no_key", "message": "Klucz TMDb API nie został skonfigurowany. Dodaj klucz w oknie Chmura & Asystent AI -> Klucze API.", "results": []})

    # 1. If tmdb_id not provided, search by title first
    if not tmdb_id and title:
        try:
            url_search = f"https://api.themoviedb.org/3/search/{tmdb_type}?api_key={tmdb_key}&query={urllib.parse.quote(title)}&language={lang}"
            req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                sdata = json.loads(resp.read().decode("utf-8"))
                res = sdata.get("results", [])
                if res:
                    tmdb_id = str(res[0].get("id"))
        except Exception as e:
            log.warning("Error searching TMDb ID for rec title %s: %s", title, e)

    if not tmdb_id:
        return jsonify({"status": "error", "message": "Missing or unresolved TMDb ID", "results": []})

    results_list = []
    try:
        # Try /recommendations first
        url_rec = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}/recommendations?api_key={tmdb_key}&language={lang}&page=1"
        req = urllib.request.Request(url_rec, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            results_list = data.get("results", [])

        # Fallback to /similar if recommendations has fewer than 4 items
        if len(results_list) < 4:
            url_sim = f"https://api.themoviedb.org/3/{tmdb_type}/{tmdb_id}/similar?api_key={tmdb_key}&language={lang}&page=1"
            req_sim = urllib.request.Request(url_sim, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req_sim, timeout=5) as resp_sim:
                data_sim = json.loads(resp_sim.read().decode("utf-8"))
                for item in data_sim.get("results", []):
                    if not any(r.get("id") == item.get("id") for r in results_list):
                        results_list.append(item)
    except Exception as e:
        log.warning("Error fetching TMDb recommendations for %s %s: %s", tmdb_type, tmdb_id, e)

    formatted = [_app.format_tmdb_summary(it, tmdb_type) for it in results_list]

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    _app.RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@bp.route("/api/recommendations/discover", methods=["GET"])
def discover_recommendations() -> ResponseReturnValue:
    media_type = request.args.get("media_type", "movie").strip().lower()
    tmdb_type = "tv" if media_type in ["tv", "series", "shows"] else "movie"
    genres = request.args.get("genres", "").strip()
    sort_by = request.args.get("sort_by", "popularity.desc").strip()
    min_vote_avg = request.args.get("min_vote_avg", "6.8").strip()
    min_vote_count = request.args.get("min_vote_count", "100").strip()
    max_vote_count = request.args.get("max_vote_count", "").strip()
    with_crew = request.args.get("with_crew", "").strip()
    year_gte = request.args.get("year_gte", "").strip()
    year_lte = request.args.get("year_lte", "").strip()
    date_gte = request.args.get("date_gte", "").strip()
    date_lte = request.args.get("date_lte", "").strip()
    with_release_type = request.args.get("with_release_type", "").strip()
    watch_region = request.args.get("watch_region", "PL").strip().upper()
    with_watch_providers = request.args.get("with_watch_providers", "").strip()
    with_watch_monetization_types = request.args.get("with_watch_monetization_types", "flatrate|free|ads").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY

    cache_key = f"rec_discover_{tmdb_type}_{genres}_{sort_by}_{min_vote_avg}_{min_vote_count}_{max_vote_count}_{with_crew}_{year_gte}_{year_lte}_{date_gte}_{date_lte}_{with_release_type}_{with_watch_providers}_{watch_region}_{lang}_{tmdb_key}"
    if cache_key in _app.RECOMMENDATIONS_CACHE:
        return jsonify(_app.RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        return jsonify({"status": "no_key", "count": 0, "results": [], "message": "Brak klucza TMDb API. Skonfiguruj klucz w aplikacji."})

    url_discover = f"https://api.themoviedb.org/3/discover/{tmdb_type}?api_key={tmdb_key}&language={lang}&sort_by={sort_by}&vote_average.gte={min_vote_avg}&vote_count.gte={min_vote_count}&page=1"
    if with_watch_providers:
        url_discover += f"&with_watch_providers={urllib.parse.quote(with_watch_providers)}&watch_region={watch_region}&with_watch_monetization_types={urllib.parse.quote(with_watch_monetization_types)}"
    if max_vote_count:
        url_discover += f"&vote_count.lte={max_vote_count}"
    if with_crew:
        url_discover += f"&with_crew={urllib.parse.quote(with_crew)}"
    if genres:
        url_discover += f"&with_genres={urllib.parse.quote(genres)}"
    if date_gte:
        param_name = "first_air_date.gte" if tmdb_type == "tv" else "primary_release_date.gte"
        url_discover += f"&{param_name}={date_gte}"
    elif year_gte:
        param_name = "first_air_date.gte" if tmdb_type == "tv" else "primary_release_date.gte"
        url_discover += f"&{param_name}={year_gte}-01-01"
    if date_lte:
        param_name = "first_air_date.lte" if tmdb_type == "tv" else "primary_release_date.lte"
        url_discover += f"&{param_name}={date_lte}"
    elif year_lte:
        param_name = "first_air_date.lte" if tmdb_type == "tv" else "primary_release_date.lte"
        url_discover += f"&{param_name}={year_lte}-12-31"
    if with_release_type:
        url_discover += f"&with_release_type={urllib.parse.quote(with_release_type)}"

    formatted = []
    try:
        req = urllib.request.Request(url_discover, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            formatted = [_app.format_tmdb_summary(it, tmdb_type) for it in data.get("results", [])]
    except Exception as e:
        log.warning("Error in discover recommendations: %s", e)

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    _app.RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@bp.route("/api/recommendations/trending", methods=["GET"])
def get_trending_recommendations() -> ResponseReturnValue:
    media_type = request.args.get("media_type", "all").strip().lower()
    time_window = request.args.get("time_window", "week").strip().lower()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY

    cache_key = f"rec_trending_{media_type}_{time_window}_{lang}_{tmdb_key}"
    if cache_key in _app.RECOMMENDATIONS_CACHE:
        return jsonify(_app.RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        return jsonify({"status": "no_key", "count": 0, "results": [], "message": "Brak klucza TMDb API. Skonfiguruj klucz w aplikacji."})

    url_trending = f"https://api.themoviedb.org/3/trending/{media_type}/{time_window}?api_key={tmdb_key}&language={lang}"
    formatted = []
    try:
        req = urllib.request.Request(url_trending, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for it in data.get("results", []):
                m_type = it.get("media_type") or ("tv" if "name" in it else "movie")
                if m_type == "person":
                    continue
                formatted.append(_app.format_tmdb_summary(it, m_type))
    except Exception as e:
        log.warning("Error in trending recommendations: %s", e)

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    _app.RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@bp.route("/api/recommendations/person", methods=["GET"])
def get_person_recommendations() -> ResponseReturnValue:
    name = request.args.get("name", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY
    if not name:
        return jsonify({"status": "error", "message": "Missing name", "results": []})

    cache_key = f"rec_person_{name}_{lang}_{tmdb_key}"
    if cache_key in _app.RECOMMENDATIONS_CACHE:
        return jsonify(_app.RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        return jsonify({"status": "no_key", "count": 0, "results": [], "message": "Brak klucza TMDb API."})

    formatted = []
    try:
        # 1. Search person
        url_search = f"https://api.themoviedb.org/3/search/person?api_key={tmdb_key}&query={urllib.parse.quote(name)}&language={lang}"
        req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            sdata = json.loads(resp.read().decode("utf-8"))
            results = sdata.get("results", [])
            if results:
                person_id = results[0].get("id")
                person_name = results[0].get("name")
                known_for_dept = results[0].get("known_for_department", "Directing")

                # 2. Fetch credits
                url_credits = f"https://api.themoviedb.org/3/person/{person_id}/movie_credits?api_key={tmdb_key}&language={lang}"
                req_c = urllib.request.Request(url_credits, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req_c, timeout=4) as resp_c:
                    cdata = json.loads(resp_c.read().decode("utf-8"))
                    raw_items = cdata.get("crew", []) if known_for_dept == "Directing" else cdata.get("cast", [])
                    if not raw_items:
                        raw_items = cdata.get("cast", []) + cdata.get("crew", [])

                    # Filter directed movies if director
                    directed = [x for x in raw_items if x.get("job") == "Director"] or raw_items
                    # Sort by popularity / vote count
                    directed.sort(key=lambda x: (x.get("vote_count", 0) or 0), reverse=True)

                    for it in directed[:15]:
                        t = it.get("title") or it.get("name") or "Nieznany tytuł"
                        p_path = it.get("poster_path")
                        b_path = it.get("backdrop_path")
                        rel_date = it.get("release_date") or ""
                        year = rel_date[:4] if len(rel_date) >= 4 else ""
                        formatted.append({
                            "tmdb_id": it.get("id"),
                            "title": t,
                            "original_title": it.get("original_title") or t,
                            "poster_url": f"https://image.tmdb.org/t/p/w500{p_path}" if p_path else None,
                            "backdrop_url": f"https://image.tmdb.org/t/p/w780{b_path}" if b_path else None,
                            "release_date": rel_date,
                            "year": year,
                            "type": "movie",
                            "vote_average": round(float(it.get("vote_average", 0)), 1),
                            "vote_count": it.get("vote_count", 0),
                            "overview": it.get("overview") or "",
                            "genre_ids": it.get("genre_ids", []),
                            "person_name": person_name,
                            "job": it.get("job", "Twórca")
                        })
    except Exception as e:
        log.warning("Error fetching person recommendations for %s: %s", name, e)

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    _app.RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)

@bp.route("/api/actor/details", methods=["GET"])
def get_actor_details() -> ResponseReturnValue:
    person_id = request.args.get("id", "").strip()
    name = request.args.get("name", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = client_keys.tmdb_key() or _app.TMDB_API_KEY

    if not person_id and not name:
        return jsonify({"status": "error", "message": "Missing actor ID or name"}), 400

    cache_key = f"actor_det_{person_id}_{name}_{lang}_{tmdb_key}"
    if cache_key in _app.RECOMMENDATIONS_CACHE:
        return jsonify(_app.RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        fallback_res = {
            "status": "ok",
            "id": None,
            "name": name or "Twórca",
            "biography": "Skonfiguruj klucz TMDb API w aplikacji, aby pobrać pełny profil i biografię twórcy.",
            "birthday": None,
            "place_of_birth": None,
            "profile_url": None,
            "known_for": "Film / Serial",
            "credits": []
        }
        return jsonify(fallback_res)

    try:
        # If no numeric person_id, search for person by name
        if not person_id or not str(person_id).isdigit():
            url_search = f"https://api.themoviedb.org/3/search/person?api_key={tmdb_key}&query={urllib.parse.quote(name)}&language={lang}"
            try:
                with urllib.request.urlopen(urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"}), timeout=4) as r_s:
                    sdata = json.loads(r_s.read().decode("utf-8", errors="ignore"))
                    results = sdata.get("results", [])
                    if results:
                        person_id = str(results[0].get("id"))
            except Exception:
                pass

        if not person_id or not str(person_id).isdigit():
            fallback_res = {
                "status": "ok",
                "id": None,
                "name": name,
                "biography": "Twórca niezależny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).",
                "birthday": None,
                "deathday": None,
                "place_of_birth": None,
                "profile_url": None,
                "known_for_department": "Film",
                "filmography": []
            }
            _app.RECOMMENDATIONS_CACHE[cache_key] = fallback_res
            return jsonify(fallback_res)

        # Fetch person details & combined_credits
        url_person = f"https://api.themoviedb.org/3/person/{person_id}?api_key={tmdb_key}&language={lang}&append_to_response=combined_credits"
        with urllib.request.urlopen(urllib.request.Request(url_person, headers={"User-Agent": "Mozilla/5.0"}), timeout=5) as r_p:
            pdata = json.loads(r_p.read().decode("utf-8", errors="ignore"))

            # English bio fallback if localized bio is empty
            bio = pdata.get("biography") or ""
            if not bio and lang != "en-US":
                try:
                    url_en = f"https://api.themoviedb.org/3/person/{person_id}?api_key={tmdb_key}&language=en-US"
                    with urllib.request.urlopen(urllib.request.Request(url_en, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_en:
                        pdata_en = json.loads(r_en.read().decode("utf-8", errors="ignore"))
                        bio = pdata_en.get("biography", "")
                except Exception:
                    pass

            profile_path = pdata.get("profile_path")
            profile_url = f"https://image.tmdb.org/t/p/w300{profile_path}" if profile_path else None

            # Combined credits (Movies & TV Shows)
            comb = pdata.get("combined_credits") or {}
            cast_roles = comb.get("cast") or []
            crew_roles = comb.get("crew") or []
            all_roles = cast_roles + [c for c in crew_roles if c and c.get("job") == "Director"]

            # Deduplicate by id and sort by popularity / vote_count
            unique_credits = {}
            for item in all_roles:
                if not item:
                    continue
                item_id = item.get("id")
                media_type = item.get("media_type", "movie")
                key = f"{media_type}_{item_id}"
                if key not in unique_credits:
                    t = item.get("title") or item.get("name") or "Nieznany tytuł"
                    p_path = item.get("poster_path")
                    rel_date = item.get("release_date") or item.get("first_air_date") or ""
                    year = rel_date[:4] if len(rel_date) >= 4 else ""
                    unique_credits[key] = {
                        "tmdb_id": item_id,
                        "title": t,
                        "original_title": item.get("original_title") or item.get("original_name") or t,
                        "poster_url": f"https://image.tmdb.org/t/p/w342{p_path}" if p_path else None,
                        "release_date": rel_date,
                        "year": year,
                        "type": "series" if media_type == "tv" else "movie",
                        "character": item.get("character") or (item.get("job") if item.get("job") else ""),
                        "vote_average": round(float(item.get("vote_average", 0)), 1),
                        "vote_count": item.get("vote_count", 0),
                        "popularity": item.get("popularity", 0),
                        "overview": item.get("overview", "")
                    }

            sorted_credits = list(unique_credits.values())
            sorted_credits.sort(key=lambda x: (x.get("vote_count", 0) * 0.4 + x.get("popularity", 0) * 0.6), reverse=True)

            result = {
                "status": "ok",
                "id": pdata.get("id"),
                "name": pdata.get("name") or name,
                "biography": bio or "Brak biografii w wybranym języku.",
                "birthday": pdata.get("birthday"),
                "deathday": pdata.get("deathday"),
                "place_of_birth": pdata.get("place_of_birth"),
                "profile_url": profile_url,
                "known_for_department": pdata.get("known_for_department"),
                "filmography": sorted_credits
            }
            _app.RECOMMENDATIONS_CACHE[cache_key] = result
            return jsonify(result)
    except Exception as e:
        log.warning("Error fetching actor details for id=%s, name=%s: %s", person_id, name, e)
        return jsonify({
            "status": "ok",
            "id": person_id if (person_id and str(person_id).isdigit()) else None,
            "name": name or "Twórca",
            "biography": "Twórca niezależny / debiut (brak dodatkowego profilu biograficznego w globalnej bazie TMDb).",
            "birthday": None,
            "deathday": None,
            "place_of_birth": None,
            "profile_url": None,
            "known_for_department": "Film",
            "filmography": []
        })
