"""CineLog - wybór klucza OMDb (jedno źródło dla serwera i skryptów CLI).

Klucz OMDb ma 8 znaków. ``IMDB_API_KEY`` jest w tym projekcie historycznym aliasem,
ale IMDb nie udostępnia własnego API — jeśli ktoś wpisał tam klucz innego dostawcy
(np. 32-znakowy klucz TMDb), OMDb odpowiada 401 i nikt nie wie dlaczego.

Dlatego alias honorujemy **tylko wtedy, gdy wartość ma kształt klucza OMDb**;
w przeciwnym razie logujemy wprost, którą zmienną poprawić.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("cinelog")

#: Klucze OMDb mają 8 znaków (tak samo jak klucz przysłany mailem "Here is your key").
OMDB_KEY_LENGTH = 8


def server_omdb_key() -> str:
    """Zwraca klucz OMDb z konfiguracji serwera albo pusty łańcuch.

    Kolejność: ``OMDB_API_KEY`` (zawsze wygrywa), potem alias ``IMDB_API_KEY``
    tylko gdy wygląda na klucz OMDb.
    """
    omdb = os.environ.get("OMDB_API_KEY", "").strip()
    if omdb:
        return omdb

    alias = os.environ.get("IMDB_API_KEY", "").strip()
    if not alias:
        return ""

    if len(alias) == OMDB_KEY_LENGTH:
        return alias

    log.warning(
        "IMDB_API_KEY ma %d znaków, a klucz OMDb ma %d — pomijam tę wartość "
        "(to prawdopodobnie klucz innego dostawcy, np. TMDb). Wpisz klucz OMDb w OMDB_API_KEY.",
        len(alias),
        OMDB_KEY_LENGTH,
    )
    return ""
