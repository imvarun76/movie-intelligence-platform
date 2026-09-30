"""
TMDB API client.

Key design decisions:
- Forces IPv4 to avoid TLS reset from TMDB's CloudFront CDN on IPv6.
- Rate-limited to 40 req/s (TMDB free tier allows 50/s but we stay safe).
- Retries with exponential back-off on transient failures.
- Returns raw dicts; callers are responsible for schema mapping.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

logger = logging.getLogger(__name__)

_TMDB_BASE = "https://api.themoviedb.org/3"
# Force IPv4 — TMDB CloudFront resets TLS on IPv6 from some networks.
_IPV4_TRANSPORT = httpx.AsyncHTTPTransport(local_address="0.0.0.0")

# Simple token-bucket rate limiter (40 req/s)
_RATE_LIMIT = 40
_MIN_INTERVAL = 1.0 / _RATE_LIMIT


class TMDBRateLimiter:
    def __init__(self, rate: float = _RATE_LIMIT) -> None:
        self._min_interval = 1.0 / rate
        self._last_called = 0.0
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            wait = self._min_interval - (now - self._last_called)
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_called = time.monotonic()


_limiter = TMDBRateLimiter()


class TMDBClient:
    """Async TMDB v3 API client."""

    def __init__(self, api_key: str) -> None:
        if not api_key:
            raise ValueError("TMDB_API_KEY is required")
        self._api_key = api_key
        self._client: httpx.AsyncClient | None = None

    async def __aenter__(self) -> "TMDBClient":
        self._client = httpx.AsyncClient(
            transport=_IPV4_TRANSPORT,
            timeout=httpx.Timeout(30.0),
            base_url=_TMDB_BASE,
        )
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._client:
            await self._client.aclose()

    @retry(
        retry=retry_if_exception_type((httpx.TransportError, httpx.TimeoutException)),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=1, max=16),
        reraise=True,
    )
    async def _get(self, path: str, **params: Any) -> dict[str, Any]:
        await _limiter.acquire()
        assert self._client is not None, "Use as async context manager"
        response = await self._client.get(
            path,
            params={"api_key": self._api_key, "language": "en-US", **params},
        )
        response.raise_for_status()
        return response.json()

    # ------------------------------------------------------------------ #
    # Public methods                                                        #
    # ------------------------------------------------------------------ #

    async def get_configuration(self) -> dict[str, Any]:
        """Fetch TMDB global configuration (image base URLs etc.)."""
        return await self._get("/configuration")

    async def discover_movies(
        self,
        page: int = 1,
        primary_release_date_lte: str = "2026-10-01",
        sort_by: str = "popularity.desc",
        **extra_params: Any,
    ) -> dict[str, Any]:
        """Discover movies with filters."""
        params = {
            "page": page,
            "sort_by": sort_by,
            "include_adult": False,
            "include_video": False,
            "primary_release_date.lte": primary_release_date_lte,
            **extra_params,
        }
        return await self._get("/discover/movie", **params)

    async def get_movie_details(self, tmdb_id: int) -> dict[str, Any]:
        """Fetch full movie details including credits and keywords."""
        return await self._get(
            f"/movie/{tmdb_id}",
            append_to_response="credits,keywords,release_dates,external_ids",
        )

    async def get_movie_by_imdb_id(self, imdb_id: str) -> dict[str, Any]:
        """Find a TMDB movie by its IMDb ID."""
        return await self._get("/find/" + imdb_id, external_source="imdb_id")

    async def paginate_discover(
        self,
        max_pages: int | None = None,
        primary_release_date_lte: str = "2026-10-01",
        sort_by: str = "popularity.desc",
        **extra_params: Any,
    ) -> list[dict[str, Any]]:
        """
        Iterate all pages of /discover/movie and return a flat list of results.

        Args:
            max_pages: Cap total pages (TMDB caps at 500). None = fetch all.
            primary_release_date_lte: ISO date string cutoff.
            sort_by: TMDB sort parameter.
        """
        first = await self.discover_movies(
            page=1,
            primary_release_date_lte=primary_release_date_lte,
            sort_by=sort_by,
            **extra_params,
        )
        total_pages = min(first.get("total_pages", 1), 500)
        if max_pages is not None:
            total_pages = min(total_pages, max_pages)

        results: list[dict[str, Any]] = list(first.get("results", []))
        logger.info(
            "TMDB discover: %d total results across %d pages",
            first.get("total_results"),
            total_pages,
        )

        retrieved_at = datetime.now(timezone.utc).isoformat()

        for page in range(2, total_pages + 1):
            data = await self.discover_movies(
                page=page,
                primary_release_date_lte=primary_release_date_lte,
                sort_by=sort_by,
            )
            batch = data.get("results", [])
            # Stamp retrieval time
            for item in batch:
                item["_retrieved_at"] = retrieved_at
            results.extend(batch)
            logger.debug("Fetched page %d/%d (%d movies so far)", page, total_pages, len(results))

        return results
