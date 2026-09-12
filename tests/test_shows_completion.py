"""Metadane seriali i ożywienie /api/shows/verify_completion.

Trasa verify_completion istniała i miała sensowną logikę, ale była bezczynna z dwóch
powodów: nikt jej nie wywoływał, a wejścia, na których pracuje (``total_episodes``,
``series_status``, ``in_production``), nie były przez nikogo zapisywane. Ten plik
pilnuje obu stron: zapisu metadanych przy dodawaniu serialu i trzech stanów
automatycznego oznaczania obejrzanych seriali.
"""

from __future__ import annotations

import pytest

import app as app_module


@pytest.fixture()
def client(tmp_path, monkeypatch):
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


def _episodes(count: int) -> list[dict[str, int]]:
    return [{"season": 1, "episode": i} for i in range(1, count + 1)]


def test_add_show_zapisuje_metadane_serialu(client):
    res = client.post("/api/shows", json={
        "title": "Serial z metadanymi",
        "total_seasons": 2,
        "total_episodes": 16,
        "series_status": "Ended",
        "in_production": False,
    })
    assert res.status_code == 201
    body = res.get_json()
    assert body["total_seasons"] == 2
    assert body["total_episodes"] == 16
    assert body["series_status"] == "Ended"
    assert body["in_production"] is False

    stored = client.get("/api/shows").get_json()
    assert stored[0]["total_episodes"] == 16
    assert stored[0]["series_status"] == "Ended"


def test_add_show_uzupelnia_metadane_w_istniejacym_serialu(client):
    assert client.post("/api/shows", json={"title": "Ten sam serial"}).status_code == 201
    res = client.post("/api/shows", json={
        "title": "Ten sam serial",
        "total_episodes": 10,
        "series_status": "Returning Series",
        "in_production": True,
    })
    assert res.status_code == 200
    body = res.get_json()
    assert body["total_episodes"] == 10
    assert body["series_status"] == "Returning Series"
    assert body["in_production"] is True


def test_add_show_nie_nadpisuje_metadanych_zerem(client):
    client.post("/api/shows", json={"title": "Serial", "total_episodes": 10, "series_status": "Ended"})
    res = client.post("/api/shows", json={"title": "Serial", "total_episodes": 0})
    assert res.status_code == 200
    body = res.get_json()
    assert body["total_episodes"] == 10
    assert body["series_status"] == "Ended"


def test_verify_completion_bez_odcinkow_daje_watchlist(client):
    client.post("/api/shows", json={"title": "Serial", "total_episodes": 10, "status": "watching"})
    res = client.post("/api/shows/verify_completion")
    assert res.status_code == 200
    assert res.get_json()["shows"][0]["status"] == "watchlist"


def test_verify_completion_częściowo_obejrzany_daje_watching(client):
    client.post("/api/shows", json={
        "title": "Serial", "total_episodes": 10, "series_status": "Ended",
        "episodes_watched": _episodes(3),
    })
    res = client.post("/api/shows/verify_completion")
    assert res.get_json()["shows"][0]["status"] == "watching"


def test_verify_completion_zakonczony_obejrzany_daje_watched(client):
    client.post("/api/shows", json={
        "title": "Serial", "total_episodes": 10, "series_status": "Ended", "in_production": False,
        "episodes_watched": _episodes(10),
    })
    res = client.post("/api/shows/verify_completion")
    body = res.get_json()
    assert body["updated"] == 1
    assert body["shows"][0]["status"] == "watched"


def test_verify_completion_obejrzany_ale_w_emisji_zostaje_watching_z_caught_up(client):
    client.post("/api/shows", json={
        "title": "Serial", "total_episodes": 10, "series_status": "Returning Series", "in_production": True,
        "episodes_watched": _episodes(10),
    })
    res = client.post("/api/shows/verify_completion")
    show = res.get_json()["shows"][0]
    assert show["status"] == "watching"
    assert show["caught_up"] is True


def test_verify_completion_nie_zmienia_stanu_bez_potrzeby(client):
    """Drugie wywołanie nie znajduje nic do poprawy (idempotencja)."""
    client.post("/api/shows", json={
        "title": "Serial", "total_episodes": 10, "series_status": "Ended", "in_production": False,
        "episodes_watched": _episodes(10),
    })
    first = client.post("/api/shows/verify_completion").get_json()
    second = client.post("/api/shows/verify_completion").get_json()
    assert first["updated"] == 1
    assert second["updated"] == 0
    assert second["shows"][0]["status"] == "watched"
