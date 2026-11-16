"""CineLog - trasy system: strona główna, PWA, eksport i import biblioteki.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Blueprint, jsonify, Response, send_file

from flask.typing import ResponseReturnValue

import app as _app

from routes._http import json_object
from services.validation import episode_list, safe_poster_url

log = logging.getLogger("cinelog")

bp = Blueprint("system", __name__)

INDEX_HTML = Path(__file__).resolve().parent.parent / "index.html"
SW_JS = Path(__file__).resolve().parent.parent / "sw.js"
MANIFEST_JSON = Path(__file__).resolve().parent.parent / "manifest.json"

# Górna granica jednej listy w imporcie. Realna biblioteka to setki pozycji,
# limit chroni tylko przed przypadkowym albo spreparowanym plikiem.
IMPORT_MAX_ITEMS = 20_000


@bp.route("/")
def index():
    return send_file(INDEX_HTML)

@bp.route("/sw.js")
def service_worker():
    return send_file(SW_JS, mimetype="application/javascript")

@bp.route("/manifest.json")
def web_manifest():
    return send_file(MANIFEST_JSON, mimetype="application/manifest+json")

# --- EKSPORT I IMPORT BIBLIOTEKI ---
@bp.route("/api/export", methods=["GET"])
def export_data() -> ResponseReturnValue:
    movies = _app.load_movies()
    shows = _app.load_shows()
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


class NieprawidlowyImport(ValueError):
    """Treść importu nie przeszła walidacji — komunikat trafia do użytkownika (HTTP 400)."""


def _wpisy_importu(raw: object, pole: str) -> tuple[list[dict[str, Any]], int]:
    """Waliduje jedną listę importu; zwraca (poprawne wpisy, liczba pominiętych).

    Wpis niebędący obiektem albo bez tytułu-napisu jest pomijany, a reszta przechodzi —
    jeden zepsuty rekord nie blokuje importu całej biblioteki. Pola, które frontend renderuje
    i wysyła dalej (adres plakatu, lista odcinków), są czyszczone ze złych typów. Brakujące
    lub zdublowane `uuid` są nadawane od nowa: trasy PUT/DELETE adresują wpisy po `uuid`,
    więc wpis bez niego byłby po imporcie nieedytowalny.
    """
    if raw is None:
        return [], 0
    if not isinstance(raw, list):
        raise NieprawidlowyImport(f"Pole „{pole}” musi być listą.")
    if len(raw) > IMPORT_MAX_ITEMS:
        raise NieprawidlowyImport(
            f"Za dużo pozycji w „{pole}” ({len(raw)}), limit to {IMPORT_MAX_ITEMS}."
        )
    wynik: list[dict[str, Any]] = []
    uzyte: set[str] = set()
    pominiete = 0
    for wpis in raw:
        if not isinstance(wpis, dict) or not isinstance(wpis.get("title"), str) or not wpis["title"].strip():
            pominiete += 1
            continue
        kopia = dict(wpis)
        kopia["title"] = wpis["title"].strip()
        if "poster_url" in kopia:
            kopia["poster_url"] = safe_poster_url(kopia["poster_url"])
        if "episodes_watched" in kopia:
            kopia["episodes_watched"] = episode_list(kopia["episodes_watched"])
        identyfikator = str(kopia.get("uuid") or "").strip()
        if not identyfikator or identyfikator in uzyte:
            identyfikator = str(uuid.uuid4())
        kopia["uuid"] = identyfikator
        uzyte.add(identyfikator)
        wynik.append(kopia)
    return wynik, pominiete


@bp.route("/api/import", methods=["POST"])
def import_library() -> ResponseReturnValue:
    """Import = WYMIANA całej biblioteki serwera na zawartość pliku.

    Kopii poprzedniej bazy nie robimy — kopię użytkownik pobiera sam przyciskiem
    eksportu. Pusty import jest odrzucany, żeby przypadkowe żądanie nie wyczyściło bazy.
    """
    data = json_object()
    try:
        movies, pominiete_filmy = _wpisy_importu(data.get("movies"), "movies")
        shows, pominiete_seriale = _wpisy_importu(data.get("shows"), "shows")
    except NieprawidlowyImport as e:
        return jsonify({"error": str(e)}), 400
    pominiete = pominiete_filmy + pominiete_seriale
    if not movies and not shows:
        return jsonify({"error": "Import nie zawiera żadnych poprawnych pozycji.", "skipped": pominiete}), 400

    with _app.DATA_LOCK:
        if not (_app.save_movies(movies, replace_corrupt=True) and _app.save_shows(shows, replace_corrupt=True)):
            log.error("Import biblioteki: zapis na dysk nie powiódł się")
            return jsonify({"error": "Nie udało się zapisać bazy."}), 500

    log.info("Import biblioteki: %d filmów, %d seriali, pominięto %d", len(movies), len(shows), pominiete)
    return jsonify({"movies": movies, "shows": shows, "skipped": pominiete})
