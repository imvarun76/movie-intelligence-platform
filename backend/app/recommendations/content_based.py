"""
Content-Based Recommender (V2).

Builds rich feature documents from:
  - Genres (weighted)
  - Keywords
  - Cast & Directors
  - Overview / synopsis

Uses TF-IDF + Cosine Similarity to find:
  1. Item-to-item similarity ("Because you watched X...")
  2. User-to-item content match from user's watched/liked history.
"""

from __future__ import annotations

import logging
from typing import Any

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models.movie import Movie

logger = logging.getLogger(__name__)


def _build_content_document(m: Movie) -> str:
    """Combine metadata fields into a structured text document."""
    parts: list[str] = []

    # Title
    parts.append(m.title)

    # Genres (weighted x2)
    if m.genres:
        genre_str = " ".join([g.replace(" ", "_") for g in m.genres])
        parts.extend([genre_str, genre_str])

    # Overview
    if m.overview:
        parts.append(m.overview)

    # Keywords (weighted x2)
    if m.keywords:
        kw_str = " ".join([k.replace(" ", "_") for k in m.keywords if isinstance(k, str)])
        parts.extend([kw_str, kw_str])

    # Cast (top 4 actors)
    if m.cast and isinstance(m.cast, list):
        cast_names = [
            c["name"].replace(" ", "_")
            for c in m.cast[:4]
            if isinstance(c, dict) and c.get("name")
        ]
        parts.append(" ".join(cast_names))

    # Directors (weighted x2)
    if m.directors and isinstance(m.directors, list):
        dir_names = [
            d["name"].replace(" ", "_")
            for d in m.directors
            if isinstance(d, dict) and d.get("name")
        ]
        dir_str = " ".join(dir_names)
        parts.extend([dir_str, dir_str])

    return " ".join(parts).lower()


class ContentEngine:
    def __init__(self) -> None:
        self.vectorizer = TfidfVectorizer(
            stop_words="english",
            max_features=5000,
            sublinear_tf=True,
            ngram_range=(1, 2),
        )
        self.movie_ids: list[int] = []
        self.movie_map: dict[int, Movie] = {}
        self.tfidf_matrix: np.ndarray | None = None
        self.similarity_matrix: np.ndarray | None = None

    def fit(self, movies: list[Movie]) -> None:
        if not movies:
            return

        self.movie_ids = [m.id for m in movies]
        self.movie_map = {m.id: m for m in movies}

        documents = [_build_content_document(m) for m in movies]
        self.tfidf_matrix = self.vectorizer.fit_transform(documents)
        self.similarity_matrix = cosine_similarity(self.tfidf_matrix, self.tfidf_matrix)
        logger.info("Fitted ContentEngine with %d movies", len(movies))

    def get_similar_to_movie(
        self,
        movie_id: int,
        limit: int = 10,
        excluded_ids: set[int] | None = None,
    ) -> list[dict[str, Any]]:
        if self.similarity_matrix is None or movie_id not in self.movie_map:
            return []

        excluded = (excluded_ids or set()) | {movie_id}
        idx = self.movie_ids.index(movie_id)
        source_movie = self.movie_map[movie_id]

        sim_scores = list(enumerate(self.similarity_matrix[idx]))
        sim_scores.sort(key=lambda x: x[1], reverse=True)

        results = []
        for i, score in sim_scores:
            cand_id = self.movie_ids[i]
            if cand_id in excluded:
                continue

            target = self.movie_map[cand_id]
            # Find shared elements for transparent explanation
            shared_genres = set(source_movie.genres or []) & set(target.genres or [])
            reason = f"Similar themes & genres ({', '.join(list(shared_genres)[:2]) or 'cinematic style'})"

            results.append({
                "movie": target,
                "score": round(float(score), 4),
                "strategy": "content_based",
                "reason": reason,
            })

            if len(results) >= limit:
                break

        return results

    def get_recommendations_for_user(
        self,
        user_history: list[tuple[int, float]],  # list of (movie_id, interaction_weight)
        limit: int = 20,
        excluded_ids: set[int] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Aggregate content preferences by weighting the TF-IDF vectors of interacted movies.
        """
        if self.tfidf_matrix is None or not user_history:
            return []

        excluded = excluded_ids or set()
        user_indices = []
        weights = []

        for mid, w in user_history:
            if mid in self.movie_map:
                user_indices.append(self.movie_ids.index(mid))
                weights.append(w)
                excluded.add(mid)

        if not user_indices:
            return []

        # Weighted average profile vector
        user_vecs = self.tfidf_matrix[user_indices].toarray()
        weights_arr = np.array(weights).reshape(-1, 1)
        profile_vec = np.sum(user_vecs * weights_arr, axis=0)
        norm = np.linalg.norm(profile_vec)
        if norm > 0:
            profile_vec /= norm

        # Compute cosine similarity between user profile and all candidate movies
        scores = cosine_similarity(profile_vec.reshape(1, -1), self.tfidf_matrix).flatten()

        ranked_indices = np.argsort(scores)[::-1]
        results = []

        for i in ranked_indices:
            cand_id = self.movie_ids[i]
            if cand_id in excluded:
                continue

            target = self.movie_map[cand_id]
            results.append({
                "movie": target,
                "score": round(float(scores[i]), 4),
                "strategy": "content_based",
                "reason": f"Matches your taste in {target.genres[0] if target.genres else 'film'}",
            })

            if len(results) >= limit:
                break

        return results


# Global singleton instance (cached in memory)
_content_engine: ContentEngine | None = None


async def get_content_engine(session: AsyncSession) -> ContentEngine:
    global _content_engine
    if _content_engine is None:
        result = await session.execute(select(Movie))
        movies = list(result.scalars().all())
        engine = ContentEngine()
        engine.fit(movies)
        _content_engine = engine
    return _content_engine
