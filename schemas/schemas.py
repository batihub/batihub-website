from typing import Optional, List, Dict, Any
from datetime import datetime
from sqlmodel import SQLModel
from models.models import UserRole, RoomType


# ─────────────────────────────────────────────────────────────────────────────
# Auth / User
# ─────────────────────────────────────────────────────────────────────────────

class UserCreate(SQLModel):
    username: str
    password: str
    display_name: str = ""
    role: UserRole = UserRole.INTERN


class UserResponse(SQLModel):
    id: int
    username: str
    display_name: str
    role: UserRole


class UserPublic(SQLModel):
    """Minimal author info embedded in tweet/comment responses."""
    id: int
    username: str
    display_name: str
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


class UserSession(SQLModel):
    """Decoded JWT payload — passed around by get_current_user."""
    id: int
    username: str
    role: UserRole


class Token(SQLModel):
    access_token: str
    token_type: str


class TokenData(SQLModel):
    username: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Room
# ─────────────────────────────────────────────────────────────────────────────

class GroupRoomCreate(SQLModel):
    """Body for POST /rooms/group"""
    name: str
    description: str = ""


class PrivateRoomCreate(SQLModel):
    """Body for POST /rooms/private — replaces PrivateUserInvite"""
    username: str


# Keep old name as an alias so existing code doesn't break immediately
PrivateUserInvite = PrivateRoomCreate


class RoomMemberOut(SQLModel):
    user_id: int
    username: str
    is_admin: bool
    joined_at: datetime

    class Config:
        from_attributes = True


class RoomOut(SQLModel):
    """
    Returned by room list and create endpoints.
    member_count and online_count are populated by the route layer.
    """
    id: str
    type: RoomType
    name: str
    description: str
    owner_id: int
    locked: bool
    created_at: datetime
    member_count: Optional[int] = None
    online_count: Optional[int] = None
    online_users: Optional[List[str]] = None

    class Config:
        from_attributes = True


class RoomDetailOut(RoomOut):
    """Extended room info — includes the full member list."""
    members: List[RoomMemberOut] = []


# ─────────────────────────────────────────────────────────────────────────────
# Tweet
# ─────────────────────────────────────────────────────────────────────────────

class TweetCreate(SQLModel):
    content: str  # max_length enforced at the model level (280)


class TweetUpdate(SQLModel):
    content: str  # only content is editable


class CommentOut(SQLModel):
    id: int
    content: str
    author: UserPublic
    created_at: datetime

    class Config:
        from_attributes = True


class TweetOut(SQLModel):
    """
    Full tweet response — includes author info and counts.
    'liked_by_me' is populated by the route layer (needs the current user),
    so it defaults to None for unauthenticated/list views.
    """
    id: int
    content: str
    author: UserPublic
    like_count: int
    comment_count: int
    is_edited: bool
    created_at: datetime
    liked_by_me: Optional[bool] = None

    class Config:
        from_attributes = True


class TweetFeedOut(SQLModel):
    """
    Wrapper returned by the paginated feed endpoint.
    'next_cursor' is the id of the oldest tweet in this batch —
    pass it back as ?before_id= to get the next page.
    Set to None when there are no more tweets.
    """
    tweets: list[TweetOut]
    next_cursor: Optional[int]


# ─────────────────────────────────────────────────────────────────────────────
# Comment
# ─────────────────────────────────────────────────────────────────────────────

class CommentCreate(SQLModel):
    content: str


# ─────────────────────────────────────────────────────────────────────────────
# E2EE
# ─────────────────────────────────────────────────────────────────────────────

class PublicKeyUpdate(SQLModel):
    """Body for PUT /users/me/public-key — JWK JSON string of an ECDH P-256 public key."""
    public_key: str


class RoomKeyBundleIn(SQLModel):
    """
    Body for PUT /rooms/{room_id}/key-bundles.
    bundles maps username → ECIES bundle dict:
      { ephemeral_pub: JWK, iv: base64, ct: base64 }
    """
    bundles: Dict[str, Any]