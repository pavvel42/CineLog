"""B2: uszkodzony plik biblioteki oznacza odmowę, a nie cichą pustą listę.

Wcześniej `load_json` zwracał `[]` dla pustego/nieczytelnego pliku, a następny zapis
nadpisywał bibliotekę (50 filmów → 1). Cache'e (upcoming, VOD, rekomendacje) dalej
traktują uszkodzony plik jak pusty.
"""

from __future__ import annotations

import json
import os

import pytest

import app as app_module
from services import data_store
from services.data_store import LibraryCorruptError


def _zapisz(sciezka: str, tekst: str) -> None:
    with open(sciezka, "w", encoding="utf-8") as f:
        f.write(tekst)


def _kopie(sciezka: str) -> list[str]:
    katalog = os.path.dirname(sciezka)
    nazwa = os.path.basename(sciezka)
    return sorted(n for n in os.listdir(katalog) if n.startswith(nazwa + ".corrupt"))


# --- warstwa danych ---------------------------------------------------------------

def test_brak_pliku_biblioteki_to_pusta_lista(tmp_path):
    assert data_store.load_library(str(tmp_path / "nie-ma.json")) == []


def test_poprawna_biblioteka_jest_wczytana(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p, json.dumps([{"title": "A"}]))
    assert data_store.load_library(p) == [{"title": "A"}]


@pytest.mark.parametrize("tresc", ["", "   \n\t ", "{ucięty", "[{\"title\": \"A\"", '{"title": "A"}', "null", '"napis"'])
def test_uszkodzona_biblioteka_rzuca_wyjatek(tmp_path, tresc):
    p = str(tmp_path / "m.json")
    _zapisz(p, tresc)
    with pytest.raises(LibraryCorruptError):
        data_store.load_library(p)


def test_uszkodzony_plik_zostaje_nietkniety_i_ma_kopie(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p, "[{\"title\": \"A\"")
    with pytest.raises(LibraryCorruptError):
        data_store.load_library(p)
    assert open(p, encoding="utf-8").read() == "[{\"title\": \"A\""
    kopie = _kopie(p)
    assert kopie == ["m.json.corrupt"]
    assert open(p + ".corrupt", encoding="utf-8").read() == "[{\"title\": \"A\""


def test_powtorne_wczytanie_tego_samego_uszkodzenia_nie_mnozy_kopii(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p, "{ucięty")
    for _ in range(3):
        with pytest.raises(LibraryCorruptError):
            data_store.load_library(p)
    assert _kopie(p) == ["m.json.corrupt"]


def test_istniejacej_kopii_nie_nadpisujemy_dodajemy_znacznik_czasu(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p + ".corrupt", "STARA KOPIA")
    _zapisz(p, "{inne uszkodzenie")
    with pytest.raises(LibraryCorruptError):
        data_store.load_library(p)
    assert open(p + ".corrupt", encoding="utf-8").read() == "STARA KOPIA"
    kopie = _kopie(p)
    assert len(kopie) == 2
    nowa = [k for k in kopie if k != "m.json.corrupt"][0]
    assert open(str(tmp_path / nowa), encoding="utf-8").read() == "{inne uszkodzenie"


def test_load_json_dla_cache_dalej_traktuje_uszkodzony_plik_jak_pusty(tmp_path):
    p = str(tmp_path / "cache.json")
    _zapisz(p, "{ucięty")
    assert data_store.load_json(p) == []
    assert _kopie(p) == [], "cache nie jest biblioteką — nie robimy kopii"


def test_zapis_nie_nadpisuje_uszkodzonej_biblioteki(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p, "{ucięty")
    with pytest.raises(LibraryCorruptError):
        data_store.save_library(p, [{"title": "Nowy"}])
    assert open(p, encoding="utf-8").read() == "{ucięty"


