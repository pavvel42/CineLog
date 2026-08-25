# 🔍 Audyt techniczny projektu CineLog

**Data audytu:** 22 sierpnia 2026
**Wersja:** v1.0.0+ (10 commitów, branch `main`, remote: `github.com/pavvel42/CineLog`)
**Zakres:** backend Python/Flask, frontend JS/HTML/CSS, PWA, repozytorium Git, bezpieczeństwo, wydajność, dostępność
**Charakter:** audyt statyczny kodu (research-only)

---

## 📋 Streszczenie zarządcze

CineLog to dobrze pomysłowa, funkcjonalnie rozbudowana PWA do zarządzania biblioteką filmów i seriali z architekturą *Privacy-First*. Kod jest świeży i pozbawiony długu w postaci TODO/FIXME, jednak audyt ujawnił **kilka problemów krytycznych**, które należy rozwiązać przed dalszym rozwojem:

| # | Problem | Waga |
|---|---------|------|
| 1 | **Dane osobowe właściciela commitowane do publicznego repo** (historia oglądania, oceny, timestampy seansów) — sprzeczne z deklaracją „100% prywatności" w README | 🔴 KRYTYCZNE |
| 2 | **XSS przez `innerHTML` bez escapowania** — 161 użyć, brak helpera `escapeHtml`, brak CSP; wektor krytyczny: import pliku CSV/JSON z złośliwym tytułem | 🔴 KRYTYCZNE |
| 3 | **`app.run(debug=True)`** — interaktywny debugger Werkzeug = zdalne wykonanie kodu przy ekspozycji poza localhost + pełny brak autoryzacji na destrukcyjnych endpointach (DELETE/reset/export) | 🔴 KRYTYCZNE |
| 4 | **2 aktywne bugi backendu**: martwy endpoint `/api/vod_precache` (brak `return`) oraz `NameError` w `/api/upcoming` gdy brak klucza TMDb | 🟠 WYSOKIE |
| 5 | **Memory leak frontendu** — akumulacja listenerów DOM przy każdym wejściu w zakładkę „Dla Ciebie" | 🟠 WYSOKIE |
| 6 | Klucze API i token OAuth Google w `localStorage`, przesyłane w query stringach GET, wywołania OMDb po czystym HTTP | 🟠 WYSOKIE |

**Ocena ogólna:** prototyp/MVP o wysokim poziomie funkcjonalnym, wymagający twardnienia bezpieczeństwa i porządków architektonicznych przed udostępnieniem szerszej grupie użytkowników.

---

## 📊 Statystyki projektu

### Struktura kodu (~1,34 MB kodu + ~7,3 MB danych/binariów)

| Warstwa | Pliki | Linie | Rozmiar |
|---------|-------|-------|---------|
| Backend (`app.py`) | 1 | 2 024 | 92 KB |
| Skrypty narzędziowe Python | 4 | 652 | ~26 KB |
| HTML (`index.html` ×2 — duplikat) | 2 | 3 752 | ~275 KB |
| JavaScript aktywny | 16 | 12 304 | ~526 KB |
| JavaScript martwy (`bundle.js`) | 1 | 8 613 | 409 KB |
| CSS (`style.css`) | 1 | 2 818 | 65 KB |
| **Razem kod aktywny** | — | **~21 500** | **~1 MB** |

### Backend — 31 tras / 25 funkcji widoku

Kluczowe endpointy: CRUD filmów i seriali, metadane odcinków, wyszukiwanie TMDb→OMDb, providerzy VOD (cache 7 dni), radar premier (ThreadPool 15 wątków), rekomendacje (discover/trending/person), profil aktora, export/reset biblioteki.

### Frontend — moduły ES6 (największe)

- `recommendations.js` — 1 621 linii
- `shows.js` — 1 253 linie · `directors_data.js` — 1 114 linii (dane)
- `vod.js` — 973 linie · `search.js` — 881 linii · `movies.js` — 851 linii

---

## 🔴 Krytyczne znaleziska

### 1. Wyciek danych osobowych do publicznego repozytorium

Pliki commitowane od commita inicjalnego (`f86b657`):

