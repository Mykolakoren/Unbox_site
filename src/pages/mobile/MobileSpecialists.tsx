import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import { api } from '../../api/client';
import type { Specialist } from '../../components/Specialists/SpecialistCard';
import { COLOR } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { Segmented } from '../../components/ui/Chip';

/**
 * Mobile catalog of specialists.
 *
 * Native phone-first list, replaces the desktop SpecialistsPage which has
 * a grid layout meant for >=900px. Mobile uses vertical cards: photo,
 * name, tagline, price. Tap → /m/specialists/:id detail.
 */
export function MobileSpecialists() {
    const [items, setItems] = useState<Specialist[] | null>(null);
    // Сбой загрузки ≠ «никого не нашлось» (раньше ошибка превращалась в пустой список).
    const [loadFailed, setLoadFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [format, setFormat] = useState<'all' | 'OFFLINE_ROOM' | 'ONLINE'>('all');

    const load = () => {
        setLoadFailed(false);
        api.get<Specialist[]>('/specialists')
            .then(r => setItems(r.data))
            .catch(() => setLoadFailed(true));
    };
    useEffect(load, []);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (items || []).filter(s => {
            if (format !== 'all' && !s.formats.includes(format)) return false;
            if (!q) return true;
            const full = `${s.firstName} ${s.lastName}`.toLowerCase();
            const spec = (s.specializations || []).join(' ').toLowerCase();
            return full.includes(q) || spec.includes(q) || (s.tagline || '').toLowerCase().includes(q);
        });
    }, [items, query, format]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Специалисты
                </h1>
                <p style={{ fontSize: 12, color: COLOR.ink60, marginTop: 4 }}>
                    {items === null ? (loadFailed ? '' : 'Загружаем…') : `Всего: ${items.length}`}
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: COLOR.sunken, borderRadius: 12,
                    padding: '10px 12px', gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Имя, специализация…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 16, fontFamily: 'inherit', minWidth: 0,
                        }}
                    />
                </div>
            </div>

            <div style={{ padding: '0 16px' }}>
                {/* Wave 1: общий Segmented (44 px, aria-pressed). */}
                <Segmented
                    aria-label="Формат приёма"
                    value={format}
                    onChange={setFormat}
                    options={[
                        { value: 'all', label: 'Все' },
                        { value: 'OFFLINE_ROOM', label: 'Кабинет' },
                        { value: 'ONLINE', label: 'Онлайн' },
                    ]}
                />
            </div>

            {items === null && loadFailed ? (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить специалистов" onRetry={load} />
                </div>
            ) : items === null ? (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={4} cardHeight={80} label="Загружаем специалистов" />
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: '0 16px' }}>
                    <EmptyState
                        compact
                        title="Никого не нашлось"
                        hint="Попробуйте другое имя или уберите фильтр."
                    />
                </div>
            ) : (
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filtered.map(s => (
                        <Link
                            key={s.id}
                            to={`/m/specialists/${s.id}`}
                            style={{
                                display: 'flex', gap: 12, alignItems: 'center',
                                background: COLOR.card, border: `1px solid ${COLOR.ink08}`,
                                borderRadius: 14, padding: '12px 14px',
                                color: COLOR.ink, textDecoration: 'none',
                                fontFamily: 'inherit',
                            }}
                        >
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: COLOR.sunken,
                                backgroundImage: s.photoUrl ? `url(${s.photoUrl})` : undefined,
                                backgroundSize: 'cover', backgroundPosition: 'center',
                                flexShrink: 0,
                                display: 'grid', placeItems: 'center',
                                fontSize: 18, fontWeight: 600, color: COLOR.ink60,
                            }}>
                                {!s.photoUrl && (s.firstName?.[0] || '?').toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>
                                    {s.firstName} {s.lastName}
                                </div>
                                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 3, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                    {s.tagline}
                                </div>
                                {s.basePriceGel > 0 && (
                                    <div style={{ fontSize: 12, color: COLOR.ink, fontWeight: 600, marginTop: 4 }}>
                                        от {formatGel(s.basePriceGel)}
                                    </div>
                                )}
                            </div>
                            <ChevronRight size={16} color={COLOR.ink60} style={{ flexShrink: 0 }} />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
