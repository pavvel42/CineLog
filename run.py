"""CineLog - punkt wejścia serwera deweloperskiego.

Uruchamianie: python run.py  (konfiguracja: PORT, FLASK_DEBUG - patrz .env.example)
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

from app import app
from services.access_log import SanitizedRequestHandler

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_CONFIG_TEMPLATE = BASE_DIR / "static" / "js" / "config.example.js"
FRONTEND_CONFIG = BASE_DIR / "static" / "js" / "config.js"

# Identyfikator klienta OAuth to wartość publiczna (trafia do adresu w przeglądarce),
# więc może leżeć w config.js - inaczej niż klucze API. Akceptujemy nazwę z .env.example
# oraz `ID_Project_Google_Cloud`, bo takiej używają istniejące konfiguracje użytkowników:
# zmienna o tej nazwie była wcześniej czytana przez nikogo i nic nie robiła.
GOOGLE_CLIENT_ID_ENV_NAMES = ("GOOGLE_CLIENT_ID", "ID_Project_Google_Cloud")
GOOGLE_CLIENT_ID_LINE_RE = re.compile(
    r"""^(\s*GOOGLE_CLIENT_ID\s*:\s*)["'][^"']*["'](.*)$""", re.MULTILINE
)
# Format klienta OAuth typu "Web application": <numer-projektu>-<losowy>.apps.googleusercontent.com
GOOGLE_CLIENT_ID_RE = re.compile(r"^\d{6,}-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$")


def read_google_client_id(env: dict | None = None) -> str:
    """Zwraca identyfikator klienta OAuth ze środowiska (pierwsza ustawiona nazwa)."""
    source = os.environ if env is None else env
    for name in GOOGLE_CLIENT_ID_ENV_NAMES:
        value = (source.get(name) or "").strip()
        if value:
            return value
    return ""


def is_google_client_id(value: str) -> bool:
    """Czy wartość wygląda na identyfikator klienta OAuth (a nie np. numer projektu)."""
    return bool(GOOGLE_CLIENT_ID_RE.match((value or "").strip()))


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


def inject_google_client_id(client_id: str) -> bool:
    """Wpisuje identyfikator klienta OAuth do config.js (tylko tę jedną linię).

    Pozostałe wartości zostają nietknięte - użytkownik może mieć tam własne wpisy.
    Zwraca True, gdy plik się zmienił.
    """
    if not client_id or not FRONTEND_CONFIG.exists():
        return False
    content = FRONTEND_CONFIG.read_text(encoding="utf-8")
    updated, count = GOOGLE_CLIENT_ID_LINE_RE.subn(
        lambda m: f'{m.group(1)}"{client_id}"{m.group(2)}', content, count=1
    )
    if count == 0 or updated == content:
        return False
    FRONTEND_CONFIG.write_text(updated, encoding="utf-8")
    return True


def sync_frontend_config_from_env(env: dict | None = None) -> bool:
    """Uzupełnia config.js identyfikatorem klienta OAuth z .env.

    Bez tego identyfikator brała wyłącznie przeglądarka (localStorage), więc każde
    urządzenie miało własną, ręcznie wpisaną wartość - a rozjazd kończył się błędem
    Google `401 invalid_client` („The OAuth client was not found"), mylącym, bo nie
    ma nic wspólnego z uprawnieniami konta ani listą użytkowników testowych.
    """
    client_id = read_google_client_id(env)
    if not client_id:
        return False
    if not is_google_client_id(client_id):
        print(
            "[start] UWAGA: GOOGLE_CLIENT_ID/ID_Project_Google_Cloud nie wygląda na "
            "identyfikator klienta OAuth (oczekiwany format: 1234567890-xxxxxxxx."
            "apps.googleusercontent.com) - nie wpisuję go do config.js. "
            "Sprawdź, czy w .env nie ma numeru projektu albo klucza API."
        )
        return False
    if inject_google_client_id(client_id):
        print("[start] Wpisano GOOGLE_CLIENT_ID z .env do static/js/config.js")
        return True
    return False


def main() -> None:
    ensure_frontend_config()
    sync_frontend_config_from_env()
    # Domyślnie tylko pętla lokalna: backend nie ma uwierzytelniania, więc
    # wystawienie go do sieci LAN wymaga świadomej decyzji (HOST=0.0.0.0).
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    print(f"[start] CineLog: http://{host}:{port}")
    # Własny handler: access-log nie wypisuje wartości kluczy API z query stringa.
    app.run(debug=debug_mode, host=host, port=port, request_handler=SanitizedRequestHandler)


if __name__ == "__main__":
    main()
