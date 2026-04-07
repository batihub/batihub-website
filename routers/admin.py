"""
routers/admin.py — Blog admin endpoints (stats, posts, categories, users, media).
"""

import os
import logging
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import get_current_user, ROLE_HIERARCHY, require_admin, require_root, require_author
from models.models import (
    User, UserRole,
    BlogPost, BlogPostTag, BlogLike, BlogComment,
    BlogCategory, BlogTag, BlogMedia,
    PostStatus,
)
from schemas.schemas import (
    UserSession, AdminStats, AdminUserOut,
    CategoryCreate, CategoryUpdate, CategoryOut,
    PostCardOut, UserPublic,
)
import crud.post_crud as crud

router = APIRouter(prefix="/admin", tags=["Admin"])

log = logging.getLogger(__name__)


# ── Stats ─────────────────────────────────────────────────────────────────────

@router.get("/stats", response_model=AdminStats)
async def get_stats(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    users_r     = await session.exec(select(func.count(User.id)))
    posts_r     = await session.exec(select(func.count(BlogPost.id)))
    pub_r       = await session.exec(
        select(func.count(BlogPost.id)).where(BlogPost.status == PostStatus.PUBLISHED)
    )
    draft_r     = await session.exec(
        select(func.count(BlogPost.id)).where(BlogPost.status == PostStatus.DRAFT)
    )
    cats_r      = await session.exec(select(func.count(BlogCategory.id)))
    comments_r  = await session.exec(
        select(func.count(BlogComment.id)).where(BlogComment.is_deleted == False)
    )
    return AdminStats(
        total_users=users_r.one(),
        total_posts=posts_r.one(),
        total_published=pub_r.one(),
        total_drafts=draft_r.one(),
        total_categories=cats_r.one(),
        total_comments=comments_r.one(),
    )


# ── Post management ───────────────────────────────────────────────────────────

@router.get("/posts")
async def list_all_posts(
    status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    q = select(BlogPost).order_by(BlogPost.created_at.desc()).limit(limit).offset(offset)
    if status:
        q = q.where(BlogPost.status == PostStatus(status))
    posts = (await session.exec(q)).all()

    result = []
    for p in posts:
        author = await session.get(User, p.author_id)
        result.append({
            "id":              p.id,
            "slug":            p.slug,
            "title":           p.title,
            "status":          p.status,
            "featured":        p.featured,
            "view_count":      p.view_count,
            "like_count":      p.like_count,
            "comment_count":   p.comment_count,
            "author_username": author.username if author else "deleted",
            "published_at":    p.published_at.isoformat() if p.published_at else None,
            "created_at":      p.created_at.isoformat(),
        })
    return result


@router.patch("/posts/{post_id}/feature")
async def toggle_feature(
    post_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    post = await session.get(BlogPost, post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    post.featured = bool(body.get("featured", not post.featured))
    session.add(post)
    await session.commit()
    return {"id": post.id, "featured": post.featured}


@router.delete("/posts/{post_id}", status_code=204)
async def admin_delete_post(
    post_id: int,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    post = await session.get(BlogPost, post_id)
    if not post:
        raise HTTPException(404, "Post not found")
    # Delete related rows first
    tags     = (await session.exec(select(BlogPostTag).where(BlogPostTag.post_id == post_id))).all()
    likes    = (await session.exec(select(BlogLike).where(BlogLike.post_id == post_id))).all()
    comments = (await session.exec(select(BlogComment).where(BlogComment.post_id == post_id))).all()
    for obj in tags + likes + comments:
        await session.delete(obj)
    await session.delete(post)
    await session.commit()


# ── User management ───────────────────────────────────────────────────────────

@router.get("/users", response_model=List[AdminUserOut])
async def list_users(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    result = await session.exec(select(User).order_by(User.created_at.desc()))
    return result.all()


@router.patch("/users/{user_id}/role")
async def change_user_role(
    user_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_root),
):
    valid_roles = [UserRole.AUTHOR.value, UserRole.ADMIN.value]
    new_role = body.get("role", "").strip()
    if new_role not in valid_roles:
        raise HTTPException(400, f"Role must be one of: {valid_roles}")

    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.ROOT:
        raise HTTPException(403, "Cannot change ROOT's role")
    if user.id == current_user.id:
        raise HTTPException(400, "Cannot change your own role")

    user.role = UserRole(new_role)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return {"id": user.id, "username": user.username, "role": user.role}


@router.patch("/users/{user_id}/verify")
async def toggle_verify(
    user_id: int,
    body: dict,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_verified = bool(body.get("verified", not user.is_verified))
    session.add(user)
    await session.commit()
    return {"id": user.id, "is_verified": user.is_verified}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user(
    user_id: int,
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_root),
):
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.role == UserRole.ROOT:
        raise HTTPException(403, "Cannot delete ROOT user")
    if user.id == current_user.id:
        raise HTTPException(400, "Cannot delete yourself")

    # Soft-delete posts
    posts = (await session.exec(select(BlogPost).where(BlogPost.author_id == user_id))).all()
    for p in posts:
        p.status = PostStatus.ARCHIVED
        session.add(p)

    await session.delete(user)
    await session.commit()


# ── Category management ───────────────────────────────────────────────────────

@router.get("/categories", response_model=List[CategoryOut])
async def list_categories(
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    result = await session.exec(select(BlogCategory).order_by(BlogCategory.name))
    return result.all()


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(
    body: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    from crud.post_crud import slugify
    slug = slugify(body.name)
    existing = await session.exec(select(BlogCategory).where(BlogCategory.slug == slug))
    if existing.first():
        raise HTTPException(400, "Category with this name already exists")

    cat = BlogCategory(
        name=body.name,
        slug=slug,
        description=body.description,
        color=body.color,
        icon=body.icon,
    )
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


@router.patch("/categories/{cat_id}", response_model=CategoryOut)
async def update_category(
    cat_id: int,
    body: CategoryUpdate,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    cat = await session.get(BlogCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")

    for k, v in body.model_dump(exclude_none=True).items():
        setattr(cat, k, v)

    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


@router.delete("/categories/{cat_id}", status_code=204)
async def delete_category(
    cat_id: int,
    session: AsyncSession = Depends(get_session),
    _: UserSession = Depends(require_admin),
):
    cat = await session.get(BlogCategory, cat_id)
    if not cat:
        raise HTTPException(404, "Category not found")

    # Unlink posts from this category
    posts = (await session.exec(select(BlogPost).where(BlogPost.category_id == cat_id))).all()
    for p in posts:
        p.category_id = None
        session.add(p)

    await session.delete(cat)
    await session.commit()


# ── Media upload (ImageKit) ───────────────────────────────────────────────────

@router.post("/media/upload")
async def upload_media(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    current_user: UserSession = Depends(require_author),
):
    """Upload an image to ImageKit and return the URL. Available to all authors."""
    try:
        from imagekitio import ImageKit
        ik = ImageKit(
            private_key=os.getenv("IMAGEKIT_PRIVATE_KEY", ""),
            public_key=os.getenv("IMAGEKIT_PUBLIC_KEY", ""),
            url_endpoint=os.getenv("IMAGEKIT_URL_ENDPOINT", ""),
        )
        content = await file.read()
        result  = ik.upload_file(
            file=content,
            file_name=file.filename,
            options={"folder": "/blog/"},
        )
        url = result.response_metadata.raw["url"]

        media = BlogMedia(
            url=url,
            filename=file.filename,
            mime_type=file.content_type or "application/octet-stream",
            size_bytes=len(content),
            author_id=current_user.id,
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)

        return {"id": media.id, "url": url, "filename": file.filename}
    except Exception as e:
        log.error(f"Media upload failed: {e}")
        raise HTTPException(500, f"Upload failed: {e}")
