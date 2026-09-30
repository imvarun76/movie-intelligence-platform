"""
MLOps & Real-Time Intelligence API router (Phase 6).
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.app.api.movies import DBSession
from backend.app.mlops.ab_testing import get_experiment_engine
from backend.app.mlops.feature_store import FeatureStoreService
from backend.app.mlops.mlflow_tracker import get_mlflow_tracker
from backend.app.models.ab_experiment import ABExperimentLog
from backend.app.models.movie_feature import MovieFeature
from backend.app.models.user_feature import UserFeature

router = APIRouter(prefix="/mlops", tags=["mlops"])


class FeatureSyncResponse(BaseModel):
    movies_synced: int
    users_synced: int
    status: str = "success"


class LogExperimentEventRequest(BaseModel):
    experiment_name: str = "recommender_hybrid_v1"
    user_id: uuid.UUID
    variant: str
    conversion_event: str | None = Field(None, description="impression, click, watched, liked, rating, watchlist")
    value: float | None = None


class UserFeatureResponse(BaseModel):
    user_id: uuid.UUID
    interaction_count: int
    cold_start_tier: str
    preferred_genres: dict[str, float] | None
    rolling_7d_velocity: float
    feature_timestamp: str
    feature_version: str


class MovieFeatureResponse(BaseModel):
    movie_id: int
    bayesian_quality_score: float | None
    popularity_decayed: float | None
    interaction_velocity: float
    primary_genre: str | None
    feature_timestamp: str
    feature_version: str


@router.get("/status")
async def get_mlops_status(db: DBSession) -> dict[str, Any]:
    """Get system health and metadata across Feature Store, A/B Testing, and MLflow."""
    # Count feature store rows
    m_count_res = await db.execute(select(func.count(MovieFeature.movie_id)))
    m_feat_count = m_count_res.scalar() or 0

    u_count_res = await db.execute(select(func.count(UserFeature.user_id)))
    u_feat_count = u_count_res.scalar() or 0

    ab_logs_count_res = await db.execute(select(func.count(ABExperimentLog.id)))
    ab_logs_count = ab_logs_count_res.scalar() or 0

    tracker = get_mlflow_tracker()
    engine = get_experiment_engine()

    return {
        "phase": "Phase 6: Real-Time MLOps",
        "feature_store": {
            "movie_features_count": m_feat_count,
            "user_features_count": u_feat_count,
            "engine": "PostgreSQL Real-Time Feature Store (Free Option)",
            "version": "v1.0",
        },
        "ab_testing": {
            "registered_experiments": list(engine.experiments.keys()),
            "total_telemetry_logs": ab_logs_count,
        },
        "mlflow": {
            "tracking_uri": tracker.tracking_uri,
            "experiment_name": tracker.experiment_name,
            "backend": "Local SQLite / File Artifacts ($0 Free Local Option)",
        },
    }


@router.post("/features/sync", response_model=FeatureSyncResponse)
async def sync_all_features(db: DBSession) -> Any:
    """Compute and upsert real-time features for all movies and users in database."""
    res = await FeatureStoreService.sync_all_features(db)
    return FeatureSyncResponse(
        movies_synced=res["movies_synced"],
        users_synced=res["users_synced"],
        status="success",
    )


@router.get("/features/user/{user_id}", response_model=UserFeatureResponse)
async def get_user_features(user_id: uuid.UUID, db: DBSession) -> Any:
    """Get user features, computing them on-the-fly if not yet cached."""
    feat = await FeatureStoreService.get_user_features(db, user_id)
    if not feat:
        feat = await FeatureStoreService.compute_and_upsert_user_features(db, user_id)
        await db.commit()

    return UserFeatureResponse(
        user_id=feat.user_id,
        interaction_count=feat.interaction_count,
        cold_start_tier=feat.cold_start_tier,
        preferred_genres=feat.preferred_genres,
        rolling_7d_velocity=feat.rolling_7d_velocity,
        feature_timestamp=feat.feature_timestamp.isoformat(),
        feature_version=feat.feature_version,
    )


@router.get("/features/movie/{movie_id}", response_model=MovieFeatureResponse)
async def get_movie_features(movie_id: int, db: DBSession) -> Any:
    """Get movie features, computing them on-the-fly if not yet cached."""
    feat = await FeatureStoreService.get_movie_features(db, movie_id)
    if not feat:
        feat = await FeatureStoreService.compute_and_upsert_movie_features(db, movie_id)
        if not feat:
            raise HTTPException(status_code=404, detail="Movie not found")
        await db.commit()

    return MovieFeatureResponse(
        movie_id=feat.movie_id,
        bayesian_quality_score=feat.bayesian_quality_score,
        popularity_decayed=feat.popularity_decayed,
        interaction_velocity=feat.interaction_velocity,
        primary_genre=feat.primary_genre,
        feature_timestamp=feat.feature_timestamp.isoformat(),
        feature_version=feat.feature_version,
    )


@router.get("/experiments/{experiment_name}")
async def get_experiment_analytics(experiment_name: str, db: DBSession) -> Any:
    """Get conversion metrics, impression counts, and lift per variant."""
    engine = get_experiment_engine()
    if experiment_name not in engine.experiments:
        raise HTTPException(status_code=404, detail=f"Experiment '{experiment_name}' not found")
    metrics = await engine.get_metrics(db, experiment_name)
    return metrics


@router.post("/experiments/log")
async def log_experiment_event(
    payload: LogExperimentEventRequest, db: DBSession
) -> dict[str, str]:
    """Record an impression or conversion telemetry event for an experiment variant."""
    engine = get_experiment_engine()
    entry = await engine.log_event(
        session=db,
        experiment_name=payload.experiment_name,
        user_id=payload.user_id,
        variant=payload.variant,
        conversion_event=payload.conversion_event,
        value=payload.value,
    )
    return {"status": "logged", "log_id": str(entry.id)}


@router.get("/models/runs")
async def get_model_runs(limit: int = Query(10, ge=1, le=50)) -> list[dict[str, Any]]:
    """Retrieve recent offline evaluation runs and metrics from MLflow."""
    tracker = get_mlflow_tracker()
    return tracker.get_recent_runs(limit=limit)


@router.post("/models/evaluate")
async def run_model_evaluation(
    db: DBSession,
    k: int = Query(10, ge=3, le=30),
) -> dict[str, Any]:
    """Run offline evaluation on current catalog/interactions and log results into MLflow."""
    tracker = get_mlflow_tracker()
    result = await tracker.run_offline_evaluation(session=db, k=k)
    return result
