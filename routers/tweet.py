from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, status, Path, Query
from sqlmodel.ext.asyncio.session import AsyncSession

from core.database import get_session
from core.security import get_current_user, get_optional_user
from schemas.schemas import (
    TweetCreate, TweetUpdate, TweetOut, TweetFeedOut,
    CommentCreate, CommentOut, UserSession, UserPublic,
)
import crud.tweet_crud as crud

router = APIRouter(prefix="/tweets", tags=["Twitter Feed"])


# ── Helper: build TweetOut and optionally annotate liked_by_me ───────────────

async def _build_tweet_out(tweet, session: AsyncSession, current_user_id: Optional[int] = None) -> TweetOut:
    # Load author if not already loaded (SQLModel lazy-loads by default in async)
    author = await session.get(__import__('models.models', fromlist=['User']).User, tweet.author_id)
    liked = await crud.is_liked_by(session, current_user_id, tweet.id) if current_user_id else None
    return TweetOut(
        id=tweet.id,
        content=tweet.content,
        author=UserPublic(
            id=author.id,
            username=author.username,
            display_name=author.display_name,
            avatar_url=author.avatar_url,
        ),
        like_count=tweet.like_count,
        comment_count=tweet.comment_count,
        is_edited=tweet.is_edited,
        created_at=tweet.created_at,
        liked_by_me=liked,
    )


# ── Feed (infinite scroll) ────────────────────────────────────────────────────

@router.get("", response_model=TweetFeedOut)
async def get_feed(
        limit: int = Query(20, ge=1, le=50),
        before_id: Optional[int] = Query(None, description="Cursor: fetch tweets older than this id"),
        session: AsyncSession = Depends(get_session),
        current_user: Optional[UserSession] = Depends(get_optional_user),
):
    """
    Paginated global tweet feed for infinite scroll.
    First load: GET /tweets
    Next page:  GET /tweets?before_id=<last tweet id from previous response>
    """
    tweets = await crud.get_tweet_feed(session=session, limit=limit, before_id=before_id)
    uid = current_user.id if current_user else None
    out = [await _build_tweet_out(t, session, uid) for t in tweets]
    next_cursor = out[-1].id if len(out) == limit else None
    return TweetFeedOut(tweets=out, next_cursor=next_cursor)


# ── Single tweet ──────────────────────────────────────────────────────────────

@router.get("/{tweet_id}", response_model=TweetOut)
async def get_tweet(
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: Optional[UserSession] = Depends(get_optional_user),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    uid = current_user.id if current_user else None
    return await _build_tweet_out(tweet, session, uid)


# ── Post a tweet ──────────────────────────────────────────────────────────────

@router.post("", response_model=TweetOut, status_code=status.HTTP_201_CREATED)
async def post_tweet(
        body: TweetCreate,
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    tweet = await crud.create_tweet(session=session, author_id=current_user.id, content=body.content)
    if tweet is None:
        raise HTTPException(status_code=500, detail="Failed to create tweet")
    return await _build_tweet_out(tweet, session, current_user.id)


# ── Edit tweet ────────────────────────────────────────────────────────────────

@router.patch("/{tweet_id}", response_model=TweetOut)
async def edit_tweet(
        body: TweetUpdate,
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    if tweet.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your tweet")

    updated = await crud.update_tweet(session=session, tweet_id=tweet_id, content=body.content)
    return await _build_tweet_out(updated, session, current_user.id)


# ── Delete tweet ──────────────────────────────────────────────────────────────

@router.delete("/{tweet_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tweet(
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    if tweet.author_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your tweet")
    await crud.delete_tweet(session=session, tweet_id=tweet_id)


# ── Like / Unlike ─────────────────────────────────────────────────────────────

@router.post("/{tweet_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def like_tweet(
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    await crud.like_tweet(session=session, user_id=current_user.id, tweet_id=tweet_id)


@router.delete("/{tweet_id}/like", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_tweet(
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    await crud.unlike_tweet(session=session, user_id=current_user.id, tweet_id=tweet_id)


# ── Comments ──────────────────────────────────────────────────────────────────

@router.get("/{tweet_id}/comments", response_model=list[CommentOut])
async def get_comments(
        tweet_id: int = Path(gt=0),
        limit: int = Query(50, ge=1, le=100),
        before_id: Optional[int] = Query(None),
        session: AsyncSession = Depends(get_session),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    return await crud.get_comments_for_tweet(session=session, tweet_id=tweet_id, limit=limit, before_id=before_id)


@router.post("/{tweet_id}/comments", response_model=CommentOut, status_code=status.HTTP_201_CREATED)
async def post_comment(
        body: CommentCreate,
        tweet_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    tweet = await crud.get_tweet_by_id(session=session, tweet_id=tweet_id)
    if tweet is None:
        raise HTTPException(status_code=404, detail="Tweet not found")
    comment = await crud.create_comment(
        session=session, tweet_id=tweet_id, author_id=current_user.id, content=body.content
    )
    if comment is None:
        raise HTTPException(status_code=500, detail="Failed to post comment")
    return comment


@router.delete("/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_comment(
        comment_id: int = Path(gt=0),
        session: AsyncSession = Depends(get_session),
        current_user: UserSession = Depends(get_current_user),
):
    deleted = await crud.delete_comment(session=session, comment_id=comment_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Comment not found")
