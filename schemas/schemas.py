"""
schemas.py — Pydantic / SQLModel schemas for the blog platform.
"""

from typing import Optional, List
from datetime import datetime
from sqlmodel import SQLModel

from models.models import UserRole, PostStatus


# ─────────────────────────────────────────────────────────────────────────────
# Auth / Session
# ─────────────────────────────────────────────────────────────────────────────

class Token(SQLModel):
    access_token: str
    token_type: str


class UserSession(SQLModel):
    """Decoded JWT payload passed around by get_current_user."""
    id:       int
    username: str
    role:     UserRole


# ─────────────────────────────────────────────────────────────────────────────
# User
# ─────────────────────────────────────────────────────────────────────────────

class UserCreate(SQLModel):
    username:     str
    password:     str
    display_name: str      = ""
    role:         UserRole = UserRole.AUTHOR


class UserUpdate(SQLModel):
    display_name:   Optional[str] = None
    bio:            Optional[str] = None
    avatar_url:     Optional[str] = None
    website_url:    Optional[str] = None
    twitter_handle: Optional[str] = None


class UserPublic(SQLModel):
    """Minimal author info embedded in post/comment responses."""
    id:             int
    username:       str
    display_name:   str
    avatar_url:     Optional[str]  = None
    is_verified:    bool           = False
    post_count:     int            = 0

    class Config:
        from_attributes = True


class UserProfile(SQLModel):
    """Full profile for the profile page."""
    id:             int
    username:       str
    display_name:   str
    bio:            Optional[str]  = None
    avatar_url:     Optional[str]  = None
    website_url:    Optional[str]  = None
    twitter_handle: Optional[str]  = None
    is_verified:    bool           = False
    post_count:     int            = 0
    role:           UserRole
    created_at:     datetime

    class Config:
        from_attributes = True


class UserResponse(SQLModel):
    id:           int
    username:     str
    display_name: str
    role:         UserRole


# ─────────────────────────────────────────────────────────────────────────────
# Category
# ─────────────────────────────────────────────────────────────────────────────

class CategoryCreate(SQLModel):
    name:        str
    description: Optional[str] = None
    color:       str           = "#6366f1"
    icon:        Optional[str] = None


class CategoryUpdate(SQLModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    color:       Optional[str] = None
    icon:        Optional[str] = None


class CategoryOut(SQLModel):
    id:          int
    name:        str
    slug:        str
    description: Optional[str] = None
    color:       str
    icon:        Optional[str] = None
    post_count:  int           = 0

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────────────────────
# Tag
# ─────────────────────────────────────────────────────────────────────────────

class TagOut(SQLModel):
    id:   int
    name: str
    slug: str

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────────────────────
# Post
# ─────────────────────────────────────────────────────────────────────────────

class PostCreate(SQLModel):
    title:            str
    subtitle:         Optional[str] = None
    body_html:        str           = ""
    body_delta:       Optional[str] = None
    cover_image_url:  Optional[str] = None
    category_id:      Optional[int] = None
    tags:             List[str]     = []     # tag names (created on the fly)
    status:           PostStatus    = PostStatus.DRAFT
    meta_description: Optional[str] = None
    featured:         bool          = False


class PostUpdate(SQLModel):
    title:            Optional[str]       = None
    subtitle:         Optional[str]       = None
    body_html:        Optional[str]       = None
    body_delta:       Optional[str]       = None
    cover_image_url:  Optional[str]       = None
    category_id:      Optional[int]       = None
    tags:             Optional[List[str]] = None
    status:           Optional[PostStatus] = None
    meta_description: Optional[str]       = None
    featured:         Optional[bool]      = None


class PostCardOut(SQLModel):
    """Compact post for feed cards — no body content."""
    id:              int
    slug:            str
    title:           str
    subtitle:        Optional[str]   = None
    cover_image_url: Optional[str]   = None
    author:          UserPublic
    category:        Optional[CategoryOut] = None
    tags:            List[TagOut]    = []
    status:          PostStatus
    view_count:      int
    like_count:      int
    comment_count:   int
    read_time:       int
    featured:        bool
    published_at:    Optional[datetime] = None
    created_at:      datetime
    liked_by_me:     Optional[bool]  = None

    class Config:
        from_attributes = True


class PostOut(PostCardOut):
    """Full post — includes body_html and body_delta for editor."""
    body_html:        str
    body_delta:       Optional[str]  = None
    meta_description: Optional[str]  = None
    updated_at:       datetime

    class Config:
        from_attributes = True


class PostFeedOut(SQLModel):
    posts:       List[PostCardOut]
    next_cursor: Optional[int]
    total:       int


# ─────────────────────────────────────────────────────────────────────────────
# Comment
# ─────────────────────────────────────────────────────────────────────────────

class CommentCreate(SQLModel):
    body:      str
    parent_id: Optional[int] = None


class CommentOut(SQLModel):
    id:         int
    body:       str
    author:     UserPublic
    parent_id:  Optional[int] = None
    created_at: datetime
    replies:    List["CommentOut"] = []

    class Config:
        from_attributes = True


CommentOut.model_rebuild()


# ─────────────────────────────────────────────────────────────────────────────
# Media
# ─────────────────────────────────────────────────────────────────────────────

class MediaOut(SQLModel):
    id:        int
    url:       str
    filename:  str
    mime_type: str

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────────────────────
# Admin
# ─────────────────────────────────────────────────────────────────────────────

class AdminStats(SQLModel):
    total_users:     int
    total_posts:     int
    total_published: int
    total_drafts:    int
    total_categories: int
    total_comments:  int


class AdminUserOut(SQLModel):
    id:           int
    username:     str
    display_name: str
    role:         UserRole
    post_count:   int
    is_verified:  bool
    created_at:   datetime
