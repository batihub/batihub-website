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


class RoomType(str, Enum):
    GROUP = "group"
    PRIVATE = "private"


# ── User ──────────────────────────────────────────────────────────────────────

class User(SQLModel, table=True):
    """
    Unified user for the whole app (chat + twitter feed).
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

    # E2EE: client-generated ECDH P-256 public key stored as JWK JSON string.
    # The server never sees private keys — it only relays this public key.
    public_key: Optional[str] = Field(default=None, sa_column=Column(Text))

    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())

    # Relationships
    tweets: List["Tweet"] = Relationship(back_populates="author")
    likes: List["Like"] = Relationship(back_populates="user")
    comments: List["Comment"] = Relationship(back_populates="author")
    messages: List["Message"] = Relationship(back_populates="sender")
    room_memberships: List["RoomMember"] = Relationship(back_populates="user")


# ── Room ──────────────────────────────────────────────────────────────────────

class Room(SQLModel, table=True):
    """
    Represents both private (1-1) and group chat rooms.

    Private rooms:
      - type = RoomType.PRIVATE
      - canonical_key = "private:alice:bob"  (sorted alphabetically, always unique)
      - exactly 2 RoomMember rows

    Group rooms:
      - type = RoomType.GROUP
      - canonical_key = None
      - N RoomMember rows; owner_id is the creator
      - can be locked (read-only for non-admins)
    """
    id: str = Field(primary_key=True)               # UUID string — never changes
    type: RoomType

    # Human-readable name; for private rooms this mirrors canonical_key
    name: str = Field(index=True, max_length=64)

    # Only set for private rooms; unique constraint prevents duplicate DM pairs
    canonical_key: Optional[str] = Field(
        default=None, unique=True, index=True, max_length=128
    )

    description: str = Field(default="", max_length=500)
    owner_id: int = Field(foreign_key="user.id", index=True)
    locked: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())

    # Relationships
    members: List["RoomMember"] = Relationship(back_populates="room")
    messages: List["Message"] = Relationship(back_populates="room")


# ── RoomMember ────────────────────────────────────────────────────────────────

class RoomMember(SQLModel, table=True):
    """
    Junction table — who belongs to which room.
    Works for both private (always 2 rows) and group (N rows) rooms.
    """
    __table_args__ = (
        UniqueConstraint("room_id", "user_id", name="uq_room_member"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: str = Field(foreign_key="room.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    is_admin: bool = Field(default=False)       # group admins can kick/invite
    joined_at: datetime = Field(default_factory=lambda: datetime.utcnow())

    # Relationships
    room: Optional[Room] = Relationship(back_populates="members")
    user: Optional[User] = Relationship(back_populates="room_memberships")


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

    created_at: datetime = Field(default_factory=lambda: datetime.utcnow(), index=True)

    # Relationships
    author: Optional[User] = Relationship(back_populates="tweets")
    likes: List["Like"] = Relationship(back_populates="tweet")
    comments: List["Comment"] = Relationship(back_populates="tweet")


# ── Like ──────────────────────────────────────────────────────────────────────

class Like(SQLModel, table=True):
    """A user can like a tweet exactly once — enforced by the unique constraint."""
    __table_args__ = (UniqueConstraint("user_id", "tweet_id", name="uq_like_user_tweet"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    tweet_id: int = Field(foreign_key="tweet.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())

    user: Optional[User] = Relationship(back_populates="likes")
    tweet: Optional[Tweet] = Relationship(back_populates="likes")


# ── Comment ───────────────────────────────────────────────────────────────────

class Comment(SQLModel, table=True):
    """Flat comments on a tweet — no nested replies to keep things simple."""
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str = Field(max_length=280)
    tweet_id: int = Field(foreign_key="tweet.id", index=True)
    author_id: int = Field(foreign_key="user.id", index=True)
    is_deleted: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow(), index=True)

    tweet: Optional[Tweet] = Relationship(back_populates="comments")
    author: Optional[User] = Relationship(back_populates="comments")


# ── Message ───────────────────────────────────────────────────────────────────

class Message(SQLModel, table=True):
    """
    A single chat message inside a Room.
    room_id is now a real FK to Room.id — no more free-text strings.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    message: str = Field(sa_column=Column(Text))    # no arbitrary length cap
    sender_id: Optional[int] = Field(default=None, foreign_key="user.id")
    room_id: str = Field(foreign_key="room.id", index=True)  # ← real FK
    is_read: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow(), index=True)

    sender: Optional[User] = Relationship(back_populates="messages")
    room: Optional[Room] = Relationship(back_populates="messages")


# ── RoomKeyBundle ─────────────────────────────────────────────────────────────

class RoomKeyBundle(SQLModel, table=True):
    """
    Stores one ECIES-wrapped room key per member per group room.

    The server holds only opaque ciphertext — it can NEVER read the room key.
    The bundle JSON layout (stored in encrypted_key):
        { "ephemeral_pub": <JWK>, "iv": "<base64>", "ct": "<base64>" }

    Flow:
      • Room creator generates a random AES-256-GCM room key.
      • For each member the creator: generates an ephemeral ECDH key pair,
        derives a shared secret with the member's public key (ECDH P-256),
        runs HKDF, then AES-GCM-wraps the room key.
      • Member fetches their bundle, re-derives the same wrap key with their
        own private key + the stored ephemeral public key, and unwraps.
    """
    __table_args__ = (UniqueConstraint("room_id", "user_id", name="uq_room_key_bundle"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: str = Field(foreign_key="room.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    encrypted_key: str = Field(sa_column=Column(Text))  # JSON bundle (see above)
    created_at: datetime = Field(default_factory=lambda: datetime.utcnow())