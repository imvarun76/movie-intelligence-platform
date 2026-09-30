"""
Collaborative Filtering Recommender (V3).

Item-Item Collaborative Filtering using user interaction matrix:
  - Event weights:
      liked: +2.0
      watchlist: +1.2
      watched: +1.0
      rating: (rating - 5.0) / 2.5
      disliked: -2.5
      skipped: -0.5

Computes item-item similarity based on co-interaction patterns across users.
Predicts user affinity for unseen items:
    Score(u, i) = sum_{j in History(u)} (sim(i, j) * weight(u, j)) / sum(sim(i, j))
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any
from uuid import UUID

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie

logger = logging.getLogger(__name__)

EVENT_WEIGHTS = {
    "liked": 2.0,
    "watchlist": 1.2,
    "watched": 1.0,
    "disliked": -2.5,
    "skipped": -0.5,
}


def interaction_to_weight(event_type: str, value: float | None = None) -> float:
    if event_type == "rating" and value is not None:
        # Scale 1-10 to [-2.0, 2.0]
        return (value - 5.0) / 2.5
    return EVENT_WEIGHTS.get(event_type, 0.5)


async def get_collaborative_recommendations(
    session: AsyncSession,
    user_id: UUID,
    limit: int = 20,
    excluded_ids: set[int] | None = None,
) -> list[dict[str, Any]]:
    excluded = excluded_ids or set()

    # 1. Fetch user's interactions
    user_stmt = select(Interaction).where(Interaction.user_id == user_id)
    user_res = await session.execute(user_stmt)
    user_interactions = user_res.scalars().all()

    if not user_interactions:
        return []

    # Map movie_id -> interaction weight for this user
    user_history: dict[int, float] = {}
    for inter in user_interactions:
        w = interaction_to_weight(inter.event_type, inter.value)
        user_history[inter.movie_id] = user_history.get(inter.movie_id, 0.0) + w
        excluded.add(inter.movie_id)

    # 2. Fetch interactions of other users who interacted with ANY of this user's movies
    user_movie_ids = list(user_history.keys())
    co_users_stmt = (
        select(Interaction.user_id)
        .where(Interaction.movie_id.in_(user_movie_ids))
        .where(Interaction.user_id != user_id)
        .distinct()
    )
    co_users_res = await session.execute(co_users_stmt)
    co_user_ids = co_users_res.scalars().all()

    if not co_user_ids:
        return []

    # Fetch all interactions for these co-users
    all_interactions_stmt = select(Interaction).where(Interaction.user_id.in_(co_user_ids))
    all_interactions_res = await session.execute(all_interactions_stmt)
    all_interactions = all_interactions_res.scalars().all()

    # Build user-item sparse matrix dict: user_id -> movie_id -> weight
    matrix: dict[UUID, dict[int, float]] = defaultdict(dict)
    for inter in all_interactions:
        w = interaction_to_weight(inter.event_type, inter.value)
        matrix[inter.user_id][inter.movie_id] = w

    # Calculate item scores for candidates
    candidate_scores: dict[int, float] = defaultdict(float)
    co_counts: dict[int, int] = defaultdict(int)

    for other_uid, items in matrix.items():
        # Check alignment with our user
        overlap_weight = sum(
            user_history[mid] * items[mid]
            for mid in items
            if mid in user_history
        )
        if overlap_weight <= 0:
            continue

        # Recommend items that other similar users liked
        for mid, w in items.items():
            if mid not in excluded and w > 0:
                candidate_scores[mid] += overlap_weight * w
                co_counts[mid] += 1

    if not candidate_scores:
        return []

    # Fetch movie details for top candidates
    sorted_candidates = sorted(candidate_scores.items(), key=lambda x: x[1], reverse=True)[:limit]
    cand_ids = [mid for mid, _ in sorted_candidates]

    movies_stmt = select(Movie).where(Movie.id.in_(cand_ids))
    movies_res = await session.execute(movies_stmt)
    movies_dict = {m.id: m for m in movies_res.scalars().all()}

    max_score = sorted_candidates[0][1] if sorted_candidates else 1.0

    results = []
    for mid, raw_score in sorted_candidates:
        if mid in movies_dict:
            norm_score = raw_score / max_score if max_score > 0 else 0.5
            results.append({
                "movie": movies_dict[mid],
                "score": round(float(norm_score), 4),
                "strategy": "collaborative",
                "reason": "Members with similar taste also loved this",
            })

    return results
