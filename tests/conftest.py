"""Wspólne fixtures testów backendu.

`client` istniał wcześniej w trzech plikach testowych w identycznej postaci —
trzymamy go w jednym miejscu, żeby zmiana ścieżek danych nie wymagała trzech edycji.
"""

from __future__ import annotations

import socket

import pytest

import app as app_module


@pytest.fixture(autouse=True)
def _brak_sieci(monkeypatch):
    """Blokuje wyjście do sieci w KAŻDYM teście.

    Blokada siedzi na poziomie gniazd (DNS i `connect`), więc łapie `urllib`, `requests`
    i cokolwiek innego. Samo rzucenie wyjątku nie wystarcza: kod produkcyjny łyka
    `except Exception`, więc test przechodziłby po cichu, mimo że próbował wyjść w sieć.
    Dlatego próby są zapisywane i po teście oblewają go jawnie. W komunikacie jest
    tylko host — adres żądania mógłby zawierać klucz API z otoczenia.

    Testy, które potrzebują „sieci”, podmieniają `urlopen`/funkcje serwisów atrapą —
    atrapa działa przed warstwą gniazd, więc blokada im nie przeszkadza.
    """
    proby: list[str] = []

    def _zablokuj(nazwa: str, gniazdo: bool = False):
        def _odmow(*args, **kwargs):
            # Metody gniazda dostają `self` jako pierwszy argument — adres jest drugi.
            adres = args[1] if gniazdo and len(args) > 1 else (args[0] if args else "?")
            opis = f"{nazwa}: {adres}"
            proby.append(opis)
            raise AssertionError(f"test sięgnął do sieci: {opis}")
        return _odmow

    monkeypatch.setattr(socket, "getaddrinfo", _zablokuj("socket.getaddrinfo"))
    monkeypatch.setattr(socket, "create_connection", _zablokuj("socket.create_connection"))
    monkeypatch.setattr(socket.socket, "connect", _zablokuj("socket.connect", gniazdo=True))
    monkeypatch.setattr(socket.socket, "connect_ex", _zablokuj("socket.connect_ex", gniazdo=True))
    yield
    if proby:
        pytest.fail("test sięgnął do sieci: " + "; ".join(proby), pytrace=False)


@pytest.fixture(autouse=True)
def _czysty_cache_vod():
    """Czyści cache VOD trzymany w pamięci procesu.

    `services/vod_providers.load_vod_cache` zapamiętuje pierwszy odczyt w
    `_cache_state["data"]` (zapis idzie przez `save_vod_cache`, więc w produkcji jest
    spójny). W testach oznacza to jednak, że plik zasiany przez jeden test byłby
    maskowany zawartością wczytaną przez test wcześniejszy — dlatego czyścimy stan.
    """
    from services import vod_providers

    vod_providers._cache_state["data"] = None
    yield
    vod_providers._cache_state["data"] = None


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Izolowana aplikacja: wszystkie pliki danych wskazują na tmp_path.

    Dodawanie pozycji bez plakatu woła `fetch_online_metadata` (OMDb, iTunes) — w testach
    tras podmieniamy to na brak wyniku na granicy trasy; testy samego pobierania metadanych
    wołają `services.metadata` bezpośrednio z własną atrapą `urlopen`.
    """
    files = {
        "MOVIES_FILE": tmp_path / "movies.json",
        "SHOWS_FILE": tmp_path / "shows.json",
        "UPCOMING_CACHE_FILE": tmp_path / "upcoming_cache.json",
        "VOD_CACHE_FILE": tmp_path / "vod_cache.json",
    }
    for attr, path in files.items():
        monkeypatch.setattr(app_module, attr, str(path))
    for attr in ("MOVIES_FILE", "SHOWS_FILE"):
        app_module.save_json(str(files[attr]), [])
    monkeypatch.setattr(app_module, "fetch_online_metadata", lambda *a, **k: (None, None))
    app_module.EPISODES_CACHE.clear()
    app_module.RECOMMENDATIONS_CACHE.clear()

    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c
