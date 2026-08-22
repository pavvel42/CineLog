import os
import json
import uuid
import shutil
import urllib.request
import urllib.parse
import urllib.error
import re
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, render_template, jsonify, request, Response

# Auto-load .env file if present
def _load_env_file():
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    key = key.strip()
                    val = val.strip().strip("'\"")
                    if key and key not in os.environ:
                        os.environ[key] = val
        except Exception as e:
            print(f"Warning: Could not load .env file: {e}")

_load_env_file()

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "").strip()
if not TMDB_API_KEY:
    print("ℹ️ TMDB_API_KEY nie został ustawiony w .env ani w środowisku. Funkcje wyszukiwania online TMDb będą wyłączone lub ograniczone.")

app = Flask(__name__)

MOVIES_FILE = os.path.join("export data", "movies_parsed.json")
MOVIES_BACKUP_FILE = os.path.join("export data", "movies_backup.json")
SHOWS_FILE = os.path.join("export data", "shows_parsed.json")
SHOWS_BACKUP_FILE = os.path.join("export data", "shows_backup.json")
UPCOMING_CACHE_FILE = os.path.join("export data", "upcoming_cache.json")

EPISODES_CACHE = {}

def load_json(filepath):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading {filepath}: {e}")
        return []

def save_json(filepath, data):
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error saving {filepath}: {e}")
def normalize_title(t):
    if not t:
        return ""
    t = re.sub(r"\s*\(\d{4}\)", "", str(t))
    t = re.sub(r"[^\w\s]", "", t, flags=re.UNICODE)
    return " ".join(t.lower().split())

def deduplicate_items(items):
    seen = {}
    result = []
    for item in items:
        norm = normalize_title(item.get("title", ""))
        if not norm:
            result.append(item)
            continue
        if norm in seen:
            prev = seen[norm]
            if item.get("status") == "watched" and prev.get("status") != "watched":
                prev["status"] = "watched"
            if item.get("rating") is not None and prev.get("rating") is None:
                prev["rating"] = item.get("rating")
            if item.get("poster_url") and not prev.get("poster_url"):
                prev["poster_url"] = item.get("poster_url")
            if item.get("watch_date") and not prev.get("watch_date"):
                prev["watch_date"] = item.get("watch_date")
            if item.get("release_date") and not prev.get("release_date"):
                prev["release_date"] = item.get("release_date")
            if item.get("is_favorite"):
                prev["is_favorite"] = True
            if "episodes_watched" in item:
                prev_eps = prev.get("episodes_watched") or []
                prev_keys = {f"{e.get('season')}_{e.get('episode')}" for e in prev_eps}
                for ep in item.get("episodes_watched") or []:
                    k = f"{ep.get('season')}_{ep.get('episode')}"
                    if k not in prev_keys:
                        prev_eps.append(ep)
                        prev_keys.add(k)
                prev_eps.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))
                prev["episodes_watched"] = prev_eps
                prev["watched_count"] = len(prev_eps)
        else:
            seen[norm] = item
            result.append(item)
    return result

def load_movies():
    movies = load_json(MOVIES_FILE)
    deduped = deduplicate_items(movies)
    if len(deduped) != len(movies):
        save_json(MOVIES_FILE, deduped)
    return deduped

def save_movies(movies_list):
    return save_json(MOVIES_FILE, movies_list)

def load_shows():
    shows = load_json(SHOWS_FILE)
    deduped = deduplicate_items(shows)
    if len(deduped) != len(shows):
        save_json(SHOWS_FILE, deduped)
    return deduped

def save_shows(shows_list):
    return save_json(SHOWS_FILE, shows_list)

