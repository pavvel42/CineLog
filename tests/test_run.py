"""Testy punktu wejścia serwera deweloperskiego (run.py)."""

from __future__ import annotations

from pathlib import Path

import pytest

import run


def test_ensure_frontend_config_tworzy_plik_z_szablonu(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    template = tmp_path / "config.example.js"
    template.write_text('window.CINELOG_CONFIG = { TMDB_API_KEY: "" };\n', encoding="utf-8")
    target = tmp_path / "config.js"
    monkeypatch.setattr(run, "FRONTEND_CONFIG_TEMPLATE", template)
    monkeypatch.setattr(run, "FRONTEND_CONFIG", target)

    assert run.ensure_frontend_config() is True
    assert target.read_text(encoding="utf-8") == template.read_text(encoding="utf-8")


def test_ensure_frontend_config_nie_nadpisuje_istniejacego_pliku(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    template = tmp_path / "config.example.js"
    template.write_text("szablon\n", encoding="utf-8")
    target = tmp_path / "config.js"
    target.write_text("moja konfiguracja\n", encoding="utf-8")
    monkeypatch.setattr(run, "FRONTEND_CONFIG_TEMPLATE", template)
    monkeypatch.setattr(run, "FRONTEND_CONFIG", target)

    assert run.ensure_frontend_config() is False
    assert target.read_text(encoding="utf-8") == "moja konfiguracja\n"


def test_ensure_frontend_config_bez_szablonu_nie_tworzy_pliku(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "config.js"
    monkeypatch.setattr(run, "FRONTEND_CONFIG_TEMPLATE", tmp_path / "brak-szablonu.js")
    monkeypatch.setattr(run, "FRONTEND_CONFIG", target)

    assert run.ensure_frontend_config() is False
    assert not target.exists()
