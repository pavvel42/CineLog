#!/usr/bin/env python3
"""Sprawdza spójność danych demo: kopie w static/data/ muszą być identyczne z data/.

Powód: frontend w trybie statycznym (PWA na telefonie, GitHub Pages) czyta bibliotekę
z ``static/data/*.json``, a backend z ``data/*.json``. Gdy pliki się rozjeżdżają,
ta sama aplikacja pokazuje dwie różne biblioteki — a audyt nie ma jak tego wykryć,
bo nic tego nie porównywało.

Użycie:
    python3 scripts/check_data_sync.py            # weryfikacja (exit 1 przy rozjeździe)
    python3 scripts/check_data_sync.py --quiet    # tylko wynik końcowy
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

#: Pliki, których kopia w static/data/ jest wymagana (frontend wczytuje je wprost).
MIRROR_REQUIRED = ("movies_parsed.json", "shows_parsed.json")


def sha256(path: Path) -> str:
    """Skrót SHA-256 pliku (porównujemy treść, nie metadane)."""
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def check(data_dir: Path, static_dir: Path) -> tuple[list[str], list[str]]:
    """Zwraca (problemy, uwagi). Pusta lista problemów = dane spójne."""
    problems: list[str] = []
    notes: list[str] = []
    seen: set[str] = set()

    if not data_dir.is_dir():
        return [f"Brak katalogu danych: {data_dir}"], []

    for name in MIRROR_REQUIRED:
        seen.add(name)
        if not (data_dir / name).is_file():
            problems.append(f"Brak pliku źródłowego: {data_dir / name}")
        elif not (static_dir / name).is_file():
            problems.append(
                f"Brak kopii dla frontendu: {static_dir / name} "
                f"(frontend w trybie statycznym nie wczyta danych)"
            )
        elif sha256(data_dir / name) != sha256(static_dir / name):
            problems.append(
                f"Rozjazd treści: {name} — data/ i static/data/ mają różną zawartość "
                f"(skopiuj plik, nie edytuj tylko jednej strony)"
            )

    for mirror in sorted(static_dir.glob("*.json")):
        if mirror.name in seen:
            continue
        source = data_dir / mirror.name
        if not source.is_file():
            # Plik istnieje tylko statycznie: nie jest błędem, ale warto go znać —
            # backend go nie serwuje, więc frontend w trybie Flask może go nie widzieć.
            notes.append(f"{mirror.name} istnieje tylko w static/data/ (brak odpowiednika w data/)")
        elif sha256(source) != sha256(mirror):
            problems.append(
                f"Rozjazd treści: {mirror.name} — data/ i static/data/ mają różną zawartość"
            )

    return problems, notes


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Sprawdź spójność data/ i static/data/")
    parser.add_argument("--data-dir", type=Path, default=repo_root / "data")
    parser.add_argument("--static-dir", type=Path, default=repo_root / "static" / "data")
    parser.add_argument("--quiet", action="store_true", help="tylko wynik końcowy")
    args = parser.parse_args(argv)

    problems, notes = check(args.data_dir, args.static_dir)
    if problems:
        print("Niespójność danych demo:")
        for problem in problems:
            print(f"  - {problem}")
        if notes:
            print("Uwagi:")
            for note in notes:
                print(f"  - {note}")
        print(f"\nWynik: {len(problems)} problem(ów).")
        return 1

    if not args.quiet:
        mirrored = sorted(p.name for p in args.static_dir.glob("*.json"))
        print(f"Kopie w static/data/: {', '.join(mirrored) if mirrored else '(brak)'}")
        for note in notes:
            print(f"  uwaga: {note}")
        print("Wynik: dane spójne.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
