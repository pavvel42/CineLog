"""Testy adaptera eksportu RODO z TVTime → plik importu CineLog.

Wejście to własny dump RODO (CSV), inny niż format Refract obsługiwany przez
`tvtime_to_cinelog.py`. Ten eksport:

* trzyma filmy w `tracking-prod-records.csv` (osobne wiersze `watch` i `follow`),
* seriale w `tracking-prod-records-v2.csv` (po jednym wierszu `user-series-*`),
* liczbę obejrzanych odcinków w `user_tv_show_data.csv` (`nb_episodes_seen`),
* pozycję ostatniego obejrzanego odcinka w `most_recent_ep_watched` (string mapy Go),
* **nie ma** pełnej historii odcinków ani ocen — historię odtwarzamy z licznika,
  więc testy pilnują, żeby odtwarzanie było deterministyczne i ograniczone znacznikiem.

Poza zakresem (i nigdy nieczytane): `access_token.csv`, `refresh_token.csv`,
`device_token.csv`, `ip_address.csv`, `user.csv` i pozostałe pliki wrażliwe.
"""

from __future__ import annotations

import csv
import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "tvtime_gdpr_to_cinelog.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("tvtime_gdpr_to_cinelog", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gdpr():
    return _load_module()


# --- narzędzia do budowania atrapy eksportu ----------------------------------


def zapisz_csv(katalog: Path, nazwa: str, wiersze: list[dict]) -> Path:
    sciezka = katalog / nazwa
    with sciezka.open("w", newline="", encoding="utf-8") as f:
        pisarz = csv.DictWriter(f, fieldnames=list(wiersze[0].keys()))
        pisarz.writeheader()
        pisarz.writerows(wiersze)
    return sciezka


def wiersz_filmu(nazwa, uuid, typ="watch", **nadpisz):
    wpis = {
        "watch_count": "", "watches": "", "user_id": "999", "type": typ, "uuid": uuid,
        "created_at": "2024-05-28 12:00:00", "updated_at": "2024-05-28 12:00:00",
        "movie_name": nazwa, "series_name": "", "release_date": "2021-11-26", "runtime": "6180",
        "rewatch_count": "0", "country": "US",
    }
    wpis.update(nadpisz)
    return wpis


def wiersz_serialu(nazwa, uuid, ep_watch=10, most_recent="map[ep_no:2 s_no:1 watch_date:1.7e+15]"):
    return {
        "key": f"user-series-{uuid}", "uuid": uuid, "series_name": nazwa, "movie_name": "",
        "ep_watch_count": str(ep_watch), "is_followed": "true", "is_archived": "false",
        "is_for_later": "false", "followed_at": "1716925767003687", "s_id": "83920",
        "most_recent_ep_watched": most_recent, "created_at": "2024-05-28 19:49:27",
        "updated_at": "2024-05-28 19:49:42", "user_id": "999",
    }


def wiersz_show_data(nazwa, seen, fav="0", follow="1", tv_show_id="83920"):
    return {"tv_show_name": nazwa, "nb_episodes_seen": str(seen), "is_favorited": fav,
            "is_followed": follow, "tv_show_id": tv_show_id, "user_id": "999"}


