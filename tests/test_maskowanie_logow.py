"""B8: klucze API nie trafiają do logów — jedna funkcja maskująca dla wyjątków z żądań HTTP."""

from __future__ import annotations

import logging

import pytest

import app as app_module
from services import episodes_meta, tmdb_client
from services.access_log import redact_secrets

SEKRET = "SEKRET123"


def _wybuch(*_args, **_kwargs):
    """Wyjątek biblioteki HTTP z adresem żądania w treści — tak wygląda realny przypadek."""
    raise OSError(
        f"nieudane żądanie https://api.themoviedb.org/3/search/movie?api_key={SEKRET}&query=Dune&language=pl-PL"
    )


# --- funkcja maskująca ------------------------------------------------------------

@pytest.mark.parametrize("tekst", [
    f"https://api.themoviedb.org/3/search/tv?api_key={SEKRET}&query=x",
    f"https://www.omdbapi.com/?apikey={SEKRET}&t=Dune",
    f"https://example.org/x?key={SEKRET}",
    f"https://example.org/x?q=1&token={SEKRET}",
    f"Authorization: Bearer {SEKRET}",
    f"headers={{'Authorization': 'Bearer {SEKRET}'}}",
    f"authorization={SEKRET}",
    f"x_api_key={SEKRET})",
])
def test_redact_secrets_maskuje_wartosci_kluczy(tekst):
    wynik = redact_secrets(tekst)
    assert SEKRET not in wynik
    assert "***" in wynik


def test_redact_secrets_zachowuje_reszte_komunikatu():
    wynik = redact_secrets(f"błąd https://api.themoviedb.org/3/search/tv?api_key={SEKRET}&query=Dune&language=pl-PL")
    assert wynik == "błąd https://api.themoviedb.org/3/search/tv?api_key=***&query=Dune&language=pl-PL"


def test_redact_secrets_nie_rusza_zwyklych_parametrow():
    tekst = "https://example.org/x?q=Dune&page=2&language=pl"
    assert redact_secrets(tekst) == tekst


def test_redact_secrets_maskuje_tez_znana_wartosc_poza_parametrem():
    assert SEKRET not in redact_secrets(f"surowy klucz {SEKRET} w tekście", SEKRET)


def test_redact_secrets_przyjmuje_wyjatek():
    assert SEKRET not in redact_secrets(OSError(f"?api_key={SEKRET}"))


# --- trasy ------------------------------------------------------------------------

TRASY = [
    "/api/search_preview?q=Dune&type=movie",
    "/api/search_detail?title=Dune&type=movie",
    "/api/search_detail?tmdb_id=5&title=Dune&type=movie",
    "/api/recommendations/for_item?title=Dune&media_type=movie",
    "/api/recommendations/for_item?tmdb_id=5&media_type=movie",
    "/api/recommendations/discover?media_type=movie",
    "/api/recommendations/trending",
    "/api/actor/details?id=5",
]


@pytest.mark.parametrize("sciezka", TRASY)
def test_trasy_nie_loguja_klucza_api(client, monkeypatch, caplog, sciezka):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", SEKRET)
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.DEBUG, logger="cinelog"):
        client.get(sciezka)
    assert SEKRET not in caplog.text


def test_trasa_search_detail_loguje_blad_ale_bez_klucza(client, monkeypatch, caplog):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", SEKRET)
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.WARNING, logger="cinelog"):
        client.get("/api/search_detail?title=Dune&type=movie")
    assert "TMDb detail fetch error" in caplog.text
    assert "api_key=***" in caplog.text


def test_trasa_search_preview_loguje_blad_ale_bez_klucza(client, monkeypatch, caplog):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", SEKRET)
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.WARNING, logger="cinelog"):
        client.get("/api/search_preview?q=Dune&type=movie")
    assert "TMDb search preview error" in caplog.text
    assert "api_key=***" in caplog.text


def test_trasa_rekomendacji_loguje_blad_ale_bez_klucza(client, monkeypatch, caplog):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", SEKRET)
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.WARNING, logger="cinelog"):
        client.get("/api/recommendations/trending")
    assert "trending recommendations" in caplog.text
    assert "api_key=***" in caplog.text


# --- serwisy ----------------------------------------------------------------------

def test_episodes_meta_nie_loguje_klucza_api(monkeypatch, caplog):
    monkeypatch.setattr(episodes_meta, "tmdb_get", _wybuch)
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.DEBUG, logger="cinelog"):
        episodes_meta.fetch_episodes_meta("Dune", None, "pl-PL", SEKRET)
    assert SEKRET not in caplog.text
    assert "TMDb episode meta error" in caplog.text


def test_tmdb_get_nie_loguje_klucza_api(monkeypatch, caplog):
    monkeypatch.setattr("urllib.request.urlopen", _wybuch)
    with caplog.at_level(logging.DEBUG, logger="cinelog"):
        assert tmdb_client.tmdb_get("/search/movie", {"query": "Dune"}, api_key=SEKRET) is None
    assert SEKRET not in caplog.text
    assert caplog.text


def test_nieobsluzony_wyjatek_w_trasie_nie_loguje_klucza(client, monkeypatch, caplog):
    def wybuch_trasy():
        raise RuntimeError(f"https://x/y?api_key={SEKRET}")

    monkeypatch.setattr(app_module, "load_movies", wybuch_trasy)
    with caplog.at_level(logging.DEBUG, logger="cinelog"):
        assert client.get("/api/movies").status_code == 500
    assert SEKRET not in caplog.text
    assert caplog.text
