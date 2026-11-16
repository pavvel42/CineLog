"""CineLog - przycinanie cache'y plikowych (harmonogram premier, VOD).

Wpisy mają `expires_at` ("%Y-%m-%d %H:%M:%S"), ale same z siebie nigdy nie znikały z pliku.
Tu: wyrzucenie wygasłych wpisów i limit liczby wpisów (zostają te, które wygasają najpóźniej).
Zapis robi wołający przez `save_json` (atomowo) — ten moduł niczego nie zapisuje.
"""

from __future__ import annotations

from datetime import datetime

DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def _wygasa(wpis: dict) -> datetime | None:
    """Data wygaśnięcia wpisu albo None, gdy jej brak lub jest nieczytelna."""
    try:
        return datetime.strptime(wpis["expires_at"], DATE_FORMAT)
    except (KeyError, TypeError, ValueError):
        return None


def przytnij_cache(cache: dict, max_entries: int, teraz: datetime | None = None) -> dict:
    """Zwraca NOWY słownik: bez wygasłych wpisów, z co najwyżej `max_entries` wpisami.

    Wpis niebędący obiektem jest uszkodzony i odpada. Wpis bez czytelnego `expires_at` nie
    wygasa, ale przy przekroczeniu limitu odpada jako pierwszy (nie wiadomo, jak jest stary).
    """
    teraz = teraz or datetime.now()
    zywe: list[tuple[datetime, str, dict]] = []
    for klucz, wpis in cache.items():
        if not isinstance(wpis, dict):
            continue
        wygasa = _wygasa(wpis)
        if wygasa is not None and wygasa <= teraz:
            continue
        zywe.append((wygasa or datetime.min, klucz, wpis))
    zywe.sort(key=lambda trojka: trojka[0], reverse=True)
    return {klucz: wpis for _, klucz, wpis in zywe[:max_entries]}
