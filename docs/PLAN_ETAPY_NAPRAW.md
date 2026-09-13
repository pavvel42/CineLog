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

## Etap 2 — Odporność na limit localStorage (~5 MB) ✅

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

**Rozstrzygnięcia (po wykonaniu).**
- Toast błędu jest throttlowany do 1/60 s (seria zapisów nie spamuje), komunikat
  kieruje do kopii na Drive / eksportu JSON.
- Raport rozmiaru liczy `length * 2` bajtów (localStorage alokuje UTF-16) i
  pokazuje procent ~5 MB limitu originu; kolory ostrzegawcze przy 50%/80%.
  Modal odświeża pomiar przy każdym otwarciu.
- **Pomiar:** demo (25 seriali + 50 filmów) ≈ 0,16 MB; przeskalowana pełna
  biblioteka TV Time (200 seriali) ≈ 0,7–1 MB. Do limitu jest bezpieczny zapas,
  więc **odchudzanie rekordów jest odroczone** — realny punkt wzrostu to
  future'owe pola per-odcinek, wracamy do tego tylko jeśli raport pokaże >50%.

**Weryfikacja.** e2e: mock `localStorage.setItem` rzucający `QuotaExceededError`
→ toast widoczny, aplikacja nie wywala się; klik w odcinek nadal mutuje stan
w pamięci. Test raportu rozmiaru w modalu środowiska.

---

## Etap 3 — Wyścigi w trackerze odcinków ✅

**Problem.** `selectedShow` i `currentShowMeta` to zmienne modułowe w
`shows.js`, a `fetchTrackerData` / `ensureSeasonMeta` są asynchroniczne bez
licznika generacji. Szybkie otwarcie serialu A → zamknięcie → otwarcie B
pozwala opóźnionej odpowiedzi A nadpisać tracker B metadanymi A.

**Zakres.** Licznik generacji trackerów (wzorzec z `renderListInChunks`):
każde `openEpisodeTracker` inkrementuje `trackerGen`; asynchroniczne
kontynuacje (ustawienie `currentShowMeta`, re-render) ignorują wynik, gdy
generacja przestarzała.

**Rozstrzygnięcia (po wykonaniu).**
- `trackerGen` sprawdzany w: `openEpisodeTracker` (po `fetchTrackerData`),
  `fetchTrackerData` (po `Promise.all`, przed zapisem `currentShowMeta`,
  przed końcowym renderem), `ensureSeasonMeta` (przed zapisem metadanych),
  handlerze zakładki sezonu oraz w kontynuacji VOD (`.then`) — stare
  odpowiedzi stają się no-op zamiast nadpisywać stan/HTML.
- Test e2e zweryfikowany negatywnie: na kodzie sprzed poprawki fails
  (meta A nadpisuje tracker B), po poprawce przechodzi — test naprawdę
  łapie tę klasę regresji.

**Weryfikacja.** e2e: mock `/api/shows/*/episodes_meta` z kontrolowanym
opóźnieniem (serial A 2,5 s, serial B 0 ms) → otwórz A, zamknij, otwórz B →
po 3 s tracker B pokazuje wyłącznie metadane B.

---

## Etap 4 — Fantomowe odcinki i strefa czasowa ✅

**Zakres.**
1. „Zaznacz wszystkie poprzednie sezony” (shows.js, `seasonMax = 10`): gdy brak
   metadanych, użyj realnego maksimum z `episodes_watched` innych seriali /
   `season_ep_counts` z importu zamiast sztywnej 10 — bez tworzenia nieistniejących
   odcinków E9/E10.
2. `watch_date` w `movies.js` (`toISOString()` = UTC): przejście na czas lokalny
   w formacie spójnym z backendem (`YYYY-MM-DD HH:MM:SS`), unifikacja z
   `localTimestamp()` z shows.js (wyciągnięcie do state.js).

