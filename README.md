<p align="center">
  <img src="static/icons/icon-512.png" width="120" height="120" alt="CineLog Logo" style="border-radius: 28px; box-shadow: 0 8px 24px rgba(0,0,0,0.35);">
</p>

# 🎬 CineLog

<p align="center">
  <strong>Lekki, nowoczesny i w 100% prywatny menedżer biblioteki filmów i seriali (PWA) z asystentem AI, synchronizacją Google Drive i interfejsem Material 3 Expressive.</strong>
</p>

<p align="center">
  <a href="https://pavvel42.github.io/CineLog/"><img src="https://img.shields.io/badge/Live_Demo-GitHub_Pages-9333ea?style=for-the-badge&logo=github&logoColor=white" alt="Live Demo"></a>
  <img src="https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA Ready">
  <img src="https://img.shields.io/badge/Material_3-Expressive-38bdf8?style=for-the-badge" alt="Material 3">
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License">
</p>

---

## 📸 Zrzut ekranu

<p align="center">
  <img src="docs/screenshots/cinelog_movies_grid.png" alt="Główna biblioteka filmów i filtry platform VOD w Material 3" width="100%" style="border-radius: 12px;">
</p>

---

## ✨ Główne możliwości

- 🎞️ **Biblioteka Filmów i Seriali**: Wygodne zarządzanie seansami (*Obejrzane*, *Do obejrzenia*), ocenianie w skali gwiazdkowej, ulubione oraz licznik ponownych seansów (*rewatch*).
- 📺 **Śledzenie Odcinków (Episode Tracker)**: Intuicyjne oznaczanie obejrzanych sezonów i odcinków, statusy premier (*w produkcji*, *zakończony*) oraz powiadomienia o nadchodzących epizodach.
- 📥 **Uniwersalny Importer**: 
  - 🎬 **Filmweb** (eksport CSV)
  - 💚 **Letterboxd** (eksport CSV)
  - ⭐ **IMDb** (eksport CSV)
  - ⏱️ **TV Time** (pliki JSON / eksport GDPR)
  - 📦 **CineLog JSON** (pełna kopia zapasowa)
- 🤖 **Filmowy Asystent AI (BYOK – Bring Your Own Key)**:
  - Bezpieczny czat strumieniowy z modelem AI analizującym Twój gust filmowy i historię ocen.
  - Obsługa wiodących dostawców: **OpenAI**, **DeepSeek**, **Groq** (darmowy i błyskawiczny), **OpenRouter** oraz lokalnego **Ollama** (100% offline).
  - Interaktywne karty filmów, inteligentne wzmianki `@tytuł` i dodawanie polecanych pozycji 1 kliknięciem.
- ☁️ **Kopia i synchronizacja Google Drive**: Pełna, automatyczna synchronizacja biblioteki z Twoim prywatnym Dyskiem Google (bez zewnętrznych serwerów bazodanowych).
- 📊 **Statystyki & Osiągnięcia**: Wykresy czasu spędzonego przed ekranem, ulubione dekady i gatunki, katalog reżyserów oraz odznaki kinomana.
- 📺 **Filtry Platform VOD**: Błyskawiczne filtrowanie filmów pod kątem dostępności na platformach streamingowych (Netflix, HBO Max, Disney+, Prime Video, SkyShowtime, Apple TV, CANAL+ i inne).
- 📅 **Eksport Kalendarza & Danych**: Pobieranie kopii JSON/CSV oraz eksport premier do kalendarza `.ics` (Google Calendar, Apple Calendar, Outlook).
- 📱 **Progresywna Aplikacja Webowa (PWA)**: Możliwość instalacji na telefonie (iOS / Android) lub pulpicie z pełnym dostępem offline.

---

## 🚀 Szybki start

### Opcja A: Wersja Statyczna (np. GitHub Pages / Zero konfiguracji)

CineLog działa od razu w przeglądarce bez konieczności uruchamiania serwera!
1. Otwórz stronę projektu na **GitHub Pages** (lub uruchom lokalny plik `index.html`).
2. Zaimportuj swoją historię filmową z Filmweba, TV Time lub Letterboxd za pomocą *Uniwersalnego Importera*.
3. Wszystkie Twoje dane będą bezpiecznie przechowywane lokalnie w pamięci Twojej przeglądarki (`localStorage`).

---

### Opcja B: Wersja Pełna (Lokalny serwer Flask + Wyszukiwarka TMDb)

Uruchomienie lokalnego serwera Flask odblokowuje wyszukiwarkę online nowych filmów i seriali na żywo z bazy TMDb oraz automatyczne pobieranie metadanych.

#### 1. Klonowanie repozytorium
```bash
git clone https://github.com/pavvel42/CineLog.git
cd CineLog
```

