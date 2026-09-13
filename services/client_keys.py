"""Klucze API dostarczone przez przeglądarkę (BYOK) — wyłącznie przez nagłówki.

Klucz przekazywany w query stringu (`?tmdb_key=…`, `?omdb_key=…`, `?imdb_key=…`)
został usunięty: pełny adres żądania trafia do logu dostępowego serwera, więc
wartość klucza lądowała w logu w postaci jawnej. Nagłówki `X-TMDB-Key`
i `X-OMDb-Key` nie są logowane przez werkzeuga.
"""

from flask import request

TMDB_HEADER = "X-TMDB-Key"
OMDB_HEADER = "X-OMDb-Key"


def tmdb_key() -> str:
    """Klucz TMDb z nagłówka przeglądarki (pusty napis, gdy go nie ma)."""
    return request.headers.get(TMDB_HEADER, "").strip()


def omdb_key() -> str:
    """Klucz OMDb z nagłówka przeglądarki (pusty napis, gdy go nie ma)."""
    return request.headers.get(OMDB_HEADER, "").strip()
