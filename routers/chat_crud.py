from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from models.models import Message, User


async def create_user(session: AsyncSession, user_data: User) -> User:
    session.add(user_data)
    await session.commit()
    await session.refresh(user_data)
    return user_data


async def get_user_by_username(session: AsyncSession, username: str):
    result = await session.execute(select(User).where(User.username == username))
    return result.scalars().one_or_none()


async def get_chat_logs(session: AsyncSession, room_id: str = None):
    statement = (
        select(Message, User.username)
        .join(User, Message.sender_id == User.id)
        .order_by(Message.created_at)
    )
    if room_id:
        statement = statement.where(Message.room_id == room_id)
    result = await session.execute(statement)

    logs = []
    for message, username in result.all():
        logs.append({
            "id": message.id,
            "text": message.message,
            "sender_id": message.sender_id,
            "username": username,
            "timestamp": message.created_at.isoformat(),
            "type": "chat",
        })
    return logs
