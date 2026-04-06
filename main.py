import os
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse, Response
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import engine, get_session
from core.security import get_password_hash
from models.models import User, UserRole, BlogPost, PostStatus

from routers.auth  import router as auth_router
from routers.posts import router as posts_router
from routers.admin import router as admin_router


# ── Root bootstrap ────────────────────────────────────────────────────────────

async def _bootstrap_root(session: AsyncSession):
    result = await session.exec(select(User).where(User.role == UserRole.ROOT))
    if result.first():
        return

    root_password = os.environ.get("ROOT_PASSWORD")
    if not root_password:
        print("WARNING: ROOT_PASSWORD env var not set — skipping root bootstrap")
        return

    root = User(
        username="root",
        password_hash=get_password_hash(root_password),
        role=UserRole.ROOT,
        display_name="Root",
    )
    session.add(root)
    await session.commit()
    print("Root user created — username: root")


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    from core.database import init_db
    await init_db()
    async with AsyncSession(engine) as session:
        await _bootstrap_root(session)
    yield


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="BeeLog API", lifespan=lifespan)

_raw_origins = os.environ.get(
    "ALLOWED_ORIGINS",
    "https://beelog-poes.onrender.com,https://batihanbabacan.com",
)
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── SEO / Meta endpoints ──────────────────────────────────────────────────────

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/blog.html", status_code=301)


@app.get("/robots.txt", include_in_schema=False)
async def robots_txt():
    base = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "https://beelog-poes.onrender.com"
    content = (
        "User-agent: *\n"
        "Allow: /blog.html\n"
        "Allow: /post.html\n"
        "Allow: /profile.html\n"
        "Disallow: /admin.html\n"
        "Disallow: /admin/\n"
        "Disallow: /token\n"
        "Disallow: /auth/\n"
        "\n"
        f"Sitemap: {base}/sitemap-blog.xml\n"
    )
    return PlainTextResponse(content)


@app.get("/sitemap-blog.xml", include_in_schema=False)
async def sitemap_blog(session: AsyncSession = Depends(get_session)):
    base = ALLOWED_ORIGINS[0] if ALLOWED_ORIGINS else "https://beelog-poes.onrender.com"

    result = await session.exec(
        select(BlogPost)
        .where(BlogPost.status == PostStatus.PUBLISHED)
        .order_by(BlogPost.published_at.desc())
        .limit(1000)
    )
    posts = result.all()

    def _xe(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

    url_blocks = "\n".join(
        f"  <url>\n"
        f"    <loc>{base}/post.html?slug={_xe(p.slug)}</loc>\n"
        f"    <lastmod>{(p.published_at or p.updated_at).strftime('%Y-%m-%d')}</lastmod>\n"
        f"    <changefreq>weekly</changefreq>\n"
        f"    <priority>0.8</priority>\n"
        f"  </url>"
        for p in posts
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


# Keep old sitemap-feed.xml alive so CF Pages function doesn't 404
@app.get("/sitemap-feed.xml", include_in_schema=False)
async def sitemap_feed(session: AsyncSession = Depends(get_session)):
    return await sitemap_blog(session)


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth_router)
app.include_router(posts_router)
app.include_router(admin_router)
