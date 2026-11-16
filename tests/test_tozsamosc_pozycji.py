"""B3: remake to osobna pozycja — jedna funkcja tożsamości dla deduplikacji i dodawania."""

from __future__ import annotations

import app as app_module
from services.data_store import deduplicate_items, is_same_item, item_year, normalize_title


# --- is_same_item -----------------------------------------------------------------

def test_rozne_tmdb_id_to_rozne_pozycje_nawet_przy_tym_samym_tytule_i_roku():
    a = {"title": "Dune", "year": "2021", "tmdb_id": 438631}
    b = {"title": "Dune", "year": "2021", "tmdb_id": 999999}
    assert not is_same_item(a, b)


def test_rowne_tmdb_id_to_ta_sama_pozycja_mimo_roznych_tytulow():
    a = {"title": "Diuna", "tmdb_id": 438631}
    b = {"title": "Dune (2021)", "tmdb_id": "438631"}
    assert is_same_item(a, b)


def test_ten_sam_tytul_rozne_lata_bez_id_to_rozne_pozycje():
    assert not is_same_item({"title": "Dune (1984)"}, {"title": "Dune (2021)"})
    assert not is_same_item({"title": "Dune", "year": "1984"}, {"title": "Dune", "year": "2021"})


def test_rok_z_pola_year_ma_pierwszenstwo_przed_nawiasem_w_tytule():
    assert item_year({"title": "Dune (1984)", "year": "2021"}) == "2021"
    assert item_year({"title": "Maniac (2018)", "year": ""}) == "2018"
    assert item_year({"title": "Maniac"}) is None
    assert item_year({"title": "X", "year": 2019}) == "2019"
    assert item_year({"title": "X", "year": "2019-05-01"}) == "2019"


def test_brak_roku_po_jednej_stronie_laczy_pozycje_o_tym_samym_tytule():
    assert is_same_item({"title": "Dune"}, {"title": "Dune (2021)"})
    assert is_same_item({"title": "dune", "year": ""}, {"title": "Dune", "year": "1984"})


def test_jedno_tmdb_id_i_rozne_lata_laczy_sie_po_tytule_i_roku():
    """Gdy tylko jeden wpis ma `tmdb_id`, o tożsamości decyduje tytuł + rok."""
    assert not is_same_item({"title": "Dune", "year": "1984", "tmdb_id": 1}, {"title": "Dune", "year": "2021"})
    assert is_same_item({"title": "Dune", "year": "2021", "tmdb_id": 1}, {"title": "Dune", "year": "2021"})


def test_pusty_tytul_nigdy_nie_jest_ta_sama_pozycja():
    assert not is_same_item({"title": ""}, {"title": ""})
    assert not is_same_item({"title": None}, {"title": "!!!"})


def test_normalize_title_nadal_wycina_rok_bo_sluzy_do_dopasowania():
    assert normalize_title("The Matrix (1999)") == "the matrix"


# --- deduplicate_items ------------------------------------------------------------

def test_deduplikacja_nie_scala_remake_ow_z_roznymi_latami_w_tytule():
    items = [{"title": "Dune (1984)", "status": "watched"}, {"title": "Dune (2021)", "status": "watchlist"}]
    assert [i["title"] for i in deduplicate_items(items)] == ["Dune (1984)", "Dune (2021)"]


def test_deduplikacja_nie_scala_roznych_tmdb_id():
    items = [{"title": "Dune", "tmdb_id": 1}, {"title": "Dune", "tmdb_id": 2}]
    assert len(deduplicate_items(items)) == 2


def test_deduplikacja_scala_ten_sam_tmdb_id_i_przenosi_oceny():
    items = [
        {"title": "Dune", "tmdb_id": 438631, "status": "watchlist", "rating": None},
        {"title": "Diuna", "tmdb_id": 438631, "status": "watched", "rating": 5},
    ]
    out = deduplicate_items(items)
    assert len(out) == 1
    assert out[0]["status"] == "watched" and out[0]["rating"] == 5


