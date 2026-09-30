"""
Recommendations API router.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api.deps import OptionalUser
from backend.app.api.movies import DBSession
from backend.app.mlops.ab_testing import get_experiment_engine
from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.recommendations.content_based import get_content_engine
from backend.app.recommendations.hybrid import HybridRanker
from backend.app.recommendations.popularity import get_popular_movies

router = APIRouter(prefix="/recommendations", tags=["recommendations"])



class MovieCard(BaseModel):
    id: int
    title: str
    release_year: int | None
    genres: list[str] | None
    original_language: str | None
    runtime_minutes: int | None
    poster_path: str | None = None
    backdrop_path: str | None = None
    tmdb_rating: float | None = None
    popularity: float | None = None
    score: float | None = None
    strategy: str | None = None
    reason: str | None = None

    model_config = {"from_attributes": True}


class RecommendationsFeed(BaseModel):
    user_id: str | None
    cold_start_tier: str
    experiment_name: str | None = None
    experiment_variant: str | None = None
    recommended_for_you: list[MovieCard]
    trending_now: list[MovieCard]
    top_rated: list[MovieCard]
    because_you_watched: dict[str, Any] | None = None


def _to_card(item: dict[str, Any]) -> MovieCard:
    m: Movie = item["movie"]
    return MovieCard(
        id=m.id,
        title=m.title,
        release_year=m.release_year,
        genres=m.genres,
        original_language=m.original_language,
        runtime_minutes=m.runtime_minutes,
        poster_path=m.poster_path,
        backdrop_path=m.backdrop_path,
        tmdb_rating=m.tmdb_rating,
        popularity=m.popularity,
        score=item.get("score"),
        strategy=item.get("strategy"),
        reason=item.get("reason"),
    )


@router.get("", response_model=RecommendationsFeed)
async def get_feed(
    db: DBSession,
    current_user: OptionalUser = None,
    user_id: str | None = Query(None, description="User UUID (if authenticated or guest session)"),
    limit: int = Query(12, ge=4, le=30),
) -> Any:
    uid = current_user.id if current_user else None
    if not uid and user_id:
        try:
            uid = uuid.UUID(user_id)
        except ValueError:
            pass

    target_uuid = uid or uuid.uuid4()


    # 1. A/B Experiment Assignment (Phase 6 MLOps)
    engine = get_experiment_engine()
    exp_name = "recommender_hybrid_v1"
    variant = engine.assign_variant(exp_name, target_uuid)
    exp_params = variant.params or {}
    exploration_rate = float(exp_params.get("exploration_rate", 0.15))
    max_genre_ratio = float(exp_params.get("max_genre_ratio", 0.35))

    # Log impression event
    if uid:
        try:
            await engine.log_event(
                session=db,
                experiment_name=exp_name,
                user_id=uid,
                variant=variant.name,
                conversion_event="impression",
            )
        except Exception:
            pass  # Do not block recommendation flow on telemetry errors

    # 2. Recommended For You (Hybrid Ranker with variant parameters)
    personalized = await HybridRanker.get_personalized_recommendations(
        session=db,
        user_id=target_uuid,
        limit=limit,
        exploration_rate=exploration_rate,
        max_genre_ratio=max_genre_ratio,
    )

    # 3. Trending Now (high popularity)
    trending_items = await get_popular_movies(session=db, limit=limit)

    # 4. Top Rated (high Bayesian rating)
    top_rated_items = await get_popular_movies(session=db, limit=limit)

    # 5. Because You Watched... (if user has watched movies)
    because_watched = None
    if uid:
        last_watched_stmt = (
            select(Interaction)
            .where(Interaction.user_id == uid)
            .where(Interaction.event_type == "watched")
            .order_by(Interaction.occurred_at.desc())
            .limit(1)
        )
        last_res = await db.execute(last_watched_stmt)
        last_watched = last_res.scalar_one_or_none()

        if last_watched:
            source_movie = await db.get(Movie, last_watched.movie_id)
            if source_movie:
                content_engine = await get_content_engine(db)
                sim_items = content_engine.get_similar_to_movie(source_movie.id, limit=8)
                if sim_items:
                    because_watched = {
                        "source_movie_title": source_movie.title,
                        "source_movie_id": source_movie.id,
                        "movies": [_to_card(x) for x in sim_items],
                    }

    tier = "new"
    if personalized and personalized[0].get("strategy"):
        strat = personalized[0]["strategy"]
        if "sparse" in strat:
            tier = "sparse"
        elif "mature" in strat:
            tier = "mature"

    return RecommendationsFeed(
        user_id=str(uid) if uid else None,
        cold_start_tier=tier,
        experiment_name=exp_name,
        experiment_variant=variant.name,
        recommended_for_you=[_to_card(x) for x in personalized],
        trending_now=[_to_card(x) for x in trending_items],
        top_rated=[_to_card(x) for x in top_rated_items],
        because_you_watched=because_watched,
    )


@router.get("/similar/{movie_id}", response_model=list[MovieCard])
async def get_similar(
    movie_id: int,
    db: DBSession,
    limit: int = Query(8, ge=2, le=20),
) -> Any:
    movie = await db.get(Movie, movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    engine = await get_content_engine(db)
    sim_items = engine.get_similar_to_movie(movie_id=movie_id, limit=limit)
    return [_to_card(x) for x in sim_items]
