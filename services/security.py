"""Ochrona lokalnego API przed zapisami z obcych stron (CSRF).

Backend CineLog działa lokalnie i nie ma uwierzytelniania, więc każde żądanie
zapisujące dane (POST/PUT/PATCH/DELETE) jest w praktyce operacją uprzywilejowaną.
Przeglądarka wysyła takie żądanie z obcej strony bez pytania użytkownika
(np. automatycznie wysłany formularz), dlatego operacje modyfikujące wymagają
potwierdzenia, że pochodzą z naszej aplikacji.

Sprawdzamy nagłówki, które dokłada sama przeglądarka i których skrypt obcej
strony nie może podrobić: `Origin` oraz `Sec-Fetch-Site`.

Drugą warstwą jest kontrola nagłówka `Host` (ochrona przed DNS rebinding): strażnik
zapisu porównuje `Origin` z `Host`, więc strona pod `evil.com`, która po zmianie DNS
wskazuje na 127.0.0.1, miałaby obie wartości równe. Atak rebinding wymaga nazwy DNS,
dlatego akceptujemy `localhost`, literały IP (dostęp po adresie LAN przy HOST=0.0.0.0)
i nazwy jawnie dopisane w `CINELOG_ALLOWED_HOSTS`.
"""

from __future__ import annotations

import ipaddress
import os
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


ALLOWED_HOSTS_ENV = "CINELOG_ALLOWED_HOSTS"


def allowed_hosts_from_env() -> tuple[str, ...]:
    """Dodatkowe nazwy hostów z `CINELOG_ALLOWED_HOSTS` (lista po przecinku, małe litery)."""
    raw = os.environ.get(ALLOWED_HOSTS_ENV, "")
    return tuple(name.strip().lower().rstrip(".") for name in raw.split(",") if name.strip())


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host.split("%", 1)[0])  # strefa IPv6 (fe80::1%eth0) nie zmienia adresu
    except ValueError:
        return False
    return True


def is_allowed_host(host_header: str | None, extra_hosts: tuple[str, ...] = ()) -> bool:
    """Czy nagłówek `Host` wskazuje na ten komputer (localhost, adres IP) albo nazwę z listy?"""
    if not host_header or not host_header.strip() or "@" in host_header:
        return False
    host, _ = _normalize_netloc(host_header)
    host = host.rstrip(".")
    if not host:
        return False
    return host == "localhost" or _is_ip_literal(host) or host in extra_hosts