def test_zapis_z_zezwoleniem_zastepuje_uszkodzona_biblioteke_zachowujac_kopie(tmp_path):
    p = str(tmp_path / "m.json")
    _zapisz(p, "{ucięty")
    assert data_store.save_library(p, [{"title": "Nowy"}], replace_corrupt=True) is True
    assert json.load(open(p, encoding="utf-8")) == [{"title": "Nowy"}]
    assert open(p + ".corrupt", encoding="utf-8").read() == "{ucięty"


def test_zapis_do_zdrowej_lub_nieistniejacej_biblioteki_dziala(tmp_path):
    p = str(tmp_path / "m.json")
    assert data_store.save_library(p, [{"title": "A"}]) is True
    assert data_store.save_library(p, [{"title": "B"}]) is True
    assert json.load(open(p, encoding="utf-8")) == [{"title": "B"}]


# --- trasy ------------------------------------------------------------------------

TRASY_ODCZYTU = [
    ("/api/movies", "MOVIES_FILE"),
    ("/api/shows", "SHOWS_FILE"),
    ("/api/export", "MOVIES_FILE"),
    ("/api/export", "SHOWS_FILE"),
]


@pytest.mark.parametrize(("sciezka", "plik"), TRASY_ODCZYTU)
def test_trasy_odczytu_odpowiadaja_json_500_przy_uszkodzonej_bibliotece(client, sciezka, plik):
    _zapisz(getattr(app_module, plik), "")
    res = client.get(sciezka)
    assert res.status_code == 500
    assert res.is_json, "błąd ma być JSON-em, a nie stroną HTML ze śladem stosu"
    body = res.get_json()
    assert body["corrupt"] is True
    assert "uszkodz" in body["error"].lower()
    assert "Traceback" not in res.get_data(as_text=True)


def test_dodanie_filmu_do_uszkodzonej_biblioteki_jest_odrzucone_i_plik_zostaje(client):
    _zapisz(app_module.MOVIES_FILE, "{ucięty")
    res = client.post("/api/movies", json={"title": "Nowy", "status": "watchlist"})
    assert res.status_code == 500
    assert res.get_json()["corrupt"] is True
    assert open(app_module.MOVIES_FILE, encoding="utf-8").read() == "{ucięty"


def test_dodanie_serialu_do_uszkodzonej_biblioteki_jest_odrzucone_i_plik_zostaje(client):
    _zapisz(app_module.SHOWS_FILE, "")
    res = client.post("/api/shows", json={"title": "Nowy"})
    assert res.status_code == 500
    assert res.get_json()["corrupt"] is True
    assert open(app_module.SHOWS_FILE, encoding="utf-8").read() == ""


def test_edycja_i_usuniecie_w_uszkodzonej_bibliotece_sa_odrzucone(client):
    _zapisz(app_module.MOVIES_FILE, "nie json")
    assert client.put("/api/movies/x", json={"status": "watched"}).status_code == 500
    assert client.delete("/api/movies/x").status_code == 500
    assert open(app_module.MOVIES_FILE, encoding="utf-8").read() == "nie json"


def test_import_zastepuje_uszkodzona_biblioteke_i_zachowuje_kopie(client):
    _zapisz(app_module.MOVIES_FILE, "{ucięty")
    res = client.post("/api/import", json={"movies": [{"title": "Z importu"}], "shows": []})
    assert res.status_code == 200
    assert client.get("/api/movies").get_json()[0]["title"] == "Z importu"
    assert open(app_module.MOVIES_FILE + ".corrupt", encoding="utf-8").read() == "{ucięty"


def test_cache_upcoming_uszkodzony_nie_wywala_trasy(client):
    _zapisz(app_module.UPCOMING_CACHE_FILE, "{ucięty")
    assert client.get("/api/upcoming").status_code == 200


def test_cache_vod_uszkodzony_traktowany_jak_pusty(client):
    _zapisz(app_module.VOD_CACHE_FILE, "{ucięty")
    assert app_module.load_vod_cache() == {}
