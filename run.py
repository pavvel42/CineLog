"""CineLog - punkt wejścia serwera deweloperskiego.

Uruchamianie: python run.py  (konfiguracja: PORT, FLASK_DEBUG - patrz .env.example)
"""

from app import app

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5001))
    debug_mode = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug_mode, port=port)
