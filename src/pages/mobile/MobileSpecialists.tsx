import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import { api } from '../../api/client';
import type { Specialist } from '../../components/Specialists/SpecialistCard';

/**
 * Mobile catalog of specialists.
 *
 * Native phone-first list, replaces the desktop SpecialistsPage which has
 * a grid layout meant for >=900px. Mobile uses vertical cards: photo,
 * name, tagline, price. Tap → /m/specialists/:id detail.
 */
export function MobileSpecialists() {
    const [items, setItems] = useState<Specialist[] | null>(null);
    const [query, setQuery] = useState('');
    const [format, setFormat] = useState<'all' | 'OFFLINE_ROOM' | 'ONLINE'>('all');

    useEffect(() => {
        api.get<Specialist[]>('/specialists')
            .then(r => setItems(r.data))
            .catch(() => setItems([]));
    }, []);

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
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Специалисты
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    {items === null ? 'Загружаю…' : `Всего: ${items.length}`}
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: '#F4F4F2', borderRadius: 12,
                    padding: '10px 12px', gap: 8,
                }}>
                    <Search size={16} color="#999" />
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
                <div style={{ display: 'flex', gap: 6 }}>
                    {([
                        { id: 'all' as const, label: 'Все' },
                        { id: 'OFFLINE_ROOM' as const, label: 'Кабинет' },
                        { id: 'ONLINE' as const, label: 'Онлайн' },
                    ]).map(f => {
                        const active = format === f.id;
                        return (
                            <button
                                key={f.id}
                                onClick={() => setFormat(f.id)}
                                style={{
                                    flexShrink: 0,
                                    padding: '7px 13px',
                                    background: active ? '#0E0E0E' : '#F4F4F2',
                                    color: active ? '#fff' : '#0E0E0E',
                                    border: 'none', borderRadius: 999,
                                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {items === null ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#666', fontSize: 13 }}>
                    Загружаю…
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: '#F4F4F2', borderRadius: 12,
                        padding: 24, textAlign: 'center', color: '#666', fontSize: 13,
                    }}>
                        Никого не нашлось.
                    </div>
                </div>
            ) : (
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {filtered.map(s => (
                        <Link
                            key={s.id}
                            to={`/m/specialists/${s.id}`}
                            style={{
                                display: 'flex', gap: 12, alignItems: 'center',
                                background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
                                borderRadius: 14, padding: '12px 14px',
                                color: '#0E0E0E', textDecoration: 'none',
                                fontFamily: 'inherit',
                            }}
                        >
                            <div style={{
                                width: 56, height: 56, borderRadius: '50%',
                                background: '#F4F4F2',
                                backgroundImage: s.photoUrl ? `url(${s.photoUrl})` : undefined,
                                backgroundSize: 'cover', backgroundPosition: 'center',
                                flexShrink: 0,
                                display: 'grid', placeItems: 'center',
                                fontSize: 18, fontWeight: 700, color: '#999',
                            }}>
                                {!s.photoUrl && (s.firstName?.[0] || '?').toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
                                    {s.firstName} {s.lastName}
                                </div>
                                <div style={{ fontSize: 12, color: '#666', marginTop: 3, lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                    {s.tagline}
                                </div>
                                {s.basePriceGel > 0 && (
                                    <div style={{ fontSize: 11, color: '#1B6E36', fontWeight: 700, marginTop: 4 }}>
                                        от {s.basePriceGel} ₾
                                    </div>
                                )}
                            </div>
                            <ChevronRight size={16} color="#bbb" style={{ flexShrink: 0 }} />
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
