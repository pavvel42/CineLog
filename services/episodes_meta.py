"""CineLog - metadane odcinków seriali.

Źródła: TMDb (zlokalizowane nazwy/opisy, per sezon) -> TVmaze (uzupełnienie
wieloczęściowych finałów i brakujących opisów). Czysta funkcja - bez Flask.
"""

from __future__ import annotations

import json
import logging
import re
import urllib.parse
import urllib.request

from .tmdb_client import tmdb_get

log = logging.getLogger("cinelog")


def fetch_episodes_meta(clean_title: str, show_id: int | str | None, lang: str,
                        tmdb_api_key: str) -> dict:
    """Zwraca dict kluczowany 'sezon_odcinek' z nazwą, datą, czasem i opisem."""
    meta = {}

    # 1. Primary: localized episode names & synopses from TMDb
    if tmdb_api_key:
        try:
            if not show_id:
                s_data = tmdb_get(
                    "/search/tv",
                    {"query": clean_title, "language": lang},
                    api_key=tmdb_api_key,
                    timeout=4,
                )
                results = (s_data or {}).get("results") or []

                def score(r):
                    pts = 0.0
                    rn = (r.get("name") or "").lower().strip()
                    ron = (r.get("original_name") or "").lower().strip()
                    ct = clean_title.lower()
                    if rn == ct or ron == ct:
                        pts += 100.0
                    return pts

                results.sort(key=score, reverse=True)
                show_id = results[0]["id"] if results else None

            if show_id:
                det = tmdb_get(f"/tv/{show_id}", {"language": lang}, api_key=tmdb_api_key, timeout=4) or {}
                for season in det.get("seasons", []):
                    s_num = season.get("season_number")
                    if s_num is None or s_num == 0:
                        continue
                    content = tmdb_get(
                        f"/tv/{show_id}/season/{s_num}",
                        {"language": lang},
                        api_key=tmdb_api_key,
                        timeout=3,
                    )
                    for ep in (content or {}).get("episodes", []):
                        e_num = ep.get("episode_number")
                        if e_num:
                            key = f"{s_num}_{e_num}"
                            still_path = ep.get("still_path")
                            meta[key] = {
                                "season": s_num,
                                "episode": e_num,
                                "name": ep.get("name") or f"Odcinek {e_num}",
                                "airdate": ep.get("air_date"),
                                "runtime": ep.get("runtime"),
                                "summary": ep.get("overview", ""),
                                "image": f"https://image.tmdb.org/t/p/w300{still_path}" if still_path else None,
                            }
        except Exception as e:
            log.warning("TMDb episode meta error for %s: %s", clean_title, e)

    # 2. Enrich with TVmaze (fills split multi-part finales and missing descriptions)
    try:
        url_tvm = f"https://api.tvmaze.com/singlesearch/shows?q={urllib.parse.quote(clean_title)}&embed=episodes"
        req_tvm = urllib.request.Request(url_tvm, headers={"User-Agent": "CineLog/1.0"})
        with urllib.request.urlopen(req_tvm, timeout=4) as resp_tvm:
            data_tvm = json.loads(resp_tvm.read().decode("utf-8", errors="ignore"))
            eps_tvm = data_tvm.get("_embedded", {}).get("episodes", [])
            for ep_tvm in eps_tvm:
                s_n = ep_tvm.get("season")
                e_n = ep_tvm.get("number")
                if s_n is None or e_n is None:
                    continue
                key = f"{s_n}_{e_n}"
                sum_txt = re.sub(r"<[^>]+>", "", ep_tvm.get("summary") or "").strip()
                img_url = ep_tvm.get("image", {}).get("medium") if ep_tvm.get("image") else None

                if key not in meta:
                    meta[key] = {
                        "season": s_n,
                        "episode": e_n,
                        "name": ep_tvm.get("name") or f"Odcinek {e_n}",
                        "airdate": ep_tvm.get("airdate"),
                        "runtime": ep_tvm.get("runtime"),
                        "summary": sum_txt,
                        "image": img_url or (meta.get(f"{s_n}_{e_n-1}", {}).get("image")),
                    }
                elif not meta[key].get("summary") and sum_txt:
                    meta[key]["summary"] = sum_txt
                if not meta[key].get("image") and img_url:
                    meta[key]["image"] = img_url
    except Exception:
        pass

    return meta
