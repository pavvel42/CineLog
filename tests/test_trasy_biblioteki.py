"""B4 (ponowne dodanie nie niszczy danych), B6 (tmdb_id w PUT), B7 (spójny postęp w add_show)."""

from __future__ import annotations

import pytest

import app as app_module


def _film(**pola) -> dict:
    return {"uuid": "f1", "title": "Dune", "status": "watched", "rating": 5,
            "watch_date": "2024-01-02 20:00:00", "poster_url": None, "tmdb_id": None, **pola}


def _serial(**pola) -> dict:
    return {"uuid": "s1", "title": "Severance", "status": "watching", "rating": 4,
            "episodes_watched": [], "poster_url": None, "tmdb_id": None, **pola}


# --- B4: filmy --------------------------------------------------------------------

def test_dodanie_filmu_do_obejrzanych_jako_watchlist_nie_kasuje_oceny_ani_statusu(client):
    app_module.save_json(app_module.MOVIES_FILE, [_film()])
    res = client.post("/api/movies", json={"title": "Dune", "status": "watchlist"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["already_exists"] is True
    assert (body["status"], body["rating"], body["watch_date"]) == ("watched", 5, "2024-01-02 20:00:00")
    zapisany = app_module.load_json(app_module.MOVIES_FILE)[0]
    assert (zapisany["status"], zapisany["rating"], zapisany["watch_date"]) == ("watched", 5, "2024-01-02 20:00:00")


def test_ponowne_dodanie_watchlist_uzupelnia_brakujacy_plakat_i_tmdb_id(client):
    app_module.save_json(app_module.MOVIES_FILE, [_film()])
    res = client.post("/api/movies", json={
        "title": "Dune", "status": "watchlist", "tmdb_id": 438631,
        "poster_url": "https://image.tmdb.org/t/p/w500/x.jpg",
    })
    body = res.get_json()
    assert body["poster_url"] == "https://image.tmdb.org/t/p/w500/x.jpg"
    assert body["tmdb_id"] == 438631
    assert (body["status"], body["rating"]) == ("watched", 5)


def test_jawne_dodanie_ze_statusem_watched_i_ocena_aktualizuje_wpis(client):
    app_module.save_json(app_module.MOVIES_FILE, [_film(status="watchlist", rating=None, watch_date=None)])
    res = client.post("/api/movies", json={"title": "Dune", "status": "watched", "rating": 4})
    assert res.status_code == 200
    body = res.get_json()
    assert (body["status"], body["rating"]) == ("watched", 4)
    assert body["watch_date"]


def test_ponowne_dodanie_watchlist_do_istniejacego_watchlist_zwraca_already_exists(client):
    app_module.save_json(app_module.MOVIES_FILE, [_film(status="watchlist", rating=None, watch_date=None)])
    body = client.post("/api/movies", json={"title": "Dune", "status": "watchlist"}).get_json()
    assert body["already_exists"] is True and body["status"] == "watchlist"


def test_nowy_film_nie_ma_pola_already_exists(client):
    assert "already_exists" not in client.post("/api/movies", json={"title": "Nowy"}).get_json()


# --- B4: seriale ------------------------------------------------------------------

def test_dodanie_serialu_jako_watchlist_nie_kasuje_statusu_i_oceny(client):
    app_module.save_json(app_module.SHOWS_FILE, [_serial()])
    res = client.post("/api/shows", json={"title": "Severance", "status": "watchlist"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["already_exists"] is True
    assert (body["status"], body["rating"]) == ("watching", 4)
    zapisany = app_module.load_json(app_module.SHOWS_FILE)[0]
    assert (zapisany["status"], zapisany["rating"]) == ("watching", 4)


def test_jawne_dodanie_serialu_ze_statusem_watched_i_ocena_aktualizuje_wpis(client):
    app_module.save_json(app_module.SHOWS_FILE, [_serial(status="watchlist", rating=None)])
    body = client.post("/api/shows", json={"title": "Severance", "status": "watched", "rating": 5}).get_json()
    assert (body["status"], body["rating"]) == ("watched", 5)


def test_ponowne_dodanie_serialu_watchlist_uzupelnia_metadane_serialu(client):
    app_module.save_json(app_module.SHOWS_FILE, [_serial()])
    body = client.post("/api/shows", json={
        "title": "Severance", "status": "watchlist", "total_episodes": 19, "tmdb_id": 95396,
    }).get_json()
    assert body["total_episodes"] == 19 and body["tmdb_id"] == 95396
    assert (body["status"], body["rating"]) == ("watching", 4)


# --- B6: tmdb_id w PUT ------------------------------------------------------------

def test_put_filmu_zapisuje_tmdb_id_przez_normalizacje(client):
    app_module.save_json(app_module.MOVIES_FILE, [_film()])
    res = client.put("/api/movies/f1", json={"tmdb_id": "438631"})
    assert res.status_code == 200
    assert res.get_json()["tmdb_id"] == 438631
    assert app_module.load_json(app_module.MOVIES_FILE)[0]["tmdb_id"] == 438631


@pytest.mark.parametrize("zla", ["tmdb_undefined", "abc", -5, 0, True, None, [1], {"id": 1}, "12 3"])
def test_put_filmu_odrzuca_niepoprawne_tmdb_id_bez_zapisu(client, zla):
    app_module.save_json(app_module.MOVIES_FILE, [_film(tmdb_id=777)])
    res = client.put("/api/movies/f1", json={"tmdb_id": zla, "rating": 1})
    assert res.status_code == 400
    assert "tmdb_id" in res.get_json()["error"]
    zapisany = app_module.load_json(app_module.MOVIES_FILE)[0]
    assert zapisany["tmdb_id"] == 777 and zapisany["rating"] == 5, "żadna część żądania nie może się zapisać"


def test_put_serialu_zapisuje_tmdb_id_przez_normalizacje(client):
    app_module.save_json(app_module.SHOWS_FILE, [_serial()])
    res = client.put("/api/shows/s1", json={"tmdb_id": 95396})
    assert res.get_json()["tmdb_id"] == 95396


@pytest.mark.parametrize("zla", ["tmdb_undefined", "abc", -5, 0, True, None, [1]])
def test_put_serialu_odrzuca_niepoprawne_tmdb_id_bez_zapisu(client, zla):
    app_module.save_json(app_module.SHOWS_FILE, [_serial(tmdb_id=777)])
    res = client.put("/api/shows/s1", json={"tmdb_id": zla})
    assert res.status_code == 400
    assert "tmdb_id" in res.get_json()["error"]
    assert app_module.load_json(app_module.SHOWS_FILE)[0]["tmdb_id"] == 777


def test_put_serialu_odswieza_przestarzale_metadane(client):
    """Stary wpis (1 sezon, 6 odcinków) dostaje pełne metadane z trackera — bez zmiany statusu."""
    app_module.save_json(app_module.SHOWS_FILE, [_serial(
        status="watching", total_seasons=1, total_episodes=6, season_ep_counts={"1": 6},
    )])
    res = client.put("/api/shows/s1", json={
        "total_seasons": 9, "total_episodes": 186,
        "season_ep_counts": {"0": 106, "1": 6, "2": 22, "9": 23, "x": 4, "3": 0, "4": "zle"},
        "series_status": "Ended", "in_production": False,
    })
    assert res.status_code == 200
    zapisany = app_module.load_json(app_module.SHOWS_FILE)[0]
    assert zapisany["total_seasons"] == 9
    assert zapisany["total_episodes"] == 186
    assert zapisany["season_ep_counts"] == {"1": 6, "2": 22, "9": 23}, "sezon 0, zera i śmieci odpadają"
    assert zapisany["series_status"] == "Ended"
    assert zapisany["in_production"] is False
    assert zapisany["status"] == "watching"


def test_put_serialu_nie_zeruje_metadanych_pusta_wartoscia(client):
    app_module.save_json(app_module.SHOWS_FILE, [_serial(
        total_seasons=9, total_episodes=186, season_ep_counts={"1": 6, "2": 22}, series_status="Ended",
    )])
    res = client.put("/api/shows/s1", json={
        "total_seasons": 0, "total_episodes": None, "season_ep_counts": {}, "series_status": "",
    })
    assert res.status_code == 200
    zapisany = app_module.load_json(app_module.SHOWS_FILE)[0]
    assert zapisany["total_seasons"] == 9 and zapisany["total_episodes"] == 186
    assert zapisany["season_ep_counts"] == {"1": 6, "2": 22}
    assert zapisany["series_status"] == "Ended"


# --- B7: add_show liczy postęp jedną funkcją --------------------------------------

def _ep(s: int, e: int) -> dict:
    return {"season": s, "episode": e}


def test_add_show_nowy_serial_ma_spojny_postep(client):
    body = client.post("/api/shows", json={"title": "Nowy", "episodes_watched": [_ep(1, 3), _ep(5, 7), _ep(2, 9)]}).get_json()
    assert body["latest_progress"] == "S05E07"
    assert (body["latest_season"], body["latest_episode"], body["watched_count"]) == (5, 7, 3)


def test_add_show_istniejacy_serial_przelicza_latest_season_i_episode(client):
    client.post("/api/shows", json={"title": "Serial", "episodes_watched": [_ep(3, 2)]})
    body = client.post("/api/shows", json={"title": "Serial", "episodes_watched": [_ep(5, 7)]}).get_json()
    assert body["latest_progress"] == "S05E07"
    assert (body["latest_season"], body["latest_episode"]) == (5, 7)
    assert body["watched_count"] == 2
    zapisany = app_module.load_json(app_module.SHOWS_FILE)[0]
    assert (zapisany["latest_season"], zapisany["latest_episode"]) == (5, 7)


def test_add_show_postep_zgodny_z_toggle_episode(client):
    uuid_ = client.post("/api/shows", json={"title": "Pierwszy", "episodes_watched": [_ep(1, 1)]}).get_json()["uuid"]
    po_toggle = client.post(f"/api/shows/{uuid_}/episodes", json={"season": 2, "episode": 4}).get_json()
    po_add = client.post("/api/shows", json={"title": "Drugi", "episodes_watched": [_ep(1, 1), _ep(2, 4)]}).get_json()
    for pole in ("latest_progress", "latest_season", "latest_episode", "watched_count"):
        assert po_add[pole] == po_toggle[pole], pole


def test_add_show_ignoruje_nieuzywane_up_to_season_i_up_to_episode(client):
    """Nikt tego nie wysyła; gałąź zgadująca 24 odcinki na sezon została usunięta."""
    body = client.post("/api/shows", json={"title": "Serial", "up_to_season": 3, "up_to_episode": 5}).get_json()
    assert body["episodes_watched"] == [] and body["status"] == "watchlist"
