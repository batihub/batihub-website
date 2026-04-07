"""
routers/posts.py — Blog post CRUD, likes, comments, related posts.
"""

import requests as _requests
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Path, BackgroundTasks, status
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import get_current_user, get_optional_user, require_author, ROLE_HIERARCHY
from models.models import BlogPost, BlogComment, User, UserRole, PostStatus
from schemas.schemas import (
    PostCreate, PostUpdate, PostOut, PostCardOut, PostFeedOut,
    CommentCreate, CommentOut, TagOut, CategoryOut, UserPublic, UserSession,
)
import crud.post_crud as crud

router = APIRouter(prefix="/posts", tags=["Posts"])

_SITEMAP_PING = "https://www.google.com/ping?sitemap=https://batihanbabacan.com/sitemap.xml"


def _ping_google():
    try:
        _requests.get(_SITEMAP_PING, timeout=5)
    except Exception:
        pass


# ── Serialisation helpers ─────────────────────────────────────────────────────

async def _build_post_card(
    post: BlogPost,
    session: AsyncSession,
    user_id: Optional[int] = None,
) -> PostCardOut:
    author      = await session.get(User, post.author_id)
    category    = await session.get(__import__("models.models", fromlist=["BlogCategory"]).BlogCategory, post.category_id) if post.category_id else None
    tags_orm    = await crud.get_post_tags(session, post.id)
    liked_by_me = await crud.is_liked_by(session, user_id, post.id) if user_id else None

    return PostCardOut(
        id=post.id,
        slug=post.slug,
        title=post.title,
        subtitle=post.subtitle,
        cover_image_url=post.cover_image_url,
        author=UserPublic(
            id=author.id,
            username=author.username,
            display_name=author.display_name,
            avatar_url=author.avatar_url,
            is_verified=author.is_verified,
            post_count=author.post_count,
        ),
        category=CategoryOut.model_validate(category) if category else None,
        tags=[TagOut(id=t.id, name=t.name, slug=t.slug) for t in tags_orm],
        status=post.status,
        view_count=post.view_count,
        like_count=post.like_count,
        comment_count=post.comment_count,
        read_time=post.read_time,
        featured=post.featured,
        published_at=post.published_at,
        created_at=post.created_at,
        liked_by_me=liked_by_me,
    )


async def _build_post_out(
    post: BlogPost,
    session: AsyncSession,
    user_id: Optional[int] = None,
) -> PostOut:
    card = await _build_post_card(post, session, user_id)
    return PostOut(
        **card.model_dump(),
        body_html=post.body_html,
        body_delta=post.body_delta,
        meta_description=post.meta_description,
        updated_at=post.updated_at,
    )


def _build_comment_tree(comments: List[BlogComment], users: dict) -> List[CommentOut]:
    """Build a nested comment tree from a flat list."""
    by_id    = {}
    top_lvl  = []

    for c in comments:
        author = users.get(c.author_id)
        if not author:
            continue
        co = CommentOut(
            id=c.id,
            body=c.body,
            author=UserPublic(
                id=author.id,
                username=author.username,
                display_name=author.display_name,
                avatar_url=author.avatar_url,
                is_verified=author.is_verified,
                post_count=author.post_count,
            ),
            parent_id=c.parent_id,
            created_at=c.created_at,
        )
        by_id[c.id] = co

    for c in comments:
        co = by_id.get(c.id)
        if not co:
            continue
        if c.parent_id and c.parent_id in by_id:
            by_id[c.parent_id].replies.append(co)
        else:
            top_lvl.append(co)

    return top_lvl


# ── Public categories list ────────────────────────────────────────────────────

@router.get("/categories", response_model=List[CategoryOut])
async def list_categories(session: AsyncSession = Depends(get_session)):
    from models.models import BlogCategory
    from sqlmodel import select as _select
    result = await session.exec(_select(BlogCategory).order_by(BlogCategory.name))
    return result.all()


# ── Feed ──────────────────────────────────────────────────────────────────────

