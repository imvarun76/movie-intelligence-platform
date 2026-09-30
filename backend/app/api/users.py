"""
User Account & Identity API router.
Enables account registration, login by username, and persona switching.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.app.api.movies import DBSession
from backend.app.models.interaction import Interaction
from backend.app.models.user import User

router = APIRouter(prefix="/users", tags=["users"])


class UserAuthRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, description="Unique username for account")


class UserProfileResponse(BaseModel):
    id: uuid.UUID
    username: str
    cold_start_tier: str
    interaction_count: int
    watched_count: int = 0
    liked_count: int = 0
    created_at: str


@router.post("/login-or-register", response_model=UserProfileResponse)
async def login_or_register(payload: UserAuthRequest, db: DBSession) -> Any:
    """
    Login or create a user account by username.
    Uses deterministic UUID generation so username always maps to the same identity.
    """
    clean_username = re.sub(r"[^a-zA-Z0-9_\-\.]", "", payload.username.strip().lower())
    if len(clean_username) < 2:
        raise HTTPException(status_code=400, detail="Username must be at least 2 alphanumeric characters.")

    deterministic_id = uuid.uuid5(uuid.NAMESPACE_DNS, f"showdyme.user.{clean_username}")

    # Check if user exists by ID or by username
    user = await db.get(User, deterministic_id)
    if not user:
        # Check by username
        res = await db.execute(select(User).where(User.username == clean_username))
        user = res.scalar_one_or_none()

    if not user:
        user = User(
            id=deterministic_id,
            username=clean_username,
            interaction_count=0,
            cold_start_tier="new",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
    elif not user.username:
        user.username = clean_username
        await db.commit()
        await db.refresh(user)

    # Compute watched and liked count
    stmt = (
        select(Interaction.event_type, func.count(Interaction.id))
        .where(Interaction.user_id == user.id)
        .group_by(Interaction.event_type)
    )
    counts = dict((await db.execute(stmt)).all())

    return UserProfileResponse(
        id=user.id,
        username=user.username or clean_username,
        cold_start_tier=user.cold_start_tier,
        interaction_count=user.interaction_count,
        watched_count=counts.get("watched", 0),
        liked_count=counts.get("liked", 0),
        created_at=user.created_at.isoformat(),
    )


@router.get("", response_model=list[UserProfileResponse])
async def list_users(db: DBSession) -> Any:
    """List registered users / personas."""
    res = await db.execute(select(User).order_by(User.interaction_count.desc(), User.created_at.desc()).limit(20))
    users = res.scalars().all()

    profiles = []
    for u in users:
        # Count stats
        stmt = (
            select(Interaction.event_type, func.count(Interaction.id))
            .where(Interaction.user_id == u.id)
            .group_by(Interaction.event_type)
        )
        counts = dict((await db.execute(stmt)).all())

        display_name = u.username or f"user_{str(u.id)[:8]}"
        profiles.append(
            UserProfileResponse(
                id=u.id,
                username=display_name,
                cold_start_tier=u.cold_start_tier,
                interaction_count=u.interaction_count,
                watched_count=counts.get("watched", 0),
                liked_count=counts.get("liked", 0),
                created_at=u.created_at.isoformat(),
            )
        )

    return profiles
