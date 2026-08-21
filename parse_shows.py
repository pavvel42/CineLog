import zipfile
import csv
import io
import json
import os
import uuid
import re

ZIP_PATH = os.path.join("export data", "gdpr-data.zip")
OUTPUT_PATH = os.path.join("export data", "shows_parsed.json")
BACKUP_PATH = os.path.join("export data", "shows_backup.json")

# Preserve existing poster mappings if already fetched
def load_existing_posters():
    posters = {}
    if os.path.exists(OUTPUT_PATH):
        try:
            with open(OUTPUT_PATH, "r", encoding="utf-8") as f:
                for s in json.load(f):
                    if s.get("poster_url"):
                        posters[s["title"]] = s["poster_url"]
        except Exception:
            pass
    return posters

def parse_shows():
    if not os.path.exists(ZIP_PATH):
        print(f"Error: {ZIP_PATH} not found.")
        return []

    existing_posters = load_existing_posters()
    shows = {}

    with zipfile.ZipFile(ZIP_PATH, "r") as z:
        # 1. Parse followed TV shows (base list)
        if "followed_tv_show.csv" in z.namelist():
            with z.open("followed_tv_show.csv") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="ignore"))
                for row in reader:
                    title = row.get("tv_show_name", "").strip()
                    if not title:
                        continue
                    shows[title] = {
                        "uuid": str(uuid.uuid4()),
                        "show_id": row.get("tv_show_id"),
                        "title": title,
                        "created_at": row.get("created_at"),
                        "updated_at": row.get("updated_at"),
                        "active": row.get("active") == "1",
                        "archived": row.get("archived") == "1",
                        "rating": None,
                        "poster_url": existing_posters.get(title),
                        "episodes_watched": []
                    }

        # 2. Parse all watched episodes from tracking-prod-records-v2.csv (Primary tracking source)
        if "tracking-prod-records-v2.csv" in z.namelist():
            with z.open("tracking-prod-records-v2.csv") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="ignore"))
                for row in reader:
                    title = row.get("series_name", "").strip()
                    s_num_str = row.get("season_number") or row.get("s_no")
                    e_num_str = row.get("episode_number") or row.get("ep_no")
                    if not title or not s_num_str or not e_num_str:
                        continue
                    try:
                        s_num = int(s_num_str)
                        e_num = int(e_num_str)
                    except ValueError:
                        continue

                    if title not in shows:
                        shows[title] = {
                            "uuid": str(uuid.uuid4()),
                            "show_id": row.get("s_id"),
                            "title": title,
                            "created_at": row.get("created_at"),
                            "updated_at": row.get("updated_at"),
                            "active": True,
                            "archived": False,
                            "rating": None,
                            "poster_url": existing_posters.get(title),
                            "episodes_watched": []
                        }

                    shows[title]["episodes_watched"].append({
                        "episode_id": row.get("ep_id") or str(uuid.uuid4()),
                        "season": s_num,
                        "episode": e_num,
                        "created_at": row.get("created_at"),
                        "runtime": int(row.get("runtime") or 0)
                    })

        # 3. Parse all watched episodes from tracking-prod-records.csv (Fallback tracking source)
        if "tracking-prod-records.csv" in z.namelist():
            with z.open("tracking-prod-records.csv") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="ignore"))
                for row in reader:
                    title = row.get("series_name", "").strip()
                    s_num_str = row.get("season_number")
                    e_num_str = row.get("episode_number")
                    if not title or not s_num_str or not e_num_str:
                        continue
                    try:
                        s_num = int(s_num_str)
                        e_num = int(e_num_str)
                    except ValueError:
                        continue

                    if title not in shows:
                        shows[title] = {
                            "uuid": str(uuid.uuid4()),
                            "show_id": row.get("series_id"),
                            "title": title,
                            "created_at": row.get("created_at"),
                            "updated_at": row.get("updated_at"),
                            "active": True,
                            "archived": False,
                            "rating": None,
                            "poster_url": existing_posters.get(title),
                            "episodes_watched": []
                        }

                    shows[title]["episodes_watched"].append({
                        "episode_id": row.get("episode_id") or str(uuid.uuid4()),
                        "season": s_num,
                        "episode": e_num,
                        "created_at": row.get("created_at"),
                        "runtime": int(row.get("runtime") or 0)
                    })

        # 4. Parse ratings from tv_show_rate.csv
        if "tv_show_rate.csv" in z.namelist():
            with z.open("tv_show_rate.csv") as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8", errors="ignore"))
                for row in reader:
                    title = row.get("tv_show_name", "").strip()
                    if title in shows and row.get("rating"):
                        try:
                            shows[title]["rating"] = int(row.get("rating"))
                        except ValueError:
                            pass

    shows_list = []
    for s in shows.values():
        eps = s["episodes_watched"]
        # Deduplicate watched episodes by (season, episode)
        unique_eps = {}
        for ep in eps:
            key = (ep["season"], ep["episode"])
            if key not in unique_eps:
                unique_eps[key] = ep
            elif ep.get("created_at") and (not unique_eps[key].get("created_at") or ep["created_at"] > unique_eps[key]["created_at"]):
                unique_eps[key] = ep

        sorted_eps = sorted(unique_eps.values(), key=lambda x: (x["season"], x["episode"]))
        s["episodes_watched"] = sorted_eps
        s["watched_count"] = len(sorted_eps)

        if sorted_eps:
            highest_s = max(e["season"] for e in sorted_eps)
            highest_e = max(e["episode"] for e in sorted_eps if e["season"] == highest_s)
            s["latest_progress"] = f"S{highest_s:02d}E{highest_e:02d}"
            s["latest_season"] = highest_s
            s["latest_episode"] = highest_e
            s["status"] = "watching" if not s["archived"] else "archived"
        else:
            s["latest_progress"] = None
            s["latest_season"] = 0
            s["latest_episode"] = 0
            s["status"] = "watchlist" if not s["archived"] else "archived"

        shows_list.append(s)

    # Sort shows: most watched first, then alphabetical
    shows_list.sort(key=lambda x: (-x["watched_count"], x["title"].lower()))

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(shows_list, f, ensure_ascii=False, indent=2)

    with open(BACKUP_PATH, "w", encoding="utf-8") as f:
        json.dump(shows_list, f, ensure_ascii=False, indent=2)

    total_eps_count = sum(s["watched_count"] for s in shows_list)
    print(f"Parsed {len(shows_list)} TV shows with a total of {total_eps_count} watched episodes! Saved to {OUTPUT_PATH}")
    return shows_list

if __name__ == "__main__":
    parse_shows()
