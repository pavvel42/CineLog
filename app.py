"""CineLog - kompozycja aplikacji Flask.

Ten moduł jest pojedynczym źródłem prawdy dla konfiguracji, stałych plików,
cache'i i akcesorów biblioteki. Moduły tras (routes/*.py) czytają je przez
późne wiązanie (`import app as _app`), dzięki czemu testy mogą je podmieniać
przez monkeypatch na module `app`. Uruchamianie serwera: python run.py
"""

from __future__ import annotations

import os
import logging

from flask import Flask

from services.data_store import (
    DATA_LOCK,
    deduplicate_items,
    load_json,
    save_json,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("cinelog")

__all__ = [
    "app",
    "TMDB_API_KEY",
    "DATA_DIR", "MOVIES_FILE", "MOVIES_BACKUP_FILE",
    "SHOWS_FILE", "SHOWS_BACKUP_FILE", "UPCOMING_CACHE_FILE", "VOD_CACHE_FILE",
    "EPISODES_CACHE", "RECOMMENDATIONS_CACHE", "DATA_LOCK",
    "load_movies", "save_movies", "load_shows", "save_shows",
    "load_vod_cache", "save_vod_cache", "fetch_live_watch_providers",
    "format_tmdb_summary", "fetch_online_metadata", "fetch_episodes_meta",
    "normalize_title", "_safe_int", "_is_safe_media_url",
]

def _load_env_file() -> None:
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
            log.warning("Could not load .env file: %s", e)

_load_env_file()

TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "").strip()
if not TMDB_API_KEY:
    log.info("TMDB_API_KEY nie został ustawiony w .env ani w środowisku. Funkcje wyszukiwania online TMDb będą wyłączone lub ograniczone.")

app = Flask(__name__)


# Katalog danych: nowa nazwa "data"; starsze instalacje z "export data" nadal działają
DATA_DIR = "data" if os.path.isdir("data") else "export data"
MOVIES_FILE = os.path.join(DATA_DIR, "movies_parsed.json")
MOVIES_BACKUP_FILE = os.path.join(DATA_DIR, "movies_backup.json")
SHOWS_FILE = os.path.join(DATA_DIR, "shows_parsed.json")
SHOWS_BACKUP_FILE = os.path.join(DATA_DIR, "shows_backup.json")
UPCOMING_CACHE_FILE = os.path.join(DATA_DIR, "upcoming_cache.json")

EPISODES_CACHE: dict[str, dict] = {}

def load_movies() -> list:
    movies = load_json(MOVIES_FILE)
    deduped = deduplicate_items(movies)
    if len(deduped) != len(movies):
        save_json(MOVIES_FILE, deduped)
    return deduped

def save_movies(movies_list: object) -> bool:
    return save_json(MOVIES_FILE, movies_list)

def load_shows() -> list:
    shows = load_json(SHOWS_FILE)
    deduped = deduplicate_items(shows)
    if len(deduped) != len(shows):
        save_json(SHOWS_FILE, deduped)
    return deduped

def save_shows(shows_list: object) -> bool:
    return save_json(SHOWS_FILE, shows_list)


VOD_CACHE_FILE = os.path.join(DATA_DIR, "vod_cache.json")

# --- VOD WATCH PROVIDERS WITH 7-DAY TTL SMART CACHE ---
from services.vod_providers import (
    load_vod_cache as svc_load_vod_cache,
    save_vod_cache as svc_save_vod_cache,
    fetch_live_watch_providers as _svc_fetch_live_watch_providers,
)
from services.tmdb_client import format_tmdb_summary
from services.metadata import fetch_online_metadata
from services.episodes_meta import fetch_episodes_meta
from services.data_store import (
    normalize_title,
    safe_int as _safe_int,
    is_safe_media_url as _is_safe_media_url,
)

def load_vod_cache() -> dict:
    return svc_load_vod_cache(VOD_CACHE_FILE)

def save_vod_cache(cache_data: dict) -> bool:
    return svc_save_vod_cache(VOD_CACHE_FILE, cache_data)

def fetch_live_watch_providers(clean_title: str, media_type: str, region: str, tmdb_id: str | None = None) -> dict:
    return _svc_fetch_live_watch_providers(clean_title, media_type, region, TMDB_API_KEY, tmdb_id=tmdb_id)

RECOMMENDATIONS_CACHE: dict[str, dict] = {}


# --- Registracja blueprintów tras ---
from routes.system import bp as system_bp
from routes.search import bp as search_bp
from routes.movies import bp as movies_bp
from routes.shows import bp as shows_bp
from routes.vod import bp as vod_bp
from routes.upcoming import bp as upcoming_bp
from routes.recommendations import bp as recommendations_bp

for _bp in (system_bp, search_bp, movies_bp, shows_bp, vod_bp, upcoming_bp, recommendations_bp):
    app.register_blueprint(_bp)