| Plik | Rozmiar | Zawartość |
|------|---------|-----------|
| `export data/movies_parsed.json` | 340 KB | 759 filmów ze statusami, ocenami, datami seansów co do sekundy |
| `export data/shows_parsed.json` | 933 KB | Postęp oglądania per odcinek z timestampami |
| `export data/shows_backup.json` | 901 KB | Backup 205 seriali |
| `export data/movies_backup.json` | 342 KB | Backup filmów |
| `export data/vod_cache.json` | 1,46 MB | Cache TMDb z kluczami typu `movie_PL_przyklad` — **ujawnia historię wyszukiwań** |
| `static/data/*.json` | 1,28 MB | Rozjeżdżające się duplikaty powyższych (drift: 759 vs 757 wpisów) |

To bezpośrednio sprzeczne z README: *„Twoja biblioteka, oceny i historia oglądania nie trafiają na żaden zewnętrzny serwer"*.

**Rekomendacja:** usunąć pliki z gita (`git filter-repo` — dane pozostają w historii!), dodać do `.gitignore`: `export data/`, `static/data/*.json`, `*.cache.json`. Dane demo dostarczać opcjonalnym skryptem importu.

### 2. XSS — masowe użycie `innerHTML` bez sanitizacji

- **161 użyć `innerHTML`** w całym froncie, **zero helpera escapującego**, **brak nagłówka/meta CSP**.
- Krytyczny wektor: **`importer.js:400-410`** — tytuły i lata z importowanego pliku CSV/JSON (Filmweb/IMDb/Letterboxd) trafiają prosto do `innerHTML`. Złośliwy plik importu (`<img src=x onerror=...>` w tytule) wykonuje dowolny JS.
- Inne istotne: `search.js:594-608` (URL plakatu wstrzykiwany w atrybut `src=""`), `cloud.js:457,462` (**treść odpowiedzi zewnętrznego API AI renderowana jako HTML**), `movies.js:137-169`, `shows.js:747-769`, `cast.js:95-278`.
- Dodatkowo generowany HTML zawiera inline handlery `onerror=` (4 miejsca), które utrudnią przyszłe wdrożenie CSP.
- ✅ Jedyna poprawna ścieżka: `formatAiMarkdown` (`ai.js:309-326`) — najpierw escapuje, potem renderuje markdown.
- ✅ Zero `eval`/`new Function`.

**Rekomendacja:** wprowadzić `escapeHtml()` i stosować wszędzie dla danych dynamicznych; dodać CSP (nawet meta); zastąpić inline handlery delegowanymi listenerami.

### 3. Bezpieczeństwo backendu

- **`debug=True`** (`app.py:2024`) + **brak jakiejkolwiek autoryzacji**: każdy w sieci lokalnej może czytać, modyfikować, usuwać całą bibliotekę (`DELETE /api/shows/<uuid>`, `/api/movies/reset`) i eksportować dane (`/api/export`).
- **Brak rate limiting** na wszystkich 25 endpointach; `/api/vod_precache` przyjmuje nieograniczoną listę i odpala po 3+ zapytań TMDb na element — gotowy wektor DoS i wyczerpania limitów API.
- **Brak CORS** — dowolna strona w internecie może odpytywać API lokalnie działającej aplikacji z przeglądarki ofiary.
- **Hardcoded fallback klucza OMDb `"trilogy"`** (`app.py:221`, `1558`).
- **Klucze w query stringach GET** (~15 endpointów) → trafiają do logów serwera/proxy.
- **Wywołania OMDb po czystym HTTP z kluczem w URL** — 9 miejsc (m.in. `app.py:137,162,269`; `fetch_posters.py:63,83`).
- **Wyciek kluczy przez print wyjątków** — `URLError` embeduje pełny URL z kluczem (12 miejsc), spotęgowane `debug=True`.
- Walidacja wejścia szczątkowa: gołe `int()`, porównania `rating` bez sprawdzenia typu → 500; brak sanityzacji `poster_url`; parametry wklejane do URL-i zewnętrznych bez escapowania.

---

## 🐛 Znalezione bugi (aktywne)

