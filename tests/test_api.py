"""
Integration tests for FastAPI endpoints.
"""

import uuid
import pytest
from fastapi.testclient import TestClient

from backend.app.main import app

client = TestClient(app)


def test_health():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_db_health():
    res = client.get("/health/db")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["database"] == "connected"


def test_list_movies_pagination():
    res = client.get("/api/v1/movies?page=1&page_size=5")
    assert res.status_code == 200
    data = res.json()
    assert "total" in data
    assert data["total"] > 0
    assert len(data["results"]) == 5
    first = data["results"][0]
    assert "id" in first
    assert "title" in first


def test_recommendations_feed():
    res = client.get("/api/v1/recommendations?limit=6")
    assert res.status_code == 200
    data = res.json()
    assert data["cold_start_tier"] in ["new", "sparse", "mature"]
    assert len(data["recommended_for_you"]) > 0
    assert len(data["trending_now"]) > 0


def test_user_interaction_flow():
    test_user_id = str(uuid.uuid4())

    # 1. Record 'watched' interaction
    res = client.post(
        "/api/v1/interactions",
        json={
            "user_id": test_user_id,
            "movie_id": 1,
            "event_type": "watched",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["new_interaction_count"] == 1
    assert data["cold_start_tier"] == "sparse"

    # 2. Get user insights
    insights_res = client.get(f"/api/v1/interactions/user/{test_user_id}/insights")
    assert insights_res.status_code == 200
    insights = insights_res.json()
    assert insights["interaction_count"] == 1
    assert insights["watched_count"] == 1
    assert insights["cold_start_tier"] == "sparse"
