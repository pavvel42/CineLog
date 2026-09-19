#!/usr/bin/env python3
"""Konwersja rozdrobnionego eksportu TVTime na jeden plik importu CineLog.

Po co: TVTime oddaje historię w osobnych plikach (filmy, seriale, odcinki),
a CineLog przyjmuje jeden dokument `{"movies": [...], "shows": [...]}`.

Dwa tryby pracy:

1. Bez `--baza` — czysta konwersja eksportu TVTime na wpisy CineLog.
2. Z `--baza` (eksport/backup biblioteki CineLog) — **scalanie**: biblioteka
   użytkownika zostaje bazą (oceny, statusy, uuid), a eksport TVTime tylko
   uzupełnia braki (identyfikatory TMDb/IMDb, daty seansów, ulubione, postępy
   odcinków, metadane seriali). Dopasowanie idzie najpierw po `tmdb_id`,
   dopiero potem po znormalizowanym tytule — inaczej polskie i oryginalne
   tytuły tego samego filmu tworzyłyby duplikaty.

TMDb służy wyłącznie do uzupełnienia metadanych (identyfikatory, plakat, opis,
rok, liczba odcinków/sezonów); klucz czytamy ze środowiska lub z `.env`
repozytorium i nigdy go nie wypisujemy.
"""

from __future__ import annotations

import argparse
import csv
import json
import pathlib
import re
import sys
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from difflib import SequenceMatcher

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from services import tmdb_client  # noqa: E402  (po ustawieniu sys.path)

FMT_DATY = "%Y-%m-%d %H:%M:%S"
STATUSY_FILMU = {"watched", "watchlist", "followed"}
STATUSY_SERIALU = {"watched", "watching", "watchlist"}


# --- drobne pomocnicze ----------------------------------------------------

def normalizuj_tytul(tytul: object) -> str:
    """Klucz porównawczy tytułu: bez wielkości liter, znaków diakrytycznych i interpunkcji."""
    if not isinstance(tytul, str):
        return ""
    rozlozony = unicodedata.normalize("NFKD", tytul)
    bez_ogonkow = "".join(z for z in rozlozony if not unicodedata.combining(z))
    return re.sub(r"[^0-9a-z]+", "", bez_ogonkow.lower())


