import json
import jwt
from typing import List
from datetime import timedelta

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
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


# ── WebSocket connection manager ──────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)


manager = ConnectionManager()


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws/chat")
async def websocket_endpoint(
        websocket: WebSocket,
        token: str,
        session: AsyncSession = Depends(get_session),
):
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

    await manager.connect(websocket)
    await manager.broadcast(json.dumps({"type": "system", "text": f"{username} has joined the room"}))

    try:
        while True:
            data = await websocket.receive_text()
            msg = Message(message=data, sender_id=user_id, room_id="general")
            session.add(msg)
            await session.commit()
            await session.refresh(msg)

            await manager.broadcast(json.dumps({
                "type": "chat",
                "username": username,
                "text": data,
                "timestamp": msg.created_at.isoformat(),
            }))
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(json.dumps({"type": "system", "text": f"{username} has left the room"}))


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


# ── Chat logs (protected) ─────────────────────────────────────────────────────

@router.get("/chat_logs")
async def chat_history(
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    logs = await crud.get_chat_logs(session=session)
    if not logs:
        raise HTTPException(status_code=404, detail="No chat logs found")
    return logs
