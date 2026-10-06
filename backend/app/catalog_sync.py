"""
Catalog synchronization utility.
Seeds and synchronizes the curated, IMDb-enriched movie catalog from catalog_seed.json.gz.
"""

from __future__ import annotations

import gzip
import json
import logging
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db import async_session_factory
from backend.app.models.movie import Movie
from backend.app.models.movie_external_id import MovieExternalID

logger = logging.getLogger("catalog_sync")
SEED_PATH = Path(__file__).resolve().parent / "data" / "catalog_seed.json.gz"


async def sync_catalog_from_seed(session_factory=None) -> dict[str, int]:
    """
    Reads the compressed catalog seed and synchronizes movies and external IDs into the database.
    Idempotent: matches on TMDB external ID or (title, release_year).
    """
    if not SEED_PATH.exists():
        logger.warning(f"Catalog seed file not found at {SEED_PATH}")
        return {"total_seed": 0, "inserted": 0, "updated": 0}

    factory = session_factory or async_session_factory

    logger.info(f"Loading catalog seed from {SEED_PATH}...")
    with gzip.open(SEED_PATH, "rt", encoding="utf-8") as f:
        catalog: list[dict[str, Any]] = json.load(f)

    logger.info(f"Catalog seed contains {len(catalog)} curated movies.")

    inserted_count = 0
    updated_count = 0

    async with factory() as session:
        # 1. Build lookup of existing TMDB external IDs -> movie_id
        ext_rows = await session.execute(
            select(MovieExternalID.external_id, MovieExternalID.movie_id).where(
                MovieExternalID.source == "tmdb"
            )
        )
        tmdb_to_movie_id: dict[str, int] = {str(row[0]): row[1] for row in ext_rows.all()}

        # 2. Build lookup of existing title + year -> movie_id (fallback)
        movie_rows = await session.execute(select(Movie.id, Movie.title, Movie.release_year))
        title_year_to_id: dict[tuple[str, int | None], int] = {
            (row[1].lower().strip(), row[2]): row[0] for row in movie_rows.all()
        }

        for item in catalog:
            tmdb_id = None
            for ext in item.get("external_ids", []):
                if ext.get("source") == "tmdb":
                    tmdb_id = str(ext.get("external_id"))
                    break

            existing_id = None
            if tmdb_id and tmdb_id in tmdb_to_movie_id:
                existing_id = tmdb_to_movie_id[tmdb_id]
            else:
                key = (item["title"].lower().strip(), item.get("release_year"))
                existing_id = title_year_to_id.get(key)

            if existing_id is None:
                m = Movie(
                    title=item["title"],
                    release_year=item.get("release_year"),
                    genres=item.get("genres"),
                    original_language=item.get("original_language"),
                    runtime_minutes=item.get("runtime_minutes"),
                    poster_path=item.get("poster_path"),
                    backdrop_path=item.get("backdrop_path"),
                    tmdb_rating=item.get("tmdb_rating"),
                    tmdb_votes=item.get("tmdb_votes"),
                    popularity=item.get("popularity"),
                    overview=item.get("overview"),
                    cast=item.get("cast"),
                    directors=item.get("directors"),
                )
                session.add(m)
                await session.flush()

                if tmdb_id:
                    tmdb_to_movie_id[tmdb_id] = m.id
                title_year_to_id[(item["title"].lower().strip(), item.get("release_year"))] = m.id

                for ext in item.get("external_ids", []):
                    session.add(
                        MovieExternalID(
                            movie_id=m.id,
                            source=ext["source"],
                            external_id=str(ext["external_id"]),
                        )
                    )

                inserted_count += 1
            else:
                updated_count += 1

            if inserted_count > 0 and inserted_count % 100 == 0:
                await session.commit()

        await session.commit()

        if inserted_count > 0:
            try:
                from backend.app.mlops.feature_store import FeatureStoreService
                await FeatureStoreService.sync_all_features(session)
            except Exception as e:
                logger.warning(f"Feature store sync warning after seeding: {e}")

    logger.info(
        f"Catalog sync complete: {len(catalog)} total seed, {inserted_count} inserted, {updated_count} existing."
    )
    return {
        "total_seed": len(catalog),
        "inserted": inserted_count,
        "updated": updated_count,
    }
