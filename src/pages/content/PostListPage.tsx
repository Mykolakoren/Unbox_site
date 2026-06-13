import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { format as fmtDate, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { postsApi, type Post, type PostType } from '../../api/posts';

/**
 * PostListPage — публичная лента новостей или статей (один компонент,
 * параметризован type). Шаблон GH (masthead + сетка карточек), как
 * SpecialistsPage. Owner 2026-06-13.
 */
const ghMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' };

const COPY: Record<PostType, { label: string; title: string; sub: string; base: string; empty: string }> = {
    news: {
        label: 'НОВОСТИ',
        title: 'Новости и анонсы',
        sub: 'События, анонсы и обновления центра Unbox.',
        base: '/news',
        empty: 'Пока нет новостей. Скоро здесь появятся анонсы.',
    },
    article: {
        label: 'СТАТЬИ',
        title: 'Тексты специалистов',
        sub: 'Заметки и статьи психологов, которые принимают в Unbox.',
        base: '/articles',
        empty: 'Пока нет статей. Специалисты готовят первые тексты.',
    },
};

function safeDate(iso?: string | null): string {
    if (!iso) return '';
    try { return fmtDate(parseISO(iso), 'd MMMM yyyy', { locale: ru }); } catch { return ''; }
}

export function PostListPage({ type }: { type: PostType }) {
    const copy = COPY[type];
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        document.title = `${copy.title} · Unbox`;
        setLoading(true);
        postsApi.list(type)
            .then(setPosts)
            .catch(() => setError('Не удалось загрузить'))
            .finally(() => setLoading(false));
    }, [type, copy.title]);

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, fontFamily: GH_SANS, color: GH.ink, overflowX: 'hidden' }}>
            {/* Masthead */}
            <header style={{ borderBottom: `1px solid ${GH.ink10}`, background: GH.paper, position: 'sticky', top: 0, zIndex: 40 }}>
                <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                        <Link to="/" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>Unbox</Link>
                        <span style={{ ...ghMono, color: GH.label, fontSize: 9 }}>{copy.label}</span>
                    </div>
                    <nav style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Link to="/news" style={{ ...ghMono, color: type === 'news' ? GH.ink : GH.label, textDecoration: 'none' }}>Новости</Link>
                        <Link to="/articles" style={{ ...ghMono, color: type === 'article' ? GH.ink : GH.label, textDecoration: 'none' }}>Статьи</Link>
                        <Link to="/specialists" style={{ ...ghMono, color: GH.label, textDecoration: 'none' }}>Специалисты</Link>
                    </nav>
                </div>
            </header>

            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px clamp(16px, 4vw, 24px) 80px' }}>
                {/* Header */}
                <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                    <div style={{ ...ghMono, color: GH.label, marginBottom: 8 }}>{copy.label}</div>
                    <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                        {copy.title}
                    </h1>
                    <p style={{ fontSize: 15, color: GH.ink60, maxWidth: 560, margin: 0 }}>{copy.sub}</p>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '80px 0', color: GH.ink30 }}>
                        <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
                        <p style={{ fontSize: 13 }}>Загрузка…</p>
                    </div>
                ) : error ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: GH.danger, fontSize: 14 }}>{error}</div>
                ) : posts.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: GH.ink30, fontSize: 14 }}>{copy.empty}</div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 24 }}>
                        {posts.map(p => (
                            <Link
                                key={p.id}
                                to={`${copy.base}/${p.slug}`}
                                style={{ textDecoration: 'none', color: GH.ink, display: 'flex', flexDirection: 'column', border: `1px solid ${GH.ink10}`, background: '#fff', borderRadius: 0, overflow: 'hidden' }}
                            >
                                {p.coverImageUrl ? (
                                    <div style={{ aspectRatio: '16/10', overflow: 'hidden', background: GH.cellDead }}>
                                        <img src={p.coverImageUrl} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    </div>
                                ) : (
                                    <div style={{ aspectRatio: '16/10', background: GH.cellDead, display: 'grid', placeItems: 'center', color: GH.ink30, ...ghMono }}>
                                        {copy.label}
                                    </div>
                                )}
                                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                                    <div style={{ ...ghMono, color: GH.ink30, fontSize: 9 }}>
                                        {safeDate(p.publishedAt || p.createdAt)}
                                        {type === 'article' && p.authorName ? ` · ${p.authorName}` : ''}
                                    </div>
                                    <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>{p.title}</div>
                                    {p.excerpt && (
                                        <div style={{ fontSize: 14, color: GH.ink60, lineHeight: 1.5 }}>{p.excerpt}</div>
                                    )}
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
