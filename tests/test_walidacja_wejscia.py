"""B10: walidacja wejścia tras biblioteki i spójny kształt błędów `{"error": ...}`."""

from __future__ import annotations

import pytest

import app as app_module

TRASY_DODAWANIA = ["/api/movies", "/api/shows"]
TRASY_DODAWANIA_ALIAS = ["/api/movies/add", "/api/shows/add"]


def _jest_bledem_json(res, kod: int) -> dict:
    assert res.status_code == kod, res.get_data(as_text=True)[:200]
    assert res.is_json, "błąd ma być JSON-em, a nie HTML-em"
    body = res.get_json()
    assert isinstance(body.get("error"), str) and body["error"]
    return body


# --- POST: kształt body i tytuł ----------------------------------------------------

@pytest.mark.parametrize("url", TRASY_DODAWANIA + TRASY_DODAWANIA_ALIAS)
@pytest.mark.parametrize("tytul", [123, None, "", "   ", ["a"], {"a": 1}, True])
def test_post_odrzuca_tytul_niebedacy_niepustym_napisem(client, url, tytul):
    _jest_bledem_json(client.post(url, json={"title": tytul}), 400)


@pytest.mark.parametrize("url", TRASY_DODAWANIA)
@pytest.mark.parametrize("surowe", ["[]", '[{"title": "A"}]', '"napis"', "5", "null"])
def test_post_odrzuca_body_niebedace_obiektem(client, url, surowe):
    _jest_bledem_json(client.post(url, data=surowe, content_type="application/json"), 400)


@pytest.mark.parametrize("url", TRASY_DODAWANIA)
def test_post_brak_tytulu_to_400_w_json(client, url):
    _jest_bledem_json(client.post(url, json={}), 400)


@pytest.mark.parametrize("url", TRASY_DODAWANIA + ["/api/import", "/api/shows/x/episodes", "/api/shows/x/batch_episodes"])
def test_niepoprawny_json_to_400_w_json(client, url):
    _jest_bledem_json(client.post(url, data="{niepoprawny", content_type="application/json"), 400)


@pytest.mark.parametrize("url", ["/api/movies/x", "/api/shows/x"])
def test_put_niepoprawny_json_to_400_w_json(client, url):
    _jest_bledem_json(client.put(url, data="{niepoprawny", content_type="application/json"), 400)


@pytest.mark.parametrize("url", TRASY_DODAWANIA)
def test_post_bez_content_type_json_to_415_w_json(client, url):
    _jest_bledem_json(client.post(url, data="title=A"), 415)


def test_put_odrzuca_body_niebedace_obiektem(client):
    app_module.save_json(app_module.MOVIES_FILE, [{"uuid": "f1", "title": "A", "status": "watchlist"}])
    _jest_bledem_json(client.put("/api/movies/f1", json=[1, 2]), 400)


@pytest.mark.parametrize("tytul", [123, None, "", "  "])
def test_put_odrzuca_podany_ale_niepoprawny_tytul(client, tytul):
    app_module.save_json(app_module.MOVIES_FILE, [{"uuid": "f1", "title": "A", "status": "watchlist"}])
    _jest_bledem_json(client.put("/api/movies/f1", json={"title": tytul}), 400)
    assert app_module.load_json(app_module.MOVIES_FILE)[0]["title"] == "A"


# --- status -----------------------------------------------------------------------

@pytest.mark.parametrize("url", TRASY_DODAWANIA)
@pytest.mark.parametrize("status", ["hacked", "", None, 5, "WATCHED", ["watched"]])
def test_post_odrzuca_status_spoza_zbioru(client, url, status):
    body = _jest_bledem_json(client.post(url, json={"title": "A", "status": status}), 400)
    assert "status" in body["error"]


@pytest.mark.parametrize("url", TRASY_DODAWANIA)
@pytest.mark.parametrize("status", ["watched", "watchlist", "watching", "followed", "archived", "planowane", "w_trakcie"])
def test_post_przyjmuje_statusy_uzywane_przez_aplikacje(client, url, status):
    res = client.post(url, json={"title": f"Tytuł {status}", "status": status})
    assert res.status_code == 201
    assert res.get_json()["status"] == status