| # | Bug | Lokalizacja |
|---|-----|-------------|
| 1 | Endpoint **`/api/vod_precache` nie zwraca odpowiedzi** — każde wywołanie kończy się `TypeError: view function did not return a valid response` (endpoint martwy) | `app.py:1302-1330` |
| 2 | **`NameError` w `/api/upcoming`** — zmienna `results` używana poza gałęzią `if effective_tmdb_key:` → 500 gdy brak klucza TMDb | `app.py:1429-1434` |
| 3 | `save_json` zwraca `None` zamiast `False` przy błędzie (kontrakt złamany, działa przypadkiem bo `None` jest falsy) | `app.py:56-63` |
| 4 | **Podwójny listener `input` na wyszukiwarce** — każdy klawisz = podwójny pełny re-render siatki | `main.js:276-280` + `search.js:409-417` |
| 5 | **Memory leak** — `initAiCuratorControls` dokłada 4 listenery (w tym `document.addEventListener("click")`) przy KAŻDYM wejściu w zakładkę „Dla Ciebie", bez `removeEventListener` | `recommendations.js:537, 919-966` |
| 6 | **Mismatch cache-busterów PWA**: strona ładuje `style.css?v=10.12`, SW pre-cacheuje `?v=10.19` → dwa wpisy cache, martwy precache | `index.html:22` vs `sw.js:6` |
| 7 | `range(1, 25)` — ukryte założenie „max 24 odcinki/sezon", generuje fałszywe obejrzane odcinki | `app.py:982` |
| 8 | Gwarantowany 404 przy klonowaniu: `config.js` ładowany z HTML, ale git-ignorowany i nieistniejący | `index.html:1858` |

---

## ⚙️ Backend — jakość i architektura

### Monolit jednoplikowy
`app.py` (2024 linii) łączy routing, logikę domenową, 4 integracje zewnętrzne, cache i persystencję. Brak blueprintów, warstwy serwisowej, testów (zero plików testowych, zero CI).

### Duplikacja
- `verify_url_live` identyczna 1:1 w dwóch skryptach (`fetch_posters.py:40-50`, `fetch_show_posters.py:10-20`).
- **4 niezależne implementacje** wzorca „szukaj w TMDb → fallback OMDb" w app.py.
- Blok formatowania wyniku TMDb skopiowany 4×; logika progress seriala 4×.

### Obsługa błędów
- **32× szerokie `except Exception:`**, większość z cichym `pass` — diagnostyka usterek niemożliwa.
- **Zero modułu `logging`** — 18× `print()`. Brak poziomów, timestampów, rotacji.
- **Zero adnotacji typów** w całym projekcie.

### Persystencja — race conditions
Flat-file JSON z read-modify-write całego pliku przy każdej mutacji, **bez locków** — dwa równoległe POST-y = utracone update'y. Co gorsza, `load_movies()`/`load_shows()` **zapisują pliki jako efekt uboczny operacji odczytu** (deduplikacja w GET).

### Cache bez ewikcji
`EPISODES_CACHE` i `RECOMMENDATIONS_CACHE` rosną bez ograniczeń (wyciek pamięci), a klucz cache zawiera klucz TMDb użytkownika — mieszanie danych różnych użytkowników.

### Funkcje >100 linii (backend)
Najgorsze: `search_detail` (206 linii), `get_upcoming_schedule` (191), `parse_shows` (162), `get_actor_details` (140), `fetch_live_watch_providers` (131).

### Wydajność
- Wszystkie HTTP synchroniczne (`urllib.urlopen`) w handlerach dev-servera.
- `search_detail`: do ~7 sekwencyjnych wywołań zewnętrznych (~25 s realnie).
- N+1 w `get_show_episodes_meta`: jedno żądanie na sezon (20 sezonów = 20+ HTTP w jednym requeście).
- ThreadPoolExecutor tworzony per-request; brak paginacji/kompresji — `/api/data` zawsze zwraca całą bibliotekę.
- ✅ Plusy: timeouty 3–5 s wszędzie, plikowy TTL cache VOD i premier.

### Braki projektowe
- ❌ **`requirements.txt` nie istnieje** (jedyna zależność: flask — nieprzypięta do wersji).
- Ręczny parser `.env` zamiast `python-dotenv`; ścieżki hardcoded względem CWD.

---

## 🎨 Frontend — jakość i architektura

