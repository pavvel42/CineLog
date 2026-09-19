"""Testy konwertera eksportu TVTime → plik importu CineLog (scripts/tvtime_to_cinelog.py).

Sedno jest w regułach scalania: biblioteka użytkownika ma już dane z TVTime, więc
konwersja nie może nadpisywać ocen, statusów ani identyfikatorów wewnętrznych —
wolno jej tylko uzupełniać braki i dodawać to, czego w bibliotece nie ma.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "tvtime_to_cinelog.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("tvtime_to_cinelog", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def ttc():
    return _load_module()


# --- normalizacja tytułów -------------------------------------------------

@pytest.mark.parametrize("tytul,oczekiwane", [
    ("Diuna: Proroctwo", "diunaproroctwo"),
    ("Amélie", "amelie"),
    ("365 dni", "365dni"),
    ("The Curse", "thecurse"),
    ("Papierowe życie", "papierowezycie"),
    ("", ""),
    (None, ""),
])
def test_normalizuj_tytul(ttc, tytul, oczekiwane):
    assert ttc.normalizuj_tytul(tytul) == oczekiwane


# --- daty -----------------------------------------------------------------

@pytest.mark.parametrize("wejscie,oczekiwane", [
    ("2020-04-13T23:31:57Z", "2020-04-13 23:31:57"),
    ("2020-04-13T23:31:57.123456Z", "2020-04-13 23:31:57"),
    ("2020-04-13 23:31:57", "2020-04-13 23:31:57"),
    (None, None),
    ("", None),
    ("nie-data", None),
])
def test_formatuj_date(ttc, wejscie, oczekiwane):
    assert ttc.formatuj_date(wejscie) == oczekiwane


# --- scalanie filmu -------------------------------------------------------

def _film_bazy(**nadpisz):
    film = {
        "uuid": "aaaaaaaa-1111-2222-3333-444444444444",
        "title": "Diuna",
        "status": "watched",
        "rating": 5,
        "watch_date": "2026-08-20 22:11:36",
        "poster_url": "https://image.tmdb.org/t/p/w500/x.jpg",
        "is_favorite": False,
        "rewatched": 0,
        "release_date": "2021-10-22",
    }
    film.update(nadpisz)
    return film


def _film_tvtime(**nadpisz):
    film = {
        "uuid": "bbbbbbbb-1111-2222-3333-444444444444",
        "title": "Dune",
        "year": 2021,
        "created_at": "2021-06-01T10:00:00Z",
        "watched_at": "2021-10-25T20:15:00Z",
        "is_watched": True,
        "is_favorite": True,
        "rewatch_count": 2,
        "id": {"tvdb": 123, "imdb": "tt1160419"},
    }
    film.update(nadpisz)
    return film


def test_scal_film_nie_nadpisuje_oceny_ani_statusu(ttc):
    scalony = ttc.scal_film(_film_bazy(), _film_tvtime(), None)
    assert scalony["rating"] == 5
    assert scalony["status"] == "watched"
    assert scalony["uuid"] == "aaaaaaaa-1111-2222-3333-444444444444"


def test_scal_film_nie_nadpisuje_istniejacej_daty_seansu(ttc):
    scalony = ttc.scal_film(_film_bazy(), _film_tvtime(), None)
    assert scalony["watch_date"] == "2026-08-20 22:11:36"


def test_scal_film_uzupelnia_identyfikatory_z_tmdb(ttc):
    tmdb = {"id": 438631, "original_title": "Dune", "release_date": "2021-10-22",
            "runtime": 155, "overview": "Opis", "genres": [{"name": "Sci-Fi"}]}
    scalony = ttc.scal_film(_film_bazy(), _film_tvtime(), tmdb)
    assert scalony["tmdb_id"] == 438631
    assert scalony["imdb_id"] == "tt1160419"
    assert scalony["runtime"] == 155
    assert scalony["plot"] == "Opis"


def test_scal_film_bierze_datę_z_tvtime_gdy_brak_w_bazie(ttc):
    scalony = ttc.scal_film(_film_bazy(watch_date=None), _film_tvtime(), None)
    assert scalony["watch_date"] == "2021-10-25 20:15:00"


def test_scal_film_ulubione_i_rewatch_to_suma_max(ttc):
    scalony = ttc.scal_film(_film_bazy(is_favorite=False, rewatched=1), _film_tvtime(), None)
    assert scalony["is_favorite"] is True
    assert scalony["rewatched"] == 2


# --- scalanie serialu -----------------------------------------------------

def _serial_bazy(**nadpisz):
    serial = {
        "uuid": "cccccccc-1111-2222-3333-444444444444",
        "title": "Diuna: Proroctwo",
        "tmdb_id": "90228",
        "status": "watching",
        "rating": 4,
        "total_episodes": 6,
        "episodes_watched": [{"season": 1, "episode": 1}, {"season": 1, "episode": 2}],
        "watched_count": 2,
    }
    serial.update(nadpisz)
    return serial


def test_scal_serial_union_odcinkow_bez_duplikatow(ttc):
    odcinki = [(1, 1), (1, 2), (1, 3), (0, 1), (1, 4)]
    scalony = ttc.scal_serial(_serial_bazy(), odcinki, None)
    assert scalony["episodes_watched"] == [
        {"season": 0, "episode": 1},
        {"season": 1, "episode": 1}, {"season": 1, "episode": 2},
        {"season": 1, "episode": 3}, {"season": 1, "episode": 4},
    ]
    assert scalony["watched_count"] == 5


def test_scal_serial_zachowuje_speciale_z_biblioteki(ttc):
    """Aplikacja zapisuje odhaczone speciale (sezon 0) — scalanie nie może ich zgubić."""
    bazowy = _serial_bazy(episodes_watched=[{"season": 0, "episode": 1}, {"season": 1, "episode": 1}])
    scalony = ttc.scal_serial(bazowy, [], None)
    assert {"season": 0, "episode": 1} in scalony["episodes_watched"]
    assert scalony["watched_count"] == 2


def test_scal_serial_status_liczy_tylko_zwykle_sezony(ttc):
    """Speciale nie mogą udawać ukończenia: liczy się postęp w zwykłych sezonach."""
    bazowy = _serial_bazy(total_episodes=2, episodes_watched=[])
    scalony = ttc.scal_serial(bazowy, [(0, 1), (0, 2), (0, 3), (1, 1)], None)
    assert scalony["watched_count"] == 4
    assert scalony["status"] == "watching"  # 1 z 2 zwykłych odcinków


def test_scal_serial_przelicza_pola_pochodne(ttc):
    odcinki = [(1, 1), (1, 2), (1, 3)]
    scalony = ttc.scal_serial(_serial_bazy(), odcinki, None)
    assert scalony["latest_progress"] == "S01E03"
    assert scalony["latest_season"] == 1
    assert scalony["latest_episode"] == 3


def test_scal_serial_zachowuje_ocene_i_uuid(ttc):
    scalony = ttc.scal_serial(_serial_bazy(), [(1, 1)], None)
    assert scalony["rating"] == 4
    assert scalony["uuid"] == "cccccccc-1111-2222-3333-444444444444"


def test_scal_serial_nie_zeruje_metadanych_gdy_tmdb_ich_nie_podaje(ttc):
    scalony = ttc.scal_serial(_serial_bazy(), [(1, 1)], {"number_of_episodes": 0, "status": None})
    assert scalony["total_episodes"] == 6
    assert scalony["status"] == "watching"


def test_scal_serial_uzupelnia_metadane_i_sezony_z_tmdb(ttc):
    tmdb = {
        "number_of_episodes": 6,
        "number_of_seasons": 1,
        "status": "Ended",
        "in_production": False,
        "seasons": [{"season_number": 0, "episode_count": 3}, {"season_number": 1, "episode_count": 6}],
        "overview": "Opis",
    }
    scalony = ttc.scal_serial(_serial_bazy(), [(1, 1)], tmdb)
    assert scalony["series_status"] == "Ended"
    assert scalony["in_production"] is False
    assert scalony["season_ep_counts"] == {"1": 6}
    assert scalony["total_seasons"] == 1


def test_scal_serial_watchlist_z_postepem_staje_sie_ogladany(ttc):
    scalony = ttc.scal_serial(_serial_bazy(status="watchlist", episodes_watched=[]), [(1, 1)], None)
    assert scalony["status"] == "watching"


def test_scal_serial_zmienia_status_tylko_gdy_wolno(ttc):
    assert ttc.scal_serial(_serial_bazy(status="watched"), [(1, 1)], None)["status"] == "watched"
    assert ttc.scal_serial(_serial_bazy(status="watchlist", episodes_watched=[]), [], None)["status"] == "watchlist"


# --- konwersja czysta (bez bazy) -----------------------------------------

def test_zbuduj_film_z_tvtime_obejrzany(ttc):
    film = ttc.zbuduj_film_z_tvtime(_film_tvtime(), None)
    assert film["status"] == "watched"
    assert film["uuid"] == "bbbbbbbb-1111-2222-3333-444444444444"
    assert film["watch_date"] == "2021-10-25 20:15:00"
    assert film["year"] == "2021"
    assert film["imdb_id"] == "tt1160419"
    assert film["rating"] is None


def test_zbuduj_film_z_tvtime_do_obejrzenia(ttc):
    film = ttc.zbuduj_film_z_tvtime(
        _film_tvtime(is_watched=False, watched_at=None), None)
    assert film["status"] == "watchlist"
    assert film["watch_date"] is None


def test_zbuduj_serial_z_tvtime_ma_pola_pochodne(ttc):
    serial = {
        "uuid": "dddddddd-1111-2222-3333-444444444444",
        "id": {"tvdb": 1, "imdb": None},
        "created_at": "2024-02-18T18:12:13Z",
        "title": "The Curse",
        "status": "up_to_date",
        "is_favorite": False,
        "seasons": [{"number": 1, "episodes": [{"number": 1}, {"number": 2}]}],
    }
    zbudowany = ttc.zbuduj_serial_z_tvtime(serial, [(1, 1), (1, 2)], None)
    assert zbudowany["status"] == "watching"
    assert zbudowany["uuid"] == "dddddddd-1111-2222-3333-444444444444"
    assert zbudowany["watched_count"] == 2
    assert zbudowany["latest_progress"] == "S01E02"
    assert zbudowany["season_ep_counts"] == {"1": 2}


def test_zbuduj_serial_z_tvtime_nierozpoczety_to_watchlist(ttc):
    serial = {
        "uuid": "eeeeeeee-1111-2222-3333-444444444444",
        "id": {"tvdb": 2, "imdb": None},
        "created_at": "2024-02-18T18:12:13Z",
        "title": "Cos",
        "status": "not_started_yet",
        "is_favorite": False,
        "seasons": [],
    }
    zbudowany = ttc.zbuduj_serial_z_tvtime(serial, [], None)
    assert zbudowany["status"] == "watchlist"
    assert zbudowany["watched_count"] == 0
    assert zbudowany["latest_progress"] is None


# --- odczyty plików -------------------------------------------------------

def test_wczytaj_odcinki_z_csv_grupuje_po_serialu(ttc, tmp_path):
    csv_plik = tmp_path / "tvtime-series-episodes-2026-07-12.csv"
    csv_plik.write_text(
        "series_tvdb_id,series_imdb_id,series_uuid,title,season,episode,tvdb_id,is_watched,watched_at,rewatch_count,special\n"
        "1,,uuid-1,Serial,1,1,11,true,2024-01-01T00:00:00Z,0,false\n"
        "1,,uuid-1,Serial,1,2,12,false,,0,false\n"
        "1,,uuid-1,Serial,0,1,10,true,2024-01-01T00:00:00Z,0,true\n",
        encoding="utf-8",
    )
    odcinki = ttc.wczytaj_odcinki(csv_plik)
    assert set(odcinki) == {"uuid-1"}
    assert odcinki["uuid-1"] == [(1, 1), (0, 1)]  # tylko obejrzane, specjalne nadal w danych


def test_wczytaj_baze_przyjmuje_liste_i_slownik(ttc, tmp_path):
    lista = tmp_path / "lista.json"
    lista.write_text('[{"title": "A"}]', encoding="utf-8")
    assert ttc.wczytaj_baze(lista)["movies"] == [{"title": "A"}]

    slownik = tmp_path / "slownik.json"
    slownik.write_text('{"movies": [{"title": "M"}], "shows": [{"title": "S"}]}', encoding="utf-8")
    baza = ttc.wczytaj_baze(slownik)
    assert baza["movies"] == [{"title": "M"}]
    assert baza["shows"] == [{"title": "S"}]


# --- dopasowanie pozycji TVTime do biblioteki ----------------------------

def test_znajdz_cel_dopasowuje_po_uuid(ttc):
    baza = [{"uuid": "u-1", "title": "365 dni", "status": "watched"}]
    indeks = ttc.zbuduj_indeksy(baza)
    cel = ttc.znajdz_cel({"uuid": "u-1", "title": "365 Days"}, indeks, None)
    assert cel is baza[0]


def test_znajdz_cel_dopasowuje_po_tmdb_id(ttc):
    baza = [{"uuid": "u-1", "title": "Inne tlumaczenie", "tmdb_id": 12345}]
    indeks = ttc.zbuduj_indeksy(baza)
    cel = ttc.znajdz_cel({"uuid": "inny", "title": "Original Title"}, indeks, 12345)
    assert cel is baza[0]


def test_znajdz_cel_dopasowuje_po_tytule(ttc):
    baza = [{"uuid": "u-1", "title": "Diuna: Proroctwo"}]
    indeks = ttc.zbuduj_indeksy(baza)
    assert ttc.znajdz_cel({"uuid": "x", "title": "DIUNA PROROCTWO"}, indeks, None) is baza[0]


def test_znajdz_cel_dopasowuje_tytul_z_literowka(ttc):
    baza = [{"uuid": "u-1", "title": "Pluribus"}]
    indeks = ttc.zbuduj_indeksy(baza)
    assert ttc.znajdz_cel({"uuid": "x", "title": "PLUR1BUS"}, indeks, None) is baza[0]


def test_znajdz_cel_nie_scala_roznych_tytulow(ttc):
    baza = [{"uuid": "u-1", "title": "The Curse"}]
    indeks = ttc.zbuduj_indeksy(baza)
    assert ttc.znajdz_cel({"uuid": "x", "title": "Cursed"}, indeks, None) is None


def test_znajdz_cel_bez_dopasowania(ttc):
    indeks = ttc.zbuduj_indeksy([{"uuid": "u-1", "title": "Alien"}])
    assert ttc.znajdz_cel({"uuid": "x", "title": "Cos zupelnie innego"}, indeks, 999) is None


def test_pozycje_bez_tytulu_sa_pomijane(ttc):
    assert ttc.zbuduj_film_z_tvtime({"uuid": "x", "title": ""}, None) is None
    assert ttc.zbuduj_serial_z_tvtime({"uuid": "x", "title": "   "}, [], None) is None
