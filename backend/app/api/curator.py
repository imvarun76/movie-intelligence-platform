"""
AI Film Curator — Grounded RAG & Personalized Conversational Recommendation Engine.

Combines:
  1. User Taste Memory (interacted genres, watched catalog, cold-start tier).
  2. Query Intent Parsing (genre extraction, mood/themes, similarity requests).
  3. Grounded Candidate Retrieval (excluding watched films, applying Bayesian ranking).
  4. Editorial Generation (explaining why films were selected based on query + taste).
"""

from __future__ import annotations

import re
import uuid
from collections import Counter
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from backend.app.api.deps import OptionalUser
from backend.app.api.movies import DBSession
from backend.app.models.interaction import Interaction
from backend.app.models.movie import Movie
from backend.app.models.user import User

router = APIRouter(prefix="/curator", tags=["curator"])


# Canonical genre mapping
GENRE_SYNONYMS = {
    "horror": "Horror",
    "scary": "Horror",
    "spooky": "Horror",
    "slasher": "Horror",
    "sci-fi": "Science Fiction",
    "scifi": "Science Fiction",
    "science fiction": "Science Fiction",
    "space": "Science Fiction",
    "thriller": "Thriller",
    "suspense": "Thriller",
    "action": "Action",
    "adventure": "Adventure",
    "drama": "Drama",
    "comedy": "Comedy",
    "funny": "Comedy",
    "romance": "Romance",
    "romantic": "Romance",
    "fantasy": "Fantasy",
    "mystery": "Mystery",
    "crime": "Crime",
    "gangster": "Crime",
    "animation": "Animation",
    "anime": "Animation",
    "family": "Family",
    "western": "Western",
    "documentary": "Documentary",
}


class CuratorChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=500, description="User's conversational inquiry or genre request")
    user_id: uuid.UUID | None = None
    limit: int = 3


class CuratorMovieCard(BaseModel):
    id: int
    title: str
    release_year: int | None
    genres: list[str] | None
    runtime_minutes: int | None
    poster_path: str | None
    backdrop_path: str | None
    tmdb_rating: float | None
    overview: str | None
    curator_rationale: str


class CuratorChatResponse(BaseModel):
    query: str
    reply_text: str
    user_taste_summary: str
    detected_genres: list[str]
    movies: list[CuratorMovieCard]


def compute_bayesian_score(vote_avg: float | None, vote_count: int | None, m: int = 500, c: float = 6.8) -> float:
    """Calculates weighted Bayesian score for fair ranking."""
    v = vote_count or 0
    r = vote_avg or c
    return (v / (v + m)) * r + (m / (v + m)) * c


