#!/usr/bin/env python3
"""Synchronizacja wersji PWA i duplikatu index.html.

Jedno źródło prawdy: plik VERSION (np. "10.22").
  python scripts/sync_version.py check  -> wyjście 1 przy rozjeździe (używa CI)
  python scripts/sync_version.py fix    -> propaguje VERSION do obu kopii
                                           index.html i static/sw.js, potem
                                           synchronizuje templates/index.html
"""

import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
HTML = ("index.html", "templates/index.html")
SW = ROOT / "static" / "sw.js"
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
    for name in HTML:
        p = ROOT / name
        p.write_text(bump_text(p.read_text(encoding="utf-8"), v), encoding="utf-8")
    sw_text = SW.read_text(encoding="utf-8")
    sw_text = bump_text(sw_text, v)
    sw_text = re.sub(r'cinelog-v[\d.]+', f'cinelog-v{v}.0', sw_text)
    SW.write_text(sw_text, encoding="utf-8")
    shutil.copyfile(ROOT / HTML[0], ROOT / HTML[1])
    print(f"synced to VERSION {v}")


def check() -> None:
    ok = True
    v = version()
    html = (ROOT / HTML[0]).read_text(encoding="utf-8")
    tmpl = (ROOT / HTML[1]).read_text(encoding="utf-8")
    sw = SW.read_text(encoding="utf-8")

    if html != tmpl:
        print("DRIFT: index.html != templates/index.html")
        ok = False
    for label, txt in (("index.html", html), ("sw.js", sw)):
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
