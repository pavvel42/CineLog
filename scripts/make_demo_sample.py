#!/usr/bin/env python3
"""Buduje bazę demo jako PRÓBKĘ poprzedniej biblioteki z syntetycznym zachowaniem.

Z plików źródłowych (--src, np. stara kopia eksportu) pobiera wyłącznie
metadane tytułów (tytuł, poster, sezony, identyfikatory TMDb), a cały
behawior użytkownika — statusy, oceny, daty, obejrzane odcinki — generuje
deterministycznie (--seed). UUID są nowe, więc wpisów nie da się skorelować
z oryginałem.

Przykład:
  python scripts/make_demo_sample.py --src /sciezka/do/starych/json --seed 7
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import uuid
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
FMT = "%Y-%m-%d %H:%M:%S"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Próbka starej bazy + syntetyczny behawior")
    parser.add_argument("--src", required=True, help="katalog z movies_parsed.json i shows_parsed.json")
    parser.add_argument("--movies", type=int, default=50)
    parser.add_argument("--series", type=int, default=25)
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


def new_uuid(rng: random.Random) -> str:
    return str(uuid.UUID(int=rng.getrandbits(128), version=4))


def past_timestamp(rng: random.Random, max_days_back: int = 800) -> str:
    days = rng.randint(1, max_days_back)
    hour = rng.choices(range(8, 24), weights=[2] * 9 + [6, 7, 8, 8, 7, 6, 4])[0]
    dt = datetime.now() - timedelta(days=days)
    return dt.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59)).strftime(FMT)


def pick_rating(rng: random.Random) -> int | None:
    roll = rng.random()
    if roll < 0.30:
        return 5
    if roll < 0.62:
        return 4
    if roll < 0.83:
        return 3
    if roll < 0.94:
        return 2
    return 1


def synthesize_movie(rng: random.Random, src: dict) -> dict:
    status_roll = rng.random()
    if status_roll < 0.66:
        status = "watched"
    elif status_roll < 0.88:
        status = "watchlist"
    else:
        status = "followed"

    rating = pick_rating(rng) if status == "watched" else None
    watch_date = past_timestamp(rng) if status == "watched" else None
    follow_date = past_timestamp(rng, 400)
    created = watch_date or follow_date
    release_date = src.get("release_date") or None
    year = (release_date or "")[:4] or ""

    return {
        "uuid": new_uuid(rng),
        "tmdb_id": None,
        "imdb_id": None,
        "title": src.get("title") or "",
        "original_title": src.get("title") or "",
        "year": year,
        "genre": "",
        "director": "",
        "cast": [],
        "plot": "",
        "runtime": 0,
        "poster_url": src.get("poster_url") or "",
        "rating": rating,
        "status": status,
        "watch_date": watch_date,
        "follow_date": follow_date,
        "release_date": release_date,
        "is_favorite": bool(status == "watched" and rng.random() < 0.09),
        "rewatched": 0,
        "raw_rating_suffix": None,
        "created_at": created,
        "updated_at": created,
        "user_date": created.split(" ")[0] if created else None,
    }


def synthesize_series(rng: random.Random, src: dict) -> dict:
    status_roll = rng.random()
    if status_roll < 0.38:
        status = "watching"
    elif status_roll < 0.66:
        status = "watched"
    elif status_roll < 0.86:
        status = "watchlist"
    else:
        status = "followed"

    total_seasons = int(src.get("total_seasons") or 1)
    season_ep_counts_src = src.get("season_ep_counts") or {}
    season_ep_counts = {
        str(i + 1): int((season_ep_counts_src.get(str(i + 1)) or season_ep_counts_src.get(i + 1)) or 8)
        for i in range(total_seasons)
    }

    episodes: list[dict] = []
    if status in ("watching", "watched"):
        last_season = total_seasons if status == "watched" else rng.randint(1, max(1, total_seasons))
        day_cursor = datetime.now() - timedelta(days=rng.randint(30, 700))
        for season in range(1, last_season + 1):
            ep_total = season_ep_counts[str(season)]
            if status == "watching" and season == last_season:
                ep_total = rng.randint(1, max(1, ep_total))
            for ep in range(1, ep_total + 1):
                day_cursor += timedelta(days=rng.randint(1, 3))
                hour = rng.choices([19, 20, 21, 22, 23], weights=[3, 5, 6, 4, 2])[0]
                ts = day_cursor.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))
                episodes.append({
                    "episode_id": new_uuid(rng),
                    "season": season,
                    "episode": ep,
                    "created_at": ts.strftime(FMT),
                })

    highest_s = max((e["season"] for e in episodes), default=0)
    highest_e = max((e["episode"] for e in episodes if e["season"] == highest_s), default=0)
    created = episodes[0]["created_at"] if episodes else past_timestamp(rng, 500)
    updated = episodes[-1]["created_at"] if episodes else created

    rating = None
    if status == "watched" or (status == "watching" and rng.random() < 0.5):
        rating = pick_rating(rng)

    return {
        "uuid": new_uuid(rng),
        "title": src.get("title") or "",
        "original_title": src.get("title") or "",
        "year": "",
        "genre": "",
        "poster_url": src.get("poster_url") or "",
        "plot": "",
        "cast": [],
        "director": "",
        "total_seasons": total_seasons,
        "season_ep_counts": season_ep_counts,
        "episodes_watched": episodes,
        "watched_count": len(episodes),
        "latest_progress": f"S{highest_s:02d}E{highest_e:02d}" if highest_s else None,
        "latest_season": highest_s or None,
        "latest_episode": highest_e or None,
        "rating": rating,
        "status": status,
        "tmdb_id": src.get("show_id") or src.get("tmdb_id"),
        "imdb_id": None,
        "created_at": created,
        "updated_at": updated,
    }


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)

    src_dir = pathlib.Path(args.src)
    movies_src = json.loads((src_dir / "movies_parsed.json").read_text(encoding="utf-8"))
    shows_src = json.loads((src_dir / "shows_parsed.json").read_text(encoding="utf-8"))

    rng.shuffle(movies_src)
    rng.shuffle(shows_src)

    movies = [synthesize_movie(rng, m) for m in movies_src[: args.movies]]
    series = [synthesize_series(rng, s) for s in shows_src[: args.series]]

    outputs = {
        ROOT / "data" / "movies_parsed.json": movies,
        ROOT / "data" / "shows_parsed.json": series,
        ROOT / "data" / "movies_backup.json": json.loads(json.dumps(movies, ensure_ascii=False)),
        ROOT / "data" / "shows_backup.json": json.loads(json.dumps(series, ensure_ascii=False)),
        ROOT / "data" / "vod_cache.json": {},
        ROOT / "data" / "upcoming_cache.json": {},
        ROOT / "static" / "data" / "movies_parsed.json": movies,
        ROOT / "static" / "data" / "shows_parsed.json": series,
    }
    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{path.relative_to(ROOT)}: {len(payload)} wpisów")

    print(f"\nGotowe: {len(movies)} filmów, {len(series)} seriali, seed={args.seed}")


if __name__ == "__main__":
    main()
