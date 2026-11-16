"""B11: cache'e mają TTL i limit wpisów, a zapis plików cache jest atomowy (`save_json`).

Wzorzec: `EPISODES_CACHE` w routes/shows.py (stałe na górze modułu, `_now()` do podmiany w testach).
"""

from __future__ import annotations

import json
import os
import urllib.request
from datetime import datetime, timedelta

import pytest

import app as app_module
import routes.recommendations as rec_routes
import routes.upcoming as upcoming_routes
from services import cache_utils, vod_providers

FORMAT = "%Y-%m-%d %H:%M:%S"
KLUCZ = "klucz-testowy"


def _data(dni: float) -> str:
    return (datetime.now() + timedelta(days=dni)).strftime(FORMAT)


# --- przycinanie (services/cache_utils.py) ----------------------------------------

def test_przytnij_cache_usuwa_wygasle_i_zostawia_wazne():
    cache = {
        "stary": {"expires_at": _data(-1), "data": 1},
        "swiezy": {"expires_at": _data(1), "data": 2},
    }
    assert set(cache_utils.przytnij_cache(cache, max_entries=10)) == {"swiezy"}


def test_przytnij_cache_nie_rusza_oryginalu():
    cache = {"stary": {"expires_at": _data(-1)}}
    cache_utils.przytnij_cache(cache, max_entries=10)
    assert "stary" in cache


def test_przytnij_cache_limit_zostawia_najpozniej_wygasajace():
    cache = {f"k{i}": {"expires_at": _data(i + 1)} for i in range(5)}
    assert set(cache_utils.przytnij_cache(cache, max_entries=2)) == {"k3", "k4"}


def test_przytnij_cache_wpis_bez_daty_nie_wygasa_ale_pierwszy_odpada_przy_limicie():
    cache = {"bez_daty": {"found": True}, "k1": {"expires_at": _data(1)}, "k2": {"expires_at": _data(2)}}
    assert "bez_daty" in cache_utils.przytnij_cache(cache, max_entries=10)
    assert set(cache_utils.przytnij_cache(cache, max_entries=2)) == {"k1", "k2"}


def test_przytnij_cache_odrzuca_wpisy_niebedace_obiektami_i_nieparsowalne_daty_zostawia():
    cache = {"zly": "napis", "dziwna_data": {"expires_at": "kiedyś"}}
    assert set(cache_utils.przytnij_cache(cache, max_entries=10)) == {"dziwna_data"}


# --- rekomendacje -----------------------------------------------------------------

@pytest.fixture()
def z_kluczem(monkeypatch):
    monkeypatch.setattr(app_module, "TMDB_API_KEY", KLUCZ)


def _licznik_urlopen(monkeypatch) -> dict:
    stan = {"n": 0}

    class _Odp:
        def __enter__(self):
            return self

        def __exit__(self, *_) -> None:
            return None

        def read(self):
            return json.dumps({"results": []}).encode("utf-8")

    def atrapa(*_a, **_k):
        stan["n"] += 1
        return _Odp()

    monkeypatch.setattr(urllib.request, "urlopen", atrapa)
    return stan


def test_cache_rekomendacji_wygasa_po_ttl(client, z_kluczem, monkeypatch):
    stan = _licznik_urlopen(monkeypatch)
    client.get("/api/recommendations/trending")
    client.get("/api/recommendations/trending")
    assert stan["n"] == 1, "świeży wpis jest obsłużony z cache"

    real_now = rec_routes._now
    monkeypatch.setattr(rec_routes, "_now", lambda: real_now() + rec_routes._RECOMMENDATIONS_CACHE_TTL_SECONDS + 1)
    client.get("/api/recommendations/trending")
    assert stan["n"] == 2, "po TTL dane pobierane są ponownie"


def test_cache_rekomendacji_ma_limit_wpisow(client, z_kluczem, monkeypatch):
    _licznik_urlopen(monkeypatch)
    for i in range(rec_routes._RECOMMENDATIONS_CACHE_MAX_ENTRIES + 15):
        client.get(f"/api/recommendations/discover?media_type=movie&genres={i}")
    assert len(app_module.RECOMMENDATIONS_CACHE) <= rec_routes._RECOMMENDATIONS_CACHE_MAX_ENTRIES


def test_cache_rekomendacji_przy_limicie_wyrzuca_najstarszy_wpis(client, z_kluczem, monkeypatch):
    _licznik_urlopen(monkeypatch)
    monkeypatch.setattr(rec_routes, "_RECOMMENDATIONS_CACHE_MAX_ENTRIES", 3)
    for i in range(5):
        client.get(f"/api/recommendations/discover?media_type=movie&genres={i}")
    klucze = list(app_module.RECOMMENDATIONS_CACHE)
    assert len(klucze) == 3
    assert any(k.startswith("rec_discover_movie_4_") for k in klucze), "najnowszy wpis zostaje"
    assert not any(k.startswith("rec_discover_movie_0_") for k in klucze), "najstarszy wpis wylatuje"


# --- VOD --------------------------------------------------------------------------

