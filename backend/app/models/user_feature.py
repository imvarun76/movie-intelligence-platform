import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class UserFeature(Base):
    __tablename__ = "user_features"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )

    interaction_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    cold_start_tier: Mapped[str] = mapped_column(
        String(16),
        nullable=False,
        default="new",
    )

    preferred_genres: Mapped[dict | None] = mapped_column(
        JSONB,
        nullable=True,
    )

    rolling_7d_velocity: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
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
