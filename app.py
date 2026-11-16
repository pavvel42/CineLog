"""CineLog - kompozycja aplikacji Flask.

Ten moduł jest pojedynczym źródłem prawdy dla konfiguracji, stałych plików,
cache'i i akcesorów biblioteki. Moduły tras (routes/*.py) czytają je przez
późne wiązanie (`import app as _app`), dzięki czemu testy mogą je podmieniać
przez monkeypatch na module `app`. Uruchamianie serwera: python run.py
"""

from __future__ import annotations

import os
import logging
import traceback

from flask import Flask, Response, jsonify, request
from flask.typing import ResponseReturnValue
from werkzeug.exceptions import HTTPException

from services.data_store import (
    DATA_LOCK,
    LibraryCorruptError,
    deduplicate_items,
    load_json,
    load_library,
    save_json,
    save_library,
)
from services.access_log import redact_secrets
from services.security import allowed_hosts_from_env, is_allowed_host, is_allowed_write
from services.validation import MAX_CONTENT_LENGTH, ApiError

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("cinelog")

__all__ = [
    "app",
    "TMDB_API_KEY",
    "DATA_DIR", "MOVIES_FILE",
    "SHOWS_FILE", "UPCOMING_CACHE_FILE", "VOD_CACHE_FILE",
    "EPISODES_CACHE", "RECOMMENDATIONS_CACHE", "DATA_LOCK",
    "load_movies", "save_movies", "load_shows", "save_shows", "load_json", "save_json",
    "load_vod_cache", "save_vod_cache", "fetch_live_watch_providers",
    "format_tmdb_summary", "fetch_online_metadata", "fetch_episodes_meta",
    "normalize_title", "normalize_tmdb_id", "_safe_int", "_is_safe_media_url",
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
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


@app.before_request
def _guard_host_header() -> ResponseReturnValue | None:
    """Odrzuca żądania z nagłówkiem Host spoza localhost/adresów IP/CINELOG_ALLOWED_HOSTS.

    Chroni przed DNS rebinding: strona pod obcą nazwą, która po zmianie DNS wskazuje na
    127.0.0.1, ma zgodne `Origin` i `Host`, więc strażnik zapisu poniżej jej nie zatrzyma.
    """
    if is_allowed_host(request.host, allowed_hosts_from_env()):
        return None
    log.warning("Odrzucono żądanie z niedozwolonym nagłówkiem Host: %s %s", request.method, request.path)
    return jsonify({
        "error": "Niedozwolona nazwa hosta. Dopisz ją do CINELOG_ALLOWED_HOSTS, jeśli to Twój adres.",
    }), 403


@app.after_request
def _security_headers(response: Response) -> Response:
    """Nagłówki bezpieczeństwa. CSP zostaje w index.html (nie dokładamy go po stronie serwera)."""
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Frame-Options", "DENY")
    return response


@app.before_request
def _guard_cross_origin_writes() -> ResponseReturnValue | None:
    """Blokuje operacje zapisu wysłane z obcej strony (CSRF).

    Backend działa lokalnie i bez uwierzytelniania, więc bez tej bramki
    dowolna strona otwarta w przeglądarce mogła wysłać żądanie modyfikujące
    dane (np. podmienić całą bibliotekę przez POST /api/import).
    """
    if is_allowed_write(
        request.method,
        request.host,
        request.headers.get("Origin"),
        request.headers.get("Sec-Fetch-Site"),
    ):
        return None
    log.warning(
        "Odrzucono zapis z obcego pochodzenia: %s %s (Origin=%s, Sec-Fetch-Site=%s)",
        request.method,
        request.path,
        request.headers.get("Origin"),
        request.headers.get("Sec-Fetch-Site"),
    )
    return jsonify({
        "error": "cross_origin_blocked",
        "message": "Operacje zapisu są dozwolone tylko z aplikacji CineLog.",
    }), 403


# Katalog danych: nowa nazwa "data"; starsze instalacje z "export data" nadal działają.
# DATA_DIR (env) pozwala wskazać katalog tymczasowy, np. dla izolowanych testów e2e.
DATA_DIR = os.environ.get("DATA_DIR") or ("data" if os.path.isdir("data") else "export data")
MOVIES_FILE = os.path.join(DATA_DIR, "movies_parsed.json")
SHOWS_FILE = os.path.join(DATA_DIR, "shows_parsed.json")
UPCOMING_CACHE_FILE = os.path.join(DATA_DIR, "upcoming_cache.json")

EPISODES_CACHE: dict[str, tuple[float, dict]] = {}

def load_movies() -> list:
    movies = load_library(MOVIES_FILE)
    deduped = deduplicate_items(movies)
    if len(deduped) != len(movies):
        save_json(MOVIES_FILE, deduped)
    return deduped

def save_movies(movies_list: object, replace_corrupt: bool = False) -> bool:
    return save_library(MOVIES_FILE, movies_list, replace_corrupt=replace_corrupt)

def load_shows() -> list:
    shows = load_library(SHOWS_FILE)
    deduped = deduplicate_items(shows)
    if len(deduped) != len(shows):
        save_json(SHOWS_FILE, deduped)
    return deduped

def save_shows(shows_list: object, replace_corrupt: bool = False) -> bool:
    return save_library(SHOWS_FILE, shows_list, replace_corrupt=replace_corrupt)


_HTTP_ERROR_MESSAGES = {
    400: "Niepoprawne żądanie — sprawdź, czy treść jest poprawnym JSON-em.",
    404: "Nie znaleziono zasobu.",
    405: "Ta metoda HTTP nie jest dostępna dla tego adresu.",
    413: f"Żądanie jest za duże (limit {MAX_CONTENT_LENGTH // (1024 * 1024)} MB).",
    415: "Oczekiwano treści w formacie JSON (nagłówek Content-Type: application/json).",
}


@app.errorhandler(ApiError)
def _api_error(e: ApiError) -> ResponseReturnValue:
    return jsonify({"error": e.message}), e.status_code


@app.errorhandler(HTTPException)
def _http_error(e: HTTPException) -> ResponseReturnValue:
    """Błędy HTTP tras `/api/` jako JSON `{"error": ...}`; reszta zostaje domyślną stroną Flaska."""
    if not request.path.startswith("/api/"):
        return e
    code = e.code or 500
    return jsonify({"error": _HTTP_ERROR_MESSAGES.get(code, f"Błąd żądania (HTTP {code}).")}), code


@app.errorhandler(Exception)
def _unhandled_error(e: Exception) -> ResponseReturnValue:
    """Nieobsłużony wyjątek: pełny ślad (zamaskowany) trafia do logu, klient dostaje tylko JSON."""
    log.error(
        "Nieobsłużony wyjątek w %s %s: %s",
        request.method, request.path, redact_secrets(traceback.format_exc()),
    )
    if not request.path.startswith("/api/"):
        return Response("Internal Server Error", status=500)
    return jsonify({"error": "Wewnętrzny błąd serwera. Szczegóły są w logu aplikacji."}), 500


@app.errorhandler(LibraryCorruptError)
def _library_corrupt(e: LibraryCorruptError) -> ResponseReturnValue:
    """Jeden handler dla wszystkich tras biblioteki: JSON z czytelnym komunikatem zamiast śladu stosu."""
    log.error("Biblioteka uszkodzona: %s", e)
    plik = os.path.basename(e.filepath)
    return jsonify({
        "error": (
            f"Plik biblioteki „{plik}” jest uszkodzony ({e.reason}), więc zapis i odczyt zostały wstrzymane, "
            f"żeby go nie nadpisać. Kopia leży obok pliku ({plik}.corrupt). "
            "Przywróć bibliotekę z kopii albo zaimportuj ją ponownie z pliku eksportu."
        ),
        "corrupt": True,
    }), 500


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
    normalize_tmdb_id,
    safe_int as _safe_int,
    is_safe_media_url as _is_safe_media_url,
)

def load_vod_cache() -> dict:
    return svc_load_vod_cache(VOD_CACHE_FILE)

def save_vod_cache(cache_data: dict) -> bool:
    return svc_save_vod_cache(VOD_CACHE_FILE, cache_data)

def fetch_live_watch_providers(clean_title: str, media_type: str, region: str,
                               tmdb_id: str | None = None,
                               tmdb_api_key: str | None = None) -> dict:
    """Dostawcy VOD dla tytułu — klucz z żądania (BYOK) ma pierwszeństwo nad env."""
    return _svc_fetch_live_watch_providers(
        clean_title, media_type, region, tmdb_api_key or TMDB_API_KEY, tmdb_id=tmdb_id
    )

RECOMMENDATIONS_CACHE: dict[str, tuple[float, dict]] = {}


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