def fetch_online_metadata(title, media_type="movie", omdb_key=None):
    poster_url = None
    release_date = None
    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip()
    effective_omdb_key = omdb_key or os.environ.get("OMDB_API_KEY", "").strip() or os.environ.get("IMDB_API_KEY", "").strip()

    if effective_omdb_key:
        # 1. Try exact OMDb query
        url_omdb = f"https://www.omdbapi.com/?apikey={effective_omdb_key}&t={urllib.parse.quote(clean_title)}"
        if media_type == "series":
            url_omdb += "&type=series"
        try:
            req = urllib.request.Request(url_omdb, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                p = data.get("Poster")
                if p and p != "N/A":
                    poster_url = p
                released = data.get("Released")
                year = data.get("Year")
                if released and released != "N/A":
                    try:
                        dt = datetime.strptime(released, "%d %b %Y")
                        release_date = dt.strftime("%Y-%m-%d")
                    except Exception:
                        pass
                if not release_date and year and year[:4].isdigit():
                    release_date = f"{year[:4]}-01-01"
        except Exception:
            pass

        # 2. Try OMDb search query (Fuzzy Search Fallback)
        if not poster_url:
            url_omdb_search = f"https://www.omdbapi.com/?apikey={effective_omdb_key}&s={urllib.parse.quote(clean_title)}"
            if media_type == "series":
                url_omdb_search += "&type=series"
            try:
                req = urllib.request.Request(url_omdb_search, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    search_results = data.get("Search", [])
                    if search_results:
                        first = search_results[0]
                        p = first.get("Poster")
                        if p and p != "N/A":
                            poster_url = p
                        if not release_date and first.get("Year") and first.get("Year")[:4].isdigit():
                            release_date = f"{first['Year'][:4]}-01-01"
            except Exception:
                pass

    # 3. Try iTunes API if poster missing
    if not poster_url:
        countries = ["US", "PL", "GB"]
        itunes_media = "tvShow" if media_type == "series" else "movie"
        for c in countries:
            url_it = f"https://itunes.apple.com/search?term={urllib.parse.quote(clean_title)}&country={c}&media={itunes_media}&limit=3"
            try:
                req_it = urllib.request.Request(url_it, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req_it, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    results = data.get("results", [])
                    if results:
                        art = results[0].get("artworkUrl100")
                        if art:
                            poster_url = art.replace("100x100bb.jpg", "600x600bb.jpg")
                        if not release_date and results[0].get("releaseDate"):
                            release_date = results[0]["releaseDate"][:10]
                        break
            except Exception:
                pass

    return poster_url, release_date

@app.route("/")
@app.route("/m3")
def index():
    return render_template("index.html")

# --- MULTI-RESULT LIVE SEARCH API ---
@app.route("/api/search_preview", methods=["GET"])
def search_preview():
    title = request.args.get("q", "").strip()
    media_type = request.args.get("type", "movie").strip()
    lang = request.args.get("lang", "pl-PL").strip()

    if not title:
        return jsonify({"found": False, "message": "Podaj tytuł do wyszukania."}), 400

    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip()
    tmdb_type = "tv" if media_type == "series" else "movie"
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY
    omdb_key = request.args.get("omdb_key", "").strip() or os.environ.get("OMDB_API_KEY", "").strip()
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
            print("TMDb search preview error:", e)
        except Exception as e:
            print("TMDb search preview error:", e)

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
@app.route("/api/search_detail", methods=["GET"])
def search_detail():
    tmdb_id = request.args.get("tmdb_id", "").strip()
    imdb_id = request.args.get("id", "").strip()
    title = request.args.get("title", "").strip()
    year = request.args.get("year", "").strip()
    media_type = request.args.get("type", "movie").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    effective_tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY

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
            print("TMDb detail fetch error:", e)

    # 2. Fallback to OMDb / TVmaze
    effective_omdb_key = request.args.get("omdb_key", "").strip() or request.args.get("imdb_key", "").strip() or os.environ.get("OMDB_API_KEY", "").strip() or os.environ.get("IMDB_API_KEY", "").strip()
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
            print("OMDb detail fetch fallback error:", e)

    return jsonify({"found": False, "message": "Nie udało się pobrać szczegółów pozycji."}), 404

# --- ALL DATA API ---
@app.route("/api/data", methods=["GET"])
def get_all_data():
    return jsonify({
        "movies": load_movies(),
        "shows": load_shows()
    })

# --- MOVIES API ---
@app.route("/api/movies", methods=["GET"])
def get_movies():
    movies = load_movies()
    return jsonify(movies)

@app.route("/api/movies/<movie_uuid>", methods=["PUT"])
def update_movie(movie_uuid):
    data = request.get_json() or {}
    movies = load_movies()
    
    movie_to_update = None
    for m in movies:
        if m.get("uuid") == movie_uuid:
            movie_to_update = m
            break
            
    if not movie_to_update:
        return jsonify({"error": "Movie not found"}), 404
        
    if "title" in data and data["title"].strip():
        movie_to_update["title"] = data["title"].strip()
    if "status" in data and data["status"] in ["watched", "watchlist", "followed"]:
        movie_to_update["status"] = data["status"]
    if "is_favorite" in data:
        movie_to_update["is_favorite"] = bool(data["is_favorite"])
    if "rating" in data:
        rating = data["rating"]
        if rating is None or (isinstance(rating, int) and 1 <= rating <= 5):
            movie_to_update["rating"] = rating
    if "poster_url" in data:
        movie_to_update["poster_url"] = data["poster_url"]
    if "watch_date" in data:
        movie_to_update["watch_date"] = data["watch_date"]
    if "release_date" in data:
        movie_to_update["release_date"] = data["release_date"]
        
    if save_movies(movies):
        return jsonify(movie_to_update)
    else:
        return jsonify({"error": "Failed to save database"}), 500

@app.route("/api/movies/<movie_uuid>", methods=["DELETE"])
def delete_movie(movie_uuid):
    movies = load_movies()
    found_idx = -1
    for i, m in enumerate(movies):
        if m.get("uuid") == movie_uuid:
            found_idx = i
            break
            
    if found_idx == -1:
        return jsonify({"error": "Movie not found"}), 404
        
    deleted_movie = movies.pop(found_idx)
    if save_movies(movies):
        return jsonify({"success": True, "deleted": deleted_movie})
    else:
        return jsonify({"error": "Failed to save database"}), 500

@app.route("/api/movies/add", methods=["POST"])
@app.route("/api/movies", methods=["POST"])
def add_movie():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    
    if not title:
        return jsonify({"error": "Title is required"}), 400

    poster_url = data.get("poster_url")
    release_date = data.get("release_date")

    if not poster_url or not release_date:
        fetched_poster, fetched_date = fetch_online_metadata(title, "movie")
        if not poster_url and fetched_poster:
            poster_url = fetched_poster
        if not release_date and fetched_date:
            release_date = fetched_date
        
    movies = load_movies()
    status = data.get("status", "watchlist")
    rating = data.get("rating") or None
    if status == "watchlist":
        rating = None
    elif rating and not (1 <= rating <= 5):
        rating = None

    norm_title = normalize_title(title)
    tmdb_id = data.get("tmdb_id")
    existing_movie = next((m for m in movies if (tmdb_id and m.get("tmdb_id") and str(m.get("tmdb_id")) == str(tmdb_id)) or (normalize_title(m.get("title")) and normalize_title(m.get("title")) == norm_title)), None)
    
    if existing_movie:
        existing_movie["status"] = status
        if rating is not None:
            existing_movie["rating"] = rating
        elif status == "watchlist":
            existing_movie["rating"] = None
        if poster_url and (not existing_movie.get("poster_url") or "favicon" in existing_movie.get("poster_url", "")):
            existing_movie["poster_url"] = poster_url
        if release_date and not existing_movie.get("release_date"):
            existing_movie["release_date"] = release_date
        if status == "watched":
            if not existing_movie.get("watch_date"):
                existing_movie["watch_date"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if data.get("is_favorite") is not None:
            existing_movie["is_favorite"] = bool(data.get("is_favorite"))
        if save_movies(movies):
            return jsonify(existing_movie), 200
        return jsonify({"error": "Failed to save database"}), 500
    
    new_movie = {
        "uuid": str(uuid.uuid4()),
        "title": title,
        "status": status,
        "watch_date": data.get("watch_date") or (datetime.now().strftime("%Y-%m-%d %H:%M:%S") if status == "watched" else None),
        "follow_date": data.get("follow_date") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "release_date": release_date,
        "is_favorite": bool(data.get("is_favorite", False)),
        "rating": rating,
        "poster_url": poster_url,
        "raw_rating_suffix": None,
        "rewatched": int(data.get("rewatched", 0))
    }
        
    movies.insert(0, new_movie)
    
    if save_movies(movies):
        return jsonify(new_movie), 201
    else:
        return jsonify({"error": "Failed to save database"}), 500

# --- TV SHOWS API ---
@app.route("/api/shows", methods=["GET"])
def get_shows():
    shows = load_shows()
    return jsonify(shows)

@app.route("/api/shows/<show_uuid>", methods=["GET"])
def get_show_detail(show_uuid):
    shows = load_shows()
    for s in shows:
        if s.get("uuid") == show_uuid:
            return jsonify(s)
    return jsonify({"error": "Show not found"}), 404

@app.route("/api/shows/<show_uuid>/episodes_meta", methods=["GET"])
def get_show_episodes_meta(show_uuid):
    lang = request.args.get("lang", "pl-PL").strip()
    req_tmdb_id = request.args.get("tmdb_id", "").strip()
    shows = load_shows()
    target_show = None
    for s in shows:
        if s.get("uuid") == show_uuid:
            target_show = s
            break
    if not target_show:
        return jsonify({"error": "Show not found"}), 404

    effective_tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY
    show_id = req_tmdb_id or target_show.get("tmdb_id")
    title = target_show.get("title", "")
    cache_key = f"{show_uuid}_{show_id}_{lang}"
    if cache_key in EPISODES_CACHE:
        return jsonify(EPISODES_CACHE[cache_key])

    clean_t = re.sub(r"\s*\([^)]*\)", "", title).strip()
    meta = {}

    # 1. Primary: Fetch localized episode names & synopses from TMDb
    if effective_tmdb_key:
        try:
            if not show_id:
                url_search = f"https://api.themoviedb.org/3/search/tv?api_key={effective_tmdb_key}&query={urllib.parse.quote(clean_t)}&language={lang}"
                req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    s_data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    results = s_data.get("results", [])
                    if results:
                        def score(r):
                            pts = 0.0
                            rn = (r.get("name") or "").lower().strip()
                            ron = (r.get("original_name") or "").lower().strip()
                            ct = clean_t.lower()
                            if rn == ct or ron == ct:
                                pts += 100.0
                            return pts
                        results.sort(key=score, reverse=True)
                        show_id = results[0]["id"]

            if show_id:
                # Get show details to know season count
                url_det = f"https://api.themoviedb.org/3/tv/{show_id}?api_key={effective_tmdb_key}&language={lang}"
                with urllib.request.urlopen(urllib.request.Request(url_det, headers={"User-Agent": "Mozilla/5.0"}), timeout=4) as r_det:
                    det = json.loads(r_det.read().decode("utf-8", errors="ignore"))
                    seasons = det.get("seasons", [])
                    
                    for s in seasons:
                        s_num = s.get("season_number")
                        if s_num is None or s_num == 0:
                            continue
                        url_s = f"https://api.themoviedb.org/3/tv/{show_id}/season/{s_num}?api_key={effective_tmdb_key}&language={lang}"
                        try:
                            with urllib.request.urlopen(urllib.request.Request(url_s, headers={"User-Agent": "Mozilla/5.0"}), timeout=3) as r_s:
                                s_content = json.loads(r_s.read().decode("utf-8", errors="ignore"))
                                for ep in s_content.get("episodes", []):
                                    e_num = ep.get("episode_number")
                                    if e_num:
                                        key = f"{s_num}_{e_num}"
                                        still = f"https://image.tmdb.org/t/p/w300{ep.get('still_path')}" if ep.get("still_path") else None
                                        meta[key] = {
                                            "season": s_num,
                                            "episode": e_num,
                                            "name": ep.get("name") or f"Odcinek {e_num}",
                                            "airdate": ep.get("air_date"),
                                            "runtime": ep.get("runtime"),
                                            "summary": ep.get("overview", ""),
                                            "image": still
                                        }
                        except Exception:
                            pass
        except Exception as e:
            print(f"TMDb episode meta error for {title}:", e)

    # 2. Enrich with TVmaze (Fills split multi-part finales and missing descriptions)
    try:
        url_tvm = f"https://api.tvmaze.com/singlesearch/shows?q={urllib.parse.quote(clean_t)}&embed=episodes"
        req_tvm = urllib.request.Request(url_tvm, headers={"User-Agent": "CineLog/1.0"})
        with urllib.request.urlopen(req_tvm, timeout=4) as resp_tvm:
            data_tvm = json.loads(resp_tvm.read().decode("utf-8", errors="ignore"))
            eps_tvm = data_tvm.get("_embedded", {}).get("episodes", [])
            for e in eps_tvm:
                s_n = e.get("season")
                e_n = e.get("number")
                if s_n is None or e_n is None:
                    continue
                key = f"{s_n}_{e_n}"
                sum_txt = re.sub(r"<[^>]+>", "", e.get("summary") or "").strip()
                img_url = e.get("image", {}).get("medium") if e.get("image") else None

                if key not in meta:
                    meta[key] = {
                        "season": s_n,
                        "episode": e_n,
                        "name": e.get("name") or f"Odcinek {e_n}",
                        "airdate": e.get("airdate"),
                        "runtime": e.get("runtime"),
                        "summary": sum_txt,
                        "image": img_url or (meta.get(f"{s_n}_{e_n-1}", {}).get("image"))
                    }
                elif not meta[key].get("summary") and sum_txt:
                    meta[key]["summary"] = sum_txt
                if not meta[key].get("image") and img_url:
                    meta[key]["image"] = img_url
    except Exception:
        pass

    if meta:
        EPISODES_CACHE[cache_key] = meta
        return jsonify(meta)
    return jsonify({})

@app.route("/api/shows/<show_uuid>", methods=["PUT"])
def update_show(show_uuid):
    data = request.get_json() or {}
    shows = load_shows()
    
    show_to_update = None
    for s in shows:
        if s.get("uuid") == show_uuid:
            show_to_update = s
            break
            
    if not show_to_update:
        return jsonify({"error": "Show not found"}), 404

    if "title" in data and data["title"].strip():
        show_to_update["title"] = data["title"].strip()
    if "status" in data and data["status"] in ["watching", "watchlist", "archived"]:
        show_to_update["status"] = data["status"]
        show_to_update["archived"] = (data["status"] == "archived")
    if "rating" in data:
        rating = data["rating"]
        if rating is None or (isinstance(rating, int) and 1 <= rating <= 5):
            show_to_update["rating"] = rating
    if "poster_url" in data:
        show_to_update["poster_url"] = data["poster_url"]
    if "tmdb_id" in data:
        show_to_update["tmdb_id"] = data["tmdb_id"]
    if "release_date" in data:
        show_to_update["release_date"] = data["release_date"]
    if "is_favorite" in data:
        show_to_update["is_favorite"] = bool(data["is_favorite"])

    if save_shows(shows):
        return jsonify(show_to_update)
    else:
        return jsonify({"error": "Failed to save shows"}), 500

@app.route("/api/shows/<show_uuid>/episodes", methods=["POST"])
def toggle_episode(show_uuid):
    data = request.get_json() or {}
    season = int(data.get("season", 1))
    episode = int(data.get("episode", 1))
    
    shows = load_shows()
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

    if save_shows(shows):
        return jsonify(show_to_update)
    else:
        return jsonify({"error": "Failed to save episode"}), 500

@app.route("/api/shows/<show_uuid>/batch_episodes", methods=["POST"])
def batch_episodes(show_uuid):
    data = request.get_json() or {}
    items_to_add = data.get("episodes", [])
    
    shows = load_shows()
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
        s_num = int(item.get("season", 1))
        e_num = int(item.get("episode", 1))
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

    if save_shows(shows):
        return jsonify(show_to_update)
    else:
        return jsonify({"error": "Failed to save batch episodes"}), 500

@app.route("/api/shows/verify_completion", methods=["POST", "GET"])
def verify_shows_completion():
    shows = load_shows()
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
        save_shows(shows)
    return jsonify({
        "success": True, 
        "updated": updated_count, 
        "shows": shows
    })

@app.route("/api/shows/add", methods=["POST"])
@app.route("/api/shows", methods=["POST"])
def add_show():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    
    if not title:
        return jsonify({"error": "Title is required"}), 400

    poster_url = data.get("poster_url")
    if not poster_url:
        poster_url, _ = fetch_online_metadata(title, "series")
        
    shows = load_shows()
    
    watched_episodes = []
    
    # 1. Direct list of episodes passed from UI checkbox selector
    raw_watched_list = data.get("episodes_watched")
    if raw_watched_list and isinstance(raw_watched_list, list):
        for item in raw_watched_list:
            watched_episodes.append({
                "episode_id": str(uuid.uuid4()),
                "season": int(item.get("season", 1)),
                "episode": int(item.get("episode", 1)),
                "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
    else:
        # Fallback to up_to_season / up_to_episode
        up_to_season = int(data.get("up_to_season", 0))
        up_to_episode = int(data.get("up_to_episode", 0))
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
    elif rating and not (1 <= rating <= 5):
        rating = None
        
    norm_title = normalize_title(title)
    tmdb_id = data.get("tmdb_id")
    existing_show = next((s for s in shows if (tmdb_id and s.get("tmdb_id") and str(s.get("tmdb_id")) == str(tmdb_id)) or (normalize_title(s.get("title")) and normalize_title(s.get("title")) == norm_title)), None)
    
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
        if save_shows(shows):
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
    if save_shows(shows):
        return jsonify(new_show), 201
    else:
        return jsonify({"error": "Failed to save show"}), 500

@app.route("/api/shows/<show_uuid>", methods=["DELETE"])
def delete_show(show_uuid):
    shows = load_shows()
    found_idx = -1
    for i, s in enumerate(shows):
        if s.get("uuid") == show_uuid:
            found_idx = i
            break
            
    if found_idx == -1:
        return jsonify({"error": "Show not found"}), 404
        
    deleted_show = shows.pop(found_idx)
    if save_shows(shows):
        return jsonify({"success": True, "deleted": deleted_show})
    else:
        return jsonify({"error": "Failed to save database"}), 500

# --- VOD WATCH PROVIDERS WITH 7-DAY TTL SMART CACHE ---
from datetime import timedelta

VOD_CACHE_FILE = os.path.join("export data", "vod_cache.json")
VOD_CACHE_DATA = None

def load_vod_cache():
    global VOD_CACHE_DATA
    if VOD_CACHE_DATA is not None:
        return VOD_CACHE_DATA
    if os.path.exists(VOD_CACHE_FILE):
        try:
            with open(VOD_CACHE_FILE, "r", encoding="utf-8") as f:
                VOD_CACHE_DATA = json.load(f)
                for key, val in VOD_CACHE_DATA.items():
                    if isinstance(val, dict):
                        for cat in ("flatrate", "rent", "buy", "free"):
                            for p in val.get(cat) or []:
                                if p.get("id") == 3 or p.get("name") in ("Google Play Movies", "Google Play"):
                                    if not p.get("logo_url") or "/static/icons" in p.get("logo_url", ""):
                                        p["logo_url"] = "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg"
                return VOD_CACHE_DATA
        except Exception as e:
            print(f"Error loading VOD cache: {e}")
    VOD_CACHE_DATA = {}
    return VOD_CACHE_DATA

def save_vod_cache(cache_data):
    global VOD_CACHE_DATA
    VOD_CACHE_DATA = cache_data
    try:
        os.makedirs(os.path.dirname(VOD_CACHE_FILE), exist_ok=True)
        with open(VOD_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache_data, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"Error saving VOD cache: {e}")
        return False

def fetch_live_watch_providers(clean_title, media_type, region, tmdb_id=None):
    if not TMDB_API_KEY:
        now = datetime.now()
        return {
            "found": False,
            "region": region,
            "flatrate": [],
            "rent": [],
            "buy": [],
            "free": [],
            "link": None,
            "updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            "expires_at": (now + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        }

    # 1. Search TMDb if tmdb_id not directly provided
    if not tmdb_id:
        try:
            for lang in [f"{region.lower()}-{region}", "pl-PL", "en-US"]:
                url_search = f"https://api.themoviedb.org/3/search/{media_type}?api_key={TMDB_API_KEY}&query={urllib.parse.quote(clean_title)}&language={lang}"
                req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=4) as resp:
                    sdata = json.loads(resp.read().decode("utf-8"))
                    results = sdata.get("results", [])
                    if results:
                        # Rank by exact title/original_title match + popularity
                        def score(r):
                            t = (r.get("title") or r.get("name") or "").strip().lower()
                            ot = (r.get("original_title") or r.get("original_name") or "").strip().lower()
                            exact = 1 if (t == clean_title or ot == clean_title) else 0
                            pop = float(r.get("popularity") or 0)
                            return (exact * 1000) + pop
                        best = max(results, key=score)
                        tmdb_id = best.get("id")
                        break
        except Exception as e:
            print(f"Error searching TMDb for {clean_title}: {e}")

    # Fallback to alternate media type if not found
    if not tmdb_id:
        alt_type = "tv" if media_type == "movie" else "movie"
        try:
            url_search = f"https://api.themoviedb.org/3/search/{alt_type}?api_key={TMDB_API_KEY}&query={urllib.parse.quote(clean_title)}&language=pl-PL"
            req = urllib.request.Request(url_search, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                sdata = json.loads(resp.read().decode("utf-8"))
                results = sdata.get("results", [])
                if results:
                    best = max(results, key=lambda r: float(r.get("popularity") or 0))
                    tmdb_id = best.get("id")
                    media_type = alt_type
        except Exception:
            pass

    if not tmdb_id:
        now = datetime.now()
        return {
            "found": False,
            "region": region,
            "flatrate": [],
            "rent": [],
            "buy": [],
            "free": [],
            "link": None,
            "updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            "expires_at": (now + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        }

    # 2. Fetch watch providers from TMDb + JustWatch
    try:
        url_providers = f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}/watch/providers?api_key={TMDB_API_KEY}"
        req = urllib.request.Request(url_providers, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            pdata = json.loads(resp.read().decode("utf-8"))
            all_regions = pdata.get("results", {})
            reg_data = all_regions.get(region, {})

            def format_providers(items, is_free=False):
                formatted = []
                for p in items or []:
                    pname = p.get("provider_name", "")
                    if pname == "TVP":
                        pname = "TVP VOD"
                    logo = p.get("logo_path")
                    logo_url = f"https://image.tmdb.org/t/p/original{logo}" if logo else None
                    if pname == "Google Play Movies":
                        pname = "Google Play / YouTube Filmy"
                    formatted.append({
                        "id": p.get("provider_id"),
                        "name": pname,
                        "logo_url": logo_url,
                        "is_free": is_free
                    })
                return formatted

            now = datetime.now()
            free_and_ads = (reg_data.get("free") or []) + (reg_data.get("ads") or [])
            seen_ids = set()
            unique_free = []
            for item in free_and_ads:
                pid = item.get("provider_id")
                if pid not in seen_ids:
                    seen_ids.add(pid)
                    unique_free.append(item)

            return {
                "found": True,
                "tmdb_id": tmdb_id,
                "region": region,
                "flatrate": format_providers(reg_data.get("flatrate")),
                "rent": format_providers(reg_data.get("rent")),
                "buy": format_providers(reg_data.get("buy")),
                "free": format_providers(unique_free, is_free=True),
                "link": reg_data.get("link"),
                "updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                "expires_at": (now + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
            }
    except Exception as e:
        print(f"Error fetching watch providers for TMDb {tmdb_id}: {e}")
        now = datetime.now()
        return {
            "found": False,
            "region": region,
            "flatrate": [],
            "rent": [],
            "buy": [],
            "free": [],
            "link": None,
            "updated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
            "expires_at": (now + timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
        }

@app.route("/api/watch_providers", methods=["GET"])
def get_watch_providers():
    title = request.args.get("title", "").strip()
    media_type = request.args.get("type", "movie").strip().lower()
    region = request.args.get("region", "PL").strip().upper()
    tmdb_id = request.args.get("tmdb_id", "").strip()
    
    if media_type == "series":
        media_type = "tv"
    
    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip().lower()
    cache_key = f"{media_type}_{region}_{clean_title}"
    
    cache = load_vod_cache()
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
    fresh_data = fetch_live_watch_providers(clean_title, media_type, region, tmdb_id=tmdb_id if tmdb_id else None)
    if fresh_data.get("found") or not cached_entry:
        cache[cache_key] = fresh_data
        save_vod_cache(cache)
    return jsonify(fresh_data)

@app.route("/api/vod_cache_all", methods=["GET"])
def get_all_vod_cache():
    region = request.args.get("region", "PL").strip().upper()
    cache = load_vod_cache()
    prefix = f"_{region}_"
    
    # Filter for active region
    region_cache = {}
    for key, val in cache.items():
        if f"_{region}_" in key:
            region_cache[key] = val
            
    return jsonify(region_cache)

@app.route("/api/vod_precache", methods=["POST"])
def precache_vod_batch():
    data = request.json or {}
    items = data.get("items", []) # [{"title": "Inception", "type": "movie"}]
    region = data.get("region", "PL").strip().upper()
    
    cache = load_vod_cache()
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
            res = fetch_live_watch_providers(clean_t, m_type, region)
            cache[k] = res
            updated_count += 1

    if updated_count:
        save_vod_cache(cache)

    return jsonify({"status": "ok", "updated": updated_count, "total": len(items)})

# --- UPCOMING & RELEASE RADAR API ---
@app.route("/api/upcoming", methods=["GET"])
def get_upcoming_schedule():
    force_refresh = request.args.get("refresh") == "1"
    effective_tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY
    movies = load_movies()
    shows = load_shows()
    
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
    if os.path.exists(UPCOMING_CACHE_FILE):
        try:
            with open(UPCOMING_CACHE_FILE, "r", encoding="utf-8") as f:
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
        except Exception as e:
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
            os.makedirs(os.path.dirname(UPCOMING_CACHE_FILE), exist_ok=True)
            with open(UPCOMING_CACHE_FILE, "w", encoding="utf-8") as f:
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
@app.route("/api/export", methods=["GET"])
def export_data():
    movies = load_movies()
    shows = load_shows()
    export_payload = {
        "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "movies": movies,
        "shows": shows
    }
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    filename = f"cinelog_export_{timestamp}.json"
    json_data = json.dumps(export_payload, ensure_ascii=False, indent=2)
    return Response(
        json_data,
        mimetype="application/json",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.route("/api/movies/reset", methods=["POST"])
@app.route("/api/reset", methods=["POST"])
def reset_all():
    if os.path.exists(MOVIES_BACKUP_FILE):
        shutil.copy(MOVIES_BACKUP_FILE, MOVIES_FILE)
    if os.path.exists(SHOWS_BACKUP_FILE):
        shutil.copy(SHOWS_BACKUP_FILE, SHOWS_FILE)
    return jsonify({"status": "reset_complete"})

# --- API KEYS VERIFICATION ---
@app.route("/api/keys/test", methods=["POST"])
def test_api_keys():
    data = request.get_json(silent=True) or {}
    tmdb_key = data.get("tmdb_key", "").strip() or TMDB_API_KEY
    omdb_key = data.get("omdb_key", "").strip() or os.environ.get("OMDB_API_KEY", "").strip()
    
    results = {
        "tmdb": {"ok": False, "message": "Nie podano klucza TMDb"},
        "omdb": {"ok": False, "message": "Nie podano klucza OMDb"}
    }
    
    if tmdb_key:
        try:
            url = f"https://api.themoviedb.org/3/authentication?api_key={tmdb_key}"
            req = urllib.request.Request(url, headers={"User-Agent": "CineLog/1.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    results["tmdb"] = {"ok": True, "message": "Połączono pomyślnie z TMDb API (v3)"}
        except Exception as e:
            results["tmdb"] = {"ok": False, "message": f"Błąd TMDb: {str(e)}"}
            
    if omdb_key:
        try:
            url = f"https://www.omdbapi.com/?apikey={omdb_key}&s=Inception"
            req = urllib.request.Request(url, headers={"User-Agent": "CineLog/1.0"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                odata = json.loads(resp.read().decode("utf-8", errors="ignore"))
                if odata.get("Response") == "True":
                    results["omdb"] = {"ok": True, "message": "Połączono pomyślnie z OMDb (IMDb data)"}
                else:
                    results["omdb"] = {"ok": False, "message": odata.get("Error", "Błąd klucza OMDb")}
        except Exception as e:
            results["omdb"] = {"ok": False, "message": f"Błąd OMDb: {str(e)}"}
            
    return jsonify(results)

# --- RECOMMENDATIONS & DISCOVERY API (TMDB POWERED) ---
RECOMMENDATIONS_CACHE = {}

@app.route("/api/recommendations/for_item", methods=["GET"])
def get_recommendations_for_item():
    media_type = request.args.get("media_type", "movie").strip().lower()
    tmdb_type = "tv" if media_type in ["tv", "series", "shows"] else "movie"
    tmdb_id = request.args.get("tmdb_id", "").strip()
    title = request.args.get("title", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY

    cache_key = f"rec_item_{tmdb_type}_{tmdb_id}_{title}_{lang}_{tmdb_key}"
    if cache_key in RECOMMENDATIONS_CACHE:
        return jsonify(RECOMMENDATIONS_CACHE[cache_key])

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
            print(f"Error searching TMDb ID for rec title {title}: {e}")

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
        print(f"Error fetching TMDb recommendations for {tmdb_type} {tmdb_id}: {e}")

    formatted = []
    for it in results_list:
        t = it.get("title") or it.get("name") or "Nieznany tytuł"
        p_path = it.get("poster_path")
        b_path = it.get("backdrop_path")
        rel_date = it.get("release_date") or it.get("first_air_date") or ""
        year = rel_date[:4] if len(rel_date) >= 4 else ""
        formatted.append({
            "tmdb_id": it.get("id"),
            "title": t,
            "original_title": it.get("original_title") or it.get("original_name") or t,
            "poster_url": f"https://image.tmdb.org/t/p/w500{p_path}" if p_path else None,
            "backdrop_url": f"https://image.tmdb.org/t/p/w780{b_path}" if b_path else None,
            "release_date": rel_date,
            "year": year,
            "type": "series" if tmdb_type == "tv" else "movie",
            "vote_average": round(float(it.get("vote_average", 0)), 1),
            "vote_count": it.get("vote_count", 0),
            "overview": it.get("overview") or "",
            "genre_ids": it.get("genre_ids", [])
        })

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@app.route("/api/recommendations/discover", methods=["GET"])
def discover_recommendations():
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
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY

    cache_key = f"rec_discover_{tmdb_type}_{genres}_{sort_by}_{min_vote_avg}_{min_vote_count}_{max_vote_count}_{with_crew}_{year_gte}_{year_lte}_{date_gte}_{date_lte}_{with_release_type}_{with_watch_providers}_{watch_region}_{lang}_{tmdb_key}"
    if cache_key in RECOMMENDATIONS_CACHE:
        return jsonify(RECOMMENDATIONS_CACHE[cache_key])

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
            for it in data.get("results", []):
                t = it.get("title") or it.get("name") or "Nieznany tytuł"
                p_path = it.get("poster_path")
                b_path = it.get("backdrop_path")
                rel_date = it.get("release_date") or it.get("first_air_date") or ""
                year = rel_date[:4] if len(rel_date) >= 4 else ""
                formatted.append({
                    "tmdb_id": it.get("id"),
                    "title": t,
                    "original_title": it.get("original_title") or it.get("original_name") or t,
                    "poster_url": f"https://image.tmdb.org/t/p/w500{p_path}" if p_path else None,
                    "backdrop_url": f"https://image.tmdb.org/t/p/w780{b_path}" if b_path else None,
                    "release_date": rel_date,
                    "year": year,
                    "type": "series" if tmdb_type == "tv" else "movie",
                    "vote_average": round(float(it.get("vote_average", 0)), 1),
                    "vote_count": it.get("vote_count", 0),
                    "overview": it.get("overview") or "",
                    "genre_ids": it.get("genre_ids", [])
                })
    except Exception as e:
        print(f"Error in discover recommendations: {e}")

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@app.route("/api/recommendations/trending", methods=["GET"])
def get_trending_recommendations():
    media_type = request.args.get("media_type", "all").strip().lower()
    time_window = request.args.get("time_window", "week").strip().lower()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY

    cache_key = f"rec_trending_{media_type}_{time_window}_{lang}_{tmdb_key}"
    if cache_key in RECOMMENDATIONS_CACHE:
        return jsonify(RECOMMENDATIONS_CACHE[cache_key])

    if not tmdb_key:
        return jsonify({"status": "no_key", "count": 0, "results": [], "message": "Brak klucza TMDb API. Skonfiguruj klucz w aplikacji."})

    url_trending = f"https://api.themoviedb.org/3/trending/{media_type}/{time_window}?api_key={tmdb_key}&language={lang}"
    formatted = []
    try:
        req = urllib.request.Request(url_trending, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for it in data.get("results", []):
                t = it.get("title") or it.get("name") or "Nieznany tytuł"
                m_type = it.get("media_type") or ("tv" if "name" in it else "movie")
                if m_type == "person":
                    continue
                p_path = it.get("poster_path")
                b_path = it.get("backdrop_path")
                rel_date = it.get("release_date") or it.get("first_air_date") or ""
                year = rel_date[:4] if len(rel_date) >= 4 else ""
                formatted.append({
                    "tmdb_id": it.get("id"),
                    "title": t,
                    "original_title": it.get("original_title") or it.get("original_name") or t,
                    "poster_url": f"https://image.tmdb.org/t/p/w500{p_path}" if p_path else None,
                    "backdrop_url": f"https://image.tmdb.org/t/p/w780{b_path}" if b_path else None,
                    "release_date": rel_date,
                    "year": year,
                    "type": "series" if m_type in ["tv", "series"] else "movie",
                    "vote_average": round(float(it.get("vote_average", 0)), 1),
                    "vote_count": it.get("vote_count", 0),
                    "overview": it.get("overview") or "",
                    "genre_ids": it.get("genre_ids", [])
                })
    except Exception as e:
        print(f"Error in trending recommendations: {e}")

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)


@app.route("/api/recommendations/person", methods=["GET"])
def get_person_recommendations():
    name = request.args.get("name", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY
    if not name:
        return jsonify({"status": "error", "message": "Missing name", "results": []})

    cache_key = f"rec_person_{name}_{lang}_{tmdb_key}"
    if cache_key in RECOMMENDATIONS_CACHE:
        return jsonify(RECOMMENDATIONS_CACHE[cache_key])

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
        print(f"Error fetching person recommendations for {name}: {e}")

    response_data = {"status": "ok", "count": len(formatted), "results": formatted}
    RECOMMENDATIONS_CACHE[cache_key] = response_data
    return jsonify(response_data)

@app.route("/api/actor/details", methods=["GET"])
def get_actor_details():
    person_id = request.args.get("id", "").strip()
    name = request.args.get("name", "").strip()
    lang = request.args.get("lang", "pl-PL").strip()
    tmdb_key = request.args.get("tmdb_key", "").strip() or TMDB_API_KEY

    if not person_id and not name:
        return jsonify({"status": "error", "message": "Missing actor ID or name"}), 400

    cache_key = f"actor_det_{person_id}_{name}_{lang}_{tmdb_key}"
    if cache_key in RECOMMENDATIONS_CACHE:
        return jsonify(RECOMMENDATIONS_CACHE[cache_key])

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
            RECOMMENDATIONS_CACHE[cache_key] = fallback_res
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
            RECOMMENDATIONS_CACHE[cache_key] = result
            return jsonify(result)
    except Exception as e:
        print(f"Error fetching actor details for id={person_id}, name={name}: {e}")
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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode, port=port)