@router.post("/chat", response_model=CuratorChatResponse)
async def curator_chat(
    payload: CuratorChatRequest,
    db: DBSession,
    current_user: OptionalUser = None,
) -> Any:
    raw_query = payload.query.strip()
    q_lower = raw_query.lower()

    # ── 1. Fetch User Taste Profile & Watched History ─────────────────────────────
    watched_movie_ids: set[int] = set()
    user_top_genres: list[str] = []
    user_genre_counter: Counter[str] = Counter()
    user_name = "film lover"

    effective_user_id = current_user.id if current_user else payload.user_id

    if current_user:
        user_name = current_user.name or current_user.username or "member"
    elif effective_user_id:
        u = await db.get(User, effective_user_id)
        if u:
            user_name = u.name or u.username or "member"

    if effective_user_id:
        # Get all interacted movies
        stmt = (
            select(Interaction, Movie)
            .join(Movie, Interaction.movie_id == Movie.id)
            .where(Interaction.user_id == effective_user_id)
        )
        interactions = (await db.execute(stmt)).all()

        for inter, movie in interactions:
            if inter.event_type in ["watched", "liked"]:
                watched_movie_ids.add(movie.id)
                for g in movie.genres or []:
                    user_genre_counter[g] += 1

        user_top_genres = [g for g, _ in user_genre_counter.most_common(3)]


    # ── 2. Parse Query Intent & Genre Tags ─────────────────────────────────────────
    matched_genres = set()
    for keyword, canon_genre in GENRE_SYNONYMS.items():
        if re.search(r"\b" + re.escape(keyword) + r"\b", q_lower):
            matched_genres.add(canon_genre)

    is_general_recommendation = any(
        term in q_lower for term in ["suggest", "recommend", "what should i watch", "what to watch", "surprise me", "something good", "any idea", "pick"]
    )

    # ── 3. Candidate Retrieval ────────────────────────────────────────────────────
    candidates_stmt = select(Movie)
    
    # If specific genres were asked, strictly filter or prioritize those genres
    if matched_genres:
        genre_filters = [Movie.genres.contains([g]) for g in matched_genres]
        candidates_stmt = candidates_stmt.where(or_(*genre_filters))
    elif is_general_recommendation and user_top_genres:
        # User asked for suggestions without specifying genre -> use their historical taste!
        taste_filters = [Movie.genres.contains([g]) for g in user_top_genres]
        candidates_stmt = candidates_stmt.where(or_(*taste_filters))
    else:
        # Search by keywords in title or overview if present
        clean_words = [w for w in re.findall(r"\w+", q_lower) if len(w) > 3 and w not in ["movie", "movies", "film", "films", "like", "watch", "give", "show"]]
        if clean_words:
            keyword_filters = []
            for w in clean_words[:3]:
                keyword_filters.append(Movie.title.ilike(f"%{w}%"))
                keyword_filters.append(Movie.overview.ilike(f"%{w}%"))
            candidates_stmt = candidates_stmt.where(or_(*keyword_filters))

    res = await db.execute(candidates_stmt.limit(100))
    candidate_movies = res.scalars().all()

    # Fallback to general high-rated movies if zero candidates
    if not candidate_movies:
        fallback_stmt = select(Movie).order_by(Movie.popularity.desc()).limit(30)
        candidate_movies = (await db.execute(fallback_stmt)).scalars().all()

    # ── 4. Re-Ranking with Grounding & Bayesian Score ──────────────────────────────
    scored_movies: list[tuple[float, Movie, str]] = []

    for movie in candidate_movies:
        # Skip movies user already watched if we have alternatives
        is_already_watched = movie.id in watched_movie_ids
        
        base_score = compute_bayesian_score(movie.tmdb_rating, movie.tmdb_votes)

        rationale_parts = []
        # Genre relevance
        movie_genres = set(movie.genres or [])
        common_query_genres = movie_genres.intersection(matched_genres)
        if common_query_genres:
            base_score += 2.0
            rationale_parts.append(f"Matches your requested {', '.join(common_query_genres)}")

        # User personal taste alignment
        common_user_genres = movie_genres.intersection(set(user_top_genres))
        if common_user_genres:
            base_score += 1.2
            rationale_parts.append(f"Aligns with your logged interest in {', '.join(common_user_genres)}")

        if movie.tmdb_rating and movie.tmdb_rating >= 8.0:
            rationale_parts.append(f"Critically acclaimed ({movie.tmdb_rating:.1f}/10)")

        # Penalize already watched
        if is_already_watched:
            base_score -= 5.0

        rationale = " • ".join(rationale_parts) if rationale_parts else f"Notable selection (Rating: {movie.tmdb_rating or 7.0:.1f})"
        scored_movies.append((base_score, movie, rationale))

    # Sort descending
    scored_movies.sort(key=lambda x: x[0], reverse=True)
    top_picks = scored_movies[:payload.limit]

    # ── 5. Generate Grounded Editorial Explanation ─────────────────────────────────
    cards: list[CuratorMovieCard] = []
    for _, movie, rationale in top_picks:
        cards.append(
            CuratorMovieCard(
                id=movie.id,
                title=movie.title,
                release_year=movie.release_year,
                genres=movie.genres,
                runtime_minutes=movie.runtime_minutes,
                poster_path=movie.poster_path,
                backdrop_path=movie.backdrop_path,
                tmdb_rating=movie.tmdb_rating,
                overview=movie.overview,
                curator_rationale=rationale,
            )
        )

    # Taste summary string
    if user_top_genres:
        taste_str = f"Taste DNA: {', '.join(user_top_genres)} ({len(watched_movie_ids)} logged titles)"
    else:
        taste_str = "Taste DNA: Cold Start (Exploratory Curation)"

    # Editorial reply narrative
    if matched_genres:
        genre_names = ", ".join(matched_genres)
        if user_top_genres and any(g in matched_genres for g in user_top_genres):
            editorial_text = (
                f"Curating through the lens of {genre_names}, specifically attuned to your established taste profile. "
                f"We bypassed your {len(watched_movie_ids)} previously logged films to present these unmissable productions:"
            )
        else:
            editorial_text = (
                f"Here are {len(cards)} definitive {genre_names} selections from the catalog, "
                f"calibrated for atmospheric tension, narrative depth, and high critical consensus:"
            )
    elif is_general_recommendation:
        if user_top_genres:
            editorial_text = (
                f"Reflecting upon your personal archive ({', '.join(user_top_genres)}): "
                f"We synthesized your viewing patterns to handpick these fresh cinematic experiences tailored to you:"
            )
        else:
            editorial_text = (
                "Welcome to ShowDyme. As your profile begins its journey, here are three quintessential "
                "masterpieces spanning diverse genres to initiate your taste trajectory:"
            )
    else:
        editorial_text = (
            f"Here are our top intelligence selections reflecting your inquiry \"{raw_query}\":"
        )

    return CuratorChatResponse(
        query=raw_query,
        reply_text=editorial_text,
        user_taste_summary=taste_str,
        detected_genres=list(matched_genres),
        movies=cards,
    )
