"""Regresja (audyt D2/F5): jedno źródło klucza OMDb i guard na alias IMDB_API_KEY.

Klucz OMDb ma 8 znaków, a `IMDB_API_KEY` jest w tym projekcie historycznym aliasem
o mylącej nazwie. Klucz TMDb (32 znaki) w tym slocie kończył się cichym 401 na OMDb,
więc alias jest honorowany tylko wtedy, gdy wartość ma kształt klucza OMDb.
"""

from __future__ import annotations

import logging

import pytest

from services import metadata, omdb_key


@pytest.fixture(autouse=True)
def czyste_srodowisko(monkeypatch: pytest.MonkeyPatch) -> None:
    """Bez tego testy zależą od kluczy w `.env`/środowisku dewelopera."""
    monkeypatch.delenv("OMDB_API_KEY", raising=False)
    monkeypatch.delenv("IMDB_API_KEY", raising=False)


def test_omdb_api_key_ma_pierwszenstwo_nad_aliasem(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OMDB_API_KEY", "omdb1234")
    monkeypatch.setenv("IMDB_API_KEY", "alias123")

    assert omdb_key.server_omdb_key() == "omdb1234"


def test_alias_z_kluczem_omdb_jest_honorowany(monkeypatch: pytest.MonkeyPatch) -> None:
    """Zgodność wsteczna: kto wpisał 8-znakowy klucz OMDb w alias, ten go dostaje."""
    monkeypatch.setenv("IMDB_API_KEY", "omdb1234")

    assert omdb_key.server_omdb_key() == "omdb1234"


def test_alias_z_kluczem_tmdb_jest_pomijany_i_loguje_ostrzezenie(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Klucz TMDb (32 znaki) w aliasie nie może udawać klucza OMDb."""
    monkeypatch.setenv("IMDB_API_KEY", "t" * 32)

    with caplog.at_level(logging.WARNING, logger="cinelog"):
        assert omdb_key.server_omdb_key() == ""

    ostrzezenie = caplog.text
    assert "IMDB_API_KEY" in ostrzezenie
    assert "32" in ostrzezenie, "ostrzeżenie powinno podać długość wpisanej wartości"
    assert "OMDB_API_KEY" in ostrzezenie, "ostrzeżenie powinno wskazać, gdzie wpisać klucz"


def test_brak_kluczy_zwraca_pusto(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="cinelog"):
        assert omdb_key.server_omdb_key() == ""

    assert caplog.text == "", "brak kluczy nie jest błędem — nie logujemy ostrzeżenia"


def test_trasy_i_skrypty_cli_korzystaja_z_jednego_zrodla() -> None:
    """Jedno źródło: `services.metadata` tylko re-eksportuje funkcję z `services.omdb_key`."""
    assert metadata.server_omdb_key is omdb_key.server_omdb_key
