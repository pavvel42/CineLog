# Audyt techniczny CineLog — stan faktyczny

Dokument opisuje **rzeczywisty** stan kodu na dzień 12.09.2026 (wersja `10.30`), zastępując
poprzednie wydanie, które opisywało architekturę sprzed refaktoru i było w kilkunastu
punktach niezgodne z kodem (rozdział 3). Każde twierdzenie ma tu dowód: polecenie, plik
albo wynik testu. Rozróżnienie: **FAKT** = widzę w kodzie/wyniku polecenia,
**PODEJRZENIE** = wymaga dalszej weryfikacji.

---

## 1. Jak uruchomić i zweryfikować

```bash
python3 run.py                # start aplikacji (PORT, HOST, DATA_DIR, FLASK_DEBUG)
```

| Zmienna | Domyślnie | Uwaga |
|---|---|---|
| `PORT` | `5001` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` tylko świadomie — aplikacja nie ma uwierzytelniania |
| `DATA_DIR` | `data/` | katalog plików JSON |
| `FLASK_DEBUG` | `0` (wyłączony) | `1` włącza tryb debug |

Przy pierwszym starcie `run.py` generuje `static/js/config.js` z `static/js/config.example.js`
(plik jest ignorowany w gicie) — bez tego `index.html` zgłaszał 404, a testy e2e były czerwone.

Weryfikacja jednym poleceniem:

```bash
npm run verify     # pytest + mypy + pyflakes + spójność danych + linter frontendu + playwright
```

Bramki stosowane w CI (`.github/workflows/ci.yml`, 4 zadania): `pytest`, `mypy` + `pyflakes`,
statyczny check frontendu (`scripts/check_frontend.py`), spójność danych (`scripts/check_data_sync.py`),
świeżość bundla, `sync_version.py check`, e2e (Playwright + Chromium).

---

## 2. Architektura (mapa zweryfikowana)

- **Backend**: Flask, 34 reguły URL (bez `/static`) w **7 blueprintach**:
  `movies`, `shows`, `search`, `vod`, `upcoming`, `recommendations`, `system`.
  `app.py` to komposition root (138 linii): konfiguracja, wspólne funkcje (`load_movies`,
  `save_movies`, `load_shows`, `save_shows`, cache), import symboli dla blueprintów.
  Warstwa serwisowa: `services/` (`data_store`, `metadata`, `tmdb_client`, `vod_providers`,
  `episodes_meta`, `client_keys`, `security`).
- **Frontend**: statyczne ES modules (`static/js/main.js` + `static/js/modules/*.js`),
  bundlowane esbuildem do `static/dist/app.min.js` (osobny bundle: `drive_sync.min.js`),
  PWA (`sw.js`, `manifest.json`). Wejście: `index.html`.
- **Dane**: pliki JSON w `data/` (backend) oraz ich kopie dla trybu statycznego w
  `static/data/`. Zapis przez `DATA_LOCK` (atomowy), cache w pamięci (`EPISODES_CACHE`,
  `RECOMMENDATIONS_CACHE`, `VOD_CACHE_FILE`, `UPCOMING_CACHE_FILE`).
- **Dwa tryby pracy**: `flask` (dane z `/api/*`) oraz `client`/`demo` (dane z localStorage
  `cinelog_database`, bezpośrednie wywołania TMDb/OMDb/Google Drive). Wybór trybu:
  `static/js/modules/state.js`.

---

## 3. Czego poprzednia wersja dokumentu nie mówiła prawdy

| Twierdzenie w poprzednim `AUDYT.md` | Stan faktyczny (dowód) |
|---|---|
| „`app.py` (2024 linii)… brak blueprintów, brak warstwy serwisowej, zero testów, zero CI" (`AUDYT.md:114`) | `app.py` ma **138 linii**; istnieje 7 blueprintów i `services/`; jest 76+ testów i 4 zadania CI |
| „`index.html` ×2 — duplikat", „`index.html` = `templates/index.html` bajt w bajt" (`AUDYT.md:35,151`) | Katalog `templates/` **nie istnieje** — jeden `index.html` |
| „`debug=True` (`app.py:2024`)" (`AUDYT.md:85`) | Plik nie ma tylu linii; `FLASK_DEBUG` domyślnie `0` (`run.py:41`) |
| „Backend — 31 tras" (`AUDYT.md:41`) | 34 reguły URL |
| „Zero plików testowych, zero CI" (`AUDYT.md:114`) | `tests/` (pytest) + `e2e/` (Playwright) + `.github/workflows/ci.yml` |

Wniosek operacyjny: poprzednie wydanie traktujemy jako historyczne — nie jest źródłem prawdy
o kodzie. Utrzymujemy tę zasadę: **kod > dokumentacja**.

---

## 4. Co naprawiono w tej rundzie

| Ustalenie (waga) | Naprawa | Dowód weryfikacji |
|---|---|---|
| Brak `static/js/config.js` → 404 i czerwone e2e (wysoka) | `run.py` generuje plik z szablonu; szablon zawiera brakujący `TMDB_API_KEY`; `.gitignore` rozdzielony, artefakty testów wypisane z gita | `npx playwright test` 7/7 (było 2 failed), `pytest` zielony |
| **CSRF**: dowolna strona w przeglądarce mogła zresetować bibliotekę (krytyczna) | `services/security.py` + bramka `before_request` w `app.py`; domyślny `HOST=127.0.0.1` | Atak powtórzony realnie: `POST /api/movies/reset` z obcego origin → **403**, biblioteka nietknięta; legalny zapis → 200, odczyt → 200 |
| Klucze API wyciekały w komunikatach błędów i logach (wysoka) | `mask_secret()`; `routes/system.py` i `services/tmdb_client.py` maskują wartości | Test czerwony przed zmianą (klucz widoczny w odpowiedzi i logu), zielony po |
| `tmdb_id` zapisywany jako literał `tmdb_undefined` (średnia) | walidator `normalize_tmdb_id` (backend) i `tmdbIdOf` (frontend); identyfikator nie jest już sklejany z `undefined` | Diagnostyka stosu wywołań pokazała żądanie `movie/tmdb_undefined/watch/providers`; po naprawie żadne żądanie w całym e2e nie zawiera tego literału (`e2e/tmdb-id.spec.js`) |
| Pola `tmdb_id` nie zapisywane przy dodawaniu pozycji (średnia) | `routes/movies.py`, `routes/shows.py` zapisują i uzupełniają pole | `tests/test_tmdb_id.py` (21 przypadków) |
| 4 przyciski z akcją w `onclick` nie działały — blokuje je CSP (wysoka) | delegacja zdarzeń (`data-action` + `addEventListener`) | `e2e/ui-dead-controls.spec.js`; w DOM zero atrybutów zdarzeń |
| 5 odwołań do nieistniejących identyfikatorów DOM (średnia) | status Dysku Google rozpoznaje element po `data-drive-chip` (wcześniej status nigdy się nie aktualizował); martwe odwołania usunięte | `scripts/check_frontend.py` — 0 zgłoszeń |
| 10 nieużywanych importów ES (niska) | usunięte | jak wyżej |
| `verify_completion` bezczynne: nikt nie wywoływał, a jego wejścia nie były zapisywane (średnia) | `add_show` zapisuje `total_seasons`, `total_episodes`, `series_status`, `in_production`; obejrzany serial traci flagę `caught_up` | `tests/test_shows_completion.py` (8 przypadków: 4 stany + idempotencja) |
| `npm test` kończył się błędem, brak bramki na dane demo (średnia) | `npm test` = pytest + playwright, doszły `check:types`, `check:frontend`, `check:data`, `verify`; `scripts/check_data_sync.py` pilnuje kopii `data/` ↔ `static/data/` | `tests/test_data_sync_check.py`, uruchomienie na realnych danych |

---

## 5. Co pozostaje otwarte

| Temat | Status | Uwaga |
|---|---|---|
| Jedno wejście do backendu (`apiFetch`): nagłówki BYOK + obsługa `res.ok` w 23 miejscach | w toku | Zmierzone: `/api/movies` i `/api/vod_cache_all` szły **bez** klucza BYOK; część zapisów ignorowała `!res.ok` i udawała sukces. Bramka: `e2e/byok-headers.spec.js` |
| Front: przekazywanie `series_status`/`in_production` i wywołanie `verify_completion` przy wejściu w „Seriale" | **do zrobienia** | Backend gotowy (`a4bfdfc`); bez tego trasa nadal nie jest używana przez UI |
| Testy tras bez pokrycia (ok. 10) | do zrobienia | m.in. `/api/search_detail`, `/api/actor/details`, `/api/watch_providers`, `/api/keys/test`, `/api/data`, `/api/export` |
| `static/data/directors_catalog.json` (35 KB) | do decyzji | **FAKT**: nie odwołuje się do niego żaden plik JS/Python/HTML i nie ma odpowiednika w `data/` — pozostałość po starej architekturze |
| 46 eksportów, których nic nie importuje | do decyzji | Nie ruszane w tej rundzie: brak dowodu szkodliwości, a usuwanie `export` zmienia API modułów |
| Ryzyko XSS przez `innerHTML` (twierdzenie poprzedniego wydania) | **PODEJRZENIE** | Istnieją helpery `escapeHtml`/`safeUrl` i są powszechnie używane, ale tej rundzie **nie** przeprowadzono pełnego przeglądu wszystkich miejsc wstrzykiwania HTML |
| Dane w historii gita (twierdzenie o danych osobowych) | zamknięte decyzją użytkownika | Dane uznane za syntetyczne; historia nietknięta, gałąź zapasowa pozostaje |
| Ochrona przed programem lokalnym (nie przeglądarką) | świadomie poza zakresem | Wybrana opcja „minimalna": blokada obcych stron + `127.0.0.1`. Pełna ochrona wymaga logowania/tokenu |

---

## 6. Zasady utrzymania dokumentu

1. Każde twierdzenie o kodzie musi mieć dowód (polecenie, plik:linia albo wynik testu).
2. Dokument nie opisuje architektury „docelowej" — tylko tę, która jest w kodzie.
3. Nowe bramki jakości uruchamiamy w CI i wypisujemy w rozdziale 1.
4. Rozdział 5 jest listą decyzji dla właściciela projektu — nie zgadujemy zamiast niego.
