"""Metadane seriali i ożywienie /api/shows/verify_completion.

Trasa verify_completion istniała i miała sensowną logikę, ale była bezczynna z dwóch
powodów: nikt jej nie wywoływał, a wejścia, na których pracuje (``total_episodes``,
``series_status``, ``in_production``), nie były przez nikogo zapisywane. Ten plik
pilnuje obu stron: zapisu metadanych przy dodawaniu serialu i trzech stanów
automatycznego oznaczania obejrzanych seriali.
"""

from __future__ import annotations

import pytest


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


def test_verify_completion_bez_odcinkow_nie_rusza_statusu(client):
    """Zmiana reguły: brak listy odcinków to brak danych, a nie dowód, że nic nie obejrzano.

    Wcześniej `ep_count == 0` zawsze zrzucało serial do `watchlist` — serial „obejrzany"
    z importu bez listy odcinków tracił status przy samym wejściu w zakładkę seriali.
    """
    client.post("/api/shows", json={"title": "Serial", "total_episodes": 10, "status": "watching"})
    res = client.post("/api/shows/verify_completion")
    assert res.status_code == 200
    body = res.get_json()
    assert body["updated"] == 0
    assert body["shows"][0]["status"] == "watching"


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


# --- B1: weryfikacja nie degraduje statusów przy braku danych -----------------------

def _zaseeduj_seriale(*seriale: dict) -> None:
    import app as app_module

    app_module.save_json(app_module.SHOWS_FILE, [
        {"uuid": f"s{i}", "title": f"Serial {i}", **dane} for i, dane in enumerate(seriale)
    ])


def _status_po_weryfikacji(client, **dane) -> dict:
    _zaseeduj_seriale(dane)
    res = client.post("/api/shows/verify_completion")
    assert res.status_code == 200
    return res.get_json()["shows"][0]


def test_verify_completion_serial_obejrzany_z_importu_bez_odcinkow_zostaje_watched(client):
    show = _status_po_weryfikacji(client, status="watched", total_episodes=20, episodes_watched=[])
    assert show["status"] == "watched"


def test_verify_completion_followed_bez_odcinkow_zostaje_followed(client):
    show = _status_po_weryfikacji(client, status="followed", total_episodes=0)
    assert show["status"] == "followed"


def test_verify_completion_bez_odcinkow_i_bez_pola_episodes_watched_nie_rusza_statusu(client):
    show = _status_po_weryfikacji(client, status="watching", total_episodes=8)
    assert show["status"] == "watching"


def test_verify_completion_nieznana_liczba_odcinkow_watchlist_z_odcinkami_daje_watching(client):
    show = _status_po_weryfikacji(client, status="watchlist", episodes_watched=_episodes(2))
    assert show["status"] == "watching"


@pytest.mark.parametrize("status", ["watched", "followed", "watching"])
def test_verify_completion_nieznana_liczba_odcinkow_nie_rusza_innych_statusow(client, status):
    """Brak `total_episodes` nie jest dowodem, że serial jest w trakcie oglądania."""
    show = _status_po_weryfikacji(client, status=status, total_episodes=None, episodes_watched=_episodes(2))
    assert show["status"] == status


def test_verify_completion_pomija_wpisy_zarchiwizowane(client):
    show = _status_po_weryfikacji(
        client, status="archived", archived=True, total_episodes=2, series_status="Ended",
        episodes_watched=_episodes(2),
    )
    assert show["status"] == "archived"
    assert not show.get("caught_up")


def test_verify_completion_zarchiwizowany_z_flaga_ale_innym_statusem_tez_zostaje(client):
    show = _status_po_weryfikacji(client, status="watchlist", archived=True, total_episodes=2,
                                  episodes_watched=_episodes(1))
    assert show["status"] == "watchlist"


def test_verify_completion_znana_liczba_odcinkow_niekompletny_serial_daje_watching(client):
    show = _status_po_weryfikacji(client, status="followed", total_episodes=10, episodes_watched=_episodes(4))
    assert show["status"] == "watching"


def test_verify_completion_toleruje_episodes_watched_bedace_napisem(client):
    show = _status_po_weryfikacji(client, status="watching", total_episodes="abc", episodes_watched="zepsute")
    assert show["status"] == "watching"


def test_verify_completion_odrzuca_get(client):
    """GET omijał ochronę CSRF (brak Origin przy nawigacji), a frontend używa tylko POST."""
    assert client.get("/api/shows/verify_completion").status_code == 405
