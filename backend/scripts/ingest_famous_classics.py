"""
Ingest famous movies from 1950-2000 (>= 7.0 rating or highly famous/popular classics)
and acclaimed movies from 2000 onwards.
Includes canonical IMDb Top 250 icons and populates Bronze, Silver, and Gold PostgreSQL DB.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.db import async_session_factory
from backend.app.ingestion.bronze_tmdb import ingest_movie_details
from backend.app.ingestion.gold_sync import _upsert_movie
from backend.app.ingestion.silver_tmdb import normalize_tmdb_movie
from backend.app.ingestion.tmdb_client import TMDBClient
from backend.app.models.movie import Movie
from backend.app.models.movie_external_id import MovieExternalID

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")
logger = logging.getLogger("ingest_famous_classics")

SILVER_DIR = Path("data/silver/tmdb")
SILVER_DIR.mkdir(parents=True, exist_ok=True)

# Curated list of legendary IMDb Top 250 & iconic cult classics to guarantee presence
CANONICAL_ICONS = [
    "The Shawshank Redemption", "The Godfather", "The Godfather Part II", "The Dark Knight",
    "12 Angry Men", "Schindler's List", "The Lord of the Rings: The Return of the King",
    "Pulp Fiction", "The Lord of the Rings: The Fellowship of the Ring", "The Good, the Bad and the Ugly",
    "Forrest Gump", "Fight Club", "The Lord of the Rings: The Two Towers", "Inception",
    "Star Wars: Episode V - The Empire Strikes Back", "The Matrix", "Goodfellas",
    "One Flew Over the Cuckoo's Nest", "Seven", "It's a Wonderful Life", "Seven Samurai",
    "Interstellar", "The Silence of the Lambs", "Saving Private Ryan", "City of God",
    "Life Is Beautiful", "The Green Mile", "Star Wars: Episode IV - A New Hope",
    "Terminator 2: Judgment Day", "Back to the Future", "Spirited Away", "Psycho",
    "The Pianist", "Parasite", "Leon: The Professional", "The Lion King", "Gladiator",
    "American History X", "The Departed", "Whiplash", "The Prestige", "Alien",
    "Apocalypse Now", "Memento", "Raiders of the Lost Ark", "Django Unchained",
    "WALL-E", "The Lives of Others", "Sunset Boulevard", "Paths of Glory",
    "The Shining", "The Great Dictator", "Avengers: Infinity War", "Witness for the Prosecution",
    "Aliens", "Spider-Man: Into the Spider-Verse", "Inglourious Basterds", "Coco",
    "Amélie", "A Clockwork Orange", "Taxi Driver", "Lawrence of Arabia", "Double Indemnity",
    "To Kill a Mockingbird", "Eternal Sunshine of the Spotless Mind", "Full Metal Jacket",
    "2001: A Space Odyssey", "Singin' in the Rain", "Toy Story", "Braveheart",
    "Reservoir Dogs", "Citizen Kane", "M", "Requiem for a Dream", "Vertigo",
    "North by Northwest", "Amadeus", "Blade Runner", "Fargo", "No Country for Old Men",
    "There Will Be Blood", "The Big Lebowski", "The Deer Hunter", "Raging Bull",
    "Heat", "L.A. Confidential", "Casino", "The Sixth Sense", "The Truman Show",
    "Jurassic Park", "Die Hard", "The Thing", "Stand by Me", "Platoon", "Scarface",
    "Blade Runner 2049", "Dune", "Dune: Part Two", "Oppenheimer", "Poor Things",
    "Everything Everywhere All at Once", "Top Gun: Maverick", "The Batman"
]


async def collect_movie_ids(client: TMDBClient) -> set[int]:
    all_ids: set[int] = set()

    # 1. 1950 - 1999: Top Rated (vote_average >= 7.0, vote_count >= 500)
    print("🎬 Discovering 1950-1999 Classics by Rating (Pages 1-20)...")
    for page in range(1, 21):
        try:
            res = await client.discover_movies(
                page=page,
                sort_by="vote_average.desc",
                **{
                    "primary_release_date.gte": "1950-01-01",
                    "primary_release_date.lte": "1999-12-31",
                    "vote_average.gte": 7.0,
                    "vote_count.gte": 500,
                },
            )
            for m in res.get("results", []):
                if m.get("id"):
                    all_ids.add(m["id"])
        except Exception as e:
            logger.warning(f"Error on 1950-1999 rated page {page}: {e}")

    # 2. 1950 - 1999: Most Famous / High Vote Count
    print("🎬 Discovering 1950-1999 Classics by Popularity / Votes (Pages 1-20)...")
    for page in range(1, 21):
        try:
            res = await client.discover_movies(
                page=page,
                sort_by="vote_count.desc",
                **{
                    "primary_release_date.gte": "1950-01-01",
                    "primary_release_date.lte": "1999-12-31",
                    "vote_count.gte": 800,
                },
            )
            for m in res.get("results", []):
                if m.get("id"):
                    all_ids.add(m["id"])
        except Exception as e:
            logger.warning(f"Error on 1950-1999 voted page {page}: {e}")

    # 3. 2000 - 2026: Acclaimed Modern Movies (vote_average >= 7.0, vote_count >= 1000)
    print("🎬 Discovering 2000-2026 Acclaimed Cinema by Rating (Pages 1-25)...")
    for page in range(1, 26):
        try:
            res = await client.discover_movies(
                page=page,
                sort_by="vote_average.desc",
                **{
                    "primary_release_date.gte": "2000-01-01",
                    "vote_average.gte": 7.0,
                    "vote_count.gte": 1000,
                },
            )
            for m in res.get("results", []):
                if m.get("id"):
                    all_ids.add(m["id"])
        except Exception as e:
            logger.warning(f"Error on 2000+ rated page {page}: {e}")

    # 4. 2000 - 2026: Most Watched & Celebrated Modern Hits
    print("🎬 Discovering 2000-2026 Acclaimed Cinema by Popularity (Pages 1-25)...")
    for page in range(1, 26):
        try:
            res = await client.discover_movies(
                page=page,
                sort_by="vote_count.desc",
                **{
                    "primary_release_date.gte": "2000-01-01",
                    "vote_count.gte": 1200,
                },
            )
            for m in res.get("results", []):
                if m.get("id"):
                    all_ids.add(m["id"])
        except Exception as e:
            logger.warning(f"Error on 2000+ voted page {page}: {e}")

    # 5. Search canonical icons
    print(f"🎬 Searching {len(CANONICAL_ICONS)} canonical IMDb top titles...")
    for title in CANONICAL_ICONS:
        try:
            res = await client._get("/search/movie", query=title)
            results = res.get("results", [])
            if results and results[0].get("id"):
                all_ids.add(results[0]["id"])
        except Exception as e:
            logger.warning(f"Error searching canonical title '{title}': {e}")

    print(f"✅ Total unique famous and acclaimed movie IDs gathered: {len(all_ids)}")
    return all_ids


async def run_pipeline():
    api_key = settings.tmdb_api_key
    if not api_key:
        print("ERROR: TMDB_API_KEY is not set.")
        return

    # Check which IDs we already have in the database to avoid re-fetching
    async with async_session_factory() as session:
        existing_rows = await session.execute(
            select(MovieExternalID.external_id).where(MovieExternalID.source == "tmdb")
        )
        existing_tmdb_ids = {int(row[0]) for row in existing_rows.all() if row[0].isdigit()}
        print(f"ℹ️ Already present in DB: {len(existing_tmdb_ids)} movies")

    async with TMDBClient(api_key) as client:
        all_ids = await collect_movie_ids(client)
        new_ids = [mid for mid in all_ids if mid not in existing_tmdb_ids]
        print(f"🚀 New movies to ingest and sync: {len(new_ids)}")

        if not new_ids:
            print("All discovered movies already present in database!")
            return

        # Fetch details in Bronze layer
        print(f"📥 Fetching Bronze details for {len(new_ids)} movies (Concurrency: 10)...")
        details = await ingest_movie_details(client, new_ids, concurrency=10)

    # Process Bronze -> Silver
    print("⚙️ Processing Bronze to Silver records...")
    silver_records: list[dict[str, Any]] = []
    bronze_dir = Path("data/bronze/tmdb/movies")
    for mid in new_ids:
        b_path = bronze_dir / f"{mid}.json"
        if not b_path.exists():
            continue
        try:
            b_obj = json.loads(b_path.read_text(encoding="utf-8"))
            raw_data = b_obj.get("data", b_obj)
            retrieved_at = b_obj.get("retrieved_at", "")
            silver = normalize_tmdb_movie(raw_data, retrieved_at)
            if silver:
                silver_records.append(silver)
                # Write to data/silver/tmdb/{mid}.json
                s_path = SILVER_DIR / f"{mid}.json"
                s_path.write_text(json.dumps(silver, indent=2, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            logger.warning(f"Silver error for {mid}: {e}")

    print(f"✨ Successfully normalized {len(silver_records)} Silver records")

    # Upsert into PostgreSQL Gold DB
    print("💾 Upserting into PostgreSQL Gold Database...")
    synced = 0
    errors = 0
    async with async_session_factory() as session:
        for i, rec in enumerate(silver_records, 1):
            try:
                mid = await _upsert_movie(session, rec)
                if mid:
                    synced += 1
            except Exception as e:
                errors += 1
                logger.error(f"Error syncing {rec.get('title')}: {e}")
                await session.rollback()
                continue

            if i % 100 == 0 or i == len(silver_records):
                await session.commit()
                print(f"   🎬 Synced {i}/{len(silver_records)} movies to PostgreSQL...", flush=True)

        await session.commit()

    print(f"\n🎉 Ingestion Complete! Synced {synced} new famous movies ({errors} errors).")

    # Verify new totals
    async with async_session_factory() as session:
        from sqlalchemy import func
        total = await session.scalar(select(func.count(Movie.id)))
        pre_2000 = await session.scalar(select(func.count(Movie.id)).where(Movie.release_year < 2000))
        post_2000 = await session.scalar(select(func.count(Movie.id)).where(Movie.release_year >= 2000))
        print(f"📊 Database Catalog Status:")
        print(f"   - Total Movies: {total}")
        print(f"   - Classics (Pre-2000): {pre_2000}")
        print(f"   - Modern Cinema (2000+): {post_2000}")


if __name__ == "__main__":
    asyncio.run(run_pipeline())
