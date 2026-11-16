"""B5: każde dopasowanie wyniku wyszukiwania przechodzi przez `wybierz_zgodny`.

Źródła zwracają listę „po trafności”, więc brany z niej pierwszy (albo najpopularniejszy)
wynik bywał cudzą produkcją. Reguła: tylko trafienie zgodne tytułem (i rokiem ±1, gdy rok
znany); przy braku pewnego trafienia — brak danych, nie cudze dane.
"""

from __future__ import annotations

import io
import json
import urllib.request

import pytest

import app as app_module
from services import episodes_meta, vod_providers

KLUCZ = "klucz-testowy"


class _Odpowiedz(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_) -> None:
        return None


def _urlopen(trasy: dict[str, object], wywolania: list[str]):
    """Atrapa `urlopen`: odpowiada JSON-em wg fragmentu adresu, zapisuje każde wywołanie."""
    def atrapa(zadanie, timeout=None, **_):
        url = zadanie.full_url if hasattr(zadanie, "full_url") else str(zadanie)
        wywolania.append(url)
        for fragment, odpowiedz in trasy.items():
            if fragment in url:
                return _Odpowiedz(json.dumps(odpowiedz).encode("utf-8"))
        return _Odpowiedz(b"{}")
    return atrapa


def _wywolano(wywolania: list[str], fragment: str) -> bool:
    return any(fragment in u for u in wywolania)


# --- VOD (services/vod_providers.py) ----------------------------------------------

def _tmdb_get(odpowiedzi: dict[str, object], wywolania: list[str]):
    def atrapa(sciezka, params=None, **_):
        wywolania.append(sciezka)
        return odpowiedzi.get(sciezka)
    return atrapa


