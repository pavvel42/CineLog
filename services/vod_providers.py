"""CineLog - cache dostawców VOD (TMDb / JustWatch) z TTL 7 dni.

Stan cache trzymany w pamięci procesu + persystencja w pliku JSON.
Ścieżka pliku przekazywana jawnie (umożliwia testy na izolowanych danych).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta

from .cache_utils import przytnij_cache
from .data_store import save_json
from .dopasowanie import wybierz_zgodny
from .tmdb_client import tmdb_get

log = logging.getLogger("cinelog")

CACHE_TTL_DAYS = 7
VOD_CACHE_MAX_ENTRIES = 500
_GOOGLE_PLAY_LOGO = "https://image.tmdb.org/t/p/original/8z7rC8uIDaTM91X0ZfkRf04ydj2.jpg"

_cache_state: dict = {"data": None}


def _empty_result(region: str) -> dict:
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
        "expires_at": (now + timedelta(days=CACHE_TTL_DAYS)).strftime("%Y-%m-%d %H:%M:%S"),
    }


def load_vod_cache(filepath: str) -> dict:
    if _cache_state["data"] is not None:
        return _cache_state["data"]
    data = {}
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            log.error("Error loading VOD cache: %s", e)
            data = {}
        # Migracja logo Google Play (legacy wpisy)
        for val in data.values():
            if isinstance(val, dict):
                for cat in ("flatrate", "rent", "buy", "free"):
                    for p in val.get(cat) or []:
                        if p.get("id") == 3 or p.get("name") in ("Google Play Movies", "Google Play"):
                            if not p.get("logo_url") or "/static/icons" in p.get("logo_url", ""):
                                p["logo_url"] = _GOOGLE_PLAY_LOGO
    _cache_state["data"] = data
    return data


def save_vod_cache(filepath: str, cache_data: dict) -> bool:
    """Zapisuje cache atomowo (`save_json`), po wyrzuceniu wygasłych wpisów i przycięciu do limitu."""
    przyciety = przytnij_cache(cache_data, VOD_CACHE_MAX_ENTRIES)
    _cache_state["data"] = przyciety
    return save_json(filepath, przyciety)


def reset_memory_cache() -> None:
    """Używane przez testy - wymusza ponowne wczytanie z pliku."""
    _cache_state["data"] = None


def fetch_live_watch_providers(clean_title: str, media_type: str, region: str,
                               tmdb_api_key: str, tmdb_id: str | None = None) -> dict:
    if not tmdb_api_key:
        return _empty_result(region)

    # 1. Search TMDb if tmdb_id not directly provided (tylko trafienie zgodne tytułem, bez zgadywania)
    if not tmdb_id:
        for lang in (f"{region.lower()}-{region}", "pl-PL", "en-US"):
            sdata = tmdb_get(
                f"/search/{media_type}",
                {"query": clean_title, "language": lang},
                api_key=tmdb_api_key,
                timeout=4,
            )
            trafienie = wybierz_zgodny((sdata or {}).get("results"), clean_title)
            if trafienie:
                tmdb_id = trafienie.get("id")
                break

    # Fallback to alternate media type if not found
    if not tmdb_id:
        alt_type = "tv" if media_type == "movie" else "movie"
        sdata = tmdb_get(
            f"/search/{alt_type}",
            {"query": clean_title, "language": "pl-PL"},
            api_key=tmdb_api_key,
            timeout=4,
        )
        trafienie = wybierz_zgodny((sdata or {}).get("results"), clean_title)
        if trafienie:
            tmdb_id = trafienie.get("id")
            media_type = alt_type

    if not tmdb_id:
        return _empty_result(region)

    # 2. Fetch watch providers from TMDb + JustWatch
    pdata = tmdb_get(f"/{media_type}/{tmdb_id}/watch/providers", {}, api_key=tmdb_api_key, timeout=4)
    if pdata is None:
        return _empty_result(region)

    reg_data = (pdata.get("results") or {}).get(region, {})

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
                "is_free": is_free,
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
        "expires_at": (now + timedelta(days=CACHE_TTL_DAYS)).strftime("%Y-%m-%d %H:%M:%S"),
    }
