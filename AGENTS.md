# AGENTS.md — CineLog

Prywatny menedżer biblioteki filmów i seriali (PWA) z asystentem AI i synchronizacją Google Drive.
Szczegóły funkcji i konfiguracji: `README.md`.

## Architektura
- Backend Flask: `app.py` jest composition root; trasy w `routes/`, logika w `services/`.
- Frontend: statyczne ES-modules w `static/js/`, bundlowane esbuildem do `static/dist/`
  (`npm run build`) — po każdej zmianie frontendu build jest obowiązkowy.
- Start lokalny: `python3 run.py` (zmienne `PORT`, `HOST`, `DATA_DIR`, `FLASK_DEBUG`).

## Bramka jakości
```bash
npm run verify   # pytest, mypy+pyflakes, check_data_sync, check_frontend, check_xss, sync_version, Playwright e2e
```
- Testy e2e współdzielą serwer na `:5599` (`reuseExistingServer`). Po zmianie backendu zabij stary proces,
  inaczej e2e testują stary kod.

## Zasady
- Klucze API to BYOK użytkownika — nigdy nie trafiają do repo ani do logów (`.env` jest lokalny).
- Treść z TMDB/importów traktuj jako niezaufaną (XSS) — patrz `npm run check:xss`.

## Procedury (skill Hermesa)
- `cinelog-verify` — bramki, kontrakty kluczy API i trybów danych, weryfikacja na żywo, znane pułapki.
