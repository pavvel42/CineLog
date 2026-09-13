"""Testy tras systemowych, które audyt wskazał jako bez pokrycia.

`/api/data` i `/api/export` zwracają całą bazę użytkownika — to najszerszy odczyt
w API i jedyne miejsce z eksportem danych do pliku, więc warto mieć je przypięte:
eksport bez nagłówka `Content-Disposition` nie zapisałby się jako plik, a eksport
z kluczami API w treści wyciekłby razem z kopią bazy.
"""

from __future__ import annotations

import json
import re

import app as app_module

FILMY = [{"uuid": "m1", "title": "Zimne ognie", "year": 2019}]
SERIALE = [{"uuid": "s1", "title": "Silos", "seasons": 2}]


def _zaseeduj(movies=None, shows=None) -> None:
    app_module.save_json(app_module.MOVIES_FILE, FILMY if movies is None else movies)
    app_module.save_json(app_module.SHOWS_FILE, SERIALE if shows is None else shows)


# --- /api/data -------------------------------------------------------------


def test_api_data_zwraca_filmy_i_seriale(client):
    _zaseeduj()
    response = client.get("/api/data")
    assert response.status_code == 200
    dane = response.get_json()
    assert set(dane) == {"movies", "shows"}
    assert [m["title"] for m in dane["movies"]] == ["Zimne ognie"]
    assert [s["title"] for s in dane["shows"]] == ["Silos"]


def test_api_data_na_pustej_bazie_zwraca_puste_listy(client):
    response = client.get("/api/data")
    assert response.status_code == 200
    assert response.get_json() == {"movies": [], "shows": []}


def test_api_data_dziala_bez_kluczy_api(client, monkeypatch):
    monkeypatch.delenv("TMDB_API_KEY", raising=False)
    monkeypatch.delenv("OMDB_API_KEY", raising=False)
    _zaseeduj()
    response = client.get("/api/data")
    assert response.status_code == 200
    assert response.get_json()["movies"]


def test_api_data_odrzuca_post(client):
    assert client.post("/api/data").status_code == 405


# --- /api/export -----------------------------------------------------------


def _naglowek_zalacznika(response) -> str:
    return response.headers.get("Content-Disposition", "")


def test_api_export_wysyla_plik_do_zapisu(client):
    _zaseeduj()
    response = client.get("/api/export")
    assert response.status_code == 200
    assert response.mimetype == "application/json"
    naglowek = _naglowek_zalacznika(response)
    assert naglowek.startswith("attachment;")
    assert re.search(r"filename=cinelog_export_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.json", naglowek)


def test_api_export_ma_te_same_dane_co_api_data(client):
    _zaseeduj()
    eksport = json.loads(client.get("/api/export").get_data(as_text=True))
    baza = client.get("/api/data").get_json()
    assert eksport["movies"] == baza["movies"]
    assert eksport["shows"] == baza["shows"]


def test_api_export_znaczy_czas_eksportu(client):
    _zaseeduj(movies=[], shows=[])
    eksport = json.loads(client.get("/api/export").get_data(as_text=True))
    assert set(eksport) == {"exported_at", "movies", "shows"}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", eksport["exported_at"])


def test_api_export_nie_ujawnia_kluczy_api(client, monkeypatch):
    monkeypatch.setenv("TMDB_API_KEY", "tajny-klucz-tmdb-000000000000")
    monkeypatch.setenv("OMDB_API_KEY", "tajny-klucz-omdb")
    _zaseeduj()
    tekst = client.get("/api/export").get_data(as_text=True)
    assert "tajny-klucz-tmdb" not in tekst
    assert "tajny-klucz-omdb" not in tekst
    assert "TMDB_API_KEY" not in tekst


def test_api_export_odrzuca_post(client):
    assert client.post("/api/export").status_code == 405
