from flask import request

TMDB_HEADER = "X-TMDB-Key"
OMDB_HEADER = "X-OMDb-Key"


def tmdb_key() -> str:
    return (
        request.headers.get(TMDB_HEADER, "").strip()
        or request.args.get("tmdb_key", "").strip()
    )


def omdb_key() -> str:
    return (
        request.headers.get(OMDB_HEADER, "").strip()
        or request.args.get("omdb_key", "").strip()
        or request.args.get("imdb_key", "").strip()
    )
