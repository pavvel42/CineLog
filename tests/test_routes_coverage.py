"""Testy tras, które nie miały żadnego pokrycia (13 widoków).

Zmierzone poleceniem: zestawienie `app.app.url_map` z odwołaniami w tests/ pokazało
13 widoków bez testów — m.in. całe rekomendacje, profil twórcy, obsługę odcinków,
reset danych, /sw.js, cache VOD i resolwer dostawców VOD. Wszystkie one obsługują
realne scenariusze użytkownika, a nie były nigdy uruchamiane w testach.

Zasady tego pliku:
- zero prawdziwej sieci — `urllib.request.urlopen` jest podmieniany,
- brak klucza API jest osobnym, jawnie sprawdzanym stanem (a nie pomijanym),
- testy nie zapisują niczego poza `tmp_path`.
"""

from __future__ import annotations

import json
import urllib.request

import pytest

import app as app_module
from services import client_keys


# ---------- narzędzia ----------

class _FakeResponse:
    """Namiastka odpowiedzi HTTP zwracanej przez urlopen (kontekst menedżera)."""

    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, *exc_info: object) -> bool:
        return False


class _Upstream:
    """Podstawiane źródło TMDb: zapisuje wywołane adresy i zwraca dane po fragmencie adresu."""

    def __init__(self, payloads: dict[str, dict]) -> None:
        self._payloads = payloads
        self.urls: list[str] = []

    def __call__(self, req, timeout=None):  # noqa: ANN001 - zgodność z urlopen
        url = req.full_url if hasattr(req, "full_url") else str(req)
        self.urls.append(url)
        for marker, payload in self._payloads.items():
            if marker in url:
                return _FakeResponse(payload)
        return _FakeResponse({})


@pytest.fixture()
def klucz(monkeypatch):
    """Klucz TMDb w konfiguracji serwera; sieć i tak jest podmieniana w testach."""
    monkeypatch.setattr(client_keys, "tmdb_key", lambda: "TESTKEY")
    monkeypatch.setattr(app_module, "TMDB_API_KEY", "TESTKEY")
    app_module.RECOMMENDATIONS_CACHE.clear()
    app_module.EPISODES_CACHE.clear()
    yield "TESTKEY"
    app_module.RECOMMENDATIONS_CACHE.clear()
    app_module.EPISODES_CACHE.clear()


@pytest.fixture()
def bez_klucza(monkeypatch):
    monkeypatch.setattr(client_keys, "tmdb_key", lambda: "")
    monkeypatch.setattr(app_module, "TMDB_API_KEY", "")
    app_module.RECOMMENDATIONS_CACHE.clear()
    yield ""
    app_module.RECOMMENDATIONS_CACHE.clear()


# ---------- rekomendacje i profil twórcy ----------

@pytest.mark.parametrize(
    "url",
    [
        "/api/recommendations/trending?media_type=movie&time_window=week",
        "/api/recommendations/for_item?title=Incepcja&media_type=movie",
        "/api/recommendations/person?name=Christopher%20Nolan",
        "/api/recommendations/discover?media_type=movie&genres=18",
    ],
)
def test_rekomendacje_bez_klucza_zwracaja_jawny_stan_no_key(client, bez_klucza, url):
    res = client.get(url)
    assert res.status_code == 200
    body = res.get_json()
    assert body["status"] == "no_key"
    assert body["results"] == []


def test_trending_z_kluczem_mapuje_wyniki(client, klucz, monkeypatch):
    upstream = _Upstream(
        {
            "/trending/all/week": {
                "results": [
                    {"id": 1, "title": "Film A", "media_type": "movie", "vote_average": 7.5, "poster_path": "/a.jpg"},
                    {"id": 2, "name": "Serial B", "media_type": "tv", "vote_average": 8.0},
                    {"id": 3, "name": "Aktor", "media_type": "person"},
                ]
            }
        }
    )
    monkeypatch.setattr(urllib.request, "urlopen", upstream)

    body = client.get("/api/recommendations/trending?media_type=all&time_window=week").get_json()

    assert body["status"] == "ok"
    assert [r["title"] for r in body["results"]] == ["Film A", "Serial B"], "osoby nie należą do rekomendacji"
    assert body["results"][1]["type"] == "series", "serial oznaczamy jako 'series', nie 'tv'"


