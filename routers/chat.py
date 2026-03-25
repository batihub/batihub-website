import uuid
import json
import jwt
from typing import List, Dict, Optional
from datetime import timedelta, datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy import select

from core.database import get_session
from core.security import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
)
from models.models import Message, User, Room, RoomMember, RoomType, UserRole
from schemas.schemas import (
    UserResponse, UserCreate, Token, UserSession,
    GroupRoomCreate, PrivateRoomCreate, PrivateUserInvite,
    RoomOut, RoomDetailOut,
    PublicKeyUpdate, RoomKeyBundleIn,
)
import crud.chat_crud as crud

router = APIRouter(tags=["Live Chat & Auth"])


# ── Per-room WebSocket connection manager ─────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        # room_id -> list of {"ws": WebSocket, "username": str, "user_id": int}
        self._rooms: Dict[str, List[dict]] = {}

    def _ensure_room(self, room_id: str):
        if room_id not in self._rooms:
            self._rooms[room_id] = []

    async def connect(self, websocket: WebSocket, room_id: str, username: str, user_id: int):
        await websocket.accept()
        self._ensure_room(room_id)
        self._rooms[room_id].append({"ws": websocket, "username": username, "user_id": user_id})

    def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self._rooms:
            self._rooms[room_id] = [
                c for c in self._rooms[room_id] if c["ws"] is not websocket
            ]

    async def broadcast(self, room_id: str, payload: dict, exclude: WebSocket = None):
        if room_id not in self._rooms:
            return
        text = json.dumps(payload)
        dead = []
        for conn in self._rooms[room_id]:
            if conn["ws"] is exclude:
                continue
            try:
                await conn["ws"].send_text(text)
            except Exception:
                dead.append(conn["ws"])
        for ws in dead:
            self._rooms[room_id] = [c for c in self._rooms[room_id] if c["ws"] is not ws]

    def online_count(self, room_id: str) -> int:
        return len(self._rooms.get(room_id, []))

    def online_users(self, room_id: str) -> List[str]:
        return [c["username"] for c in self._rooms.get(room_id, [])]


manager = ConnectionManager()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _new_id() -> str:
    return str(uuid.uuid4())


