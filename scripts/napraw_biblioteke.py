#!/usr/bin/env python3
"""Naprawa i audyt identyfikatorów TMDb w bibliotece CineLog.

Po co: aplikacja kojarzyła wpisy z TMDb biorąc **pierwszy wynik** wyszukiwania,
nie sprawdzając tytułu ani roku. Skutek jest widoczny do dziś: w danych siedzą
identyfikatory innych produkcji („Breaking Bad” → 81189, „You Me Her” → 309130,
część wskazuje wpisy, których TMDb nie zna). Wtedy opis i obsada pochodzą z jednego
serialu, a odcinki z innego — dokładnie to zgłosił użytkownik.

Ten skrypt sprawdza **każdy** wpis z identyfikatorem, dopasowuje ponownie po tytule
i roku (te same reguły, co w aplikacji: ``wybierzTrafienieWTmdb`` z ``state.js``)
i naprawia. Reguły celowo są identyczne — inaczej naprawa i aplikacja mogłyby
dojść do różnych wniosków dla tego samego wpisu.

Tryby:
    # sam przegląd, bez zapisu (bezpieczne dla dowolnego pliku)
    python3 scripts/napraw_biblioteke.py --plik ~/Downloads/eksport.json --tylko-sprawdz

    # naprawa pliku eksportu do nowego pliku + raport
    python3 scripts/napraw_biblioteke.py --plik ~/Downloads/eksport.json

    # naprawa bazy serwera (data/*.json) z zapisem i kopią w static/data/
    python3 scripts/napraw_biblioteke.py --serwer --na-miejscu

Czego skrypt NIE rusza: statusów, ocen, dat, `episodes_watched`, `watched_count`,
`uuid` i tytułów użytkownika. Uzupełnia wyłącznie metadane pochodzące z TMDb.
"""

from __future__ import annotations

import argparse
import datetime
import importlib.util
import json
import pathlib
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent.parent
SCIEZKA_KONWERTERA = ROOT / "scripts" / "tvtime_to_cinelog.py"
KATALOG_DANYCH = ROOT / "data"
KATALOG_LUSTRA = ROOT / "static" / "data"
CACHE_TMDB = ROOT / "tmdb-cache.json"
ADRES_PLAKATU = "https://image.tmdb.org/t/p/w500"

#: Pola, które wolno uzupełniać z TMDb. Wszystko poza tą listą należy do użytkownika.
POLA_SERIALA = (
    "tmdb_id", "poster_url", "total_seasons", "total_episodes", "season_ep_counts",
    "year", "plot", "genre", "original_title", "series_status", "in_production",
)
POLA_FILMU = ("tmdb_id", "poster_url", "year", "release_date", "runtime", "plot", "genre", "original_title")

RODZAJE = {"serial": "tv", "film": "movie"}


def _wczytaj_konwerter() -> Any:
    """Reuse klienta TMDb z cache i normalizacji tytułów z konwertera TVTime."""
    spec = importlib.util.spec_from_file_location("tvtime_to_cinelog", SCIEZKA_KONWERTERA)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_KONWERTER = _wczytaj_konwerter()
normalizuj = _KONWERTER.normalizuj_tytul


# --- reguły dopasowania (identyczne jak w aplikacji) ------------------------


def rok_z_daty(wartosc: object) -> str | None:
    """Wyciąga rok z „2023-04-21”, „2023” albo liczby. Puste/śmieci → None."""
    tekst = str(wartosc or "").strip()
    if len(tekst) >= 4 and tekst[:4].isdigit():
        return tekst[:4]
    return None


ROK_W_NAZWIE = re.compile(r"\s*\(((?:19|20)\d{2})\)\s*$")
KRAJ_W_NAZWIE = re.compile(r"\s*\((?P<kraj>[A-Z]{2,4})\)\s*$")


