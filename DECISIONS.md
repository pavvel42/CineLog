# DECISIONS.md — CineLog

Rejestr decyzji: co wybrano, co odrzucono i dlaczego. Wpisy dopisuje się na końcu; starych się nie
przepisuje — zmiana decyzji to nowy wpis, który wskazuje poprzedni.

Decyzje sprzed założenia rejestru opisują wiadomości commitów (`git log`).

---

## 2026-10-09 — Jeden plik projektu dla agentów: `AGENTS.md`
- **Wybrano:** fakty i konwencje projektu w `AGENTS.md` w repo; procedury w skillu `cinelog-verify`.
- **Odrzucono:** trzymanie ich w globalnej pamięci agenta (`MEMORY.md`).
- **Dlaczego:** pamięć trafia do każdej sesji, także niezwiązanej z projektem, i była prawie pełna.
  `AGENTS.md` ładuje się tylko w tym repo i jest wersjonowany razem z kodem.
- **Źródło:** commit `d65ad27`.

## 2026-11-15 — Remake to osobna pozycja biblioteki
- **Wybrano:** o tożsamości pozycji decyduje `tmdb_id`; bez niego tytuł razem z rokiem (front: `taSamaPozycja`
  w `static/js/modules/state.js`, backend: `services/data_store.py`).
- **Odrzucono:** dopasowanie po samym znormalizowanym tytule (rok wycinany z tytułu).
- **Dlaczego:** *Dune* (1984) i *Dune* (2021) były scalane w jedną pozycję, a usunięcie jednej kasowało obie.
- **Źródło:** audyt 2026-11, decyzja użytkownika („remake to inny film”).

## 2026-11-15 — Uszkodzony plik biblioteki: odmowa zapisu
- **Wybrano:** serwer nie nadpisuje pustego lub uszkodzonego pliku biblioteki; odkłada kopię `*.corrupt`
  i odmawia zapisu. Naprawia to wyłącznie import pliku (`replace_corrupt=True`).
- **Odrzucono:** traktowanie nieczytelnego pliku jak pustej listy.
- **Dlaczego:** pierwszy zapis po błędzie odczytu zastępował całą bibliotekę jedną pozycją.
- **Źródło:** audyt 2026-11, decyzja użytkownika.

## 2026-11-15 — Usunięcia przenoszą się przez Dysk Google
- **Wybrano:** usunięcie w trybie klienta zostawia ślad (`cinelog_deleted`, do roku, do 5000 wpisów), który
  jedzie na Dysk i jest stosowany przy scalaniu. Import pliku i przywrócenie kopii cofają ślady pozycji,
  które zawierają, i zastępują plik na Dysku zamiast scalać.
- **Odrzucono:** scalanie przez sumę zbiorów (usunięta pozycja wracała z drugiego urządzenia).
- **Dlaczego:** bez śladu nie da się odróżnić „usunięte tutaj” od „dodane tam”.
- **Źródło:** audyt 2026-11, wstępna zgoda użytkownika („myślę że tak”).

## 2026-11-15 — Serwer zapisuje tylko bibliotekę serwera
- **Wybrano:** żądania zmieniające bibliotekę (`/api/movies`, `/api/shows`, `/api/import`) wychodzą tylko wtedy,
  gdy w pamięci karty jest baza trybu serwera Flask; pilnuje tego `apiFetch`. Tryb klienta i demo zapisują
  w przeglądarce, także gdy serwer działa obok.
- **Odrzucono:** decydowanie po samej dostępności backendu (`state.backendAvailable`).
- **Dlaczego:** w trybie klienta na localhost odpowiedź serwera (jego własna lista) zastępowała bibliotekę
  użytkownika — przy usunięciu filmu i przy „weryfikacji ukończenia” seriali.
- **Źródło:** regresje `e2e/tryb-klienta-zapisy.spec.js`, `e2e/tryby-i-karty.spec.js`.

## 2026-11-15 — Martwe kontrolki usunięte, README opisuje stan faktyczny
- **Wybrano:** usunięcie przycisków bez obsługi („Oznacz kolejny (+1)”, „Kopiuj” w asystencie, baner instalacji
  PWA, licznik „0 odc.”) i poprawienie opisów w README.
- **Odrzucono:** dopisywanie brakujących funkcji.
- **Dlaczego:** decyzja użytkownika — dokumentacja ma opisywać to, co działa.
- **Źródło:** audyt 2026-11.

## 2026-11-16 — Imiennicy w profilu twórcy: pierwsza osoba o dokładnie tym nazwisku
- **Wybrano:** `/api/actor/details` bierze pierwszą osobę z TMDb, której nazwisko zgadza się dokładnie
  (`wybierz_osobe` w `services/dopasowanie.py`) — ta sama reguła co `resolveTmdbPersonId` we froncie.
- **Odrzucono:** odmowę przy dwóch trafieniach o tym samym nazwisku (reguła filmów i seriali) oraz branie
  `results[0]` w ciemno.
- **Dlaczego:** osoby nie mają roku, którym dałoby się rozstrzygnąć imienników; odmowa dawała pusty profil
  dla każdego twórcy z imiennikiem (Chris Evans, John Williams), a `results[0]` bywa osobą o innym nazwisku.
- **Źródło:** próba na żywo na `/api/actor/details`, `tests/test_dopasowanie_wszedzie.py`.

## 2026-11-16 — Scalanie z Dyskiem paruje wpisy jeden do jednego, najpierw po uuid
- **Wybrano:** `mergeLibraries` łączy wpis lokalny z najwyżej jednym wpisem z Dysku: najpierw po `uuid`
  (także gdy rematch zmienił `tmdb_id`), potem po tożsamości pozycji wśród wpisów bez pary
  (`_scalListe` w `static/js/drive_sync.js`). Biblioteka scalona z samą sobą zostaje bez zmian.
- **Odrzucono:** parowanie „pierwszy pasujący po `tmdb_id`” oraz automatyczne sklejanie przy scalaniu
  dwóch wpisów tej samej pozycji w jednej bibliotece.
- **Dlaczego:** przy dwóch wpisach o tym samym `tmdb_id` (np. polski i oryginalny tytuł serialu) oba lokalne
  trafiały w ten sam wpis z Dysku — jeden znikał, drugi szedł na Dysk dwa razy z tym samym `uuid`.
  Duplikaty w bibliotece usuwa użytkownik; synchronizacja nie kasuje wpisów po cichu.
- **Źródło:** weryfikacja na żywo na prawdziwej bibliotece (zapis na Dysk zablokowany),
  `e2e/drive-bezpieczenstwo.spec.js` („scalanie paruje wpisy jeden do jednego”).
