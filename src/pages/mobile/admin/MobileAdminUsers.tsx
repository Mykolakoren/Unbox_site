import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { cashboxApi } from '../../../api/cashbox';
import type { User } from '../../../store/types';
import { Z_SHEET, SHEET_FOOTER, SHEET_MAX_HEIGHT } from './sheetLayers';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatGel } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';

/**
 * Mobile admin — users search & quick view.
 *
 * Lists every user, with role badges and a search box. Tap a row → opens
 * the desktop user-details page (the full one) in the same tab — for the
 * mobile MVP we keep editing in desktop, this view is just "find them
 * fast on the phone".
 *
 * Wave 1: вкладка «Юзеры» → «Клиенты» (как на десктопе); роли по-русски
 * вместо кодов (senior_admin); кнопка «＋₾» больше не вложена в ссылку
 * (две соседние цели 44 px); общие Chip/Button/Field; суммы — formatGel.
 */
type Filter = 'all' | 'debtors' | 'specialists' | 'admins' | 'clients';

/** Роль по-русски. Код роли в интерфейсе («senior_admin») людям ничего не говорит. */
const ROLE_LABEL: Record<string, string> = {
    user: 'Клиент',
    specialist: 'Специалист',
    admin: 'Админ',
    senior_admin: 'Старший админ',
    owner: 'Владелец',
};

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
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Клиенты
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    {loading && (users?.length ?? 0) === 0 ? 'Загружаем…' : `Всего: ${users?.length ?? 0}`}
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--color-sunken)',
                    borderRadius: 12,
                    padding: '0 12px',
                    minHeight: 44,
                    gap: 8,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск по имени, email или телефону"
                        placeholder="Имя, email, телефон…"
                        style={{
                            flex: 1,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontSize: 16,
                            fontFamily: 'inherit',
                            minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>
            </div>

            {/* Filter chips — replace the flat-list scroll-fest with quick
                cuts admins actually use: должники, специалисты, админы. */}
            <div style={{ padding: '0 16px' }}>
                <div role="group" aria-label="Кого показать" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {([
                        { id: 'all', label: 'Все', count: counts.all },
                        { id: 'debtors', label: 'Должники', count: counts.debtors },
                        { id: 'specialists', label: 'Специалисты', count: counts.specialists },
                        { id: 'admins', label: 'Админы', count: counts.admins },
                        { id: 'clients', label: 'Клиенты', count: counts.clients },
                    ] as { id: Filter; label: string; count: number }[]).map(f => (
                        <Chip
                            key={f.id}
                            selected={filter === f.id}
                            onClick={() => setFilter(f.id)}
                            style={{ flexShrink: 0 }}
                        >
                            {f.label} · {f.count}
                        </Chip>
                    ))}
                </div>
            </div>

            {loading && (users?.length ?? 0) === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <SkeletonList count={5} label="Загружаем клиентов" cardHeight={60} />
                </div>
            )}

            {!loading && (users?.length ?? 0) > 0 && filtered.length === 0 && (
                <div style={{ padding: '0 16px' }}>
                    <EmptyState compact title="Никого не нашлось" hint="Попробуйте другое имя, email или телефон." />
                </div>
            )}

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {filtered.map(u => {
                    const isAdmin = u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || u.isAdmin;
                    const balance = u.balance ?? 0;
                    const debt = balance < 0 ? -balance : 0;
                    return (
                        // Строка — ссылка на карточку и рядом отдельная кнопка «＋₾»:
                        // раньше кнопка была внутри ссылки (вложенные цели нажатия).
                        <div
                            key={u.id}
                            style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 12,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                paddingRight: 6,
                            }}
                        >
                            <Link
                                to={`/m/admin/users/${encodeURIComponent(u.email)}`}
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    padding: '12px 8px 12px 14px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    color: 'var(--color-ink)',
                                    textDecoration: 'none',
                                }}
                            >
                                <div style={{
                                    width: 36, height: 36,
                                    borderRadius: 999,
                                    background: 'var(--color-sunken)',
                                    display: 'grid', placeItems: 'center',
                                    fontSize: 14, fontWeight: 600,
                                    color: 'var(--color-ink-60)',
                                    flexShrink: 0,
                                }}>
                                    {(u.name || u.email || '?').slice(0, 1).toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 6 }}>
                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name || u.email}</span>
                                        {isAdmin && <ShieldCheck size={12} color={COLOR.ink60} aria-hidden="true" style={{ flexShrink: 0 }} />}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {u.email}
                                        {u.role && <span> · {ROLE_LABEL[u.role] ?? 'Другая роль'}</span>}
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                    <div className="num" style={{
                                        fontSize: 14,
                                        fontWeight: 600,
                                        color: debt > 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)',
                                    }}>
                                        {formatGel(balance)}
                                    </div>
                                    {u.subscription && (
                                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                                            {u.subscription.remainingHours} ч абон.
                                        </div>
                                    )}
                                </div>
                            </Link>
                            <button
                                onClick={() => setTopupUser(u)}
                                aria-label={`Пополнить баланс: ${u.name || u.email}`}
                                style={{
                                    flexShrink: 0,
                                    width: 44, height: 44,
                                    borderRadius: 8,
                                    border: '1px solid var(--color-ink-10)',
                                    background: 'var(--color-sunken)',
                                    color: 'var(--color-ink)',
                                    fontSize: 14, fontWeight: 600,
                                    display: 'grid', placeItems: 'center',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                }}
                            >
                                ＋₾
                            </button>
                        </div>
                    );
                })}
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: 'var(--color-sunken)',
                    color: 'var(--color-ink-80)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12,
                    lineHeight: 1.5,
                }}>
                    Кнопка «＋₾» пополняет баланс клиента прямо с телефона — приход в кассу и зачисление одной операцией.
                    Тонкие настройки клиента удобнее менять на компьютере.
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
    // Поле текстовое (цифровая клавиатура): «1 280,50», «20.5» — общий разбор.
    const parsed = parseMoneyInput(amount);
    const value = parsed ?? 0;
    const amountError = !isMoneyInputBlank(amount) && parsed === null ? MONEY_INPUT_ERROR : undefined;

    const submit = async () => {
        if (value <= 0) { toast.error('Введите сумму больше 0'); return; }
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
            toast.success(`Баланс пополнен на ${formatGel(value)} — теперь ${formatGel(balance + value)}`);
            await onDone();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось пополнить баланс (нужен доступ к кассе)');
            setSaving(false);
        }
    };

    return (
        <div
            // Z_SHEET: было 90 — ниже нижнего меню (100), и оно закрывало
            // кнопку «Пополнить»; промах уводил на вкладку «Финансы».
            role="dialog"
            aria-modal="true"
            aria-label="Пополнить баланс"
            style={{ position: 'fixed', inset: 0, zIndex: Z_SHEET, background: 'rgba(15,15,16,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={onClose}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480,
                    background: 'var(--color-card)',
                    borderRadius: '16px 16px 0 0',
                    boxShadow: 'var(--shadow-pop)',
                    // Низ с отступом под «домашнюю полоску» несёт SHEET_FOOTER.
                    padding: '12px 16px 0',
                    maxHeight: SHEET_MAX_HEIGHT, overflowY: 'auto',
                    overscrollBehavior: 'contain',
                    display: 'flex', flexDirection: 'column', gap: 16,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Пополнить баланс</h2>
                        <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 2 }}>
                            {user.name || user.email} · сейчас{' '}
                            <b style={{ color: balance < 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)' }}>{formatGel(balance)}</b>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Закрыть"
                        style={{ background: 'transparent', border: 'none', borderRadius: 8, width: 44, height: 44, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-ink-60)' }}
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div>
                    <div role="group" aria-label="Быстрая сумма" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {[20, 40, 60, 100].map(v => (
                            <Chip key={v} selected={value === v} onClick={() => setAmount(String(v))}>{formatGel(v)}</Chip>
                        ))}
                        {balance < 0 && (
                            <Chip selected={value === -balance} onClick={() => setAmount(String(-balance))}>
                                Закрыть долг ({formatGel(-balance)})
                            </Chip>
                        )}
                    </div>
                    <Field label="Сумма" error={amountError}>
                        <Input kind="money" suffix="₾" value={amount} onChange={e => setAmount(e.target.value)} />
                    </Field>
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Способ оплаты</div>
                    <Segmented<'cash' | 'card_tbc' | 'card_bog'>
                        aria-label="Способ оплаты"
                        options={[
                            { value: 'cash', label: 'Наличные' },
                            { value: 'card_tbc', label: 'Карта TBC' },
                            { value: 'card_bog', label: 'Карта BOG' },
                        ]}
                        value={method}
                        onChange={setMethod}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Филиал</div>
                    <Segmented
                        aria-label="Филиал"
                        options={[
                            { value: 'Unbox Uni', label: 'Unbox Uni' },
                            { value: 'Unbox One', label: 'Unbox One' },
                        ]}
                        value={branch}
                        onChange={setBranch}
                    />
                </div>

                <div style={SHEET_FOOTER}>
                    <Button
                        block
                        loading={saving}
                        disabled={value <= 0}
                        onClick={submit}
                    >
                        Пополнить на {value > 0 ? formatGel(value) : '—'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
