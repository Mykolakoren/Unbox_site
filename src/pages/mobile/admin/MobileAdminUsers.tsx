import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';

/**
 * Mobile admin — users search & quick view.
 *
 * Lists every user, with role badges and a search box. Tap a row → opens
 * the desktop user-details page (the full one) in the same tab — for the
 * mobile MVP we keep editing in desktop, this view is just "find them
 * fast on the phone".
 */
type Filter = 'all' | 'debtors' | 'specialists' | 'admins' | 'clients';

export function MobileAdminUsers() {
    const { users, fetchUsers } = useUserStore();
    const [query, setQuery] = useState('');
    const [filter, setFilter] = useState<Filter>('all');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!users || users.length === 0) {
            setLoading(true);
            fetchUsers().finally(() => setLoading(false));
        }
    }, [users, fetchUsers]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        const list = users || [];
        let pool = list;
        // Filter chips — owner+admins 2026-05-29: a flat list of 200+ users
        // is unworkable; admins routinely want "только должники" or "только
        // специалисты". These match the desktop /admin/users filter modes.
        if (filter === 'debtors') {
            pool = pool.filter(u => (u.balance ?? 0) < 0);
        } else if (filter === 'specialists') {
            pool = pool.filter(u => u.role === 'specialist');
        } else if (filter === 'admins') {
            pool = pool.filter(u =>
                u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || u.isAdmin,
            );
        } else if (filter === 'clients') {
            pool = pool.filter(u => !u.role || u.role === 'user');
        }
        const sorted = [...pool].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
        if (!q) return sorted;
        return sorted.filter(u =>
            u.name?.toLowerCase().includes(q)
            || u.email?.toLowerCase().includes(q)
            || u.phone?.toLowerCase().includes(q)
        );
    }, [users, query, filter]);

    const counts = useMemo(() => {
        const list = users || [];
        return {
            all: list.length,
            debtors: list.filter(u => (u.balance ?? 0) < 0).length,
            specialists: list.filter(u => u.role === 'specialist').length,
            admins: list.filter(u =>
                u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || u.isAdmin,
            ).length,
            clients: list.filter(u => !u.role || u.role === 'user').length,
        };
    }, [users]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Юзеры
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Всего: {users?.length ?? 0}
                </p>
            </div>

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
                        placeholder="Имя, email, телефон…"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 14,
                            fontFamily: 'inherit',
                            minWidth: 0,
                        }}
                    />
                </div>
            </div>

            {/* Filter chips — replace the flat-list scroll-fest with quick
                cuts admins actually use: должники, специалисты, админы. */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 4 }}>
                    {([
                        { id: 'all', label: 'Все', count: counts.all },
                        { id: 'debtors', label: 'Должники', count: counts.debtors },
                        { id: 'specialists', label: 'Специал.', count: counts.specialists },
                        { id: 'admins', label: 'Админы', count: counts.admins },
                        { id: 'clients', label: 'Клиенты', count: counts.clients },
                    ] as { id: Filter; label: string; count: number }[]).map(f => (
                        <button
                            key={f.id}
                            onClick={() => setFilter(f.id)}
                            style={{
                                flexShrink: 0,
                                padding: '6px 11px',
                                background: filter === f.id ? '#0E0E0E' : 'rgba(0,0,0,0.04)',
                                color: filter === f.id ? '#fff' : '#0E0E0E',
                                border: 'none',
                                borderRadius: 999,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                                fontFamily: 'inherit',
                            }}
                        >
                            {f.label} <span style={{ opacity: 0.7 }}>· {f.count}</span>
                        </button>
                    ))}
                </div>
            </div>

            {loading && <div style={{ padding: '0 16px', color: '#666', fontSize: 14 }}>Загружаю…</div>}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(u => {
                    const isAdmin = u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || u.isAdmin;
                    const balance = u.balance ?? 0;
                    const debt = balance < 0 ? -balance : 0;
                    return (
                        <Link
                            key={u.id}
                            to={`/admin/users/${encodeURIComponent(u.email)}`}
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
                                {(u.name || u.email || '?').slice(0, 1).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {u.name || u.email}
                                    {isAdmin && <ShieldCheck size={12} color="#666" />}
                                </div>
                                <div style={{ fontSize: 11, color: '#666', marginTop: 1 }}>
                                    {u.email}
                                    {u.role && <span> · {u.role}</span>}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                <div style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: debt > 0 ? '#C8253A' : '#0E0E0E',
                                }}>
                                    {balance.toFixed(0)} ₾
                                </div>
                                {u.subscription && (
                                    <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
                                        {u.subscription.remainingHours} ч аб.
                                    </div>
                                )}
                            </div>
                        </Link>
                    );
                })}
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: '#FEF3C7',
                    border: '1px solid #FCD34D',
                    color: '#8A5A00',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12,
                    lineHeight: 1.4,
                }}>
                    Тап по юзеру откроет десктопную карточку — мобильное редактирование пока ограничено, для тонких настроек используйте десктоп.
                </div>
            </div>
        </div>
    );
}
