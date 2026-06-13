"""
Post — единая модель контента: новости/анонсы и статьи специалистов.

Owner 2026-06-13: новости и статьи структурно идентичны, поэтому одна
таблица `posts` с дискриминатором `type` ("news" | "article"). News —
без автора (события центра), article — с author_specialist_id (текст
конкретного психолога). Публикует админ за всех (см. CLAUDE.md / план).
"""
from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime
from uuid import UUID
import uuid


class PostBase(SQLModel):
    type: str = Field(default="news", index=True)  # "news" | "article"
    title: str
    # Уникальный человекочитаемый идентификатор для URL (/news/<slug>).
    # Генерится из title на бэке (translit + dedupe), редактируем в админке.
    slug: str = Field(index=True)
    excerpt: str = Field(default="")   # краткое описание для карточки + SEO description
    body: str = Field(default="")      # текст с ##-разметкой (как анкеты спецов)
    cover_image_url: Optional[str] = None
    # Только для type="article": ссылка на профиль специалиста-автора.
    # NULL для новостей. Строкой (UUID) — без жёсткого FK, т.к. specialists.id
    # это UUID и SQLite-зеркало исторически не любит cross-type FK.
    author_specialist_id: Optional[str] = Field(default=None, index=True)
    is_published: bool = Field(default=False, index=True)
    published_at: Optional[datetime] = None


class Post(PostBase, table=True):
    __tablename__ = "posts"  # type: ignore

    id: UUID = Field(default_factory=uuid.uuid4, primary_key=True, index=True)
    created_at: datetime = Field(default_factory=datetime.utcnow, index=True)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PostCreate(SQLModel):
    type: str = "news"
    title: str
    slug: Optional[str] = None          # авто-генерится если не задан
    excerpt: str = ""
    body: str = ""
    cover_image_url: Optional[str] = None
    author_specialist_id: Optional[str] = None
    is_published: bool = False


class PostUpdate(SQLModel):
    type: Optional[str] = None
    title: Optional[str] = None
    slug: Optional[str] = None
    excerpt: Optional[str] = None
    body: Optional[str] = None
    cover_image_url: Optional[str] = None
    author_specialist_id: Optional[str] = None
    is_published: Optional[bool] = None


class PostRead(PostBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    # Enriched на чтении (join по author_specialist_id) — для карточки автора.
    author_name: Optional[str] = None
    author_photo_url: Optional[str] = None
