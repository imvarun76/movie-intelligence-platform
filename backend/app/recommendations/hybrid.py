"""
Hybrid Recommendation Ranker (V4).

Orchestrates Cold-Start Tiers and blends strategies:
  - Tier 'new' (0 interactions):
      85% Popularity + 15% Exploration
  - Tier 'sparse' (1–15 interactions):
      70% Content-based + 20% Popularity + 10% Exploration
  - Tier 'mature' (15+ interactions):
      45% Collaborative + 35% Content-based + 10% Popularity + 10% Exploration

Enforces Candidate Eligibility (Phase 4) and Diversity Re-Ranking.
"""

from __future__ import annotations

import logging
import random
from collections import defaultdict
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.models.user import User
from backend.app.recommendations.collaborative import get_collaborative_recommendations, interaction_to_weight
from backend.app.recommendations.content_based import get_content_engine
from backend.app.recommendations.filtering import apply_diversity_and_exploration, get_user_exclusion_set
from backend.app.recommendations.popularity import get_popular_movies

logger = logging.getLogger(__name__)


def compute_cold_start_tier(interaction_count: int) -> str:
    if interaction_count == 0:
        return "new"
    elif interaction_count <= 15:
        return "sparse"
    return "mature"


class HybridRanker:
    @staticmethod
    async def get_personalized_recommendations(
        session: AsyncSession,
        user_id: UUID,
        limit: int = 20,
        offset: int = 0,
        refresh: bool = False,
        exploration_rate: float = 0.15,
        max_genre_ratio: float = 0.35,
    ) -> list[dict[str, Any]]:
        # 1. Fetch user & cold-start tier
        user = await session.get(User, user_id)
        if not user:
            interaction_count = 0
            tier = "new"
        else:
            interaction_count = user.interaction_count
            tier = compute_cold_start_tier(interaction_count)

        # 2. Get eligibility exclusion set (already watched / disliked)
        excluded_ids = await get_user_exclusion_set(session, user_id)

        # 3. Fetch candidate pools
        pool_target = max(limit + offset + 12, limit * 4)

        # Pool A: Popularity
        popularity_pool = await get_popular_movies(
            session=session,
            limit=pool_target,
            excluded_ids=excluded_ids,
        )

        if tier == "new":
            # Pure popularity with diversity re-ranking
            ranked = apply_diversity_and_exploration(
                ranked_candidates=popularity_pool,
                exploration_pool=popularity_pool,
                target_k=pool_target,
                max_genre_ratio=max_genre_ratio,
                exploration_rate=exploration_rate,
            )
            if offset > 0 and len(ranked) > 0:
                effective_offset = offset % len(ranked)
                sliced = ranked[effective_offset : effective_offset + limit]
                if len(sliced) < limit and len(ranked) >= limit:
                    sliced += ranked[: limit - len(sliced)]
                return sliced
            if refresh and len(ranked) > limit:
                step = random.randint(1, max(1, len(ranked) - limit))
                sliced = ranked[step : step + limit]
                if len(sliced) < limit:
                    sliced += ranked[: limit - len(sliced)]
                return sliced
            return ranked[:limit]

        # Fetch user's interaction history
        user_inter_stmt = select(Interaction).where(Interaction.user_id == user_id)
        user_inter_res = await session.execute(user_inter_stmt)
        interactions = user_inter_res.scalars().all()

        user_history: list[tuple[int, float]] = [
            (i.movie_id, interaction_to_weight(i.event_type, i.value))
            for i in interactions
            if interaction_to_weight(i.event_type, i.value) > 0
        ]

        # Pool B: Content-based
        content_engine = await get_content_engine(session)
        content_pool = content_engine.get_recommendations_for_user(
            user_history=user_history,
            limit=pool_target,
            excluded_ids=excluded_ids,
        )

        # Pool C: Collaborative (for mature tier)
        collab_pool = []
        if tier == "mature":
            collab_pool = await get_collaborative_recommendations(
                session=session,
                user_id=user_id,
                limit=pool_target,
                excluded_ids=excluded_ids,
            )

        # 4. Multi-objective hybrid score blend
        # Weights configuration
        if tier == "sparse":
            w_collab, w_content, w_pop = 0.0, 0.75, 0.25
        else:  # mature
            w_collab, w_content, w_pop = 0.45, 0.40, 0.15

        movie_dict: dict[int, Movie] = {}
        score_dict: dict[int, float] = defaultdict(float)
        reasons_dict: dict[int, str] = {}

        for item in content_pool:
            mid = item["movie"].id
            movie_dict[mid] = item["movie"]
            score_dict[mid] += w_content * item["score"]
            reasons_dict[mid] = item["reason"]

        for item in popularity_pool:
            mid = item["movie"].id
            movie_dict[mid] = item["movie"]
            score_dict[mid] += w_pop * item["score"]
            if mid not in reasons_dict:
                reasons_dict[mid] = item["reason"]

        for item in collab_pool:
            mid = item["movie"].id
            movie_dict[mid] = item["movie"]
            score_dict[mid] += w_collab * item["score"]
            reasons_dict[mid] = item["reason"]

        # Sort blended scores with IMDb rating quality weighting
        blended = [
            {
                "movie": movie_dict[mid],
                "score": round(score * (((movie_dict[mid].tmdb_rating or 7.0) / 10.0) ** 1.8), 4),
                "strategy": f"hybrid_{tier}",
                "reason": reasons_dict.get(mid, "Recommended for you"),
            }
            for mid, score in score_dict.items()
            if (movie_dict[mid].tmdb_rating or 0) >= 6.8
        ]
        blended.sort(key=lambda x: x["score"], reverse=True)

        # 5. Apply Diversity & Exploration Re-ranking (Phase 4)
        final_ranked = apply_diversity_and_exploration(
            ranked_candidates=blended,
            exploration_pool=popularity_pool,
            target_k=pool_target,
            max_genre_ratio=max_genre_ratio,
            exploration_rate=exploration_rate,
        )

        if offset > 0 and len(final_ranked) > 0:
            effective_offset = offset % len(final_ranked)
            sliced = final_ranked[effective_offset : effective_offset + limit]
            if len(sliced) < limit and len(final_ranked) >= limit:
                sliced += final_ranked[: limit - len(sliced)]
            return sliced

        if refresh and len(final_ranked) > limit:
            step = random.randint(1, max(1, len(final_ranked) - limit))
            sliced = final_ranked[step : step + limit]
            if len(sliced) < limit:
                sliced += final_ranked[: limit - len(sliced)]
            return sliced

        return final_ranked[:limit]
