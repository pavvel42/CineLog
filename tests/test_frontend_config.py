"""Testy wstrzykiwania identyfikatora klienta OAuth do static/js/config.js (run.py).

Kontekst: identyfikator klienta czytała wyłącznie przeglądarka (localStorage) i pole
w oknie Drive, więc każde urządzenie miało własną, ręcznie wpisaną wartość. Rozjazd
między urządzeniami kończył się błędem Google `401 invalid_client` („The OAuth client
was not found"), który wygląda jak problem z uprawnieniami konta, a nim nie jest.
"""

from __future__ import annotations

import run

SZABLON = """// Konfiguracja frontendu - wypełniana przez run.py
window.CINELOG_CONFIG = {
  TMDB_API_KEY: "klucz-wpisany-recznie",
  OMDB_API_KEY: "",
  GOOGLE_CLIENT_ID: "",
};
"""

POPRAWNY_ID = "123456789012-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com"
NUMER_PROJEKTU = "123456789012"


def _przygotuj(tmp_path, monkeypatch):
    szablon = tmp_path / "config.example.js"
    szablon.write_text(SZABLON, encoding="utf-8")
    config = tmp_path / "config.js"
    monkeypatch.setattr(run, "FRONTEND_CONFIG_TEMPLATE", szablon)
    monkeypatch.setattr(run, "FRONTEND_CONFIG", config)
    return config


def test_brak_config_js_tworzy_go_z_szablonu(tmp_path, monkeypatch):
    config = _przygotuj(tmp_path, monkeypatch)

    assert run.ensure_frontend_config() is True
    assert config.read_text(encoding="utf-8") == SZABLON
    # Drugie wołanie nic nie robi (nie nadpisuje pliku użytkownika).
    assert run.ensure_frontend_config() is False


def test_wstrzykuje_identyfikator_z_env(tmp_path, monkeypatch):
    config = _przygotuj(tmp_path, monkeypatch)
    run.ensure_frontend_config()

    assert run.sync_frontend_config_from_env({"GOOGLE_CLIENT_ID": POPRAWNY_ID}) is True
    tresc = config.read_text(encoding="utf-8")
    assert f'GOOGLE_CLIENT_ID: "{POPRAWNY_ID}"' in tresc


def test_nie_rusza_pozostalych_wartosci(tmp_path, monkeypatch):
    config = _przygotuj(tmp_path, monkeypatch)
    run.ensure_frontend_config()

    run.sync_frontend_config_from_env({"GOOGLE_CLIENT_ID": POPRAWNY_ID})

    tresc = config.read_text(encoding="utf-8")
    # Klucz TMDb użytkownika (i reszta pliku) zostaje bez zmian.
    assert 'TMDB_API_KEY: "klucz-wpisany-recznie"' in tresc
    assert 'OMDB_API_KEY: ""' in tresc
    # Kształt pliku nadal jest poprawny: jedna linia GOOGLE_CLIENT_ID.
    assert tresc.count("GOOGLE_CLIENT_ID") == 1


def test_akceptuje_historyczna_nazwe_zmiennej(tmp_path, monkeypatch):
    config = _przygotuj(tmp_path, monkeypatch)
    run.ensure_frontend_config()

    # Nazwa wymyślona przez użytkownika - wcześniej nie czytana przez nikogo.
    assert run.sync_frontend_config_from_env({"ID_Project_Google_Cloud": POPRAWNY_ID}) is True
    assert POPRAWNY_ID in config.read_text(encoding="utf-8")


def test_preferuje_pierwsza_ustawiona_nazwe(monkeypatch):
    monkeypatch.setattr(run, "GOOGLE_CLIENT_ID_ENV_NAMES", ("GOOGLE_CLIENT_ID", "ID_Project_Google_Cloud"))

    assert run.read_google_client_id({"ID_Project_Google_Cloud": POPRAWNY_ID}) == POPRAWNY_ID
    assert run.read_google_client_id(
        {"GOOGLE_CLIENT_ID": POPRAWNY_ID, "ID_Project_Google_Cloud": "inny-ciag"}
    ) == POPRAWNY_ID
    assert run.read_google_client_id({"GOOGLE_CLIENT_ID": "   "}) == ""
    assert run.read_google_client_id({}) == ""


def test_odrzuca_numer_projektu_i_nie_zmienia_pliku(tmp_path, monkeypatch, capsys):
    config = _przygotuj(tmp_path, monkeypatch)
    run.ensure_frontend_config()

    # Numer projektu / klucz API w tej zmiennej to najczęstsza pomyłka: wartość
    # trafiałaby do Google i wracała jako 401 invalid_client.
    assert run.sync_frontend_config_from_env({"GOOGLE_CLIENT_ID": NUMER_PROJEKTU}) is False
    assert config.read_text(encoding="utf-8") == SZABLON
    assert "nie wygląda na identyfikator klienta OAuth" in capsys.readouterr().out


def test_bez_zmiennej_nie_zmienia_pliku(tmp_path, monkeypatch):
    config = _przygotuj(tmp_path, monkeypatch)
    run.ensure_frontend_config()

    assert run.sync_frontend_config_from_env({}) is False
    assert config.read_text(encoding="utf-8") == SZABLON


def test_brak_pliku_config_nie_wysypuje_wstrzykiwania(tmp_path, monkeypatch):
    szablon = tmp_path / "config.example.js"
    szablon.write_text(SZABLON, encoding="utf-8")
    monkeypatch.setattr(run, "FRONTEND_CONFIG_TEMPLATE", szablon)
    monkeypatch.setattr(run, "FRONTEND_CONFIG", tmp_path / "brak.js")

    assert run.sync_frontend_config_from_env({"GOOGLE_CLIENT_ID": POPRAWNY_ID}) is False


def test_is_google_client_id():
    assert run.is_google_client_id(POPRAWNY_ID) is True
    assert run.is_google_client_id(f"  {POPRAWNY_ID}  ") is True
    assert run.is_google_client_id(NUMER_PROJEKTU) is False
    assert run.is_google_client_id("") is False
    assert run.is_google_client_id("abcdefghijklmnop.apps.googleusercontent.com") is False
    assert run.is_google_client_id(POPRAWNY_ID + " ") is True
    assert run.is_google_client_id("123456789012-abc.api-key-not-client-id") is False