def test_discover_z_kluczem_uzywa_filtrow_z_zapytania(client, klucz, monkeypatch):
    upstream = _Upstream({"/discover/movie": {"results": [{"id": 9, "title": "Film D", "vote_average": 7.0}]}})
    monkeypatch.setattr(urllib.request, "urlopen", upstream)

    body = client.get("/api/recommendations/discover?media_type=movie&genres=18&min_vote_avg=7.5").get_json()

    assert body["status"] == "ok"
    assert body["results"][0]["title"] == "Film D"
    assert "with_genres=18" in upstream.urls[0]
    assert "vote_average.gte=7.5" in upstream.urls[0]


def test_actor_details_bez_parametrow_zwraca_400(client, klucz):
    res = client.get("/api/actor/details")
    assert res.status_code == 400
    assert res.get_json()["status"] == "error"


def test_actor_details_bez_klucza_tlumaczy_jak_skonfigurowac(client, bez_klucza):
    body = client.get("/api/actor/details?name=Christopher%20Nolan").get_json()
    assert body["status"] == "ok"
    assert body["name"] == "Christopher Nolan"
    assert "Skonfiguruj klucz TMDb" in body["biography"]


def test_actor_details_z_kluczem_zwraca_biografie_i_filmografie(client, klucz, monkeypatch):
    upstream = _Upstream(
        {
            "/person/525": {
                "id": 525,
                "name": "Christopher Nolan",
                "biography": "Reżyser brytyjski.",
                "birthday": "1970-07-30",
                "profile_path": "/nolan.jpg",
                "combined_credits": {
                    "cast": [{"id": 27205, "title": "Incepcja", "media_type": "movie", "popularity": 40}],
                    "crew": [
                        {"id": 27205, "title": "Incepcja", "media_type": "movie", "job": "Director", "popularity": 40},
                        {"id": 155, "title": "Mroczny Rycerz", "media_type": "movie", "job": "Director", "popularity": 30},
                    ],
                },
            }
        }
    )
    monkeypatch.setattr(urllib.request, "urlopen", upstream)

    body = client.get("/api/actor/details?id=525&name=Christopher%20Nolan").get_json()

    assert body["status"] == "ok"
    assert body["biography"] == "Reżyser brytyjski."
    assert body["profile_url"] == "https://image.tmdb.org/t/p/w300/nolan.jpg"
    tytuly = [f["title"] for f in body["filmography"]]
    assert "Mroczny Rycerz" in tytuly
    assert tytuly.count("Incepcja") == 1, "ten sam tytuł z obsady i ekipy nie może dublować się w filmografii"


# ---------- wyszukiwanie szczegółów ----------

def test_search_detail_bez_klucza_zwraca_jawny_brak_danych(client, bez_klucza):
    body = client.get("/api/search_detail?title=Incepcja&year=2010&type=movie").get_json()
    assert body["found"] is False
    assert "Nie udało się pobrać szczegółów" in body["message"]


def test_search_detail_z_klucza_zwraca_szczegoly_filmu(client, klucz, monkeypatch):
    upstream = _Upstream(
        {
            "/movie/27205": {
                "id": 27205,
                "title": "Incepcja",
                "original_title": "Inception",
                "overview": "Złodziej snów.",
                "release_date": "2010-07-16",
                "runtime": 148,
                "vote_average": 8.4,
                "vote_count": 30000,
                "poster_path": "/poster.jpg",
                "genres": [{"id": 878, "name": "Science Fiction"}],
                "credits": {
                    "cast": [{"name": "Leonardo DiCaprio", "character": "Cobb", "profile_path": "/leo.jpg"}],
                    "crew": [{"name": "Christopher Nolan", "job": "Director", "department": "Directing"}],
                },
            }
        }
    )
    monkeypatch.setattr(urllib.request, "urlopen", upstream)

    body = client.get("/api/search_detail?tmdb_id=27205&type=movie").get_json()

    assert body["title"] == "Incepcja"
    assert body["year"] == "2010"
    assert body["runtime"] == 148
    assert body["director"] == "Christopher Nolan"
    assert body["actors"] == "Leonardo DiCaprio"
    assert body["poster_url"] == "https://image.tmdb.org/t/p/w500/poster.jpg"
    assert body["tmdb_id"] == 27205
    assert body["source"] == "tmdb"


