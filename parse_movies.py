import zipfile
import csv
import io
import re
import json

def parse_objects(objects_str):
    if not objects_str:
        return []
    # Parse map string like "[map[created_at:1.566911274e+09 type:movie uuid:1be8d227-5d39-4561-8dfa-7520b8c51d0f] ...]"
    return re.findall(r"uuid:([a-f0-9\-]+)", objects_str)

def get_rating_value(vote_key):
    if not vote_key:
        return None
    suffix = vote_key.split("-")[-1]
    # Suffixes are typically '1', '3', '27', '28', '29'
    # We will map:
    # '1' -> 1
    # '3' -> 2
    # '27' -> 3
    # '28' -> 4
    # '29' -> 5
    mapping = {
        '1': 1,
        '3': 2,
        '27': 3,
        '28': 4,
        '29': 5
    }
    return mapping.get(suffix, None)

def main():
    zip_path = "export data/gdpr-data.zip"
    
    movies = {}
    favorite_uuids = set()
    ratings_by_movie = {}
    
    with zipfile.ZipFile(zip_path) as z:
        # 1. Parse favorite movies
        with z.open("lists-prod-lists.csv") as f:
            reader = csv.DictReader(io.StringIO(f.read().decode("utf-8", errors="ignore")))
            for row in reader:
                if row.get("s_key") == "favorite-movies":
                    fav_uuids = parse_objects(row.get("objects"))
                    favorite_uuids.update(fav_uuids)
                    
        # 2. Parse ratings
        # Live votes
        with z.open("ratings-live-votes.csv") as f:
            reader = csv.DictReader(io.StringIO(f.read().decode("utf-8", errors="ignore")))
            for row in reader:
                movie_name = row.get("movie_name")
                vote_key = row.get("vote_key")
                uuid = row.get("uuid")
                rating = get_rating_value(vote_key)
                if movie_name and rating:
                    ratings_by_movie[movie_name] = {
                        "rating": rating,
                        "uuid": uuid,
                        "raw_suffix": vote_key.split("-")[-1] if vote_key else None
                    }
                    
        # V2 votes
        with z.open("ratings-v2-prod-votes.csv") as f:
            reader = csv.DictReader(io.StringIO(f.read().decode("utf-8", errors="ignore")))
            for row in reader:
                movie_name = row.get("movie_name")
                vote_key = row.get("vote_key")
                uuid = row.get("uuid")
                rating = get_rating_value(vote_key)
                if movie_name and rating:
                    ratings_by_movie[movie_name] = {
                        "rating": rating,
                        "uuid": uuid,
                        "raw_suffix": vote_key.split("-")[-1] if vote_key else None
                    }

        # 3. Parse tracking records
        with z.open("tracking-prod-records.csv") as f:
            reader = csv.DictReader(io.StringIO(f.read().decode("utf-8", errors="ignore")))
            for row in reader:
                if row.get("entity_type") != "movie":
                    continue
                uuid = row.get("uuid")
                movie_name = row.get("movie_name")
                m_type = row.get("type") # follow, watch, towatch, rewatch_count
                created_at = row.get("created_at")
                release_date = row.get("release_date")
                
                if not uuid:
                    continue
                
                if uuid not in movies:
                    movies[uuid] = {
                        "uuid": uuid,
                        "title": movie_name,
                        "status": "followed",
                        "watch_date": None,
                        "follow_date": None,
                        "release_date": None,
                        "is_favorite": False,
                        "rating": None,
                        "raw_rating_suffix": None,
                        "rewatched": 0
                    }
                
                m = movies[uuid]
                if movie_name and not m["title"]:
                    m["title"] = movie_name
                    
                if release_date and release_date != "0001-01-01 00:00:00" and not m["release_date"]:
                    m["release_date"] = release_date.split(" ")[0]
                    
                if m_type == "watch":
                    m["status"] = "watched"
                    m["watch_date"] = created_at
                elif m_type == "towatch":
                    if m["status"] != "watched":
                        m["status"] = "watchlist"
                elif m_type == "follow":
                    m["follow_date"] = created_at
                elif m_type == "rewatch_count":
                    m["rewatched"] += 1
        
        # 4. Fill in favorites and ratings
        for uuid, m in movies.items():
            if uuid in favorite_uuids:
                m["is_favorite"] = True
            
            title = m["title"]
            if title in ratings_by_movie:
                m["rating"] = ratings_by_movie[title]["rating"]
                m["raw_rating_suffix"] = ratings_by_movie[title]["raw_suffix"]
                
    # Save output
    output_path = "export data/movies_parsed.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(list(movies.values()), f, ensure_ascii=False, indent=2)
        
    print(f"Parsed {len(movies)} unique movies. Saved to {output_path}.")
    print("Sample movie:")
    sample = list(movies.values())[0]
    print(json.dumps(sample, indent=2, ensure_ascii=False))

if __name__ == "__main__":
    main()
