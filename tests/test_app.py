"""Testy backendu CineLog (pytest + Flask test client).

Testy działają na izolowanych plikach JSON w katalogu tymczasowym —
nigdy nie dotykają prawdziwych danych demo w `data/`.
"""

import json
import threading

import pytest

import app as app_module
from services import vod_providers


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
    vod_providers.reset_memory_cache()
    app_module.EPISODES_CACHE.clear()

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


# ---------- warstwa persystencji ----------

def test_save_json_roundtrip(tmp_path):
    p = str(tmp_path / "x.json")
    data = [{"title": "Test", "rating": 5}]
    assert app_module.save_json(p, data) is True
    assert app_module.load_json(p) == data


def test_save_json_atomic_no_tmp_leftover(tmp_path):
    p = str(tmp_path / "y.json")
    app_module.save_json(p, [1, 2, 3])
    leftovers = [f.name for f in tmp_path.iterdir() if f.suffix == ".tmp"]
    assert leftovers == []


def test_save_json_returns_false_on_error(monkeypatch, tmp_path):
    # Katalog jako ścieżka pliku -> zapis musi się nie udać (i zwrócić False)
    bad = tmp_path / "dir"
    bad.mkdir()
    assert app_module.save_json(str(bad), []) is False


def test_load_json_missing_file_returns_empty(tmp_path):
    assert app_module.load_json(str(tmp_path / "nie-ma.json")) == []


# ---------- logika domenowa ----------

def test_normalize_title():
    assert app_module.normalize_title("The Matrix (1999)") == "the matrix"
    assert app_module.normalize_title(None) == ""


def test_deduplicate_items_merges_duplicates():
    items = [
        {"title": "Foo", "status": "watchlist", "rating": None},
        {"title": "foo", "status": "watched", "rating": 4},
    ]
    out = app_module.deduplicate_items(items)
    assert len(out) == 1
    assert out[0]["status"] == "watched"
    assert out[0]["rating"] == 4


def test_safe_int_and_media_url():
    assert app_module._safe_int("3") == 3
    assert app_module._safe_int("abc", 7) == 7
    assert app_module._safe_int(None, 1) == 1
    assert app_module._is_safe_media_url("https://image.tmdb.org/x.jpg")
    assert not app_module._is_safe_media_url("javascript:alert(1)")
    assert not app_module._is_safe_media_url("data:text/html,x")
    assert not app_module._is_safe_media_url("")


# ---------- API: filmy ----------

def test_add_movie_requires_title(client):
    r = client.post("/api/movies", json={"title": "   "})
    assert r.status_code == 400


def test_add_get_delete_movie(client):
    r = client.post("/api/movies", json={"title": "Incepcja", "status": "watchlist"})
    assert r.status_code in (200, 201)
    uuid_ = r.get_json()["uuid"]

    lst = client.get("/api/movies").get_json()
    assert any(m["uuid"] == uuid_ for m in lst)

    d = client.delete(f"/api/movies/{uuid_}")
    assert d.status_code == 200
    assert client.get("/api/movies").get_json() == []


def test_update_movie_rating_type_safety(client):
    uuid_ = client.post("/api/movies", json={"title": "T"}).get_json()["uuid"]

    # string zamiast int -> rating pozostaje None
    r = client.put(f"/api/movies/{uuid_}", json={"rating": "5"})
    assert r.get_json()["rating"] is None

    # poprawny int -> ustawiony
    r = client.put(f"/api/movies/{uuid_}", json={"rating": 4})
    assert r.get_json()["rating"] == 4

    # bool to nie int oceny
    r = client.put(f"/api/movies/{uuid_}", json={"rating": True})
    assert r.get_json()["rating"] == 4

    client.delete(f"/api/movies/{uuid_}")


def test_update_movie_rejects_unsafe_poster(client):
    uuid_ = client.post("/api/movies", json={"title": "T"}).get_json()["uuid"]
    r = client.put(f"/api/movies/{uuid_}", json={"poster_url": "javascript:alert(1)"})
    assert r.get_json()["poster_url"] != "javascript:alert(1)"
    client.delete(f"/api/movies/{uuid_}")


def test_update_missing_movie_404(client):
    assert client.put("/api/movies/nie-taki-uuid", json={"rating": 5}).status_code == 404
    assert client.delete("/api/movies/nie-taki-uuid").status_code == 404


