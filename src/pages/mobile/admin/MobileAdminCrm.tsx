import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Sprout, Flame, Star, Handshake, Moon, AlertTriangle } from 'lucide-react';
import { isAfter, subDays } from 'date-fns';
import { useUserStore } from '../../../store/userStore';
import { ADMIN_ROLES } from '../../../utils/permissions';
import type { User } from '../../../store/types';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ListGroup, ListRow, ListAvatar } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { matchesPerson } from './searchMatch';

/**
 * Mobile admin — CRM pipeline.
 *
 * Replaces the desktop 6-column Kanban (broken on phone) with a stage
 * selector + list of clients in that stage. Tap a client → existing
 * /m/admin/users/:email card. Stage assignment in mobile is read-only
 * for now — admins move clients between stages via the desktop Kanban
 * (it's a drag-heavy action that doesn't translate well to touch).
 */
type Stage = 'new' | 'active' | 'vip' | 'partner' | 'sleeping' | 'bad_client';

// Wave 1: эмодзи стадий → значки Lucide (PRODUCT.md: «эмодзи как иконки — нет»).
const STAGES: { id: Stage; label: string; icon: React.ElementType }[] = [
    { id: 'new', label: 'Новые', icon: Sprout },
    { id: 'active', label: 'Активные', icon: Flame },
    { id: 'vip', label: 'VIP', icon: Star },
    { id: 'partner', label: 'Партнёры', icon: Handshake },
    { id: 'sleeping', label: 'Спящие', icon: Moon },
    { id: 'bad_client', label: 'Сложные', icon: AlertTriangle },
];

export function MobileAdminCrm() {
    const navigate = useNavigate();
    const { users, bookings, fetchUsers } = useUserStore();
    const [stage, setStage] = useState<Stage>('active');
    const [query, setQuery] = useState('');
    // Пока клиенты не пришли, не пишем «никого нет» (wave 1).
    const [usersTried, setUsersTried] = useState(users.length > 0);

    useEffect(() => {
        if (!users || users.length === 0) fetchUsers().finally(() => setUsersTried(true));
    }, []);

    /** Same stage derivation as the desktop AdminCrm.analytics block — keeps
     *  mobile counts in sync with the Kanban. Manual override > activity. */
    const stageByEmail = useMemo(() => {
        const now = new Date();
        const thirtyDaysAgo = subDays(now, 30);
        const fortyFiveDaysAgo = subDays(now, 45);
        const m = new Map<string, Stage>();
        users.forEach(u => {
            if (u.role && ADMIN_ROLES.includes(u.role)) return;
            if (u.manualStatus) {
                m.set(u.email, u.manualStatus as Stage);
                return;
            }
            const ub = bookings.filter(b => b.userId === u.email);
            const completed = ub.filter(b => b.status === 'completed');
            const lastVisit = completed.length > 0
                ? new Date(completed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date)
                : null;
            if (ub.length === 0) {
                const reg = u.registrationDate ? new Date(u.registrationDate) : now;
                m.set(u.email, isAfter(reg, thirtyDaysAgo) ? 'new' : 'sleeping');
            } else if (lastVisit && isAfter(lastVisit, fortyFiveDaysAgo)) {
                m.set(u.email, 'active');
            } else {
                m.set(u.email, 'sleeping');
            }
        });
        return m;
    }, [users, bookings]);

    const counts = useMemo(() => {
        const c: Record<Stage, number> = { new: 0, active: 0, vip: 0, partner: 0, sleeping: 0, bad_client: 0 };
        stageByEmail.forEach(s => { c[s]++; });
        return c;
    }, [stageByEmail]);

    const stageClients = useMemo(() => {
        // Телефон — по цифрам, имя — словами в любом порядке (ревью 09.11, №6).
        return users
            .filter(u => stageByEmail.get(u.email) === stage)
            .filter(u => matchesPerson(query, { name: u.name, email: u.email, phone: u.phone }))
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [users, stageByEmail, stage, query]);

    return (
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 09.11 фаза 3: экран из «Ещё» / «Админка ▾» — внутренний: шапка со «←». */}
            <MobilePageHeader
                title="CRM-воронка"
                subtitle="Только просмотр — стадии меняют на компьютере"
                fallbackTo="/m/admin/dashboard"
            />

            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-sunken)', borderRadius: 8, padding: '0 12px', minHeight: 44, gap: 8, marginTop: 4 }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск клиента"
                        placeholder="Имя, email, телефон…"
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 16, fontFamily: 'inherit', minWidth: 0, color: 'var(--color-ink)' }}
                    />
                </div>
            </div>

            {/* Stage chips */}
            <div style={{ padding: '0 16px' }}>
                <div role="group" aria-label="Стадия" className="ui-chip-row ui-chip-row--scroll" style={{ paddingBottom: 4 }}>
                    {STAGES.map(s => {
                        const Icon = s.icon;
                        return (
                            <Chip
                                key={s.id}
                                selected={stage === s.id}
                                onClick={() => setStage(s.id)}
                                icon={<Icon size={16} aria-hidden="true" />}
                                style={{ flexShrink: 0 }}
                            >
                                {s.label} · {counts[s.id]}
                            </Chip>
                        );
                    })}
                </div>
            </div>

            <div style={{ padding: '0 16px' }}>
                {!usersTried && users.length === 0 && (
                    <SkeletonList count={4} label="Загружаем клиентов" cardHeight={56} />
                )}
                {(usersTried || users.length > 0) && stageClients.length === 0 && (
                    <EmptyState compact title="В этой стадии никого нет" hint={query ? 'Попробуйте другой запрос.' : undefined} />
                )}
                {stageClients.length > 0 && (
                    <ListGroup aria-label="Клиенты стадии">
                        {stageClients.map(u => (
                            <ClientRow key={u.id} user={u} onClick={() => navigate(`/m/admin/users/${encodeURIComponent(u.email)}`)} />
                        ))}
                    </ListGroup>
                )}
            </div>
        </div>
    );
}

/** Строка клиента — общий ListRow; баланс — Money tone="balance" (09.11 фаза 3). */
function ClientRow({ user, onClick }: { user: User; onClick: () => void }) {
    return (
        <ListRow
            onClick={onClick}
            lead={<ListAvatar name={user.name || user.email || '?'} />}
            title={user.name || user.email}
            subtitle={<span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>}
            trail={<Money value={user.balance ?? 0} tone="balance" />}
        />
    );
}
