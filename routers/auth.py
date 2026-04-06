"""
routers/auth.py — Authentication, registration, and user-profile endpoints.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import (
    create_access_token, get_current_user, get_password_hash,
    verify_password, require_root, ACCESS_TOKEN_EXPIRE_MINUTES, ROLE_HIERARCHY,
)
from models.models import User, UserRole
from schemas.schemas import Token, UserCreate, UserResponse, UserUpdate, UserProfile, UserSession
import crud.post_crud as crud

router = APIRouter(tags=["Auth"])


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/token", response_model=Token)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_session),
):
    user = await crud.get_user_by_username(session, form_data.username)
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = create_access_token(
        data={"sub": user.username, "role": user.role, "id": user.id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer"}


# ── Create user (ROOT/ADMIN only) ─────────────────────────────────────────────

@router.post("/auth/register", response_model=UserResponse, status_code=201)
async def register(
    body: UserCreate,
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_root),
):
    """Create a new author account. Only ROOT can do this."""
    existing = await crud.get_user_by_username(session, body.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    # Prevent creating ROOT via this endpoint
    if body.role == UserRole.ROOT:
        raise HTTPException(status_code=403, detail="Cannot create ROOT via API")

    user = User(
        username=body.username,
        password_hash=get_password_hash(body.password),
        role=body.role,
        display_name=body.display_name,
    )
    result = await crud.create_user(session, user)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to create user")
    return result


# ── Current user profile ──────────────────────────────────────────────────────

@router.get("/auth/me", response_model=UserProfile)
async def get_me(
    current_user: UserSession = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    user = await crud.get_user_by_id(session, current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/auth/me", response_model=UserProfile)
async def update_me(
    body: UserUpdate,
    current_user: UserSession = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    user = await crud.get_user_by_id(session, current_user.id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update_data = body.model_dump(exclude_none=True)
    for k, v in update_data.items():
        setattr(user, k, v)

    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


# ── Public author profile ─────────────────────────────────────────────────────

@router.get("/users/{username}", response_model=UserProfile)
async def get_user_profile(
    username: str,
    session: AsyncSession = Depends(get_session),
):
    user = await crud.get_user_by_username(session, username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ── Change own password ───────────────────────────────────────────────────────

@router.post("/auth/change-password", status_code=204)
async def change_password(
    body: dict,
    current_user: UserSession = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    old_password = body.get("old_password", "")
    new_password = body.get("new_password", "")

    if not old_password or not new_password:
        raise HTTPException(status_code=400, detail="Both old and new password are required")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    user = await crud.get_user_by_id(session, current_user.id)
    if not user or not verify_password(old_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    user.password_hash = get_password_hash(new_password)
    session.add(user)
    await session.commit()
