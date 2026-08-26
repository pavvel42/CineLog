"""CineLog - punkt wejścia serwera deweloperskiego.

Uruchamianie: python run.py  (konfiguracja: PORT, FLASK_DEBUG - patrz .env.example)
"""

from __future__ import annotations

import os

from app import app


def main() -> None:
    port = int(os.environ.get("PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode, port=port)


if __name__ == "__main__":
    main()