**Rozstrzygnięcia (po wykonaniu).**
- Długość poprzednich sezonów rozwiązywana kaskadowo: metadane TMDb →
  `season_ep_counts` z importu TV Time → najwyższy obejrzany odcinek;
  przy kompletnym braku danych zaznaczany jest tylko odcinek 1 (żadnych
  fantomów).
- `localTimestamp()` w state.js jako wspólne źródło daty (format backendu,
  czas lokalny); używane w shows.js, movies.js (`watch_date`), search.js
  i `buildLocalLibraryEntry` (`user_date`).
- Test e2e fantomów zweryfikowany negatywnie na kodzie sprzed poprawki (fail).
- Test strefy czasowej: `timezoneId: "Pacific/Kiritimati"` (UTC+14) +
  `page.clock.setFixedTime` — deterministycznie odróżnia datę lokalną (2026-09-02)
  od UTC (2026-09-01), niezależnie od pory uruchomienia testu.

**Weryfikacja.** e2e trybu klienta: oznaczenie „wszystkich sezonów” przy
sezonach 8-odcinkowych → dokładnie 8 odcinków w S1/S2, brak odcinków > 8,
`watched_count` 20, postęp `S03E04`; `watch_date` zgodna z lokalną datą
przeglądarki, nie UTC.

---

## Etap 5 — Konsolidacja i przegląd niskiego ryzyka ✅

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

**Rozstrzygnięcia (po wykonaniu).**
1. Backend: `_recalculate_show_progress()` w routes/shows.py — jedna funkcja
   dla /episodes i /batch_episodes (wcześniej dwie kopie); reguła 1:1 z
   frontendowym `recalculateShowProgress`. 5 nowych testów pytest.
2. `EPISODES_CACHE`: wpis = (timestamp_monotonic, meta), TTL 24 h, limit 200
   wpisów z ewikcją najstarszych (wcześniej bez TTL i bez limitu).
3. Frontend: `getSeasonDisplayInfo()` — badge „(x/y)” i zakres renderowanych
   wierszy z jednego źródła (naprawia niespójność 3/3 przy 6 wierszach w
   trybie klienta); `console.warn` w krytycznych ścieżkach zapisu odcinków
   i mutacji filmów.
4. Audyt importer.js — znaleziony i naprawiony realny błąd: import CineLog
   JSON (backup/Drive) **gubił episodes_watched** — serial zawsze wjeżdżał
   z pustą listą odcinków. Teraz kandydat serialu przenosi odcinki
   (+ season_ep_counts), a postęp przeliczany `recalculateShowProgress`;
   daty `created_at`/`updated_at`/`watch_date` w czasie lokalnym.
6. **Tombstones — decyzja: NIE wdrażamy teraz.** Propagacja usunięć i
   rozstrzyganie konfliktów ocen wymaga pól `updated_at`/`deleted_at`
   per pozycja zapisywanych przez WSZYSTKICH autorów (backend Flask,
   fallbacki klienta, importer, merge Drive) i spójnego wdrożenia na
   wszystkich urządzeniach — koszt przewyższa obecny problem (merge i tak
   gwarantuje, że nic nie zginie; skutkiem ubocznym jest odradzanie się
   usuniętych pozycji). Rejestr ryzyka: wrócić, gdy zgłoszysz realną
   utratę danych z synchronizacji między urządzeniami.

**Weryfikacja.** pytest 30/30 (w tym 5 nowych: helper, TTL, limit cache),
e2e 19/19 (w tym badge „(3/6)” zgodny z 6 wierszami w trybie klienta).

---

## Kolejność i reguły wspólne

- Każdy etap = osobny commit + push (GitHub Pages aktualizuje się automatycznie).
- Po każdym etapie: `npm run build` (oba bundle), pełne e2e, pełne pytest.
- Testy trybu klienta trzymamy w dedykowanym describe z
  `serviceWorkers: "block"` (SW omija `page.route` dla żądań zewnętrznych).
- Nie zmieniamy schematu danych (`episodes_watched`, `latest_*`) bez
  zachowania kompatybilności ze starymi bazami w localStorage i na Drive.
