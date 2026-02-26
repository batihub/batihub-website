from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import SQLModel
from sqlalchemy.orm import sessionmaker

# Single database for the whole app.
# Swap this out for PostgreSQL in production:
#   DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost/dbname")
DATABASE_URL = "sqlite+aiosqlite:///./app.db"

engine = create_async_engine(
    DATABASE_URL,
    echo=True,
    # SQLite-only: allows the async engine to share connections across threads.
    # Remove this line when switching to PostgreSQL.
    connect_args={"check_same_thread": False},
)

async_session = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db():
    """Creates all tables on startup. SQLModel.metadata covers every model
    that has been imported by the time this runs, so make sure all model
    modules are imported before calling this (main.py handles that)."""
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def get_session():
    async with async_session() as session:
        yield session
