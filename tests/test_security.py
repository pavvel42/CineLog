"""Testy ochrony lokalnego API przed zapisami z obcych stron (CSRF)."""

from __future__ import annotations

import pytest

import app as app_module
from services.security import is_allowed_write


# ---------- reguła (funkcja czysta) ----------

@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_metody_bezpieczne_zawsze_dozwolone(method):
    assert is_allowed_write(method, "127.0.0.1:5001", "http://evil.example", "cross-site") is True


def test_zapis_bez_naglowka_origin_jest_dozwolony():
    # curl, skrypty, testy - brak Origin oznacza klienta spoza przeglądarki
    assert is_allowed_write("POST", "127.0.0.1:5001", None, None) is True


def test_zapis_z_tego_samego_origin_jest_dozwolony():
    assert is_allowed_write("POST", "127.0.0.1:5001", "http://127.0.0.1:5001", "same-origin") is True
    assert is_allowed_write("POST", "localhost:5599", "http://localhost:5599", "same-origin") is True


def test_zapis_z_innego_portu_jest_odrzucany():
    # dokładnie wektor z audytu: obca strona serwowana z innego portu lokalnego
    assert is_allowed_write("POST", "127.0.0.1:5611", "http://127.0.0.1:5612", "same-site") is False


def test_zapis_z_innej_domeny_jest_odrzucany():
    assert is_allowed_write("POST", "127.0.0.1:5001", "https://evil.example", "cross-site") is False


@pytest.mark.parametrize("origin", ["null", ""])
def test_zapis_z_origin_null_jest_odrzucany(origin):
    assert is_allowed_write("POST", "127.0.0.1:5001", origin, None) is False


def test_cross_site_odrzucane_takze_bez_origin():
    assert is_allowed_write("PUT", "127.0.0.1:5001", None, "cross-site") is False


def test_zapis_bez_hostu_jest_odrzucany():
    assert is_allowed_write("DELETE", None, "http://127.0.0.1:5001", None) is False


# ---------- wpięcie w aplikację (Flask test client) ----------

def test_api_odrzuca_zapis_z_obcego_origin(client):
    res = client.post(
        "/api/movies",
        json={"title": "Film z obcej strony"},
        headers={"Origin": "http://127.0.0.1:5612"},
    )
    assert res.status_code == 403
    assert res.get_json()["error"] == "cross_origin_blocked"


def test_api_odrzuca_usuniecie_z_obcego_origin(client):
    res = client.delete("/api/movies/nie-istnieje", headers={"Origin": "https://evil.example"})
    assert res.status_code == 403


def test_api_przepuszcza_zapis_z_wlasnego_origin(client):
    res = client.post(
        "/api/movies",
        json={"title": "Film z naszej aplikacji"},
        headers={"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"},
    )
    assert res.status_code == 201
    assert res.get_json()["title"] == "Film z naszej aplikacji"


def test_api_przepuszcza_zapis_bez_origin(client):
    # dotychczasowe testy i skrypty nie wysyłają Origin - muszą działać dalej
    res = client.post("/api/movies", json={"title": "Film z curl"})
    assert res.status_code == 201


def test_api_nadal_pozwala_czytac_z_obcego_origin(client):
    res = client.get("/api/movies", headers={"Origin": "https://evil.example"})
    assert res.status_code == 200


# ---------- brak wycieku kluczy API ----------

def test_log_klienta_tmdb_nie_zawiera_klucza(caplog, monkeypatch):
    """Klucz TMDb jedzie w adresie żądania, więc treść wyjątku biblioteki HTTP
    (i wszystko, co z niej logujemy) może zawierać klucz - log musi go maskować."""
    import logging

    import services.tmdb_client as tmdb_client

    sentinel = "SENTINEL-TMDB-LOG-KEY-111"

    def failing_urlopen(req, timeout=None):
        raise RuntimeError(f"<urlopen error> Get {req.full_url}: connection timed out")

    monkeypatch.setattr(tmdb_client.urllib.request, "urlopen", failing_urlopen)
    with caplog.at_level(logging.WARNING, logger="cinelog"):
        assert tmdb_client.tmdb_get("/movie/1", {}, sentinel) is None
    assert sentinel not in caplog.text, "klucz API trafił do logu"


def test_odpowiedzi_api_nie_zawieraja_klucza_serwera(client, monkeypatch):
    """Klucz serwera nie może pojawić się w żadnej odpowiedzi API."""
    sentinel = "SENTINEL-TMDB-KEY-1234567890"
    monkeypatch.setattr(app_module, "TMDB_API_KEY", sentinel)
    for path in ("/api/movies", "/api/shows", "/api/data", "/api/export"):
        res = client.get(path)
        assert sentinel not in res.get_data(as_text=True), f"wyciek klucza w {path}"


def test_test_kluczy_nie_ujawnia_klucza_w_komunikacie_bledu(client, monkeypatch):
    """Biblioteki HTTP potrafią wkleić cały adres żądania do treści wyjątku,
    a adres zawiera klucz API - komunikat dla klienta nie może go przenosić."""
    sentinel = "SENTINEL-OMDB-KEY-0987654321"
    monkeypatch.setattr(app_module, "TMDB_API_KEY", sentinel)

    def failing_urlopen(req, timeout=None):
        raise RuntimeError(f"<urlopen error> Get {req.full_url}: connection timed out")

    monkeypatch.setattr("routes.system.urllib.request.urlopen", failing_urlopen)

    res = client.post("/api/keys/test", json={"tmdb_key": sentinel})
    assert res.status_code == 200
    body = res.get_data(as_text=True)
    assert sentinel not in body, "klucz API wyciekł w komunikacie błędu"
    message = res.get_json()["tmdb"]["message"]
    assert "Błąd TMDb" in message  # diagnostyka nadal jest, tylko bez klucza
    assert "***" in message


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

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c
