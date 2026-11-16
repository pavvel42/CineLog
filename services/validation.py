"""CineLog - walidacja wejścia tras biblioteki (bez zależności od Flaska).

Jedno miejsce na reguły, które wcześniej były rozsiane po trasach: dozwolone statusy,
tytuł, adres plakatu, lista odcinków. Błąd walidacji to `ApiError` — aplikacja zamienia go
na JSON `{"error": "<komunikat>"}` jednym handlerem (patrz app.py).
"""

from __future__ import annotations

from typing import Any

from services.data_store import is_safe_media_url, normalize_tmdb_id, safe_int

# Limit rozmiaru żądania. Biblioteki z pełną historią odcinków ważą kilka–kilkanaście MB.
MAX_CONTENT_LENGTH = 64 * 1024 * 1024

# Statusy używane przez aplikację: backend (upcoming, verify_completion, PUT) oraz frontend
# (static/js/modules: watched/watchlist/watching) i dane demo (followed). `planowane`
# i `w_trakcie` to starsze nazwy, które nadal rozpoznaje harmonogram premier.
ALLOWED_STATUSES = frozenset({
    "watched", "watchlist", "watching", "followed", "archived", "planowane", "w_trakcie",
})


class ApiError(Exception):
    """Błąd wejścia zgłaszany klientowi jako JSON `{"error": komunikat}`."""

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def require_title(value: object) -> str:
    """Tytuł musi być niepustym napisem."""
    if not isinstance(value, str) or not value.strip():
        raise ApiError("Pole „title” musi być niepustym napisem.")
    return value.strip()


def parse_status(value: object) -> str:
    """Status musi należeć do zbioru używanego przez aplikację."""
    if not isinstance(value, str) or value not in ALLOWED_STATUSES:
        dozwolone = ", ".join(sorted(ALLOWED_STATUSES))
        raise ApiError(f"Niepoprawny status. Dozwolone wartości: {dozwolone}.")
    return value


def parse_tmdb_id(value: object) -> int:
    """`tmdb_id` przyjmujemy wyłącznie w postaci, którą rozpoznaje `normalize_tmdb_id`."""
    tmdb_id = normalize_tmdb_id(value)
    if tmdb_id is None:
        raise ApiError("Niepoprawny tmdb_id — oczekiwana jest dodatnia liczba całkowita.")
    return tmdb_id


def safe_poster_url(value: object) -> str | None:
    """Adres plakatu tylko http(s); inny schemat albo typ to puste pole, a nie błąd."""
    return value.strip() if isinstance(value, str) and is_safe_media_url(value) else None


def optional_text(value: object) -> str | None:
    """Pole tekstowe opcjonalne (np. data): niepusty napis albo None."""
    return value if isinstance(value, str) and value.strip() else None


def optional_year(value: object) -> str | None:
    """Rok jako cztery cyfry (z liczby lub początku napisu) albo None."""
    raw = "" if value is None or isinstance(value, bool) else str(value).strip()
    return raw[:4] if len(raw) >= 4 and raw[:4].isdigit() else None


def episode_list(value: Any) -> list[dict]:
    """`episodes_watched` niebędące listą to pusta lista; elementy niebędące obiektami odpadają."""
    if not isinstance(value, list):
        return []
    return [e for e in value if isinstance(e, dict)]


def series_metadata(data: dict) -> dict[str, Any]:
    """Metadane serialu z żądania (dodawanie i PUT): tylko pola z sensowną wartością.

    Zwrócony słownik nakłada się na wpis przez `update` — zero, pustka i śmieci nie trafiają
    do wyniku, więc nie nadpisują znanych wartości. `season_ep_counts` to lista odcinków
    w sezonach z TMDb: przyjmujemy pary sezon > 0 i liczba odcinków > 0 (sezon 0 to dodatki).
    """
    wynik: dict[str, Any] = {}
    total_seasons = safe_int(data.get("total_seasons"), 0)
    if total_seasons > 0:
        wynik["total_seasons"] = total_seasons
    total_episodes = safe_int(data.get("total_episodes"), 0)
    if total_episodes > 0:
        wynik["total_episodes"] = total_episodes
    series_status = str(data.get("series_status") or "").strip()
    if series_status:
        wynik["series_status"] = series_status
    if data.get("in_production") is not None:
        wynik["in_production"] = bool(data["in_production"])
    raw_counts = data.get("season_ep_counts")
    if isinstance(raw_counts, dict):
        counts: dict[str, int] = {}
        for klucz, wartosc in raw_counts.items():
            try:
                sezon_nr, liczba_odc = int(klucz), int(wartosc)
            except (TypeError, ValueError):
                continue
            if sezon_nr > 0 and liczba_odc > 0:
                counts[str(sezon_nr)] = liczba_odc
        if counts:
            wynik["season_ep_counts"] = counts
    return wynik
