"""CineLog - punkt wejścia serwera deweloperskiego.

Uruchamianie: python run.py  (konfiguracja: PORT, FLASK_DEBUG - patrz .env.example)
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from app import app

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_CONFIG_TEMPLATE = BASE_DIR / "static" / "js" / "config.example.js"
FRONTEND_CONFIG = BASE_DIR / "static" / "js" / "config.js"


def ensure_frontend_config() -> bool:
    """Tworzy static/js/config.js z szablonu, jeśli pliku brakuje.

    index.html ładuje ten plik bezwarunkowo, a plik jest ignorowany przez git,
    więc na świeżym klonie nie istnieje: przeglądarka zgłasza wtedy 404 przy
    każdym wejściu (m.in. wywraca testy e2e pilnujące braku błędów w konsoli).

    Zwraca True, gdy plik został właśnie utworzony.
    """
    if FRONTEND_CONFIG.exists() or not FRONTEND_CONFIG_TEMPLATE.exists():
        return False
    shutil.copyfile(FRONTEND_CONFIG_TEMPLATE, FRONTEND_CONFIG)
    print("[start] Utworzono static/js/config.js z szablonu config.example.js")
    return True


def main() -> None:
    ensure_frontend_config()
    port = int(os.environ.get("PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode, port=port)


if __name__ == "__main__":
    main()
