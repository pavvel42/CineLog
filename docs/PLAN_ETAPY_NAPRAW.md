# Plan etapowy: odporność danych i spójność trybu klienta (CineLog)

Plan napraw wynika z audytu po błędzie zaznaczania odcinków w trybie klienta
(PWA na github.io, commit `96367dd`) oraz przeglądu dalszych ryzyk
(scalanie Drive, limit localStorage, wyścigi UI). Każdy etap jest
samodzielnym commitem: implementacja → bundl (`npm run build`) → testy e2e
i pytest → weryfikacja → push.

Zasada architektoniczna obowiązująca we wszystkich etapach: **jedno źródło
prawdy dla reguł danych**. Jeśli reguła (np. „jak liczyć postęp serialu”)
istnieje w więcej niż jednym miejscu, wyciągamy ją do współdzielonej funkcji
zamiast kopiować — front (ESM) importuje z `modules/state.js`, a `drive_sync.js`
przechodzi na ESM (esbuild i tak bundluje wszystko do jednego pliku, więc
`<script>` bez `type="module"` dalej działa).

---

## Etap 1 — Spójność danych po scalaniu Google Drive ✅ (jako pierwszy)

**Problem.** `mergeLibraries` w `drive_sync.js` dopasowuje pozycje wyłącznie po
`title.toLowerCase()`, a po scaleniu odcinków nie przelicza `latest_progress` /
`latest_season` / `latest_episode` / `watched_count`. Skutek: licznik pokazuje
np. `S03E02`, mimo że w unii odcinków jest `S03E05`; pozycje o tym samym
`tmdb_id` (np. po rematchu zmieniającym tytuł) duplikują się.

**Zakres.**
1. `modules/state.js`: nowa funkcja `recalculateShowProgress(show)` — jedyne
   miejsce w frontendzie przeliczające `watched_count`, `latest_progress`,
   `latest_season`, `latest_episode` (+ sortowanie `episodes_watched`).
   Reguła 1:1 z backendem (`routes/shows.py`).
2. `modules/shows.js`: `persistLocalEpisodes` używa `recalculateShowProgress`
   (usuwa drugą kopię tej logiki).
3. `drive_sync.js`: przejście na ESM (import z `modules/state.js`);
   `mergeLibraries`:
   - dopasowanie warstwowe: `tmdb_id` → `uuid` → znormalizowany tytuł
     (`normalizeTitleForLibrary`); przy dwóch **różnych** `tmdb_id` tytuł
     nie może scalić pozycji (to dwie różne wersje),
   - po scaleniu serialu: unia odcinków + `recalculateShowProgress`.

**Weryfikacja.** e2e (`smoke.spec.js`, describe „scalenie Drive”): wywołanie
`window.googleDriveSync.mergeLibraries(...)` przez `page.evaluate` na
fixtures: (a) serial dopasowany po `tmdb_id` z różnymi tytułami — jeden wpis,
postęp przeliczony z unii; (b) film po `tmdb_id` z różnymi tytułami — jeden
wpis; (c) dwa różne `tmdb_id` przy podobnych tytułach — bez fałszywego scalenia.

**Kryterium akceptacji.** Po merge licznik/postęp zawsze zgadza się z unią
odcinków; brak duplikatów po dopasowaniu po `tmdb_id`; wszystkie testy zielone.

**Świadome ograniczenia (celowo poza etapem 1).** Semantyka konfliktów ocen
(`null` = brak vs. usunięta ocena) i propagacja usunięć — wymagają znaczników
`updated_at` per pozycja (tzw. tombstones); to Etap 5.

---

## Etap 2 — Odporność na limit localStorage (~5 MB)

**Problem.** `saveLocalDatabase` (state.js) przy `QuotaExceededError` robi tylko
`console.warn` — wszystkie zmiany przestają się zapisywać bez informacji dla
użytkownika. Pełna biblioteka (200+ seriali z odcinkami) realnie zbliża się do
kwoty.

**Zakres.**
1. Wykrycie błędu kwoty w `saveLocalDatabase` + toast diagnostyczny
   („Nie udało się zapisać bazy lokalnie — brak miejsca w przeglądarce”).