def test_vod_nie_bierze_najpopularniejszego_wyniku_o_innym_tytule(monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(vod_providers, "tmdb_get", _tmdb_get({
        "/search/movie": {"results": [{"id": 1, "title": "Zupełnie Inny Film", "popularity": 900}]},
        "/search/tv": {"results": [{"id": 2, "name": "Też Nie Ten", "popularity": 800}]},
    }, wywolania))
    wynik = vod_providers.fetch_live_watch_providers("dune", "movie", "PL", tmdb_api_key=KLUCZ)
    assert wynik == vod_providers._empty_result("PL")
    assert not [s for s in wywolania if "/watch/providers" in s], "nie pobieramy platform cudzego tytułu"


def test_vod_przyjmuje_zgodny_tytul_nawet_gdy_inny_wynik_jest_popularniejszy(monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(vod_providers, "tmdb_get", _tmdb_get({
        "/search/movie": {"results": [
            {"id": 1, "title": "Zupełnie Inny Film", "popularity": 900},
            {"id": 7, "title": "Dune", "popularity": 5},
        ]},
    }, wywolania))
    vod_providers.fetch_live_watch_providers("dune", "movie", "PL", tmdb_api_key=KLUCZ)
    assert "/movie/7/watch/providers" in wywolania


def test_vod_dwa_zgodne_tytuly_bez_roku_to_brak_danych(monkeypatch):
    """Dwie wersje o tym samym tytule (remake) i brak roku — nie zgadujemy."""
    wywolania: list[str] = []
    monkeypatch.setattr(vod_providers, "tmdb_get", _tmdb_get({
        "/search/movie": {"results": [
            {"id": 1, "title": "Dune", "release_date": "1984-12-14", "popularity": 20},
            {"id": 2, "title": "Dune", "release_date": "2021-09-15", "popularity": 90},
        ]},
    }, wywolania))
    wynik = vod_providers.fetch_live_watch_providers("dune", "movie", "PL", tmdb_api_key=KLUCZ)
    assert wynik == vod_providers._empty_result("PL")
    assert not [s for s in wywolania if "/watch/providers" in s]


def test_vod_zapasowy_typ_mediow_tez_wymaga_zgodnego_tytulu(monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(vod_providers, "tmdb_get", _tmdb_get({
        "/search/tv": {"results": [{"id": 3, "name": "Cokolwiek Popularnego", "popularity": 999}]},
    }, wywolania))
    wynik = vod_providers.fetch_live_watch_providers("dune", "movie", "PL", tmdb_api_key=KLUCZ)
    assert wynik == vod_providers._empty_result("PL")
    assert not [s for s in wywolania if "/watch/providers" in s]


def test_vod_zapasowy_typ_mediow_przyjmuje_zgodny_tytul(monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(vod_providers, "tmdb_get", _tmdb_get({
        "/search/tv": {"results": [{"id": 11, "name": "Dune", "popularity": 1}]},
    }, wywolania))
    vod_providers.fetch_live_watch_providers("dune", "movie", "PL", tmdb_api_key=KLUCZ)
    assert "/tv/11/watch/providers" in wywolania


# --- odcinki (services/episodes_meta.py) ------------------------------------------

def _meta_atrapy(monkeypatch, wyniki_tv: list[dict], tvmaze: dict | None = None):
    wywolania: list[str] = []
    monkeypatch.setattr(episodes_meta, "tmdb_get", _tmdb_get({
        "/search/tv": {"results": wyniki_tv},
        "/tv/5": {"seasons": [{"season_number": 1}]},
        "/tv/5/season/1": {"episodes": [{"episode_number": 1, "name": "Pilot", "overview": "opis"}]},
    }, wywolania))
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({"tvmaze.com": tvmaze or {}}, wywolania))
    return wywolania


def test_odcinki_dwa_seriale_o_tym_samym_tytule_bez_roku_to_brak_odcinkow(monkeypatch):
    wywolania = _meta_atrapy(monkeypatch, [
        {"id": 5, "name": "Battlestar Galactica", "first_air_date": "1978-09-17"},
        {"id": 6, "name": "Battlestar Galactica", "first_air_date": "2004-12-08"},
    ])
    assert episodes_meta.fetch_episodes_meta("Battlestar Galactica", None, "pl-PL", KLUCZ) == {}
    assert not [s for s in wywolania if s.startswith("/tv/")]


def test_odcinki_rok_w_tytule_rozstrzyga_miedzy_wersjami(monkeypatch):
    wywolania = _meta_atrapy(monkeypatch, [
        {"id": 6, "name": "Battlestar Galactica", "first_air_date": "1978-09-17"},
        {"id": 5, "name": "Battlestar Galactica", "first_air_date": "2004-12-08"},
    ])
    meta = episodes_meta.fetch_episodes_meta("Battlestar Galactica (2004)", None, "pl-PL", KLUCZ)
    assert "1_1" in meta
    assert "/tv/5" in wywolania and "/tv/6" not in wywolania


def test_odcinki_tvmaze_obcy_serial_nie_dolacza_swoich_odcinkow(monkeypatch):
    """`singlesearch` TVmaze sam wybiera „najbliższy” serial — jego odcinki wolno dołączyć
    tylko, gdy nazwa serialu zgadza się z naszym tytułem."""
    cudze = {"name": "Zupełnie Inny Serial", "_embedded": {"episodes": [
        {"season": 1, "number": 1, "name": "Cudzy odcinek", "summary": "<p>cudzy opis</p>"},
    ]}}
    _meta_atrapy(monkeypatch, [], tvmaze=cudze)
    assert episodes_meta.fetch_episodes_meta("Dune", None, "pl-PL", KLUCZ) == {}


def test_odcinki_tvmaze_zgodny_serial_uzupelnia_odcinki(monkeypatch):
    swoje = {"name": "Dune", "premiered": "2021-01-01", "_embedded": {"episodes": [
        {"season": 1, "number": 1, "name": "Pilot", "summary": "<p>opis</p>"},
    ]}}
    _meta_atrapy(monkeypatch, [], tvmaze=swoje)
    meta = episodes_meta.fetch_episodes_meta("Dune", None, "pl-PL", KLUCZ)
    assert meta["1_1"]["summary"] == "opis"


# --- rekomendacje (routes/recommendations.py) -------------------------------------

@pytest.fixture()
def z_kluczem(monkeypatch):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", KLUCZ)


def test_rekomendacje_nie_bior_pierwszego_wyniku_o_innym_tytule(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/movie": {"results": [{"id": 9, "title": "Zupełnie Inny Film"}]},
    }, wywolania))
    res = client.get("/api/recommendations/for_item?title=Dune&media_type=movie")
    assert res.get_json()["results"] == []
    assert not _wywolano(wywolania, "/movie/9/"), "nie pobieramy rekomendacji cudzego filmu"


def test_rekomendacje_dwa_zgodne_tytuly_bez_roku_to_brak_danych(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/movie": {"results": [
            {"id": 1, "title": "Dune", "release_date": "1984-12-14"},
            {"id": 2, "title": "Dune", "release_date": "2021-09-15"},
        ]},
    }, wywolania))
    client.get("/api/recommendations/for_item?title=Dune&media_type=movie")
    assert not _wywolano(wywolania, "/movie/1/") and not _wywolano(wywolania, "/movie/2/")


