"""
Movie API router — read-only catalog endpoints.
"""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db import async_session_factory
from backend.app.models.movie import Movie
from backend.app.models.movie_external_id import MovieExternalID

router = APIRouter(prefix="/movies", tags=["movies"])


# ── Dependency ─────────────────────────────────────────────────────────────
async def get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


DBSession = Annotated[AsyncSession, Depends(get_db)]


# ── Response schemas ───────────────────────────────────────────────────────
class MovieSummary(BaseModel):
    id: int
    title: str
    release_year: int | None
    genres: list[str] | None
    original_language: str | None
    runtime_minutes: int | None

    model_config = {"from_attributes": True}


class MovieDetail(MovieSummary):
    overview: str | None
    poster_path: str | None = None
    backdrop_path: str | None = None
    external_ids: dict[str, str] = {}


class PaginatedMovies(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[MovieSummary]


# ── Endpoints ──────────────────────────────────────────────────────────────
@router.get("", response_model=PaginatedMovies)
async def list_movies(
    db: DBSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    genre: str | None = Query(None, description="Filter by genre name"),
    year: int | None = Query(None, description="Filter by release year"),
    language: str | None = Query(None, description="Filter by original language code"),
    q: str | None = Query(None, description="Title search (case-insensitive)"),
) -> Any:
    stmt = select(Movie)

    if q:
        stmt = stmt.where(Movie.title.ilike(f"%{q}%"))
    if year:
        stmt = stmt.where(Movie.release_year == year)
    if language:
        stmt = stmt.where(Movie.original_language == language)
    if genre:
        stmt = stmt.where(Movie.genres.contains([genre]))

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total: int = (await db.execute(total_stmt)).scalar_one()

    stmt = stmt.order_by(Movie.id).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(stmt)).scalars().all()

    return PaginatedMovies(
        total=total,
        page=page,
        page_size=page_size,
        results=[MovieSummary.model_validate(r) for r in rows],
    )


@router.get("/{movie_id}", response_model=MovieDetail)
async def get_movie(movie_id: int, db: DBSession) -> Any:
    movie = await db.get(Movie, movie_id)
    if not movie:
        raise HTTPException(status_code=404, detail="Movie not found")

    # Fetch external IDs
    ext_rows = (
        await db.execute(
            select(MovieExternalID).where(MovieExternalID.movie_id == movie_id)
        )
    ).scalars().all()

    external_ids = {row.source: row.external_id for row in ext_rows}

    result = MovieDetail.model_validate(movie)
    result.external_ids = external_ids
    return result
