#!/usr/bin/env python3
"""Eksport RODO z TVTime (CSV) → plik importu CineLog dla całej biblioteki.

Ten eksport jest inny niż format Refract obsługiwany przez `tvtime_to_cinelog.py`:
zamiast plików JSON z API TVTime dostajemy zrzut tabel. Czytamy **wyłącznie** dane
biblioteczne:

* `tracking-prod-records.csv` — filmy: osobne wiersze `watch` (obejrzane) i `follow`,
* `tracking-prod-records-v2.csv` — seriale: po jednym wierszu `user-series-*`,
* `user_tv_show_data.csv` — `nb_episodes_seen` (liczba obejrzanych odcinków) i ulubione,
* znacznik ostatniego odcinka z kolumny `most_recent_ep_watched`.

Pliki z danymi osobowymi (tokeny, IP, adresy e-mail, identyfikatory urządzeń —
`access_token.csv`, `refresh_token.csv`, `device_token.csv`, `ip_address.csv`,
`user.csv`, `ad_identifier.csv`…) nie są w ogóle otwierane.

Czego ten eksport nie ma: **pełnej historii odcinków ani ocen**. Historię
odtwarzamy z licznika `nb_episodes_seen` w kolejności emisji (z liczbą odcinków
sezonów z TMDb), ograniczoną znacznikiem ostatniego odcinka — to przybliżenie,
które raport zgłasza jako ostrzeżenie.

Uruchomienie:

    python3 scripts/tvtime_gdpr_to_cinelog.py --katalog gdpr-data \\
        --wyjscie ~/Downloads/cinelog-import-osoba-2026-09-19.json --workers 8
"""

from __future__ import annotations

import argparse
import csv
import datetime
import functools
import importlib.util
import json
import pathlib
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

SCIEZKA_KONWERTERA = pathlib.Path(__file__).resolve().parent / "tvtime_to_cinelog.py"


