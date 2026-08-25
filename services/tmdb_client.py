"""CineLog - wspólny klient API TMDb/OMDb.

Centralizuje budowanie zapytań, timeouty i formatowanie wyników,
które wcześniej były zdublowane w kilku endpointach.
"""

from __future__ import annotations

import json
import logging
import urllib.parse
import urllib.request

log = logging.getLogger("cinelog")

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG_POSTER = "https://image.tmdb.org/t/p/w500"
TMDB_IMG_BACKDROP = "https://image.tmdb.org/t/p/w780"
DEFAULT_TIMEOUT = 5


def tmdb_get(path: str, params: dict | None, api_key: str, timeout: int = DEFAULT_TIMEOUT) -> dict | None:
    """GET na TMDb. `params` to dict (bez api_key). Zwraca dict lub None przy błędzie."""
    query = dict(params or {})
    query["api_key"] = api_key
    url = f"{TMDB_BASE}{path}?{urllib.parse.urlencode(query)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception as e:
        log.warning("TMDb GET %s failed: %s", path, e)
        return None


def format_tmdb_summary(item: dict, media_type: str) -> dict:
    """Ujednolicony kształt wyniku TMDb (film/serial) dla frontendu."""
    t = item.get("title") or item.get("name") or "Nieznany tytuł"
    p_path = item.get("poster_path")
    b_path = item.get("backdrop_path")
    rel_date = item.get("release_date") or item.get("first_air_date") or ""
    year = rel_date[:4] if len(rel_date) >= 4 else ""
    return {
        "tmdb_id": item.get("id"),
        "title": t,
        "original_title": item.get("original_title") or item.get("original_name") or t,
        "poster_url": f"{TMDB_IMG_POSTER}{p_path}" if p_path else None,
        "backdrop_url": f"{TMDB_IMG_BACKDROP}{b_path}" if b_path else None,
        "release_date": rel_date,
        "year": year,
        "type": "series" if media_type in ("tv", "series") else "movie",
        "vote_average": round(float(item.get("vote_average", 0)), 1),
        "vote_count": item.get("vote_count", 0),
        "overview": item.get("overview") or "",
        "genre_ids": item.get("genre_ids", []),
    }
