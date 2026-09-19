"""Testy naprawy i audytu identyfikatorów TMDb w bibliotece CineLog.

Reguły dopasowania są celowo identyczne jak w aplikacji (wybierzTrafienieWTmdb
w static/js/modules/state.js): tytuł (lub tytuł oryginalny) musi się zgadzać,
rok nie może się różnić o więcej niż 1, a gdy rok jest nieznany i kandydatów
jest kilku — nie zgadujemy.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

SCIEZKA = pathlib.Path(__file__).resolve().parent.parent / "scripts" / "napraw_biblioteke.py"


def _wczytaj():
    spec = importlib.util.spec_from_file_location("napraw_biblioteke", SCIEZKA)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def naprawa():
    return _wczytaj()


# --- atrapa klienta TMDb ---------------------------------------------------


class AtrapaTMDb:
    """Klient odpowiadający na /search/* i /*/<id> według zadanych słowników."""

    def __init__(self, szczegoly: dict | None = None, wyniki: dict | None = None, szczegoly_en: dict | None = None):
        self.szczegoly = szczegoly or {}      # ("tv"|"movie", "2316") -> dict | None
        self.wyniki = wyniki or {}            # ("tv"|"movie", "Biuro") -> lista wyników
        self.szczegoly_en = szczegoly_en or {}  # to samo, ale dla zapytań language=en-US
        self.zapytania: list[str] = []

    def pobierz(self, path, params=None):
        params = params or {}
        self.zapytania.append(path)
        if path.startswith("/search/"):
            rodzaj = path.split("/")[2]
            return {"results": self.wyniki.get((rodzaj, params.get("query")), [])}
        czesci = path.strip("/").split("/")
        rodzaj, identyfikator = czesci[0], czesci[1]
        klucz = (rodzaj, str(identyfikator))
        if params.get("language") == "en-US":
            return self.szczegoly_en.get(klucz) or self.szczegoly.get(klucz)
        return self.szczegoly.get(klucz)


# --- dopasowanie -----------------------------------------------------------


def test_wybierze_wersje_zgodna_z_rokiem(naprawa):
    wyniki = [
        {"id": 309130, "name": "激战黄土岭", "original_name": "激战黄土岭", "first_air_date": "1995-01-01"},
        {"id": 2996, "name": "Biuro", "original_name": "The Office", "first_air_date": "2001-07-09"},
        {"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"},
    ]
    trafienie = naprawa.wybierz_trafienie_tmdb(wyniki, "Biuro", "2005")
    assert trafienie and trafienie["id"] == 2316


def test_odrzuci_obcy_tytul(naprawa):
    wyniki = [{"id": 309130, "name": "激战黄土岭", "original_name": "激战黄土岭", "first_air_date": "1995-01-01"}]
    assert naprawa.wybierz_trafienie_tmdb(wyniki, "Biuro", "2005") is None


def test_bez_roku_nie_zgaduje_miedzy_wersjami(naprawa):
    wyniki = [
        {"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"},
        {"id": 2996, "name": "Biuro", "original_name": "The Office", "first_air_date": "2001-07-09"},
    ]
    assert naprawa.wybierz_trafienie_tmdb(wyniki, "Biuro", "") is None


def test_bez_roku_jeden_kandydat_jest_ok(naprawa):
    wyniki = [{"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"}]
    trafienie = naprawa.wybierz_trafienie_tmdb(wyniki, "Biuro", "")
    assert trafienie and trafienie["id"] == 2316


def test_film_dopasuje_po_tytule_oryginalnym(naprawa):
    wyniki = [{"id": 597, "title": "Titanic", "original_title": "Titanic", "release_date": "1997-11-18"}]
    trafienie = naprawa.wybierz_trafienie_tmdb(wyniki, "Titanic", "1997")
    assert trafienie and trafienie["id"] == 597


# --- naprawa wpisów --------------------------------------------------------


def _serial(**nadpisz):
    wpis = {
        "uuid": "s-1",
        "title": "Biuro",
        "year": "2005",
        "tmdb_id": "309130",
        "poster_url": "https://image.tmdb.org/t/p/w500/zly.jpg",
        "total_seasons": 1,
        "total_episodes": None,
        "series_status": None,
        "in_production": None,
        "episodes_watched": [{"season": 1, "episode": 1}],
        "watched_count": 1,
        "status": "watching",
        "rating": 4,
        "created_at": "2026-01-01 10:00:00",
        "updated_at": "2026-01-02 10:00:00",
    }
    wpis.update(nadpisz)
    return wpis


def _trafienie_biuro():
    return [{"id": 2316, "name": "Biuro", "original_name": "The Office", "first_air_date": "2005-03-24"}]


def _szczegoly_biuro():
    return {
        "id": 2316,
        "name": "Biuro",
        "original_name": "The Office",
        "first_air_date": "2005-03-24",
        "poster_path": "/dobry.jpg",
        "number_of_seasons": 9,
        "number_of_episodes": 186,
        "status": "Ended",
        "in_production": False,
        "overview": "opis",
        "genres": [{"name": "Komedia"}],
        "seasons": [{"season_number": 1, "episode_count": 6}],
    }


def test_naprawi_zly_identyfikator_serialu(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "309130"): {"id": 309130, "name": "激战黄土岭", "first_air_date": "1995-01-01"},
                   ("tv", "2316"): _szczegoly_biuro()},
        wyniki={("tv", "Biuro"): _trafienie_biuro()},
    )
    wpis = _serial()
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "2316"
    assert any(z["pole"] == "tmdb_id" and z["stare"] == "309130" and z["nowe"] == "2316" for z in zmiany)


def test_usunie_zly_identyfikator_gdy_brak_pewnego_trafienia(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "309130"): {"id": 309130, "name": "激战黄土岭", "first_air_date": "1995-01-01"}},
        wyniki={("tv", "Biuro"): [{"id": 999, "name": "Inny serial", "first_air_date": "1995-01-01"}]},
    )
    wpis = _serial()
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert not wpis["tmdb_id"], "obcy identyfikator musi zostać usunięty"
    assert any(z["pole"] == "tmdb_id" and z["nowe"] is None for z in zmiany)


def test_nie_rusza_danych_uzytkownika(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "2316"): _szczegoly_biuro()},
        wyniki={("tv", "Biuro"): _trafienie_biuro()},
    )
    wpis = _serial(tmdb_id="2316")
    przed = json.dumps(wpis, sort_keys=True, ensure_ascii=False)
    naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)
    po = json.loads(przed)
    for pole in ("episodes_watched", "watched_count", "status", "rating", "created_at", "updated_at", "uuid", "title"):
        assert wpis[pole] == po[pole], f"pole użytkownika {pole} zostało zmienione"


def test_dopelni_puste_metadane_po_naprawie(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "309130"): None, ("tv", "2316"): _szczegoly_biuro()},
        wyniki={("tv", "Biuro"): _trafienie_biuro()},
    )
    wpis = _serial(tmdb_id="309130", poster_url="", total_seasons=None, total_episodes=None)
    naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert wpis["poster_url"].endswith("/dobry.jpg"), "plakat po zmianie identyfikatora musi pochodzić z właściwego serialu"
    assert wpis["total_seasons"] == 9
    assert wpis["total_episodes"] == 186


def test_nie_nadpisuje_istniejacych_wartosci(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "2316"): _szczegoly_biuro()},
        wyniki={("tv", "Biuro"): _trafienie_biuro()},
    )
    wpis = _serial(tmdb_id="2316", poster_url="https://image.tmdb.org/t/p/w500/moj.jpg", total_seasons=9)
    naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert wpis["poster_url"].endswith("/moj.jpg")
    assert wpis["total_seasons"] == 9


def test_w_trybie_audytu_nic_nie_zmienia(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "309130"): {"id": 309130, "name": "激战黄土岭", "first_air_date": "1995-01-01"}},
        wyniki={("tv", "Biuro"): _trafienie_biuro()},
    )
    wpis = _serial()
    przed = json.dumps(wpis, sort_keys=True, ensure_ascii=False)
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=False)

    assert json.dumps(wpis, sort_keys=True, ensure_ascii=False) == przed
    assert zmiany, "audyt musi mimo to zgłosić planowaną zmianę"


def test_uzupelni_brakujacy_identyfikator(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("movie", "597"): {"id": 597, "title": "Titanic", "release_date": "1997-11-18", "poster_path": "/t.jpg"}},
        wyniki={("movie", "Titanic"): [{"id": 597, "title": "Titanic", "release_date": "1997-11-18"}]},
    )
    wpis = {"uuid": "m-1", "title": "Titanic", "release_date": "1997-11-18", "poster_url": ""}
    naprawa.przetworz_wpis(wpis, "film", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "597"
    assert wpis["poster_url"].endswith("/t.jpg")


# --- sygnały dopisane przez użytkownika w tytule ---------------------------


def test_czysci_tytul_i_czyta_z_niego_rok(naprawa):
    assert naprawa.rok_z_tytulu("Maniac (2018)") == "2018"
    assert naprawa.tytul_do_dopasowania("Maniac (2018)") == "Maniac"
    assert naprawa.tytul_do_dopasowania("Scenes From A Marriage (US)") == "Scenes From A Marriage"
    assert naprawa.rok_z_tytulu("Lie to Me") is None


def test_rok_z_tytulu_rozstrzyga_miedzy_wersjami(naprawa):
    wyniki = [
        {"id": 1, "name": "Maniac", "original_name": "Maniac", "first_air_date": "1974-01-01"},
        {"id": 2, "name": "Maniac", "original_name": "Maniac", "first_air_date": "2018-09-21"},
    ]
    trafienie = naprawa.wybierz_trafienie_tmdb(wyniki, "Maniac (2018)", "")
    assert trafienie and trafienie["id"] == 2


def test_dopisek_kraju_wybierze_wersje_amerykanska(naprawa):
    wyniki = [
        {"id": 1, "name": "Scenes From A Marriage", "original_name": "Scener ur ett äktenskap",
         "first_air_date": "1973-01-01", "original_language": "sv"},
        {"id": 2, "name": "Scenes From A Marriage", "original_name": "Scenes From A Marriage",
         "first_air_date": "2021-09-12", "original_language": "en"},
    ]
    trafienie = naprawa.wybierz_trafienie_tmdb(wyniki, "Scenes From A Marriage (US)", "")
    assert trafienie and trafienie["id"] == 2


def test_wpis_z_rokiem_w_tytule_naprawia_identyfikator(naprawa):
    klient = AtrapaTMDb(
        szczegoly={("tv", "354735"): {"id": 354735, "name": "Inny serial", "first_air_date": "2000-01-01"},
                   ("tv", "90123"): {"id": 90123, "name": "Maniac", "first_air_date": "2018-09-21",
                                     "number_of_seasons": 1, "number_of_episodes": 10}},
        wyniki={("tv", "Maniac"): [
            {"id": 11, "name": "Maniac", "original_name": "Maniac", "first_air_date": "1974-01-01"},
            {"id": 90123, "name": "Maniac", "original_name": "Maniac", "first_air_date": "2018-09-21"},
        ]},
    )
    wpis = _serial(title="Maniac (2018)", year="", tmdb_id="354735")
    naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "90123", "rok z tytułu musi rozstrzygnąć na rzecz serialu z 2018"


def test_nie_kasuje_poprawnego_id_o_polskiej_nazwie(naprawa):
    """„The Office (US)” ma w TMDb po polsku nazwę „Biuro” — identyfikator jest poprawny."""
    klient = AtrapaTMDb(
        szczegoly={("tv", "2316"): {"id": 2316, "name": "Biuro", "original_name": "The Office",
                                     "first_air_date": "2005-03-24"}},
        szczegoly_en={("tv", "2316"): {"id": 2316, "name": "The Office", "original_name": "The Office"}},
    )
    wpis = _serial(title="The Office (US)", year="2005", tmdb_id="2316")
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "2316"
    assert not [z for z in zmiany if z["pole"] == "tmdb_id"], "poprawny identyfikator nie może być ruszany"


def test_nie_kasuje_poprawnego_id_gdy_tytul_angielski(naprawa):
    """„Money Heist” w TMDb to „Dom z papieru” / „La casa de papel” — weryfikacja po angielsku ratuje wpis."""
    klient = AtrapaTMDb(
        szczegoly={("tv", "71446"): {"id": 71446, "name": "Dom z papieru", "original_name": "La casa de papel",
                                      "first_air_date": "2017-05-02"}},
        szczegoly_en={("tv", "71446"): {"id": 71446, "name": "Money Heist", "original_name": "La casa de papel"}},
    )
    wpis = _serial(title="Money Heist", year="2017", tmdb_id="71446")
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "71446"
    assert not [z for z in zmiany if z["pole"] == "tmdb_id"]


def test_zgodny_tytul_ale_inny_rok_to_nadal_zly_identyfikator(naprawa):
    """„Lost in Space (2018)" z identyfikatorem serialu z 1965 ma zgodny tytuł, a jest zły."""
    klient = AtrapaTMDb(
        szczegoly={
            ("tv", "3051"): {"id": 3051, "name": "Zagubieni w kosmosie", "original_name": "Lost in Space",
                             "first_air_date": "1965-09-15"},
            ("tv", "75758"): {"id": 75758, "name": "Zagubieni w kosmosie", "original_name": "Lost in Space",
                              "first_air_date": "2018-04-13"},
        },
        szczegoly_en={("tv", "3051"): {"id": 3051, "name": "Lost in Space", "original_name": "Lost in Space"}},
        wyniki={("tv", "Lost in Space"): [
            {"id": 3051, "name": "Lost in Space", "original_name": "Lost in Space", "first_air_date": "1965-09-15"},
            {"id": 75758, "name": "Lost in Space", "original_name": "Lost in Space", "first_air_date": "2018-04-13"},
        ]},
    )
    wpis = _serial(title="Lost in Space (2018)", year="", tmdb_id="3051")
    naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "75758"


