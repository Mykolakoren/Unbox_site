import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { cashboxApi } from '../../../api/cashbox';
import type { User } from '../../../store/types';

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
    // Пополнение баланса с телефона (02.09, кейс Валентины/Малюкова): раньше
    // мобильной админке нечем было пополнить баланс КОНКРЕТНОМУ клиенту, и
    // деньги вносились в кассу без привязки — клиент оставался в минусе.
    // Тот же атомарный вызов, что и на десктопе: приход в кассу + зачисление
    // на баланс одной операцией (credit_user_balance).
    const [topupUser, setTopupUser] = useState<User | null>(null);

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
                            className="tap-target"
                            onClick={() => setFilter(f.id)}
                            style={{
                                flexShrink: 0,
                                padding: '6px 12px',
                                background: filter === f.id ? '#0E0E0E' : 'rgba(0,0,0,0.04)',
                                color: filter === f.id ? '#fff' : '#0E0E0E',
                                border: 'none',
                                borderRadius: 999,
                                fontSize: 12,
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
                            to={`/m/admin/users/${encodeURIComponent(u.email)}`}
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
                            <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setTopupUser(u); }}
                                aria-label={`Пополнить баланс: ${u.name || u.email}`}
                                style={{
                                    flexShrink: 0,
                                    width: 40, height: 40,
                                    borderRadius: 12,
                                    border: '1px solid rgba(0,0,0,0.10)',
                                    background: '#F4F4F2',
                                    color: '#0E0E0E',
                                    fontSize: 15, fontWeight: 800,
                                    display: 'grid', placeItems: 'center',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }}
                            >
                                ＋₾
                            </button>
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
                    Кнопка «＋₾» пополняет баланс клиента прямо с телефона (касса + зачисление одной операцией). Тап по юзеру откроет десктопную карточку — тонкие настройки пока там.
                </div>
            </div>

            {topupUser && (
                <TopupSheet
                    user={topupUser}
                    onClose={() => setTopupUser(null)}
                    onDone={async () => { setTopupUser(null); await fetchUsers(); }}
                />
            )}
        </div>
    );
}

// ── Шит пополнения баланса ──────────────────────────────────────────────────
function TopupSheet({ user, onClose, onDone }: {
    user: User;
    onClose: () => void;
    onDone: () => Promise<void>;
}) {
    const balance = user.balance ?? 0;
    const [amount, setAmount] = useState<string>(balance < 0 ? String(-balance) : '20');
    const [method, setMethod] = useState<'cash' | 'card_tbc' | 'card_bog'>('cash');
    const [branch, setBranch] = useState<string>('Unbox Uni');
    const [saving, setSaving] = useState(false);
    const value = Number(amount) || 0;

    const chip = (active: boolean): React.CSSProperties => ({
        padding: '9px 13px',
        borderRadius: 999,
        border: active ? '1.5px solid #0E0E0E' : '1px solid rgba(0,0,0,0.12)',
        background: active ? '#0E0E0E' : '#fff',
        color: active ? '#fff' : '#0E0E0E',
        fontSize: 13, fontWeight: 650,
        cursor: 'pointer', fontFamily: 'inherit',
        minHeight: 40,
    });

    const submit = async () => {
        if (value <= 0) { toast.error('Введите сумму'); return; }
        setSaving(true);
        try {
            await cashboxApi.createTransaction({
                type: 'income',
                amount: value,
                payment_method: method,
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${user.name || user.email}`,
                branch,
                client_id: user.id || user.email,
                credit_user_balance: true,
            } as any);
            toast.success(`Баланс пополнен на ${value} ₾ — станет ${(balance + value).toFixed(0)} ₾`);
            await onDone();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось пополнить (нужен доступ к кассе)');
            setSaving(false);
        }
    };

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480,
                    background: '#fff',
                    borderRadius: '18px 18px 0 0',
                    padding: '18px 16px',
                    paddingBottom: 'calc(18px + env(safe-area-inset-bottom, 0px))',
                    maxHeight: '85vh', overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: 14,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>Пополнить баланс</div>
                        <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
                            {user.name || user.email} · сейчас{' '}
                            <b style={{ color: balance < 0 ? '#C8253A' : '#0E0E0E' }}>{balance.toFixed(0)} ₾</b>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Закрыть" style={{ background: '#F4F4F2', border: 'none', borderRadius: 10, width: 34, height: 34, display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                        <X size={16} />
                    </button>
                </div>

                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Сумма, ₾</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {[20, 40, 60, 100].map(v => (
                            <button key={v} onClick={() => setAmount(String(v))} style={chip(Number(amount) === v)}>{v}</button>
                        ))}
                        {balance < 0 && (
                            <button onClick={() => setAmount(String(-balance))} style={chip(Number(amount) === -balance)}>
                                Закрыть долг ({-balance} ₾)
                            </button>
                        )}
                    </div>
                    <input
                        type="number" inputMode="decimal" value={amount}
                        onChange={e => setAmount(e.target.value)}
                        style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 16, borderRadius: 12, border: '1px solid rgba(0,0,0,0.15)', outline: 'none', fontFamily: 'inherit' }}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Способ оплаты</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button onClick={() => setMethod('cash')} style={chip(method === 'cash')}>Наличные</button>
                        <button onClick={() => setMethod('card_tbc')} style={chip(method === 'card_tbc')}>Карта TBC</button>
                        <button onClick={() => setMethod('card_bog')} style={chip(method === 'card_bog')}>Карта BOG</button>
                    </div>
                </div>

                <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Филиал</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => setBranch('Unbox Uni')} style={chip(branch === 'Unbox Uni')}>Unbox Uni</button>
                        <button onClick={() => setBranch('Unbox One')} style={chip(branch === 'Unbox One')}>Unbox One</button>
                    </div>
                </div>

                <button
                    onClick={submit}
                    disabled={saving || value <= 0}
                    style={{
                        width: '100%', padding: '14px',
                        borderRadius: 14, border: 'none',
                        background: '#0E0E0E', color: '#fff',
                        fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                        cursor: 'pointer', opacity: saving || value <= 0 ? 0.55 : 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        minHeight: 50,
                    }}
                >
                    {saving && <Loader2 size={16} className="animate-spin" />}
                    Пополнить на {value > 0 ? value : '—'} ₾
                </button>
            </div>
        </div>
    );
}