def rok_z_tytulu(tytul: object) -> str | None:
    """Rok dopisany w tytule przez użytkownika: „Maniac (2018)” → „2018”."""
    dopasowanie = ROK_W_NAZWIE.search(str(tytul or ""))
    return dopasowanie.group(1) if dopasowanie else None


def tytul_do_dopasowania(tytul: object) -> str:
    """Tytuł bez użytkowych dopisków: „Maniac (2018)” → „Maniac”, „Biuro (US)” → „Biuro”.

    Dopiski są w danych użytkownika, więc nie ruszamy samych tytułów — czyścimy je
    tylko na potrzeby wyszukiwania i porównania z TMDb (inaczej „Maniac (2018)”
    nie znajduje nic, a „Scenes From A Marriage (US)” myli się z wersją szwedzką).
    """
    tekst = str(tytul or "").strip()
    tekst = ROK_W_NAZWIE.sub("", tekst)
    tekst = KRAJ_W_NAZWIE.sub("", tekst)
    return tekst.strip()


def kraj_z_tytulu(tytul: object) -> str | None:
    dopasowanie = KRAJ_W_NAZWIE.search(str(tytul or ""))
    return dopasowanie.group("kraj").upper() if dopasowanie else None


def tytuly_wyniku(wynik: dict) -> set[str]:
    """Znormalizowane tytuły kandydata (serial i film mają inne nazwy pól)."""
    nazwy = {normalizuj(wynik.get(pole)) for pole in ("name", "title", "original_name", "original_title")}
    return {n for n in nazwy if n}


def rok_wyniku(wynik: dict) -> str | None:
    return rok_z_daty(wynik.get("first_air_date") or wynik.get("release_date"))


def wybierz_trafienie_tmdb(wyniki: list[dict] | None, tytul: object, rok: object,
                           tytul_oryginalny: object = None) -> dict | None:
    """Dopasowanie wyniku wyszukiwania do wpisu — rozszerzenie ``wybierzTrafienieWTmdb`` z aplikacji.

    Przyjmujemy wyłącznie kandydata o zgodnym tytule (lub tytule oryginalnym). Rok,
    gdy znany po obu stronach, nie może się różnić o więcej niż 1. Gdy roku wpisu
    nie znamy, a kandydatów jest kilku — nie zgadujemy (lepiej nie mieć danych niż mieć cudze).

    Ponad reguły aplikacji skrypt zna dwa sygnały z danych użytkownika: rok dopisany
    w tytule („Maniac (2018)”) oraz dopisek kraju („Scenes From A Marriage (US)”).
    """
    cele = {normalizuj(tytul), normalizuj(tytul_do_dopasowania(tytul)), normalizuj(tytul_oryginalny)}
    cele.discard("")
    if not cele or not wyniki:
        return None
    rok_celu = rok_z_daty(rok) or rok_z_tytulu(tytul)

    zgodne: list[dict] = []
    for wynik in wyniki:
        if not isinstance(wynik, dict):
            continue
        if not (tytuly_wyniku(wynik) & cele):
            continue
        rokW = rok_wyniku(wynik)
        if rok_celu and rokW and abs(int(rokW) - int(rok_celu)) > 1:
            continue
        zgodne.append(wynik)

    if not zgodne:
        return None
    if len(zgodne) > 1:
        kraj = kraj_z_tytulu(tytul)
        if kraj:
            jezyk = "en" if kraj in {"US", "UK", "GB", "CA", "AU"} else None
            po_kraju = [w for w in zgodne if jezyk and str(w.get("original_language") or "") == jezyk]
            if len(po_kraju) == 1:
                return po_kraju[0]
        if not rok_celu:
            return None
    return zgodne[0]


# --- narzędzia na wpisach ---------------------------------------------------


def _puste(wartosc: object) -> bool:
    return wartosc is None or (isinstance(wartosc, str) and not wartosc.strip()) or wartosc == [] or wartosc == {}


