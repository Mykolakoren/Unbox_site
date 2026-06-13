"""
Posts — новости/анонсы и статьи специалистов (единая сущность, type-дискриминатор).

Публичные GET (только опубликованные) + админский CRUD (require_admin).
Owner 2026-06-13 — см. план контент-блока.
"""
from typing import List, Optional
from datetime import datetime
from uuid import UUID
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.db.session import get_session
from app.models.post import Post, PostRead, PostCreate, PostUpdate
from app.models.specialist import Specialist
from app.models.user import User
from app.api.deps import require_admin

router = APIRouter()

# ── slug helpers ─────────────────────────────────────────────────────────────
# Транслит кириллицы для человекочитаемых URL. Без внешних зависимостей.
_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e',
    'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
    'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
    'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
    'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def _slugify(title: str) -> str:
    s = title.strip().lower()
    out = []
    for ch in s:
        if ch in _TRANSLIT:
            out.append(_TRANSLIT[ch])
        elif ch.isalnum():
            out.append(ch)
        elif ch in ' -_':
            out.append('-')
    slug = re.sub(r'-+', '-', ''.join(out)).strip('-')
    return slug or 'post'


def _unique_slug(session: Session, base: str, exclude_id: Optional[UUID] = None) -> str:
    """Гарантирует уникальность slug, добавляя -2, -3 при коллизии."""
    candidate = base
    n = 1
    while True:
        q = select(Post).where(Post.slug == candidate)
        existing = session.exec(q).first()
        if existing is None or existing.id == exclude_id:
            return candidate
        n += 1
        candidate = f"{base}-{n}"


# ── enrich author ────────────────────────────────────────────────────────────
def _to_read(session: Session, post: Post) -> PostRead:
    data = PostRead.model_validate(post)
    if post.author_specialist_id:
        try:
            sp = session.get(Specialist, UUID(str(post.author_specialist_id)))
        except (ValueError, TypeError):
            sp = None
        if sp:
            data.author_name = f"{sp.first_name} {sp.last_name}".strip()
            data.author_photo_url = sp.photo_url
    return data


# ── public ───────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[PostRead])
def list_posts(
    *,
    session: Session = Depends(get_session),
    type: Optional[str] = Query(None, description="news | article"),
    limit: int = Query(50, le=100),
    offset: int = 0,
):
    """Публичная лента — только опубликованные, новые сверху."""
    q = select(Post).where(Post.is_published == True)  # noqa: E712
    if type:
        q = q.where(Post.type == type)
    q = q.order_by(Post.published_at.desc()).offset(offset).limit(limit)  # type: ignore
    posts = session.exec(q).all()
    return [_to_read(session, p) for p in posts]


@router.get("/admin", response_model=List[PostRead])
def list_posts_admin(
    *,
    session: Session = Depends(get_session),
    type: Optional[str] = Query(None),
    _admin: User = Depends(require_admin),
):
    """Все посты включая черновики (для редактора)."""
    q = select(Post)
    if type:
        q = q.where(Post.type == type)
    q = q.order_by(Post.created_at.desc())  # type: ignore
    return [_to_read(session, p) for p in session.exec(q).all()]


@router.get("/{slug}", response_model=PostRead)
def get_post(
    *,
    session: Session = Depends(get_session),
    slug: str,
):
    """Публичная страница поста по slug (только опубликованный)."""
    post = session.exec(select(Post).where(Post.slug == slug)).first()
    if not post or not post.is_published:
        raise HTTPException(404, "Пост не найден")
    return _to_read(session, post)


# ── admin CRUD ───────────────────────────────────────────────────────────────
@router.post("/admin", response_model=PostRead)
def create_post(
    *,
    session: Session = Depends(get_session),
    data: PostCreate,
    _admin: User = Depends(require_admin),
):
    base_slug = _slugify(data.slug) if data.slug else _slugify(data.title)
    slug = _unique_slug(session, base_slug)
    post = Post(
        type=data.type,
        title=data.title,
        slug=slug,
        excerpt=data.excerpt,
        body=data.body,
        cover_image_url=data.cover_image_url,
        author_specialist_id=data.author_specialist_id if data.type == "article" else None,
        is_published=data.is_published,
        published_at=datetime.utcnow() if data.is_published else None,
    )
    session.add(post)
    session.commit()
    session.refresh(post)
    return _to_read(session, post)


@router.patch("/admin/{post_id}", response_model=PostRead)
def update_post(
    *,
    session: Session = Depends(get_session),
    post_id: UUID,
    data: PostUpdate,
    _admin: User = Depends(require_admin),
):
    post = session.get(Post, post_id)
    if not post:
        raise HTTPException(404, "Пост не найден")

    patch = data.model_dump(exclude_unset=True)

    # slug — пере-нормализуем и проверяем уникальность если меняется
    if "slug" in patch and patch["slug"]:
        patch["slug"] = _unique_slug(session, _slugify(patch["slug"]), exclude_id=post.id)

    # publish-переход: проставляем published_at при первой публикации
    if patch.get("is_published") and not post.is_published:
        patch["published_at"] = datetime.utcnow()

    # news не имеет автора
    effective_type = patch.get("type", post.type)
    if effective_type != "article":
        patch["author_specialist_id"] = None

    for k, v in patch.items():
        setattr(post, k, v)
    post.updated_at = datetime.utcnow()

    session.add(post)
    session.commit()
    session.refresh(post)
    return _to_read(session, post)


@router.delete("/admin/{post_id}")
def delete_post(
    *,
    session: Session = Depends(get_session),
    post_id: UUID,
    _admin: User = Depends(require_admin),
):
    post = session.get(Post, post_id)
    if not post:
        raise HTTPException(404, "Пост не найден")
    session.delete(post)
    session.commit()
    return {"ok": True}
