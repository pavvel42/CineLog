"""Testy identyfikatora TMDb: walidacja przy zapisie i regresja 'tmdb_undefined'.

Frontend potrafił zbudować literał "tmdb_undefined" (sklejenie tekstu z undefined)
i wysłać go jako `tmdb_id`; backend zapisywał go do bazy bez sprawdzenia, przez co
identyfikator psuł deduplikację, cache VOD i dobór pozycji w TMDb.
"""

from __future__ import annotations

import pytest

from services.data_store import normalize_tmdb_id


@pytest.mark.parametrize(
    "value,expected",
    [
        (632857, 632857),
        ("632857", 632857),
        (" 632857 ", 632857),
        (None, None),
        ("", None),
        ("tmdb_undefined", None),
        ("undefined", None),
        ("tt1234567", None),
        ("632857.5", None),
        (True, None),
        (False, None),
        (0, None),
        (-5, None),
        ([], None),
        ({}, None),
    ],
)
def test_normalize_tmdb_id(value, expected):
    assert normalize_tmdb_id(value) == expected


def test_add_movie_zapisuje_tmdb_id(client):
    res = client.post("/api/movies", json={"title": "Film z identyfikatorem", "tmdb_id": 632857})
    assert res.status_code == 201
    assert res.get_json()["tmdb_id"] == 632857

    stored = client.get("/api/movies").get_json()
    assert stored[0]["tmdb_id"] == 632857


def test_add_movie_nie_zapisuje_smieciowego_tmdb_id(client):
    res = client.post("/api/movies", json={"title": "Film bez identyfikatora", "tmdb_id": "tmdb_undefined"})
    assert res.status_code == 201
    assert res.get_json()["tmdb_id"] is None


def test_add_movie_uzupelnia_brakujacy_tmdb_id_w_istniejacej_pozycji(client):
    assert client.post("/api/movies", json={"title": "Ten sam film"}).status_code == 201
    res = client.post("/api/movies", json={"title": "Ten sam film", "tmdb_id": "91234"})
    assert res.status_code == 200
    assert res.get_json()["tmdb_id"] == 91234


def test_add_show_zapisuje_tmdb_id(client):
    res = client.post("/api/shows", json={"title": "Serial z identyfikatorem", "tmdb_id": 1399})
    assert res.status_code == 201
    assert res.get_json()["tmdb_id"] == 1399

    stored = client.get("/api/shows").get_json()
    assert stored[0]["tmdb_id"] == 1399


def test_add_show_nie_zapisuje_smieciowego_tmdb_id(client):
    res = client.post("/api/shows", json={"title": "Serial bez identyfikatora", "tmdb_id": "tmdb_undefined"})
    assert res.status_code == 201
    assert res.get_json()["tmdb_id"] is None


def test_add_show_uzupelnia_brakujacy_tmdb_id_w_istniejacej_pozycji(client):
    assert client.post("/api/shows", json={"title": "Ten sam serial"}).status_code == 201
    res = client.post("/api/shows", json={"title": "Ten sam serial", "tmdb_id": "1399"})
    assert res.status_code == 200
    assert res.get_json()["tmdb_id"] == 1399

