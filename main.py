# ─────────────────────────────────────────────────────────────────────────────
# main.py  — add/replace your startup section with this
# ─────────────────────────────────────────────────────────────────────────────
import os
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.ext.asyncio import AsyncEngine

from core.database import engine, get_session
from core.security import get_password_hash
from models.models import SQLModel, User, UserRole, Tweet

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
    # Create all tables + run additive column migrations
    from core.database import init_db
    await init_db()

    # Seed root user
    async with AsyncSession(engine) as session:
        await _bootstrap_root(session)

    yield  # ← app runs here

    # Shutdown cleanup (add anything needed on shutdown here)


# ── App instance ──────────────────────────────────────────────────────────────
app = FastAPI(title="baerhub API", lifespan=lifespan)

# Set ALLOWED_ORIGINS in Render → Environment Variables (comma-separated).
# Example: "https://beelog-poes.onrender.com,https://www.myblog.com"
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "https://beelog-poes.onrender.com,https://batihanbabacan.com")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── SEO endpoints ─────────────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/blog.html", status_code=301)


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    base = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "https://beelog-poes.onrender.com"
    content = (
        "User-agent: *\n"
        "Allow: /blog.html\n"
        "Allow: /profile.html\n"
        "Disallow: /index.html\n"
        "Disallow: /admin.html\n"
        "Disallow: /admin/\n"
        "Disallow: /ws/\n"
        "Disallow: /token\n"
        "Disallow: /user\n"
        "\n"
        f"Sitemap: {base}/sitemap-blog.xml\n"
        f"Sitemap: {base}/sitemap-feed.xml\n"
    )
    return PlainTextResponse(content)


@app.get("/sitemap-blog.xml", include_in_schema=False)
async def sitemap_blog():
    base = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "https://beelog-poes.onrender.com"
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        '  <url>\n'
        f'    <loc>{base}/blog.html</loc>\n'
        '    <changefreq>hourly</changefreq>\n'
        '    <priority>1.0</priority>\n'
        '  </url>\n'
        '</urlset>'
    )
    return Response(content=content, media_type="application/xml")


@app.get("/sitemap-feed.xml", include_in_schema=False)
async def sitemap_feed(session: AsyncSession = Depends(get_session)):
    base = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "https://beelog-poes.onrender.com"

    result = await session.exec(
        select(Tweet, User)
        .join(User, Tweet.author_id == User.id)
        .where(Tweet.is_deleted == False)
        .order_by(Tweet.created_at.desc())
        .limit(1000)
    )
    rows = result.all()

    # One entry per unique user, keyed to their most recent tweet date
    seen: dict[str, str] = {}
    for tweet, user in rows:
        if user.username not in seen:
            seen[user.username] = tweet.created_at.strftime("%Y-%m-%d")

    def _xe(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    url_blocks = "\n".join(
        f"  <url>\n"
        f"    <loc>{base}/profile.html?user={_xe(u)}</loc>\n"
        f"    <lastmod>{d}</lastmod>\n"
        f"    <changefreq>daily</changefreq>\n"
        f"    <priority>0.7</priority>\n"
        f"  </url>"
        for u, d in seen.items()
    )

    content = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        '  <url>\n'
        f'    <loc>{base}/blog.html</loc>\n'
        '    <changefreq>hourly</changefreq>\n'
        '    <priority>1.0</priority>\n'
        '  </url>\n'
        f'{url_blocks}\n'
        '</urlset>'
    )
    return Response(content=content, media_type="application/xml")


# ── Register routers ──────────────────────────────────────────────────────────
app.include_router(chat_router)
app.include_router(admin_router)
app.include_router(tweet_router)