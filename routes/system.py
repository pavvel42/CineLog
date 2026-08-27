"""CineLog - trasy system: strona główna, export/reset biblioteki, test kluczy API.

Współdzielone zasoby (stałe plików, cache, klucz TMDb, akcesory biblioteki)
są odczytywane z modułu aplikacji przez późne wiązanie (_app.X w czasie żądania),
dzięki czemu testy mogą je podmieniać przez monkeypatch na module `app`.
"""

from __future__ import annotations

import json
import logging
import shutil
import urllib.request
import urllib.parse
from datetime import datetime

import os
from pathlib import Path

from flask import Blueprint, jsonify, request, Response, send_file


from flask.typing import ResponseReturnValue

import app as _app

log = logging.getLogger("cinelog")

bp = Blueprint("system", __name__)

INDEX_HTML = Path(__file__).resolve().parent.parent / "index.html"
SW_JS = Path(__file__).resolve().parent.parent / "sw.js"
MANIFEST_JSON = Path(__file__).resolve().parent.parent / "manifest.json"

@bp.route("/")
@bp.route("/m3")
def index():
    return send_file(INDEX_HTML)

@bp.route("/sw.js")
def service_worker():
    return send_file(SW_JS, mimetype="application/javascript")

@bp.route("/manifest.json")
def web_manifest():
    return send_file(MANIFEST_JSON, mimetype="application/manifest+json")

# --- MULTI-RESULT LIVE SEARCH API ---
@bp.route("/api/data", methods=["GET"])
def get_all_data() -> ResponseReturnValue:
    return jsonify({
        "movies": _app.load_movies(),
        "shows": _app.load_shows()
    })

# --- MOVIES API ---
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

@bp.route("/api/movies/reset", methods=["POST"])
@bp.route("/api/reset", methods=["POST"])
def reset_all() -> ResponseReturnValue:
    if os.path.exists(_app.MOVIES_BACKUP_FILE):
        shutil.copy(_app.MOVIES_BACKUP_FILE, _app.MOVIES_FILE)
    if os.path.exists(_app.SHOWS_BACKUP_FILE):
        shutil.copy(_app.SHOWS_BACKUP_FILE, _app.SHOWS_FILE)
    return jsonify({"status": "reset_complete"})

# --- API KEYS VERIFICATION ---
@bp.route("/api/keys/test", methods=["POST"])
def test_api_keys() -> ResponseReturnValue:
    data = request.get_json(silent=True) or {}
    tmdb_key = data.get("tmdb_key", "").strip() or _app.TMDB_API_KEY
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
