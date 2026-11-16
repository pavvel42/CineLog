"""CineLog - trasy movies: movies.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import uuid
import logging
from datetime import datetime

from flask import Blueprint, jsonify

from flask.typing import ResponseReturnValue

import app as _app

from routes._http import json_object
from services import client_keys
from services.data_store import find_same_item
from services.validation import (
    optional_text,
    optional_year,
    parse_status,
    parse_tmdb_id,
    require_title,
    safe_poster_url,
)

log = logging.getLogger("cinelog")

bp = Blueprint("movies", __name__)

@bp.route("/api/movies", methods=["GET"])
def get_movies() -> ResponseReturnValue:
    movies = _app.load_movies()
    return jsonify(movies)

@bp.route("/api/movies/<movie_uuid>", methods=["PUT"])
def update_movie(movie_uuid: str) -> ResponseReturnValue:
    data = json_object()
    # Walidacja przed jakimkolwiek zapisem: niepoprawne pole = 400 i żadna część żądania nie trafia do bazy.
    new_title = require_title(data["title"]) if "title" in data else None
    new_status = parse_status(data["status"]) if "status" in data else None
    new_tmdb_id = parse_tmdb_id(data["tmdb_id"]) if "tmdb_id" in data else None
    with _app.DATA_LOCK:
        movies = _app.load_movies()

        movie_to_update = None
        for m in movies:
            if m.get("uuid") == movie_uuid:
                movie_to_update = m
                break

        if not movie_to_update:
            return jsonify({"error": "Movie not found"}), 404

        if new_title is not None:
            movie_to_update["title"] = new_title
        if new_status is not None:
            movie_to_update["status"] = new_status
        if new_tmdb_id is not None:
            movie_to_update["tmdb_id"] = new_tmdb_id
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
def delete_movie(movie_uuid: str) -> ResponseReturnValue:
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
def add_movie() -> ResponseReturnValue:
    data = json_object()
    title = require_title(data.get("title"))
    status = parse_status(data["status"]) if "status" in data else "watchlist"
    tmdb_id = _app.normalize_tmdb_id(data.get("tmdb_id"))
    year = optional_year(data.get("year"))

    poster_url = safe_poster_url(data.get("poster_url"))
    release_date = optional_text(data.get("release_date"))

    if not poster_url or not release_date:
        fetched_poster, fetched_date = _app.fetch_online_metadata(
            title, "movie", client_keys.omdb_key()
        )
        if not poster_url and fetched_poster:
            poster_url = fetched_poster
        if not release_date and fetched_date:
            release_date = fetched_date

    rating = data.get("rating") or None
    if status == "watchlist":
        rating = None
    elif not (isinstance(rating, int) and not isinstance(rating, bool) and 1 <= rating <= 5):
        rating = None

    with _app.DATA_LOCK:
        movies = _app.load_movies()
        existing_movie = find_same_item(movies, {"title": title, "tmdb_id": tmdb_id, "year": year})

        if existing_movie:
            # Plakat, tmdb_id i data premiery to dane uzupełniane zawsze, o ile brakuje ich we wpisie.
            if poster_url and (not existing_movie.get("poster_url") or "favicon" in existing_movie.get("poster_url", "")):
                existing_movie["poster_url"] = poster_url
            if tmdb_id and not existing_movie.get("tmdb_id"):
                existing_movie["tmdb_id"] = tmdb_id
            if release_date and not existing_movie.get("release_date"):
                existing_movie["release_date"] = release_date
            if status == "watchlist":
                # Szybkie „+ Do obejrzenia” na pozycji, która już jest w bibliotece, niczego
                # nie cofa: status, ocena i daty zostają (wcześniej kasowało ocenę).
                if _app.save_movies(movies):
                    return jsonify({**existing_movie, "already_exists": True}), 200
                return jsonify({"error": "Failed to save database"}), 500
            existing_movie["status"] = status
            if rating is not None:
                existing_movie["rating"] = rating
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
            "tmdb_id": tmdb_id,
            "rewatched": _app._safe_int(data.get("rewatched", 0))
        }
        if year:
            new_movie["year"] = year

        movies.insert(0, new_movie)

        if _app.save_movies(movies):
            return jsonify(new_movie), 201
        else:
            return jsonify({"error": "Failed to save database"}), 500

# --- TV SHOWS API ---