# ---------- API: seriale i odcinki ----------

def _add_show(client):
    return client.post(
        "/api/shows",
        json={"title": "Serial Testowy", "episodes_watched": [{"season": 1, "episode": 1}]},
    ).get_json()


def test_toggle_episode_flow(client):
    show = _add_show(client)
    uid = show["uuid"]
    assert show["watched_count"] == 1

    # dodanie odcinka
    s = client.post(f"/api/shows/{uid}/episodes", json={"season": 1, "episode": 2})
    body = s.get_json()
    assert body["watched_count"] == 2
    assert body["latest_progress"] == "S01E02"

    # odznaczenie obu -> licznik 0
    client.post(f"/api/shows/{uid}/episodes", json={"season": 1, "episode": 2})
    s = client.post(f"/api/shows/{uid}/episodes", json={"season": 1, "episode": 1})
    assert s.get_json()["watched_count"] == 0

    client.delete(f"/api/shows/{uid}")


def test_toggle_episode_negative_season_400(client):
    show = _add_show(client)
    r = client.post(f"/api/shows/{show['uuid']}/episodes", json={"season": -1, "episode": 1})
    assert r.status_code == 400
    client.delete(f"/api/shows/{show['uuid']}")


def test_batch_episodes_dedupes(client):
    show = _add_show(client)
    uid = show["uuid"]
    payload = {"episodes": [
        {"season": 1, "episode": 1},  # duplikat
        {"season": 1, "episode": 3},
    ]}
    body = client.post(f"/api/shows/{uid}/batch_episodes", json=payload).get_json()
    assert body["watched_count"] == 2
    client.delete(f"/api/shows/{uid}")


def test_update_show_rating_validation(client):
    show = _add_show(client)
    uid = show["uuid"]
    body = client.put(f"/api/shows/{uid}", json={"rating": "wysoko"}).get_json()
    assert body["rating"] is None
    body = client.put(f"/api/shows/{uid}", json={"rating": 5}).get_json()
    assert body["rating"] == 5
    client.delete(f"/api/shows/{uid}")


# ---------- API: wyszukiwanie i cache ----------

def test_search_preview_needs_key_without_any_key(client, monkeypatch):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", "")
    r = client.get("/api/search_preview?q=inception")
    body = r.get_json()
    assert body["found"] is False
    assert body["needs_key"] is True


def test_client_keys_header_takes_precedence():
    from services import client_keys

    with app_module.app.test_request_context(
        headers={"X-TMDB-Key": "hdr-key", "X-OMDb-Key": "hdr-omdb"},
        query_string={"tmdb_key": "qs-key", "omdb_key": "qs-omdb", "imdb_key": "qs-imdb"},
    ):
        assert client_keys.tmdb_key() == "hdr-key"
        assert client_keys.omdb_key() == "hdr-omdb"


def test_client_keys_fallback_to_query():
    from services import client_keys

    with app_module.app.test_request_context(query_string={"tmdb_key": " qs-key ", "imdb_key": "qs-imdb"}):
        assert client_keys.tmdb_key() == "qs-key"
        assert client_keys.omdb_key() == "qs-imdb"


def test_client_keys_empty_when_missing():
    from services import client_keys

    with app_module.app.test_request_context():
        assert client_keys.tmdb_key() == ""
        assert client_keys.omdb_key() == ""


def test_vod_precache_limit_enforced(client):
    items = [{"title": f"x{i}", "type": "movie"} for i in range(51)]
    r = client.post("/api/vod_precache", json={"items": items})
    assert r.status_code == 400


def test_vod_precache_empty_ok(client):
    r = client.post("/api/vod_precache", json={"items": []})
    assert r.status_code == 200
    assert r.get_json()["updated"] == 0


def test_upcoming_without_tmdb_key_returns_200(client, monkeypatch):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", "")
    r = client.get("/api/upcoming")
    assert r.status_code == 200


def test_export_endpoint(client):
    client.post("/api/movies", json={"title": "E"})
    r = client.get("/api/export")
    assert r.status_code == 200
    assert b"E" in r.data or "movies" in json.dumps(r.get_json())


# ---------- współbieżność ----------

