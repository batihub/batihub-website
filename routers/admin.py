# routers/admin.py
# Mount in main.py with: app.include_router(admin_router)

import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import get_current_user, ROLE_HIERARCHY
from models.models import User, UserRole, Room, RoomMember, Message, Tweet

from schemas.schemas import UserSession

router = APIRouter(prefix="/admin", tags=["Admin"])


# ── Role guards ───────────────────────────────────────────────────────────────

def require_admin(current_user: UserSession = Depends(get_current_user)) -> UserSession:
    if ROLE_HIERARCHY.get(current_user.role, 0) < ROLE_HIERARCHY[UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Admin or Root access required")
    return current_user


def require_root(current_user: UserSession = Depends(get_current_user)) -> UserSession:
    if current_user.role != UserRole.ROOT:
        raise HTTPException(status_code=403, detail="Root access required")
    return current_user


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats")
async def get_stats(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    """Quick-glance counts for the dashboard header cards."""
    users  = await session.exec(select(User))
    tweets = await session.exec(select(Tweet).where(Tweet.is_deleted == False))
    rooms  = await session.exec(select(Room))
    admins = await session.exec(
        select(User).where(User.role.in_([UserRole.ADMIN, UserRole.ROOT]))
    )
    return {
        "total_users":  len(users.all()),
        "total_tweets": len(tweets.all()),
        "total_rooms":  len(rooms.all()),
        "total_admins": len(admins.all()),
    }


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    result = await session.exec(select(User).order_by(User.created_at.desc()))
    users  = result.all()
    return [
        {
            "id":           u.id,
            "username":     u.username,
            "display_name": u.display_name,
            "role":         u.role,
            "tweet_count":  u.tweet_count,
            "created_at":   u.created_at.isoformat(),
        }
        for u in users
    ]


@router.patch("/users/{user_id}/role")
async def change_user_role(
    user_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_root),   # ROOT only
):
    new_role = body.get("role", "").strip()
    valid_assignable = [UserRole.INTERN.value, UserRole.ADMIN.value]

    if new_role not in valid_assignable:
        raise HTTPException(400, f"Role must be one of: {valid_assignable}")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.ROOT:
        raise HTTPException(403, "Cannot change ROOT's role")
    if user.id == current_user.id:
        raise HTTPException(400, "Cannot change your own role")

    user.role = UserRole(new_role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return {"id": user.id, "username": user.username, "role": user.role}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_root),   # ROOT only
):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.ROOT:
        raise HTTPException(403, "Cannot delete ROOT user")
    if user.id == current_user.id:
        raise HTTPException(400, "Cannot delete yourself")

    # Soft-delete tweets instead of hard deleting to preserve counts/context
    tweets = await session.exec(select(Tweet).where(Tweet.author_id == user_id))
    for t in tweets.all():
        t.is_deleted = True
        session.add(t)

    await session.delete(user)
    await session.commit()


# ── Rooms ─────────────────────────────────────────────────────────────────────

@router.get("/rooms")
async def list_all_rooms(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    rooms = await session.exec(select(Room).order_by(Room.created_at.desc()))
    result = []
    for r in rooms.all():
        # Get owner username
        owner = await session.get(User, r.owner_id)
        # Get member count
        members = await session.exec(
            select(RoomMember).where(RoomMember.room_id == r.id)
        )
        result.append({
            "id":             r.id,
            "name":           r.name,
            "type":           r.type,
            "owner_id":       r.owner_id,
            "owner_username": owner.username if owner else None,
            "member_count":   len(members.all()),
            "locked":         r.locked,
            "created_at":     r.created_at.isoformat(),
        })
    return result


@router.patch("/rooms/{room_id}/lock")
async def toggle_room_lock(
    room_id: str,
    body: dict,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    room = await session.get(Room, room_id)
    if not room:
        raise HTTPException(404, "Room not found")

    room.locked = body.get("locked", not room.locked)
    session.add(room)
    await session.commit()
    return {"id": room.id, "locked": room.locked}


# ── Messages ──────────────────────────────────────────────────────────────────

@router.get("/messages")
async def list_recent_messages(
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    messages = await session.exec(
        select(Message).order_by(Message.created_at.desc()).limit(limit)
    )
    result = []
    for m in messages.all():
        sender = await session.get(User, m.sender_id) if m.sender_id else None
        room   = await session.get(Room, m.room_id)
        result.append({
            "id":              m.id,
            "message":         m.message,
            "sender_id":       m.sender_id,
            "sender_username": sender.username if sender else "deleted",
            "room_id":         m.room_id,
            "room_name":       room.name if room else m.room_id,
            "created_at":      m.created_at.isoformat(),
        })
    return result