2. Raport rozmiaru bazy w modalu „Tryb i Środowisko” (JSON.stringify length),
   żeby dało się zdiagnozować zbliżanie do limitu.
3. Rozważone odchudzanie rekordów (np. skracanie `summary` odcinków w
   `episodes_watched`) — decyzja po zmierzeniu realnych rozmiarów.

**Weryfikacja.** e2e: mock `localStorage.setItem` rzucający `QuotaExceededError`
→ toast widoczny, aplikacja nie wywala się; klik w odcinek nadal mutuje stan
w pamięci.

---

## Etap 3 — Wyścigi w trackerze odcinków

**Problem.** `selectedShow` i `currentShowMeta` to zmienne modułowe w
`shows.js`, a `fetchTrackerData` / `ensureSeasonMeta` są asynchroniczne bez
licznika generacji. Szybkie otwarcie serialu A → zamknięcie → otwarcie B
pozwala opóźnionej odpowiedzi A nadpisać tracker B metadanymi A.

**Zakres.** Licznik generacji trackerów (wzorzec z `renderListInChunks`):
każde `openEpisodeTracker` inkrementuje `trackerGen`; asynchroniczne
kontynuacje (ustawienie `currentShowMeta`, re-render) ignorują wynik, gdy
generacja przestarzała.

**Weryfikacja.** e2e: mock `/api/shows/*/episodes_meta` z kontrolowanym
opóźnieniem (serial A 2 s, serial B 0 ms) → otwórz A, zamknij, otwórz B →
po 3 s tytuły odcinków w trackerze należą do B.

---

## Etap 4 — Fantomowe odcinki i strefa czasowa

**Zakres.**
1. „Zaznacz wszystkie poprzednie sezony” (shows.js, `seasonMax = 10`): gdy brak
   metadanych, użyj realnego maksimum z `episodes_watched` innych seriali /
   `season_ep_counts` z importu zamiast sztywnej 10 — bez tworzenia nieistniejących
   odcinków E9/E10.
2. `watch_date` w `movies.js` (`toISOString()` = UTC): przejście na czas lokalny
   w formacie spójnym z backendem (`YYYY-MM-DD HH:MM:SS`), unifikacja z
   `localTimestamp()` z shows.js (wyciągnięcie do state.js).

**Weryfikacja.** e2e trybu klienta: oznaczenie „wszystkich sezonów” przy
sezonie 8-odcinkowym → brak odcinków > 8 w localStorage; data obejrzania
zgodna z lokalną datą przeglądarki.

---

## Etap 5 — Konsolidacja i przegląd niskiego ryzyka

**Zakres.**
1. Backend: wyciągnięcie przeliczania postępu do jednej funkcji w Pythonie
   (używanej przez `/episodes` i `/batch_episodes`) + testy jednostkowe.
2. Badge „(x/y)” sezonów: uporządkowanie logiki `hasEp0`/`totalEps` w
   `renderSeasonTabs` (podejrzenie błędnego licznika przy sezonie 0) — test e2e.
3. `console.warn` w krytycznych `catch(e){}` ścieżkach zapisu (shows/movies).
4. TTL/limit dla `EPISODES_CACHE` w app.py.
5. Audyt importer.js (dane zewnętrzne: sezon 0, brak numerów odcinków, daty).
6. Decyzja projektowa: tombstones (`updated_at`/`deleted_at` per pozycja) dla
   propagacji usunięć i rozstrzygania konfliktów ocen w sync Drive.

**Weryfikacja.** pytest (backend), e2e (UI), ręczny audyt importerem na
załączonych eksportach z `export data/`.

---

## Kolejność i reguły wspólne

- Każdy etap = osobny commit + push (GitHub Pages aktualizuje się automatycznie).
- Po każdym etapie: `npm run build` (oba bundle), pełne e2e, pełne pytest.
- Testy trybu klienta trzymamy w dedykowanym describe z
  `serviceWorkers: "block"` (SW omija `page.route` dla żądań zewnętrznych).
- Nie zmieniamy schematu danych (`episodes_watched`, `latest_*`) bez
  zachowania kompatybilności ze starymi bazami w localStorage i na Drive.
