from sqlmodel import SQLModel, Field, Relationship, Column
from sqlalchemy import Text, UniqueConstraint
from datetime import datetime, timezone
from typing import Optional, List
from enum import Enum


# ── Enums ─────────────────────────────────────────────────────────────────────

class UserRole(str, Enum):
    INTERN = "intern"
    ADMIN = "admin"
    ROOT = "root"


# ── User ──────────────────────────────────────────────────────────────────────

class User(SQLModel, table=True):
    """
    Unified user for the whole app (chat + twitter feed).
    Added display_name, bio, avatar_url for the Twitter side.
    username stays as the unique login handle.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True, max_length=50)
    password_hash: str
    role: UserRole = Field(default=UserRole.INTERN)

    # Profile (used by the Twitter feed UI)
    display_name: str = Field(default="", max_length=100)
    bio: Optional[str] = Field(default=None, max_length=500)
    avatar_url: Optional[str] = Field(default=None, max_length=500)

    # Denormalised counters — cheaper than COUNT(*) on every feed load
    tweet_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    tweets: List["Tweet"] = Relationship(back_populates="author")
    likes: List["Like"] = Relationship(back_populates="user")
    comments: List["Comment"] = Relationship(back_populates="author")
    messages: List["Message"] = Relationship(back_populates="sender")


# ── Tweet ─────────────────────────────────────────────────────────────────────

class Tweet(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str = Field(max_length=280)
    author_id: int = Field(foreign_key="user.id", index=True)

    # Soft delete — keeps like/comment counts consistent
    is_deleted: bool = Field(default=False, index=True)
    is_edited: bool = Field(default=False)

    # Denormalised counters
    like_count: int = Field(default=0)
    comment_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)

    # Relationships
    author: Optional[User] = Relationship(back_populates="tweets")
    likes: List["Like"] = Relationship(back_populates="tweet")
    comments: List["Comment"] = Relationship(back_populates="tweet")


# ── Like ──────────────────────────────────────────────────────────────────────

class Like(SQLModel, table=True):
    """
    A user can like a tweet exactly once — enforced by the unique constraint.
    """
    __table_args__ = (UniqueConstraint("user_id", "tweet_id", name="uq_like_user_tweet"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    tweet_id: int = Field(foreign_key="tweet.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    user: Optional[User] = Relationship(back_populates="likes")
    tweet: Optional[Tweet] = Relationship(back_populates="likes")


# ── Comment ───────────────────────────────────────────────────────────────────

class Comment(SQLModel, table=True):
    """
    Flat comments on a tweet — no nested replies to keep things simple.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str = Field(max_length=280)
    tweet_id: int = Field(foreign_key="tweet.id", index=True)
    author_id: int = Field(foreign_key="user.id", index=True)
    is_deleted: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)

    tweet: Optional[Tweet] = Relationship(back_populates="comments")
    author: Optional[User] = Relationship(back_populates="comments")


# ── Message (chat — unchanged) ────────────────────────────────────────────────

class Message(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    message: str
    sender_id: Optional[int] = Field(default=None, foreign_key="user.id")
    room_id: str = Field(index=True)
    is_read: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    sender: Optional[User] = Relationship(back_populates="messages")