def test_rekomendacje_rok_w_tytule_wybiera_wlasciwa_wersje(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/movie": {"results": [
            {"id": 1, "title": "Dune", "release_date": "1984-12-14"},
            {"id": 2, "title": "Dune", "release_date": "2021-09-15"},
        ]},
    }, wywolania))
    client.get("/api/recommendations/for_item?title=Dune%20(2021)&media_type=movie")
    assert _wywolano(wywolania, "/movie/2/") and not _wywolano(wywolania, "/movie/1/")


def test_aktor_wyszukiwany_po_nazwisku_nie_bierze_pierwszego_z_brzegu(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/person": {"results": [{"id": 9, "name": "Ktoś Całkiem Inny"}]},
    }, wywolania))
    client.get("/api/actor/details?name=Chris%20Evans")
    assert not _wywolano(wywolania, "/person/9"), "nie pobieramy filmografii cudzej osoby"


def test_aktor_przy_imiennikach_wybiera_pierwsza_osobe_o_tym_nazwisku(client, z_kluczem, monkeypatch):
    """Osoby nie mają roku, którym dałoby się rozstrzygnąć imienników. TMDb sortuje trafienia
    od najbardziej znanej osoby, więc bierzemy pierwszą o dokładnie tym nazwisku — tak samo
    jak ścieżka kliencka (`resolveTmdbPersonId` w cast.js). Odmowa oznaczała pusty profil
    dla każdego twórcy z imiennikiem (Chris Evans, John Williams)."""
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/person": {"results": [
            {"id": 9, "name": "Chris Evans Jr."},
            {"id": 1, "name": "Chris Evans"},
            {"id": 2, "name": "Chris Evans"},
        ]},
        "/person/1": {"id": 1, "name": "Chris Evans"},
    }, wywolania))
    res = client.get("/api/actor/details?name=Chris%20Evans")
    assert res.status_code == 200
    assert res.get_json()["id"] == 1
    assert _wywolano(wywolania, "/person/1")
    assert not _wywolano(wywolania, "/person/2") and not _wywolano(wywolania, "/person/9")


def test_aktor_zgodne_nazwisko_jest_przyjete(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/person": {"results": [{"id": 5, "name": "Chris Evans"}]},
        "/person/5": {"id": 5, "name": "Chris Evans"},
    }, wywolania))
    client.get("/api/actor/details?name=Chris%20Evans")
    assert _wywolano(wywolania, "/person/5")


# --- harmonogram premier (routes/upcoming.py) -------------------------------------

def _zaseeduj_serial(tytul: str) -> None:
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": tytul, "status": "watching"}])


def test_harmonogram_dwa_zgodne_tytuly_bez_roku_to_brak_danych(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/tv": {"results": [
            {"id": 1, "name": "Battlestar Galactica", "first_air_date": "1978-09-17"},
            {"id": 2, "name": "Battlestar Galactica", "first_air_date": "2004-12-08"},
        ]},
    }, wywolania))
    _zaseeduj_serial("Battlestar Galactica")
    client.get("/api/upcoming?refresh=1")
    assert not _wywolano(wywolania, "/tv/1?") and not _wywolano(wywolania, "/tv/2?")


def test_harmonogram_rok_w_tytule_wybiera_wlasciwa_wersje(client, z_kluczem, monkeypatch):
    wywolania: list[str] = []
    monkeypatch.setattr(urllib.request, "urlopen", _urlopen({
        "/search/tv": {"results": [
            {"id": 1, "name": "Battlestar Galactica", "first_air_date": "1978-09-17"},
            {"id": 2, "name": "Battlestar Galactica", "first_air_date": "2004-12-08"},
        ]},
    }, wywolania))
    _zaseeduj_serial("Battlestar Galactica (2004)")
    client.get("/api/upcoming?refresh=1")
    assert _wywolano(wywolania, "/tv/2?") and not _wywolano(wywolania, "/tv/1?")
