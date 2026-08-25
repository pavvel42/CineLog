"""CineLog - trasy movies: movies.

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

bp = Blueprint("movies", __name__)

@bp.route("/api/movies", methods=["GET"])
def get_movies():
    movies = _app.load_movies()
    return jsonify(movies)

@bp.route("/api/movies/<movie_uuid>", methods=["PUT"])
def update_movie(movie_uuid):
    data = request.get_json() or {}
    with _app.DATA_LOCK:
        movies = _app.load_movies()

        movie_to_update = None
        for m in movies:
            if m.get("uuid") == movie_uuid:
                movie_to_update = m
                break

        if not movie_to_update:
            return jsonify({"error": "Movie not found"}), 404

        if "title" in data and isinstance(data["title"], str) and data["title"].strip():
            movie_to_update["title"] = data["title"].strip()
        if "status" in data and data["status"] in ["watched", "watchlist", "followed"]:
            movie_to_update["status"] = data["status"]
        if "is_favorite" in data:
            movie_to_update["is_favorite"] = bool(data["is_favorite"])
        if "rating" in data:
            rating = data["rating"]
            if rating is None or (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
                movie_to_update["rating"] = rating
        if "poster_url" in data and _app._is_safe_media_url(data["poster_url"]):
            movie_to_update["poster_url"] = data["poster_url"]
        if "watch_date" in data:
            movie_to_update["watch_date"] = data["watch_date"]
        if "release_date" in data:
            movie_to_update["release_date"] = data["release_date"]

        if _app.save_movies(movies):
            return jsonify(movie_to_update)
        else:
            return jsonify({"error": "Failed to save database"}), 500

@bp.route("/api/movies/<movie_uuid>", methods=["DELETE"])
def delete_movie(movie_uuid):
    with _app.DATA_LOCK:
        movies = _app.load_movies()
        found_idx = -1
        for i, m in enumerate(movies):
            if m.get("uuid") == movie_uuid:
                found_idx = i
                break

        if found_idx == -1:
            return jsonify({"error": "Movie not found"}), 404

        deleted_movie = movies.pop(found_idx)
        if _app.save_movies(movies):
            return jsonify({"success": True, "deleted": deleted_movie})
        else:
            return jsonify({"error": "Failed to save database"}), 500

@bp.route("/api/movies/add", methods=["POST"])
@bp.route("/api/movies", methods=["POST"])
def add_movie():
    data = request.get_json() or {}
    title = data.get("title", "").strip()
    
    if not title:
        return jsonify({"error": "Title is required"}), 400

    poster_url = data.get("poster_url")
    release_date = data.get("release_date")

    if not poster_url or not release_date:
        fetched_poster, fetched_date = _app.fetch_online_metadata(title, "movie")
        if not poster_url and fetched_poster:
            poster_url = fetched_poster
        if not release_date and fetched_date:
            release_date = fetched_date

    status = data.get("status", "watchlist")
    rating = data.get("rating") or None
    if status == "watchlist":
        rating = None
    elif not (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
        rating = None

    with _app.DATA_LOCK:
        movies = _app.load_movies()
        norm_title = _app.normalize_title(title)
        tmdb_id = data.get("tmdb_id")
        existing_movie = next((m for m in movies if (tmdb_id and m.get("tmdb_id") and str(m.get("tmdb_id")) == str(tmdb_id)) or (_app.normalize_title(m.get("title")) and _app.normalize_title(m.get("title")) == norm_title)), None)

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
            if _app.save_movies(movies):
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
            "rewatched": _app._safe_int(data.get("rewatched", 0))
        }

        movies.insert(0, new_movie)

        if _app.save_movies(movies):
            return jsonify(new_movie), 201
        else:
            return jsonify({"error": "Failed to save database"}), 500

# --- TV SHOWS API ---
