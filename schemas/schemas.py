from typing import Optional
from datetime import datetime
from sqlmodel import SQLModel
from models.models import UserRole


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
# Tweet
# ─────────────────────────────────────────────────────────────────────────────

class TweetCreate(SQLModel):
    content: str  # max_length enforced at the model level (280)


class TweetUpdate(SQLModel):
    content: str   # only content is editable


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
