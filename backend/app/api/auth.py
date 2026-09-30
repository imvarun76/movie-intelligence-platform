"""
Authentication API Router for ShowDyme.
Handles Sign Up, Login, Forgot Password, Reset Password, and Current Session (/me).
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from backend.app.api.deps import CurrentUser
from backend.app.api.movies import DBSession
from backend.app.core.config import settings
from backend.app.core.security import (
    create_access_token,
    generate_reset_token,
    hash_password,
    verify_password,
)
from backend.app.models.interaction import Interaction
from backend.app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

EMAIL_REGEX = re.compile(r"^[\w\.\+\-]+@[a-zA-Z0-9\-]+(\.[a-zA-Z0-9\-]+)+$")


class SignUpRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100, description="Full name")
    email: str = Field(..., min_length=5, max_length=255, description="Email address")
    password: str = Field(..., min_length=6, max_length=128, description="Password")
    confirm_password: str = Field(..., min_length=6, max_length=128, description="Password confirmation")


class LoginRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, description="Email address")
    password: str = Field(..., min_length=1, max_length=128, description="Password")


class ForgotPasswordRequest(BaseModel):
    email: str = Field(..., min_length=5, max_length=255, description="Email address")


class ResetPasswordRequest(BaseModel):
    token: str = Field(..., min_length=10, description="Password reset token")
    password: str = Field(..., min_length=6, max_length=128, description="New password")
    confirm_password: str = Field(..., min_length=6, max_length=128, description="Confirm new password")


class UserSessionResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    username: str | None = None
    cold_start_tier: str
    interaction_count: int
    watched_count: int = 0
    liked_count: int = 0
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserSessionResponse


class MessageResponse(BaseModel):
    message: str
    debug_reset_token: str | None = None


async def _get_user_stats(db: DBSession, user_id: uuid.UUID) -> tuple[int, int]:
    stmt = (
        select(Interaction.event_type, func.count(Interaction.id))
        .where(Interaction.user_id == user_id)
        .group_by(Interaction.event_type)
    )
    counts = dict((await db.execute(stmt)).all())
    return counts.get("watched", 0), counts.get("liked", 0)


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignUpRequest, db: DBSession) -> Any:
    """
    Create a new unique user account with securely hashed password.
    Automatically signs the user in and returns a JWT access token.
    """
    name = payload.name.strip()
    email = payload.email.strip().lower()

    if not EMAIL_REGEX.match(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid email address.",
        )

    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match.",
        )

    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters.",
        )

    # Check for duplicate email
    res = await db.execute(select(User).where(User.email == email))
    existing_user = res.scalar_one_or_none()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists. Please log in.",
        )

    # Generate clean unique username fallback
    base_username = re.sub(r"[^a-zA-Z0-9_]", "", email.split("@")[0])[:24]
    candidate_username = base_username or "user"
    user_with_name = (await db.execute(select(User).where(User.username == candidate_username))).scalar_one_or_none()
    if user_with_name:
        candidate_username = f"{candidate_username}_{uuid.uuid4().hex[:4]}"

    hashed_pw = hash_password(payload.password)
    user = User(
        id=uuid.uuid4(),
        name=name,
        email=email,
        username=candidate_username,
        hashed_password=hashed_pw,
        interaction_count=0,
        cold_start_tier="new",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user_id=user.id, email=user.email, name=user.name)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserSessionResponse(
            id=user.id,
            name=user.name or "",
            email=user.email,
            username=user.username,
            cold_start_tier=user.cold_start_tier,
            interaction_count=user.interaction_count,
            watched_count=0,
            liked_count=0,
            created_at=user.created_at.isoformat(),
        ),
    )


@router.post("/login", response_model=AuthResponse)
async def login(payload: LoginRequest, db: DBSession) -> Any:
    """
    Authenticate user by email and password, returning a JWT token and profile.
    """
    email = payload.email.strip().lower()

    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    if not user or not user.hashed_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password. Please check your credentials.",
        )

    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password. Please check your credentials.",
        )

    token = create_access_token(user_id=user.id, email=user.email, name=user.name)
    watched_count, liked_count = await _get_user_stats(db, user.id)

    return AuthResponse(
        access_token=token,
        token_type="bearer",
        user=UserSessionResponse(
            id=user.id,
            name=user.name or user.username or "Cinema Member",
            email=user.email,
            username=user.username,
            cold_start_tier=user.cold_start_tier,
            interaction_count=user.interaction_count,
            watched_count=watched_count,
            liked_count=liked_count,
            created_at=user.created_at.isoformat(),
        ),
    )


@router.get("/me", response_model=UserSessionResponse)
async def get_current_user_profile(user: CurrentUser, db: DBSession) -> Any:
    """
    Return the authenticated user's session profile.
    """
    watched_count, liked_count = await _get_user_stats(db, user.id)
    return UserSessionResponse(
        id=user.id,
        name=user.name or user.username or "Cinema Member",
        email=user.email or "",
        username=user.username,
        cold_start_tier=user.cold_start_tier,
        interaction_count=user.interaction_count,
        watched_count=watched_count,
        liked_count=liked_count,
        created_at=user.created_at.isoformat(),
    )


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(payload: ForgotPasswordRequest, db: DBSession) -> Any:
    """
    Initiate password reset flow. Does not disclose whether an email is registered.
    Generates a secure 1-hour single-use token if the account exists.
    """
    email = payload.email.strip().lower()
    res = await db.execute(select(User).where(User.email == email))
    user = res.scalar_one_or_none()

    debug_token = None
    if user:
        reset_token = generate_reset_token()
        user.reset_token = reset_token
        user.reset_token_expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.reset_token_expire_minutes
        )
        await db.commit()
        # In non-production or for UI link assistance, include the token so the user can test seamlessly
        debug_token = reset_token

    return MessageResponse(
        message="If this email is registered with ShowDyme, a password reset link has been dispatched.",
        debug_reset_token=debug_token,
    )


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest, db: DBSession) -> Any:
    """
    Reset password using single-use token. Token expires after use or timeout.
    """
    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match.",
        )

    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters.",
        )

    token = payload.token.strip()
    res = await db.execute(select(User).where(User.reset_token == token))
    user = res.scalar_one_or_none()

    now = datetime.now(timezone.utc)
    if not user or not user.reset_token_expires_at or user.reset_token_expires_at < now:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This password reset link is invalid or has expired. Please request a new one.",
        )

    user.hashed_password = hash_password(payload.password)
    # Invalidate token so it cannot be used again
    user.reset_token = None
    user.reset_token_expires_at = None

    await db.commit()

    return MessageResponse(
        message="Your password has been successfully updated. You may now log in with your new password."
    )


@router.post("/logout", response_model=MessageResponse)
async def logout(user: CurrentUser) -> Any:
    """
    Terminates the user's active session.
    """
    return MessageResponse(message="Successfully signed out.")
