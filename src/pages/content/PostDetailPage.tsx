import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { format as fmtDate, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { StructuredText } from '../../components/StructuredText';
import { postsApi, type Post } from '../../api/posts';

/**
 * PostDetailPage — публичная страница новости/статьи по slug.
 * Шаблон GH (masthead + обложка-герой + StructuredText). Для статьи —
 * мини-карточка автора со ссылкой на /specialists/:id. Owner 2026-06-13.
 */
const ghMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' };

function safeDate(iso?: string | null): string {
    if (!iso) return '';
    try { return fmtDate(parseISO(iso), 'd MMMM yyyy', { locale: ru }); } catch { return ''; }
}

export function PostDetailPage() {
    const { slug } = useParams<{ slug: string }>();
    const [post, setPost] = useState<Post | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!slug) return;
        setLoading(true);
        postsApi.getBySlug(slug)
            .then(p => {
                setPost(p);
                document.title = `${p.title} · Unbox`;
                // Базовое SEO: meta description из excerpt.
                const meta = document.querySelector('meta[name="description"]');
                if (meta && p.excerpt) meta.setAttribute('content', p.excerpt);
            })
            .catch(() => setError('Пост не найден'))
            .finally(() => setLoading(false));
    }, [slug]);

    const isArticle = post?.type === 'article';
    const backTo = isArticle ? '/articles' : '/news';
    const backLabel = isArticle ? 'Все статьи' : 'Все новости';

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, fontFamily: GH_SANS, color: GH.ink, overflowX: 'hidden' }}>
            <header style={{ borderBottom: `1px solid ${GH.ink10}`, background: GH.paper, position: 'sticky', top: 0, zIndex: 40 }}>
                <div style={{ maxWidth: 760, margin: '0 auto', padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Link to="/" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>Unbox</Link>
                    <Link to={backTo} style={{ ...ghMono, color: GH.label, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ArrowLeft size={12} /> {backLabel}
                    </Link>
                </div>
            </header>

            <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px clamp(16px, 4vw, 24px) 80px' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '80px 0', color: GH.ink30 }}>
                        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                    </div>
                ) : error || !post ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: GH.ink30 }}>
                        <p style={{ fontSize: 15, fontWeight: 600 }}>{error || 'Пост не найден'}</p>
                        <Link to={backTo} style={{ color: GH.accent, fontSize: 14 }}>← {backLabel}</Link>
                    </div>
                ) : (
                    <article>
                        <div style={{ ...ghMono, color: GH.label, marginBottom: 12 }}>
                            {isArticle ? 'СТАТЬЯ' : 'НОВОСТЬ'} · {safeDate(post.publishedAt || post.createdAt)}
                        </div>
                        <h1 style={{ fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, margin: '0 0 20px' }}>
                            {post.title}
                        </h1>

                        {post.coverImageUrl && (
                            <div style={{ marginBottom: 28, overflow: 'hidden', background: GH.cellDead }}>
                                <img src={post.coverImageUrl} alt={post.title} style={{ width: '100%', display: 'block' }} />
                            </div>
                        )}

                        <div style={{ fontSize: 17, lineHeight: 1.7, color: GH.ink }}>
                            <StructuredText text={post.body} />
                        </div>

                        {/* Автор (только для статьи) */}
                        {isArticle && post.authorSpecialistId && (
                            <Link
                                to={`/specialists/${post.authorSpecialistId}`}
                                style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 14, padding: 16, border: `1px solid ${GH.ink10}`, background: '#fff', textDecoration: 'none', color: GH.ink }}
                            >
                                {post.authorPhotoUrl ? (
                                    <img src={post.authorPhotoUrl} alt={post.authorName || ''} style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }} />
                                ) : (
                                    <div style={{ width: 48, height: 48, borderRadius: '50%', background: GH.cellDead }} />
                                )}
                                <div>
                                    <div style={{ ...ghMono, color: GH.ink30, fontSize: 9, marginBottom: 2 }}>АВТОР</div>
                                    <div style={{ fontWeight: 700, fontSize: 15 }}>{post.authorName || 'Специалист Unbox'}</div>
                                    <div style={{ fontSize: 12, color: GH.accent }}>Профиль и запись →</div>
                                </div>
                            </Link>
                        )}
                    </article>
                )}
            </div>
        </div>
    );
}