def test_search_detail_seriala_liczy_odcinki_w_sezonach(client, klucz, monkeypatch):
    upstream = _Upstream(
        {
            "/tv/1399": {
                "id": 1399,
                "name": "Gra o tron",
                "overview": "Opis.",
                "first_air_date": "2011-04-17",
                "seasons": [
                    {"season_number": 0, "episode_count": 5},   # sezon 0 (dodatki) nie liczy się do sumy
                    {"season_number": 1, "episode_count": 10},
                    {"season_number": 2, "episode_count": 8},
                ],
                "number_of_episodes": 18,
                "credits": {"cast": [], "crew": []},
            }
        }
    )
    monkeypatch.setattr(urllib.request, "urlopen", upstream)

    body = client.get("/api/search_detail?tmdb_id=1399&type=series").get_json()

    assert body["type"] == "series"
    assert body["total_episodes"] == 18
    # Klucze JSON są tekstami ({"1": 10}); frontend indeksuje obiekt numerem sezonu,
    # a JavaScript i tak rzutuje 1 -> "1", więc kontrakt jest spójny.
    assert body["season_ep_counts"] == {"1": 10, "2": 8}


# ---------- odcinki serialu ----------

def _show(client, **extra) -> str:
    payload = {"title": "Serial Testowy", "total_episodes": 3, "series_status": "Returning Series", **extra}
    res = client.post("/api/shows", json=payload)
    assert res.status_code in (200, 201)
    return res.get_json()["uuid"]


def test_toggle_episode_dodaje_i_usuwa_odcinek(client):
    uuid = _show(client)

    res = client.post(f"/api/shows/{uuid}/episodes", json={"season": 1, "episode": 1})
    assert res.status_code == 200
    assert res.get_json()["watched_count"] == 1

    res = client.post(f"/api/shows/{uuid}/episodes", json={"season": 1, "episode": 1})
    assert res.status_code == 200
    assert res.get_json()["watched_count"] == 0, "drugie kliknięcie odznacza odcinek"


def test_toggle_episode_waliduje_dane(client):
    uuid = _show(client)
    assert client.post(f"/api/shows/{uuid}/episodes", json={"season": -1, "episode": 1}).status_code == 400
    assert client.post("/api/shows/nie-ma-takiego/episodes", json={"season": 1, "episode": 1}).status_code == 404


def test_batch_episodes_dodaje_bez_duplikatow(client):
    uuid = _show(client)

    res = client.post(
        f"/api/shows/{uuid}/batch_episodes",
        json={"episodes": [{"season": 1, "episode": 1}, {"season": 1, "episode": 2}, {"season": 1, "episode": 1}]},
    )
    assert res.status_code == 200
    assert res.get_json()["watched_count"] == 2, "powtórzony odcinek nie może policzyć się dwa razy"


def test_batch_episodes_odrzuca_zly_payload(client):
    uuid = _show(client)
    res = client.post(f"/api/shows/{uuid}/batch_episodes", json={"episodes": "nie-lista"})
    assert res.status_code == 400