def formatuj_date(wartosc: object) -> str | None:
    """Zamienia znacznik ISO z TVTime na format CineLog; śmieci i puste dają None."""
    if not isinstance(wartosc, str) or not wartosc.strip():
        return None
    tekst = wartosc.strip().replace("Z", "+00:00")
    tekst = tekst.split(".")[0] if "." in tekst else tekst
    for wzor in (FMT_DATY, "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(tekst.replace("+00:00", ""), wzor).strftime(FMT_DATY)
        except ValueError:
            continue
    return None


def _tekst(wartosc: object) -> str:
    return wartosc.strip() if isinstance(wartosc, str) else ""


def _lataj(wartosc: object) -> str:
    if isinstance(wartosc, int):
        return str(wartosc)
    tekst = _tekst(wartosc)
    return tekst[:4] if len(tekst) >= 4 and tekst[:4].isdigit() else tekst


def _gatunki(tmdb: dict | None) -> str:
    if not tmdb:
        return ""
    nazwy = [str(g.get("name")) for g in (tmdb.get("genres") or [])
             if isinstance(g, dict) and g.get("name")]
    return ", ".join(nazwy)


def _uzupelnij_puste(wpis: dict, pole: str, wartosc: object) -> None:
    """Wpisuje wartość tylko wtedy, gdy pole jest puste — biblioteka użytkownika ma priorytet."""
    if wartosc in (None, "", 0, []):
        return
    if wpis.get(pole) in (None, "", 0, []):
        wpis[pole] = wartosc


def przelicz_postep_serialu(serial: dict) -> dict:
    """Reguła 1:1 z backendowym _recalculate_show_progress (routes/shows.py)."""
    eps = sorted(
        ({"season": int(e.get("season") or 0), "episode": int(e.get("episode") or 0)}
         for e in (serial.get("episodes_watched") or [])),
        key=lambda x: (x["season"], x["episode"]),
    )
    serial["episodes_watched"] = eps
    serial["watched_count"] = len(eps)
    if eps:
        najwyzszy_sezon = max(e["season"] for e in eps)
        najwyzszy_odcinek = max(e["episode"] for e in eps if e["season"] == najwyzszy_sezon)
        serial["latest_progress"] = f"S{najwyzszy_sezon:02d}E{najwyzszy_odcinek:02d}"
        serial["latest_season"] = najwyzszy_sezon
        serial["latest_episode"] = najwyzszy_odcinek
    else:
        serial["latest_progress"] = None
        serial["latest_season"] = 0
        serial["latest_episode"] = 0
    return serial


def _sezony_z_tmdb(tmdb: dict | None) -> dict[str, int]:
    """Liczba odcinków na sezon (bez sezonu 0/specials), tak jak trzyma to CineLog."""
    wynik: dict[str, int] = {}
    for sezon in (tmdb or {}).get("seasons") or []:
        if not isinstance(sezon, dict):
            continue
        numer = sezon.get("season_number")
        liczba = sezon.get("episode_count")
        if isinstance(numer, int) and numer > 0 and isinstance(liczba, int) and liczba > 0:
            wynik[str(numer)] = liczba
    return wynik


# --- odczyt eksportu TVTime ----------------------------------------------

def wczytaj_odcinki(sciezka: pathlib.Path) -> dict[str, list[tuple[int, int]]]:
    """Odcinki z CSV TVTime → {uuid serialu: [(sezon, odcinek), ...]} (tylko obejrzane)."""
    wynik: dict[str, list[tuple[int, int]]] = {}
    with open(sciezka, newline="", encoding="utf-8") as fh:
        for wiersz in csv.DictReader(fh):
            if (wiersz.get("is_watched") or "").strip().lower() != "true":
                continue
            uuid_serialu = _tekst(wiersz.get("series_uuid"))
            if not uuid_serialu:
                continue
            try:
                sezon = int(_tekst(wiersz.get("season")) or 0)
                odcinek = int(_tekst(wiersz.get("episode")) or 0)
            except ValueError:
                continue
            wynik.setdefault(uuid_serialu, []).append((sezon, odcinek))
    return wynik


def znajdz_plik(katalog: pathlib.Path, wzor: str) -> pathlib.Path | None:
    trafienia = sorted(katalog.glob(wzor))
    return trafienia[-1] if trafienia else None


def wczytaj_eksport_tvtime(katalog: pathlib.Path) -> tuple[list[dict], list[dict], dict]:
    """Zwraca (filmy, seriale, odcinki) z eksportu TVTime."""
    plik_filmow = znajdz_plik(katalog, "tvtime-movies-*.json")
    plik_seriali = znajdz_plik(katalog, "tvtime-series-*.json")
    plik_odcinkow = znajdz_plik(katalog, "tvtime-series-episodes-*.csv")
    if not plik_filmow or not plik_seriali:
        raise SystemExit(f"Nie znalazłem plików TVTime (filmy/seriale) w {katalog}")
    filmy = json.loads(plik_filmow.read_text(encoding="utf-8"))
    seriale = json.loads(plik_seriali.read_text(encoding="utf-8"))
    odcinki = wczytaj_odcinki(plik_odcinkow) if plik_odcinkow else {}
    return filmy, seriale, odcinki


def wczytaj_baze(sciezka: pathlib.Path) -> dict[str, list[dict]]:
    """Biblioteka CineLog z eksportu: `{movies, shows}` albo goła lista filmów."""
    dane = json.loads(pathlib.Path(sciezka).read_text(encoding="utf-8"))
    if isinstance(dane, list):
        return {"movies": dane, "shows": []}
    return {
        "movies": list(dane.get("movies") or []),
        "shows": list(dane.get("shows") or []),
    }


# --- scalanie -------------------------------------------------------------

def scal_film(bazowy: dict, tvtime: dict | None, tmdb: dict | None) -> dict:
    """Scala film z biblioteki z danymi TVTime i TMDb. Baza zawsze wygrywa.

    Modyfikuje wpis w miejscu (i go zwraca) — dzięki temu scalanie w pętli działa
    także wtedy, gdy wynik nie jest przypisywany do listy.
    """
    film = bazowy
    tvtime = tvtime or {}
    identyfikatory = tvtime.get("id") or {}

    _uzupelnij_puste(film, "tmdb_id", (tmdb or {}).get("id"))
    _uzupelnij_puste(film, "imdb_id", identyfikatory.get("imdb"))
    _uzupelnij_puste(film, "original_title", (tmdb or {}).get("original_title") or _tekst(tvtime.get("title")))
    _uzupelnij_puste(film, "year", _lataj((tmdb or {}).get("release_date") or tvtime.get("year")))
    _uzupelnij_puste(film, "release_date", (tmdb or {}).get("release_date"))
    _uzupelnij_puste(film, "runtime", (tmdb or {}).get("runtime"))
    _uzupelnij_puste(film, "plot", (tmdb or {}).get("overview"))
    _uzupelnij_puste(film, "genre", _gatunki(tmdb))
    plakat = (tmdb or {}).get("poster_path")
    if isinstance(plakat, str) and plakat:
        _uzupelnij_puste(film, "poster_url", f"{tmdb_client.TMDB_IMG_POSTER}{plakat}")

    if not _tekst(film.get("watch_date")):
        _uzupelnij_puste(film, "watch_date", formatuj_date(tvtime.get("watched_at")))
    _uzupelnij_puste(film, "follow_date", formatuj_date(tvtime.get("created_at")))
    _uzupelnij_puste(film, "created_at", formatuj_date(tvtime.get("created_at")))
    _uzupelnij_puste(film, "user_date", (film.get("watch_date") or film.get("follow_date") or "")[:10])

    if tvtime.get("is_favorite"):
        film["is_favorite"] = True
    film["rewatched"] = max(int(film.get("rewatched") or 0), int(tvtime.get("rewatch_count") or 0))
    if film.get("status") not in STATUSY_FILMU:
        film["status"] = "watched" if tvtime.get("is_watched") else "watchlist"
    return film


def scal_serial(bazowy: dict, odcinki_tvtime: list[tuple[int, int]], tmdb: dict | None) -> dict:
    """Scala serial z biblioteki z odcinkami z TVTime i metadanymi TMDb.

    Modyfikuje wpis w miejscu (i go zwraca) — inaczej scalanie w pętli nie działa.
    """
    serial = bazowy
    pary = {(int(e.get("season") or 0), int(e.get("episode") or 0))
            for e in (serial.get("episodes_watched") or [])}
    pary |= {(int(s), int(o)) for s, o in odcinki_tvtime}
    # Speciale (sezon 0) zostają — aplikacja zapisuje je, gdy użytkownik je odhaczy,
    # więc scalanie nie może ich gubić. Odrzucamy tylko śmieciowy wpis (0, 0).
    pary = {p for p in pary if p != (0, 0)}

    serial["episodes_watched"] = [{"season": s, "episode": o} for s, o in sorted(pary)]
    przelicz_postep_serialu(serial)

    tmdb = tmdb or {}
    _uzupelnij_puste(serial, "tmdb_id", tmdb.get("id"))
    _uzupelnij_puste(serial, "imdb_id", tmdb.get("external_ids", {}).get("imdb_id") if isinstance(tmdb.get("external_ids"), dict) else None)
    _uzupelnij_puste(serial, "original_title", tmdb.get("original_name"))
    _uzupelnij_puste(serial, "plot", tmdb.get("overview"))
    _uzupelnij_puste(serial, "genre", _gatunki(tmdb))
    plakat = tmdb.get("poster_path")
    if isinstance(plakat, str) and plakat:
        _uzupelnij_puste(serial, "poster_url", f"{tmdb_client.TMDB_IMG_POSTER}{plakat}")
    _uzupelnij_puste(serial, "year", _lataj(tmdb.get("first_air_date")))
    _uzupelnij_puste(serial, "season_ep_counts", _sezony_z_tmdb(tmdb))

    liczba_odcinkow = tmdb.get("number_of_episodes")
    if isinstance(liczba_odcinkow, int) and liczba_odcinkow > 0:
        serial["total_episodes"] = liczba_odcinkow
    liczba_sezonow = tmdb.get("number_of_seasons")
    if isinstance(liczba_sezonow, int) and liczba_sezonow > 0:
        serial["total_seasons"] = liczba_sezonow
    status_tmdb = _tekst(tmdb.get("status"))
    if status_tmdb:
        serial["series_status"] = status_tmdb
    if "in_production" in tmdb:
        serial["in_production"] = bool(tmdb.get("in_production"))

    liczba_obejrzanych = len(serial["episodes_watched"])
    liczba_zwyklych = sum(1 for e in serial["episodes_watched"] if int(e.get("season") or 0) > 0)
    total = int(serial.get("total_episodes") or 0)
    zakonczony = serial.get("series_status") in ("Ended", "Canceled") or serial.get("in_production") is False
    # Do statusu liczą się tylko zwykłe sezony: speciale nie mogą udawać ukończenia serialu,
    # bo `total_episodes` z TMDb ich nie zawiera.
    komplet = total > 0 and liczba_zwyklych >= total
    if liczba_obejrzanych == 0:
        serial["status"] = "watchlist"
        serial["caught_up"] = False
    elif serial.get("status") == "watched":
        # „Obejrzany” nigdy nie degradujemy — najwyżej znosimy flagę nadrobienia.
        serial["caught_up"] = bool(komplet and not zakonczony)
    elif komplet and zakonczony:
        serial["status"] = "watched"
        serial["caught_up"] = False
    else:
        serial["status"] = "watching"
        serial["caught_up"] = komplet
    return serial


def zbuduj_film_z_tvtime(tvtime: dict, tmdb: dict | None) -> dict | None:
    """Nowy wpis filmu wyłącznie z eksportu TVTime (+ TMDb, jeśli dostępny).

    Zwraca None, gdy pozycja nie ma tytułu — TVTime potrafi oddać pusty wiersz,
    a taki wpis w bibliotece byłby śmieciem.
    """
    tytul = _tekst(tvtime.get("title")) or _tekst((tmdb or {}).get("title"))
    if not tytul:
        return None
    tmdb = tmdb or {}
    identyfikatory = tvtime.get("id") or {}
    kiedy = formatuj_date(tvtime.get("created_at"))
    obejrzany = bool(tvtime.get("is_watched"))
    film = {
        "uuid": _tekst(tvtime.get("uuid")) or None,
        "title": tytul,
        "original_title": _tekst(tmdb.get("original_title")) or _tekst(tvtime.get("title")),
        "year": _lataj(tmdb.get("release_date") or tvtime.get("year")),
        "genre": _gatunki(tmdb),
        "director": "",
        "cast": [],
        "plot": _tekst(tmdb.get("overview")),
        "runtime": tmdb.get("runtime") or 0,
        "poster_url": f"{tmdb_client.TMDB_IMG_POSTER}{tmdb['poster_path']}" if tmdb.get("poster_path") else "",
        "rating": None,
        "status": "watched" if obejrzany else "watchlist",
        "watch_date": formatuj_date(tvtime.get("watched_at")) if obejrzany else None,
        "follow_date": kiedy,
        "release_date": tmdb.get("release_date"),
        "is_favorite": bool(tvtime.get("is_favorite")),
        "rewatched": int(tvtime.get("rewatch_count") or 0),
        "raw_rating_suffix": None,
        "created_at": kiedy,
        "updated_at": kiedy,
        "user_date": (formatuj_date(tvtime.get("watched_at")) or kiedy or "")[:10],
        "tmdb_id": tmdb.get("id"),
        "imdb_id": identyfikatory.get("imdb"),
    }
    if film["uuid"] is None:
        film["uuid"] = f"movie_{normalizuj_tytul(film['title'])[:24]}_{film['year']}"
    return film


def zbuduj_serial_z_tvtime(tvtime: dict, odcinki: list[tuple[int, int]], tmdb: dict | None) -> dict | None:
    """Nowy wpis serialu wyłącznie z eksportu TVTime (+ TMDb, jeśli dostępny)."""
    tytul = _tekst(tvtime.get("title")) or _tekst((tmdb or {}).get("name"))
    if not tytul:
        return None
    tmdb = tmdb or {}
    identyfikatory = tvtime.get("id") or {}
    kiedy = formatuj_date(tvtime.get("created_at"))
    sezony_tvtime = {
        str(sezon.get("number")): len(sezon.get("episodes") or [])
        for sezon in (tvtime.get("seasons") or [])
        if isinstance(sezon, dict) and not sezon.get("is_specials") and isinstance(sezon.get("number"), int)
    }
    serial = {
        "uuid": _tekst(tvtime.get("uuid")) or None,
        "title": tytul,
        "original_title": _tekst(tmdb.get("original_name")) or _tekst(tvtime.get("title")),
        "year": _lataj(tmdb.get("first_air_date")),
        "genre": _gatunki(tmdb),
        "poster_url": f"{tmdb_client.TMDB_IMG_POSTER}{tmdb['poster_path']}" if tmdb.get("poster_path") else "",
        "plot": _tekst(tmdb.get("overview")),
        "cast": [],
        "director": "",
        "total_seasons": tmdb.get("number_of_seasons") or len(sezony_tvtime),
        "total_episodes": tmdb.get("number_of_episodes") or 0,
        "season_ep_counts": _sezony_z_tmdb(tmdb) or sezony_tvtime,
        "episodes_watched": [],
        "rating": None,
        "status": "watchlist",
        "series_status": _tekst(tmdb.get("status")),
        "in_production": bool(tmdb.get("in_production")) if "in_production" in tmdb else None,
        "caught_up": False,
        "is_favorite": bool(tvtime.get("is_favorite")),
        "tmdb_id": tmdb.get("id"),
        "imdb_id": identyfikatory.get("imdb"),
        "created_at": kiedy,
        "updated_at": kiedy,
        "user_date": (kiedy or "")[:10],
    }
    if serial["uuid"] is None:
        serial["uuid"] = f"series_{normalizuj_tytul(serial['title'])[:24]}"

    status_tvtime = _tekst(tvtime.get("status"))
    if status_tvtime == "not_started_yet" and not odcinki:
        serial["status"] = "watchlist"
    serial = scal_serial(serial, odcinki, tmdb)
    if status_tvtime == "stopped" and serial["status"] == "watching":
        # TVTime: „przestałem oglądać” — CineLog nie ma takiego statusu, zostaje „obejrzane”.
        serial["status"] = "watched"
    if status_tvtime == "up_to_date":
        serial["caught_up"] = True
    return serial


# --- TMDb -----------------------------------------------------------------

class Tmdb:
    """Klient TMDb z cache na dysku — ponowne uruchomienie nie płaci za te same zapytania."""

    def __init__(self, klucz: str, cache_path: pathlib.Path | None, wczytaj_cache: bool = True):
        self.klucz = klucz
        self.cache_path = cache_path
        self.cache: dict[str, object] = {}
        if cache_path and wczytaj_cache and cache_path.exists():
            try:
                self.cache = json.loads(cache_path.read_text(encoding="utf-8"))
            except ValueError:
                self.cache = {}
        self.zapytania = 0
        self._brudny = False

    def pobierz(self, path: str, params: dict | None = None) -> dict | None:
        klucz_cache = f"{path}?{urllib.parse.urlencode(params or {})}"
        if klucz_cache in self.cache:
            wartosc = self.cache[klucz_cache]
            return wartosc if isinstance(wartosc, dict) else None
        self.zapytania += 1
        wynik = tmdb_client.tmdb_get(path, params, self.klucz, timeout=15)
        self.cache[klucz_cache] = wynik
        self._brudny = True
        if self._brudny and self.zapytania % 50 == 0:
            self.zapisz()
        return wynik

    def zapisz(self) -> None:
        if self.cache_path and self._brudny:
            self.cache_path.write_text(json.dumps(self.cache, ensure_ascii=False), encoding="utf-8")
            self._brudny = False

    # --- wyszukiwania ---

    def film_po_imdb(self, imdb_id: str) -> dict | None:
        odp = self.pobierz(f"/find/{imdb_id}", {"external_source": "imdb_id"})
        for trafienie in (odp or {}).get("movie_results") or []:
            if trafienie.get("id"):
                return self.film_szczegoly(trafienie["id"])
        return None

    def film_po_tytule(self, tytul: str, rok: str | None = None) -> dict | None:
        params = {"query": tytul, "include_adult": "false"}
        if rok and str(rok)[:4].isdigit():
            params["year"] = str(rok)[:4]
        odp = self.pobierz("/search/movie", params)
        szukany = normalizuj_tytul(tytul)
        for trafienie in (odp or {}).get("results") or []:
            if normalizuj_tytul(trafienie.get("title")) == szukany or normalizuj_tytul(trafienie.get("original_title")) == szukany:
                return self.film_szczegoly(trafienie["id"])
        return None

    def film_szczegoly(self, tmdb_id: object) -> dict | None:
        return self.pobierz(f"/movie/{tmdb_id}", {"language": "pl-PL"})

    def serial_po_id(self, tmdb_id: object) -> dict | None:
        return self.pobierz(f"/tv/{tmdb_id}", {"language": "pl-PL"})

    def serial_po_tytule(self, tytul: str) -> dict | None:
        odp = self.pobierz("/search/tv", {"query": tytul, "include_adult": "false"})
        szukany = normalizuj_tytul(tytul)
        for trafienie in (odp or {}).get("results") or []:
            nazwa = normalizuj_tytul(trafienie.get("name"))
            oryginal = normalizuj_tytul(trafienie.get("original_name"))
            if szukany and szukany in (nazwa, oryginal):
                return self.serial_po_id(trafienie["id"])
        return None


# --- główny przebieg ------------------------------------------------------

def _klucz_tmdb() -> str:
    import os
    klucz = os.environ.get("TMDB_API_KEY", "").strip()
    if klucz:
        return klucz
    env = ROOT / ".env"
    if env.exists():
        for linia in env.read_text(encoding="utf-8").splitlines():
            linia = linia.strip()
            if linia.startswith("TMDB_API_KEY="):
                return linia.split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def zbuduj_indeksy(baza: list[dict]) -> dict[str, dict]:
    """Trzy indeksy biblioteki: po uuid, po tmdb_id i po znormalizowanym tytule."""
    indeks: dict[str, dict] = {"uuid": {}, "tmdb_id": {}, "tytul": {}}
    for wpis in baza:
        uuid_wpisu = _tekst(wpis.get("uuid"))
        if uuid_wpisu and uuid_wpisu not in indeks["uuid"]:
            indeks["uuid"][uuid_wpisu] = wpis
        if wpis.get("tmdb_id") is not None and str(wpis["tmdb_id"]) not in indeks["tmdb_id"]:
            indeks["tmdb_id"][str(wpis["tmdb_id"])] = wpis
        for pole in ("title", "original_title"):
            klucz = normalizuj_tytul(wpis.get(pole))
            if klucz and klucz not in indeks["tytul"]:
                indeks["tytul"][klucz] = wpis
    return indeks


def _dopisz_do_indeksow(indeksy: dict[str, dict], wpis: dict) -> None:
    """Dopisuje nowo dodany wpis do indeksów, żeby kolejna pozycja mogła go znaleźć."""
    uuid_wpisu = _tekst(wpis.get("uuid"))
    if uuid_wpisu and uuid_wpisu not in indeksy["uuid"]:
        indeksy["uuid"][uuid_wpisu] = wpis
    if wpis.get("tmdb_id") is not None and str(wpis["tmdb_id"]) not in indeksy["tmdb_id"]:
        indeksy["tmdb_id"][str(wpis["tmdb_id"])] = wpis
    for pole in ("title", "original_title"):
        klucz = normalizuj_tytul(wpis.get(pole))
        if klucz and klucz not in indeksy["tytul"]:
            indeksy["tytul"][klucz] = wpis


def _tytul_zblizony(klucz: str, znane: list[str]) -> str | None:
    """Najbliższy znany tytuł, gdy różni się jednym znakiem (np. „PLUR1BUS” i „Pluribus”).

    Wymóg zbliżonej długości jest istotny: bez niego „The Curse” skalibrowałoby się
    z „Cursed”, czyli dwa różne seriale zostałyby scalone w jeden.
    """
    najlepszy: tuple[float, str] | None = None
    for kandydat in znane:
        if abs(len(kandydat) - len(klucz)) > 1:
            continue
        stosunek = SequenceMatcher(None, klucz, kandydat).ratio()
        if stosunek >= 0.85 and (najlepszy is None or stosunek > najlepszy[0]):
            najlepszy = (stosunek, kandydat)
    return najlepszy[1] if najlepszy else None


def znajdz_cel(tvtime: dict, indeksy: dict[str, dict], tmdb_id: object) -> dict | None:
    """Znajduje wpis biblioteki odpowiadający pozycji z TVTime.

    Kolejność jest ważna: `uuid` i `tmdb_id` są odporne na różnice językowe tytułów,
    a dopasowanie po tytule (także z literówką) jest ostatnią deską ratunku przed
    zdublowaniem pozycji.
    """
    uuid_tv = _tekst(tvtime.get("uuid"))
    if uuid_tv and uuid_tv in indeksy["uuid"]:
        return indeksy["uuid"][uuid_tv]
    if tmdb_id is not None and str(tmdb_id) in indeksy["tmdb_id"]:
        return indeksy["tmdb_id"][str(tmdb_id)]
    klucz = normalizuj_tytul(tvtime.get("title"))
    if not klucz:
        return None
    if klucz in indeksy["tytul"]:
        return indeksy["tytul"][klucz]
    zblizony = _tytul_zblizony(klucz, list(indeksy["tytul"]))
    return indeksy["tytul"][zblizony] if zblizony else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="TVTime → plik importu CineLog")
    parser.add_argument("--eksport-dir", required=True, type=pathlib.Path, help="katalog z plikami TVTime")
    parser.add_argument("--baza", type=pathlib.Path, help="eksport biblioteki CineLog (tryb scalania)")
    parser.add_argument("--out", type=pathlib.Path, help="plik wynikowy (domyślnie w katalogu eksportu)")
    parser.add_argument("--cache", type=pathlib.Path, help="cache odpowiedzi TMDb")
    parser.add_argument("--raport", type=pathlib.Path, help="plik raportu JSON")
    parser.add_argument("--bez-tmdb", action="store_true", help="bez wzbogacania z TMDb")
    parser.add_argument("--bez-opisow", action="store_true", help="nie zapisuj opisów (mniejszy plik)")
    parser.add_argument("--limit", type=int, default=0, help="przetwórz tylko N pozycji każdego typu (test)")
    parser.add_argument("--workers", type=int, default=8, help="równoległe zapytania do TMDb")
    args = parser.parse_args(argv)

    katalog = args.eksport_dir
    filmy_tvtime, seriale_tvtime, odcinki_tvtime = wczytaj_eksport_tvtime(katalog)
    if args.limit:
        filmy_tvtime = filmy_tvtime[:args.limit]
        seriale_tvtime = seriale_tvtime[:args.limit]
    baza = wczytaj_baze(args.baza) if args.baza else {"movies": [], "shows": []}

    klucz = "" if args.bez_tmdb else _klucz_tmdb()
    cache_path = args.cache or (katalog / "tmdb-cache.json")
    tmdb = Tmdb(klucz, cache_path, wczytaj_cache=True) if klucz else None

    log = lambda tekst: print(tekst, flush=True)  # noqa: E731
    log(f"TVTime: {len(filmy_tvtime)} filmów, {len(seriale_tvtime)} seriali, "
        f"{sum(len(v) for v in odcinki_tvtime.values())} obejrzanych odcinków")
    log(f"Biblioteka bazowa: {len(baza['movies'])} filmów, {len(baza['shows'])} seriali"
        if args.baza else "Tryb czystej konwersji (bez scalania z biblioteką)")
    log("TMDb: włączone" if tmdb else "TMDb: wyłączone")

    # 1. Wzbogacenie istniejących wpisów biblioteki.
    def wzbogac_film_bazy(film: dict) -> tuple[dict, dict | None]:
        if not tmdb:
            return film, None
        tmdb_id = film.get("tmdb_id")
        szczegoly = tmdb.film_szczegoly(tmdb_id) if tmdb_id else None
        if not szczegoly:
            szczegoly = tmdb.film_po_tytule(film.get("title") or "", film.get("year"))
        return film, szczegoly

    def wzbogac_serial_bazy(serial: dict) -> tuple[dict, dict | None]:
        if not tmdb:
            return serial, None
        tmdb_id = serial.get("tmdb_id")
        szczegoly = tmdb.serial_po_id(tmdb_id) if tmdb_id else None
        if not szczegoly:
            szczegoly = tmdb.serial_po_tytule(serial.get("title") or "")
        return serial, szczegoly

    with ThreadPoolExecutor(max_workers=args.workers) as pula:
        szczegoly_filmow_bazy = dict(
            (id(f), s) for f, s in pula.map(wzbogac_film_bazy, baza["movies"])
        ) if baza["movies"] else {}
        szczegoly_seriali_bazy = dict(
            (id(s), d) for s, d in pula.map(wzbogac_serial_bazy, baza["shows"])
        ) if baza["shows"] else {}

    # 2. Wzbogacenie pozycji z TVTime (filmy po IMDb, seriale po tytule).
    def tmdb_dla_filmu_tv(tv: dict) -> dict | None:
        if not tmdb:
            return None
        imdb = (tv.get("id") or {}).get("imdb")
        return (tmdb.film_po_imdb(imdb) if imdb else None) or tmdb.film_po_tytule(tv.get("title") or "", tv.get("year"))

    def tmdb_dla_serialu_tv(tv: dict) -> dict | None:
        if not tmdb:
            return None
        return tmdb.serial_po_tytule(tv.get("title") or "")

    with ThreadPoolExecutor(max_workers=args.workers) as pula:
        tmdb_filmy_tv = list(pula.map(tmdb_dla_filmu_tv, filmy_tvtime))
        tmdb_seriale_tv = list(pula.map(tmdb_dla_serialu_tv, seriale_tvtime))

    # 3. Scalanie filmów.
    filmy_wynik: list[dict] = []
    for film in baza["movies"]:
        filmy_wynik.append(scal_film(film, None, szczegoly_filmow_bazy.get(id(film))))

    scalone_filmy = 0
    dodane_filmy = 0
    pominięte_filmy = 0
    nieznane_filmy: list[str] = []
    juz_scalone: set[int] = set()
    # Indeksy budujemy po wzbogaceniu — dopiero teraz wpisy znają swoje tmdb_id.
    indeksy_filmow = zbuduj_indeksy(baza["movies"])
    for tv, szczegoly in zip(filmy_tvtime, tmdb_filmy_tv):
        cel = znajdz_cel(tv, indeksy_filmow, (szczegoly or {}).get("id"))
        if cel is not None:
            if id(cel) in juz_scalone:
                continue
            juz_scalone.add(id(cel))
            scal_film(cel, tv, szczegoly)
            scalone_filmy += 1
            continue
        if szczegoly is None:
            nieznane_filmy.append(f"{tv.get('title')} ({tv.get('year')})")
        nowy = zbuduj_film_z_tvtime(tv, szczegoly)
        if nowy is None:
            pominięte_filmy += 1
            continue
        filmy_wynik.append(nowy)
        _dopisz_do_indeksow(indeksy_filmow, nowy)
        dodane_filmy += 1

    # 4. Scalanie seriali.
    seriale_wynik: list[dict] = []
    for serial in baza["shows"]:
        seriale_wynik.append(scal_serial(serial, [], szczegoly_seriali_bazy.get(id(serial))))

    scalone_seriale = 0
    dodane_seriale = 0
    pominięte_seriale = 0
    nieznane_seriale: list[str] = []
    juz_scalone_s: set[int] = set()
    indeksy_seriali = zbuduj_indeksy(baza["shows"])
    for tv, szczegoly in zip(seriale_tvtime, tmdb_seriale_tv):
        odcinki = odcinki_tvtime.get(_tekst(tv.get("uuid")), [])
        cel = znajdz_cel(tv, indeksy_seriali, (szczegoly or {}).get("id"))
        if cel is not None:
            if id(cel) in juz_scalone_s:
                continue
            juz_scalone_s.add(id(cel))
            scal_serial(cel, odcinki, szczegoly)
            scalone_seriale += 1
            continue
        if szczegoly is None and _tekst(tv.get("title")):
            nieznane_seriale.append(_tekst(tv.get("title")))
        nowy = zbuduj_serial_z_tvtime(tv, odcinki, szczegoly)
        if nowy is None:
            pominięte_seriale += 1
            continue
        seriale_wynik.append(nowy)
        _dopisz_do_indeksow(indeksy_seriali, nowy)
        dodane_seriale += 1

    if tmdb:
        tmdb.zapisz()

    if args.bez_opisow:
        for zbior in (filmy_wynik, seriale_wynik):
            for wpis in zbior:
                wpis["plot"] = ""

    out = args.out or (katalog / f"cinelog-import-{datetime.now().strftime('%Y-%m-%d')}.json")
    out.write_text(json.dumps({"movies": filmy_wynik, "shows": seriale_wynik},
                              ensure_ascii=False, indent=2), encoding="utf-8")

    raport = {
        "wygenerowano": datetime.now().strftime(FMT_DATY),
        "zrodlo_tvtime": str(katalog),
        "zrodlo_bazy": str(args.baza) if args.baza else None,
        "plik_wynikowy": str(out),
        "rozmiar_bajtow": out.stat().st_size,
        "filmy": {
            "w_bazie": len(baza["movies"]),
            "w_tvtime": len(filmy_tvtime),
            "scalone": scalone_filmy,
            "dodane_nowe": dodane_filmy,
            "pominiete_bez_tytulu": pominięte_filmy,
            "bez_dopasowania_tmdb": nieznane_filmy[:100],
            "bez_dopasowania_tmdb_ile": len(nieznane_filmy),
        },
        "seriale": {
            "w_bazie": len(baza["shows"]),
            "w_tvtime": len(seriale_tvtime),
            "scalone": scalone_seriale,
            "dodane_nowe": dodane_seriale,
            "pominiete_bez_tytulu": pominięte_seriale,
            "bez_dopasowania_tmdb": nieznane_seriale[:100],
            "bez_dopasowania_tmdb_ile": len(nieznane_seriale),
        },
        "zapytania_tmdb_w_tym_przebiegu": tmdb.zapytania if tmdb else 0,
        "wynik": {"filmy": len(filmy_wynik), "seriale": len(seriale_wynik)},
    }
    raport_path = args.raport or (katalog / "cinelog-import-raport.json")
    raport_path.write_text(json.dumps(raport, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"Gotowe: {out} ({out.stat().st_size / 1_048_576:.2f} MB)")
    log(f"  filmy:   {len(filmy_wynik)} (scalonych {scalone_filmy}, dodanych {dodane_filmy})")
    log(f"  seriale: {len(seriale_wynik)} (dodanych {dodane_seriale})")
    log(f"  bez dopasowania TMDb: {len(nieznane_filmy)} filmów, {len(nieznane_seriale)} seriali")
    log(f"  raport: {raport_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
