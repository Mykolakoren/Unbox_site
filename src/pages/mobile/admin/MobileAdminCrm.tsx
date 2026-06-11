import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight } from 'lucide-react';
import { isAfter, subDays } from 'date-fns';
import { useUserStore } from '../../../store/userStore';
import { ADMIN_ROLES } from '../../../utils/permissions';
import type { User } from '../../../store/types';

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

const STAGES: { id: Stage; label: string; emoji: string }[] = [
    { id: 'new', label: 'Новые', emoji: '🌱' },
    { id: 'active', label: 'Активные', emoji: '🔥' },
    { id: 'vip', label: 'VIP', emoji: '⭐' },
    { id: 'partner', label: 'Партнёры', emoji: '🤝' },
    { id: 'sleeping', label: 'Спящие', emoji: '💤' },
    { id: 'bad_client', label: 'Сложные', emoji: '⚠️' },
];

export function MobileAdminCrm() {
    const navigate = useNavigate();
    const { users, bookings, fetchUsers } = useUserStore();
    const [stage, setStage] = useState<Stage>('active');
    const [query, setQuery] = useState('');

    useEffect(() => {
        if (!users || users.length === 0) fetchUsers();
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
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    CRM-воронка
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Drag-and-drop между стадиями — на десктопе. Тут только просмотр.
                </p>
            </div>

            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: '#F4F4F2', borderRadius: 12, padding: '10px 12px', gap: 8 }}>
                    <Search size={16} color="#999" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder="Имя, email, телефон…"
                        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', minWidth: 0 }}
                    />
                </div>
            </div>

            {/* Stage chips */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {STAGES.map(s => {
                        const active = stage === s.id;
                        return (
                            <button
                                key={s.id}
                                onClick={() => setStage(s.id)}
                                style={{
                                    flexShrink: 0, padding: '7px 12px',
                                    background: active ? '#0E0E0E' : '#F4F4F2',
                                    color: active ? '#fff' : '#0E0E0E',
                                    border: 'none', borderRadius: 999,
                                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    whiteSpace: 'nowrap', fontFamily: 'inherit',
                                    display: 'inline-flex', alignItems: 'center', gap: 5,
                                }}
                            >
                                <span>{s.emoji}</span>
                                {s.label}
                                <span style={{ opacity: 0.7 }}>· {counts[s.id]}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {stageClients.length === 0 && (
                    <div style={{ background: '#F4F4F2', borderRadius: 12, padding: 24, textAlign: 'center', color: '#666', fontSize: 13 }}>
                        В этой стадии никого нет.
                    </div>
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
                background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 12, padding: '12px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
                cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: '#0E0E0E',
            }}
        >
            <div style={{
                width: 36, height: 36, borderRadius: 999, background: '#F4F4F2',
                display: 'grid', placeItems: 'center',
                fontSize: 13, fontWeight: 700, color: '#666', flexShrink: 0,
            }}>
                {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.name || user.email}
                </div>
                <div style={{ fontSize: 11, color: '#666', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {user.email}
                </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: balance < 0 ? '#C8253A' : '#0E0E0E' }}>
                    {balance.toFixed(0)} ₾
                </div>
            </div>
            <ChevronRight size={14} color="#999" />
        </button>
    );
}