def _tytul_wpisany_zgodny(szczegoly: dict, tytul: object) -> bool:
    """Czy szczegóły TMDb opisują produkcję o tytule wpisanym przez użytkownika."""
    cele = {normalizuj(tytul), normalizuj(tytul_do_dopasowania(tytul))}
    cele.discard("")
    return bool(cele) and bool(tytuly_wyniku(szczegoly) & cele)


def _identyfikator_zgodny(klient: Any, sciezka: str, identyfikator: str, tytul: object, rok: object,
                          szczegoly: dict) -> bool:
    """Weryfikuje identyfikator wpisu: musi się zgadzać tytuł ORAZ rok produkcji.

    Sama zgodność tytułu to za mało — „Lost in Space (2018)” z identyfikatorem serialu
    z 1965 roku ma zgodny tytuł, a i tak wskazuje inną produkcję.

    TMDb zwraca nazwy w języku zapytania: przy pl-PL „The Office (US)” ma nazwę
    „Biuro”, a użytkownik ma tytuł z innego źródła („Money Heist” vs „Dom z papieru”).
    Dlatego gdy polska nazwa nie pasuje, pytamy jeszcze raz po angielsku — inaczej
    poprawne identyfikatory byłyby kasowane jako błędne.
    """
    if not _tytul_wpisany_zgodny(szczegoly, tytul):
        po_angielsku = klient.pobierz(f"/{sciezka}/{identyfikator}", {"language": "en-US"})
        if not (isinstance(po_angielsku, dict) and _tytul_wpisany_zgodny(po_angielsku, tytul)):
            return False
        szczegoly = po_angielsku

    rok_celu = rok_z_daty(rok)
    rokW = rok_wyniku(szczegoly)
    return not (rok_celu and rokW and abs(int(rokW) - int(rok_celu)) > 1)


def _ustaw(wpis: dict, pole: str, wartosc: object, zmiany: list[dict], *,
           wymus: bool, tytul: str, rodzaj: str, uuid: str) -> None:
    """Ustawia pole tylko wtedy, gdy wolno (puste albo identyfikator się zmienił)."""
    if wartosc in (None, "", [], {}):
        return
    if pole not in wpis and pole != "tmdb_id":
        return  # nie dokładamy pól, których w tym kształcie danych nie ma
    stare = wpis.get(pole)
    if not wymus and not _puste(stare):
        return
    if stare == wartosc:
        return
    wpis[pole] = wartosc
    zmiany.append({"uuid": uuid, "tytul": tytul, "rodzaj": rodzaj, "pole": pole, "stare": stare, "nowe": wartosc})