def test_zapis_cache_vod_usuwa_wygasle_wpisy(tmp_path):
    sciezka = str(tmp_path / "vod.json")
    vod_providers.save_vod_cache(sciezka, {
        "movie_PL_stary": {"found": True, "expires_at": _data(-1)},
        "movie_PL_swiezy": {"found": True, "expires_at": _data(3)},
    })
    zapisany = json.load(open(sciezka, encoding="utf-8"))
    assert set(zapisany) == {"movie_PL_swiezy"}
    assert set(vod_providers.load_vod_cache(sciezka)) == {"movie_PL_swiezy"}


def test_zapis_cache_vod_ma_limit_wpisow(tmp_path, monkeypatch):
    sciezka = str(tmp_path / "vod.json")
    monkeypatch.setattr(vod_providers, "VOD_CACHE_MAX_ENTRIES", 3)
    vod_providers.save_vod_cache(sciezka, {f"movie_PL_{i}": {"expires_at": _data(i + 1)} for i in range(8)})
    assert set(json.load(open(sciezka, encoding="utf-8"))) == {"movie_PL_5", "movie_PL_6", "movie_PL_7"}


def test_zapis_cache_vod_jest_atomowy(tmp_path, monkeypatch):
    """Przerwany zapis nie może zostawić ściętego pliku ani pliku tymczasowego."""
    sciezka = str(tmp_path / "vod.json")
    vod_providers.save_vod_cache(sciezka, {"movie_PL_a": {"expires_at": _data(1)}})
    przed = open(sciezka, encoding="utf-8").read()

    def pada(*_a, **_k):
        raise OSError("dysk pełny")

    monkeypatch.setattr(os, "replace", pada)
    assert vod_providers.save_vod_cache(sciezka, {"movie_PL_b": {"expires_at": _data(1)}}) is False
    assert open(sciezka, encoding="utf-8").read() == przed
    assert [f for f in os.listdir(tmp_path) if f.endswith(".tmp")] == []


def test_zapis_cache_vod_zachowuje_wpisy_bez_daty(tmp_path):
    sciezka = str(tmp_path / "vod.json")
    vod_providers.save_vod_cache(sciezka, {"movie_PL_a": {"found": True}})
    assert set(json.load(open(sciezka, encoding="utf-8"))) == {"movie_PL_a"}


# --- upcoming ---------------------------------------------------------------------

def _zaseeduj_upcoming(cache: dict) -> None:
    app_module.save_json(app_module.UPCOMING_CACHE_FILE, cache)


def _atrapa_szczegolow(monkeypatch) -> None:
    """`urlopen` zwracające szczegóły serialu o `tmdb_id` 5 (zakończony)."""
    class _Szczegoly:
        def __enter__(self):
            return self

        def __exit__(self, *_) -> None:
            return None

        def read(self):
            return json.dumps({"id": 5, "name": "Nowy Serial", "status": "Ended"}).encode("utf-8")

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _Szczegoly())


def test_zapis_cache_upcoming_usuwa_wygasle_wpisy(client, z_kluczem, monkeypatch):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "Nowy Serial", "status": "watching", "tmdb_id": 5}])
    _zaseeduj_upcoming({
        "stary serial": {"expires_at": _data(-2), "data": {"status": "Ended"}},
        "swiezy serial": {"expires_at": _data(2), "data": {"status": "Ended"}},
    })

    _atrapa_szczegolow(monkeypatch)
    client.get("/api/upcoming?refresh=1")

    zapisany = json.load(open(app_module.UPCOMING_CACHE_FILE, encoding="utf-8"))
    assert "stary serial" not in zapisany
    assert "swiezy serial" in zapisany
    assert "nowy serial" in zapisany


def test_zapis_cache_upcoming_ma_limit_wpisow(client, z_kluczem, monkeypatch):
    monkeypatch.setattr(upcoming_routes, "_UPCOMING_CACHE_MAX_ENTRIES", 3)
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "Nowy Serial", "status": "watching", "tmdb_id": 5}])
    _zaseeduj_upcoming({f"serial {i}": {"expires_at": _data(i + 1), "data": {"status": "Ended"}} for i in range(6)})

    _atrapa_szczegolow(monkeypatch)
    client.get("/api/upcoming?refresh=1")
    assert len(json.load(open(app_module.UPCOMING_CACHE_FILE, encoding="utf-8"))) <= 3


def test_zapis_cache_upcoming_jest_atomowy(client, z_kluczem, monkeypatch):
    app_module.save_json(app_module.SHOWS_FILE, [{"uuid": "s1", "title": "Nowy Serial", "status": "watching", "tmdb_id": 5}])
    _zaseeduj_upcoming({"serial": {"expires_at": _data(5), "data": {"status": "Ended"}}})
    przed = open(app_module.UPCOMING_CACHE_FILE, encoding="utf-8").read()

    _atrapa_szczegolow(monkeypatch)

    def pada(*_a, **_k):
        raise OSError("dysk pełny")

    monkeypatch.setattr(os, "replace", pada)
    client.get("/api/upcoming?refresh=1")
    assert open(app_module.UPCOMING_CACHE_FILE, encoding="utf-8").read() == przed, "ścięty plik cache'u"