def test_nie_kasuje_id_gdy_tmdb_nie_zna_tytulu_w_zadnym_jezyku(naprawa):
    """„Women of Mafia” — TMDb zna ten serial jako „Kobiety mafii”, wyszukiwanie tytułu nic nie zwraca."""
    klient = AtrapaTMDb(
        szczegoly={("tv", "79878"): {"id": 79878, "name": "Kobiety mafii", "original_name": "Kobiety mafii",
                                     "first_air_date": "2018-04-27"}},
        szczegoly_en={("tv", "79878"): {"id": 79878, "name": "Kobiety mafii", "original_name": "Kobiety mafii"}},
    )
    wpis = _serial(title="Women of Mafia", year="2018", tmdb_id="79878")
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "79878", "brak kontrargumentu = nie kasujemy identyfikatora"
    assert not [z for z in zmiany if z["pole"] == "tmdb_id"]


def test_obsluguje_dopisek_po_w_tytule(naprawa):
    """„Marked (PO)” — identyfikator poprawny, zgodna nazwa angielska po oczyszczeniu tytułu."""
    klient = AtrapaTMDb(
        szczegoly={("tv", "293808"): {"id": 293808, "name": "Wybór matki", "original_name": "Marked",
                                      "first_air_date": "2025-04-02"}},
        szczegoly_en={("tv", "293808"): {"id": 293808, "name": "Marked", "original_name": "Marked"}},
    )
    wpis = _serial(title="Marked (PO)", year="2025", tmdb_id="293808")
    zmiany = naprawa.przetworz_wpis(wpis, "serial", klient, naprawiaj=True)

    assert str(wpis["tmdb_id"]) == "293808"
    assert not [z for z in zmiany if z["pole"] == "tmdb_id"]
