"""
post_crud.py — Database operations for blog posts, categories, tags, comments.
"""

import re
import random
import string
import logging
from typing import Optional, List, Tuple
from datetime import datetime

from sqlmodel import select, func
from sqlmodel.ext.asyncio.session import AsyncSession

from models.models import (
    User, BlogPost, BlogCategory, BlogTag, BlogPostTag,
    BlogLike, BlogComment, BlogMedia, PostStatus,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text, flags=re.UNICODE)
    text = re.sub(r"[\s_]+", "-", text)
    text = text.strip("-")
    return text[:80] if len(text) > 80 else text


def make_slug(title: str) -> str:
    base   = slugify(title)
    suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{base}-{suffix}" if base else suffix


def calculate_read_time(html: str) -> int:
    text  = re.sub(r"<[^>]+>", " ", html)
    words = len(text.split())
    return max(1, round(words / 200))


def sanitize_html(html: str) -> str:
    """Strip script/style tags and dangerous attributes from HTML."""
    if not html:
        return html
    html = re.sub(r"<script[^>]*?>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style[^>]*?>.*?</style>",   "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"\s*on\w+\s*=\s*['\"][^'\"]*['\"]", "", html, flags=re.IGNORECASE)
    html = re.sub(r"(href|src)\s*=\s*['\"]javascript:[^'\"]*['\"]", 'href="#"', html, flags=re.IGNORECASE)
    return html.strip()


# ── User helpers ──────────────────────────────────────────────────────────────

async def get_user_by_username(session: AsyncSession, username: str) -> Optional[User]:
    result = await session.execute(select(User).where(User.username == username))
    return result.scalars().first()


async def get_user_by_id(session: AsyncSession, user_id: int) -> Optional[User]:
    return await session.get(User, user_id)


async def create_user(session: AsyncSession, user: User) -> Optional[User]:
    try:
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user
    except Exception as e:
        await session.rollback()
        logging.error(f"create_user error: {e}")
        return None


# ── Tag helpers ───────────────────────────────────────────────────────────────

async def get_or_create_tag(session: AsyncSession, name: str) -> BlogTag:
    slug   = slugify(name)
    result = await session.execute(select(BlogTag).where(BlogTag.slug == slug))
    tag    = result.scalars().first()
    if tag:
        return tag
    tag = BlogTag(name=name.strip(), slug=slug)
    session.add(tag)
    await session.flush()
    return tag


# ── Category ──────────────────────────────────────────────────────────────────

async def list_categories(session: AsyncSession) -> List[BlogCategory]:
    result = await session.execute(
        select(BlogCategory).order_by(BlogCategory.name)
    )
    return result.scalars().all()


async def get_category_by_slug(session: AsyncSession, slug: str) -> Optional[BlogCategory]:
    result = await session.execute(select(BlogCategory).where(BlogCategory.slug == slug))
    return result.scalars().first()


async def create_category(
    session: AsyncSession,
    name: str,
    description: Optional[str],
    color: str,
    icon: Optional[str],
) -> BlogCategory:
    slug = slugify(name)
    cat  = BlogCategory(name=name, slug=slug, description=description, color=color, icon=icon)
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


async def update_category(
    session: AsyncSession,
    cat: BlogCategory,
    **kwargs,
) -> BlogCategory:
    for k, v in kwargs.items():
        if v is not None:
            setattr(cat, k, v)
    if "name" in kwargs and kwargs["name"]:
        cat.slug = slugify(kwargs["name"])
    session.add(cat)
    await session.commit()
    await session.refresh(cat)
    return cat


async def delete_category(session: AsyncSession, cat: BlogCategory) -> None:
    await session.delete(cat)
    await session.commit()


# ── Post CRUD ─────────────────────────────────────────────────────────────────

async def get_post_by_id(session: AsyncSession, post_id: int) -> Optional[BlogPost]:
    return await session.get(BlogPost, post_id)


async def get_post_by_slug(session: AsyncSession, slug: str) -> Optional[BlogPost]:
    result = await session.execute(select(BlogPost).where(BlogPost.slug == slug))
    return result.scalars().first()


async def get_post_feed(
    session: AsyncSession,
    limit: int = 20,
    before_id: Optional[int] = None,
    category_slug: Optional[str] = None,
    tag_slug: Optional[str] = None,
    author_username: Optional[str] = None,
    featured_only: bool = False,
    include_drafts: bool = False,
) -> Tuple[List[BlogPost], int]:
    """Returns (posts, total_count)."""
    q = select(BlogPost)

    if not include_drafts:
        q = q.where(BlogPost.status == PostStatus.PUBLISHED)

    if before_id is not None:
        q = q.where(BlogPost.id < before_id)

    if category_slug:
        cat = await get_category_by_slug(session, category_slug)
        if cat:
            q = q.where(BlogPost.category_id == cat.id)

    if tag_slug:
        tag_result = await session.execute(select(BlogTag).where(BlogTag.slug == tag_slug))
        tag = tag_result.scalars().first()
        if tag:
            pt_result = await session.execute(
                select(BlogPostTag.post_id).where(BlogPostTag.tag_id == tag.id)
            )
            post_ids = pt_result.scalars().all()
            q = q.where(BlogPost.id.in_(post_ids))

    if author_username:
        user = await get_user_by_username(session, author_username)
        if user:
            q = q.where(BlogPost.author_id == user.id)

    if featured_only:
        q = q.where(BlogPost.featured == True)

    count_q = select(func.count()).select_from(q.subquery())
    total   = (await session.execute(count_q)).scalar() or 0

    q = q.order_by(BlogPost.published_at.desc().nullslast(), BlogPost.created_at.desc()).limit(limit)

    result = await session.execute(q)
    return result.scalars().all(), total


async def get_post_tags(session: AsyncSession, post_id: int) -> List[BlogTag]:
    result = await session.execute(
        select(BlogTag)
        .join(BlogPostTag, BlogPostTag.tag_id == BlogTag.id)
        .where(BlogPostTag.post_id == post_id)
    )
    return result.scalars().all()


async def create_post(
    session: AsyncSession,
    author_id: int,
    data: dict,
) -> Optional[BlogPost]:
    try:
        tag_names: List[str] = data.pop("tags", [])

        body_html        = sanitize_html(data.get("body_html", ""))
        data["body_html"] = body_html
        data["read_time"] = calculate_read_time(body_html)
        data["slug"]      = make_slug(data["title"])

        if data.get("status") == PostStatus.PUBLISHED and not data.get("published_at"):
            data["published_at"] = datetime.utcnow()

        post = BlogPost(author_id=author_id, **data)
        session.add(post)
        await session.flush()

        for name in tag_names:
            if name.strip():
                tag = await get_or_create_tag(session, name.strip())
                session.add(BlogPostTag(post_id=post.id, tag_id=tag.id))

        # Bump author post_count
        author = await session.get(User, author_id)
        if author:
            author.post_count += 1
            session.add(author)

        # Bump category post_count
        if post.category_id:
            cat = await session.get(BlogCategory, post.category_id)
            if cat:
                cat.post_count += 1
                session.add(cat)

        await session.commit()
        await session.refresh(post)
        return post
    except Exception as e:
        await session.rollback()
        logging.error(f"create_post error: {e}")
        return None


async def update_post(
    session: AsyncSession,
    post: BlogPost,
    data: dict,
) -> Optional[BlogPost]:
    try:
        tag_names: Optional[List[str]] = data.pop("tags", None)
        old_category_id = post.category_id
        old_status      = post.status

        if "body_html" in data and data["body_html"] is not None:
            data["body_html"] = sanitize_html(data["body_html"])
            data["read_time"] = calculate_read_time(data["body_html"])

        # Auto-set published_at when first publishing
        if (
            data.get("status") == PostStatus.PUBLISHED
            and old_status != PostStatus.PUBLISHED
            and not post.published_at
        ):
            data["published_at"] = datetime.utcnow()

        for k, v in data.items():
            if v is not None:
                setattr(post, k, v)
        post.updated_at = datetime.utcnow()

        # Update tags if provided
        if tag_names is not None:
            # Remove old tags
            old_pt = await session.execute(
                select(BlogPostTag).where(BlogPostTag.post_id == post.id)
            )
            for pt in old_pt.scalars().all():
                await session.delete(pt)
            await session.flush()

            for name in tag_names:
                if name.strip():
                    tag = await get_or_create_tag(session, name.strip())
                    session.add(BlogPostTag(post_id=post.id, tag_id=tag.id))

        # Update category counters
        if "category_id" in data and data["category_id"] != old_category_id:
            if old_category_id:
                old_cat = await session.get(BlogCategory, old_category_id)
                if old_cat:
                    old_cat.post_count = max(0, old_cat.post_count - 1)
                    session.add(old_cat)
            if data["category_id"]:
                new_cat = await session.get(BlogCategory, data["category_id"])
                if new_cat:
                    new_cat.post_count += 1
                    session.add(new_cat)

        session.add(post)
        await session.commit()
        await session.refresh(post)
        return post
    except Exception as e:
        await session.rollback()
        logging.error(f"update_post error: {e}")
        return None


async def delete_post(session: AsyncSession, post: BlogPost) -> bool:
    try:
        post.status = PostStatus.ARCHIVED
        session.add(post)

        author = await session.get(User, post.author_id)
        if author:
            author.post_count = max(0, author.post_count - 1)
            session.add(author)

        if post.category_id:
            cat = await session.get(BlogCategory, post.category_id)
            if cat:
                cat.post_count = max(0, cat.post_count - 1)
                session.add(cat)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"delete_post error: {e}")
        return False