@pytest.fixture
def eksport(tmp_path):
    """Minimalny, ale kompletny eksport RODO — plus pliki wrażliwe, których nie wolno czytać."""
    katalog = tmp_path / "gdpr-data"
    katalog.mkdir()
    zapisz_csv(katalog, "tracking-prod-records.csv", [
        wiersz_filmu("Encanto", "u-encanto", typ="watch"),
        wiersz_filmu("Encanto", "u-encanto", typ="follow"),
        wiersz_filmu("Diuna", "u-diuna", typ="watch", release_date="2021-09-15", runtime="9300"),
        wiersz_filmu("Zapowiedziany", "u-zap", typ="follow", created_at="2024-06-01 08:00:00"),
        wiersz_filmu("", "", typ="watch"),
    ])
    zapisz_csv(katalog, "tracking-prod-records-v2.csv", [
        wiersz_serialu("Ranczo", "s-ranczo", ep_watch=130, most_recent="map[ep_no:13 s_no:10]"),
        wiersz_serialu("Criminal Minds", "s-cm", ep_watch=117, most_recent="map[ep_no:2 s_no:7]"),
        wiersz_serialu("The Day of the Jackal", "s-jackal", ep_watch=0, most_recent=""),
    ])
    zapisz_csv(katalog, "user_tv_show_data.csv", [
        wiersz_show_data("Ranczo", 130, tv_show_id="81970"),
        wiersz_show_data("Criminal Minds", 117, tv_show_id="75710"),
        wiersz_show_data("The Day of the Jackal", 0, tv_show_id="426866"),
        wiersz_show_data("Grey's Anatomy", 0, follow="0", tv_show_id="73762"),
    ])
    zapisz_csv(katalog, "access_token.csv", [{"user_id": "999", "token": "TAJNY-TOKEN-XYZ"}])
    zapisz_csv(katalog, "user.csv", [{"user_id": "999", "email": "ktos@example.com", "name": "Jan"}])
    zapisz_csv(katalog, "ip_address.csv", [{"user_id": "999", "ip": "10.1.2.3"}])
    return katalog


# --- filmy --------------------------------------------------------------------


def test_wczytuje_filmy_obejrzane_i_do_obejrzenia(gdpr, eksport):
    filmy = gdpr.wczytaj_filmy(eksport)
    wedlug_tytulu = {f["title"]: f for f in filmy}
    assert wedlug_tytulu["Encanto"]["is_watched"] is True
    assert wedlug_tytulu["Zapowiedziany"]["is_watched"] is False
    assert wedlug_tytulu["Diuna"]["is_watched"] is True


def test_pomija_wiersze_bez_tytulu(gdpr, eksport):
    filmy = gdpr.wczytaj_filmy(eksport)
    assert all(f["title"] for f in filmy)
    assert len(filmy) == 3


def test_scala_watch_i_follow_tego_samego_filmu(gdpr, eksport):
    filmy = gdpr.wczytaj_filmy(eksport)
    assert len([f for f in filmy if f["title"] == "Encanto"]) == 1


def test_przenosi_date_obejrzenia_i_uuid(gdpr, eksport):
    film = {f["title"]: f for f in gdpr.wczytaj_filmy(eksport)}["Encanto"]
    assert film["watched_at"].startswith("2024-05-28")
    assert film["uuid"] == "u-encanto"


def test_nie_czyta_plikow_wrazliwych(gdpr, eksport):
    tresc = gdpr.wczytaj_filmy(eksport) + gdpr.wczytaj_seriale(eksport)
    poszlaki = ["TAJNY-TOKEN-XYZ", "ktos@example.com", "10.1.2.3", "Jan"]
    for wpis in tresc:
        for wartosc in wpis.values():
            for poszlaka in poszlaki:
                assert poszlaka not in str(wartosc)


# --- seriale ------------------------------------------------------------------


def test_wczytuje_tylko_wiersze_user_series(gdpr, eksport):
    with (eksport / "tracking-prod-records-v2.csv").open("a", encoding="utf-8") as f:
        f.write("tracking-stats,,,,,,,,,,,,,,\n")
    seriale = gdpr.wczytaj_seriale(eksport)
    assert {s["title"] for s in seriale} == {"Ranczo", "Criminal Minds", "The Day of the Jackal"}


def test_liczba_odcinkow_z_user_tv_show_data(gdpr, eksport):
    """`nb_episodes_seen` to liczba obejrzanych odcinków, a `ep_watch_count` liczy zdarzenia
    (z powtórkami), więc te wartości bywają różne — bierzemy liczbę „seen”, bo to ona
    odpowiada postępowi w aplikacji."""
    seriale = {s["title"]: s for s in gdpr.wczytaj_seriale(eksport)}
    assert seriale["Ranczo"]["episodes_seen"] == 130
    assert seriale["Criminal Minds"]["episodes_seen"] == 117