def _metadane_z_tmdb(wpis: dict, szczegoly: dict, rodzaj: str, zmiany: list[dict], *, wymus: bool) -> None:
    """Uzupełnia metadane TMDb. ``wymus`` = wpis wskazywał wcześniej inną produkcję."""
    uuid = str(wpis.get("uuid") or "")
    tytul = str(wpis.get("title") or "")
    plakat = szczegoly.get("poster_path")
    _ustaw(wpis, "poster_url", f"{ADRES_PLAKATU}{plakat}" if plakat else None, zmiany,
           wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
    _ustaw(wpis, "original_title", szczegoly.get("original_name") or szczegoly.get("original_title"), zmiany,
           wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)

    if rodzaj == "serial":
        _ustaw(wpis, "total_seasons", szczegoly.get("number_of_seasons"), zmiany,
               wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        _ustaw(wpis, "total_episodes", szczegoly.get("number_of_episodes"), zmiany,
               wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        sezony = szczegoly.get("seasons")
        if isinstance(sezony, list) and sezony:
            _ustaw(wpis, "season_ep_counts", _sezony_ze_szczegolow(sezony), zmiany,
                   wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        _ustaw(wpis, "series_status", szczegoly.get("status"), zmiany,
               wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        if isinstance(szczegoly.get("in_production"), bool):
            _ustaw(wpis, "in_production", szczegoly["in_production"], zmiany,
                   wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        _ustaw(wpis, "year", rok_z_daty(szczegoly.get("first_air_date")), zmiany,
               wymus=False, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
    else:
        _ustaw(wpis, "release_date", szczegoly.get("release_date"), zmiany,
               wymus=False, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
        _ustaw(wpis, "runtime", szczegoly.get("runtime") or None, zmiany,
               wymus=False, tytul=tytul, rodzaj=rodzaj, uuid=uuid)

    _ustaw(wpis, "plot", szczegoly.get("overview"), zmiany,
           wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)
    _ustaw(wpis, "genre", _gatunki_ze_szczegolow(szczegoly.get("genres")), zmiany,
           wymus=wymus, tytul=tytul, rodzaj=rodzaj, uuid=uuid)


def _sezony_ze_szczegolow(sezony: list[dict]) -> dict[str, int]:
    """{„1”: 8, „2”: 8} — pomija sezon 0 (speciale), tak jak aplikacja."""
    wynik: dict[str, int] = {}
    for sezon in sezony:
        numer = sezon.get("season_number")
        liczba = sezon.get("episode_count")
        if isinstance(numer, int) and numer > 0 and isinstance(liczba, int):
            wynik[str(numer)] = liczba
    return wynik


def _gatunki_ze_szczegolow(gatunki: object) -> str:
    if not isinstance(gatunki, list):
        return ""
    return ", ".join(str(g.get("name")) for g in gatunki if isinstance(g, dict) and g.get("name"))


# --- główna logika na wpisie ------------------------------------------------


def _szukaj(klient: Any, sciezka: str, tytul: str) -> dict | None:
    """Wyszukiwanie po oczyszczonym tytule; gdy pusto — ponowienie na tytule z danych."""
    zapytanie = tytul_do_dopasowania(tytul) or tytul
    wyniki = klient.pobierz(f"/search/{sciezka}", {"query": zapytanie, "include_adult": "false", "language": "pl-PL"})
    if isinstance(wyniki, dict) and wyniki.get("results"):
        return wyniki
    if zapytanie != tytul:
        wyniki = klient.pobierz(f"/search/{sciezka}", {"query": tytul, "include_adult": "false", "language": "pl-PL"})
    return wyniki


def przetworz_wpis(wpis: dict, rodzaj: str, klient: Any, *, naprawiaj: bool) -> list[dict]:
    """Sprawdza jeden wpis; przy ``naprawiaj=True`` poprawia go w miejscu.

    Zwraca listę zmian (również planowanych, gdy ``naprawiaj=False``) — każda pozycja
    ma ``pole``, ``stare`` i ``nowe``.
    """
    zmiany: list[dict] = []
    sciezka = RODZAJE[rodzaj]
    uuid = str(wpis.get("uuid") or "")
    tytul = str(wpis.get("title") or "")
    rok = rok_z_daty(wpis.get("year") or wpis.get("release_date")) or rok_z_tytulu(tytul)

    obecne = str(wpis.get("tmdb_id") or "").strip()
    szczegoly = klient.pobierz(f"/{sciezka}/{obecne}", {"language": "pl-PL"}) if obecne else None
    if obecne and isinstance(szczegoly, dict) and _identyfikator_zgodny(klient, sciezka, obecne, tytul, rok,
                                                                        szczegoly):
        if naprawiaj:
            _metadane_z_tmdb(wpis, szczegoly, rodzaj, zmiany, wymus=False)
        return zmiany

    # identyfikator brak, nie znaleziony albo wskazuje inną produkcję — szukamy po tytule i roku
    wyniki = _szukaj(klient, sciezka, tytul)
    lista = (wyniki or {}).get("results") if isinstance(wyniki, dict) else None
    trafienie = wybierz_trafienie_tmdb(lista, tytul, rok, wpis.get("original_title"))

    if not trafienie:
        if obecne:
            if not lista:
                # TMDb nie znajduje tytułu z danych (np. użytkownik ma tłumaczenie, którego
                # TMDb nie zna) — nie mamy czym podważyć zapisanego identyfikatora, więc go nie kasujemy.
                zmiany.append({"uuid": uuid, "tytul": tytul, "rodzaj": rodzaj, "pole": "weryfikacja",
                               "stare": obecne, "nowe": obecne,
                               "opis": "nie mogę potwierdzić zgodności tytułu z TMDb (brak wyników wyszukiwania)"
                                       " — identyfikator zostawiony bez zmian"})
                return zmiany
            podpowiedzi = ", ".join(
                f"{w.get('name') or w.get('title')} ({rok_wyniku(w) or '?'}, id {w.get('id')})"
                for w in (lista or [])[:3] if isinstance(w, dict)
            )
            zmiany.append({"uuid": uuid, "tytul": tytul, "rodzaj": rodzaj, "pole": "tmdb_id",
                           "stare": obecne, "nowe": None,
                           "opis": "identyfikator wskazywał inną produkcję, brak pewnego dopasowania"
                                   + (f"; kandydaci: {podpowiedzi}" if podpowiedzi else "")})
            if naprawiaj:
                wpis["tmdb_id"] = None
        return zmiany

    nowe_id = str(trafienie.get("id"))
    if naprawiaj:
        wpis["tmdb_id"] = nowe_id
    if nowe_id != obecne:
        zmiany.append({"uuid": uuid, "tytul": tytul, "rodzaj": rodzaj, "pole": "tmdb_id",
                       "stare": obecne or None, "nowe": nowe_id})

    nowe_szczegoly = klient.pobierz(f"/{sciezka}/{nowe_id}", {"language": "pl-PL"})
    if naprawiaj and isinstance(nowe_szczegoly, dict):
        # wymus=True: stary plakat/opis pochodziły z innej produkcji
        _metadane_z_tmdb(wpis, nowe_szczegoly, rodzaj, zmiany, wymus=bool(obecne) and obecne != nowe_id)
    return zmiany


def przetworz_sekcje(wpisy: list[dict], rodzaj: str, klient: Any, *, naprawiaj: bool) -> list[dict]:
    """Przetwarza listę wpisów (sekwencyjnie) i zwraca wszystkie zmiany."""
    zmiany: list[dict] = []
    for wpis in wpisy:
        if isinstance(wpis, dict):
            zmiany.extend(przetworz_wpis(wpis, rodzaj, klient, naprawiaj=naprawiaj))
    return zmiany


def przetworz_sekcje_rownolegle(wpisy: list[dict], rodzaj: str, klient: Any, *, naprawiaj: bool,
                                workers: int) -> list[dict]:
    """Jak ``przetworz_sekcje``, ale zapytania do TMDb idą równolegle."""
    if workers <= 1 or len(wpisy) < 2:
        return przetworz_sekcje(wpisy, rodzaj, klient, naprawiaj=naprawiaj)
    zmiany: list[dict] = []
    with ThreadPoolExecutor(max_workers=workers) as pula:
        for czastka in pula.map(lambda w: przetworz_wpis(w, rodzaj, klient, naprawiaj=naprawiaj) if isinstance(w, dict) else [], wpisy):
            zmiany.extend(czastka)
    return zmiany


# --- wejście/wyjście -------------------------------------------------------


def zbuduj_klienta() -> Any:
    klucz = _KONWERTER._klucz_tmdb()
    if not klucz:
        raise SystemExit("Brak klucza TMDb (TMDB_API_KEY w .env albo w środowisku).")
    klient = _KONWERTER.Tmdb(klucz, CACHE_TMDB)
    # cache zapisujemy raz, na końcu — równoległe zapisy w trakcie mogłyby się nakładać
    klient.cache_path = None
    return klient


def zapisz_cache(klient: Any) -> None:
    if getattr(klient, "cache", None):
        CACHE_TMDB.write_text(json.dumps(klient.cache, ensure_ascii=False), encoding="utf-8")


def wczytaj_zbiory(plik: pathlib.Path) -> tuple[list[dict], list[dict], dict | None]:
    """Wczytuje bibliotekę: eksport {movies, shows} albo listę wpisów serwera.

    Zwraca (filmy, seriale, koperta). Dla pliku serwera (lista wpisów) koperta
    jest ``None``, a wpisy trafiają do odpowiedniej sekcji — decyduje ``rodzaj``
    przekazany przez wywołującego (nazwa pliku: movies_* albo shows_*).
    """
    dane = json.loads(plik.read_text(encoding="utf-8"))
    if isinstance(dane, dict) and ("movies" in dane or "shows" in dane):
        return list(dane.get("movies") or []), list(dane.get("shows") or []), dane
    if isinstance(dane, list):
        return [], [], None
    raise SystemExit(f"Nie rozpoznaję kształtu pliku: {plik}")


def _raport_zapisz(raport: dict, sciezka: pathlib.Path) -> None:
    sciezka.write_text(json.dumps(raport, ensure_ascii=False, indent=2), encoding="utf-8")


def _podsumowanie(raport: dict) -> str:
    linie = []
    for rodzaj, stat in raport["statystyki"].items():
        linie.append(
            f"{rodzaj}: {stat['razem']} wpisów — sprawdzone, "
            f"do naprawy: {stat['do_naprawy']}, bez zmian: {stat['bez_zmian']}"
        )
    for rodzaj, stat in raport["statystyki"].items():
        if stat["usuniete"]:
            linie.append(f"  {rodzaj}: usuniętych błędnych identyfikatorów: {stat['usuniete']}")
    return "\n".join(linie)


def _statystyki(zmiany: list[dict], wpisy: dict[str, list[dict]]) -> dict:
    stat: dict[str, dict] = {}
    for rodzaj, lista in wpisy.items():
        rodzaje_zmian = [z for z in zmiany if z["rodzaj"] == rodzaj]
        usuniete = [z for z in rodzaje_zmian if z["pole"] == "tmdb_id" and z["nowe"] is None]
        id_zmiany = [z for z in rodzaje_zmian if z["pole"] == "tmdb_id" and z["nowe"] is not None]
        zmienione_uuid = {z["uuid"] for z in rodzaje_zmian}
        stat[rodzaj] = {
            "razem": len(lista),
            "do_naprawy": len(id_zmiany),
            "usuniete": len(usuniete),
            "zmienione_wpisy": len(zmienione_uuid),
            "bez_zmian": len(lista) - len(zmienione_uuid),
        }
    return stat


def uruchom(plik: pathlib.Path, klient: Any, *, naprawiaj: bool, plik_wyjscia: pathlib.Path | None,
            workers: int, z_filmami: bool, lustro: pathlib.Path | None,
            rodzaj_pliku: str = "eksport") -> dict:
    """Przetwarza plik biblioteki: eksport ({movies, shows}) albo listę wpisów serwera.

    ``rodzaj_pliku``: "eksport" | "serial" | "film" — dla plików serwera mówi,
    czym są wpisy na liście (bo sam plik tego nie zdradza).
    """
    filmy, seriale, koperta = wczytaj_zbiory(plik)
    pojedyncza_lista = koperta is None
    if pojedyncza_lista:
        dane = json.loads(plik.read_text(encoding="utf-8"))
        filmy = dane if rodzaj_pliku == "film" else []
        seriale = dane if rodzaj_pliku == "serial" else []
    if not z_filmami:
        filmy = []

    zmiany: list[dict] = []
    if seriale:
        zmiany += przetworz_sekcje_rownolegle(seriale, "serial", klient, naprawiaj=naprawiaj, workers=workers)
    if filmy:
        zmiany += przetworz_sekcje_rownolegle(filmy, "film", klient, naprawiaj=naprawiaj, workers=workers)

    raport = {
        "data": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "wejscie": str(plik),
        "tryb": "naprawa" if naprawiaj else "audyt",
        "statystyki": _statystyki(zmiany, {"serial": seriale, "film": filmy}),
        "zmiany": zmiany,
    }

    if naprawiaj and plik_wyjscia and not pojedyncza_lista:
        tresc = dict(koperta or {})
        tresc["movies"] = filmy
        tresc["shows"] = seriale
        tresc["naprawione_at"] = raport["data"]
        plik_wyjscia.write_text(json.dumps(tresc, ensure_ascii=False, indent=2), encoding="utf-8")
    elif naprawiaj and plik_wyjscia and pojedyncza_lista:
        plik_wyjscia.write_text(json.dumps(filmy or seriale, ensure_ascii=False, indent=2), encoding="utf-8")
        if lustro is not None:
            lustro.write_bytes(plik_wyjscia.read_bytes())
    return raport


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Naprawa i audyt identyfikatorów TMDb w bibliotece CineLog.")
    zrodlo = parser.add_mutually_exclusive_group(required=True)
    zrodlo.add_argument("--plik", type=pathlib.Path, help="eksport biblioteki (JSON z movies/shows)")
    zrodlo.add_argument("--serwer", action="store_true", help="plik(i) serwera w data/ (movies_parsed, shows_parsed)")
    parser.add_argument("--wyjscie", type=pathlib.Path, help="plik wynikowy (domyślnie <wejście>-naprawione.json)")
    parser.add_argument("--na-miejscu", action="store_true", help="zapis do plików wejściowych (dla --serwer: także lustro w static/data/)")
    parser.add_argument("--tylko-sprawdz", action="store_true", help="audyt bez zapisu")
    parser.add_argument("--bez-filmow", action="store_true", help="pomiń filmy")
    parser.add_argument("--workers", type=int, default=6, help="równoległe zapytania do TMDb (domyślnie 6)")
    args = parser.parse_args(argv)

    klient = zbuduj_klienta()
    naprawiaj = not args.tylko_sprawdz
    raporty = []

    if args.serwer:
        for nazwa, rodzaj_pliku in (("shows_parsed.json", "serial"), ("movies_parsed.json", "film")):
            plik = KATALOG_DANYCH / nazwa
            if not plik.exists():
                continue
            if rodzaj_pliku == "film" and args.bez_filmow:
                continue
            wyjscie = plik if (naprawiaj and args.na_miejscu) else None
            lustro = (KATALOG_LUSTRA / nazwa) if wyjscie else None
            raport = uruchom(plik, klient, naprawiaj=naprawiaj, plik_wyjscia=wyjscie,
                             workers=args.workers, z_filmami=not args.bez_filmow, lustro=lustro,
                             rodzaj_pliku=rodzaj_pliku)
            raporty.append(raport)
    else:
        wpis_plik = args.plik
        assert wpis_plik is not None
        wyjscie = None
        if naprawiaj:
            wyjscie = args.wyjscie or wpis_plik.with_name(f"{wpis_plik.stem}-naprawione{wpis_plik.suffix}")
        raport = uruchom(wpis_plik, klient, naprawiaj=naprawiaj, plik_wyjscia=wyjscie,
                         workers=args.workers, z_filmami=not args.bez_filmow, lustro=None)
        raporty.append(raport)

    zapisz_cache(klient)

    raport_zbiorczy = {
        "data": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "tryb": "naprawa" if naprawiaj else "audyt",
        "zapytania_do_tmdb": getattr(klient, "zapytania", 0),
        "raporty": raporty,
    }
    cel = (ROOT / "naprawa-raport.json") if args.serwer else args.plik.with_name(f"{args.plik.stem}-raport.json")  # type: ignore[union-attr]
    _raport_zapisz(raport_zbiorczy, cel)

    for raport in raporty:
        print(_podsumowanie(raport))
    print(f"\nraport: {cel}")
    if naprawiaj and not args.serwer:
        print(f"wynik:  {args.wyjscie or args.plik.with_name(f'{args.plik.stem}-naprawione{args.plik.suffix}')}")  # type: ignore[union-attr]
    return 0


if __name__ == "__main__":
    sys.exit(main())
