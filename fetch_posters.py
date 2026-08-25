import json
import os
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

MOVIES_FILE = os.path.join("data", "movies_parsed.json")
BACKUP_FILE = os.path.join("data", "movies_backup.json")

TITLE_ALIASES = {
    "Den Sidste Viking": "The Last Viking",
    "W lesie dziś nie zaśnie nikt": "Nobody Sleeps in the Woods Tonight",
    "Sala samobójców": "Suicide Room",
    "365 dni": "365 Days",
    "기생충": "Parasite",
    "살인의 추억": "Memories of Murder",
    "대홍水": "The Great Flood",
    "대홍수": "The Great Flood",
    "옥자": "Okja",
    "流浪地球": "The Wandering Earth",
    "ドライブ・マイ・カー": "Drive My Car",
    "पैड मैन": "Pad Man",
    "Retfærdighedens ryttere": "Riders of Justice",
    "Im Westen nichts Neues": "All Quiet on the Western Front",
    "Wolkenbruchs wunderliche Reise in die Arme einer Schickse": "The Awakening of Motti Wolkenbruch",
    "8 Rue de l'Humanité": "Stuck Together",
    "Van Gogh. U bram wieczności": "At Eternity's Gate",
    "Bardo, falsa crónica de unas cuantas verdades": "Bardo: False Chronicle of a Handful of Truths",
    "Los renglones torcidos de Dios": "God's Crooked Lines",
    "Kağıttan Hayatlar": "Paper Lives",
    "Relatos salvajes": "Wild Tales",
    "Aterrados": "Terrified",
    "Borat Subsequent Moviefilm: Delivery of Prodigious Bribe To American Regime For Make Benefit Once Glorious Nation of Kazakhstan": "Borat Subsequent Moviefilm",
    "Guy Ritchie's The Covenant": "The Covenant",
    "Rebel Moon Part 1: A Child of Fire": "Rebel Moon",
    "Apocalipsis Z: El principio del fin": "Apocalypse Z: The Beginning of the End",
    "La Fiebre de Los Ricos": "Rich Flu"
}

def verify_url_live(url):
    if not url or url == "N/A":
        return False
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
    })
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status == 200
    except Exception:
        return False

OMDB_API_KEY = os.environ.get("OMDB_API_KEY", "").strip() or os.environ.get("IMDB_API_KEY", "").strip()

def get_poster_omdb(title, expected_year):
    if not OMDB_API_KEY:
        return None
    titles_to_try = [title]
    if TITLE_ALIASES.get(title):
        titles_to_try.append(TITLE_ALIASES[title])

    # 1. Search with title + year
    for t in titles_to_try:
        url = f"https://www.omdbapi.com/?apikey={OMDB_API_KEY}&t={urllib.parse.quote(t)}"
        if expected_year:
            url += f"&y={expected_year}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                poster = data.get("Poster")
                res_year_str = data.get("Year", "")[:4]
                if poster and poster != "N/A" and verify_url_live(poster):
                    if expected_year and res_year_str.isdigit():
                        if abs(expected_year - int(res_year_str)) <= 3:
                            return poster
                    else:
                        return poster
        except Exception:
            pass

    # 2. Search query without year if strict failed
    for t in titles_to_try:
        url = f"https://www.omdbapi.com/?apikey={OMDB_API_KEY}&t={urllib.parse.quote(t)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                poster = data.get("Poster")
                res_year_str = data.get("Year", "")[:4]
                if poster and poster != "N/A" and verify_url_live(poster):
                    if expected_year and res_year_str.isdigit():
                        if abs(expected_year - int(res_year_str)) <= 3:
                            return poster
                    else:
                        return poster
        except Exception:
            pass

    return None

def get_poster_itunes(title, expected_year):
    titles_to_try = [title]
    if TITLE_ALIASES.get(title):
        titles_to_try.append(TITLE_ALIASES[title])

    countries = ["DK", "US", "PL", "GB", "FR", "DE"]
    for t in titles_to_try:
        query = f"{t} {expected_year}".strip() if expected_year else t
        for country in countries:
            url = f"https://itunes.apple.com/search?term={urllib.parse.quote(query)}&country={country}&media=movie&limit=3"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            try:
                with urllib.request.urlopen(req, timeout=3) as resp:
                    data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                    for r in data.get("results", []):
                        art = r.get("artworkUrl100")
                        rel_date = r.get("releaseDate", "")[:4]
                        if art and rel_date.isdigit() and expected_year:
                            if abs(expected_year - int(rel_date)) <= 3:
                                art_high = art.replace("100x100bb.jpg", "600x600bb.jpg")
                                if verify_url_live(art_high):
                                    return art_high
                                if verify_url_live(art):
                                    return art
            except Exception:
                pass
    return None

def process_movie(movie):
    title = movie.get("title", "").strip()
    if not title:
        return movie, None

    rel_date = movie.get("release_date", "")
    expected_year = None
    if rel_date and not rel_date.startswith("0001"):
        try:
            expected_year = int(rel_date.split("-")[0])
        except ValueError:
            pass

    current_poster = movie.get("poster_url")

    # If title has alias (like Den Sidste Viking -> The Last Viking), force re-check with year!
    if title in TITLE_ALIASES:
        poster = get_poster_omdb(title, expected_year) or get_poster_itunes(title, expected_year)
        if poster:
            return movie, poster

    # Verify if current poster works live 200 OK
    if current_poster and verify_url_live(current_poster):
        return movie, current_poster

    poster = get_poster_omdb(title, expected_year) or get_poster_itunes(title, expected_year)
    return movie, poster

def main():
    if not os.path.exists(MOVIES_FILE):
        print("movies_parsed.json not found.")
        return

    with open(MOVIES_FILE, "r", encoding="utf-8") as f:
        movies = json.load(f)

    # Filter out empty titles
    movies = [m for m in movies if m.get("title", "").strip()]

    print(f"Loaded {len(movies)} movies. Running year-strict poster resolution...")

    updated_count = 0
    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(process_movie, m) for m in movies]
        for future in as_completed(futures):
            m, poster = future.result()
            m["poster_url"] = poster
            if poster:
                updated_count += 1

    with open(MOVIES_FILE, "w", encoding="utf-8") as f:
        json.dump(movies, f, ensure_ascii=False, indent=2)

    with open(BACKUP_FILE, "w", encoding="utf-8") as f:
        json.dump(movies, f, ensure_ascii=False, indent=2)

    print(f"DONE! Year-strict posters verified for {updated_count}/{len(movies)} movies!")

if __name__ == "__main__":
    main()
