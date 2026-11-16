"""CineLog - wspólne pomocniki HTTP tras (parsowanie żądania)."""

from __future__ import annotations

from flask import request

from services.validation import ApiError


def json_object() -> dict:
    """Treść żądania jako obiekt JSON.

    Niepoprawny JSON (400) i zły Content-Type (415) zgłasza sam Flask, a aplikacja zamienia
    to na JSON; tu dopilnowujemy tylko, że to obiekt, a nie lista, napis czy `null`.
    """
    data = request.get_json()
    if not isinstance(data, dict):
        raise ApiError("Treść żądania musi być obiektem JSON.")
    return data
