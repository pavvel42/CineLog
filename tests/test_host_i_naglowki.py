"""B9: kontrola nagłówka Host (DNS rebinding) i nagłówki bezpieczeństwa odpowiedzi."""

from __future__ import annotations

import pytest

from services import security


# --- is_allowed_host --------------------------------------------------------------

@pytest.mark.parametrize("host", [
    "localhost", "localhost:5001", "LOCALHOST:5001", "localhost.", "127.0.0.1", "127.0.0.1:5001",
    "[::1]", "[::1]:5001", "192.168.1.20:5001", "10.0.0.5", "[fe80::1]:5001", "[2001:db8::1]",
])
def test_host_localhost_i_literaly_ip_sa_dozwolone(host):
    assert security.is_allowed_host(host, ())


@pytest.mark.parametrize("host", [
    "evil.com", "evil.com:5001", "localhost.evil.com", "evil-localhost", "127.0.0.1.evil.com:5001",
    "cinelog.local", "", None, "   ", "2130706433", "999.1.1.1", "user@evil.com",
])
def test_host_z_nazwa_dns_jest_odrzucony(host):
    assert not security.is_allowed_host(host, ())


def test_host_z_listy_dozwolonych_jest_przyjety_bez_wzgledu_na_wielkosc_liter_i_port():
    assert security.is_allowed_host("Cinelog.Local:5001", ("cinelog.local",))
    assert not security.is_allowed_host("inny.local", ("cinelog.local",))


@pytest.mark.parametrize(("env", "oczekiwane"), [
    ("", ()),
    ("   ", ()),
    ("nas.local", ("nas.local",)),
    (" nas.local , Domowy.NET ,, ", ("nas.local", "domowy.net")),
])
def test_allowed_hosts_z_env(monkeypatch, env, oczekiwane):
    monkeypatch.setenv("CINELOG_ALLOWED_HOSTS", env)
    assert security.allowed_hosts_from_env() == oczekiwane


def test_allowed_hosts_bez_zmiennej_to_pusta_krotka(monkeypatch):
    monkeypatch.delenv("CINELOG_ALLOWED_HOSTS", raising=False)
    assert security.allowed_hosts_from_env() == ()


# --- aplikacja --------------------------------------------------------------------

def test_rebinding_zapis_z_origin_rownym_hostowi_obcej_nazwy_jest_blokowany(client):
    """Origin i Host = evil.com:5001 przechodziły strażnik zapisu (porównywał je ze sobą)."""
    res = client.post(
        "/api/movies", json={"title": "X"}, base_url="http://evil.com:5001",
        headers={"Origin": "http://evil.com:5001"},
    )
    assert res.status_code == 403
    assert res.is_json and res.get_json()["error"]


@pytest.mark.parametrize("sciezka", ["/api/movies", "/api/export", "/", "/api/nie-ma"])
def test_odczyt_z_obcego_hosta_tez_jest_blokowany(client, sciezka):
    res = client.get(sciezka, base_url="http://evil.com:5001")
    assert res.status_code == 403
    assert res.is_json and res.get_json()["error"]


@pytest.mark.parametrize("base", ["http://localhost", "http://127.0.0.1:5001", "http://192.168.1.20:5001", "http://[::1]:5001"])
def test_localhost_i_adresy_ip_dzialaja(client, base):
    assert client.get("/api/movies", base_url=base).status_code == 200


def test_host_z_zmiennej_srodowiskowej_dziala(client, monkeypatch):
    assert client.get("/api/movies", base_url="http://nas.local:5001").status_code == 403
    monkeypatch.setenv("CINELOG_ALLOWED_HOSTS", "nas.local")
    assert client.get("/api/movies", base_url="http://nas.local:5001").status_code == 200


@pytest.mark.parametrize("sciezka", ["/api/movies", "/api/nie-ma", "/"])
def test_naglowki_bezpieczenstwa_sa_na_odpowiedziach(client, sciezka):
    res = client.get(sciezka)
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["Referrer-Policy"] == "no-referrer"
    assert res.headers["X-Frame-Options"] == "DENY"


def test_naglowki_bezpieczenstwa_sa_tez_na_odpowiedzi_odrzuconej(client):
    res = client.get("/api/movies", base_url="http://evil.com")
    assert res.status_code == 403
    assert res.headers["X-Content-Type-Options"] == "nosniff"


def test_serwer_nie_ustawia_naglowka_csp(client):
    """CSP jest w index.html i zmienia go ktoś inny — backend go nie dokłada."""
    assert "Content-Security-Policy" not in client.get("/api/movies").headers