def test_episodes_meta_zwraca_dane_i_korzysta_z_cache(client, monkeypatch):
    uuid = _show(client, tmdb_id=1399)
    calls: list[str] = []

    def fake_meta(clean_title, show_id, lang, tmdb_key):
        calls.append(clean_title)
        return {"seasons": [{"season_number": 1, "episodes": [{"episode_number": 1}]}], "total": 1}

    monkeypatch.setattr(app_module, "fetch_episodes_meta", fake_meta)

    first = client.get(f"/api/shows/{uuid}/episodes_meta")
    assert first.status_code == 200
    assert first.get_json()["total"] == 1

    second = client.get(f"/api/shows/{uuid}/episodes_meta")
    assert second.status_code == 200
    assert len(calls) == 1, "drugie żądanie ma iść z cache, nie do TMDb"


def test_episodes_meta_dla_nieznanego_serialu_zwraca_404(client):
    assert client.get("/api/shows/nie-ma-takiego/episodes_meta").status_code == 404


# ---------- VOD ----------

def test_vod_cache_all_filtruje_po_regionie(client):
    app_module.save_json(
        app_module.VOD_CACHE_FILE,
        {
            "movie_PL_incepcja": {"found": True, "region": "PL"},
            "movie_US_inception": {"found": True, "region": "US"},
            "tv_PL_gra o tron": {"found": False, "region": "PL"},
        },
    )

    body = client.get("/api/vod_cache_all?region=pl").get_json()

    assert set(body) == {"movie_PL_incepcja", "tv_PL_gra o tron"}


def test_watch_providers_oddaje_wazny_wpis_z_cache(client):
    app_module.save_json(
        app_module.VOD_CACHE_FILE,
        {
            "movie_PL_incepcja": {
                "found": True,
                "region": "PL",
                "expires_at": "2099-01-01 00:00:00",
                "providers": {"flatrate": [{"provider_name": "Netflix"}]},
            }
        },
    )

    body = client.get("/api/watch_providers?title=Incepcja&type=movie&region=PL").get_json()

    assert body["found"] is True
    assert body["providers"]["flatrate"][0]["provider_name"] == "Netflix"


def test_watch_providers_z_tmdb_id_pomija_cache(client, monkeypatch):
    app_module.save_json(
        app_module.VOD_CACHE_FILE,
        {"movie_PL_incepcja": {"found": True, "expires_at": "2099-01-01 00:00:00", "providers": {"flatrate": [{"provider_name": "Z cache"}]}}},
    )
    wywolania: list[tuple] = []

    def fake_live(clean_title, media_type, region, tmdb_id=None):
        wywolania.append((clean_title, media_type, region, tmdb_id))
        return {"found": True, "region": region, "providers": {"flatrate": [{"provider_name": "Ze świeżego zapytania"}]}}

    monkeypatch.setattr(app_module, "fetch_live_watch_providers", fake_live)

    body = client.get("/api/watch_providers?title=Incepcja&type=movie&region=PL&tmdb_id=27205").get_json()

    assert len(wywolania) == 1, "podany identyfikator TMDb ma wymuszać odświeżenie"
    assert wywolania[0][3] == "27205"
    assert body["providers"]["flatrate"][0]["provider_name"] == "Ze świeżego zapytania"


# ---------- system ----------

def test_reset_all_przywraca_dane_z_kopii(client):
    client.post("/api/movies", json={"title": "Film do usunięcia"})
    client.post("/api/shows", json={"title": "Serial do usunięcia"})
    app_module.save_json(app_module.MOVIES_BACKUP_FILE, [{"uuid": "m1", "title": "Film z kopii"}])
    app_module.save_json(app_module.SHOWS_BACKUP_FILE, [{"uuid": "s1", "title": "Serial z kopii"}])

    assert client.post("/api/movies/reset").get_json() == {"status": "reset_complete"}

    movies = client.get("/api/movies").get_json()
    shows = client.get("/api/shows").get_json()
    assert [m["title"] for m in movies] == ["Film z kopii"]
    assert [s["title"] for s in shows] == ["Serial z kopii"]


def test_service_worker_jest_serwowany_jako_javascript(client):
    res = client.get("/sw.js")
    assert res.status_code == 200
    assert "javascript" in res.headers["Content-Type"]
    assert b"addEventListener" in res.get_data(), "to musi być skrypt service workera, nie strona HTML"
