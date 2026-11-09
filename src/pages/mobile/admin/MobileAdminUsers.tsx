import { useEffect, useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import type { User } from '../../../store/types';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ListGroup, ListRow, ListAvatar } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { Button } from '../../../components/ui/Button';
import { TopupSheet } from './TopupSheet';
import { userCanAccessFinance } from '../../../utils/permissions';
import { matchesPerson } from './searchMatch';

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
    const { users, fetchUsers, currentUser } = useUserStore();
    // «＋₾» — только с правом на кассу (как вкладка «Касса», волна 4 доработка).
    const canCash = userCanAccessFinance(currentUser);
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
        const q = query.trim();
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
        // Ревью 09.11 (№6): «599123456» находит «+995 599 12 34 56», «Миронова Елена» —
        // «Елена Миронова» (телефон по цифрам, имя словами в любом порядке).
        return sorted.filter(u => matchesPerson(q, { name: u.name, email: u.email, phone: u.phone }));
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
        <div style={{ paddingTop: 8, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 09.11 фаза 3: общая крупная шапка раздела (28 / 14). */}
            <MobilePageHeader
                variant="large"
                title="Клиенты"
                subtitle={loading && (users?.length ?? 0) === 0 ? 'Загружаем…' : `В базе ${users?.length ?? 0}`}
                className="pb-0"
            />

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--color-sunken)',
                    borderRadius: 8,
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
                <div role="group" aria-label="Кого показать" className="ui-chip-row ui-chip-row--scroll" style={{ paddingBottom: 4 }}>
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

            {/* 09.11 фаза 3: одна группа строк ListRow. Баланс — Money tone="balance"
                (минус — красный, 0 — серый обычным весом, плюс — обычный); «＋₾» —
                тихая кнопка sm без рамки (действие вне ссылки, две цели по 44 px).
                Роль — только у сотрудников и специалистов: у клиента метка не нужна. */}
            {filtered.length > 0 && (
            <div style={{ padding: '0 16px' }}>
                <ListGroup aria-label="Клиенты">
                {filtered.map(u => {
                    const isAdmin = u.role === 'owner' || u.role === 'senior_admin' || u.role === 'admin' || u.isAdmin;
                    const balance = u.balance ?? 0;
                    const showRole = !!u.role && u.role !== 'user';
                    return (
                        <ListRow
                            key={u.id}
                            to={`/m/admin/users/${encodeURIComponent(u.email)}`}
                            lead={<ListAvatar name={u.name || u.email || '?'} />}
                            title={u.name || u.email}
                            // Роль (только у сотрудников и специалистов) — своей строкой; почта —
                            // одной строкой с многоточием: на 360 px режется первой, имя — нет.
                            subtitle={<>
                                {showRole && (
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        {isAdmin && <ShieldCheck size={12} color={COLOR.ink60} aria-hidden="true" />}
                                        {ROLE_LABEL[u.role!] ?? 'Другая роль'}
                                    </span>
                                )}
                                <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                            </>}
                            trail={<Money value={balance} tone="balance" />}
                            trailSub={u.subscription ? <span className="num-inline">{u.subscription.remainingHours} ч абон.</span> : undefined}
                            chevron={false}
                            action={canCash ? (
                                <Button
                                    variant="quiet"
                                    size="sm"
                                    onClick={() => setTopupUser(u)}
                                    aria-label={`Пополнить баланс: ${u.name || u.email}`}
                                >
                                    ＋₾
                                </Button>
                            ) : undefined}
                        />
                    );
                })}
                </ListGroup>
            </div>
            )}

            {canCash && <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: 'var(--color-sunken)',
                    color: 'var(--color-ink-80)',
                    borderRadius: 16,
                    padding: '12px 16px',
                    fontSize: 14,
                    lineHeight: 1.5,
                }}>
                    Кнопка «＋₾» пополняет баланс клиента прямо с телефона — приход в кассу и зачисление одной операцией.
                    Тонкие настройки клиента удобнее менять на компьютере.
                </div>
            </div>}

            {canCash && topupUser && (
                <TopupSheet
                    user={topupUser}
                    onClose={() => setTopupUser(null)}
                    onDone={async () => { setTopupUser(null); await fetchUsers(); }}
                />
            )}
        </div>
    );
}
