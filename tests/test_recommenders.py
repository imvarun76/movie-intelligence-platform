"""
Unit tests for Recommender System components.
"""

from backend.app.recommendations.collaborative import interaction_to_weight
from backend.app.recommendations.content_based import _build_content_document
from backend.app.recommendations.filtering import apply_diversity_and_exploration
from backend.app.recommendations.hybrid import compute_cold_start_tier
from backend.app.recommendations.popularity import compute_weighted_rating


class DummyMovie:
    def __init__(self, mid: int, title: str, genres: list[str], rating: float = 7.5, votes: int = 1000):
        self.id = mid
        self.title = title
        self.genres = genres
        self.tmdb_rating = rating
        self.tmdb_votes = votes
        self.overview = f"Plot overview for {title}"
        self.keywords = ["hero", "action"]
        self.cast = [{"name": "Actor A"}]
        self.directors = [{"name": "Director B", "job": "Director"}]


def test_cold_start_tier_thresholds():
    assert compute_cold_start_tier(0) == "new"
    assert compute_cold_start_tier(1) == "sparse"
    assert compute_cold_start_tier(15) == "sparse"
    assert compute_cold_start_tier(16) == "mature"
    assert compute_cold_start_tier(50) == "mature"


def test_bayesian_weighted_rating():
    # When vote count is 0, rating should equal mean_rating
    assert compute_weighted_rating(0, 8.0, min_votes=50, mean_rating=6.5) == 6.5

    # When vote count is huge, rating should approach movie rating
    wr = compute_weighted_rating(100000, 9.0, min_votes=50, mean_rating=6.5)
    assert round(wr, 2) == 9.00


def test_interaction_weights():
    assert interaction_to_weight("liked") == 2.0
    assert interaction_to_weight("watched") == 1.0
    assert interaction_to_weight("disliked") == -2.5
    assert interaction_to_weight("watchlist") == 1.2
    # Rating 10.0 -> (10 - 5.0) / 2.5 = 2.0
    assert interaction_to_weight("rating", 10.0) == 2.0
    # Rating 5.0 -> (5 - 5.0) / 2.5 = 0.0
    assert interaction_to_weight("rating", 5.0) == 0.0


def test_content_document_builder():
    m = DummyMovie(1, "The Dark Knight", ["Action", "Crime"])
    doc = _build_content_document(m)
    assert "the dark knight" in doc
    assert "action" in doc
    assert "crime" in doc
    assert "actor_a" in doc


def test_diversity_and_exploration_capping():
    # 10 Action movies, 5 Drama movies
    ranked = [
        {"movie": DummyMovie(i, f"Action Film {i}", ["Action"]), "score": 0.9 - i * 0.01, "strategy": "pop"}
        for i in range(10)
    ]
    exploration_pool = [
        {"movie": DummyMovie(100 + i, f"Indie Drama {i}", ["Drama"]), "score": 0.7, "strategy": "pop"}
        for i in range(5)
    ]

    selected = apply_diversity_and_exploration(
        ranked_candidates=ranked,
        exploration_pool=exploration_pool,
        target_k=8,
        max_genre_ratio=0.35,  # max 2 action films
        exploration_rate=0.25,
    )

    action_count = sum(1 for x in selected if "Action" in (x["movie"].genres or []))
    assert action_count <= 4  # Capped rather than dominating all 8 slots
    assert len(selected) == 8
