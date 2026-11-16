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

import re
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


# Parametr `nazwa=wartość` w adresie lub komunikacie (po `?`, `&`, spacji, cudzysłowie, nawiasie).
_PARAMETR = re.compile(r"(?P<przed>^|[?&;,\s'\"(])(?P<nazwa>[\w.\-]+)=(?P<wartosc>[^&\s'\")#]+)")
# Nagłówek Authorization (`Authorization: Bearer abc`, `authorization=abc`) razem ze schematem.
_AUTORYZACJA = re.compile(
    r"(?i)(?P<poczatek>authorization['\"]?\s*[:=]\s*['\"]?)(?:bearer\s+|basic\s+|token\s+)?[^\s,;'\"&}]+"
)


def redact_secrets(text: object, *secrets: str) -> str:
    """Maskuje sekrety w dowolnym tekście: wartości parametrów-kluczy i nagłówek Authorization.

    Treść wyjątku biblioteki HTTP potrafi zawierać cały adres żądania razem z `api_key=`.
    Ta sama lista nazw co przy access-logu (`_czy_maskowac`); dodatkowo `secrets` to znane
    wartości (np. klucz użyty w żądaniu), które maskujemy gdziekolwiek się pojawią.
    """
    wynik = str(text)

    def _podmien(m: re.Match[str]) -> str:
        if _czy_maskowac(m.group("nazwa")):
            return f"{m.group('przed')}{m.group('nazwa')}={ZAMIAST_WARTOSCI}"
        return m.group(0)

    wynik = _PARAMETR.sub(_podmien, wynik)
    wynik = _AUTORYZACJA.sub(lambda m: f"{m.group('poczatek')}{ZAMIAST_WARTOSCI}", wynik)
    for sekret in secrets:
        if sekret:
            wynik = wynik.replace(sekret, ZAMIAST_WARTOSCI)
    return wynik


class SanitizedRequestHandler(WSGIRequestHandler):
    """Handler werkzeuga, który nie wypisuje wartości kluczy API w logu."""

    def log_request(self, code: int | str = "-", size: int | str = "-") -> None:
        oryginalna_sciezka = self.path
        try:
            self.path = sanitize_path(oryginalna_sciezka)
            super().log_request(code, size)
        finally:
            self.path = oryginalna_sciezka
