import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.models.base import Base


class ABExperimentLog(Base):
    __tablename__ = "ab_experiment_logs"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    experiment_name: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        nullable=False,
    )

    variant: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
    )

    conversion_event: Mapped[str | None] = mapped_column(
        String(32),
        nullable=True,
    )

    value: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    logged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )

    __table_args__ = (
        Index("ix_ab_exp_user_name", "experiment_name", "user_id"),
    )
