"""Testy scalania dwóch plików CineLog (scripts/scal_cinelog.py).

Reguła nadrzędna: baza (pierwszy plik) jest prawdą użytkownika — jej tytuły,
statusy, oceny, daty i historia odcinków wygrywają. Drugi plik wolno jej tylko
uzupełniać puste pola (metadane z TMDb/TVTime) i dodawać pozycje, których
w bibliotece nie ma.

Pułapka, którą te testy pilnują: odcinki z eksportu aplikacji mają `episode_id`,
`created_at` i `runtime`, a odcinki z pliku importu tylko `season`/`episode`.
Przebudowanie historii z drugiego pliku skasowałoby te dodatkowe pola, więc
historia musi zostać nietknięta.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "scal_cinelog.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("scal_cinelog", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def sc():
    return _load_module()


def film(**nadpisz):
    wpis = {
        "uuid": "uuid-film",
        "title": "Film",
        "original_title": "",
        "year": 2020,
        "genre": "Dramat",
        "status": "watched",
        "rating": None,
        "watch_date": None,
        "follow_date": None,
        "user_date": None,
        "tmdb_id": None,
        "imdb_id": None,
        "plot": "",
        "runtime": 0,
        "poster_url": "",
        "cast": [],
        "director": "",
        "is_favorite": False,
        "rewatched": False,
    }
    wpis.update(nadpisz)
    return wpis


def serial(**nadpisz):
    wpis = {
        "uuid": "uuid-serial",
        "title": "Serial",
        "status": "watching",
        "rating": None,
        "tmdb_id": None,
        "imdb_id": None,
        "plot": "",
        "poster_url": "",
        "season_ep_counts": {},
        "total_episodes": 0,
        "total_seasons": 0,
        "series_status": "",
        "in_production": None,
        "watched_count": 0,
        "caught_up": False,
        "is_favorite": False,
        "archived": False,
        "episodes_watched": [],
    }
    wpis.update(nadpisz)
    return wpis


def odcinek(sezon, numer, **nadpisz):
    wpis = {"season": sezon, "episode": numer}
    wpis.update(nadpisz)
    return wpis


def biblioteka(movies=None, shows=None):
    return {"movies": movies or [], "shows": shows or []}


# --- dopasowanie -------------------------------------------------------------


def test_scala_po_uuid_nawet_gdy_tytuly_sie_roznia(sc):
    baza = biblioteka([film(uuid="u1", title="Diuna")])
    drugi = biblioteka([film(uuid="u1", title="Dune", tmdb_id=438631)])
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    assert len(wynik["movies"]) == 1
    assert wynik["movies"][0]["title"] == "Diuna"
    assert wynik["movies"][0]["tmdb_id"] == 438631
    assert raport["scalone"]["filmy"] == 1


def test_scala_po_tytule_gdy_brak_uuid_w_drugim_pliku(sc):
    baza = biblioteka([film(uuid="u1", title="Zielona Mila")])
    drugi = biblioteka([film(uuid="", title="zielona mila", imdb_id="tt0120689")])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    assert len(wynik["movies"]) == 1
    assert wynik["movies"][0]["imdb_id"] == "tt0120689"


def test_nie_scala_roznych_filmow_o_podobnym_tytule(sc):
    baza = biblioteka([film(uuid="u1", title="Diuna", year=2021)])
    drugi = biblioteka([film(uuid="u2", title="Diuna: Część druga", year=2024)])
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    assert [m["title"] for m in wynik["movies"]] == ["Diuna", "Diuna: Część druga"]
    assert raport["dodane"]["filmy"] == 1


# --- baza wygrywa ------------------------------------------------------------


def test_baza_wygrywa_tytul_status_ocene_i_date(sc):
    baza = biblioteka([film(title="Diuna", status="watched", rating=5, watch_date="2024-03-01")])
    drugi = biblioteka([film(title="Dune", status="watchlist", rating=3, watch_date="2019-01-01")])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    wpis = wynik["movies"][0]
    assert (wpis["title"], wpis["status"], wpis["rating"], wpis["watch_date"]) == ("Diuna", "watched", 5, "2024-03-01")


def test_status_nie_jest_degradowany(sc):
    baza = biblioteka([film(status="watchlist")])
    drugi = biblioteka([film(status="watched")])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    assert wynik["movies"][0]["status"] == "watchlist"


def test_uzupelnia_puste_pola_metadanymi(sc):
    baza = biblioteka([film(tmdb_id=None, plot="", runtime=0, original_title="", imdb_id=None)])
    drugi = biblioteka([film(tmdb_id=438631, plot="Opis z TMDb", runtime=155, original_title="Dune", imdb_id="tt1160419")])
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    wpis = wynik["movies"][0]
    assert (wpis["tmdb_id"], wpis["plot"], wpis["runtime"], wpis["original_title"], wpis["imdb_id"]) == (
        438631, "Opis z TMDb", 155, "Dune", "tt1160419",
    )
    assert raport["uzupelnione"]["filmy"]["tmdb_id"] == 1


def test_nie_nadpisuje_niepustych_pol(sc):
    baza = biblioteka([film(plot="Opis z bazy", rating=4)])
    drugi = biblioteka([film(plot="Inny opis", rating=2)])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    assert wynik["movies"][0]["plot"] == "Opis z bazy"
    assert wynik["movies"][0]["rating"] == 4


def test_uzupelnia_ocene_datę_i_ulubione_gdy_baza_pusta(sc):
    baza = biblioteka([film(rating=None, watch_date=None, is_favorite=False, rewatched=False)])
    drugi = biblioteka([film(rating=5, watch_date="2019-08-01", is_favorite=True, rewatched=True)])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    wpis = wynik["movies"][0]
    assert (wpis["rating"], wpis["watch_date"], wpis["is_favorite"], wpis["rewatched"]) == (5, "2019-08-01", True, True)


def test_ulubione_i_powtorki_lacza_sie_sumujaco(sc):
    baza = biblioteka([film(is_favorite=True, rewatched=False)])
    drugi = biblioteka([film(is_favorite=False, rewatched=True)])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    assert (wynik["movies"][0]["is_favorite"], wynik["movies"][0]["rewatched"]) == (True, True)


# --- seriale: historia odcinków nietknięta -----------------------------------


def test_odcinki_zostaja_z_bazy_w_oryginalnym_ksztalcie(sc):
    baza = biblioteka(shows=[serial(episodes_watched=[odcinek(1, 1, episode_id="abc", created_at="2026-08-14 19:46:23", runtime=42)])])
    drugi = biblioteka(shows=[serial(episodes_watched=[odcinek(1, 1), odcinek(1, 2), odcinek(2, 1)])])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    odcinki = wynik["shows"][0]["episodes_watched"]
    assert len(odcinki) == 1
    assert odcinki[0] == odcinek(1, 1, episode_id="abc", created_at="2026-08-14 19:46:23", runtime=42)


def test_uzupelnia_metadane_serialu_w_tym_season_ep_counts(sc):
    baza = biblioteka(shows=[serial(season_ep_counts={}, total_episodes=0, plot="", series_status="")])
    drugi = biblioteka(shows=[serial(season_ep_counts={"1": 8, "2": 8}, total_episodes=16, plot="Opis serialu", series_status="Ended")])
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    wpis = wynik["shows"][0]
    assert wpis["season_ep_counts"] == {"1": 8, "2": 8}
    assert (wpis["total_episodes"], wpis["plot"], wpis["series_status"]) == (16, "Opis serialu", "Ended")
    assert raport["uzupelnione"]["seriale"]["season_ep_counts"] == 1


def test_nie_zmienia_odcinkow_gdy_drugi_plik_ma_ich_wiecej(sc):
    baza = biblioteka(shows=[serial(episodes_watched=[odcinek(1, 1)])])
    drugi = biblioteka(shows=[serial(episodes_watched=[odcinek(1, 1), odcinek(1, 2), odcinek(1, 3)])])
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    assert len(wynik["shows"][0]["episodes_watched"]) == 1
    assert raport["uzupelnione"]["seriale"].get("episodes_watched", 0) == 0


# --- pozycje dodawane i kolejność --------------------------------------------


def test_dodaje_pozycje_obecne_tylko_w_drugim_pliku(sc):
    baza = biblioteka([film(uuid="u1", title="Film z bazy")], [serial(uuid="s1", title="Serial z bazy")])
    drugi = biblioteka(
        [film(uuid="u9", title="Film z importu")],
        [serial(uuid="s9", title="Serial z importu", episodes_watched=[odcinek(1, 1)])],
    )
    wynik, raport = sc.scal_biblioteki(baza, drugi)
    assert [m["title"] for m in wynik["movies"]] == ["Film z bazy", "Film z importu"]
    assert [s["title"] for s in wynik["shows"]] == ["Serial z bazy", "Serial z importu"]
    assert (raport["dodane"]["filmy"], raport["dodane"]["seriale"]) == (1, 1)


def test_kolejnosc_bazy_jest_zachowana(sc):
    baza = biblioteka([film(uuid="u1", title="Pierwszy"), film(uuid="u2", title="Drugi")])
    drugi = biblioteka([film(uuid="u2", title="Drugi", plot="x"), film(uuid="u3", title="Trzeci")])
    wynik, _ = sc.scal_biblioteki(baza, drugi)
    assert [m["title"] for m in wynik["movies"]] == ["Pierwszy", "Drugi", "Trzeci"]


def test_raport_podaje_liczby_wejscia_i_wyjscia(sc):
    baza = biblioteka([film(uuid="u1", title="Jeden"), film(uuid="u2", title="Dwa")], [serial(uuid="s1", title="Serial")])
    drugi = biblioteka([film(uuid="u1", title="Jeden", tmdb_id=1), film(uuid="u9", title="Dziewięć")], [serial(uuid="s1", title="Serial", plot="opis")])
    _, raport = sc.scal_biblioteki(baza, drugi)
    assert raport["baza"] == {"filmy": 2, "seriale": 1}
    assert raport["uzupelnienie"] == {"filmy": 2, "seriale": 1}
    assert raport["wynik"] == {"filmy": 3, "seriale": 1}


def test_wynik_ma_ksztalt_eksportu_aplikacji(sc):
    baza = biblioteka([film()], [serial()])
    wynik, _ = sc.scal_biblioteki(baza, biblioteka())
    assert set(wynik) == {"exported_at", "movies", "shows"}
    assert isinstance(wynik["exported_at"], str) and len(wynik["exported_at"]) >= 19


def test_nie_modyfikuje_wejsciowych_bibliotek(sc):
    baza = biblioteka([film(tmdb_id=None)])
    drugi = biblioteka([film(tmdb_id=7)])
    kopia = json.loads(json.dumps(baza))
    sc.scal_biblioteki(baza, drugi)
    assert baza == kopia


# --- wejście/wyjście na plikach ----------------------------------------------


def test_wczytuje_eksport_i_odrzuca_plik_bez_kluczy(sc, tmp_path):
    dobry = tmp_path / "dobry.json"
    dobry.write_text(json.dumps({"movies": [film()], "shows": []}), encoding="utf-8")
    assert len(sc.wczytaj_biblioteke(dobry)["movies"]) == 1

    zly = tmp_path / "zly.json"
    zly.write_text(json.dumps({"cos": 1}), encoding="utf-8")
    with pytest.raises(ValueError):
        sc.wczytaj_biblioteke(zly)


def test_zapisuje_pliki_wyniku_i_raportu(sc, tmp_path):
    wynik, raport = sc.scal_biblioteki(biblioteka([film()], [serial()]), biblioteka([film(uuid="u9", title="Nowy")]))
    plik = tmp_path / "scalone.json"
    raport_plik = tmp_path / "raport.json"
    sc.zapisz_wynik(wynik, raport, plik, raport_plik)
    assert json.loads(plik.read_text("utf-8"))["movies"][1]["title"] == "Nowy"
    assert json.loads(raport_plik.read_text("utf-8"))["dodane"]["filmy"] == 1


def test_eksport_nie_jest_zmieniany_gdy_jest_podzbiorem(sc):
    """Scalanie pliku z nim samym musi dać identyczną bibliotekę (poza exported_at)."""
    baza = biblioteka(
        [film(uuid="u1", title="A", tmdb_id=1, plot="opis", rating=5)],
        [serial(uuid="s1", title="S", season_ep_counts={"1": 2}, episodes_watched=[odcinek(1, 1)])],
    )
    wynik, raport = sc.scal_biblioteki(baza, baza)
    assert wynik["movies"] == baza["movies"]
    assert wynik["shows"] == baza["shows"]
    assert raport["uzupelnione"]["filmy"] == {}
    assert raport["dodane"] == {"filmy": 0, "seriale": 0}
