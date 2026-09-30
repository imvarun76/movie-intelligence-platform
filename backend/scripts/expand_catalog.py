"""
Expand movie catalog across popularity, top rated, and modern 2024-2026 releases.
Runs Bronze -> Silver -> Gold pipeline.
"""

import asyncio
import logging
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from backend.app.core.config import settings
from backend.app.ingestion.bronze_tmdb import ingest_movie_details
from backend.app.ingestion.gold_sync import sync_silver_to_gold
from backend.app.ingestion.silver_tmdb import process_bronze_to_silver
from backend.app.ingestion.tmdb_client import TMDBClient

logger = logging.getLogger("expand_catalog")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s — %(message)s")


async def expand_catalog(concurrency: int = 12):
    api_key = settings.tmdb_api_key
    if not api_key:
        print("ERROR: TMDB_API_KEY is missing from environment.")
        return

    async with TMDBClient(api_key) as client:
        all_movie_ids = set()

        # 1. Popular movies (Pages 1-30 = ~600 movies)
        print("--- Fetching Discover: Popularity (Pages 1-30) ---")
        pop_movies = await client.paginate_discover(
            max_pages=30,
            sort_by="popularity.desc",
            primary_release_date_lte="2026-10-01",
        )
        for m in pop_movies:
            if m.get("id"):
                all_movie_ids.add(m["id"])

        # 2. Critically acclaimed all-time classics (Pages 1-25 = ~500 movies)
        print("--- Fetching Discover: Top Rated (Pages 1-25) ---")
        rated_movies = await client.paginate_discover(
            max_pages=25,
            sort_by="vote_average.desc",
            primary_release_date_lte="2026-10-01",
            **{"vote_count.gte": 500},
        )
        for m in rated_movies:
            if m.get("id"):
                all_movie_ids.add(m["id"])

        # 3. Modern Releases (2024-2026, Pages 1-15 = ~300 movies)
        print("--- Fetching Discover: Modern 2024-2026 Releases (Pages 1-15) ---")
        recent_movies = await client.paginate_discover(
            max_pages=15,
            sort_by="popularity.desc",
            primary_release_date_lte="2026-10-01",
            **{"primary_release_date.gte": "2024-01-01"},
        )
        for m in recent_movies:
            if m.get("id"):
                all_movie_ids.add(m["id"])

        # 4. Dedicated Horror & Thriller Curation (Genre IDs: 27=Horror, 53=Thriller)
        print("--- Fetching Discover: Horror & Thriller (Pages 1-15) ---")
        horror_movies = await client.paginate_discover(
            max_pages=15,
            sort_by="vote_average.desc",
            **{"with_genres": "27", "vote_count.gte": 150},
        )
        for m in horror_movies:
            if m.get("id"):
                all_movie_ids.add(m["id"])

        # 5. Dedicated Sci-Fi & Mind-Bending Curation (Genre ID: 878=Sci-Fi)
        print("--- Fetching Discover: Sci-Fi & Speculative (Pages 1-15) ---")
        scifi_movies = await client.paginate_discover(
            max_pages=15,
            sort_by="vote_average.desc",
            **{"with_genres": "878", "vote_count.gte": 200},
        )
        for m in scifi_movies:
            if m.get("id"):
                all_movie_ids.add(m["id"])

        print(f"Total unique movie IDs collected across categories: {len(all_movie_ids)}")

        # 4. Fetch details in Bronze layer
        print(f"--- Ingesting Details for {len(all_movie_ids)} movies (Concurrency: {concurrency}) ---")
        await ingest_movie_details(client, list(all_movie_ids), concurrency=concurrency)

    # 5. Silver Normalization
    print("--- Processing Silver Normalization ---")
    ok, q = process_bronze_to_silver()
    print(f"Silver Layer: {ok} normalized, {q} quarantined")

    # 6. Gold DB Sync
    print("--- Syncing to PostgreSQL Gold DB ---")
    inserted, errors = await sync_silver_to_gold()
    print(f"Gold Layer: {inserted} upserted, {errors} errors")


if __name__ == "__main__":
    asyncio.run(expand_catalog())