@router.get("", response_model=PostFeedOut)
async def get_feed(
    limit:    int            = Query(20, ge=1, le=50),
    before_id: Optional[int] = Query(None),
    category:  Optional[str] = Query(None),
    tag:       Optional[str] = Query(None),
    author:    Optional[str] = Query(None),
    featured:  bool          = Query(False),
    session:   AsyncSession  = Depends(get_session),
    current_user: Optional[UserSession] = Depends(get_optional_user),
):
    posts, total = await crud.get_post_feed(
        session,
        limit=limit,
        before_id=before_id,
        category_slug=category,
        tag_slug=tag,
        author_username=author,
        featured_only=featured,
    )
    uid  = current_user.id if current_user else None
    out  = [await _build_post_card(p, session, uid) for p in posts]
    next_cursor = out[-1].id if len(out) == limit else None
    return PostFeedOut(posts=out, next_cursor=next_cursor, total=total)


# ── Single post (by slug) ─────────────────────────────────────────────────────

@router.get("/{slug}", response_model=PostOut)
async def get_post(
    slug:     str           = Path(),
    session:  AsyncSession  = Depends(get_session),
    bg_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: Optional[UserSession] = Depends(get_optional_user),
):
    post = await crud.get_post_by_slug(session, slug)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")

    # Only published posts visible to guests/non-owners
    if post.status != PostStatus.PUBLISHED:
        if not current_user:
            raise HTTPException(status_code=404, detail="Post not found")
        level = ROLE_HIERARCHY.get(current_user.role, 0)
        is_owner = post.author_id == current_user.id
        if not is_owner and level < ROLE_HIERARCHY[UserRole.ADMIN]:
            raise HTTPException(status_code=404, detail="Post not found")

    bg_tasks.add_task(crud.increment_view, session, post)
    uid = current_user.id if current_user else None
    return await _build_post_out(post, session, uid)


# ── Related posts ─────────────────────────────────────────────────────────────

