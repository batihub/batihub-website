# ─────────────────────────────────────────────────────────────────────────────
# main.py  — add/replace your startup section with this
# ─────────────────────────────────────────────────────────────────────────────
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.ext.asyncio import AsyncEngine

from core.database import engine, get_session
from core.security import get_password_hash
from models.models import SQLModel, User, UserRole

# Import all routers
from routers.chat  import router as chat_router
from routers.admin import router as admin_router
from routers.tweet import router as tweet_router


# ── Root bootstrap ────────────────────────────────────────────────────────────
async def _bootstrap_root(session: AsyncSession):
    """
    Creates the ROOT user once on first run.
    Set ROOT_PASSWORD in Render → Environment Variables.
    Never hardcode credentials here.
    """
    result = await session.exec(select(User).where(User.role == UserRole.ROOT))
    if result.first():
        return  # root already exists — do nothing

    root_password = os.environ.get("ROOT_PASSWORD")
    if not root_password:
        print("⚠️  ROOT_PASSWORD env var not set — skipping root bootstrap")
        return

    root = User(
        username="root",
        password_hash=get_password_hash(root_password),
        role=UserRole.ROOT,
        display_name="Root",
    )
    session.add(root)
    await session.commit()
    print("✅ Root user created — username: root")


# ── App lifespan (replaces @app.on_event which is deprecated) ─────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Create all tables (safe to run every startup — skips existing tables)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

    # Seed root user
    async with AsyncSession(engine) as session:
        await _bootstrap_root(session)

    yield  # ← app runs here

    # Shutdown cleanup (add anything needed on shutdown here)


# ── App instance ──────────────────────────────────────────────────────────────
app = FastAPI(title="baerhub API", lifespan=lifespan)

# Set ALLOWED_ORIGINS in Render → Environment Variables (comma-separated).
# Example: "https://beelog-poes.onrender.com,https://www.myblog.com"
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "https://beelog-poes.onrender.com")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Register routers ──────────────────────────────────────────────────────────
app.include_router(chat_router)
app.include_router(admin_router)
app.include_router(tweet_router)