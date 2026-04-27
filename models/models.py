"""
models.py — Database models for the blog platform.

Old chat/tweet tables (user, tweet, like, comment, room, roommember, message, roomkeybundle)
are intentionally left in the DB untouched. All new blog tables use the 'blog_' prefix.
The 'user' table is shared and extended with new columns via init_db migrations.
"""

from sqlmodel import SQLModel, Field, Relationship, Column
from sqlalchemy import Text, UniqueConstraint
from datetime import datetime
from typing import Optional, List
from enum import Enum


# ── Enums ──────────────────────────────────────────────────────────────────────

class UserRole(str, Enum):
    ROOT   = "root"
    ADMIN  = "admin"
    AUTHOR = "author"
    INTERN = "intern"   # kept for backward-compat during DB migration


class PostStatus(str, Enum):
    DRAFT     = "draft"
    PUBLISHED = "published"
    ARCHIVED  = "archived"


# ── User (existing table, extended) ────────────────────────────────────────────

class User(SQLModel, table=True):
    """
    Shared user model.  The 'user' table already exists in Supabase;
    new columns are added via ALTER TABLE … ADD COLUMN IF NOT EXISTS in init_db().
    """
    __tablename__ = "user"

    id:            Optional[int] = Field(default=None, primary_key=True)
    username:      str           = Field(unique=True, index=True, max_length=50)
    password_hash: str
    role:          UserRole      = Field(default=UserRole.AUTHOR)

    # Profile
    display_name:    str            = Field(default="", max_length=100)
    bio:             Optional[str]  = Field(default=None, sa_column=Column(Text))
    avatar_url:      Optional[str]  = Field(default=None, max_length=500)
    website_url:     Optional[str]  = Field(default=None, max_length=300)
    twitter_handle:  Optional[str]  = Field(default=None, max_length=50)
    is_verified:     bool           = Field(default=False)

    # Denormalised counters
    post_count:  int = Field(default=0)
    tweet_count: int = Field(default=0)   # kept so old column still maps

    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Relationships (blog only — old chat relationships removed from ORM)
    posts:    List["BlogPost"]    = Relationship(back_populates="author")
    likes:    List["BlogLike"]    = Relationship(back_populates="user")
    comments: List["BlogComment"] = Relationship(back_populates="author")
    media:    List["BlogMedia"]   = Relationship(back_populates="uploader")


# ── BlogCategory ────────────────────────────────────────────────────────────────

class BlogCategory(SQLModel, table=True):
    __tablename__ = "blog_category"

    id:          Optional[int] = Field(default=None, primary_key=True)
    name:        str           = Field(unique=True, max_length=80)
    slug:        str           = Field(unique=True, index=True, max_length=80)
    description: Optional[str] = Field(default=None, max_length=400)
    color:       str           = Field(default="#6366f1", max_length=20)
    icon:        Optional[str] = Field(default=None, max_length=50)
    post_count:  int           = Field(default=0)
    created_at:  datetime      = Field(default_factory=datetime.utcnow)

    posts: List["BlogPost"] = Relationship(back_populates="category")


# ── BlogPost ────────────────────────────────────────────────────────────────────

class BlogPost(SQLModel, table=True):
    __tablename__ = "blog_post"

    id:    Optional[int] = Field(default=None, primary_key=True)
    slug:  str           = Field(unique=True, index=True, max_length=300)
    title: str           = Field(max_length=200, index=True)
    subtitle: Optional[str] = Field(default=None, max_length=300)

    body_html:  str           = Field(sa_column=Column(Text))    # rendered HTML for display
    body_delta: Optional[str] = Field(default=None, sa_column=Column(Text))  # Quill Delta JSON

    cover_image_url: Optional[str] = Field(default=None, max_length=500)
    author_id:       int            = Field(foreign_key="user.id", index=True)
    category_id:     Optional[int]  = Field(default=None, foreign_key="blog_category.id", index=True)

    status:   PostStatus = Field(default=PostStatus.DRAFT, index=True)
    featured: bool       = Field(default=False, index=True)

    view_count:    int = Field(default=0)
    like_count:    int = Field(default=0)
    comment_count: int = Field(default=0)
    read_time:     int = Field(default=1)  # minutes, computed on save

    meta_description: Optional[str] = Field(default=None, max_length=300)

    published_at: Optional[datetime] = Field(default=None, index=True)
    created_at:   datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at:   datetime = Field(default_factory=datetime.utcnow)

    # Relationships
    author:   Optional[User]         = Relationship(back_populates="posts")
    category: Optional[BlogCategory] = Relationship(back_populates="posts")
    tags:     List["BlogPostTag"]    = Relationship(back_populates="post")
    likes:    List["BlogLike"]       = Relationship(back_populates="post")
    comments: List["BlogComment"]    = Relationship(back_populates="post")


