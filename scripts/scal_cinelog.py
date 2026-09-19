#!/usr/bin/env python3
"""Scalanie dwóch plików biblioteki CineLog (np. eksportu z aplikacji i pliku importu).

Reguła nadrzędna: **baza** (pierwszy plik) jest prawdą użytkownika — jej tytuły,
statusy, oceny, daty i historia odcinków zostają nietknięte. **Uzupełnienie**
(drugi plik) wolno wyłącznie:

* dopisać puste pola metadanych (TMDb/TVTime: `tmdb_id`, `plot`, `runtime`,
  `release_date`, `season_ep_counts`, …),
* ustawić `is_favorite`/`rewatched` na `true`, jeśli wie o nich tylko ono,
* dodać pozycje, których w bazie nie ma (dopisywane na końcu listy).

Czego robić nie wolno (i czego pilnują testy):

* podmieniać tytułu, statusu, oceny ani daty z bazy,
* degradować statusu (`watched` → `watchlist`),
* przebudowywać historii odcinków — eksport aplikacji trzyma w odcinkach
  `episode_id`, `created_at` i `runtime`, a plik importu tylko `season`/`episode`,
  więc przepisanie listy skasowałoby te pola.

Uruchomienie:

    python3 scripts/scal_cinelog.py --baza eksport.json --uzupelnienie import.json \\
        --wyjscie scalone.json --raport raport-scalania.json
"""

from __future__ import annotations

import argparse
import copy
import datetime
import importlib.util
import json
import pathlib
import sys
from typing import Any

SCIEZKA_KONWERTERA = pathlib.Path(__file__).resolve().parent / "tvtime_to_cinelog.py"


