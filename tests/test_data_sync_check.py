"""Testy bramki spójności danych demo (skrypt scripts/check_data_sync.py)."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "check_data_sync.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("check_data_sync", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check_data_sync = _load_module()


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


@pytest.fixture()
def dirs(tmp_path):
    data_dir = tmp_path / "data"
    static_dir = tmp_path / "static" / "data"
    static_dir.mkdir(parents=True)
    return data_dir, static_dir


def test_spojne_dane_nie_zglaszaja_problemow(dirs):
    data_dir, static_dir = dirs
    for name in ("movies_parsed.json", "shows_parsed.json"):
        _write(data_dir / name, [{"title": "Film"}])
        _write(static_dir / name, [{"title": "Film"}])
    _write(data_dir / "movies_backup.json", [])

    problems, notes = check_data_sync.check(data_dir, static_dir)
    assert problems == []
    assert notes == []


def test_rozjazd_tresci_jest_wykryty(dirs):
    data_dir, static_dir = dirs
    _write(data_dir / "movies_parsed.json", [{"title": "Film"}])
    _write(static_dir / "movies_parsed.json", [{"title": "Inny film"}])
    _write(data_dir / "shows_parsed.json", [])
    _write(static_dir / "shows_parsed.json", [])

    problems, _ = check_data_sync.check(data_dir, static_dir)
    assert len(problems) == 1, problems
    assert "movies_parsed.json" in problems[0]


def test_brak_kopii_dla_frontendu_jest_wykryty(dirs):
    data_dir, static_dir = dirs
    _write(data_dir / "movies_parsed.json", [])
    _write(data_dir / "shows_parsed.json", [])

    problems, _ = check_data_sync.check(data_dir, static_dir)
    assert len(problems) == 2
    assert all("Brak kopii" in problem for problem in problems)


def test_plik_istniejacy_tylko_statycznie_jest_uwaga_nie_bledem(dirs):
    """Plik bez odpowiednika w data/ nie wywraca bramki — trafia do uwag.

    Tak wygląda realny przypadek static/data/directors_catalog.json: plik
    nieistniejący w data/ i nieczytany przez żaden moduł aplikacji.
    """
    data_dir, static_dir = dirs
    for name in ("movies_parsed.json", "shows_parsed.json"):
        _write(data_dir / name, [])
        _write(static_dir / name, [])
    _write(static_dir / "directors_catalog.json", [{"name": "Nolan"}])

    problems, notes = check_data_sync.check(data_dir, static_dir)
    assert problems == []
    assert len(notes) == 1
    assert "directors_catalog.json" in notes[0]


def test_main_zwraca_kod_bledu_przy_rozjezdzie(dirs, capsys):
    data_dir, static_dir = dirs
    _write(data_dir / "movies_parsed.json", [{"title": "Film"}])
    _write(static_dir / "movies_parsed.json", [{"title": "Inny"}])
    _write(data_dir / "shows_parsed.json", [])
    _write(static_dir / "shows_parsed.json", [])

    exit_code = check_data_sync.main(["--data-dir", str(data_dir), "--static-dir", str(static_dir)])
    assert exit_code == 1
    assert "Niespójność danych demo" in capsys.readouterr().out


def test_main_zwraca_zero_dla_spojnych_danych(dirs):
    data_dir, static_dir = dirs
    for name in ("movies_parsed.json", "shows_parsed.json"):
        _write(data_dir / name, [])
        _write(static_dir / name, [])

    assert check_data_sync.main(["--data-dir", str(data_dir), "--static-dir", str(static_dir), "--quiet"]) == 0
