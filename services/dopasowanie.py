"""Wspólne dopasowanie wyniku wyszukiwania do wpisu (TMDb).

Ta sama klasa błędu co w aplikacji: źródło zwraca listę wyników posortowaną „po
trafności", a kod brał pierwszy z brzegu — przez co kontynuacja serialu dostawała
opis i odcinki innej produkcji („Biuro" → chiński serial z 1995).

Reguła jest lustrem `wybierzTrafienieWTmdb` z `static/js/modules/state.js`:
przyjmujemy wyłącznie kandydata o zgodnym tytule (lub tytule oryginalnym), rok —
gdy znany po obu stronach — nie może się różnić o więcej niż 1, a przy kilku
kandydatach bez roku nie zgadujemy.
"""

from __future__ import annotations

import re

from .data_store import normalize_title

ROK_W_TYTULE = re.compile(r"\(((?:19|20)\d{2})\)\s*$")


def _rok_z_wartosci(wartosc: object) -> str | None:
    tekst = str(wartosc or "").strip()
    return tekst[:4] if len(tekst) >= 4 and tekst[:4].isdigit() else None


def rok_z_tytulu(tytul: object) -> str | None:
    """Rok dopisany w tytule przez użytkownika: „Maniac (2018)” → „2018”."""
    dopasowanie = ROK_W_TYTULE.search(str(tytul or ""))
    return dopasowanie.group(1) if dopasowanie else None


def _tytuly(wynik: dict) -> set[str]:
    nazwy = {
        normalize_title(wynik.get(pole))
        for pole in ("name", "title", "original_name", "original_title")
    }
    return {n for n in nazwy if n}


def rok_wyniku(wynik: dict) -> str | None:
    return _rok_z_wartosci(wynik.get("first_air_date") or wynik.get("release_date"))


def wybierz_zgodny(wyniki: list[dict] | None, tytul: object, rok: object = "",
                   tytul_oryginalny: object = None) -> dict | None:
    """Zwraca kandydata zgodnego z tytułem i rokiem albo None (lepiej nic niż cudze dane)."""
    cele = {normalize_title(tytul), normalize_title(tytul_oryginalny)}
    cele.discard("")
    if not cele or not wyniki:
        return None

    rok_celu = _rok_z_wartosci(rok) or rok_z_tytulu(tytul)
    zgodne: list[dict] = []
    for wynik in wyniki:
        if not isinstance(wynik, dict) or not (_tytuly(wynik) & cele):
            continue
        rokW = rok_wyniku(wynik)
        if rok_celu and rokW and abs(int(rokW) - int(rok_celu)) > 1:
            continue
        zgodne.append(wynik)

    if not zgodne:
        return None
    if len(zgodne) > 1 and not rok_celu:
        return None  # dwie wersje o tym samym tytule i brak roku — nie zgadujemy
    return zgodne[0]