# ── View count ────────────────────────────────────────────────────────────────

async def increment_view(session: AsyncSession, post: BlogPost, viewer_id: Optional[int] = None) -> None:
    from models.models import BlogPostView
    post.view_count += 1
    session.add(post)
    session.add(BlogPostView(post_id=post.id, viewer_id=viewer_id))
    await session.commit()


# ── Likes ─────────────────────────────────────────────────────────────────────

async def is_liked_by(session: AsyncSession, user_id: int, post_id: int) -> bool:
    result = await session.execute(
        select(BlogLike).where(BlogLike.user_id == user_id, BlogLike.post_id == post_id)
    )
    return result.scalars().first() is not None


async def like_post(session: AsyncSession, user_id: int, post_id: int) -> bool:
    try:
        if await is_liked_by(session, user_id, post_id):
            return False
        session.add(BlogLike(user_id=user_id, post_id=post_id))
        post = await session.get(BlogPost, post_id)
        if post:
            post.like_count += 1
            session.add(post)
        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"like_post error: {e}")
        return False


async def unlike_post(session: AsyncSession, user_id: int, post_id: int) -> bool:
    try:
        result = await session.execute(
            select(BlogLike).where(BlogLike.user_id == user_id, BlogLike.post_id == post_id)
        )
        like = result.scalars().first()
        if not like:
            return False
        await session.delete(like)
        post = await session.get(BlogPost, post_id)
        if post:
            post.like_count = max(0, post.like_count - 1)
            session.add(post)
        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"unlike_post error: {e}")
        return False