def test_czyta_znacznik_ostatniego_odcinka(gdpr, eksport):
    seriale = {s["title"]: s for s in gdpr.wczytaj_seriale(eksport)}
    assert seriale["Criminal Minds"]["ostatni_odcinek"] == (7, 2)
    assert seriale["Ranczo"]["ostatni_odcinek"] == (10, 13)


def test_czyta_date_ostatniego_odcinka_z_znacznika(gdpr, tmp_path):
    """Eksport podaje czas obejrzenia ostatniego odcinka jako mikrosekundy — przenosimy go,
    żeby „ostatnio oglądane” i statystyki roczne nie były puste."""
    katalog = tmp_path / "gdpr-data-czas"
    katalog.mkdir()
    znacznik = "map[ep_no:2 s_no:1 uuid:abc watch_date:1.716925782645206e+15]"
    zapisz_csv(katalog, "tracking-prod-records-v2.csv", [wiersz_serialu("Ranczo", "s-ranczo", most_recent=znacznik)])
    zapisz_csv(katalog, "user_tv_show_data.csv", [wiersz_show_data("Ranczo", 5)])
    serial = gdpr.wczytaj_seriale(katalog)[0]
    assert serial["data_ostatniego_odcinka"].startswith("2024-05-2")


def test_data_ostatniego_odcinka_trafia_na_ostatni_odcinek(gdpr, tmp_path):
    katalog = tmp_path / "gdpr-data-data"
    katalog.mkdir()
    znacznik = "map[ep_no:13 s_no:10 uuid:abc watch_date:1.716925782645206e+15]"
    zapisz_csv(katalog, "tracking-prod-records-v2.csv", [wiersz_serialu("Ranczo", "s-ranczo", most_recent=znacznik)])
    zapisz_csv(katalog, "user_tv_show_data.csv", [wiersz_show_data("Ranczo", 13)])
    tmdb = {"Ranczo": {"id": 1, "name": "Ranczo", "number_of_seasons": 1, "number_of_episodes": 13,
                       "status": "Ended",
                       "seasons": [{"season_number": 1, "episode_count": 13}]}}
    biblioteka = gdpr.zbuduj_biblioteke(katalog, tmdb)
    serial = {s["title"]: s for s in biblioteka["shows"]}["Ranczo"]
    odcinki = serial["episodes_watched"]
    # znacznik wskazuje S10E13, więc data ląduje na ostatnim odtworzonym odcinku (S1E13)
    assert len(odcinki) == 13
    assert odcinki[-1]["created_at"].startswith("2024-05-2")
    assert odcinki[0].get("created_at") is None
    assert serial["updated_at"].startswith("2024-05-2")


def test_pomija_seriale_bez_obserwowania(gdpr, eksport):
    """„Grey's Anatomy” ma w eksporcie follow=0 i 0 odcinków — nie jest częścią biblioteki."""
    tytuly = {s["title"] for s in gdpr.wczytaj_seriale(eksport)}
    assert "Grey's Anatomy" not in tytuly


# --- odtwarzanie historii odcinków -------------------------------------------


def test_odtwarza_odcinki_w_kolejnosci_emisji(gdpr):
    odcinki = gdpr.odtworz_odcinki(27, {"1": 24, "2": 10}, None)
    assert len(odcinki) == 27
    assert odcinki[0] == (1, 1)
    assert odcinki[23] == (1, 24)
    assert odcinki[24] == (2, 1)
    assert odcinki[-1] == (2, 3)


def test_odtwarzanie_konczy_sie_na_znaczniku_ostatniego_odcinka(gdpr):
    """Gdy licznik jest wyższy niż pozycja znacznika, nie wymyślamy odcinków dalej niż znacznik."""
    odcinki = gdpr.odtworz_odcinki(100, {"1": 5, "2": 5}, (1, 3))
    assert odcinki == [(1, 1), (1, 2), (1, 3)]


def test_odtwarzanie_bez_znacznika_konczy_sie_na_liczniku(gdpr):
    odcinki = gdpr.odtworz_odcinki(6, {"1": 4, "2": 4}, None)
    assert len(odcinki) == 6


