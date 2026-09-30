import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { COLOR } from '../../design/tokens';
import { formatDayMonth } from '../../utils/format';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { postsApi, type Post, type PostType } from '../../api/posts';
import { PublicHeader } from '../../components/public/PublicHeader';
import { Button } from '../../components/ui/Button';
import { usePostsAvailability } from './usePostsAvailability';

/**
 * PostListPage — публичная лента новостей или статей (один компонент,
 * параметризован type). Шаблон GH (masthead + сетка карточек), как
 * SpecialistsPage. Owner 2026-06-13.
 */
const ghMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' };

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
    return formatDayMonth(iso, { withYear: true, fallback: '' });
}

export function PostListPage({ type }: { type: PostType }) {
    const copy = COPY[type];
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = () => {
        setLoading(true);
        setError(null);
        postsApi.list(type)
            .then(setPosts)
            .catch(() => setError('Не удалось загрузить'))
            .finally(() => setLoading(false));
    };

    const navigate = useNavigate();
    // Соседний раздел в строке под шапкой — только если там есть публикации
    // (G1-20). Текущий раздел виден всегда: сюда могли прийти по ссылке.
    const available = usePostsAvailability();
    const subLink: React.CSSProperties = {
        ...ghMono, textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 8px',
    };

    useEffect(() => {
        document.title = `${copy.title} · Unbox`;
        load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [type, copy.title]);

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, fontFamily: GH_SANS, color: GH.ink, overflowX: 'hidden' }}>
            {/* G1-20 / G1-21: общая шапка сайта (на телефоне «Меню»), разделы —
                второй строкой, ссылки по 44 px. Метку «НОВОСТИ» у логотипа убрали:
                на телефоне слово повторялось трижды. */}
            <PublicHeader
                subnav={
                    <nav aria-label="Публикации" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {(type === 'news' || available.news) && (
                            <Link to="/news" aria-current={type === 'news' ? 'page' : undefined} style={{ ...subLink, color: type === 'news' ? GH.ink : GH.ink60 }}>Новости</Link>
                        )}
                        {(type === 'article' || available.article) && (
                            <Link to="/articles" aria-current={type === 'article' ? 'page' : undefined} style={{ ...subLink, color: type === 'article' ? GH.ink : GH.ink60 }}>Статьи</Link>
                        )}
                    </nav>
                }
            />

            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px clamp(16px, 4vw, 24px) 80px' }}>
                {/* Header */}
                <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                    <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                        {copy.title}
                    </h1>
                    <p style={{ fontSize: 16, color: GH.ink60, maxWidth: 560, margin: 0 }}>{copy.sub}</p>
                </div>

                {loading ? (
                    <div role="status" aria-busy="true" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 24 }}>
                        <span className="sr-only">Загружаем…</span>
                        {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={320} radius={0} />)}
                    </div>
                ) : error ? (
                    <ErrorBar message={error} onRetry={load} />
                ) : posts.length === 0 ? (
                    // G1-20: пустое состояние — читаемым цветом и с тем, куда пойти дальше.
                    <div style={{ textAlign: 'center', padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <p style={{ margin: 0, color: GH.ink60, fontSize: 16, lineHeight: 1.5 }}>{copy.empty}</p>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                            <a className="ui-btn ui-btn--secondary" href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                                Анонсы — в нашем Telegram →
                            </a>
                            <Button variant="quiet" onClick={() => navigate('/specialists')}>Смотреть специалистов</Button>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', gap: 24 }}>
                        {posts.map(p => (
                            <Link
                                key={p.id}
                                to={`${copy.base}/${p.slug}`}
                                style={{ textDecoration: 'none', color: GH.ink, display: 'flex', flexDirection: 'column', border: `1px solid ${GH.ink10}`, background: COLOR.card, borderRadius: 0, overflow: 'hidden' }}
                            >
                                {p.coverImageUrl ? (
                                    <div style={{ aspectRatio: '16/10', overflow: 'hidden', background: GH.cellDead }}>
                                        <img src={p.coverImageUrl} alt={p.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                    </div>
                                ) : (
                                    <div style={{ aspectRatio: '16/10', background: GH.cellDead, display: 'grid', placeItems: 'center', color: GH.ink60, ...ghMono }}>
                                        {copy.label}
                                    </div>
                                )}
                                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                                    <div style={{ ...ghMono, color: GH.ink60, fontSize: 12 }}>
                                        {safeDate(p.publishedAt || p.createdAt)}
                                        {type === 'article' && p.authorName ? ` · ${p.authorName}` : ''}
                                    </div>
                                    <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25 }}>{p.title}</div>
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
