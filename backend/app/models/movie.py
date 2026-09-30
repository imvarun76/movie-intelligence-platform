from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class Movie(Base):
    __tablename__ = "movies"

    id: Mapped[int] = mapped_column(
        primary_key=True,
    )

    title: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )

    release_year: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    runtime_minutes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    original_language: Mapped[str | None] = mapped_column(
        String(16),
        nullable=True,
    )

    genres: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    overview: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )

    poster_path: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
    )

    backdrop_path: Mapped[str | None] = mapped_column(
        String(256),
        nullable=True,
    )

    tmdb_rating: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    tmdb_votes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    popularity: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    cast: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    directors: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    keywords: Mapped[list | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
