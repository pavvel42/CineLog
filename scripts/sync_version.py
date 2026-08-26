#!/usr/bin/env python3
"""Propagacja wersji PWA z pliku VERSION.

Jedno źródło prawdy: plik VERSION (np. "10.25").
  python scripts/sync_version.py check  -> wyjście 1 przy rozjeździe (używa CI)
  python scripts/sync_version.py fix    -> propaguje VERSION do index.html
                                           i static/sw.js oraz wersjonowanych JS
"""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = (ROOT / "index.html",)
SW = ROOT / "static" / "sw.js"
JS_VERSIONED = ("static/js/theme_bootstrap.js", "static/js/sw_register.js")
EXEMPT = re.compile(r'config\.js\?v=')  # opcjonalny plik użytkownika ma własną wersję


def version() -> str:
    return (ROOT / "VERSION").read_text().strip()


def bump_text(text: str, v: str) -> str:
    lines = []
    for ln in text.splitlines(keepends=True):
        if EXEMPT.search(ln):
            lines.append(ln)
            continue
        ln = re.sub(r'\?v=[\d.]+', f'?v={v}', ln)
        lines.append(ln)
    return ''.join(lines)


def fix() -> None:
    v = version()
    for path in (*HTML, SW, *(ROOT / name for name in JS_VERSIONED)):
        path.write_text(bump_text(path.read_text(encoding="utf-8"), v), encoding="utf-8")
    sw_text = SW.read_text(encoding="utf-8")
    sw_text = re.sub(r'cinelog-v[\d.]+', f'cinelog-v{v}.0', sw_text)
    SW.write_text(sw_text, encoding="utf-8")
    print(f"synced to VERSION {v}")


def check() -> None:
    ok = True
    v = version()
    sw = SW.read_text(encoding="utf-8")
    for label, path in (
        *[("index.html", p) for p in HTML],
        ("sw.js", SW),
        *((name, ROOT / name) for name in JS_VERSIONED),
    ):
        txt = path.read_text(encoding="utf-8")
        found = set(re.findall(r'\?v=([\d.]+)', "".join(
            ln for ln in txt.splitlines(keepends=True) if not EXEMPT.search(ln)
        )))
        extra = {f for f in found if f != v}
        if extra:
            print(f"DRIFT {label}: wersje {sorted(extra)} != VERSION {v}")
            ok = False
    m = re.search(r'cinelog-v([\d.]+)', sw)
    if m and m.group(1) != f"{v}.0":
        print(f"DRIFT sw.js cache name: {m.group(1)} (oczekiwano {v}.0)")
        ok = False
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    if mode == "fix":
        fix()
    else:
        check()
