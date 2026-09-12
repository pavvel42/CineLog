"""Wspólne fixtures testów backendu.

`client` istniał wcześniej w trzech plikach testowych w identycznej postaci —
trzymamy go w jednym miejscu, żeby zmiana ścieżek danych nie wymagała trzech edycji.
"""

from __future__ import annotations

import pytest

import app as app_module


@pytest.fixture(autouse=True)
def _czysty_cache_vod():
    """Czyści cache VOD trzymany w pamięci procesu.

    `services/vod_providers.load_vod_cache` zapamiętuje pierwszy odczyt w
    `_cache_state["data"]` (zapis idzie przez `save_vod_cache`, więc w produkcji jest
    spójny). W testach oznacza to jednak, że plik zasiany przez jeden test byłby
    maskowany zawartością wczytaną przez test wcześniejszy — dlatego czyścimy stan.
    """
    from services import vod_providers

    vod_providers._cache_state["data"] = None
    yield
    vod_providers._cache_state["data"] = None


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Izolowana aplikacja: wszystkie pliki danych wskazują na tmp_path."""
    files = {
        "MOVIES_FILE": tmp_path / "movies.json",
        "MOVIES_BACKUP_FILE": tmp_path / "movies_backup.json",
        "SHOWS_FILE": tmp_path / "shows.json",
        "SHOWS_BACKUP_FILE": tmp_path / "shows_backup.json",
        "UPCOMING_CACHE_FILE": tmp_path / "upcoming_cache.json",
        "VOD_CACHE_FILE": tmp_path / "vod_cache.json",
    }
    for attr, path in files.items():
        monkeypatch.setattr(app_module, attr, str(path))
    for attr in ("MOVIES_FILE", "SHOWS_FILE"):
        app_module.save_json(str(files[attr]), [])

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c
