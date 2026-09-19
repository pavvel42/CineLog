"""Regresja: dane z zewnętrznych źródeł przyjmujemy tylko przy zgodnym tytule.

Ta sama klasa błędu co zgłoszone przez użytkownika mieszanie wersji serialu: źródło
zwraca listę wyników posortowaną „po trafności", a kod brał pierwszy z brzegu.
Skutki: plakat i data premiery innej produkcji (OMDb/iTunes), odcinki innego serialu (TMDb).
"""

from __future__ import annotations

import json
import urllib.request

from services import dopasowanie, episodes_meta, metadata


class _Odpowiedz:
    """Atrapa odpowiedzi urllib — wystarcza read() i protokół kontekstu."""

    def __init__(self, dane: dict):
        self._dane = json.dumps(dane).encode("utf-8")

    def read(self) -> bytes:
        return self._dane

    def __enter__(self) -> "_Odpowiedz":
        return self

    def __exit__(self, *_: object) -> bool:
        return False


class _Odpowiedzi:
    """Zwraca kolejne przygotowane odpowiedzi, zapisując wywołane adresy."""

    def __init__(self, *dane: dict):
        self.dane = list(dane)
        self.adresy: list[str] = []

    def __call__(self, req: object, timeout: int | None = None) -> _Odpowiedz:
        self.adresy.append(getattr(req, "full_url", str(req)))
        return _Odpowiedz(self.dane.pop(0) if self.dane else {})


def _brak_sieci(req: object, timeout: int | None = None) -> _Odpowiedz:
    raise OSError("sieć wyłączona w teście")


# --- OMDb / iTunes ----------------------------------------------------------


def test_omdb_search_pomija_niepasujacy_tytul(monkeypatch):
    atrapa = _Odpowiedzi({
        "Search": [
            {"Title": "Zupełnie inny film", "Poster": "https://x/zly.jpg", "Year": "1999"},
            {"Title": "Belfast", "Poster": "https://x/dobry.jpg", "Year": "2021"},
        ]
    })
    monkeypatch.setattr(urllib.request, "urlopen", atrapa)

    wynik = metadata._omdb_search_first("Belfast", "movie", "klucz")

    assert wynik is not None and wynik["Poster"] == "https://x/dobry.jpg"


def test_omdb_search_zwraca_none_gdy_zaden_tytul_nie_pasuje(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", _Odpowiedzi({
        "Search": [{"Title": "Belfast 2", "Poster": "https://x/zly.jpg", "Year": "2030"}]
    }))

    assert metadata._omdb_search_first("Belfast", "movie", "klucz") is None


def test_itunes_pomija_niepasujacy_tytul(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", _Odpowiedzi({
        "results": [
            {"trackName": "Inny film", "artworkUrl100": "https://x/zly.jpg"},
            {"trackName": "Belfast", "artworkUrl100": "https://x/dobry100x100bb.jpg"},
        ]
    }))

    wynik = metadata._itunes_lookup("Belfast", "movie")

    assert wynik is not None and wynik["artworkUrl100"] == "https://x/dobry100x100bb.jpg"


def test_plakat_nie_pochodzi_z_innej_produkcji(monkeypatch):
    """Pełna ścieżka: OMDb nie znalazł dokładnie, wyszukiwanie zwraca inny film, iTunes milczy."""
    monkeypatch.setattr(urllib.request, "urlopen", _Odpowiedzi(
        {"Response": "False"},                                                     # OMDb exact
        {"Search": [{"Title": "Obcy film", "Poster": "https://x/zly.jpg", "Year": "2019"}]},  # OMDb search
        {"results": []},                                                           # iTunes US
        {"results": []},                                                           # iTunes PL
        {"results": []},                                                           # iTunes GB
    ))

    poster, release = metadata.fetch_online_metadata("Belfast", "movie", "klucz")

    assert poster is None, "cudzy plakat nie może trafić do biblioteki"
    assert release is None


# --- odcinki (TMDb) ---------------------------------------------------------


def test_episodes_meta_nie_pobiera_odcinkow_niepasujacego_serialu(monkeypatch):
    wywolania: list[str] = []

    def falszywy_tmdb_get(sciezka, params=None, **kw):
        wywolania.append(sciezka)
        if sciezka == "/search/tv":
            return {"results": [{"id": 309130, "name": "激战黄土岭", "original_name": "激战黄土岭"}]}
        return {}

    monkeypatch.setattr(episodes_meta, "tmdb_get", falszywy_tmdb_get)
    monkeypatch.setattr(urllib.request, "urlopen", _brak_sieci)

    meta = episodes_meta.fetch_episodes_meta("Biuro", None, "pl-PL", "klucz")

    assert meta == {}
    assert not [s for s in wywolania if s.startswith("/tv/")], "żadnego pobierania odcinków obcego serialu"


def test_episodes_meta_pobiera_odcinki_zgodnego_serialu(monkeypatch):
    wywolania: list[str] = []

    def falszywy_tmdb_get(sciezka, params=None, **kw):
        wywolania.append(sciezka)
        if sciezka == "/search/tv":
            return {"results": [
                {"id": 309130, "name": "激战黄土岭", "original_name": "激战黄土岭"},
                {"id": 2316, "name": "Biuro", "original_name": "The Office"},
            ]}
        if sciezka == "/tv/2316":
            return {"seasons": [{"season_number": 1}]}
        if sciezka == "/tv/2316/season/1":
            return {"episodes": [{"episode_number": 1, "name": "Pilot", "overview": "opis"}]}
        return {}

    monkeypatch.setattr(episodes_meta, "tmdb_get", falszywy_tmdb_get)
    monkeypatch.setattr(urllib.request, "urlopen", _brak_sieci)

    meta = episodes_meta.fetch_episodes_meta("Biuro", None, "pl-PL", "klucz")

    assert "1_1" in meta and meta["1_1"]["summary"] == "opis"
    assert "/tv/2316" in wywolania


# --- wspólne dopasowanie po stronie serwera (services/dopasowanie.py) -------


def test_wybierz_zgodny_rok_rozstrzyga_miedzy_wersjami():
    wyniki = [
        {"id": 2996, "name": "Biuro", "original_name": "The Office", "first_air_date": "2001-07-09"},
        {"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"},
    ]

    trafienie = dopasowanie.wybierz_zgodny(wyniki, "Biuro", "2005")

    assert trafienie is not None and trafienie["id"] == 2316


def test_wybierz_zgodny_odrzuca_obcy_tytul():
    wyniki = [{"id": 309130, "name": "激战黄土岭", "original_name": "激战黄土岭", "first_air_date": "1995-01-01"}]

    assert dopasowanie.wybierz_zgodny(wyniki, "Biuro", "2005") is None


def test_wybierz_zgodny_bez_roku_nie_zgaduje():
    wyniki = [
        {"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"},
        {"id": 2996, "name": "Biuro", "original_name": "The Office", "first_air_date": "2001-07-09"},
    ]

    assert dopasowanie.wybierz_zgodny(wyniki, "Biuro", "") is None


def test_wybierz_zgodny_rok_z_pola_tytulu():
    """Rok dopisany w tytule („Maniac (2018)") też rozstrzyga."""
    wyniki = [
        {"id": 1, "name": "Maniac", "original_name": "Maniac", "first_air_date": "1974-01-01"},
        {"id": 2, "name": "Maniac", "original_name": "Maniac", "first_air_date": "2018-09-21"},
    ]

    trafienie = dopasowanie.wybierz_zgodny(wyniki, "Maniac (2018)", "")

    assert trafienie is not None and trafienie["id"] == 2