@pytest.mark.parametrize(("url", "uuid_"), [("/api/movies/f1", "f1"), ("/api/shows/f1", "f1")])
def test_put_odrzuca_status_spoza_zbioru_i_nie_zapisuje(client, url, uuid_):
    plik = app_module.MOVIES_FILE if "movies" in url else app_module.SHOWS_FILE
    app_module.save_json(plik, [{"uuid": uuid_, "title": "A", "status": "watchlist"}])
    _jest_bledem_json(client.put(url, json={"status": "hacked"}), 400)
    assert app_module.load_json(plik)[0]["status"] == "watchlist"


def test_put_filmu_przyjmuje_followed(client):
    app_module.save_json(app_module.MOVIES_FILE, [{"uuid": "f1", "title": "A", "status": "watchlist"}])
    assert client.put("/api/movies/f1", json={"status": "followed"}).get_json()["status"] == "followed"


def test_put_serialu_archived_ustawia_flage_archived(client):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "A", "status": "watching"}])
    body = client.put("/api/shows/s1", json={"status": "archived"}).get_json()
    assert body["status"] == "archived" and body["archived"] is True


# --- poster_url -------------------------------------------------------------------

@pytest.mark.parametrize("url", TRASY_DODAWANIA)
@pytest.mark.parametrize("poster", ["javascript:alert(1)", "data:text/html,x", "//evil.example/x.jpg", "ftp://x/y.jpg", 123, ["https://x/y.jpg"]])
def test_post_niebezpieczny_poster_url_jest_pustym_polem_bez_bledu(client, url, poster):
    res = client.post(url, json={"title": "A", "poster_url": poster})
    assert res.status_code == 201
    assert res.get_json()["poster_url"] is None


@pytest.mark.parametrize("url", TRASY_DODAWANIA)
def test_post_poprawny_poster_url_zostaje(client, url):
    res = client.post(url, json={"title": "A", "poster_url": "https://image.tmdb.org/t/p/w500/a.jpg"})
    assert res.get_json()["poster_url"] == "https://image.tmdb.org/t/p/w500/a.jpg"


# --- import -----------------------------------------------------------------------

def test_import_pomija_niepoprawne_wpisy_i_liczy_pominiete(client):
    res = client.post("/api/import", json={
        "movies": [{"title": "Dobry"}, "nie-obiekt", {"title": None}, {"title": 5}, {"title": "  "}, {"year": 1999}],
        "shows": [{"title": "Serial"}, 7, [1]],
    })
    assert res.status_code == 200
    body = res.get_json()
    assert [m["title"] for m in body["movies"]] == ["Dobry"]
    assert [s["title"] for s in body["shows"]] == ["Serial"]
    assert body["skipped"] == 7  # 5 wadliwych filmów + 2 wadliwe seriale
    assert [m["title"] for m in client.get("/api/movies").get_json()] == ["Dobry"]


def test_import_bez_pominietych_zwraca_skipped_zero(client):
    assert client.post("/api/import", json={"movies": [{"title": "A"}]}).get_json()["skipped"] == 0


def test_import_samych_niepoprawnych_wpisow_to_400_i_baza_nietknieta(client):
    app_module.save_json(app_module.MOVIES_FILE, [{"uuid": "a", "title": "Stary", "status": "watched"}])
    _jest_bledem_json(client.post("/api/import", json={"movies": ["x", {"title": 3}]}), 400)
    assert [m["title"] for m in client.get("/api/movies").get_json()] == ["Stary"]