@router.get("/{slug}/related", response_model=List[PostCardOut])
async def get_related(
    slug:    str          = Path(),
    session: AsyncSession = Depends(get_session),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post or post.status != PostStatus.PUBLISHED:
        return []
    related = await crud.get_related_posts(session, post)
    return [await _build_post_card(p, session) for p in related]


# ── Adjacent posts (prev/next) ───────────────────────────────────────────────

@router.get("/{slug}/adjacent")
async def get_adjacent_posts(
    slug:    str          = Path(),
    session: AsyncSession = Depends(get_session),
):
    from sqlmodel import select as _sel
    post = await crud.get_post_by_slug(session, slug)
    if not post or post.status != PostStatus.PUBLISHED:
        return {"prev": None, "next": None}

    prev_r = await session.exec(
        _sel(BlogPost)
        .where(BlogPost.status == PostStatus.PUBLISHED, BlogPost.id < post.id)
        .order_by(BlogPost.id.desc()).limit(1)
    )
    next_r = await session.exec(
        _sel(BlogPost)
        .where(BlogPost.status == PostStatus.PUBLISHED, BlogPost.id > post.id)
        .order_by(BlogPost.id.asc()).limit(1)
    )
    prev_post = prev_r.first()
    next_post = next_r.first()

    def mini(p):
        return {"slug": p.slug, "title": p.title, "cover_image_url": p.cover_image_url} if p else None

    return {"prev": mini(prev_post), "next": mini(next_post)}


# ── Create post ───────────────────────────────────────────────────────────────

@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def create_post(
    body:         PostCreate,
    bg_tasks:     BackgroundTasks,
    session:      AsyncSession  = Depends(get_session),
    current_user: UserSession   = Depends(require_author),
):
    data = body.model_dump()
    post = await crud.create_post(session, current_user.id, data)
    if not post:
        raise HTTPException(status_code=500, detail="Failed to create post")
    if post.status == PostStatus.PUBLISHED:
        bg_tasks.add_task(_ping_google)
    return await _build_post_out(post, session, current_user.id)


# ── Update post ───────────────────────────────────────────────────────────────

@router.patch("/{slug}", response_model=PostOut)
async def update_post(
    body:         PostUpdate,
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(require_author),
    bg_tasks:     BackgroundTasks = BackgroundTasks(),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    level    = ROLE_HIERARCHY.get(current_user.role, 0)
    is_owner = post.author_id == current_user.id
    if not is_owner and level < ROLE_HIERARCHY[UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Not your post")

    data    = body.model_dump(exclude_none=True)
    updated = await crud.update_post(session, post, data)
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update post")

    if updated.status == PostStatus.PUBLISHED:
        bg_tasks.add_task(_ping_google)
    return await _build_post_out(updated, session, current_user.id)


# ── Publish / Unpublish shortcuts ─────────────────────────────────────────────

@router.post("/{slug}/publish", response_model=PostOut)
async def publish_post(
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(require_author),
    bg_tasks:     BackgroundTasks = BackgroundTasks(),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    level    = ROLE_HIERARCHY.get(current_user.role, 0)
    is_owner = post.author_id == current_user.id
    if not is_owner and level < ROLE_HIERARCHY[UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Not your post")

    updated = await crud.update_post(session, post, {"status": PostStatus.PUBLISHED})
    bg_tasks.add_task(_ping_google)
    return await _build_post_out(updated, session, current_user.id)


@router.post("/{slug}/unpublish", response_model=PostOut)
async def unpublish_post(
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(require_author),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    level    = ROLE_HIERARCHY.get(current_user.role, 0)
    is_owner = post.author_id == current_user.id
    if not is_owner and level < ROLE_HIERARCHY[UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Not your post")

    updated = await crud.update_post(session, post, {"status": PostStatus.DRAFT})
    return await _build_post_out(updated, session, current_user.id)


# ── Delete post ───────────────────────────────────────────────────────────────

@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(require_author),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    level    = ROLE_HIERARCHY.get(current_user.role, 0)
    is_owner = post.author_id == current_user.id
    if not is_owner and level < ROLE_HIERARCHY[UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Not your post")

    await crud.delete_post(session, post)


# ── Likes ─────────────────────────────────────────────────────────────────────

@router.post("/{slug}/like", status_code=status.HTTP_204_NO_CONTENT)
async def like_post(
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(get_current_user),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post or post.status != PostStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Post not found")
    await crud.like_post(session, current_user.id, post.id)


@router.delete("/{slug}/like", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_post(
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(get_current_user),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    await crud.unlike_post(session, current_user.id, post.id)


# ── Comments ──────────────────────────────────────────────────────────────────

@router.get("/{slug}/comments", response_model=List[CommentOut])
async def get_comments(
    slug:    str          = Path(),
    session: AsyncSession = Depends(get_session),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")

    comments = await crud.get_comments_for_post(session, post.id)

    # Pre-fetch all authors to avoid N+1
    author_ids = list({c.author_id for c in comments})
    users      = {}
    for uid in author_ids:
        u = await session.get(User, uid)
        if u:
            users[uid] = u

    return _build_comment_tree(comments, users)


@router.post("/{slug}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def post_comment(
    body:         CommentCreate,
    slug:         str          = Path(),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(get_current_user),
):
    post = await crud.get_post_by_slug(session, slug)
    if not post or post.status != PostStatus.PUBLISHED:
        raise HTTPException(status_code=404, detail="Post not found")

    comment = await crud.create_comment(
        session, post.id, current_user.id, body.body, body.parent_id
    )
    if not comment:
        raise HTTPException(status_code=500, detail="Failed to create comment")

    author = await session.get(User, current_user.id)
    return CommentOut(
        id=comment.id,
        body=comment.body,
        author=UserPublic(
            id=author.id,
            username=author.username,
            display_name=author.display_name,
            avatar_url=author.avatar_url,
            is_verified=author.is_verified,
            post_count=author.post_count,
        ),
        parent_id=comment.parent_id,
        created_at=comment.created_at,
    )


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
    comment_id:   int          = Path(gt=0),
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(get_current_user),
):
    is_admin = ROLE_HIERARCHY.get(current_user.role, 0) >= ROLE_HIERARCHY[UserRole.ADMIN]
    deleted  = await crud.delete_comment(session, comment_id, current_user.id, is_admin)
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found or not allowed")


# ── Author dashboard: my posts ────────────────────────────────────────────────

@router.get("/me/posts", response_model=List[PostCardOut])
async def my_posts(
    session:      AsyncSession = Depends(get_session),
    current_user: UserSession  = Depends(require_author),
):
    posts, _ = await crud.get_post_feed(
        session,
        limit=100,
        author_username=current_user.username,
        include_drafts=True,
    )
    return [await _build_post_card(p, session, current_user.id) for p in posts]
