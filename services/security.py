"""Ochrona lokalnego API przed zapisami z obcych stron (CSRF).

Backend CineLog działa lokalnie i nie ma uwierzytelniania, więc każde żądanie
zapisujące dane (POST/PUT/PATCH/DELETE) jest w praktyce operacją uprzywilejowaną.
Przeglądarka wysyła takie żądanie z obcej strony bez pytania użytkownika
(np. automatycznie wysłany formularz), dlatego operacje modyfikujące wymagają
potwierdzenia, że pochodzą z naszej aplikacji.

Sprawdzamy nagłówki, które dokłada sama przeglądarka i których skrypt obcej
strony nie może podrobić: `Origin` oraz `Sec-Fetch-Site`.
"""

from __future__ import annotations

from urllib.parse import urlsplit

WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def mask_secret(text: str, *secrets: str) -> str:
    """Zamienia wartości kluczy API na `***` w komunikacie lub logu.

    Treść wyjątku biblioteki HTTP potrafi zawierać cały adres żądania, a klucze
    TMDb/OMDb jadą właśnie w adresie - bez maskowania trafiają do odpowiedzi API
    i do logów.
    """
    for secret in secrets:
        if secret:
            text = text.replace(secret, "***")
    return text


def _normalize_netloc(netloc: str) -> tuple[str, str]:
    """Rozbija `host:port` na parę (host, port) w porównywalnej formie."""
    netloc = netloc.strip().lower()
    if "@" in netloc:
        netloc = netloc.rsplit("@", 1)[1]
    if netloc.startswith("["):  # IPv6 w nawiasach: [::1]:5001
        host, _, port = netloc.partition("]")
        return host.lstrip("["), port.lstrip(":")
    host, _, port = netloc.partition(":")
    return host, port


def is_allowed_write(
    method: str,
    host: str | None,
    origin: str | None,
    sec_fetch_site: str | None,
) -> bool:
    """Czy żądanie modyfikujące może zostać wykonane?

    Dozwolone:
    - metody bezpieczne (GET/HEAD/OPTIONS) — nic nie zmieniają,
    - żądania bez nagłówka `Origin` (curl, skrypty, testy) — przeglądarka zawsze
      dołącza `Origin` do żądania zmieniającego stan, więc jego brak oznacza
      klienta spoza przeglądarki,
    - żądania z `Origin` wskazującym ten sam host i port co nagłówek `Host`
      (czyli nasza aplikacja).

    Odrzucane: `Origin` z innego hosta lub portu, `Origin: null` (np. plik
    lokalny) oraz `Sec-Fetch-Site: cross-site`.
    """
    if method.upper() not in WRITE_METHODS:
        return True
    if (sec_fetch_site or "").strip().lower() == "cross-site":
        return False
    if origin is None:
        return True
    origin = origin.strip()
    if not origin or origin.lower() == "null":
        return False
    if not host:
        return False
    origin_host = _normalize_netloc(urlsplit(origin).netloc)
    request_host = _normalize_netloc(host)
    return origin_host == request_host
