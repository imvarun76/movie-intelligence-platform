from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class MovieFeature(Base):
    __tablename__ = "movie_features"

    movie_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("movies.id", ondelete="CASCADE"),
        primary_key=True,
    )

    bayesian_quality_score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    popularity_decayed: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    interaction_velocity: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    primary_genre: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    feature_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    feature_version: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="v1.0",
    )