# ── BlogTag ─────────────────────────────────────────────────────────────────────

class BlogTag(SQLModel, table=True):
    __tablename__ = "blog_tag"

    id:   Optional[int] = Field(default=None, primary_key=True)
    name: str           = Field(unique=True, max_length=50)
    slug: str           = Field(unique=True, index=True, max_length=50)

    posts: List["BlogPostTag"] = Relationship(back_populates="tag")


# ── BlogPostTag (junction) ──────────────────────────────────────────────────────

class BlogPostTag(SQLModel, table=True):
    __tablename__ = "blog_post_tag"
    __table_args__ = (UniqueConstraint("post_id", "tag_id", name="uq_blog_post_tag"),)

    id:      Optional[int] = Field(default=None, primary_key=True)
    post_id: int           = Field(foreign_key="blog_post.id", index=True)
    tag_id:  int           = Field(foreign_key="blog_tag.id", index=True)

    post: Optional[BlogPost] = Relationship(back_populates="tags")
    tag:  Optional[BlogTag]  = Relationship(back_populates="posts")


# ── BlogLike ────────────────────────────────────────────────────────────────────

class BlogLike(SQLModel, table=True):
    __tablename__ = "blog_like"
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_blog_like"),)

    id:         Optional[int] = Field(default=None, primary_key=True)
    user_id:    int           = Field(foreign_key="user.id", index=True)
    post_id:    int           = Field(foreign_key="blog_post.id", index=True)
    created_at: datetime      = Field(default_factory=datetime.utcnow)

    user: Optional[User]     = Relationship(back_populates="likes")
    post: Optional[BlogPost] = Relationship(back_populates="likes")


# ── BlogComment ─────────────────────────────────────────────────────────────────

class BlogComment(SQLModel, table=True):
    __tablename__ = "blog_comment"

    id:         Optional[int] = Field(default=None, primary_key=True)
    body:       str           = Field(sa_column=Column(Text))
    post_id:    int           = Field(foreign_key="blog_post.id", index=True)
    author_id:  int           = Field(foreign_key="user.id", index=True)
    parent_id:  Optional[int] = Field(default=None, foreign_key="blog_comment.id")
    is_deleted: bool          = Field(default=False)
    created_at: datetime      = Field(default_factory=datetime.utcnow, index=True)

    post:   Optional[BlogPost]    = Relationship(back_populates="comments")
    author: Optional[User]        = Relationship(back_populates="comments")


# ── BlogMedia ───────────────────────────────────────────────────────────────────

class BlogMedia(SQLModel, table=True):
    __tablename__ = "blog_media"

    id:         Optional[int] = Field(default=None, primary_key=True)
    url:        str           = Field(max_length=500)
    filename:   str           = Field(max_length=255)
    mime_type:  str           = Field(max_length=100)
    size_bytes: Optional[int] = None
    author_id:  int           = Field(foreign_key="user.id", index=True)
    created_at: datetime      = Field(default_factory=datetime.utcnow)

    uploader: Optional[User] = Relationship(back_populates="media")


# ── BlogPostView ─────────────────────────────────────────────────────────────────

class BlogPostView(SQLModel, table=True):
    __tablename__ = "blog_post_view"

    id:         Optional[int] = Field(default=None, primary_key=True)
    post_id:    int           = Field(foreign_key="blog_post.id", index=True)
    viewer_id:  Optional[int] = Field(default=None, foreign_key="user.id", index=True)
    created_at: datetime      = Field(default_factory=datetime.utcnow, index=True)
