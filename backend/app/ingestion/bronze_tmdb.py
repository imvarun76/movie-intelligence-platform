"""
Bronze layer ingestion pipeline for TMDB.

Design:
  - Fetches paginated discover + per-movie detail pages.
  - Stores raw JSON with provenance envelope (source, endpoint, retrieved_at).
  - No transformation — pure raw data preservation.
  - Quarantines failed fetches with error details.
  - Idempotent: skips already-fetched files by TMDB ID.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.app.core.config import settings
from backend.app.ingestion.tmdb_client import TMDBClient

logger = logging.getLogger(__name__)

BRONZE_DIR = Path("data/bronze/tmdb")
QUARANTINE_DIR = Path("data/quarantine/tmdb")
CUTOFF_DATE = "2026-01-01"


def _envelope(source: str, endpoint: str, data: Any, retrieved_at: str) -> dict:
    return {
        "source": source,
        "endpoint": endpoint,
        "retrieved_at": retrieved_at,
        "schema_version": "1.0",
        "data": data,
    }


def _write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")


def _quarantine(tmdb_id: int, error: str) -> None:
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    path = QUARANTINE_DIR / f"movie_{tmdb_id}.json"
    _write_json(
        path,
        {
            "tmdb_id": tmdb_id,
            "error": error,
            "quarantined_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    logger.warning("Quarantined movie %d: %s", tmdb_id, error)


async def ingest_discover(
    client: TMDBClient,
    max_pages: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch all discover pages and write envelope to bronze/discover/."""
    discovered = await client.paginate_discover(
        max_pages=max_pages,
        primary_release_date_lte=CUTOFF_DATE,
    )
    retrieved_at = datetime.now(timezone.utc).isoformat()

    out_path = BRONZE_DIR / "discover" / "movies.json"
    _write_json(
        out_path,
        _envelope(
            source="tmdb",
            endpoint="/discover/movie",
            data=discovered,
            retrieved_at=retrieved_at,
        ),
    )
    logger.info("Wrote %d discover entries → %s", len(discovered), out_path)
    return discovered


async def ingest_movie_details(
    client: TMDBClient,
    tmdb_ids: list[int],
    concurrency: int = 10,
) -> dict[int, dict[str, Any]]:
    """
    Fetch per-movie detail pages in parallel and write to bronze/movies/{id}.json.

    Skips already-fetched files. Quarantines failures.
    """
    sem = asyncio.Semaphore(concurrency)
    details: dict[int, dict[str, Any]] = {}

    async def fetch_one(tmdb_id: int) -> None:
        out_path = BRONZE_DIR / "movies" / f"{tmdb_id}.json"
        if out_path.exists():
            logger.debug("Skip already fetched movie %d", tmdb_id)
            details[tmdb_id] = json.loads(out_path.read_text())
            return

        async with sem:
            try:
                data = await client.get_movie_details(tmdb_id)
                retrieved_at = datetime.now(timezone.utc).isoformat()
                envelope = _envelope(
                    source="tmdb",
                    endpoint=f"/movie/{tmdb_id}",
                    data=data,
                    retrieved_at=retrieved_at,
                )
                _write_json(out_path, envelope)
                details[tmdb_id] = envelope
                logger.debug("Fetched movie %d", tmdb_id)
            except Exception as exc:
                _quarantine(tmdb_id, str(exc))

    tasks = [fetch_one(tid) for tid in tmdb_ids]
    for i, coro in enumerate(asyncio.as_completed(tasks), 1):
        await coro
        if i % 500 == 0:
            logger.info("Details fetched: %d/%d", i, len(tmdb_ids))

    logger.info("Movie detail ingestion complete: %d OK, %d quarantined",
                len(details), len(tmdb_ids) - len(details))
    return details


async def run_full_bronze_ingest(
    max_discover_pages: int | None = None,
    concurrency: int = 10,
) -> None:
    """Full Bronze ingestion: discover → detail pages."""
    api_key = settings.tmdb_api_key
    if not api_key:
        logger.error("TMDB_API_KEY not configured")
        sys.exit(1)

    async with TMDBClient(api_key) as client:
        # 1. Discover all movies up to cutoff
        logger.info("=== Phase 1: TMDB Discover ===")
        discovered = await ingest_discover(client, max_pages=max_discover_pages)

        # 2. Fetch detail pages for all discovered movies
        tmdb_ids = [m["id"] for m in discovered if m.get("id")]
        logger.info("=== Phase 2: TMDB Movie Details (%d movies) ===", len(tmdb_ids))
        await ingest_movie_details(client, tmdb_ids, concurrency=concurrency)

    logger.info("=== Bronze ingestion complete ===")


if __name__ == "__main__":
    import argparse

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )

    parser = argparse.ArgumentParser(description="TMDB Bronze layer ingestion")
    parser.add_argument("--max-pages", type=int, default=None,
                        help="Limit discover pages (default: all up to 500)")
    parser.add_argument("--concurrency", type=int, default=10,
                        help="Parallel detail fetches (default: 10)")
    args = parser.parse_args()

    asyncio.run(run_full_bronze_ingest(
        max_discover_pages=args.max_pages,
        concurrency=args.concurrency,
    ))