def test_odtwarzanie_pomija_sezon_zero(gdpr):
    odcinki = gdpr.odtworz_odcinki(3, {"0": 4, "1": 10}, None)
    assert odcinki == [(1, 1), (1, 2), (1, 3)]


def test_odtwarzanie_bez_danych_o_sezonach_nic_nie_wymysla(gdpr):
    assert gdpr.odtworz_odcinki(10, {}, None) == []


def test_odtwarzanie_zerowego_licznika(gdpr):
    assert gdpr.odtworz_odcinki(0, {"1": 10}, None) == []


def test_granica_licznika_wiekszego_niz_liczba_odcinkow(gdpr):
    odcinki = gdpr.odtworz_odcinki(99, {"1": 3}, None)
    assert odcinki == [(1, 1), (1, 2), (1, 3)]


# --- budowa biblioteki --------------------------------------------------------


def test_buduje_biblioteke_z_ksztaltem_eksportu(gdpr, eksport):
    biblioteka = gdpr.zbuduj_biblioteke(eksport, {})

    def bez_tmdb(tytul):
        return None

    assert set(biblioteka) >= {"movies", "shows"}
    filmy = {m["title"]: m for m in biblioteka["movies"]}
    assert filmy["Encanto"]["status"] == "watched"
    assert filmy["Zapowiedziany"]["status"] == "watchlist"
    assert "Grey's Anatomy" not in {s["title"] for s in biblioteka["shows"]}


def test_filmy_maja_datę_obejrzenia_w_kształcie_roku_miesiąca_dnia(gdpr, eksport):
    biblioteka = gdpr.zbuduj_biblioteke(eksport, {})
    film = {m["title"]: m for m in biblioteka["movies"]}["Encanto"]
    assert film["watch_date"].startswith("2024-05-28")


def test_status_serialu_bez_obejrzanych_odcinkow_to_watchlist(gdpr, eksport):
    biblioteka = gdpr.zbuduj_biblioteke(eksport, {})
    serial = {s["title"]: s for s in biblioteka["shows"]}["The Day of the Jackal"]
    assert serial["status"] == "watchlist"
    assert serial["episodes_watched"] == []


def test_serial_ma_odtworzone_odcinki_z_danych_tmdb(gdpr, eksport):
    tmdb = {"Ranczo": {"id": 1, "name": "Ranczo", "number_of_seasons": 2, "number_of_episodes": 26,
                       "status": "Ended",
                       "seasons": [{"season_number": 1, "episode_count": 13},
                                   {"season_number": 2, "episode_count": 13}]}}
    biblioteka = gdpr.zbuduj_biblioteke(eksport, tmdb)
    serial = {s["title"]: s for s in biblioteka["shows"]}["Ranczo"]
    # znacznik mówi o S10E13, ale sezony z TMDb kończą się na 26 odcinkach
    assert len(serial["episodes_watched"]) == 26
    assert serial["status"] == "watched"


def test_uuid_filmow_i_seriali_sa_unikalne(gdpr, eksport):
    biblioteka = gdpr.zbuduj_biblioteke(eksport, {})
    uuid_filmow = [m["uuid"] for m in biblioteka["movies"]]
    uuid_seriali = [s["uuid"] for s in biblioteka["shows"]]
    assert len(set(uuid_filmow)) == len(uuid_filmow)
    assert len(set(uuid_seriali)) == len(uuid_seriali)


def test_wynik_nie_zawiera_danych_osobowych(gdpr, eksport):
    import json

    biblioteka = gdpr.zbuduj_biblioteke(eksport, {})
    tekst = json.dumps(biblioteka, ensure_ascii=False)
    for poszlaka in ("TAJNY-TOKEN-XYZ", "ktos@example.com", "10.1.2.3", "user_id", "999"):
        assert poszlaka not in tekst


def test_raport_podaje_liczby_i_ostrzezenia(gdpr, eksport):
    biblioteka, raport = gdpr.zbuduj_biblioteke_z_raportem(eksport, {})
    assert raport["filmy"] == len(biblioteka["movies"])
    assert raport["seriale"] == len(biblioteka["shows"])
    assert isinstance(raport["ostrzezenia"], list)


