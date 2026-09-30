"""
Unit & Integration tests for Phase 6: Real-Time MLOps.
"""

import uuid
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.mlops.ab_testing import ABExperimentEngine, get_experiment_engine

client = TestClient(app)


def test_ab_deterministic_bucketing():
    """Verify that a given user always hashes to the exact same variant."""
    engine = get_experiment_engine()
    test_user = uuid.UUID("c8f12a34-5678-4321-9abc-def012345678")

    variant_1 = engine.assign_variant("recommender_hybrid_v1", test_user)
    variant_2 = engine.assign_variant("recommender_hybrid_v1", test_user)

    assert variant_1.name in ["control", "treatment_exploration"]
    assert variant_1.name == variant_2.name
    assert "exploration_rate" in variant_1.params


def test_ab_variant_traffic_distribution():
    """Verify 50/50 traffic split approximately holds over large sample."""
    engine = get_experiment_engine()
    counts = {"control": 0, "treatment_exploration": 0}

    for _ in range(200):
        uid = uuid.uuid4()
        variant = engine.assign_variant("recommender_hybrid_v1", uid)
        counts[variant.name] += 1

    # Both variants should receive substantial traffic
    assert counts["control"] > 60
    assert counts["treatment_exploration"] > 60


def test_mlops_status_endpoint():
    """Test MLOps health and metadata endpoint."""
    res = client.get("/api/v1/mlops/status")
    assert res.status_code == 200
    data = res.json()

    assert data["phase"] == "Phase 6: Real-Time MLOps"
    assert "feature_store" in data
    assert data["feature_store"]["movie_features_count"] > 0
    assert "ab_testing" in data
    assert "recommender_hybrid_v1" in data["ab_testing"]["registered_experiments"]
    assert "mlflow" in data
    assert "sqlite" in data["mlflow"]["tracking_uri"]


def test_mlops_movie_features_endpoint():
    """Test retrieving feature store dimensions for a movie."""
    res = client.get("/api/v1/mlops/features/movie/1")
    assert res.status_code == 200
    data = res.json()

    assert data["movie_id"] == 1
    assert data["bayesian_quality_score"] is not None
    assert data["popularity_decayed"] is not None
    assert data["feature_version"] == "v1.0"


def test_mlops_experiment_logging_flow():
    """Test logging an impression and conversion event for an A/B experiment."""
    test_user_id = str(uuid.uuid4())

    # 1. Log impression
    res = client.post(
        "/api/v1/mlops/experiments/log",
        json={
            "experiment_name": "recommender_hybrid_v1",
            "user_id": test_user_id,
            "variant": "control",
            "conversion_event": "impression",
        },
    )
    assert res.status_code == 200
    assert res.json()["status"] == "logged"

    # 2. Log conversion
    res2 = client.post(
        "/api/v1/mlops/experiments/log",
        json={
            "experiment_name": "recommender_hybrid_v1",
            "user_id": test_user_id,
            "variant": "control",
            "conversion_event": "liked",
            "value": 1.0,
        },
    )
    assert res2.status_code == 200

    # 3. Query experiment metrics
    metrics_res = client.get("/api/v1/mlops/experiments/recommender_hybrid_v1")
    assert metrics_res.status_code == 200
    m_data = metrics_res.json()
    assert "control" in m_data["variants"]
    assert m_data["variants"]["control"]["impressions"] >= 1


def test_mlflow_model_runs_endpoint():
    """Test querying recent offline evaluation runs from MLflow."""
    res = client.get("/api/v1/mlops/models/runs?limit=3")
    assert res.status_code == 200
    runs = res.json()
    assert isinstance(runs, list)
