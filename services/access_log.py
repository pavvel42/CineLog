"""CineLog - sanityzacja access-logu serwera deweloperskiego.

Werkzeug loguje pełny adres żądania, razem z query stringiem. Jeśli klient
wyśle klucz API w adresie (`?tmdb_key=…`, `?apikey=…`), wartość klucza trafia
do logu w postaci jawnej — a logi bywają zbierane, wysyłane i archiwizowane.

Serwer nie przyjmuje już kluczy z query (patrz services/client_keys.py), ale
stare zakładki, skrypty curl i integracje nadal mogą je wysyłać. Ten moduł
podmienia w logu samą wartość parametru na `***`, zostawiając nazwę parametru
(czyli informację diagnostyczną), i nie zmienia niczego w tym, co widzi aplikacja.
"""

from __future__ import annotations

from urllib.parse import unquote_plus

from werkzeug.serving import WSGIRequestHandler

# Pełne nazwy parametrów, które zawsze maskujemy...
MASKOWANE_NAZWY = frozenset({
    "key", "apikey", "api_key", "token", "access_token", "refresh_token",
    "password", "haslo", "secret", "api_secret", "client_secret", "auth",
    "authorization", "tmdb_key", "omdb_key", "imdb_key", "google_api_key",
})

# ...oraz końcówki, po których rozpoznajemy parametr z sekretem (np. "x_api_key").
MASKOWANE_KONCOWKI = ("_key", "_token", "_secret", "_password", "_haslo")

ZAMIAST_WARTOSCI = "***"


def _czy_maskowac(nazwa: str) -> bool:
    """Czy parametr o tej nazwie niesie sekret?"""
    n = nazwa.strip().lower()
    return n in MASKOWANE_NAZWY or n.endswith(MASKOWANE_KONCOWKI)


def sanitize_path(path: str) -> str:
    """Zwraca ścieżkę z zamaskowanymi wartościami parametrów-sekretów.

    Zachowuje kolejność parametrów i nazwy, żeby log pozostał diagnostyczny:
    `?q=Inception&tmdb_key=abc` -> `?q=Inception&tmdb_key=***`.
    """
    if "?" not in path:
        return path
    base, _, query = path.partition("?")
    if not query:
        return path

    czesci = []
    for fragment in query.split("&"):
        nazwa, separator, wartosc = fragment.partition("=")
        if separator and wartosc and _czy_maskowac(unquote_plus(nazwa)):
            czesci.append(f"{nazwa}={ZAMIAST_WARTOSCI}")
        else:
            czesci.append(fragment)
    return f"{base}?{'&'.join(czesci)}"


class SanitizedRequestHandler(WSGIRequestHandler):
    """Handler werkzeuga, który nie wypisuje wartości kluczy API w logu."""

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        oryginalna_sciezka = self.path
        try:
            self.path = sanitize_path(oryginalna_sciezka)
            super().log_request(code, size)
        finally:
            self.path = oryginalna_sciezka