def _wczytaj_konwerter() -> Any:
    """Wczytuje reguły dopasowania z konwertera TVTime, żeby oba narzędzia
    szukały tej samej pozycji tak samo (uuid → tmdb_id → tytuł → literówka)."""
    spec = importlib.util.spec_from_file_location("tvtime_to_cinelog", SCIEZKA_KONWERTERA)
    if spec is None or spec.loader is None:  # pragma: no cover - zabezpieczenie
        raise ImportError(f"Nie mogę wczytać {SCIEZKA_KONWERTERA}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_KONWERTER = _wczytaj_konwerter()

# Pola, których uzupełnienie nie rusza: należą do bazy albo wynikają z jej historii.
NIETYKALNE = {
    "uuid",
    "title",
    "status",
    "archived",
    "created_at",
    "updated_at",
    "caught_up",
    "active",
    "exported_at",
}
NIETYKALNE_SERIAL = NIETYKALNE | {"episodes_watched"}

# Pola logiczne: prawda z któregokolwiek pliku zostaje prawdą.
BOOLOWSKA_ALTERNATYWA = {"is_favorite", "rewatched"}


def _puste(wartosc: object) -> bool:
    """Czy pole jest puste na tyle, żeby wolno je było uzupełnić."""
    if wartosc is None or wartosc is False:
        return True
    if isinstance(wartosc, str):
        return not wartosc.strip()
    if isinstance(wartosc, (int, float)):
        return wartosc == 0
    if isinstance(wartosc, (list, dict, tuple, set)):
        return len(wartosc) == 0
    return False


def uzupelnij_wpis(bazowy: dict, zrodlo: dict, nietkalne: set[str], raport: dict) -> dict:
    """Zwraca kopię wpisu bazowego z uzupełnionymi pustymi polami."""
    scalony = copy.deepcopy(bazowy)
    for pole in BOOLOWSKA_ALTERNATYWA:
        if zrodlo.get(pole) and not scalony.get(pole):
            scalony[pole] = True
            raport[pole] = raport.get(pole, 0) + 1
    for pole, wartosc in zrodlo.items():
        if pole in nietkalne or pole in BOOLOWSKA_ALTERNATYWA:
            continue
        if _puste(wartosc) or not _puste(scalony.get(pole)):
            continue
        scalony[pole] = copy.deepcopy(wartosc)
        raport[pole] = raport.get(pole, 0) + 1
    return scalony


def scal_biblioteki(baza: dict, uzupelnienie: dict) -> tuple[dict, dict]:
    """Scala dwie biblioteki; zwraca (biblioteka_wynikowa, raport)."""
    filmy_bazy = list(baza.get("movies") or [])
    seriale_bazy = list(baza.get("shows") or [])
    filmy_uzup = list(uzupelnienie.get("movies") or [])
    seriale_uzup = list(uzupelnienie.get("shows") or [])

    raport: dict[str, Any] = {
        "baza": {"filmy": len(filmy_bazy), "seriale": len(seriale_bazy)},
        "uzupelnienie": {"filmy": len(filmy_uzup), "seriale": len(seriale_uzup)},
        "scalone": {"filmy": 0, "seriale": 0},
        "dodane": {"filmy": 0, "seriale": 0},
        "uzupelnione": {"filmy": {}, "seriale": {}},
        "bez_dopasowania": {"filmy": [], "seriale": []},
    }

    def scal_zbior(
        wpisy_bazy: list[dict],
        wpisy_uzup: list[dict],
        nietkalne: set[str],
        rodzaj: str,
    ) -> list[dict]:
        # Mutujemy wpisy w miejscu: indeksy dopasowania wskazują na te same
        # obiekty, więc podmiana przez `list.index` gubiłaby je (a przy dwóch
        # identycznych wpisach trafiałaby w zły).
        wynikowe = [copy.deepcopy(wpis) for wpis in wpisy_bazy]
        indeksy = _KONWERTER.zbuduj_indeksy(wynikowe)
        for wpis in wpisy_uzup:
            if not (wpis.get("title") or wpis.get("original_title")):
                raport["bez_dopasowania"][rodzaj].append(wpis.get("uuid") or "?")
                continue
            cel = _KONWERTER.znajdz_cel(wpis, indeksy, wpis.get("tmdb_id"))
            if cel is None:
                nowy = copy.deepcopy(wpis)
                wynikowe.append(nowy)
                _KONWERTER._dopisz_do_indeksow(indeksy, nowy)
                raport["dodane"][rodzaj] += 1
                continue
            scalony = uzupelnij_wpis(cel, wpis, nietkalne, raport["uzupelnione"][rodzaj])
            cel.clear()
            cel.update(scalony)
            raport["scalone"][rodzaj] += 1
        return wynikowe

    wynik = {
        "exported_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "movies": scal_zbior(filmy_bazy, filmy_uzup, NIETYKALNE, "filmy"),
        "shows": scal_zbior(seriale_bazy, seriale_uzup, NIETYKALNE_SERIAL, "seriale"),
    }
    raport["wynik"] = {"filmy": len(wynik["movies"]), "seriale": len(wynik["shows"])}
    return wynik, raport


def wczytaj_biblioteke(sciezka: pathlib.Path) -> dict:
    """Wczytuje plik eksportu/importu CineLog; wymaga list `movies` i `shows`."""
    dane = json.loads(pathlib.Path(sciezka).read_text("utf-8"))
    if not isinstance(dane, dict) or "movies" not in dane or "shows" not in dane:
        raise ValueError(f"{sciezka}: to nie jest plik biblioteki CineLog (brak kluczy movies/shows)")
    return dane


def zapisz_wynik(wynik: dict, raport: dict, plik: pathlib.Path, plik_raportu: pathlib.Path) -> None:
    plik.parent.mkdir(parents=True, exist_ok=True)
    plik.write_text(json.dumps(wynik, ensure_ascii=False, indent=2), encoding="utf-8")
    plik_raportu.write_text(json.dumps(raport, ensure_ascii=False, indent=2), encoding="utf-8")


def _podsumowanie(raport: dict) -> str:
    linie = [
        f"baza:        {raport['baza']['filmy']} filmów / {raport['baza']['seriale']} seriali",
        f"uzupełnienie: {raport['uzupelnienie']['filmy']} filmów / {raport['uzupelnienie']['seriale']} seriali",
        f"wynik:       {raport['wynik']['filmy']} filmów / {raport['wynik']['seriale']} seriali",
        f"scalone:     {raport['scalone']['filmy']} filmów / {raport['scalone']['seriale']} seriali",
        f"dodane:      {raport['dodane']['filmy']} filmów / {raport['dodane']['seriale']} seriali",
    ]
    for rodzaj in ("filmy", "seriale"):
        uzu = raport["uzupelnione"][rodzaj]
        if uzu:
            naj = ", ".join(f"{pole}×{ile}" for pole, ile in sorted(uzu.items(), key=lambda p: -p[1]))
            linie.append(f"uzupełnione {rodzaj}: {naj}")
    return "\n".join(linie)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Scalanie dwóch plików biblioteki CineLog")
    parser.add_argument("--baza", required=True, type=pathlib.Path, help="pierwszy plik (wygrywa)")
    parser.add_argument("--uzupelnienie", required=True, type=pathlib.Path, help="drugi plik (uzupełnia braki)")
    parser.add_argument("--wyjscie", required=True, type=pathlib.Path, help="gdzie zapisać scaloną bibliotekę")
    parser.add_argument("--raport", type=pathlib.Path, help="gdzie zapisać raport (domyślnie obok wyniku)")
    args = parser.parse_args(argv)

    baza = wczytaj_biblioteke(args.baza)
    uzupelnienie = wczytaj_biblioteke(args.uzupelnienie)
    wynik, raport = scal_biblioteki(baza, uzupelnienie)
    plik_raportu = args.raport or args.wyjscie.with_name(args.wyjscie.stem + "-raport.json")
    zapisz_wynik(wynik, raport, args.wyjscie, plik_raportu)

    print(_podsumowanie(raport))
    print(f"\nzapisane: {args.wyjscie}")
    print(f"raport:   {plik_raportu}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