# ── Comments ──────────────────────────────────────────────────────────────────

async def get_comments_for_post(session: AsyncSession, post_id: int) -> List[BlogComment]:
    result = await session.execute(
        select(BlogComment)
        .where(BlogComment.post_id == post_id, BlogComment.is_deleted == False)
        .order_by(BlogComment.created_at.asc())
    )
    return result.scalars().all()


async def create_comment(
    session: AsyncSession, post_id: int, author_id: int, body: str, parent_id: Optional[int]
) -> Optional[BlogComment]:
    try:
        comment = BlogComment(
            body=body.strip(),
            post_id=post_id,
            author_id=author_id,
            parent_id=parent_id,
        )
        session.add(comment)

        post = await session.get(BlogPost, post_id)
        if post:
            post.comment_count += 1
            session.add(post)

        await session.commit()
        await session.refresh(comment)
        return comment
    except Exception as e:
        await session.rollback()
        logging.error(f"create_comment error: {e}")
        return None


async def delete_comment(session: AsyncSession, comment_id: int, user_id: int, is_admin: bool) -> bool:
    try:
        comment = await session.get(BlogComment, comment_id)
        if not comment or comment.is_deleted:
            return False
        if comment.author_id != user_id and not is_admin:
            return False

        comment.is_deleted = True
        session.add(comment)

        post = await session.get(BlogPost, comment.post_id)
        if post:
            post.comment_count = max(0, post.comment_count - 1)
            session.add(post)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"delete_comment error: {e}")
        return False


# ── Related posts ─────────────────────────────────────────────────────────────

async def get_related_posts(session: AsyncSession, post: BlogPost, limit: int = 3) -> List[BlogPost]:
    """Find posts sharing tags or category, excluding the current post."""
    tag_rows = await session.execute(
        select(BlogPostTag.tag_id).where(BlogPostTag.post_id == post.id)
    )
    tag_ids = tag_rows.scalars().all()

    if tag_ids:
        # Posts sharing at least one tag
        pt_rows = await session.execute(
            select(BlogPostTag.post_id)
            .where(BlogPostTag.tag_id.in_(tag_ids), BlogPostTag.post_id != post.id)
        )
        related_ids = list(set(pt_rows.scalars().all()))[:20]
        if related_ids:
            result = await session.execute(
                select(BlogPost)
                .where(
                    BlogPost.id.in_(related_ids),
                    BlogPost.status == PostStatus.PUBLISHED,
                )
                .order_by(BlogPost.published_at.desc())
                .limit(limit)
            )
            posts = result.scalars().all()
            if len(posts) >= limit:
                return posts

    # Fallback: same category
    if post.category_id:
        result = await session.execute(
            select(BlogPost)
            .where(
                BlogPost.category_id == post.category_id,
                BlogPost.id != post.id,
                BlogPost.status == PostStatus.PUBLISHED,
            )
            .order_by(BlogPost.published_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    return []


# ── Media ─────────────────────────────────────────────────────────────────────

async def create_media(
    session: AsyncSession,
    url: str,
    filename: str,
    mime_type: str,
    size_bytes: Optional[int],
    author_id: int,
) -> Optional[BlogMedia]:
    try:
        media = BlogMedia(
            url=url,
            filename=filename,
            mime_type=mime_type,
            size_bytes=size_bytes,
            author_id=author_id,
        )
        session.add(media)
        await session.commit()
        await session.refresh(media)
        return media
    except Exception as e:
        await session.rollback()
        logging.error(f"create_media error: {e}")
        return None
