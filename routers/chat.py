import json
import jwt
from typing import List, Dict, Optional
from datetime import timedelta, datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordRequestForm
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import (
    get_password_hash, verify_password, create_access_token,
    get_current_user, SECRET_KEY, ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES,
)
from models.models import Message, User
from schemas.schemas import UserResponse, UserCreate, Token, UserSession
import crud.chat_crud as crud

router = APIRouter(tags=["Live Chat & Auth"])


# ── In-memory room registry ───────────────────────────────────────────────────

_rooms: Dict[str, dict] = {
    "general": {
        "name": "general",
        "description": "Main public room",
        "owner": "system",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "locked": False,
    }
}


# ── Per-room connection manager ───────────────────────────────────────────────

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

    async def broadcast(self, room_id: str, message: str, exclude: WebSocket = None):
        if room_id not in self._rooms:
            return
        dead = []
        for conn in self._rooms[room_id]:
            if conn["ws"] is exclude:
                continue
            try:
                await conn["ws"].send_text(message)
            except Exception:
                dead.append(conn["ws"])
        for ws in dead:
            self._rooms[room_id] = [c for c in self._rooms[room_id] if c["ws"] is not ws]

    def online_count(self, room_id: str) -> int:
        return len(self._rooms.get(room_id, []))

    def online_users(self, room_id: str) -> List[str]:
        return [c["username"] for c in self._rooms.get(room_id, [])]


manager = ConnectionManager()


# ── Room endpoints ────────────────────────────────────────────────────────────

@router.get("/rooms")
async def list_rooms():
    """List all rooms with online user counts."""
    return [
        {**room, "online": manager.online_count(name), "users": manager.online_users(name)}
        for name, room in _rooms.items()
    ]


@router.post("/rooms", status_code=201)
async def create_room(
        body: dict,
        current_user: UserSession = Depends(get_current_user),
):
    name: str = body.get("name", "").strip().lower().replace(" ", "-")
    description: str = body.get("description", "").strip()

    if not name:
        raise HTTPException(400, "Room name is required")
    if len(name) > 32:
        raise HTTPException(400, "Room name max 32 characters")
    if name in _rooms:
        raise HTTPException(409, f"Room '{name}' already exists")

    _rooms[name] = {
        "name": name,
        "description": description,
        "owner": current_user.username,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "locked": False,
    }
    return _rooms[name]


@router.delete("/rooms/{room_name}", status_code=204)
async def delete_room(
        room_name: str,
        current_user: UserSession = Depends(get_current_user),
):
    if room_name == "general":
        raise HTTPException(403, "Cannot delete the general room")
    if room_name not in _rooms:
        raise HTTPException(404, "Room not found")

    room = _rooms[room_name]
    # Owner or admin/root can delete
    from core.security import ROLE_HIERARCHY
    from models.models import UserRole
    is_privileged = ROLE_HIERARCHY.get(current_user.role, 0) >= ROLE_HIERARCHY[UserRole.ADMIN]
    if room["owner"] != current_user.username and not is_privileged:
        raise HTTPException(403, "Only the room owner or an admin can delete this room")

    del _rooms[room_name]


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/chat")
async def websocket_endpoint(
        websocket: WebSocket,
        token: str,
        room: str = Query(default="general"),
        session: AsyncSession = Depends(get_session),
):
    # Authenticate
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

    # Room must exist
    if room not in _rooms:
        await websocket.close(code=4004)
        return

    await manager.connect(websocket, room, username, user_id)
    await manager.broadcast(room, json.dumps({
        "type": "system",
        "text": f"{username} joined",
        "room": room,
        "users": manager.online_users(room),
    }))

    try:
        while True:
            data = await websocket.receive_text()
            if not data.strip():
                continue

            msg = Message(message=data, sender_id=user_id, room_id=room)
            session.add(msg)
            await session.commit()
            await session.refresh(msg)

            await manager.broadcast(room, json.dumps({
                "type": "chat",
                "username": username,
                "text": data,
                "timestamp": msg.created_at.isoformat(),
                "room": room,
            }))
    except WebSocketDisconnect:
        manager.disconnect(websocket, room)
        await manager.broadcast(room, json.dumps({
            "type": "system",
            "text": f"{username} left",
            "room": room,
            "users": manager.online_users(room),
        }))


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


# ── Chat logs (protected, filterable by room) ─────────────────────────────────

@router.get("/chat_logs")
async def chat_history(
        room: Optional[str] = Query(default=None),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    logs = await crud.get_chat_logs(session=session, room_id=room)
    if not logs:
        raise HTTPException(status_code=404, detail="No chat logs found")
    return logs
