import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, String, UniqueConstraint, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class MovieExternalID(Base):
    __tablename__ = "movie_external_ids"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    movie_id: Mapped[int] = mapped_column(
        ForeignKey("movies.id", ondelete="CASCADE"),
        nullable=False,
    )

    source: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    external_id: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    source_last_updated: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        UniqueConstraint(
            "source",
            "external_id",
            name="uq_movie_external_ids_source_external",
        ),
        Index(
            "ix_movie_external_ids_movie_source",
            "movie_id",
            "source",
        ),
    )
