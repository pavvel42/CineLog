"""Testy tras systemowych, które audyt wskazał jako bez pokrycia.

`/api/export` zwraca całą bazę serwera — to najszerszy odczyt w API i jedyne
miejsce z eksportem danych do pliku, więc warto mieć go przypiętego:
eksport bez nagłówka `Content-Disposition` nie zapisałby się jako plik, a eksport
z kluczami API w treści wyciekłby razem z kopią bazy.
"""

from __future__ import annotations

import json
import re

import pytest

import app as app_module

FILMY = [{"uuid": "m1", "title": "Zimne ognie", "year": 2019}]
SERIALE = [{"uuid": "s1", "title": "Silos", "seasons": 2}]


def _zaseeduj(movies=None, shows=None) -> None:
    app_module.save_json(app_module.MOVIES_FILE, FILMY if movies is None else movies)
    app_module.save_json(app_module.SHOWS_FILE, SERIALE if shows is None else shows)


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


def test_api_export_ma_te_same_dane_co_listy_api(client):
    _zaseeduj()
    eksport = json.loads(client.get("/api/export").get_data(as_text=True))
    assert eksport["movies"] == client.get("/api/movies").get_json()
    assert eksport["shows"] == client.get("/api/shows").get_json()


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


# --- /api/import -----------------------------------------------------------
# Import wymienia CAŁĄ bibliotekę serwera (tryb serwera = testy czarnoskrzynkowe).
# Kopii poprzedniej bazy nie ma — kopię użytkownik pobiera ręcznie z /api/export.


def test_api_import_zastepuje_cala_biblioteke(client):
    _zaseeduj()
    nowa = {
        "movies": [{"uuid": "m9", "title": "Diuna", "status": "watched"}],
        "shows": [{"uuid": "s9", "title": "Biuro", "episodes_watched": [{"season": 1, "episode": 1}]}],
    }
    response = client.post("/api/import", json=nowa)
    assert response.status_code == 200
    assert [m["title"] for m in client.get("/api/movies").get_json()] == ["Diuna"]
    seriale = client.get("/api/shows").get_json()
    assert [s["title"] for s in seriale] == ["Biuro"]
    assert seriale[0]["episodes_watched"] == [{"season": 1, "episode": 1}]


def test_api_import_samych_filmow_czysci_seriale(client):
    """Import to wymiana, nie scalanie: brak seriali w pliku = brak seriali w bazie."""
    _zaseeduj()
    assert client.post("/api/import", json={"movies": [{"title": "Diuna"}]}).status_code == 200
    assert client.get("/api/shows").get_json() == []


def test_api_import_nadaje_brakujace_i_zdublowane_uuid(client):
    response = client.post("/api/import", json={"movies": [
        {"title": "Bez identyfikatora"},
        {"uuid": "dup", "title": "Pierwszy"},
        {"uuid": "dup", "title": "Drugi"},
    ]})
    filmy = response.get_json()["movies"]
    identyfikatory = [m["uuid"] for m in filmy]
    assert all(identyfikatory)
    assert len(set(identyfikatory)) == 3, "każdy wpis musi być adresowalny przez PUT/DELETE"
    assert filmy[1]["uuid"] == "dup", "istniejący identyfikator zostaje"


def test_api_import_po_imporcie_wpis_jest_edytowalny(client):
    filmy = client.post("/api/import", json={"movies": [{"title": "Diuna"}]}).get_json()["movies"]
    response = client.put(f"/api/movies/{filmy[0]['uuid']}", json={"status": "watched"})
    assert response.status_code == 200


def test_api_import_pusty_nie_kasuje_bazy(client):
    _zaseeduj()
    response = client.post("/api/import", json={"movies": [], "shows": []})
    assert response.status_code == 400
    assert [m["title"] for m in client.get("/api/movies").get_json()] == ["Zimne ognie"]


@pytest.mark.parametrize(
    "tresc",
    [
        [],
        {"movies": "nie-lista"},
        {"movies": ["nie-obiekt"]},
        {"movies": [{"title": "   "}]},
    ],
)
def test_api_import_odrzuca_bledny_ksztalt_i_nie_rusza_bazy(client, tresc):
    _zaseeduj()
    response = client.post("/api/import", json=tresc)
    assert response.status_code == 400
    assert "error" in response.get_json()
    assert [m["title"] for m in client.get("/api/movies").get_json()] == ["Zimne ognie"]


def test_api_import_odrzuca_zbyt_duza_liste(client, monkeypatch):
    monkeypatch.setattr("routes.system.IMPORT_MAX_ITEMS", 2)
    response = client.post("/api/import", json={"movies": [{"title": f"F{i}"} for i in range(3)]})
    assert response.status_code == 400


def test_api_import_z_obcej_strony_jest_blokowany(client):
    response = client.post(
        "/api/import",
        json={"movies": [{"title": "Podrzucony"}]},
        headers={"Origin": "https://zla-strona.example"},
    )
    assert response.status_code == 403
