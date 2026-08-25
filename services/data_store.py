"""CineLog - warstwa persystencji i narzędzi danych.

Atomowy zapis JSON, globalna blokada read-modify-write oraz
czyste funkcje pomocnicze (normalizacja tytułów, deduplikacja, walidacja).
"""

import json
import logging
import os
import re
import tempfile
import threading

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
log = logging.getLogger("cinelog")

# Single lock guarding read-modify-write sequences on the JSON data files
# (prevents lost updates when two requests mutate the library concurrently).
DATA_LOCK = threading.RLock()


def load_json(filepath):
    if not os.path.exists(filepath):
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        log.error("Error loading %s: %s", filepath, e)
        return []


def save_json(filepath, data):
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


def normalize_title(t):
    if not t:
        return ""
    t = re.sub(r"\s*\(\d{4}\)", "", str(t))
    t = re.sub(r"[^\w\s]", "", t, flags=re.UNICODE)
    return " ".join(t.lower().split())


def safe_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def is_safe_media_url(value):
    """Accept only http(s) poster/image URLs to avoid injecting javascript: data: etc."""
    if not isinstance(value, str) or not value.strip():
        return False
    return value.strip().lower().startswith(("http://", "https://"))


def deduplicate_items(items):
    seen = {}
    result = []
    for item in items:
        norm = normalize_title(item.get("title", ""))
        if not norm:
            result.append(item)
            continue
        if norm in seen:
            prev = seen[norm]
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
            seen[norm] = item
            result.append(item)
    return result