### Duplikacja i martwy kod
- `index.html` = `templates/index.html` **bajt w bajt** — ręcznie utrzymywana podwójna kopia (GitHub Pages + Flask).
- `bundle.js` — **409 KB martwego artefaktu**: nigdzie niereferencjonowany, przestarzały względem modułów, brak systemu build (zero `package.json`).
- `manifest.json` = `static/manifest.json` — duplikat, oba w pre-cache SW.
- Podwójne źródło prawdy stanu: obiekt `state` + aliasy `window.allMovies/allShows...` synchronizowane ręcznie (`state.js:58-70`); legacy kod czyta jeszcze aliasy (`drive_sync.js:469`).

### Jakość kodu
- **15 funkcji >200 linii** (rekord: `initCloudSyncHandlers` — 583 linie).
- **~46 zostawionych `console.log/warn/error`**.
- **24 puste bloki `catch {}`**; mutacje backendu bez sprawdzania `res.ok` (`movies.js:611-700`) — stan lokalny i backend mogą się **cicho rozjechać**.
- 24× `innerHTML +=` (reparse rosnącego DOM); 37× `!important` w CSS; 721 inline `style="` w HTML + hardkodowane kolory obok tokenów M3.
- ✅ Zero TODO/FIXME; inicjalizacja modułów w indywidualnych try/catch (`main.js:438-451`).

