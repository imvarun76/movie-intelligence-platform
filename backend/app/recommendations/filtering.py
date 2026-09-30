"""
Candidate Eligibility Filtering & Feedback Loop Protection (Phase 4).

Key components:
  1. Eligibility filtering: Exclude already watched or explicitly disliked movies.
  2. Diversity re-ranking: Caps genre concentration (e.g. max 35% from one genre).
  3. Exploration budget: Injects discovery candidates outside dominant user genres to prevent filter bubbles.
"""

from __future__ import annotations

import random
from collections import Counter
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie


async def get_user_exclusion_set(
    session: AsyncSession,
    user_id: UUID,
) -> set[int]:
    """
    Returns set of movie IDs the user has already watched or disliked.
    """
    stmt = (
        select(Interaction.movie_id)
        .where(Interaction.user_id == user_id)
        .where(Interaction.event_type.in_(["watched", "disliked"]))
    )
    result = await session.execute(stmt)
    return set(result.scalars().all())


def apply_diversity_and_exploration(
    ranked_candidates: list[dict[str, Any]],
    exploration_pool: list[dict[str, Any]],
    target_k: int = 20,
    max_genre_ratio: float = 0.35,
    exploration_rate: float = 0.15,
) -> list[dict[str, Any]]:
    """
    Re-rank candidates to ensure diversity and exploration:
      - Genre concentration constraint: max `max_genre_ratio` from any single genre in top K.
      - Exploration quota: allocate `exploration_rate * target_k` slots for high-quality items outside dominant genres.
    """
    if not ranked_candidates:
        return exploration_pool[:target_k]

    max_per_genre = max(2, int(target_k * max_genre_ratio))
    num_explore = max(1, int(target_k * exploration_rate))
    num_standard = target_k - num_explore

    selected: list[dict[str, Any]] = []
    genre_counts: Counter[str] = Counter()
    selected_ids: set[int] = set()

    # Pass 1: Standard ranking with genre caps
    for item in ranked_candidates:
        movie: Movie = item["movie"]
        if movie.id in selected_ids:
            continue

        genres = movie.genres or ["Other"]
        # Check if dominant genre exceeds threshold
        primary_genre = genres[0] if genres else "Other"
        if genre_counts[primary_genre] >= max_per_genre and len(selected) < num_standard:
            continue

        selected.append(item)
        selected_ids.add(movie.id)
        for g in genres:
            genre_counts[g] += 1

        if len(selected) >= num_standard:
            break

    # Pass 2: Exploration slots (items with distinct genres / styles)
    top_dominant_genres = {g for g, _ in genre_counts.most_common(2)}
    explore_candidates = [
        item for item in exploration_pool
        if item["movie"].id not in selected_ids
        and not (set(item["movie"].genres or []) & top_dominant_genres)
    ]

    # If no pure distinct genre items found, fallback to any unseen exploration pool items
    if not explore_candidates:
        explore_candidates = [
            item for item in exploration_pool
            if item["movie"].id not in selected_ids
        ]

    random.shuffle(explore_candidates)
    for item in explore_candidates[:num_explore]:
        item_copy = dict(item)
        item_copy["strategy"] = "exploration"
        item_copy["reason"] = f"Curated discovery: Explore {item['movie'].genres[0] if item['movie'].genres else 'new cinema'}"
        selected.append(item_copy)
        selected_ids.add(item["movie"].id)

    # Pass 3: If still not at target_k, pull additional diverse candidates from exploration pool
    if len(selected) < target_k:
        more_explore = [
            item for item in exploration_pool
            if item["movie"].id not in selected_ids
        ]
        for item in more_explore:
            if len(selected) >= target_k:
                break
            movie: Movie = item["movie"]
            primary_genre = (movie.genres or ["Other"])[0]
            if genre_counts[primary_genre] < max_per_genre:
                item_copy = dict(item)
                item_copy["strategy"] = "exploration"
                item_copy["reason"] = f"Curated discovery: {primary_genre}"
                selected.append(item_copy)
                selected_ids.add(movie.id)
                genre_counts[primary_genre] += 1

    # Pass 4: Final fallback — if still under target_k, fill with remaining items
    for item in ranked_candidates:
        if len(selected) >= target_k:
            break
        if item["movie"].id not in selected_ids:
            selected.append(item)
            selected_ids.add(item["movie"].id)

    return selected[:target_k]
