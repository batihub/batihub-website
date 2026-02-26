import logging
from typing import Optional, List
from sqlmodel import select, and_
from sqlmodel.ext.asyncio.session import AsyncSession

from models.models import Tweet, Like, Comment, User


# ── Feed (cursor-based pagination for infinite scroll) ────────────────────────

async def get_tweet_feed(
        session: AsyncSession,
        limit: int = 20,
        before_id: Optional[int] = None,  # cursor: fetch tweets older than this id
) -> List[Tweet]:
    """
    Returns `limit` tweets ordered newest-first.
    For infinite scroll, pass the id of the last tweet you received as `before_id`.
    First page: before_id=None  →  newest tweets
    Next page:  before_id=<oldest id from prev page>
    """
    try:
        q = select(Tweet).where(Tweet.is_deleted == False)
        if before_id is not None:
            q = q.where(Tweet.id < before_id)
        q = q.order_by(Tweet.id.desc()).limit(limit)
        result = await session.execute(q)
        return result.scalars().all()
    except Exception as e:
        logging.error(f"get_tweet_feed error: {e}")
        return []


# ── Single tweet ──────────────────────────────────────────────────────────────

async def get_tweet_by_id(session: AsyncSession, tweet_id: int) -> Optional[Tweet]:
    try:
        result = await session.execute(
            select(Tweet).where(Tweet.id == tweet_id, Tweet.is_deleted == False)
        )
        return result.scalars().first()
    except Exception as e:
        logging.error(f"get_tweet_by_id error: {e}")
        return None


# ── Create ────────────────────────────────────────────────────────────────────

async def create_tweet(session: AsyncSession, author_id: int, content: str) -> Optional[Tweet]:
    try:
        tweet = Tweet(content=content, author_id=author_id)
        session.add(tweet)

        # bump denormalised counter on User
        user = await session.get(User, author_id)
        if user:
            user.tweet_count += 1
            session.add(user)

        await session.commit()
        await session.refresh(tweet)
        return tweet
    except Exception as e:
        await session.rollback()
        logging.error(f"create_tweet error: {e}")
        return None


# ── Edit ──────────────────────────────────────────────────────────────────────

async def update_tweet(session: AsyncSession, tweet_id: int, content: str) -> Optional[Tweet]:
    try:
        tweet = await get_tweet_by_id(session, tweet_id)
        if not tweet:
            return None
        tweet.content = content
        tweet.is_edited = True
        session.add(tweet)
        await session.commit()
        await session.refresh(tweet)
        return tweet
    except Exception as e:
        await session.rollback()
        logging.error(f"update_tweet error: {e}")
        return None


# ── Soft delete ───────────────────────────────────────────────────────────────

async def delete_tweet(session: AsyncSession, tweet_id: int) -> bool:
    try:
        tweet = await get_tweet_by_id(session, tweet_id)
        if not tweet:
            return False
        tweet.is_deleted = True
        session.add(tweet)

        user = await session.get(User, tweet.author_id)
        if user:
            user.tweet_count = max(0, user.tweet_count - 1)
            session.add(user)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"delete_tweet error: {e}")
        return False


# ── Likes ─────────────────────────────────────────────────────────────────────

async def like_tweet(session: AsyncSession, user_id: int, tweet_id: int) -> bool:
    """Returns True if liked, False if was already liked (idempotent)."""
    try:
        existing = await session.execute(
            select(Like).where(Like.user_id == user_id, Like.tweet_id == tweet_id)
        )
        if existing.scalars().first():
            return False  # already liked

        session.add(Like(user_id=user_id, tweet_id=tweet_id))

        tweet = await session.get(Tweet, tweet_id)
        if tweet:
            tweet.like_count += 1
            session.add(tweet)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"like_tweet error: {e}")
        return False


async def unlike_tweet(session: AsyncSession, user_id: int, tweet_id: int) -> bool:
    """Returns True if unliked, False if wasn't liked."""
    try:
        result = await session.execute(
            select(Like).where(Like.user_id == user_id, Like.tweet_id == tweet_id)
        )
        like = result.scalars().first()
        if not like:
            return False

        await session.delete(like)

        tweet = await session.get(Tweet, tweet_id)
        if tweet:
            tweet.like_count = max(0, tweet.like_count - 1)
            session.add(tweet)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"unlike_tweet error: {e}")
        return False


async def is_liked_by(session: AsyncSession, user_id: int, tweet_id: int) -> bool:
    result = await session.execute(
        select(Like).where(Like.user_id == user_id, Like.tweet_id == tweet_id)
    )
    return result.scalars().first() is not None


# ── Comments ──────────────────────────────────────────────────────────────────

async def create_comment(
        session: AsyncSession, tweet_id: int, author_id: int, content: str
) -> Optional[Comment]:
    try:
        comment = Comment(content=content, tweet_id=tweet_id, author_id=author_id)
        session.add(comment)

        tweet = await session.get(Tweet, tweet_id)
        if tweet:
            tweet.comment_count += 1
            session.add(tweet)

        await session.commit()
        await session.refresh(comment)
        return comment
    except Exception as e:
        await session.rollback()
        logging.error(f"create_comment error: {e}")
        return None


async def get_comments_for_tweet(
        session: AsyncSession, tweet_id: int, limit: int = 50, before_id: Optional[int] = None
) -> List[Comment]:
    try:
        q = select(Comment).where(Comment.tweet_id == tweet_id, Comment.is_deleted == False)
        if before_id is not None:
            q = q.where(Comment.id < before_id)
        q = q.order_by(Comment.id.desc()).limit(limit)
        result = await session.execute(q)
        return result.scalars().all()
    except Exception as e:
        logging.error(f"get_comments_for_tweet error: {e}")
        return []


async def delete_comment(session: AsyncSession, comment_id: int) -> bool:
    try:
        result = await session.execute(
            select(Comment).where(Comment.id == comment_id, Comment.is_deleted == False)
        )
        comment = result.scalars().first()
        if not comment:
            return False

        comment.is_deleted = True
        session.add(comment)

        tweet = await session.get(Tweet, comment.tweet_id)
        if tweet:
            tweet.comment_count = max(0, tweet.comment_count - 1)
            session.add(tweet)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        logging.error(f"delete_comment error: {e}")
        return False
