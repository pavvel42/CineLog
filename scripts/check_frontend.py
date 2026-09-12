#!/usr/bin/env python3
"""Lekki statyczny check frontendu (bez nowych zależności npm).

Sprawdza trzy klasy błędów, które audyt znalazł ręcznie i które są niewidoczne
dla przeglądarki do momentu, gdy funkcja przestanie działać:

1. ``inline_handler`` — atrybuty ``onclick=``/``onchange=`` w HTML generowanym
   z JS. Content-Security-Policy aplikacji (``script-src 'self'``) blokuje
   wykonywanie takich atrybutów, więc przycisk wygląda poprawnie i nic nie robi.
2. ``dead_id`` — odwołania ``getElementById``/``querySelector("#id")`` do
   identyfikatorów, których nie ma ani w ``index.html``, ani w HTML składanym
   w JS (literówka albo element usunięty z widoku).
3. ``unused_import`` — nazwy zaimportowane z modułu ES i nigdzie nieużyte.

Użycie:
    python3 scripts/check_frontend.py           # exit 1 gdy są problemy
    python3 scripts/check_frontend.py --verbose # wypisz też allowlistę
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKIP_DIRS = {"dist", "node_modules", "vendor", "icons"}
INLINE_EVENTS = (
    "click|change|input|submit|keydown|keyup|keypress|error|load|dblclick|"
    "mousedown|mouseup|mouseenter|mouseleave|focus|blur|contextmenu"
)
INLINE_HANDLER_RE = re.compile(rf"""\son(?:{INLINE_EVENTS})\s*=\s*["'`]""", re.IGNORECASE)
ID_LOOKUP_RE = re.compile(r"""getElementById\(\s*["']([^"']+)["']|querySelector(?:All)?\(\s*["']#([^"'\s]+)["']""")
ID_DEFINITION_RE = re.compile(r"""id\s*[:=]\s*["']([^"']+)["']|\bid\s*=\s*["']([^"']+)["']""")
IMPORT_RE = re.compile(r"""import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']""")
ALLOWLIST_PATH = Path(__file__).resolve().parent / "frontend_allowlist.txt"


def iter_frontend_files(repo_root: Path):
    """Pliki JS i HTML frontendu (pomijamy bundle w static/dist i node_modules)."""
    for path in sorted(repo_root.glob("static/js/**/*.js")):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        yield path
    index = repo_root / "index.html"
    if index.is_file():
        yield index


def load_allowlist(path: Path) -> set[str]:
    """Wpisy w formie ``typ:klucz`` (linie z # to komentarze)."""
    if not path.is_file():
        return set()
    entries = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#"):
            entries.add(stripped)
    return entries


def check_inline_handlers(repo_root: Path, allowlist: set[str]) -> list[str]:
    findings = []
    for path in iter_frontend_files(repo_root):
        rel = path.relative_to(repo_root)
        if f"inline_handler:{rel}" in allowlist:
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            match = INLINE_HANDLER_RE.search(line)
            if match:
                findings.append(
                    f"inline_handler  {rel}:{number}  {match.group(0).strip()!r} — "
                    f"CSP 'self' blokuje ten atrybut; użyj addEventListener"
                )
    return findings


def collect_known_ids(repo_root: Path) -> set[str]:
    """Identyfikatory, które faktycznie powstają: w index.html i w HTML sklejanym w JS."""
    known: set[str] = set()
    for path in iter_frontend_files(repo_root):
        if path.name not in {"index.html"} and path.suffix != ".js":
            continue
        content = path.read_text(encoding="utf-8")
        for match in ID_DEFINITION_RE.finditer(content):
            known.add(match.group(1) or match.group(2))
    return known


def check_dead_ids(repo_root: Path, allowlist: set[str]) -> list[str]:
    known = collect_known_ids(repo_root)
    findings = []
    for path in iter_frontend_files(repo_root):
        if path.suffix != ".js":
            continue
        rel = path.relative_to(repo_root)
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            for match in ID_LOOKUP_RE.finditer(line):
                target = match.group(1) or match.group(2)
                if target in known or f"dead_id:{target}" in allowlist:
                    continue
                findings.append(
                    f"dead_id         {rel}:{number}  odwołanie do id={target!r}, "
                    f"którego nie ma w index.html ani w HTML z JS"
                )
    return findings


def check_unused_imports(repo_root: Path, allowlist: set[str]) -> list[str]:
    findings = []
    for path in iter_frontend_files(repo_root):
        if path.suffix != ".js":
            continue
        rel = path.relative_to(repo_root)
        content = path.read_text(encoding="utf-8")
        for match in IMPORT_RE.finditer(content):
            for raw_name in match.group(1).split(","):
                name = raw_name.strip().split(" as ")[-1].strip()
                if not name:
                    continue
                uses = re.findall(rf"\b{re.escape(name)}\b", content)
                # 1 wystąpienie = sama deklaracja w imporcie.
                if len(uses) <= 1 and f"unused_import:{rel}:{name}" not in allowlist:
                    findings.append(f"unused_import   {rel}  import {name!r} nie jest nigdzie używany")
    return findings


def run(repo_root: Path, allowlist: set[str] | None = None) -> list[str]:
    entries = load_allowlist(ALLOWLIST_PATH) if allowlist is None else allowlist
    return (
        check_inline_handlers(repo_root, entries)
        + check_dead_ids(repo_root, entries)
        + check_unused_imports(repo_root, entries)
    )


def main(argv: list[str] | None = None) -> int:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Lekki statyczny check frontendu")
    parser.add_argument("--root", type=Path, default=repo_root)
    parser.add_argument("--verbose", action="store_true", help="wypisz też wpisy allowlisty")
    args = parser.parse_args(argv)

    findings = run(args.root)
    if args.verbose:
        for entry in sorted(load_allowlist(ALLOWLIST_PATH)):
            print(f"allowlist: {entry}")
    if findings:
        print(f"Problemy frontendu ({len(findings)}):")
        for finding in findings:
            print(f"  {finding}")
        return 1
    print("Frontend bez zastrzeżeń (inline handlery, martwe id, nieużywane importy).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