### Wydajność
- Aktywny JS ~526 KB **bez minifikacji/code-splittingu**; `directors_data.js` (36 KB danych) ładowany zawsze.
- **Full re-render całej siatki przy każdym keystroke** (×2 przez bug #4), zero debounce'u na wyszukiwarce, zero wirtualizacji list — tysiące pozycji z IMDb = wielosekundowe zamrożenia.
- Layout thrashing przy streamingu AI: `innerHTML` + odczyt `scrollHeight` ×2 per token, zero `requestAnimationFrame`.
- Fonty ładowane dwukrotnie (`<link>` + `@import` w CSS — serializuje pobieranie).
- ✅ Lazy-loading plakatów, debounce autosave Drive (2 s), `Chart.destroy()` przed re-kreacją.

---

## 📱 PWA / Service Worker

- Cache `cinelog-v10.19.0`, strategie Network-First (JS/API) + SWR (reszta), agresywne czyszczenie starych cache — koncept poprawny.
- Problemy:
  1. Mismatch wersji `?v=` (bug #6) — już się rozjechało.
  2. `skipWaiting` + `clients.claim` bez powiadomienia użytkownika o aktualizacji → możliwa mieszanina starego HTML z nowymi modułami.
  3. Filtr `type === "basic"` **wyklucza cross-origin** — fonty Google i plakaty TMDb nigdy nie trafiają do cache → słaby offline mimo obietnic.
  4. Brak dedykowanej strony fallback-offline.
  5. Ręczna aktualizacja wersji w 8+ miejscach — podatne na drift.
- Manifest: poprawny (any+maskable, standalone), ale brak `id`, `shortcuts`, `share_target`; `orientation: portrait-primary` blokuje landscape.

---

## ♿ Dostępność (a11y)

- **ZERO atrybutów ARIA** w 1876 liniach statycznego HTML (jeden wyjątek: dialog potwierdzenia w `ui.js:395`).
- **Zablokowany zoom**: `maximum-scale=1.0, user-scalable=no` (`index.html:5`) — bezpośredni fail WCAG 1.4.4.
- Bottom-sheety otwierane klasą `.active` — **bez focus trap, bez przeniesienia fokusu, bez powrotu fokusu**; Esc zamyka tylko confirm dialog.
- Toast bez `aria-live` — czytniki ekranu nie ogłoszą powiadomień.
- Gwiazdki ocen to `<span>` bez `role`/`aria-label`/obsługi klawiatury (`movies.js:144-148`).
- ✅ Semantyka częściowo OK: `<main>/<header>/<nav>/<aside>`, `<article>`, 174 prawdziwych `<button>`.

---

## 🗂️ Repozytorium i higiena

- ✅ `.gitignore` poprawnie chroni: `.env`, `config.js`, `__pycache__`, `.venv`. Historia gita **czysta** — żaden klucz API nigdy nie trafił do commitów (zweryfikowano pełną historię regexem).
- ❌ Brakuje w `.gitignore`: `export data/`, `static/data/*.json`.
- ❌ Katalog **„export data" ze spacją** — wymusza URL-encoding `%20`, łamie konwencje CLI; frontend ma nawet fallbacki na 3 warianty ścieżki (`state.js:255-257`).
- ❌ `.gitattributes` — tylko `* text=auto`; brak reguł binary dla `*.png *.jpg *.ico`.
- ❌ ~84% repo to dane i binaria; największe pliki to cache'e (1,46 MB VOD cache) i screenshot (1 MB PNG) — powinny być generowane lokalnie/kompresowane.
- ✅ README zgodny ze stanem faktycznym (port 5001, instrukcje `.env`/`config.js`, licencja MIT) — poza kwestią prywatności (pkt krytyczny #1).

---

## ✅ Mocne strony projektu

Warto odnotować, co zrobiono dobrze:

1. **Architektura Privacy-First zgodna z ideą** — BYOK dla AI, brak serwerowej bazy danych, brak trackerów, brak eval.
2. **Świeża historia gita bez wycieków kluczy** (zweryfikowane).
3. Poprawny wzorzec ES6 modules z koordynatorem `main.js` i odpornością na awarie pojedynczego modułu.
4. Timeouty na wszystkich zapytaniach zewnętrznych; AbortController w detekcji środowiska.
5. `formatAiMarkdown` z proper escapingiem; `Chart.destroy()`; lazy-loading obrazów; debounce autosave Drive.
6. Guard przed nadpisaniem bazy demo na Drive; cache TTL dla VOD/premier.
7. Zero TODO-długu, zero console.debug chaosu w logice biznesowej, spójny Material Design 3.

---

## 🎯 Plan naprawczy — priorytety

### Faza 0 — natychmiast (bezpieczeństwo i prywatność)
1. Usunąć dane osobowe z gita + wyczyścić historię (`git filter-repo`); rozszerzyć `.gitignore`.
2. Wyłączyć `debug=True` (env var: `debug=os.environ.get("FLASK_DEBUG")=="1"`); dodać minimum auth lub wiązanie do `127.0.0.1`.
3. Naprawić 2 martwe/zawodzące endpointy (`vod_precache`, `upcoming` bez klucza).
4. Wprowadzić `escapeHtml()` i zastosować we wszystkich ścieżkach `innerHTML` (priorytet: importer, cloud/AI, search).

### Faza 1 — krótkoterminowa (higiena)
5. Dodać `requirements.txt` (`flask>=3.0`); zamienić printy na `logging`; usunąć fallback `"trilogy"`.
6. Usunąć `bundle.js` (409 KB), duplikat `manifest.json`, zsynchronizować źródło prawdy `index.html` (skrypt sync albo build).
7. Naprawić memory leak listenerów (`recommendations.js`), podwójny listener wyszukiwarki, dodać debounce.
8. Ujednolicić wersje cache-busterów `?v=` (jedno źródło prawdy); zmienić nazwę katalogu `export data` → `data/`.

### Faza 2 — średnioterminowa (architektura)
9. Rozbić `app.py` na blueprinty (routes/services/integrations); wydzielić wspólny klient TMDb/OMDb (likwidacja 4 duplikatów); locki na zapis JSON; limity na `vod_precache`.
10. Sanityzacja walidacją wejścia (marshmallow/pydantic lub ręcznie), przejście OMDb na HTTPS, klucze z body zamiast query string.
11. Wirtualizacja/paginacja list, code-splitting modułów, minifikacja buildem (esbuild/Vite), CSP + usunięcie inline handlerów.

### Faza 3 — długoterminowa (jakość)
12. Testy (pytest dla backendu, Playwright smoke dla PWA) + CI.
13. A11y: ARIA, focus trap, aria-live, odblokowanie zoomu.
14. Typowanie (mypy + JSDoc), redukcja funkcji >200 linii, likwidacja aliasów `window.*`.

---

## Metodologia

Audyt przeprowadzono metodą statycznej analizy kodu z pełną weryfikacją historii gita (10 commitów). Przeskanowano: wszystkie trasy Flask, 161 użyć `innerHTML`, ~70 wywołań `fetch`, 32 bloki `except`, pełną zawartość commitowanych JSON-ów oraz kompletność `.gitignore` względem śledzonych plików. Nie wykonano testów dynamicznych (penetration testing / fuzzing).

*Koniec raportu.*
