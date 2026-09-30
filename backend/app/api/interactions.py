"""
User Interactions & Taste Insights API router.
"""

from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.app.api.movies import DBSession
from backend.app.mlops.ab_testing import get_experiment_engine
from backend.app.mlops.feature_store import FeatureStoreService
from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.models.user import User
from backend.app.recommendations.hybrid import compute_cold_start_tier

router = APIRouter(prefix="/interactions", tags=["interactions"])


class InteractionCreate(BaseModel):
    user_id: uuid.UUID
    movie_id: int
    event_type: str = Field(..., description="watched, liked, disliked, watchlist, rating, click")
    value: float | None = Field(None, description="Optional score, e.g. rating 1.0 - 10.0")
    source: str = "web"
    event_metadata: dict[str, Any] | None = None


class InteractionResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    movie_id: int
    event_type: str
    value: float | None
    occurred_at: str
    new_interaction_count: int
    cold_start_tier: str


class UserInsights(BaseModel):
    user_id: uuid.UUID
    interaction_count: int
    cold_start_tier: str
    watched_count: int
    liked_count: int
    disliked_count: int
    watchlist_count: int
    top_genres: list[dict[str, Any]]
    recent_activity: list[dict[str, Any]]


@router.post("", response_model=InteractionResponse)
async def record_interaction(
    payload: InteractionCreate,
    db: DBSession,
) -> Any:
    # 1. Verify movie exists
    movie = await db.get(Movie, payload.movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    # 2. Get or create user
    user = await db.get(User, payload.user_id)
    if not user:
        user = User(
            id=payload.user_id,
            interaction_count=0,
            cold_start_tier="new",
        )
        db.add(user)
        await db.flush()

    # 3. Create interaction event
    interaction = Interaction(
        user_id=payload.user_id,
        movie_id=payload.movie_id,
        event_type=payload.event_type,
        value=payload.value,
        source=payload.source,
        event_metadata=payload.event_metadata,
    )
    db.add(interaction)

    # 4. Update user interaction count and cold-start tier
    user.interaction_count += 1
    user.cold_start_tier = compute_cold_start_tier(user.interaction_count)

    await db.commit()
    await db.refresh(interaction)

    # 5. Real-Time Feature Store Sync (Phase 6 MLOps)
    try:
        await FeatureStoreService.compute_and_upsert_user_features(db, payload.user_id)
        await FeatureStoreService.compute_and_upsert_movie_features(db, payload.movie_id)
        
        # 6. A/B Testing Telemetry Conversion Event
        engine = get_experiment_engine()
        variant = engine.assign_variant("recommender_hybrid_v1", payload.user_id)
        await engine.log_event(
            session=db,
            experiment_name="recommender_hybrid_v1",
            user_id=payload.user_id,
            variant=variant.name,
            conversion_event=payload.event_type,
            value=payload.value,
        )
    except Exception:
        pass  # Telemetry or background feature sync should not fail client response

    return InteractionResponse(
        id=interaction.id,
        user_id=interaction.user_id,
        movie_id=interaction.movie_id,
        event_type=interaction.event_type,
        value=interaction.value,
        occurred_at=interaction.occurred_at.isoformat(),
        new_interaction_count=user.interaction_count,
        cold_start_tier=user.cold_start_tier,
    )


@router.get("/user/{user_id}/insights", response_model=UserInsights)
async def get_user_insights(
    user_id: uuid.UUID,
    db: DBSession,
) -> Any:
    user = await db.get(User, user_id)
    if not user:
        # Default fresh user profile
        return UserInsights(
            user_id=user_id,
            interaction_count=0,
            cold_start_tier="new",
            watched_count=0,
            liked_count=0,
            disliked_count=0,
            watchlist_count=0,
            top_genres=[],
            recent_activity=[],
        )

    # Fetch user's interactions with movies
    stmt = (
        select(Interaction, Movie)
        .join(Movie, Interaction.movie_id == Movie.id)
        .where(Interaction.user_id == user_id)
        .order_by(Interaction.occurred_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    watched_count = sum(1 for i, _ in rows if i.event_type == "watched")
    liked_count = sum(1 for i, _ in rows if i.event_type == "liked")
    disliked_count = sum(1 for i, _ in rows if i.event_type == "disliked")
    watchlist_count = sum(1 for i, _ in rows if i.event_type == "watchlist")

    # Aggregate genres from positive interactions
    genre_counter: Counter[str] = Counter()
    for inter, movie in rows:
        if inter.event_type in ["watched", "liked", "watchlist"]:
            for g in movie.genres or []:
                genre_counter[g] += 1

    top_genres = [
        {"genre": genre, "count": count}
        for genre, count in genre_counter.most_common(5)
    ]

    recent_activity = [
        {
            "event_type": inter.event_type,
            "movie_id": movie.id,
            "movie_title": movie.title,
            "poster_path": movie.poster_path,
            "release_year": movie.release_year,
            "occurred_at": inter.occurred_at.isoformat(),
        }
        for inter, movie in rows[:10]
    ]

    return UserInsights(
        user_id=user_id,
        interaction_count=user.interaction_count,
        cold_start_tier=user.cold_start_tier,
        watched_count=watched_count,
        liked_count=liked_count,
        disliked_count=disliked_count,
        watchlist_count=watchlist_count,
        top_genres=top_genres,
        recent_activity=recent_activity,
    )