# --- duplikaty i wyszukiwanie w TMDb -----------------------------------------


def test_scala_filmy_o_tym_samym_tmdb_id(gdpr, tmp_path):
    """TVTime potrafi trzymać ten sam film pod dwoma identyfikatorami — po TMDb widzimy, że to jedna pozycja."""
    katalog = tmp_path / "gdpr-dup"
    katalog.mkdir()
    zapisz_csv(katalog, "tracking-prod-records.csv", [
        wiersz_filmu("Mulan", "u-mulan-1", typ="watch"),
        wiersz_filmu("Mulan", "u-mulan-2", typ="watch"),
        wiersz_filmu("Diuna", "u-diuna", typ="watch"),
    ])
    zapisz_csv(katalog, "tracking-prod-records-v2.csv", [wiersz_serialu("Ranczo", "s-ranczo")])
    zapisz_csv(katalog, "user_tv_show_data.csv", [wiersz_show_data("Ranczo", 1)])
    tmdb = {"Mulan": {"id": 10674, "title": "Mulan"}, "Diuna": {"id": 438631, "title": "Diuna"}}
    biblioteka, raport = gdpr.zbuduj_biblioteke_z_raportem(katalog, tmdb)
    assert [m["title"] for m in biblioteka["movies"]] == ["Mulan", "Diuna"]
    assert raport["duplikaty_usuniete"] == 1


def test_nie_usuwa_filmow_bez_tmdb_o_roznych_tytulach(gdpr, tmp_path):
    katalog = tmp_path / "gdpr-bez-tmdb"
    katalog.mkdir()
    zapisz_csv(katalog, "tracking-prod-records.csv", [
        wiersz_filmu("Film A", "u-a", typ="watch"),
        wiersz_filmu("Film B", "u-b", typ="watch"),
    ])
    zapisz_csv(katalog, "tracking-prod-records-v2.csv", [wiersz_serialu("Ranczo", "s-ranczo")])
    zapisz_csv(katalog, "user_tv_show_data.csv", [wiersz_show_data("Ranczo", 1)])
    biblioteka, raport = gdpr.zbuduj_biblioteke_z_raportem(katalog, {})
    assert len(biblioteka["movies"]) == 2
    assert raport["duplikaty_usuniete"] == 0


class AtrapaKlientaTMDb:
    """Klient TMDb, który odpowiada wg zadanego scenariusza i liczy wywołania."""

    def __init__(self, trafienia_wg_roku: dict, trafienia_bez_roku: dict):
        self.trafienia_wg_roku = trafienia_wg_roku
        self.trafienia_bez_roku = trafienia_bez_roku
        self.wywolania: list[tuple] = []

    def film_po_tytule(self, tytul, rok=None):
        self.wywolania.append((tytul, rok))
        if rok is not None:
            return self.trafienia_wg_roku.get(tytul)
        return self.trafienia_bez_roku.get(tytul)

    def film_szczegoly(self, tmdb_id):
        return {"id": tmdb_id, "title": "z szczegółów"}


def test_szuka_filmu_wg_roku_a_gdy_brak_to_bez_roku(gdpr):
    klient = AtrapaKlientaTMDb({}, {"The Boy in the Striped Pajamas": {"id": 254}})
    film = {"title": "The Boy in the Striped Pajamas", "release_date": "2008-11-07"}
    tytul, dane = gdpr.szukaj_filmu(klient, film)
    assert tytul == "The Boy in the Striped Pajamas"
    assert dane["id"] == 254
    assert klient.wywolania == [("The Boy in the Striped Pajamas", "2008"), ("The Boy in the Striped Pajamas", None)]


def test_szuka_tylko_raz_gdy_rok_wystarczy(gdpr):
    klient = AtrapaKlientaTMDb({"Encanto": {"id": 568124}}, {})
    tytul, dane = gdpr.szukaj_filmu(klient, {"title": "Encanto", "release_date": "2021-11-26"})
    assert dane["id"] == 568124
    assert klient.wywolania == [("Encanto", "2021")]