def test_import_czysci_niebezpieczny_poster_i_zly_typ_odcinkow(client):
    res = client.post("/api/import", json={
        "movies": [{"title": "A", "poster_url": "javascript:alert(1)"}, {"title": "B", "poster_url": "https://x/y.jpg"}],
        "shows": [
            {"title": "S1", "episodes_watched": "zepsute"},
            {"title": "S2", "episodes_watched": [{"season": 1, "episode": 2}, "x", 5, None]},
        ],
    })
    body = res.get_json()
    assert [m["poster_url"] for m in body["movies"]] == [None, "https://x/y.jpg"]
    assert body["shows"][0]["episodes_watched"] == []
    assert body["shows"][1]["episodes_watched"] == [{"season": 1, "episode": 2}]


# --- limit rozmiaru ---------------------------------------------------------------

def test_max_content_length_to_64_mb():
    assert app_module.app.config["MAX_CONTENT_LENGTH"] == 64 * 1024 * 1024


def test_zbyt_duze_zadanie_to_413_w_json(client, monkeypatch):
    monkeypatch.setitem(app_module.app.config, "MAX_CONTENT_LENGTH", 200)
    res = client.post("/api/import", json={"movies": [{"title": "x" * 500}]})
    _jest_bledem_json(res, 413)


# --- toggle_episode / batch -------------------------------------------------------

@pytest.mark.parametrize("zle", ["zepsute", 5, {"a": 1}, None])
def test_toggle_episode_traktuje_episodes_watched_niebedace_lista_jak_pusta(client, zle):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "A", "status": "watching", "episodes_watched": zle}])
    res = client.post("/api/shows/s1/episodes", json={"season": 1, "episode": 2})
    assert res.status_code == 200
    body = res.get_json()
    assert [(e["season"], e["episode"]) for e in body["episodes_watched"]] == [(1, 2)]
    assert body["latest_progress"] == "S01E02"


def test_toggle_episode_pomija_elementy_niebedace_obiektami(client):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "A", "status": "watching",
                                                   "episodes_watched": ["x", None, {"season": 1, "episode": 1}]}])
    body = client.post("/api/shows/s1/episodes", json={"season": 1, "episode": 2}).get_json()
    assert [(e["season"], e["episode"]) for e in body["episodes_watched"]] == [(1, 1), (1, 2)]


def test_batch_episodes_traktuje_episodes_watched_niebedace_lista_jak_pusta(client):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "A", "status": "watching", "episodes_watched": "zepsute"}])
    res = client.post("/api/shows/s1/batch_episodes", json={"episodes": [{"season": 1, "episode": 1}, "x", 7]})
    assert res.status_code == 200
    assert [(e["season"], e["episode"]) for e in res.get_json()["episodes_watched"]] == [(1, 1)]


@pytest.mark.parametrize("surowe", ["[]", '"x"', "null"])
def test_toggle_i_batch_odrzucaja_body_niebedace_obiektem(client, surowe):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "A", "status": "watching"}])
    for url in ("/api/shows/s1/episodes", "/api/shows/s1/batch_episodes"):
        _jest_bledem_json(client.post(url, data=surowe, content_type="application/json"), 400)


# --- jeden kształt błędów w /api/ -------------------------------------------------

def test_nieznana_trasa_api_to_404_w_json(client):
    _jest_bledem_json(client.get("/api/nie-ma-takiej"), 404)


def test_zla_metoda_na_trasie_api_to_405_w_json(client):
    _jest_bledem_json(client.post("/api/export"), 405)


def test_nieobsluzony_wyjatek_w_trasie_api_to_500_w_json(client, monkeypatch):
    def wybuch():
        raise RuntimeError("niespodziewane")

    monkeypatch.setattr(app_module, "load_movies", wybuch)
    body = _jest_bledem_json(client.get("/api/movies"), 500)
    assert "niespodziewane" not in body["error"], "wyjątek wewnętrzny nie wycieka do klienta"


@pytest.mark.parametrize(("url", "kod"), [
    ("/api/search_preview", 400),
    ("/api/actor/details", 400),
])
def test_bledy_tras_wyszukiwania_maja_pole_error(client, url, kod):
    _jest_bledem_json(client.get(url), kod)
