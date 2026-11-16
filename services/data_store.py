"""CineLog - warstwa persystencji i narzędzi danych.

Atomowy zapis JSON, globalna blokada read-modify-write oraz
czyste funkcje pomocnicze (normalizacja tytułów, deduplikacja, walidacja).
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
import threading
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("cinelog")

# Single lock guarding read-modify-write sequences on the JSON data files
# (prevents lost updates when two requests mutate the library concurrently).
DATA_LOCK = threading.RLock()


class LibraryCorruptError(Exception):
    """Plik biblioteki (filmy/seriale) istnieje, ale jest pusty albo nie zawiera listy JSON.

    Zwrócenie wtedy `[]` kończyło się tym, że następny zapis nadpisywał całą bibliotekę
    jedną nową pozycją — dlatego czytanie i zapis biblioteki odmawiają pracy.
    """

    def __init__(self, filepath: str, reason: str) -> None:
        super().__init__(f"{os.path.basename(filepath)}: {reason}")
        self.filepath = filepath
        self.reason = reason


def load_json(filepath: str) -> list:
    """Wczytuje plik pomocniczy (cache): brak lub uszkodzenie = pusty wynik.

    Biblioteki użytkownika (filmy, seriale) czyta `load_library`, która uszkodzenia zgłasza.
    """
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.error("Error loading %s: %s", filepath, e)
        return []


def _library_problem(filepath: str) -> str | None:
    """Powód uszkodzenia pliku biblioteki albo None, gdy plik jest zdrowy lub go nie ma."""
    if not os.path.exists(filepath):
        return None
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError) as e:
        return f"nie da się odczytać pliku ({type(e).__name__})"
    if not text.strip():
        return "plik jest pusty"
    try:
        data = json.loads(text)
    except ValueError:
        return "plik nie jest poprawnym JSON-em"
    if not isinstance(data, list):
        return "plik nie zawiera listy"
    return None


def _backup_corrupt(filepath: str) -> None:
    """Jednorazowa kopia uszkodzonego pliku: `<nazwa>.corrupt`, a gdy zajęta — ze znacznikiem czasu.

    Ta sama zawartość nie jest kopiowana drugi raz (każde żądanie do uszkodzonej biblioteki
    zasypałoby katalog kopiami), a istniejąca kopia nigdy nie jest nadpisywana.
    """
    try:
        with open(filepath, "rb") as f:
            content = f.read()
        base = filepath + ".corrupt"
        directory = os.path.dirname(filepath) or "."
        prefix = os.path.basename(base)
        for name in os.listdir(directory):
            if name == prefix or name.startswith(prefix + "."):
                try:
                    with open(os.path.join(directory, name), "rb") as existing:
                        if existing.read() == content:
                            return
                except OSError:
                    continue
        target = base
        if os.path.exists(target):
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            target = f"{base}.{stamp}"
            counter = 1
            while os.path.exists(target):
                counter += 1
                target = f"{base}.{stamp}-{counter}"
        with open(target, "xb") as out:
            out.write(content)
        log.error("Uszkodzona biblioteka %s — kopia zapisana jako %s", filepath, os.path.basename(target))
    except OSError as e:
        log.error("Nie udało się zrobić kopii uszkodzonego pliku %s: %s", filepath, e)


def load_library(filepath: str) -> list:
    """Wczytuje bibliotekę (filmy lub seriale). Brak pliku = świeża instalacja = `[]`.

    Plik pusty, nieczytelny albo bez listy → `LibraryCorruptError` (po zrobieniu kopii).
    """
    problem = _library_problem(filepath)
    if problem:
        _backup_corrupt(filepath)
        raise LibraryCorruptError(filepath, problem)
    if not os.path.exists(filepath):
        return []
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def save_library(filepath: str, data: object, replace_corrupt: bool = False) -> bool:
    """Zapisuje bibliotekę, ale nie nadpisuje uszkodzonego pliku.

    `replace_corrupt=True` jest dla importu — jedynej drogi naprawy z poziomu UI; kopia
    uszkodzonego pliku powstaje i wtedy.
    """
    problem = _library_problem(filepath)
    if problem:
        _backup_corrupt(filepath)
        if not replace_corrupt:
            raise LibraryCorruptError(filepath, problem)
    return save_json(filepath, data)


def save_json(filepath: str, data: object) -> bool:
    try:
        os.makedirs(os.path.dirname(filepath) or ".", exist_ok=True)
        # Atomic write: dump to a temp file, then atomically replace the target
        fd, tmp_path = tempfile.mkstemp(dir=os.path.dirname(filepath) or ".", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, filepath)
        except Exception:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            raise
        return True
    except Exception as e:
        log.error("Error saving %s: %s", filepath, e)
        return False


def normalize_title(t: object) -> str:
    if not t:
        return ""
    t = re.sub(r"\s*\(\d{4}\)", "", str(t))
    t = re.sub(r"[^\w\s]", "", t, flags=re.UNICODE)
    return " ".join(t.lower().split())


def safe_int(value: object, default: int = 0) -> int:
    try:
        return int(value)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return default


def normalize_tmdb_id(value: object) -> int | None:
    """Zwraca identyfikator TMDb jako dodatnią liczbę całkowitą albo None.

    Klient potrafił wysłać literał "tmdb_undefined" (sklejenie tekstu z undefined)
    w polu ``tmdb_id``; taki identyfikator psuł deduplikację, cache VOD i zapytania
    do TMDb, więc jest odrzucany zamiast zapisywany.
    """
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value > 0 else None
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed.isdigit():
            return None
        parsed = int(trimmed)
        return parsed if parsed > 0 else None
    return None


def is_safe_media_url(value: object) -> bool:
    """Accept only http(s) poster/image URLs to avoid injecting javascript: data: etc."""
    if not isinstance(value, str) or not value.strip():
        return False
    return value.strip().lower().startswith(("http://", "https://"))


_ROK_W_NAWIASIE = re.compile(r"\((\d{4})\)")


def item_year(item: dict) -> str | None:
    """Rok pozycji: pole `year`, a gdy puste — rok w nawiasie w tytule („Maniac (2018)”)."""
    raw = str(item.get("year") or "").strip()
    if len(raw) >= 4 and raw[:4].isdigit():
        return raw[:4]
    found = _ROK_W_NAWIASIE.search(str(item.get("title") or ""))
    return found.group(1) if found else None


def is_same_item(a: dict, b: dict) -> bool:
    """Jedna tożsamość pozycji — dla deduplikacji i dla dodawania (filmy i seriale).

    - oba wpisy mają `tmdb_id` → ta sama pozycja wtedy i tylko wtedy, gdy id są równe
      (remake o tym samym tytule i roku z innym id to inna pozycja);
    - w przeciwnym razie → równe znormalizowane tytuły ORAZ równe lata albo brak roku
      po którejś ze stron.
    `normalize_title` samo wycina rok, więc rok porównujemy osobno.
    """
    id_a = normalize_tmdb_id(a.get("tmdb_id"))
    id_b = normalize_tmdb_id(b.get("tmdb_id"))
    if id_a is not None and id_b is not None:
        return id_a == id_b
    title_a = normalize_title(a.get("title"))
    if not title_a or title_a != normalize_title(b.get("title")):
        return False
    year_a, year_b = item_year(a), item_year(b)
    return year_a is None or year_b is None or year_a == year_b


def find_same_item(items: list, candidate: dict) -> dict | None:
    """Pierwsza pozycja z listy będąca tym samym wpisem co `candidate` (wg `is_same_item`)."""
    return next((it for it in items if isinstance(it, dict) and is_same_item(it, candidate)), None)


def deduplicate_items(items: list) -> list:
    kept_by_title: dict[str, list[dict]] = {}
    kept_by_id: dict[int, list[dict]] = {}
    result: list[dict] = []
    for item in items:
        norm = normalize_title(item.get("title", ""))
        if not norm:
            result.append(item)
            continue
        item_id = normalize_tmdb_id(item.get("tmdb_id"))
        candidates = kept_by_title.get(norm, []) + (kept_by_id.get(item_id, []) if item_id is not None else [])
        prev = next((c for c in candidates if is_same_item(c, item)), None)
        if prev is not None:
            if item.get("status") == "watched" and prev.get("status") != "watched":
                prev["status"] = "watched"
            if item.get("rating") is not None and prev.get("rating") is None:
                prev["rating"] = item.get("rating")
            if item.get("poster_url") and not prev.get("poster_url"):
                prev["poster_url"] = item.get("poster_url")
            if item.get("watch_date") and not prev.get("watch_date"):
                prev["watch_date"] = item.get("watch_date")
            if item.get("release_date") and not prev.get("release_date"):
                prev["release_date"] = item.get("release_date")
            if item_id is not None and normalize_tmdb_id(prev.get("tmdb_id")) is None:
                prev["tmdb_id"] = item_id
                kept_by_id.setdefault(item_id, []).append(prev)
            if item.get("is_favorite"):
                prev["is_favorite"] = True
            if "episodes_watched" in item:
                prev_eps = prev.get("episodes_watched") or []
                prev_keys = {f"{e.get('season')}_{e.get('episode')}" for e in prev_eps}
                for ep in item.get("episodes_watched") or []:
                    k = f"{ep.get('season')}_{ep.get('episode')}"
                    if k not in prev_keys:
                        prev_eps.append(ep)
                        prev_keys.add(k)
                prev_eps.sort(key=lambda x: (x.get("season", 0), x.get("episode", 0)))
                prev["episodes_watched"] = prev_eps
                prev["watched_count"] = len(prev_eps)
        else:
            kept_by_title.setdefault(norm, []).append(item)
            if item_id is not None:
                kept_by_id.setdefault(item_id, []).append(item)
            result.append(item)
    return result
