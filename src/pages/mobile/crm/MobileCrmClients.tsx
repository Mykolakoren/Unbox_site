import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Phone, Search, MessageCircle } from 'lucide-react';
import { useCrmStore } from '../../../store/crmStore';

/**
 * Mobile CRM — clients list with search.
 *
 * Plain alphabetical list with a sticky search box on top. Tap → client
 * card (separate route). Active filter checkbox: hide archived/inactive.
 */
export function MobileCrmClients() {
    const { clients, fetchClients } = useCrmStore();
    const [query, setQuery] = useState('');
    const [activeOnly, setActiveOnly] = useState(true);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (clients.length === 0) {
            setLoading(true);
            fetchClients(false).finally(() => setLoading(false));
        }
    }, [clients.length, fetchClients]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        let list = clients;
        if (activeOnly) list = list.filter(c => c.isActive);
        if (q) {
            list = list.filter(c =>
                c.name?.toLowerCase().includes(q)
                || c.phone?.toLowerCase().includes(q)
                || c.email?.toLowerCase().includes(q)
                || c.aliasCode?.toLowerCase().includes(q)
            );
        }
        return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [clients, query, activeOnly]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Клиенты
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Всего: {clients.length} · показано: {filtered.length}
                </p>
            </div>

            {/* Search */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#F4F4F2',
                    borderRadius: 12,
                    padding: '10px 12px',
                    gap: 8,
                }}>
                    <Search size={16} color="#999" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Имя, телефон, email…"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            color: '#0E0E0E',
                            minWidth: 0,
                        }}
                    />
                    {query && (
                        <button
                            onClick={() => setQuery('')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 13 }}
                        >
                            Очистить
                        </button>
                    )}
                </div>
                <label style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12, color: '#666', marginTop: 8, cursor: 'pointer',
                }}>
                    <input
                        type="checkbox"
                        checked={activeOnly}
                        onChange={e => setActiveOnly(e.target.checked)}
                    />
                    Только активные
                </label>
            </div>

            {loading && <div style={{ padding: '0 16px', color: '#666', fontSize: 14 }}>Загружаю…</div>}

            {!loading && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 20,
                        textAlign: 'center',
                        color: '#666',
                        fontSize: 14,
                    }}>
                        {query ? 'Никого не нашлось' : 'У вас пока нет клиентов в CRM. Добавьте через десктоп.'}
                    </div>
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(c => (
                    <Link
                        key={c.id}
                        to={`/m/crm/clients/${c.id}`}
                        style={{
                            background: '#fff',
                            border: '1px solid rgba(0,0,0,0.08)',
                            borderRadius: 12,
                            padding: '12px 14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            color: '#0E0E0E',
                            textDecoration: 'none',
                        }}
                    >
                        <div style={{
                            width: 36, height: 36,
                            borderRadius: 999,
                            background: '#F4F4F2',
                            display: 'grid', placeItems: 'center',
                            fontSize: 13, fontWeight: 700,
                            color: '#666',
                            flexShrink: 0,
                        }}>
                            {(c.name || '?').slice(0, 1).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
                                {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                            </div>
                            <div style={{ fontSize: 12, color: '#666', marginTop: 1 }}>
                                {c.phone || c.email || (c.tags?.length ? c.tags.slice(0, 2).join(', ') : '—')}
                            </div>
                        </div>
                        {c.phone && (
                            <a
                                href={`tel:${c.phone.replace(/\s/g, '')}`}
                                onClick={e => e.stopPropagation()}
                                aria-label="Позвонить"
                                style={iconBtn}
                            >
                                <Phone size={16} />
                            </a>
                        )}
                        {c.telegram && (
                            <a
                                href={`https://t.me/${c.telegram.replace('@', '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={e => e.stopPropagation()}
                                aria-label="Telegram"
                                style={iconBtn}
                            >
                                <MessageCircle size={16} />
                            </a>
                        )}
                    </Link>
                ))}
            </div>
        </div>
    );
}

const iconBtn: React.CSSProperties = {
    width: 32, height: 32,
    borderRadius: 8,
    background: '#F4F4F2',
    display: 'grid', placeItems: 'center',
    color: '#0E0E0E',
    flexShrink: 0,
    textDecoration: 'none',
};