async def _get_room_or_404(session: AsyncSession, room_id: str) -> Room:
    room = await crud.get_room_by_id(session=session, room_id=room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


async def _assert_member(session: AsyncSession, room_id: str, user_id: int):
    """Raise 403 if user is not a member of the room."""
    member = await crud.get_room_member(session=session, room_id=room_id, user_id=user_id)
    if member is None:
        raise HTTPException(status_code=403, detail="You are not a member of this room")


async def _assert_owner_or_admin(room: Room, current_user: UserSession):
    """Raise 403 unless caller is the room owner or has admin/root app-role."""
    from core.security import ROLE_HIERARCHY
    is_privileged = ROLE_HIERARCHY.get(current_user.role, 0) >= ROLE_HIERARCHY[UserRole.ADMIN]
    if room.owner_id != current_user.id and not is_privileged:
        raise HTTPException(status_code=403, detail="Only the room owner or an admin can do this")


# ── Room endpoints ────────────────────────────────────────────────────────────

@router.get("/rooms", response_model=List[RoomOut])
async def list_rooms(
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """
    Returns all rooms the current user is a member of,
    enriched with live online counts from the connection manager.
    """
    rooms = await crud.get_rooms_for_user(session=session, user_id=current_user.id)
    result = []
    for room in rooms:
        result.append(RoomOut(
            id=room.id,
            type=room.type,
            name=room.name,
            description=room.description,
            owner_id=room.owner_id,
            locked=room.locked,
            created_at=room.created_at,
            member_count=await crud.get_member_count(session=session, room_id=room.id),
            online_count=manager.online_count(room.id),
            online_users=manager.online_users(room.id),
        ))
    return result


@router.post("/rooms/group", status_code=201, response_model=RoomOut)
async def create_group_room(
        body: GroupRoomCreate,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    name = body.name.strip().lower().replace(" ", "-")
    description = body.description.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Room name is required")
    if len(name) > 32:
        raise HTTPException(status_code=400, detail="Room name max 32 characters")

    # Check uniqueness among group rooms only
    existing = await crud.get_group_room_by_name(session=session, name=name)
    if existing:
        raise HTTPException(status_code=409, detail=f"Group room '{name}' already exists")

    room_id = _new_id()
    room = Room(
        id=room_id,
        type=RoomType.GROUP,
        name=name,
        description=description,
        owner_id=current_user.id,
        locked=False,
    )
    session.add(room)

    # Creator is automatically a member and admin of the group
    session.add(RoomMember(room_id=room_id, user_id=current_user.id, is_admin=True))

    await session.commit()
    await session.refresh(room)
    return RoomOut(
        **room.model_dump(),
        member_count=1,
        online_count=0,
        online_users=[],
    )


@router.post("/rooms/private", status_code=201, response_model=RoomOut)
async def create_private_chat(
        body: PrivateRoomCreate,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    # Validate target user exists
    target = await crud.get_user_by_username(session=session, username=body.username)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")

    # Can't DM yourself
    if body.username == current_user.username:
        raise HTTPException(status_code=400, detail="Cannot create a private chat with yourself")

    # Canonical key — sorted so Alice→Bob and Bob→Alice are always the same room
    a, b = sorted([current_user.username, body.username])
    canonical_key = f"private:{a}:{b}"

    # Idempotent — return existing room if already created
    existing = await crud.get_room_by_canonical_key(session=session, key=canonical_key)
    if existing:
        return RoomOut(
            **existing.model_dump(),
            member_count=2,
            online_count=manager.online_count(existing.id),
            online_users=manager.online_users(existing.id),
        )

    room_id = _new_id()
    room = Room(
        id=room_id,
        type=RoomType.PRIVATE,
        name=canonical_key,
        canonical_key=canonical_key,
        description=f"Private chat between {a} and {b}",
        owner_id=current_user.id,
        locked=False,
    )
    session.add(room)
    session.add(RoomMember(room_id=room_id, user_id=current_user.id, is_admin=False))
    session.add(RoomMember(room_id=room_id, user_id=target.id, is_admin=False))

    await session.commit()
    await session.refresh(room)
    return RoomOut(
        **room.model_dump(),
        member_count=2,
        online_count=0,
        online_users=[],
    )


@router.get("/rooms/{room_id}", response_model=RoomDetailOut)
async def get_room(
        room_id: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    room = await _get_room_or_404(session, room_id)
    await _assert_member(session, room_id, current_user.id)

    members = await crud.get_room_members_with_users(session=session, room_id=room_id)
    return RoomDetailOut(
        **room.model_dump(),
        member_count=len(members),
        online_count=manager.online_count(room_id),
        online_users=manager.online_users(room_id),
        members=[
            {"user_id": m.user_id, "username": m.user.username,
             "is_admin": m.is_admin, "joined_at": m.joined_at}
            for m in members
        ],
    )


@router.post("/rooms/{room_id}/join", status_code=200)
async def join_group_room(
        room_id: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """Join a public group room. Private rooms require an invite — use POST /rooms/private."""
    room = await _get_room_or_404(session, room_id)

    if room.type != RoomType.GROUP:
        raise HTTPException(status_code=400, detail="Cannot join a private room this way")
    if room.locked:
        raise HTTPException(status_code=403, detail="This room is locked")

    already = await crud.get_room_member(session=session, room_id=room_id, user_id=current_user.id)
    if already:
        return {"detail": "Already a member"}

    session.add(RoomMember(room_id=room_id, user_id=current_user.id, is_admin=False))
    await session.commit()
    return {"detail": "Joined successfully"}


@router.delete("/rooms/{room_id}/leave", status_code=204)
async def leave_room(
        room_id: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    room = await _get_room_or_404(session, room_id)
    member = await crud.get_room_member(session=session, room_id=room_id, user_id=current_user.id)
    if not member:
        raise HTTPException(status_code=400, detail="You are not a member of this room")
    if room.owner_id == current_user.id:
        raise HTTPException(status_code=400, detail="Owner cannot leave — transfer ownership or delete the room")

    await session.delete(member)
    await session.commit()


@router.delete("/rooms/{room_id}", status_code=204)
async def delete_room(
        room_id: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    room = await _get_room_or_404(session, room_id)
    await _assert_owner_or_admin(room, current_user)

    await crud.delete_room(session=session, room=room)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/chat")
async def websocket_endpoint(
        websocket: WebSocket,
        token: str,
        room: str = Query(..., description="Room UUID to connect to"),
        session: AsyncSession = Depends(get_session),
):
    # ── 1. Authenticate via JWT ───────────────────────────────────────────────
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        user_id: int = payload.get("id")
        user_role: str = payload.get("role")
        if not username or not user_id or not user_role:
            await websocket.close(code=1008)
            return
    except jwt.PyJWTError:
        await websocket.close(code=1008)
        return

    # ── 2. Room must exist in DB ──────────────────────────────────────────────
    room_record = await crud.get_room_by_id(session=session, room_id=room)
    if room_record is None:
        await websocket.close(code=4004)
        return

    # ── 3. Caller must be a member of the room ────────────────────────────────
    membership = await crud.get_room_member(session=session, room_id=room, user_id=user_id)
    if membership is None:
        await websocket.close(code=4003)
        return

    # ── 4. Locked rooms — only admins / room-admins can write ─────────────────
    # (connection is allowed; the broadcast gate is inside the loop below)
    is_room_admin = membership.is_admin

    await manager.connect(websocket, room, username, user_id)
    await manager.broadcast(room, {
        "type": "system",
        "text": f"{username} joined",
        "room": room,
        "users": manager.online_users(room),
    })

    try:
        while True:
            data = await websocket.receive_text()
            data = data.strip()
            if not data:
                continue

            # Locked room guard
            if room_record.locked and not is_room_admin:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "text": "This room is locked — only admins can send messages",
                }))
                continue

            msg = Message(message=data, sender_id=user_id, room_id=room)
            session.add(msg)
            await session.commit()
            await session.refresh(msg)

            await manager.broadcast(room, {
                "type": "chat",
                "username": username,
                "text": data,
                "timestamp": msg.created_at.isoformat(),
                "room": room,
            })

    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        await manager.broadcast(room, {
            "type": "system",
            "text": f"{username} left",
            "room": room,
            "users": manager.online_users(room),
        })


# ── Auth endpoints ────────────────────────────────────────────────────────────

@router.post("/token", response_model=Token)
async def login(
        form_data: OAuth2PasswordRequestForm = Depends(),
        session: AsyncSession = Depends(get_session),
):
    user = await crud.get_user_by_username(session=session, username=form_data.username)
    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(
            status_code=401,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role, "id": user.id},
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": access_token, "token_type": "bearer"}


@router.post("/user", response_model=UserResponse)
async def create_user(
        user_input: UserCreate,
        session: AsyncSession = Depends(get_session),
):
    existing = await crud.get_user_by_username(session=session, username=user_input.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already taken")

    new_user = User(
        username=user_input.username,
        password_hash=get_password_hash(user_input.password),
        role=user_input.role,
        display_name=user_input.display_name,
    )
    result = await crud.create_user(session=session, user_data=new_user)
    if result is None:
        raise HTTPException(status_code=500, detail="Failed to create user")
    return result


# ── Chat logs ─────────────────────────────────────────────────────────────────

@router.get("/chat_logs")
async def chat_history(
        room: Optional[str] = Query(default=None, description="Room UUID to filter by"),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    """
    Returns chat history. If a room is specified, validates the caller is a member
    before returning — no peeking into rooms you don't belong to.
    """
    if room:
        room_record = await crud.get_room_by_id(session=session, room_id=room)
        if room_record is None:
            raise HTTPException(status_code=404, detail="Room not found")
        await _assert_member(session, room, current_user.id)

    logs = await crud.get_chat_logs(session=session, room_id=room)
    if not logs:
        raise HTTPException(status_code=404, detail="No chat logs found")
    return logs


# ── E2EE key management ───────────────────────────────────────────────────────

@router.put("/users/me/public-key", status_code=200)
async def set_my_public_key(
        body: PublicKeyUpdate,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """
    Store the caller's ECDH P-256 public key (JWK JSON string).
    Called once per device on login. Idempotent — safe to call again.
    The server stores only the PUBLIC key; private keys never leave the browser.
    """
    await crud.set_user_public_key(
        session=session, user_id=current_user.id, public_key=body.public_key
    )
    return {"detail": "ok"}


@router.get("/users/{username}/public-key")
async def get_user_public_key(
        username: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """
    Fetch another user's ECDH public key. Authentication required —
    prevents unauthenticated public-key harvesting.
    Returns {"public_key": null} if the user has never set up E2EE.
    """
    user = await crud.get_user_by_username(session=session, username=username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return {"public_key": user.public_key}


@router.get("/rooms/{room_id}/my-key")
async def get_my_room_key(
        room_id: str,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """
    Fetch the caller's ECIES-wrapped group room key.
    Returns {"encrypted_key": null} if no bundle has been distributed yet.
    """
    await _assert_member(session, room_id, current_user.id)
    encrypted_key = await crud.get_room_key_bundle(
        session=session, room_id=room_id, user_id=current_user.id
    )
    return {"encrypted_key": encrypted_key}


@router.put("/rooms/{room_id}/key-bundles", status_code=200)
async def set_room_key_bundles(
        room_id: str,
        body: RoomKeyBundleIn,
        current_user: UserSession = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
):
    """
    Store ECIES-wrapped room keys for a set of members.
    body.bundles = { username: { ephemeral_pub: JWK, iv: base64, ct: base64 } }

    Only room members can call this (the room creator is expected to do so on
    first entry). The server stores opaque ciphertext — it cannot read the key.
    """
    await _get_room_or_404(session, room_id)
    await _assert_member(session, room_id, current_user.id)

    for username, bundle_data in body.bundles.items():
        user = await crud.get_user_by_username(session=session, username=username)
        if user is None:
            continue
        # Verify the target user is actually a member of this room
        if not await crud.get_room_member(session=session, room_id=room_id, user_id=user.id):
            continue
        await crud.upsert_room_key_bundle(
            session=session,
            room_id=room_id,
            user_id=user.id,
            encrypted_key=json.dumps(bundle_data),
        )
    return {"detail": "ok"}