#### 2. Konfiguracja klucza TMDb API (.env)
1. Zarejestruj darmowe konto na [The Movie Database (TMDb)](https://www.themoviedb.org/).
2. W [Ustawienia -> API](https://www.themoviedb.org/settings/api) wygeneruj darmowy klucz API (v3 auth).
3. Skopiuj szablon konfiguracji:
   ```bash
   cp .env.example .env
   ```
4. Wklej swój klucz w pliku `.env`:
   ```env
   TMDB_API_KEY=twoj_klucz_tmdb_tutaj
   ```

#### 3. Uruchomienie aplikacji
Wymagany Python 3.9+:
```bash
pip install flask
python app.py
```
Aplikacja uruchomi się pod adresem: **`http://localhost:5001`**.

---

## 🛡️ Dwa elastyczne tryby pracy: Pełna Prywatność vs Wygodna Chmura

CineLog został zaprojektowany w architekturze *Privacy-First* – to Ty decydujesz, jak chcesz zarządzać swoją bazą:

| Funkcjonalność | 🔒 Opcja 1: Pełna Prywatność (100% Offline) | ☁️ Opcja 2: Wygodna Synchronizacja (Google Drive) |
| :--- | :--- | :--- |
| **Gdzie przechowywana jest baza?** | Wyłącznie lokalnie w pamięci Twojej przeglądarki (`LocalStorage`). | Bezpośrednio w prywatnym pliku `cinelog_database.json` na Twoim Dysku Google. |
| **Wymagane logowanie / konta?** | **Brak.** Zero rejestracji, brak logowania, brak zewnętrznych serwerów. | Jednorazowe logowanie przez oficjalne Google OAuth (bez pośredników). |
| **Zarządzanie kopią zapasową** | Ręczny import (Filmweb, Letterboxd, IMDb, TV Time) oraz eksport JSON/CSV w dowolnym momencie. | Pełna, automatyczna synchronizacja w tle przy każdej zmianie na każdym urządzeniu. |
| **Asystent AI & Oceny** | Własne klucze API (OpenAI, DeepSeek, darmowy Groq lub lokalny Ollama) zapisane w przeglądarce. | Te same klucze API bezpiecznie przechowywane na Twoim urządzeniu. |
| **Migracja między trybami** | Możesz zacząć w 100% prywatnym trybie offline i w dowolnej chwili pobrać plik kopii zapasowej JSON. | **Bezproblemowa migracja:** Gdy zechcesz przejść z trybu prywatnego na wygodny – jedno kliknięcie *Zaloguj przez Google* w oknie *Chmura & Asystent AI* automatycznie wyeksportuje i zsynchronizuje całą Twoją dotychczasową lokalną bazę na Dysk Google bez utraty danych! |

---

## 🔑 Konfiguracja opcjonalnych integracji

### 1. Asystent AI (BYOK – Bring Your Own Key)
CineLog nie wymaga konfiguracji AI na serwerze – każdy użytkownik może podać swój własny klucz bezpośrednio w aplikacji:
1. W menu bocznym wybierz **Chmura & Asystent AI** -> zakładka **Asystent AI**.
2. Wybierz preferowanego dostawcę (np. darmowy i ultraszybki *Groq*, *OpenAI*, *DeepSeek*, *OpenRouter* lub lokalny *Ollama* działający 100% na Twoim komputerze).
3. Wpisz swój klucz API i kliknij *Zapisz*. Klucz jest weryfikowany na żywo i przechowywany wyłącznie lokalnie.

### 2. Klucze TMDb i OMDb / IMDb
W zakładce **Chmura & Asystent AI** -> **Klucze API** możesz skonfigurować:
- **TMDb API (The Movie Database):** Darmowy klucz odblokowujący rekomendacje na żywo, odkrywanie nowości i nadchodzące odcinki.
- **OMDb / IMDb API:** Opcjonalny darmowy klucz do pobierania punktowych ocen i danych IMDb.

### 3. Wygodna synchronizacja z Google Drive

CineLog oferuje dwa proste sposoby konfiguracji Google Drive:
- **Sposób A (Wprost w interfejsie aplikacji – bez dotykania kodu):**
  1. W menu bocznym otwórz **Chmura & Asystent AI** -> zakładka **Dysk Google**.
  2. Kliknij **Opcje zaawansowane (Własny Google Client ID)** i wklej swój identyfikator.
  3. Zostanie on zapamiętany w Twojej przeglądarce i od razu umożliwi logowanie.
- **Sposób B (Dla twórcy / domyślna konfiguracja projektu):**
  1. Skopiuj szablon konfiguracji:
     ```bash
     cp static/js/config.example.js static/js/config.js
     ```
  2. W [Google Cloud Console](https://console.cloud.google.com/) utwórz projekt, włącz Google Drive API i utwórz identyfikator *OAuth 2.0 Client ID* dodając autoryzowane domeny (`https://twoj-login.github.io` oraz `http://localhost:5001`).
  3. Wklej Client ID w pliku `static/js/config.js`:
     ```javascript
     window.CINELOG_CONFIG = {
       GOOGLE_CLIENT_ID: "twoj-id-klienta.apps.googleusercontent.com"
     };
     ```

---

## 🔒 Prywatność i Bezpieczeństwo

- **100% Prywatności:** Twoja biblioteka, oceny i historia oglądania nie trafiają na żaden zewnętrzny serwer śledzący.
- **Brak trackerów i telemetrii:** Zero zewnętrznych skryptów analitycznych i reklamowych.
- **Bezpieczeństwo kluczy:** Wszelkie klucze API (AI, TMDb, OMDb, Google OAuth) należą wyłącznie do Ciebie i nie opuszczają Twojego urządzenia.

---

## 📄 Licencja

Projekt udostępniony na licencji [MIT](LICENSE).
