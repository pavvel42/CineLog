"""CineLog - pobieranie metadanych online (plakat, data premiery).

Fallback chain: OMDb (exact -> search) -> iTunes Store.
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime

log = logging.getLogger("cinelog")


def _omdb_exact(clean_title: str, media_type: str, api_key: str) -> dict | None:
    url = f"https://www.omdbapi.com/?apikey={api_key}&t={urllib.parse.quote(clean_title)}"
    if media_type == "series":
        url += "&type=series"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read().decode("utf-8", errors="ignore"))
    except Exception:
        return None


def _omdb_search_first(clean_title: str, media_type: str, api_key: str) -> dict | None:
    url = f"https://www.omdbapi.com/?apikey={api_key}&s={urllib.parse.quote(clean_title)}"
    if media_type == "series":
        url += "&type=series"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            results = data.get("Search") or []
            return results[0] if results else None
    except Exception:
        return None


def _itunes_lookup(clean_title: str, media_type: str) -> dict | None:
    itunes_media = "tvShow" if media_type == "series" else "movie"
    for country in ("US", "PL", "GB"):
        url = (
            f"https://itunes.apple.com/search?term={urllib.parse.quote(clean_title)}"
            f"&country={country}&media={itunes_media}&limit=3"
        )
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                results = data.get("results") or []
                if results:
                    return results[0]
        except Exception:
            continue
    return None


def fetch_online_metadata(title: str, media_type: str = "movie", omdb_key: str | None = None) -> tuple[str | None, str | None]:
    """Zwraca (poster_url, release_date) dla tytułu; elementy mogą być None."""
    poster_url = None
    release_date = None
    clean_title = re.sub(r"\s*\([^)]*\)", "", title).strip()
    effective_omdb_key = (
        omdb_key
        or os.environ.get("OMDB_API_KEY", "").strip()
        or os.environ.get("IMDB_API_KEY", "").strip()
    )

    if effective_omdb_key:
        data = _omdb_exact(clean_title, media_type, effective_omdb_key)
        if data:
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
            if not release_date and year and str(year)[:4].isdigit():
                release_date = f"{str(year)[:4]}-01-01"

        if not poster_url:
            first = _omdb_search_first(clean_title, media_type, effective_omdb_key)
            if first:
                p = first.get("Poster")
                if p and p != "N/A":
                    poster_url = p
                if not release_date and first.get("Year") and str(first["Year"])[:4].isdigit():
                    release_date = f"{first['Year'][:4]}-01-01"

    if not poster_url:
        it = _itunes_lookup(clean_title, media_type)
        if it:
            art = it.get("artworkUrl100")
            if art:
                poster_url = art.replace("100x100bb.jpg", "600x600bb.jpg")
            if not release_date and it.get("releaseDate"):
                release_date = it["releaseDate"][:10]

    return poster_url, release_date