def test_concurrent_mutations_do_not_lose_updates(client):
    """20 równoległych POST-ów -> dokładnie 20 filmów w bazie (DATA_LOCK)."""
    errors = []

    def add(i):
        try:
            # Flask test client nie jest wątkowo-bezpieczny -> osobny klient per wątek
            with app_module.app.test_client() as c:
                r = c.post("/api/movies", json={"title": f"Równoległy {i}"})
                assert r.status_code in (200, 201)
        except Exception as e:  # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=add, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors
    movies = client.get("/api/movies").get_json()
    assert len(movies) == 20


# ---------- etap 5: wspólne przeliczanie postępu + TTL cache metadanych ----------

def test_recalculate_show_progress_counts_and_latest():
    from routes.shows import _recalculate_show_progress
    show = {
        "episodes_watched": [
            {"season": 3, "episode": 2},
            {"season": 1, "episode": 8},
            {"season": 3, "episode": 1},
            {"season": 2, "episode": 1},
        ]
    }
    _recalculate_show_progress(show)
    assert show["watched_count"] == 4
    assert show["latest_progress"] == "S03E02"
    assert show["latest_season"] == 3
    assert show["latest_episode"] == 2
    # lista posortowana po (season, episode)
    assert [(e["season"], e["episode"]) for e in show["episodes_watched"]] == [
        (1, 8), (2, 1), (3, 1), (3, 2)
    ]


def test_recalculate_show_progress_empty_resets():
    from routes.shows import _recalculate_show_progress
    show = {
        "episodes_watched": [],
        "watched_count": 5,
        "latest_progress": "S01E01",
        "latest_season": 1,
        "latest_episode": 1,
    }
    _recalculate_show_progress(show)
    assert show["watched_count"] == 0
    assert show["latest_progress"] is None
    assert show["latest_season"] == 0
    assert show["latest_episode"] == 0


def test_recalculate_show_progress_tolerates_missing_fields():
    from routes.shows import _recalculate_show_progress
    show = {"episodes_watched": [{"season": 2}, {"episode": 5}, {}]}
    _recalculate_show_progress(show)
    assert show["watched_count"] == 3
    assert show["latest_progress"] == "S02E00"
    assert show["latest_season"] == 2


def test_episodes_cache_respects_ttl(client, monkeypatch):
    import routes.shows as shows_routes
    show = _add_show(client)
    uid = show["uuid"]

    # symuluj metadane w cache i przeterminowany wpis
    calls = {"n": 0}

    def fake_fetch(title, show_id, lang, key):
        calls["n"] += 1
        return {"1_1": {"season": 1, "episode": 1, "name": f"Meta v{calls['n']}"}}

    monkeypatch.setattr(shows_routes._app, "fetch_episodes_meta", fake_fetch)

    r1 = client.get(f"/api/shows/{uid}/episodes_meta?lang=pl-PL").get_json()
    assert r1["1_1"]["name"] == "Meta v1"
    # świeży wpis -> trafienie w cache, bez wywołania fetch
    r2 = client.get(f"/api/shows/{uid}/episodes_meta?lang=pl-PL").get_json()
    assert r2["1_1"]["name"] == "Meta v1"
    assert calls["n"] == 1

    # przesuń czas poza TTL -> cache przeterminowany, fetch ponowny
    real_now = shows_routes._now
    monkeypatch.setattr(shows_routes, "_now", lambda: real_now() + shows_routes._EPISODES_CACHE_TTL_SECONDS + 1)
    r3 = client.get(f"/api/shows/{uid}/episodes_meta?lang=pl-PL").get_json()
    assert r3["1_1"]["name"] == "Meta v2"
    assert calls["n"] == 2


def test_episodes_cache_limit_enforced(client, monkeypatch):
    import routes.shows as shows_routes
    show = _add_show(client)
    uid = show["uuid"]

    def fake_fetch(title, show_id, lang, key):
        return {"1_1": {"season": 1, "episode": 1, "name": "Meta"}}

    monkeypatch.setattr(shows_routes._app, "fetch_episodes_meta", fake_fetch)

    # wypełnij cache ponad limit różnymi kluczami (różne tmdb_id w query)
    for i in range(shows_routes._EPISODES_CACHE_MAX_ENTRIES + 10):
        client.get(f"/api/shows/{uid}/episodes_meta?lang=pl-PL&tmdb_id={i}")
    assert len(shows_routes._app.EPISODES_CACHE) <= shows_routes._EPISODES_CACHE_MAX_ENTRIES
