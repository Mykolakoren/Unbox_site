import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, Sprout, Flame, Star, Handshake, Moon, AlertTriangle } from 'lucide-react';
import { isAfter, subDays } from 'date-fns';
import { useUserStore } from '../../../store/userStore';
import { ADMIN_ROLES } from '../../../utils/permissions';
import type { User } from '../../../store/types';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatGel } from '../../../utils/format';

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
        const q = query.trim().toLowerCase();
        return users
            .filter(u => stageByEmail.get(u.email) === stage)
            .filter(u => {
                if (!q) return true;
                return (u.name || '').toLowerCase().includes(q)
                    || (u.email || '').toLowerCase().includes(q)
                    || (u.phone || '').toLowerCase().includes(q);
            })
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [users, stageByEmail, stage, query]);

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    CRM-воронка
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    Здесь только просмотр. Переносить клиентов между стадиями удобнее на компьютере.
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: 'var(--color-sunken)', borderRadius: 12, padding: '10px 12px', gap: 8 }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск клиента"
                        placeholder="Имя, email, телефон…"
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', minWidth: 0 }}
                    />
                </div>
            </div>

            {/* Stage chips */}
            <div style={{ padding: '0 16px' }}>
                <div role="group" aria-label="Стадия" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
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

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {!usersTried && users.length === 0 && (
                    <SkeletonList count={4} label="Загружаем клиентов" cardHeight={56} />
                )}
                {(usersTried || users.length > 0) && stageClients.length === 0 && (
                    <EmptyState compact title="В этой стадии никого нет" hint={query ? 'Попробуйте другой запрос.' : undefined} />
                )}
                {stageClients.map(u => (
                    <ClientRow key={u.id} user={u} onClick={() => navigate(`/m/admin/users/${encodeURIComponent(u.email)}`)} />
                ))}
            </div>
        </div>
    );
}

function ClientRow({ user, onClick }: { user: User; onClick: () => void }) {
    const balance = user.balance ?? 0;
    return (
        <button
            onClick={onClick}
            style={{
                background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--color-ink)',
                minHeight: 56,
            }}
        >
            <div style={{
                width: 36, height: 36, borderRadius: 999, background: 'var(--color-sunken)',
                display: 'grid', placeItems: 'center',
                fontSize: 13, fontWeight: 600, color: 'var(--color-ink-60)', flexShrink: 0,
            }}>
                {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.name || user.email}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.email}
                </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: balance < 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)' }}>
                    {formatGel(balance)}
                </div>
            </div>
            <ChevronRight size={16} color={COLOR.ink40} aria-hidden="true" />
        </button>
    );
}
