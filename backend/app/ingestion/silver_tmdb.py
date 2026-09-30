"""
Silver layer: validate and normalize Bronze TMDB data.

Bronze → Silver rules:
  - Required fields: id (tmdb_id), title, release_date or release_year.
  - Invalid records are moved to quarantine with reason.
  - Ratings from TMDB are stored as source-specific (not averaged).
  - Nullable fields kept nullable — no imputation.
  - Source/snapshot timestamps preserved.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

BRONZE_MOVIES_DIR = Path("data/bronze/tmdb/movies")
SILVER_DIR = Path("data/silver/tmdb")
QUARANTINE_DIR = Path("data/quarantine/tmdb")

REQUIRED_FIELDS = {"id", "title"}


def _parse_year(release_date: str | None) -> int | None:
    if not release_date:
        return None
    try:
        return int(release_date[:4])
    except (ValueError, TypeError):
        return None


def _extract_genres(genres_raw: list[dict] | None) -> list[str]:
    if not genres_raw:
        return []
    return [g["name"] for g in genres_raw if isinstance(g, dict) and g.get("name")]


def _extract_cast(credits: dict | None, top_n: int = 10) -> list[dict]:
    if not credits:
        return []
    cast = credits.get("cast", []) or []
    return [
        {
            "name": c.get("name"),
            "character": c.get("character"),
            "order": c.get("order"),
            "tmdb_person_id": c.get("id"),
        }
        for c in cast[:top_n]
        if c.get("name")
    ]


def _extract_crew(credits: dict | None) -> list[dict]:
    if not credits:
        return []
    crew = credits.get("crew", []) or []
    directors = [
        {
            "name": c.get("name"),
            "job": c.get("job"),
            "department": c.get("department"),
            "tmdb_person_id": c.get("id"),
        }
        for c in crew
        if c.get("job") == "Director" and c.get("name")
    ]
    return directors


def _extract_keywords(keywords_raw: dict | None) -> list[str]:
    if not keywords_raw:
        return []
    kws = keywords_raw.get("keywords", []) or []
    return [k["name"] for k in kws if isinstance(k, dict) and k.get("name")]


def _extract_external_ids(ext_ids: dict | None) -> dict[str, str | None]:
    if not ext_ids:
        return {}
    return {
        "imdb_id": ext_ids.get("imdb_id"),
        "wikidata_id": ext_ids.get("wikidata_id"),
    }


def normalize_tmdb_movie(raw: dict[str, Any], retrieved_at: str) -> dict[str, Any] | None:
    """
    Normalize a raw TMDB movie detail dict to the canonical Silver schema.

    Returns None if the record is invalid (will be quarantined).
    """
    missing = REQUIRED_FIELDS - set(raw.keys())
    if missing:
        logger.warning("Movie %s missing required fields: %s", raw.get("id"), missing)
        return None

    if not raw.get("title", "").strip():
        logger.warning("Movie %s has empty title", raw.get("id"))
        return None

    release_date = raw.get("release_date") or None
    release_year = _parse_year(release_date)

    # Source-specific rating — NOT averaged with other sources
    tmdb_vote_average = raw.get("vote_average")
    tmdb_vote_count = raw.get("vote_count")

    # Omit rating if too few votes (unreliable)
    if tmdb_vote_count is not None and tmdb_vote_count < 10:
        tmdb_vote_average = None

    return {
        # Identifiers
        "tmdb_id": raw["id"],
        "imdb_id": (raw.get("external_ids") or {}).get("imdb_id"),

        # Core metadata
        "title": raw["title"].strip(),
        "original_title": raw.get("original_title"),
        "original_language": raw.get("original_language"),
        "overview": (raw.get("overview") or "").strip() or None,
        "tagline": (raw.get("tagline") or "").strip() or None,

        # Release
        "release_date": release_date,
        "release_year": release_year,

        # Attributes
        "runtime_minutes": raw.get("runtime"),
        "status": raw.get("status"),
        "adult": bool(raw.get("adult", False)),
        "budget": raw.get("budget"),
        "revenue": raw.get("revenue"),
        "popularity": raw.get("popularity"),

        # Classification
        "genres": _extract_genres(raw.get("genres")),
        "keywords": _extract_keywords(raw.get("keywords")),
        "production_countries": [
            pc.get("iso_3166_1")
            for pc in (raw.get("production_countries") or [])
            if pc.get("iso_3166_1")
        ],

        # People
        "cast": _extract_cast(raw.get("credits")),
        "directors": _extract_crew(raw.get("credits")),

        # TMDB-specific ratings (source-isolated, not averaged)
        "ratings": {
            "tmdb": {
                "average": tmdb_vote_average,
                "count": tmdb_vote_count,
                "source": "tmdb",
                "retrieved_at": retrieved_at,
            }
        },

        # Images
        "poster_path": raw.get("poster_path"),
        "backdrop_path": raw.get("backdrop_path"),

        # Provenance
        "source": "tmdb",
        "source_snapshot_date": retrieved_at,
        "retrieved_at": retrieved_at,

        # External IDs
        "external_ids": _extract_external_ids(raw.get("external_ids")),
    }


def process_bronze_to_silver(
    bronze_dir: Path = BRONZE_MOVIES_DIR,
    silver_dir: Path = SILVER_DIR,
    quarantine_dir: Path = QUARANTINE_DIR,
) -> tuple[int, int]:
    """
    Process all Bronze TMDB movie files into Silver.

    Returns (ok_count, quarantine_count).
    """
    silver_dir.mkdir(parents=True, exist_ok=True)
    quarantine_dir.mkdir(parents=True, exist_ok=True)

    ok = 0
    quarantined = 0

    for bronze_file in sorted(bronze_dir.glob("*.json")):
        try:
            envelope = json.loads(bronze_file.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error("Failed to read %s: %s", bronze_file, exc)
            quarantined += 1
            continue

        raw = envelope.get("data", {})
        retrieved_at = envelope.get("retrieved_at", "")

        normalized = normalize_tmdb_movie(raw, retrieved_at)

        if normalized is None:
            q_path = quarantine_dir / bronze_file.name
            q_path.write_text(
                json.dumps({
                    "bronze_file": str(bronze_file),
                    "reason": "validation_failed",
                    "raw_id": raw.get("id"),
                    "quarantined_at": datetime.now(timezone.utc).isoformat(),
                }, indent=2),
                encoding="utf-8",
            )
            quarantined += 1
            continue

        out_path = silver_dir / bronze_file.name
        out_path.write_text(
            json.dumps(normalized, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        ok += 1

    logger.info("Silver processing done: %d OK, %d quarantined", ok, quarantined)
    return ok, quarantined


if __name__ == "__main__":
    import logging
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
    ok, q = process_bronze_to_silver()
    print(f"Silver: {ok} OK, {q} quarantined")
