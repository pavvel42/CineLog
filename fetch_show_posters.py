import json
import os
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

SHOWS_FILE = os.path.join("export data", "shows_parsed.json")
BACKUP_FILE = os.path.join("export data", "shows_backup.json")

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

def get_show_poster_omdb(title):
    if not OMDB_API_KEY:
        return None
    # 1. Direct type=series
    url = f"https://www.omdbapi.com/?apikey={OMDB_API_KEY}&t={urllib.parse.quote(title)}&type=series"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            p = data.get("Poster")
            if p and p != "N/A" and verify_url_live(p):
                return p
    except Exception:
        pass

    # 2. General title search
    url2 = f"https://www.omdbapi.com/?apikey={OMDB_API_KEY}&t={urllib.parse.quote(title)}"
    req2 = urllib.request.Request(url2, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req2, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            p = data.get("Poster")
            if p and p != "N/A" and verify_url_live(p):
                return p
    except Exception:
        pass

    return None

def get_show_poster_itunes(title):
    countries = ["US", "PL", "GB"]
    for c in countries:
        url = f"https://itunes.apple.com/search?term={urllib.parse.quote(title)}&country={c}&media=tvShow&limit=1"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                res = data.get("results", [])
                if res and res[0].get("artworkUrl100"):
                    art = res[0]["artworkUrl100"].replace("100x100bb.jpg", "600x600bb.jpg")
                    if verify_url_live(art):
                        return art
                    art_orig = res[0]["artworkUrl100"]
                    if verify_url_live(art_orig):
                        return art_orig
        except Exception:
            pass
    return None

def get_show_poster_wikipedia(title):
    for lang in ["en", "pl"]:
        url = f"https://{lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch={urllib.parse.quote(title)}%20TV%20series&prop=pageimages&pithumbsize=600&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "CineLog/1.0 (https://github.com/pavvel42/CineLog)"})
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read().decode("utf-8", errors="ignore"))
                pages = data.get("query", {}).get("pages", {})
                for pid, p in pages.items():
                    if "thumbnail" in p and p["thumbnail"].get("source"):
                        src = p["thumbnail"]["source"]
                        if verify_url_live(src):
                            return src
        except Exception:
            pass
    return None

def process_show(show):
    title = show.get("title", "").strip()
    if not title:
        return show, None

    poster = get_show_poster_omdb(title) or get_show_poster_itunes(title) or get_show_poster_wikipedia(title)
    return show, poster

def main():
    if not os.path.exists(SHOWS_FILE):
        print("shows_parsed.json not found.")
        return

    with open(SHOWS_FILE, "r", encoding="utf-8") as f:
        shows = json.load(f)

    print(f"Loaded {len(shows)} TV shows. Fetching and verifying official posters...")

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(process_show, s) for s in shows]
        found = 0
        for future in as_completed(futures):
            s, poster = future.result()
            s["poster_url"] = poster
            if poster:
                found += 1

    with open(SHOWS_FILE, "w", encoding="utf-8") as f:
        json.dump(shows, f, ensure_ascii=False, indent=2)

    with open(BACKUP_FILE, "w", encoding="utf-8") as f:
        json.dump(shows, f, ensure_ascii=False, indent=2)

    print(f"DONE! Posters retrieved for {found}/{len(shows)} TV shows!")

if __name__ == "__main__":
    main()