def _wczytaj_konwerter() -> Any:
    """Reuse sprawdzonych reguł: budowa wpisów, postęp serialu, klient TMDb z cache."""
    spec = importlib.util.spec_from_file_location("tvtime_to_cinelog", SCIEZKA_KONWERTERA)
    if spec is None or spec.loader is None:  # pragma: no cover - zabezpieczenie
        raise ImportError(f"Nie mogę wczytać {SCIEZKA_KONWERTERA}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_KONWERTER = _wczytaj_konwerter()

PLIK_FILMY = "tracking-prod-records.csv"
PLIK_SERIALE = "tracking-prod-records-v2.csv"
PLIK_SHOW_DATA = "user_tv_show_data.csv"


def _wiersze(katalog: pathlib.Path, nazwa: str) -> list[dict]:
    sciezka = katalog / nazwa
    if not sciezka.exists():
        return []
    with sciezka.open(newline="", encoding="utf-8", errors="replace") as f:
        return list(csv.DictReader(f))


def _data(wartosc: object) -> str | None:
    """Zwraca datę w formacie `RRRR-MM-DD GG:MM:SS` albo None."""
    tekst = str(wartosc or "").strip()
    if not tekst:
        return None
    if re.fullmatch(r"\d{10,16}", tekst):  # znacznik w mikrosekundach z TVTime
        sekundy = float(tekst) / 1_000_000
        return datetime.datetime.fromtimestamp(sekundy).strftime("%Y-%m-%d %H:%M:%S")
    return tekst


# --- filmy ---------------------------------------------------------------------


def wczytaj_filmy(katalog: pathlib.Path) -> list[dict]:
    """Filmy z `tracking-prod-records.csv` — jeden wpis na tytuł, `watch` wygrywa z `follow`."""
    zebrane: dict[str, dict] = {}
    for wiersz in _wiersze(katalog, PLIK_FILMY):
        tytul = (wiersz.get("movie_name") or "").strip()
        if not tytul:
            continue
        uuid_filmu = (wiersz.get("uuid") or "").strip() or f"movie_{_KONWERTER.normalizuj_tytul(tytul)}"
        obejrzany = (wiersz.get("type") or "").strip() == "watch"
        wpis = zebrane.get(uuid_filmu)
        if wpis is None:
            wpis = {
                "title": tytul,
                "uuid": uuid_filmu,
                "is_watched": obejrzany,
                "watched_at": _data(wiersz.get("created_at")) if obejrzany else None,
                "created_at": _data(wiersz.get("created_at")),
                "release_date": (wiersz.get("release_date") or "").strip() or None,
                "runtime_sekundy": _liczba(wiersz.get("runtime")),
                "rewatch_count": _liczba(wiersz.get("rewatch_count")),
                "is_favorite": False,
                "id": {},
            }
            zebrane[uuid_filmu] = wpis
            continue
        if obejrzany and not wpis["is_watched"]:
            wpis["is_watched"] = True
            wpis["watched_at"] = _data(wiersz.get("created_at")) or wpis["watched_at"]
    return list(zebrane.values())


def _liczba(wartosc: object) -> int:
    try:
        return int(float(str(wartosc).strip()))
    except (TypeError, ValueError):
        return 0


# --- seriale -------------------------------------------------------------------


def _znacznik_odcinka(wartosc: object) -> tuple[int, int] | None:
    """Wybiera sezon i odcinek ze stringa mapy Go, np. `map[ep_no:12 s_no:7 …]`."""
    tekst = str(wartosc or "")
    sezon = re.search(r"\bs_no:(\d+)", tekst)
    odcinek = re.search(r"\bep_no:(\d+)", tekst)
    if not sezon or not odcinek:
        return None
    return (int(sezon.group(1)), int(odcinek.group(1)))


def _data_znacznika(wartosc: object) -> str | None:
    """Data obejrzenia z mapy Go TVTime — czas podany w mikrosekundach, notacja naukowa."""
    dopasowanie = re.search(r"watch_date:([0-9.eE+]+)", str(wartosc or ""))
    if not dopasowanie:
        return None
    try:
        sekundy = float(dopasowanie.group(1)) / 1_000_000
        return datetime.datetime.fromtimestamp(sekundy).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def wczytaj_seriale(katalog: pathlib.Path) -> list[dict]:
    """Seriale obserwowane (wiersze `user-series-*`) z liczbą obejrzanych odcinków."""
    dane_show = {}
    for wiersz in _wiersze(katalog, PLIK_SHOW_DATA):
        nazwa = (wiersz.get("tv_show_name") or "").strip()
        if nazwa:
            dane_show[_KONWERTER.normalizuj_tytul(nazwa)] = wiersz

    seriale: list[dict] = []
    for wiersz in _wiersze(katalog, PLIK_SERIALE):
        if not (wiersz.get("key") or "").startswith("user-series-"):
            continue
        tytul = (wiersz.get("series_name") or "").strip()
        if not tytul:
            continue
        szczegoly = dane_show.get(_KONWERTER.normalizuj_tytul(tytul), {})
        obejrzane = _liczba(szczegoly.get("nb_episodes_seen"))
        obserwowany = (szczegoly.get("is_followed") or wiersz.get("is_followed") or "").strip().lower() in (
            "1", "true", "yes",
        )
        # Pozycje bez obserwowania i bez obejrzanych odcinków nie są częścią biblioteki.
        if not obserwowany and obejrzane == 0:
            continue
        seriale.append({
            "title": tytul,
            "uuid": (wiersz.get("uuid") or "").strip() or f"series_{_KONWERTER.normalizuj_tytul(tytul)}",
            "episodes_seen": obejrzane,
            "ostatni_odcinek": _znacznik_odcinka(wiersz.get("most_recent_ep_watched")),
            "data_ostatniego_odcinka": _data_znacznika(wiersz.get("most_recent_ep_watched")),
            "is_favorite": (szczegoly.get("is_favorited") or "").strip().lower() in ("1", "true", "yes"),
            "is_followed": obserwowany,
            "tv_show_id": (wiersz.get("s_id") or szczegoly.get("tv_show_id") or "").strip() or None,
            "created_at": _data(wiersz.get("followed_at") or wiersz.get("created_at")),
            "title_tmdb": tytul,
            "id": {},
        })
    return seriale


def odtworz_odcinki(
    liczba: int,
    sezony: dict[str, int],
    znacznik: tuple[int, int] | None = None,
) -> list[tuple[int, int]]:
    """Odtwarza listę obejrzanych odcinków: po kolei od S1E1, z liczbą odcinków sezonów.

    Eksport RODO nie zawiera pełnej historii, więc to rekonstrukcja: bierzemy licznik
    obejrzanych odcinków i znacznik ostatnio obejrzanego odcinka. Sezon 0 (speciale)
    pomijamy, bo nie da się go wiarygodnie rozłożyć. Bez danych o sezonach zwracamy
    pustą listę — wolimy brak postępu niż wymyślone odcinki.
    """
    if liczba <= 0 or not sezony:
        return []
    odcinki: list[tuple[int, int]] = []
    for numer_sezonu in sorted((int(s) for s in sezony if int(s) > 0)):
        ile = sezony.get(str(numer_sezonu)) or 0
        for numer_odcinka in range(1, ile + 1):
            if liczba and len(odcinki) >= liczba:
                return odcinki
            if znacznik is not None and (numer_sezonu, numer_odcinka) > znacznik:
                return odcinki
            odcinki.append((numer_sezonu, numer_odcinka))
    return odcinki


# --- budowa biblioteki ---------------------------------------------------------


def _sezony_tmdb(tmdb: dict | None) -> dict[str, int]:
    sezony = {}
    for sezon in ((tmdb or {}).get("seasons") or []):
        numer = sezon.get("season_number")
        if isinstance(numer, int) and numer > 0 and sezon.get("episode_count"):
            sezony[str(numer)] = int(sezon["episode_count"])
    return sezony


def zbuduj_biblioteke_z_raportem(katalog: pathlib.Path, tmdb: dict[str, dict]) -> tuple[dict, dict]:
    """Buduje bibliotekę CineLog z eksportu RODO; zwraca (biblioteka, raport)."""
    ostrzezenia: list[str] = []

    filmy = wczytaj_filmy(katalog)
    wpisy_filmow = []
    for film in filmy:
        szczegoly = tmdb.get(film["title"]) or None
        wpis = _KONWERTER.zbuduj_film_z_tvtime(film, szczegoly)
        if wpis is None:
            continue
        if not wpis.get("runtime") and film.get("runtime_sekundy"):
            wpis["runtime"] = round(film["runtime_sekundy"] / 60)
        wpisy_filmow.append(wpis)

    # TVTime potrafi trzymać ten sam film pod dwoma identyfikatorami. Deduplikujemy
    # wyłącznie po `tmdb_id`, bo to pewna identyfikacja — przy braku TMDb nie ruszamy
    # niczego (dwa różne filmy mogą mieć ten sam tytuł i rok, np. wersja kinowa i remake).
    deduplikowane: list[dict] = []
    widziane_tmdb: set[object] = set()
    duplikaty = 0
    for wpis in wpisy_filmow:
        identyfikator = wpis.get("tmdb_id")
        if identyfikator and identyfikator in widziane_tmdb:
            duplikaty += 1
            continue
        if identyfikator:
            widziane_tmdb.add(identyfikator)
        deduplikowane.append(wpis)
    wpisy_filmow = deduplikowane

    seriale = wczytaj_seriale(katalog)
    wpisy_seriali = []
    for serial in seriale:
        szczegoly = tmdb.get(serial["title"]) or None
        sezony = _sezony_tmdb(szczegoly)
        odcinki = odtworz_odcinki(serial["episodes_seen"], sezony, serial["ostatni_odcinek"])
        wejscie = {
            "title": serial["title"],
            "uuid": serial["uuid"],
            "created_at": serial["created_at"],
            "is_favorite": serial["is_favorite"],
            "status": "not_started_yet" if serial["episodes_seen"] == 0 else "",
            "id": {},
        }
        wpis = _KONWERTER.zbuduj_serial_z_tvtime(wejscie, odcinki, szczegoly)
        if wpis is None:
            continue
        # Data obejrzenia ostatniego odcinka jest znana; wstawiamy ją na ostatni odtworzony
        # odcinek i na `updated_at`, żeby „ostatnio oglądane” oraz statystyki roczne działały.
        if serial["data_ostatniego_odcinka"] and wpis.get("episodes_watched"):
            wpis["episodes_watched"][-1]["created_at"] = serial["data_ostatniego_odcinka"]
            wpis["updated_at"] = serial["data_ostatniego_odcinka"]
        if serial["episodes_seen"] > 0:
            odtworzone = len(wpis.get("episodes_watched") or [])
            if odtworzone == 0:
                wpis["status"] = "watching"
                ostrzezenia.append(
                    f"{serial['title']}: brak danych o sezonach w TMDb — w bibliotece jest status "
                    f"„w trakcie” bez odcinków (TVTime podał {serial['episodes_seen']} obejrzanych)."
                )
            elif odtworzone < serial["episodes_seen"]:
                ostrzezenia.append(
                    f"{serial['title']}: odtworzono {odtworzone} z {serial['episodes_seen']} odcinków "
                    f"(ograniczenie: znacznik ostatniego odcinka i liczba odcinków w sezonach)."
                )
        wpisy_seriali.append(wpis)

    biblioteka = {"movies": wpisy_filmow, "shows": wpisy_seriali}
    raport = {
        "zrodlo": str(katalog),
        "filmy": len(wpisy_filmow),
        "seriale": len(wpisy_seriali),
        "filmy_obejrzane": sum(1 for f in wpisy_filmow if f.get("status") == "watched"),
        "filmy_do_obejrzenia": sum(1 for f in wpisy_filmow if f.get("status") == "watchlist"),
        "odcinki_odtworzone": sum(len(s.get("episodes_watched") or []) for s in wpisy_seriali),
        "z_tmdb": sum(1 for w in wpisy_filmow + wpisy_seriali if w.get("tmdb_id")),
        "duplikaty_usuniete": duplikaty,
        "ostrzezenia": ostrzezenia,
        "uwaga": (
            "Eksport RODO nie zawiera pełnej historii odcinków ani ocen — historia odcinków "
            "została odtworzona z licznika obejrzanych odcinków, a oceny pozostają puste."
        ),
    }
    return biblioteka, raport


def zbuduj_biblioteke(katalog: pathlib.Path, tmdb: dict[str, dict]) -> dict:
    biblioteka, _ = zbuduj_biblioteke_z_raportem(katalog, tmdb)
    return biblioteka


# --- TMDb ----------------------------------------------------------------------


def szukaj_filmu(klient: Any, film: dict) -> tuple[str, dict | None]:
    """Szuka filmu w TMDb po tytule i roku; gdy rok nie pomaga, ponawia bez roku.

    Rok bywa w eksporcie z innej premiery niż w TMDb (polskie premiery, reedycje),
    dlatego druga próba jest bez roku — bez niej kilkanaście pozycji zostawało bez danych.
    """
    rok = (film.get("release_date") or "")[:4] or None
    trafienie = klient.film_po_tytule(film["title"], rok)
    if not trafienie and rok:
        trafienie = klient.film_po_tytule(film["title"], None)
    if trafienie and trafienie.get("id"):
        return film["title"], klient.film_szczegoly(trafienie["id"]) or trafienie
    return film["title"], None


def zbierz_dane_tmdb(
    klucz: str,
    filmy: list[dict],
    seriale: list[dict],
    cache_path: pathlib.Path | None = None,
    workers: int = 8,
) -> dict[str, dict]:
    """Dociąga metadane TMDb dla tytułów (równolegle, z cache na dysku)."""
    if not klucz:
        return {}
    klient = _KONWERTER.Tmdb(klucz, cache_path, wczytaj_cache=True)

    def dla_serialu(serial: dict) -> tuple[str, dict | None]:
        trafienie = klient.serial_po_tytule(serial["title"])
        if trafienie and trafienie.get("id"):
            return serial["title"], klient.serial_po_id(trafienie["id"]) or trafienie
        return serial["title"], None

    wynik: dict[str, dict] = {}
    zadania: list[Callable[[], tuple[str, dict | None]]] = [
        functools.partial(szukaj_filmu, klient, film) for film in filmy
    ] + [
        functools.partial(dla_serialu, serial) for serial in seriale
    ]
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pula:
        przyszlosci = [pula.submit(zadanie) for zadanie in zadania]
        for przyszlosc in przyszlosci:
            tytul, dane = przyszlosc.result()
            if dane:
                wynik[tytul] = dane
    klient.zapisz()
    return wynik


def _klucz_tmdb() -> str:
    return _KONWERTER._klucz_tmdb()


# --- wejście/wyjście -----------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Eksport RODO z TVTime → plik importu CineLog")
    parser.add_argument("--katalog", required=True, type=pathlib.Path, help="katalog z plikami CSV")
    parser.add_argument("--wyjscie", required=True, type=pathlib.Path, help="gdzie zapisać plik importu")
    parser.add_argument("--raport", type=pathlib.Path, help="gdzie zapisać raport")
    parser.add_argument("--cache", type=pathlib.Path, help="cache odpowiedzi TMDb")
    parser.add_argument("--workers", type=int, default=8, help="równoległe zapytania do TMDb")
    parser.add_argument("--bez-tmdb", action="store_true", help="pomiń wzbogacanie z TMDb")
    args = parser.parse_args(argv)

    katalog = args.katalog
    if not katalog.is_dir():
        print(f"Nie ma katalogu {katalog}", file=sys.stderr)
        return 2

    klucz = "" if args.bez_tmdb else _klucz_tmdb()
    filmy = wczytaj_filmy(katalog)
    seriale = wczytaj_seriale(katalog)
    cache_path = args.cache or (katalog / "tmdb-cache.json")
    tmdb = zbierz_dane_tmdb(klucz, filmy, seriale, cache_path, args.workers) if klucz else {}

    biblioteka, raport = zbuduj_biblioteke_z_raportem(katalog, tmdb)
    biblioteka["exported_at"] = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    args.wyjscie.parent.mkdir(parents=True, exist_ok=True)
    args.wyjscie.write_text(json.dumps(biblioteka, ensure_ascii=False, indent=2), encoding="utf-8")
    plik_raportu = args.raport or args.wyjscie.with_name(args.wyjscie.stem + "-raport.json")
    plik_raportu.write_text(json.dumps(raport, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"filmy:    {raport['filmy']} (obejrzane {raport['filmy_obejrzane']}, do obejrzenia {raport['filmy_do_obejrzenia']})")
    print(f"seriale:  {raport['seriale']} (odtworzone odcinki: {raport['odcinki_odtworzone']})")
    print(f"z TMDb:   {raport['z_tmdb']} pozycji")
    print(f"zapisane: {args.wyjscie}")
    print(f"raport:   {plik_raportu}")
    for ostrzezenie in raport["ostrzezenia"][:10]:
        print(f"  uwaga: {ostrzezenie}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
