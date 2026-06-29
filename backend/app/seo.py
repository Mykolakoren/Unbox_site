"""
Per-post SEO / link-preview (og:image, заголовок) для /news/:slug и
/articles/:slug.

Owner 2026-06-29: контент-страницы — SPA, при шеринге ссылки в Telegram/
соцсети показывалась общая карточка сайта (og:image=og-cover.jpg) без
обложки и заголовка поста. Решение без SSR: для путей постов FastAPI
отдаёт тот же собранный index.html, но с подменёнными og/twitter-мета по
данным поста. Люди получают обычный SPA (React гидрируется и рисует
страницу), боты-краулеры читают правильные мета. nginx проксирует только
паттерн /(news|articles)/<slug> на бэк (см. deploy).
"""
import os
import re
from html import escape

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlmodel import Session, select

from app.db.session import get_session
from app.models.post import Post

router = APIRouter()

# Путь к собранному index.html (на проде статика в /var/www/unbox/dist).
# Перекрывается env UNBOX_DIST_INDEX при необходимости.
DIST_INDEX = os.environ.get("UNBOX_DIST_INDEX", "/var/www/unbox/dist/index.html")
SITE = "https://unbox.com.ge"


def _read_index() -> str:
    try:
        with open(DIST_INDEX, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _set_meta(html: str, attr: str, key: str, val: str) -> str:
    """Подменить content у <meta {attr}="{key}" content="…">."""
    pattern = re.compile(
        rf'(<meta\s+{attr}="{re.escape(key)}"\s+content=")[^"]*(")'
    )
    if pattern.search(html):
        return pattern.sub(lambda m: m.group(1) + escape(val, quote=True) + m.group(2), html, count=1)
    return html


def _inject(html: str, *, title: str, desc: str, image: str, url: str) -> str:
    if not html:
        return html
    html = re.sub(r"<title>[^<]*</title>", f"<title>{escape(title)}</title>", html, count=1)
    html = _set_meta(html, "name", "description", desc)
    html = _set_meta(html, "property", "og:type", "article")
    html = _set_meta(html, "property", "og:title", title)
    html = _set_meta(html, "property", "og:description", desc)
    html = _set_meta(html, "property", "og:image", image)
    html = _set_meta(html, "property", "og:url", url)
    html = _set_meta(html, "name", "twitter:title", title)
    html = _set_meta(html, "name", "twitter:description", desc)
    html = _set_meta(html, "name", "twitter:image", image)
    return html


def _serve_post(kind: str, slug: str, session: Session) -> HTMLResponse:
    html = _read_index()
    post = session.exec(
        select(Post).where(Post.slug == slug, Post.is_published == True)  # noqa: E712
    ).first()
    # Пост не найден/черновик — отдаём index.html как есть (SPA покажет 404).
    if not post or not html:
        return HTMLResponse(html or "<!doctype html><title>Unbox</title>")
    title = f"{post.title} — Unbox"
    desc = (post.excerpt or post.title or "")[:200]
    image = post.cover_image_url or f"{SITE}/og-cover.jpg"
    if image.startswith("/"):
        image = SITE + image
    seg = "news" if kind == "news" else "articles"
    url = f"{SITE}/{seg}/{slug}"
    return HTMLResponse(_inject(html, title=title, desc=desc, image=image, url=url))


@router.get("/news/{slug}", response_class=HTMLResponse, include_in_schema=False)
def news_seo(slug: str, session: Session = Depends(get_session)):
    return _serve_post("news", slug, session)


@router.get("/articles/{slug}", response_class=HTMLResponse, include_in_schema=False)
def articles_seo(slug: str, session: Session = Depends(get_session)):
    return _serve_post("article", slug, session)
