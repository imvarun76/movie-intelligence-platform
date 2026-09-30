"""
Popularity Recommender (V1).

Uses Bayesian weighted rating (IMDb formula) blended with log-popularity:
    WR = (v / (v + m)) * R + (m / (v + m)) * C
    Final Score = 0.65 * norm(WR) + 0.35 * norm(log(1 + popularity))

Where:
    v = vote_count
    m = minimum votes threshold (e.g. 50th percentile or default 25)
    R = movie average rating
    C = mean rating across all movies in the catalog
"""

from __future__ import annotations

import math
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.movie import Movie


def compute_weighted_rating(
    vote_count: int | None,
    vote_average: float | None,
    min_votes: float,
    mean_rating: float,
) -> float:
    v = vote_count or 0
    R = vote_average or mean_rating
    if v + min_votes == 0:
        return mean_rating
    return (v / (v + min_votes)) * R + (min_votes / (v + min_votes)) * mean_rating


async def get_popular_movies(
    session: AsyncSession,
    limit: int = 20,
    genre: str | None = None,
    excluded_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    """
    Compute popularity-ranked recommendations.
    """
    excluded_ids = excluded_ids or set()

    stmt = select(Movie).where(Movie.tmdb_rating.is_not(None)).where(Movie.tmdb_rating >= 6.8).where(Movie.tmdb_votes >= 50)
    if genre:
        stmt = stmt.where(Movie.genres.contains([genre]))
    if excluded_ids:
        stmt = stmt.where(Movie.id.not_in(excluded_ids))

    result = await session.execute(stmt)
    movies = result.scalars().all()

    if not movies:
        return []

    # Calculate C (mean rating) and m (min votes threshold)
    valid_ratings = [m.tmdb_rating for m in movies if m.tmdb_rating is not None]
    mean_rating = sum(valid_ratings) / len(valid_ratings) if valid_ratings else 7.5

    vote_counts = sorted([m.tmdb_votes or 0 for m in movies])
    min_votes = vote_counts[len(vote_counts) // 2] if vote_counts else 500.0
    min_votes = max(min_votes, 200.0)

    # Compute raw scores
    movie_scores: list[tuple[Movie, float, float]] = []
    max_log_pop = 1.0

    for m in movies:
        wr = compute_weighted_rating(m.tmdb_votes, m.tmdb_rating, min_votes, mean_rating)
        log_pop = math.log1p(max(m.popularity or 0.0, 0.0))
        if log_pop > max_log_pop:
            max_log_pop = log_pop
        movie_scores.append((m, wr, log_pop))

    # Normalize and blend: 85% Bayesian rating, 15% popularity
    ranked = []
    for m, wr, log_pop in movie_scores:
        norm_wr = wr / 10.0  # TMDB / IMDb ratings are 0-10
        norm_pop = log_pop / max_log_pop if max_log_pop > 0 else 0.5
        final_score = 0.85 * norm_wr + 0.15 * norm_pop

        ranked.append({
            "movie": m,
            "score": round(final_score, 4),
            "strategy": "popularity",
            "reason": f"Acclaimed masterpiece (IMDb ★ {m.tmdb_rating:.1f} • {m.tmdb_votes:,} votes)",
        })

    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked[:limit]
