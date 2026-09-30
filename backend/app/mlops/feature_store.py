"""
Feature Store Service (Phase 6 MLOps).

Provides real-time and batch computation, storage, and retrieval for:
  - User Features (interaction count, cold-start tier, preferred genres distribution, 7-day velocity)
  - Movie Features (Bayesian quality score, decayed popularity, interaction velocity, primary genre)
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.models.movie_feature import MovieFeature
from backend.app.models.user import User
from backend.app.models.user_feature import UserFeature
from backend.app.recommendations.hybrid import compute_cold_start_tier

logger = logging.getLogger(__name__)

FEATURE_VERSION = "v1.0"
BAYESIAN_PRIOR_VOTES = 500  # m
BAYESIAN_PRIOR_MEAN = 6.8   # C


class FeatureStoreService:
    @staticmethod
    async def get_user_features(session: AsyncSession, user_id: UUID) -> UserFeature | None:
        """Fetch computed user features by user_id."""
        return await session.get(UserFeature, user_id)

    @staticmethod
    async def get_movie_features(session: AsyncSession, movie_id: int) -> MovieFeature | None:
        """Fetch computed movie features by movie_id."""
        return await session.get(MovieFeature, movie_id)

    @staticmethod
    async def compute_and_upsert_user_features(
        session: AsyncSession, user_id: UUID
    ) -> UserFeature:
        """
        Compute real-time feature row for a given user and upsert into user_features.
        """
        user = await session.get(User, user_id)
        interaction_count = user.interaction_count if user else 0
        tier = compute_cold_start_tier(interaction_count)

        # Interacted genres & 7d velocity
        now = datetime.now(timezone.utc)
        cutoff_7d = now - timedelta(days=7)

        interactions_stmt = (
            select(Interaction, Movie)
            .join(Movie, Interaction.movie_id == Movie.id)
            .where(Interaction.user_id == user_id)
        )
        res = await session.execute(interactions_stmt)
        rows = res.all()

        genre_counts: Counter[str] = Counter()
        recent_interactions = 0

        for inter, movie in rows:
            occurred = inter.occurred_at
            if occurred.tzinfo is None:
                occurred = occurred.replace(tzinfo=timezone.utc)
            if occurred >= cutoff_7d:
                recent_interactions += 1

            if inter.event_type in ["watched", "liked", "watchlist", "rating"]:
                for g in movie.genres or []:
                    genre_counts[g] += 1

        total_genre_hits = sum(genre_counts.values())
        preferred_genres = (
            {g: round(count / total_genre_hits, 4) for g, count in genre_counts.most_common(10)}
            if total_genre_hits > 0
            else {}
        )
        rolling_7d_velocity = round(recent_interactions / 7.0, 3)

        # Upsert into user_features
        stmt = (
            insert(UserFeature)
            .values(
                user_id=user_id,
                interaction_count=interaction_count,
                cold_start_tier=tier,
                preferred_genres=preferred_genres,
                rolling_7d_velocity=rolling_7d_velocity,
                feature_timestamp=now,
                feature_version=FEATURE_VERSION,
            )
            .on_conflict_do_update(
                index_elements=[UserFeature.user_id],
                set_={
                    "interaction_count": interaction_count,
                    "cold_start_tier": tier,
                    "preferred_genres": preferred_genres,
                    "rolling_7d_velocity": rolling_7d_velocity,
                    "feature_timestamp": now,
                    "feature_version": FEATURE_VERSION,
                },
            )
            .returning(UserFeature)
        )
        upsert_res = await session.execute(stmt)
        feature_row = upsert_res.scalar_one()
        return feature_row

    @staticmethod
    async def compute_and_upsert_movie_features(
        session: AsyncSession, movie_id: int
    ) -> MovieFeature | None:
        """
        Compute real-time feature row for a movie and upsert into movie_features.
        """
        movie = await session.get(Movie, movie_id)
        if not movie:
            return None

        # 1. Bayesian quality score
        # formula: (v * R + m * C) / (v + m)
        v = float(movie.tmdb_votes or 0)
        r = float(movie.tmdb_rating or BAYESIAN_PRIOR_MEAN)
        m = float(BAYESIAN_PRIOR_VOTES)
        c = float(BAYESIAN_PRIOR_MEAN)
        bayesian_quality = round((v * r + m * c) / (v + m), 3)

        # 2. Popularity decayed
        # Age-based half-life decay (approx 365 days half-life)
        now = datetime.now(timezone.utc)
        current_year = now.year
        age_years = max(0, current_year - (movie.release_year or current_year))
        raw_pop = float(movie.popularity or 10.0)
        # exponential decay: pop * e^(-0.05 * age_years)
        popularity_decayed = round(raw_pop * math.exp(-0.05 * age_years), 3)

        # 3. Interaction velocity (interactions in last 7 days)
        cutoff_7d = now - timedelta(days=7)
        vel_stmt = (
            select(func.count(Interaction.id))
            .where(Interaction.movie_id == movie_id)
            .where(Interaction.occurred_at >= cutoff_7d)
        )
        vel_res = await session.execute(vel_stmt)
        recent_interactions = vel_res.scalar() or 0
        interaction_velocity = round(recent_interactions / 7.0, 3)

        # 4. Primary genre
        primary_genre = movie.genres[0] if movie.genres and len(movie.genres) > 0 else None

        stmt = (
            insert(MovieFeature)
            .values(
                movie_id=movie_id,
                bayesian_quality_score=bayesian_quality,
                popularity_decayed=popularity_decayed,
                interaction_velocity=interaction_velocity,
                primary_genre=primary_genre,
                feature_timestamp=now,
                feature_version=FEATURE_VERSION,
            )
            .on_conflict_do_update(
                index_elements=[MovieFeature.movie_id],
                set_={
                    "bayesian_quality_score": bayesian_quality,
                    "popularity_decayed": popularity_decayed,
                    "interaction_velocity": interaction_velocity,
                    "primary_genre": primary_genre,
                    "feature_timestamp": now,
                    "feature_version": FEATURE_VERSION,
                },
            )
            .returning(MovieFeature)
        )
        upsert_res = await session.execute(stmt)
        feature_row = upsert_res.scalar_one()
        return feature_row

    @classmethod
    async def sync_all_features(cls, session: AsyncSession) -> dict[str, int]:
        """
        Batch compute features for all movies and all active users.
        """
        # Movies
        movie_ids_res = await session.execute(select(Movie.id))
        movie_ids = [m[0] for m in movie_ids_res.all()]
        m_count = 0
        for mid in movie_ids:
            await cls.compute_and_upsert_movie_features(session, mid)
            m_count += 1

        # Users
        user_ids_res = await session.execute(select(User.id))
        user_ids = [u[0] for u in user_ids_res.all()]
        u_count = 0
        for uid in user_ids:
            await cls.compute_and_upsert_user_features(session, uid)
            u_count += 1

        await session.commit()
        logger.info(f"Feature store sync completed: {m_count} movies, {u_count} users")
        return {"movies_synced": m_count, "users_synced": u_count}
