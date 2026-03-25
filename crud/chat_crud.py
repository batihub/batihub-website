"""
crud/chat_crud.py

All database operations for the chat system.
Every function is async and takes an AsyncSession as its first argument.
"""
from http.client import HTTPException
from http.server import HTTPServer
from typing import Optional, List
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import selectinload

from models.models import User, Room, RoomMember, RoomType, Message, RoomKeyBundle


# ── User ──────────────────────────────────────────────────────────────────────

async def get_user_by_username(session: AsyncSession, username: str) -> Optional[User]:
    result = await session.exec(select(User).where(User.username == username))
    return result.first()


async def create_user(session: AsyncSession, user_data: User) -> Optional[User]:
    try:
        session.add(user_data)
        await session.commit()
        await session.refresh(user_data)
        return user_data
    except Exception:
        await session.rollback()
        return None


# ── Room ──────────────────────────────────────────────────────────────────────

async def get_room_by_id(session: AsyncSession, room_id: str) -> Optional[Room]:
    result = await session.exec(select(Room).where(Room.id == room_id))
    return result.first()


async def get_room_by_canonical_key(session: AsyncSession, key: str) -> Optional[Room]:
    """Used to find or deduplicate private (1-1) rooms."""
    result = await session.exec(select(Room).where(Room.canonical_key == key))
    return result.first()


async def get_group_room_by_name(session: AsyncSession, name: str) -> Optional[Room]:
    """Check uniqueness of group room names."""
    result = await session.exec(
        select(Room).where(Room.name == name, Room.type == RoomType.GROUP)
    )
    return result.first()


async def get_rooms_for_user(session: AsyncSession, user_id: int) -> List[Room]:
    """Return all rooms the user is a member of."""
    result = await session.exec(
        select(Room)
        .join(RoomMember, Room.id == RoomMember.room_id)
        .where(RoomMember.user_id == user_id)
        .order_by(Room.created_at.desc())
    )
    return result.all()


async def delete_room(session: AsyncSession, room: Room) -> None:
    """
    Delete a room and cascade-delete its members and messages.
    SQLModel doesn't auto-cascade by default, so we handle it explicitly.
    """
    # Delete messages
    messages = await session.exec(select(Message).where(Message.room_id == room.id))
    for msg in messages.all():
        await session.delete(msg)

    # Delete memberships
    members = await session.exec(select(RoomMember).where(RoomMember.room_id == room.id))
    for m in members.all():
        await session.delete(m)

    await session.delete(room)
    await session.commit()


# ── RoomMember ────────────────────────────────────────────────────────────────

async def get_room_member(
        session: AsyncSession, room_id: str, user_id: int
) -> Optional[RoomMember]:
    result = await session.exec(
        select(RoomMember).where(
            RoomMember.room_id == room_id,
            RoomMember.user_id == user_id,
        )
    )
    return result.first()


async def get_room_members_with_users(
        session: AsyncSession, room_id: str
) -> List[RoomMember]:
    """Return RoomMember rows with their User relationship loaded."""
    result = await session.exec(
        select(RoomMember)
        .where(RoomMember.room_id == room_id)
        .options(selectinload(RoomMember.user))
    )
    return result.all()


async def get_member_count(session: AsyncSession, room_id: str) -> int:
    result = await session.exec(
        select(RoomMember).where(RoomMember.room_id == room_id)
    )
    return len(result.all())


# ── Message ───────────────────────────────────────────────────────────────────

async def get_chat_logs(
        session: AsyncSession,
        room_id: Optional[str] = None,
        limit: int = 100,
) -> List[Message]:
    query = select(Message).order_by(Message.created_at.desc()).limit(limit)
    if room_id:
        query = query.where(Message.room_id == room_id)
    result = await session.exec(query)
    messages =  result.all()
    return messages[::-1]
"""
    result.all() → returns a list ✅
    reversed(messages) → returns a list_reverseiterator object, NOT a list ❌
 
    return list(reversed(messages))

    or just go with messages[::-1] or messages.reverse() these two return lists 
    
    Found it. Classic Python gotcha — list.reverse() mutates in-place and returns None, so your endpoint is literally returning None to FastAPI.
    messages = result.all()
    return messages.reverse()  # ❌ returns None, not the list
    
    # Re-sort oldest → newest for correct chat display
    # ❌ This gives oldest 100, not latest 100
    query = select(Message).order_by(Message.created_at.asc()).limit(limit)
    You need .desc() + limit to grab the latest 100, then reversed() to display them oldest-first.
    Switching to .asc() would give you the first 100 messages ever sent, not the most recent ones.
"""

# ── E2EE ──────────────────────────────────────────────────────────────────────

async def set_user_public_key(session: AsyncSession, user_id: int, public_key: str) -> None:
    result = await session.exec(select(User).where(User.id == user_id))
    user = result.first()
    if user:
        user.public_key = public_key
        session.add(user)
        await session.commit()


async def upsert_room_key_bundle(
        session: AsyncSession, room_id: str, user_id: int, encrypted_key: str
) -> None:
    result = await session.exec(
        select(RoomKeyBundle).where(
            RoomKeyBundle.room_id == room_id,
            RoomKeyBundle.user_id == user_id,
        )
    )
    bundle = result.first()
    if bundle:
        bundle.encrypted_key = encrypted_key
    else:
        bundle = RoomKeyBundle(room_id=room_id, user_id=user_id, encrypted_key=encrypted_key)
    session.add(bundle)
    await session.commit()


async def get_room_key_bundle(
        session: AsyncSession, room_id: str, user_id: int
) -> Optional[str]:
    result = await session.exec(
        select(RoomKeyBundle).where(
            RoomKeyBundle.room_id == room_id,
            RoomKeyBundle.user_id == user_id,
        )
    )
    bundle = result.first()
    return bundle.encrypted_key if bundle else None


async def delete_chat_log(
        session : AsyncSession,
        message_to_del_no : int,
):
    message = await session.get(Message,message_to_del_no)
    if message is None:
        raise ValueError(f"Message {message_to_del_no} not found")

    await session.delete(message)
    await session.commit()
