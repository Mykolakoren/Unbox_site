import { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, Bell } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { waitlistApi } from '../../../api/waitlist';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import type { WaitlistEntry } from '../../../store/types';

/**
 * Mobile admin — waitlist (Слежу за слотами).
 *
 * Shows every active waitlist entry across all clients, grouped by date.
 * Admin can remove an entry (e.g. when slot was manually offered and
 * declined). Replaces the desktop AdminWaitlist component wrapped in the
 * mobile shell — the desktop version's table was unreadable at 375px.
 */
export function MobileAdminWaitlist() {
    const { users, fetchUsers } = useUserStore();
    const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState<string | null>(null);

    const load = async () => {
        try {
            const data = await waitlistApi.getAllWaitlistAdmin();
            setEntries(data);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить ожидание');
            setEntries([]);
        }
    };

    useEffect(() => {
        load();
        if (!users || users.length === 0) fetchUsers();
    }, []);

    const userByEmail = useMemo(() => {
        const m = new Map<string, { name: string; phone?: string }>();
        users.forEach(u => m.set(u.email, { name: u.name || '', phone: u.phone }));
        return m;
    }, [users]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (entries || [])
            .filter(e => e.status === 'active')
            .filter(e => {
                if (!q) return true;
                const u = userByEmail.get(e.userId);
                const name = (u?.name || '').toLowerCase();
                const res = (RESOURCES.find(r => r.id === e.resourceId)?.name || '').toLowerCase();
                return name.includes(q)
                    || e.userId.toLowerCase().includes(q)
                    || res.includes(q);
            })
            .sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    }, [entries, query, userByEmail]);

    const grouped = useMemo(() => {
        const map = new Map<string, WaitlistEntry[]>();
        filtered.forEach(e => {
            const key = e.date.slice(0, 10);
            (map.get(key) ?? map.set(key, []).get(key))!.push(e);
        });
        return Array.from(map.entries());
    }, [filtered]);

    const remove = async (id: string) => {
        if (!window.confirm('Снять с листа ожидания?')) return;
        setBusy(id);
        try {
            await waitlistApi.removeFromWaitlist(id);
            setEntries(prev => (prev || []).filter(e => e.id !== id));
            toast.success('Снято');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось снять');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Ожидание слотов
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Активных записей: {filtered.length}
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
                        placeholder="Имя, email, кабинет…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 14, fontFamily: 'inherit', minWidth: 0,
                        }}
                    />
                </div>
            </div>

            {entries === null ? (
                <div style={{ padding: 24, textAlign: 'center', color: '#666', fontSize: 13 }}>
                    Загружаю…
                </div>
            ) : grouped.length === 0 ? (
                <div style={{ padding: '24px 16px' }}>
                    <div style={{
                        background: '#F4F4F2', borderRadius: 12,
                        padding: 24, textAlign: 'center', color: '#666', fontSize: 13,
                    }}>
                        {query ? 'Ничего не нашлось по фильтру.' : 'Никто не ждёт слот сейчас.'}
                    </div>
                </div>
            ) : (
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {grouped.map(([dateKey, items]) => {
                        const d = new Date(dateKey + 'T00:00:00');
                        return (
                            <div key={dateKey}>
                                <div style={{
                                    fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                                    textTransform: 'uppercase', color: '#999', marginBottom: 6,
                                }}>
                                    {fmtDate(d, 'EEEE, d MMMM', { locale: ru })} · {items.length}
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {items.map(e => {
                                        const r = RESOURCES.find(x => x.id === e.resourceId);
                                        const l = LOCATIONS.find(x => x.id === r?.locationId);
                                        const u = userByEmail.get(e.userId);
                                        return (
                                            <div
                                                key={e.id}
                                                style={{
                                                    background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
                                                    borderRadius: 12, padding: '12px 14px',
                                                    display: 'flex', gap: 10, alignItems: 'center',
                                                }}
                                            >
                                                <Bell size={14} color="#8A5A00" style={{ flexShrink: 0 }} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                                                        {u?.name || e.userId}
                                                        <span style={{ color: '#666', fontWeight: 500 }}>
                                                            {' '}· {e.startTime}–{e.endTime}
                                                        </span>
                                                    </div>
                                                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                                                        {r?.name || e.resourceId}
                                                        {l && <span style={{ color: '#999' }}> · {l.name}</span>}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => remove(e.id)}
                                                    disabled={busy === e.id}
                                                    style={{
                                                        background: '#FEF2F2', color: '#991B1B',
                                                        border: 'none', borderRadius: 8,
                                                        width: 32, height: 32,
                                                        display: 'grid', placeItems: 'center',
                                                        cursor: busy === e.id ? 'wait' : 'pointer',
                                                        opacity: busy === e.id ? 0.5 : 1,
                                                        flexShrink: 0,
                                                    }}
                                                    aria-label="Снять"
                                                >
                                                    {busy === e.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
