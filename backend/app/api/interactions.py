"""
User Interactions & Taste Insights API router.
"""

from __future__ import annotations

import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.app.api.deps import CurrentUser
from backend.app.api.movies import DBSession
from backend.app.mlops.ab_testing import get_experiment_engine
from backend.app.mlops.feature_store import FeatureStoreService
from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.models.user import User
from backend.app.recommendations.hybrid import compute_cold_start_tier

router = APIRouter(prefix="/interactions", tags=["interactions"])


class InteractionCreate(BaseModel):
    movie_id: int
    event_type: str = Field(..., description="watched, liked, disliked, watchlist, rating, click")
    user_id: uuid.UUID | None = Field(None, description="Optional legacy field; server uses authenticated user identity")
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


class ArchiveItem(BaseModel):
    movie_id: int
    title: str
    release_year: int | None = None
    genres: list[str] | None = None
    runtime_minutes: int | None = None
    poster_path: str | None = None
    backdrop_path: str | None = None
    tmdb_rating: float | None = None
    overview: str | None = None
    status: str  # "watched", "liked", "watchlist"
    is_watched: bool = False
    is_liked: bool = False
    is_watchlist: bool = False
    interacted_at: str


@router.post("", response_model=InteractionResponse)
async def record_interaction(
    payload: InteractionCreate,
    current_user: CurrentUser,
    db: DBSession,
) -> Any:
    """
    Record a user interaction. The actor identity is strictly extracted from the
    authenticated session token, never trusting client-supplied user IDs.
    """
    # 1. Verify movie exists
    movie = await db.get(Movie, payload.movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    user = current_user

    # 2. Create interaction event
    interaction = Interaction(
        user_id=user.id,
        movie_id=payload.movie_id,
        event_type=payload.event_type,
        value=payload.value,
        source=payload.source,
        event_metadata=payload.event_metadata,
    )
    db.add(interaction)

    # 3. Update user interaction count and cold-start tier
    user.interaction_count += 1
    user.cold_start_tier = compute_cold_start_tier(user.interaction_count)

    await db.commit()
    await db.refresh(interaction)

    # 4. Real-Time Feature Store Sync (Phase 6 MLOps)
    try:
        await FeatureStoreService.compute_and_upsert_user_features(db, user.id)
        await FeatureStoreService.compute_and_upsert_movie_features(db, payload.movie_id)

        # 5. A/B Testing Telemetry Conversion Event
        engine = get_experiment_engine()
        variant = engine.assign_variant("recommender_hybrid_v1", user.id)
        await engine.log_event(
            session=db,
            experiment_name="recommender_hybrid_v1",
            user_id=user.id,
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



async def _build_user_insights(user: User, db: DBSession) -> UserInsights:
    stmt = (
        select(Interaction, Movie)
        .join(Movie, Interaction.movie_id == Movie.id)
        .where(Interaction.user_id == user.id)
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
        user_id=user.id,
        interaction_count=user.interaction_count,
        cold_start_tier=user.cold_start_tier,
        watched_count=watched_count,
        liked_count=liked_count,
        disliked_count=disliked_count,
        watchlist_count=watchlist_count,
        top_genres=top_genres,
        recent_activity=recent_activity,
    )


async def _build_user_archive(user_id: uuid.UUID, db: DBSession, filter_type: str | None = None) -> list[ArchiveItem]:
    stmt = (
        select(Interaction, Movie)
        .join(Movie, Interaction.movie_id == Movie.id)
        .where(Interaction.user_id == user_id)
        .order_by(Interaction.occurred_at.desc())
    )
    rows = (await db.execute(stmt)).all()

    # Deduplicate by movie ID while aggregating status
    movie_dict: dict[int, dict[str, Any]] = {}
    for inter, movie in rows:
        mid = movie.id
        if mid not in movie_dict:
            movie_dict[mid] = {
                "movie": movie,
                "latest_status": inter.event_type,
                "is_watched": inter.event_type == "watched",
                "is_liked": inter.event_type == "liked",
                "is_watchlist": inter.event_type == "watchlist",
                "latest_at": inter.occurred_at.isoformat(),
            }
        else:
            if inter.event_type == "watched":
                movie_dict[mid]["is_watched"] = True
                movie_dict[mid]["latest_status"] = "watched"
            elif inter.event_type == "liked":
                movie_dict[mid]["is_liked"] = True
            elif inter.event_type == "watchlist":
                movie_dict[mid]["is_watchlist"] = True

    items: list[ArchiveItem] = []
    for mid, data in movie_dict.items():
        m: Movie = data["movie"]
        status = data["latest_status"]
        if data["is_watched"]:
            status = "watched"
        elif data["is_liked"]:
            status = "liked"
        elif data["is_watchlist"]:
            status = "watchlist"

        if filter_type:
            ft = filter_type.lower()
            if ft == "watched" and not data["is_watched"]:
                continue
            if ft == "liked" and not data["is_liked"]:
                continue
            if ft == "watchlist" and not data["is_watchlist"]:
                continue

        items.append(
            ArchiveItem(
                movie_id=m.id,
                title=m.title,
                release_year=m.release_year,
                genres=m.genres,
                runtime_minutes=m.runtime_minutes,
                poster_path=m.poster_path,
                backdrop_path=m.backdrop_path,
                tmdb_rating=m.tmdb_rating,
                overview=m.overview,
                status=status,
                is_watched=data["is_watched"],
                is_liked=data["is_liked"],
                is_watchlist=data["is_watchlist"],
                interacted_at=data["latest_at"],
            )
        )

    return items


@router.get("/me/insights", response_model=UserInsights)
async def get_my_insights(
    current_user: CurrentUser,
    db: DBSession,
) -> Any:
    """Retrieve taste insights for the authenticated user."""
    return await _build_user_insights(current_user, db)


@router.get("/me/archive", response_model=list[ArchiveItem])
async def get_my_archive(
    current_user: CurrentUser,
    db: DBSession,
    filter_type: str | None = None,
) -> Any:
    """Retrieve the personal movie archive for the authenticated user."""
    return await _build_user_archive(current_user.id, db, filter_type)


@router.get("/user/{user_id}/insights", response_model=UserInsights)
async def get_user_insights(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
) -> Any:
    """
    Access insights for a specific user ID. Enforces strict user isolation:
    User A cannot view User B's private insights.
    """
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You cannot access another member's private insights.",
        )
    return await _build_user_insights(current_user, db)


@router.get("/user/{user_id}/archive", response_model=list[ArchiveItem])
async def get_user_archive(
    user_id: uuid.UUID,
    current_user: CurrentUser,
    db: DBSession,
    filter_type: str | None = None,
) -> Any:
    """
    Access archive for a specific user ID. Enforces strict user isolation:
    User A cannot view User B's private archive.
    """
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Forbidden: You cannot access another member's private archive.",
        )
    return await _build_user_archive(user_id, db, filter_type)


