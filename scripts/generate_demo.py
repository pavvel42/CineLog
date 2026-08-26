#!/usr/bin/env python3
"""Generator syntetycznej bazy demonstracyjnej CineLog.

Tworzy fikcyjny profil użytkownika (deterministyczny przy stałym --seed):
popularne tytuły filmowe/serialowe z wiarygodnym rozkładem ocen, statusów
i dat oglądania. Żadne dane rzeczywistego użytkownika nie są tu potrzebne
ani używane.

Tryby pozyskania tytułów:
  domyślnie   - wbudowana lista offline (bez sieci, w pełni powtarzalna)
  --tmdb KEY  - pobiera popularne tytuły + postery z TMDb (wymaga sieci)

Wynik trafia do data/ (Flask) i static/data/ (tryb statyczny GitHub Pages).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import random
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta

ROOT = pathlib.Path(__file__).resolve().parent.parent
FMT = "%Y-%m-%d %H:%M:%S"

# (tytuł, rok, minuty, gatunki) — filmy
MOVIES_OFFLINE = [
    ("Incepcja", 2010, 148, "Sci-Fi, Thriller"), ("Pulp Fiction", 1994, 154, "Kryminał"),
    ("Skazani na Shawshank", 1994, 142, "Dramat"), ("Podziemny krąg", 1999, 139, "Dramat"),
    ("Matrix", 1999, 136, "Sci-Fi, Akcja"), ("Chłopiec w pasiastej piżamie", 2008, 94, "Dramat, Wojenny"),
    ("Whiplash", 2014, 106, "Dramat, Muzyczny"), ("Interstellar", 2014, 169, "Sci-Fi, Przygodowy"),
    ("Gladiator", 2000, 155, "Akcja, Dramat"), ("Django", 2012, 165, "Western, Dramat"),
    ("Nietykalni", 2011, 112, "Komedia, Dramat"), ("Parasite", 2019, 132, "Thriller, Dramat"),
    ("Joker", 2019, 122, "Dramat, Kryminał"), ("Zielona książka", 2018, 130, "Komedia, Dramat"),
    ("Gran Torino", 2008, 116, "Dramat"), ("Sękata", 2021, 107, "Dramat"),
    ("Leon zawodowiec", 1994, 110, "Akcja, Kryminał"), ("Se7en", 1995, 127, "Kryminał, Thriller"),
    ("Milczenie owiec", 1991, 118, "Thriller, Kryminał"), ("Lot nad kukułczym gniazdem", 1975, 133, "Dramat"),
    ("Goodfellas", 1990, 145, "Kryminał, Dramat"), ("Ojciec chrzestny", 1972, 175, "Kryminał, Dramat"),
    ("Czas apokalipsy", 1979, 147, "Dramat, Wojenny"), ("Łowca deer", 1978, 182, "Dramat, Wojenny"),
    ("Barwy kampanii", 2008, 109, "Dramat"), ("Whisky z mlekiem", 2013, 100, "Dramat"),
    ("Her", 2013, 126, "Romans, Sci-Fi"), ("Wybuch", 2017, 111, "Dramat"),
    ("Drive", 2011, 100, "Akcja, Kryminał"), ("Neonowa obsesja", 2016, 121, "Akcja, Kryminał"),
    ("Blade Runner 2049", 2017, 164, "Sci-Fi, Dramat"), ("Arrival", 2016, 116, "Sci-Fi, Dramat"),
    ("Narzeczonemu żadnej", 2015, 102, "Komedia"), ("Ex Machina", 2014, 108, "Sci-Fi, Thriller"),
    ("Moon", 2009, 97, "Sci-Fi, Dramat"), ("Grawitacja", 2013, 91, "Sci-Fi, Thriller"),
    ("Marsjanin", 2015, 144, "Sci-Fi, Przygodowy"), ("Dunkierka", 2017, 106, "Akcja, Dramat, Wojenny"),
    ("Oppenheimer", 2023, 181, "Dramat, Historyczny"), ("Zabójcy kwiatowego księżyca", 2023, 206, "Kryminał, Dramat"),
    ("Top Gun: Maverick", 2022, 130, "Akcja, Dramat"), ("Everything Everywhere All at Once", 2022, 139, "Sci-Fi, Komedia"),
    ("Banshees of Inisherin", 2022, 114, "Dramat, Komedia"), ("Fabelmans", 2022, 151, "Dramat"),
    ("Pinokio Guillermo del Toro", 2022, 117, "Animacja, Fantasy"), ("Nimona", 2023, 101, "Animacja, Przygodowy"),
    ("Przełęcz ocalałych", 2023, 108, "Dramat, Wojenny"), ("Strefa interesów", 2023, 105, "Dramat, Historyczny"),
    ("Popiół i diament", 1958, 103, "Dramat, Wojenny"), ("Noce Cabirii", 1957, 117, "Dramat"),
    ("Siódma pieczęć", 1957, 96, "Dramat, Fantasy"), ("12 gniewnych ludzi", 1957, 96, "Dramat, Kryminał"),
    ("Skrzydła desire", 1951, 122, "Dramat, Romans"), ("Okno na podwórze", 1954, 112, "Kryminał, Tajemnica"),
    ("Vertigo", 1958, 128, "Kryminał, Romans"), ("Psychoza", 1960, 109, "Horror, Kryminał"),
    ("Zabójcy", 1964, 125, "Kryminał, Komedia"), ("Doktor Strangelove", 1964, 95, "Komedia, Satyra"),
    ("2001: Odyseja kosmiczna", 1968, 149, "Sci-Fi, Przygodowy"), ("Mechaniczna pomarańcza", 1971, 136, "Kryminał, Sci-Fi"),
    ("Wypadek", 1983, 104, "Romans, Dramat"), ("Blade Runner", 1982, 117, "Sci-Fi, Thriller"),
    ("Obcy - ósmy pasażer Nostromo", 1979, 117, "Horror, Sci-Fi"), ("Shining", 1980, 146, "Horror, Dramat"),
    ("E.T.", 1982, 115, "Sci-Fi, Rodzinny"), ("Powrót do przyszłości", 1985, 116, "Sci-Fi, Komedia"),
    ("Terminator", 1984, 107, "Akcja, Sci-Fi"), ("Aliens - decydujące starcie", 1986, 137, "Akcja, Sci-Fi"),
    ("Szeregowiec Ryan", 1998, 169, "Dramat, Wojenny"), ("Oskarżeni", 1988, 92, "Dramat, Romans"),
    ("Lista Schindlera", 1993, 195, "Dramat, Historyczny"), ("Forrest Gump", 1994, 142, "Dramat, Romans"),
    ("Lśnienie złota", 1997, 135, "Dramat"), ("Tytanic", 1997, 194, "Romans, Dramat"),
    ("Fargo", 1996, 98, "Kryminał, Komedia"), ("Big Lebowski", 1998, 117, "Komedia, Kryminał"),
    ("American Beauty", 1999, 122, "Dramat"), ("Zielona mila", 1999, 189, "Dramat, Fantasy"),
    ("Snatch", 2000, 104, "Kryminał, Komedia"), ("Gnijąca panna młoda", 2005, 77, "Animacja, Fantasy"),
    ("Wieczny student", 2002, 108, "Dramat, Romans"), ("Miasto Boga", 2002, 130, "Kryminał, Dramat"),
    ("Oldboy", 2003, 120, "Akcja, Kryminał"), ("Wyznania nieszkodliwych", 2004, 108, "Dramat"),
    ("Wieczny płomień", 2004, 108, "Romans, Sci-Fi"), ("Ukryte życie", 2019, 149, "Dramat, Wojenny"),
    ("Władca Pierścieni: Drużyna Pierścienia", 2001, 179, "Fantasy, Przygodowy"),
    ("Władca Pierścieni: Dwie wieże", 2002, 179, "Fantasy, Przygodowy"),
    ("Władca Pierścieni: Powrót króla", 2003, 201, "Fantasy, Przygodowy"),
    ("Mroczny rycerz", 2008, 152, "Akcja, Kryminał"), ("Batman Begins", 2005, 140, "Akcja, Kryminał"),
    ("Chiński syndrom", 2004, 99, "Komedia, Akcja"), ("Zodiak", 2007, 157, "Kryminał, Tajemnica"),
    ("Niepokorni", 2007, 151, "Akcja, Kryminał"), ("Pożegnanie z Lenino", 2001, 96, "Komedia, Dramat"),
    ("Chłopaki nie płaczą", 2000, 89, "Komedia, Akcja"), ("Sami swoi", 1967, 88, "Komedia"),
    ("Seksmisja", 1984, 117, "Komedia, Sci-Fi"), ("Miś", 1981, 105, "Komedia"),
    ("Kiler", 1997, 104, "Komedia, Kryminał"), ("Poranek kojota", 2001, 90, "Komedia"),
    ("Dzień świra", 2002, 82, "Animacja, Dramat"), ("Życie jako śmiertelna choroba przenoszona drogą płciową", 2000, 124, "Dramat"),
    ("Wściekłość", 2014, 119, "Akcja, Sci-Fi"), ("Król Lew", 1994, 88, "Animacja, Przygodowy"),
    ("Ratatuj mnie", 2007, 96, "Animacja, Rodzinny"), ("WALL-E", 2008, 98, "Animacja, Rodzinny"),
    ("Up - przestrzeń przygód", 2009, 96, "Animacja, Przygodowy"), ("Głowa do góry", 2020, 100, "Animacja, Rodzinny"),
    ("Coco", 2017, 105, "Animacja, Rodzinny"), ("Kubo i dwie struny", 2016, 101, "Animacja, Przygodowy"),
    ("Diuna", 2021, 155, "Sci-Fi, Przygodowy"), ("Diuna: Część druga", 2024, 166, "Sci-Fi, Przygodowy"),
    ("Mała Lampa", 2019, 127, "Dramat"), ("Kobiety w rozpaczy", 2015, 100, "Dramat, Romans"),
    ("Księga dżungli", 2016, 106, "Przygodowy, Rodzinny"), ("Kajaki", 2013, 106, "Dramat, Komedia"),
    ("Body/Ciało", 2015, 115, "Dramat"), ("Ostatnia rodzina", 2016, 104, "Dramat, Biograficzny"),
    ("Plaża", 2000, 100, "Przygodowy, Dramat"), ("Pi life of", 2012, 127, "Przygodowy, Dramat"),
    ("Skazany na bluesa", 2005, 110, "Biograficzny, Dramat"), ("Boisko do pikniku", 2011, 103, "Dramat"),
]

# (tytuł, rok, sezony, [liczba odcinków per sezon], gatunki) — seriale
SERIES_OFFLINE = [
    ("Breaking Bad", 2008, 5, [7, 13, 13, 13, 16], "Dramat, Kryminał"),
    ("Detektyw Bruno", 2014, 4, [8, 8, 8, 8], "Kryminał, Dramat"),
    ("Gra o tron", 2011, 8, [10, 10, 10, 10, 10, 10, 7, 6], "Fantasy, Dramat"),
    ("Chernobyl", 2019, 1, [5], "Dramat, Historyczny"),
    ("Czarnobyl. Reaktor nr 4", 2020, 1, [4], "Dramat"),
    ("Rodzina Soprano", 1999, 6, [13, 13, 13, 13, 13, 21], "Dramat, Kryminał"),
    ("Dr House", 2004, 8, [11, 18, 16, 16, 18, 16, 16, 16], "Dramat, Medyczny"),
    ("Wiedźmin", 2019, 3, [8, 8, 8], "Fantasy, Przygodowy"),
    ("Czarne lustro", 2011, 6, [3, 4, 6, 6, 6, 5], "Sci-Fi, Antologia"),
    ("Zachowane", 2016, 4, [8, 8, 8, 8], "Dramat, Sci-Fi"),
    ("Westworld", 2016, 4, [10, 10, 8, 8], "Sci-Fi, Western"),
    ("Gracze", 2020, 3, [9, 8, 9], "Dramat, Komedia"),
    ("Rozdział czwarty", 2019, 3, [8, 8, 8], "Dramat, Kryminał"),
    ("Mroczne zaginięcia", 2017, 3, [10, 8, 8], "Sci-Fi, Tajemnica"),
    ("Rzymskie porachunki", 2021, 2, [8, 8], "Dramat, Historyczny"),
    ("Ted Lasso", 2020, 3, [10, 12, 12], "Komedia, Sport"),
    ("Severance", 2022, 2, [9, 10], "Thriller, Sci-Fi"),
    ("Ostatni z nas", 2023, 2, [9, 7], "Dramat, Horror"),
    ("Mediateka", 2021, 4, [6, 6, 6, 7], "Satyra, Komedia"),
    ("Poker Face", 2023, 2, [10, 12], "Kryminał, Komedia"),
    ("Bear", 2022, 4, [8, 10, 10, 10], "Dramat, Komedia"),
    ("Sukcesja", 2018, 4, [10, 10, 9, 10], "Dramat"),
    ("Fleabag", 2016, 2, [6, 6], "Komedia, Dramat"),
    ("Sherlock", 2010, 4, [3, 3, 3, 3], "Kryminał, Tajemnica"),
    ("Peaky Blinders", 2013, 6, [6, 6, 6, 6, 6, 6], "Kryminał, Dramat"),
    ("Prawdziwy detektyw", 2014, 4, [8, 8, 8, 6], "Kryminał, Dramat"),
    ("Mr. Robot", 2015, 4, [10, 12, 10, 13], "Dramat, Technothriller"),
    ("Dzicy, dziksi", 2021, 3, [8, 8, 8], "Dramat, Romans"),
    ("Boska komedia", 2019, 2, [10, 10], "Fantasy, Komedia"),
    ("Mindhunter", 2017, 2, [10, 9], "Kryminał, Dramat"),
    ("Maniac", 2018, 1, [10], "Komedia, Sci-Fi"),
    ("Devs", 2020, 1, [8], "Sci-Fi, Thriller"),
    ("Station Eleven", 2021, 1, [10], "Dramat, Sci-Fi"),
    ("Andor", 2022, 2, [12, 12], "Sci-Fi, Szpiegowski"),
    ("Mandalorian", 2019, 4, [8, 8, 8, 8], "Sci-Fi, Przygodowy"),
    ("Arcane", 2021, 2, [9, 9], "Animacja, Akcja"),
    ("Cyberpunk: Edgerunners", 2022, 1, [10], "Animacja, Akcja"),
    ("Attack on Titan", 2013, 4, [25, 12, 16, 28], "Anime, Akcja"),
    ("Death Note", 2006, 1, [37], "Anime, Thriller"),
    ("Fullmetal Alchemist: Brotherhood", 2009, 1, [64], "Anime, Przygodowy"),
    ("Czarnobylskie lato", 2018, 2, [6, 6], "Dramat, Tajemnica"),
    ("1670", 2023, 2, [8, 8], "Komedia, Historyczna"),
    ("Wielka wodna historia", 2022, 1, [5], "Dramat, Katastroficzny"),
    ("Absolutni debiutanci", 2016, 3, [8, 8, 8], "Dramat, Młodzieżowy"),
    ("Pakt", 2015, 2, [8, 8], "Dramat, Kryminał"),
    ("Belfer", 2016, 3, [8, 8, 8], "Kryminał, Dramat"),
    ("Kruk", 2018, 2, [8, 8], "Dramat, Kryminał"),
    ("Sexify", 2021, 2, [8, 8], "Komedia, Dramat"),
    ("Wataha", 2014, 3, [8, 6, 6], "Kryminał, Thriller"),
    ("Detektyw Brunner", 2015, 2, [13, 13], "Kryminał, Komedia"),
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generuje syntetyczną bazę demo CineLog")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--tmdb-key", default="", help="opcjonalny klucz TMDb (pobierze tytuły+postery)")
    return parser.parse_args()


def load_tmdb_key_from_env() -> str:
    env_file = ROOT / ".env"
    if not env_file.exists():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("TMDB_API_KEY="):
            return line.split("=", 1)[1].strip().strip("'\"")
    return ""


def tmdb_get(path: str, params: dict, api_key: str) -> dict | None:
    query = dict(params)
    query["api_key"] = api_key
    url = f"https://api.themoviedb.org/3{path}?{urllib.parse.urlencode(query)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "CineLog-demo-generator/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"TMDb error ({path}): {e}")
        return None


def collect_titles_from_tmdb(api_key: str) -> tuple[list, list]:
    movies: list = []
    series: list = []
    seen_ids: set = set()
    for page in range(1, 17):
        data = tmdb_get("/discover/movie", {
            "sort_by": "popularity.desc", "page": page,
            "vote_count.gte": 400, "language": "pl-PL",
        }, api_key) or {}
        for it in data.get("results", []):
            if it["id"] in seen_ids or not it.get("release_date"):
                continue
            seen_ids.add(it["id"])
            movies.append({
                "title": it.get("title") or it.get("original_title"),
                "year": int(it["release_date"][:4]),
                "runtime": it.get("runtime") or 105,
                "genres": ", ".join(str(g) for g in it.get("genre_names", []) or []),
                "tmdb_id": it["id"],
                "poster_path": it.get("poster_path") or "",
            })
    seen_ids.clear()
    for page in range(1, 9):
        data = tmdb_get("/discover/tv", {
            "sort_by": "popularity.desc", "page": page, "language": "pl-PL",
        }, api_key) or {}
        for it in data.get("results", []):
            if it["id"] in seen_ids or not it.get("first_air_date"):
                continue
            seen_ids.add(it["id"])
            seasons = max(1, min(8, it.get("number_of_seasons") or 1))
            ep_counts = [min(24, max(6, (it.get("number_of_episodes") or 8) // seasons)) for _ in range(seasons)]
            series.append({
                "title": it.get("name") or it.get("original_name"),
                "year": int(it["first_air_date"][:4]),
                "seasons": seasons,
                "ep_counts": ep_counts,
                "genres": ", ".join(str(g) for g in it.get("genre_names", []) or []),
                "tmdb_id": it["id"],
                "poster_path": it.get("poster_path") or "",
            })
    return movies, series


def offline_catalog() -> tuple[list, list]:
    movies = [
        {"title": t, "year": y, "runtime": rt, "genres": g, "tmdb_id": None, "poster_path": ""}
        for (t, y, rt, g) in MOVIES_OFFLINE
    ]
    series = [
        {"title": t, "year": y, "seasons": s, "ep_counts": ec, "genres": g, "tmdb_id": None, "poster_path": ""}
        for (t, y, s, ec, g) in SERIES_OFFLINE
    ]
    return movies, series


def poster_url(poster_path: str) -> str:
    return f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else ""


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


def pick_status(rng: random.Random) -> str:
    roll = rng.random()
    if roll < 0.66:
        return "watched"
    if roll < 0.88:
        return "watchlist"
    return "followed"


def past_timestamp(rng: random.Random, max_days_back: int = 900) -> str:
    days = rng.randint(1, max_days_back)
    hour = rng.choices(range(8, 24), weights=[2] * 9 + [6, 7, 8, 8, 7, 6, 4])[0]
    dt = datetime.now() - timedelta(days=days)
    dt = dt.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))
    return dt.strftime(FMT)


def make_movie(rng: random.Random, entry: dict) -> dict:
    status = pick_status(rng)
    rating = pick_rating(rng) if status == "watched" else None
    watch_date = past_timestamp(rng) if status == "watched" else None
    follow_date = past_timestamp(rng, 400)
    created = watch_date or follow_date
    year = entry["year"]
    return {
        "uuid": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
        "tmdb_id": entry.get("tmdb_id"),
        "imdb_id": None,
        "title": entry["title"],
        "original_title": entry["title"],
        "year": str(year),
        "genre": entry["genres"],
        "director": "",
        "cast": [],
        "plot": "",
        "runtime": entry.get("runtime") or 105,
        "poster_url": poster_url(entry.get("poster_path", "")),
        "rating": rating,
        "status": status,
        "watch_date": watch_date,
        "follow_date": follow_date,
        "release_date": f"{year}-01-01" if year else None,
        "is_favorite": bool(status == "watched" and rng.random() < 0.09),
        "rewatched": 0,
        "created_at": created,
        "updated_at": created,
        "user_date": created.split(" ")[0] if created else None,
    }


def make_series(rng: random.Random, entry: dict) -> dict:
    status_roll = rng.random()
    if status_roll < 0.38:
        status = "watching"
    elif status_roll < 0.66:
        status = "watched"
    elif status_roll < 0.86:
        status = "watchlist"
    else:
        status = "followed"

    season_ep_counts = {str(i + 1): n for i, n in enumerate(entry["ep_counts"])}
    episodes: list[dict] = []

    if status in ("watching", "watched"):
        total_seasons = entry["seasons"]
        last_season = total_seasons if status == "watched" else rng.randint(1, max(1, total_seasons))
        start_day = rng.randint(30, 700)
        day_cursor = datetime.now() - timedelta(days=start_day)
        for season in range(1, last_season + 1):
            ep_total = season_ep_counts[str(season)]
            if status == "watching" and season == last_season:
                ep_total = rng.randint(1, max(1, ep_total))
            for ep in range(1, ep_total + 1):
                day_cursor += timedelta(days=rng.randint(1, 3))
                hour = rng.choices([19, 20, 21, 22, 23], weights=[3, 5, 6, 4, 2])[0]
                ts = day_cursor.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))
                episodes.append({
                    "episode_id": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
                    "season": season,
                    "episode": ep,
                    "created_at": ts.strftime(FMT),
                })

    highest_s = max((e["season"] for e in episodes), default=0)
    highest_e = max((e["episode"] for e in episodes if e["season"] == highest_s), default=0)

    created = episodes[0]["created_at"] if episodes else past_timestamp(rng, 500)
    updated = episodes[-1]["created_at"] if episodes else created

    return {
        "uuid": str(uuid.UUID(int=rng.getrandbits(128), version=4)),
        "title": entry["title"],
        "original_title": entry["title"],
        "year": str(entry["year"]),
        "genre": entry["genres"],
        "poster_url": poster_url(entry.get("poster_path", "")),
        "plot": "",
        "cast": [],
        "director": "",
        "total_seasons": entry["seasons"],
        "season_ep_counts": season_ep_counts,
        "episodes_watched": episodes,
        "watched_count": len(episodes),
        "latest_progress": f"S{highest_s:02d}E{highest_e:02d}" if highest_s else None,
        "latest_season": highest_s or None,
        "latest_episode": highest_e or None,
        "rating": pick_rating(rng) if status == "watched" else (pick_rating(rng) if status == "watching" and rng.random() < 0.5 else None),
        "status": status,
        "tmdb_id": entry.get("tmdb_id"),
        "imdb_id": None,
        "created_at": created,
        "updated_at": updated,
    }


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)

    api_key = args.tmdb_key or load_tmdb_key_from_env()
    if api_key:
        print("TMDb: pobieram popularne tytuły...")
        movie_entries, series_entries = collect_titles_from_tmdb(api_key)
    if not api_key or not movie_entries:
        print("TMDb niedostępny - używam wbudowanego katalogu offline.")
        movie_entries, series_entries = offline_catalog()

    rng.shuffle(movie_entries)
    rng.shuffle(series_entries)

    movies = [make_movie(rng, e) for e in movie_entries]
    shows = [make_series(rng, e) for e in series_entries]

    movies_backup = json.loads(json.dumps(movies, ensure_ascii=False))
    shows_backup = json.loads(json.dumps(shows, ensure_ascii=False))

    outputs = {
        ROOT / "data" / "movies_parsed.json": movies,
        ROOT / "data" / "shows_parsed.json": shows,
        ROOT / "data" / "movies_backup.json": movies_backup,
        ROOT / "data" / "shows_backup.json": shows_backup,
        ROOT / "data" / "vod_cache.json": {},
        ROOT / "data" / "upcoming_cache.json": {},
        ROOT / "static" / "data" / "movies_parsed.json": movies,
        ROOT / "static" / "data" / "shows_parsed.json": shows,
    }
    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{path.relative_to(ROOT)}: {len(payload)} wpisów")

    watched_movies = sum(1 for m in movies if m["status"] == "watched")
    rated = sum(1 for m in movies if m["rating"])
    print(f"\nPodsumowanie: {len(movies)} filmów ({watched_movies} obejrzanych, {rated} z oceną), "
          f"{len(shows)} seriali, seed={args.seed}, źródło={'TMDb' if api_key and movie_entries else 'offline'}")


if __name__ == "__main__":
    main()
