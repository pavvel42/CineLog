#!/usr/bin/env python3
"""Anonimizacja znaków czasu bazy demo.

Przesuwa wszystkie znaczniki aktywności użytkownika o stały, deterministyczny
offset (-173 dni), zachowując kolejność i odstępy między seansami, ale usuwając
dosłowny "dziennik oglądania" (data+godzina co do sekundy). Daty publicznych
faktów (premiery, emisje odcinków) pozostają nietknięte.
"""

from __future__ import annotations

import json
import pathlib
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
OFFSET = timedelta(days=173)
SHIFT_KEYS = {"watch_date", "follow_date", "created_at", "updated_at", "expires_at"}
FMT = "%Y-%m-%d %H:%M:%S"

def shift(value: object) -> object:
    if not isinstance(value, str):
        return value
    try:
        dt = datetime.strptime(value, FMT)
    except ValueError:
        return value
    return (dt - OFFSET).strftime(FMT)

def walk(node: object) -> object:
    if isinstance(node, dict):
        return {k: (shift(v) if k in SHIFT_KEYS else walk(v)) for k, v in node.items()}
    if isinstance(node, list):
        return [walk(x) for x in node]
    return node

files = sorted(ROOT.glob("data/*.json")) + sorted(ROOT.glob("static/data/*.json"))
for f in files:
    data = json.loads(f.read_text(encoding="utf-8"))
    before = json.dumps(data, ensure_ascii=False)
    out = walk(data)
    f.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{f.relative_to(ROOT)}: przesunięto")
