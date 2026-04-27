import sqlalchemy
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlmodel import SQLModel
from sqlalchemy.orm import sessionmaker
import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def init_db():
    """
    Creates all new blog tables and applies additive column migrations.
    Old chat/tweet tables are left untouched.
    """
    # Import all models so SQLModel.metadata knows about them
    from models.models import (  # noqa: F401
        User, BlogCategory, BlogPost, BlogTag, BlogPostTag,
        BlogLike, BlogComment, BlogMedia, BlogPostView,
    )

    # Step 1: create new tables in its own transaction
    try:
        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
    except Exception as e:
        print(f"create_all note: {e}")

    # Step 2: additive column migrations — each gets its own transaction so a
    # failure in one doesn't abort the others (asyncpg aborts the whole
    # connection on error if they share a transaction).
    migrations = [
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS website_url VARCHAR(300)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS twitter_handle VARCHAR(50)',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS post_count INTEGER NOT NULL DEFAULT 0',
        'ALTER TABLE "user" ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE',
        # Ensure 'author' exists in the enum before we update rows to use it.
        "ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'author'",
        # Cast to text so we don't hit enum-type errors if 'intern' was never
        # a valid value in this DB's userrole enum.
        "UPDATE \"user\" SET role = 'author' WHERE role::text = 'intern'",
    ]
    for sql in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(sqlalchemy.text(sql))
        except Exception as e:
            print(f"Migration note ({sql[:50]}…): {e}")


async def get_session():
    async with async_session() as session:
        yield session