def test_deduplikacja_wpis_bez_id_dopisany_do_wpisu_z_id_przenosi_id():
    items = [{"title": "Dune"}, {"title": "Dune", "tmdb_id": 438631}]
    out = deduplicate_items(items)
    assert len(out) == 1
    assert out[0]["tmdb_id"] == 438631


def test_deduplikacja_zostawia_pozycje_bez_tytulu():
    assert len(deduplicate_items([{"title": ""}, {"title": ""}, {}])) == 3


def test_get_movies_nie_scala_remake_ow_i_nie_zapisuje_scalenia(client):
    app_module.save_json(app_module.MOVIES_FILE, [
        {"uuid": "a", "title": "Dune (1984)", "status": "watched"},
        {"uuid": "b", "title": "Dune (2021)", "status": "watchlist"},
    ])
    assert [m["uuid"] for m in client.get("/api/movies").get_json()] == ["a", "b"]
    assert len(app_module.load_json(app_module.MOVIES_FILE)) == 2


# --- dodawanie --------------------------------------------------------------------

def test_dodanie_remake_u_z_innym_tmdb_id_tworzy_druga_pozycje(client):
    r1 = client.post("/api/movies", json={"title": "Dune", "tmdb_id": 841, "year": "1984", "status": "watchlist"})
    r2 = client.post("/api/movies", json={"title": "Dune", "tmdb_id": 438631, "year": "2021", "status": "watchlist"})
    assert r1.status_code == 201 and r2.status_code == 201
    assert len(client.get("/api/movies").get_json()) == 2


def test_dodanie_remake_u_bez_id_ale_z_innym_rokiem_tworzy_druga_pozycje(client):
    assert client.post("/api/movies", json={"title": "Dune (1984)", "status": "watchlist"}).status_code == 201
    assert client.post("/api/movies", json={"title": "Dune (2021)", "status": "watchlist"}).status_code == 201
    assert len(client.get("/api/movies").get_json()) == 2


def test_ponowne_dodanie_tej_samej_pozycji_nie_tworzy_duplikatu(client):
    client.post("/api/movies", json={"title": "Dune", "tmdb_id": 438631, "status": "watchlist"})
    res = client.post("/api/movies", json={"title": "Diuna", "tmdb_id": "438631", "status": "watchlist"})
    assert res.status_code == 200
    assert len(client.get("/api/movies").get_json()) == 1


def test_dodanie_z_rokiem_zapisuje_year_zeby_tozsamosc_dzialala_przy_odczycie(client):
    r = client.post("/api/movies", json={"title": "Dune", "year": "2021", "status": "watchlist"})
    assert r.get_json()["year"] == "2021"


def test_seriale_remake_to_osobna_pozycja(client):
    client.post("/api/shows", json={"title": "Battlestar Galactica", "tmdb_id": 1972, "year": "1978"})
    r = client.post("/api/shows", json={"title": "Battlestar Galactica", "tmdb_id": 71365, "year": "2004"})
    assert r.status_code == 201
    assert len(client.get("/api/shows").get_json()) == 2


def test_seriale_ten_sam_tytul_rozne_lata_w_tytule_to_dwie_pozycje(client):
    client.post("/api/shows", json={"title": "Lost in Space (1965)"})
    r = client.post("/api/shows", json={"title": "Lost in Space (2018)"})
    assert r.status_code == 201
    assert len(client.get("/api/shows").get_json()) == 2


def test_seriale_ponowne_dodanie_tego_samego_tytulu_nie_tworzy_duplikatu(client):
    client.post("/api/shows", json={"title": "Maniac"})
    r = client.post("/api/shows", json={"title": "maniac (2018)"})
    assert r.status_code == 200
    assert len(client.get("/api/shows").get_json()) == 1
