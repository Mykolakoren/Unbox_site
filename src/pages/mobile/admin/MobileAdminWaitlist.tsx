import { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../../store/userStore';
import { waitlistApi } from '../../../api/waitlist';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import type { WaitlistEntry } from '../../../store/types';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { COLOR } from '../../../design/tokens';
import { formatDateLabel } from '../../../utils/format';
import { toastApiError } from '../../../utils/errors';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { ListGroup, ListRow, ListTime } from '../../../components/ui/ListRow';

/**
 * Mobile admin — waitlist (Слежу за слотами).
 *
 * Shows every active waitlist entry across all clients, grouped by date.
 * Admin can remove an entry (e.g. when slot was manually offered and
 * declined). Replaces the desktop AdminWaitlist component wrapped in the
 * mobile shell — the desktop version's table was unreadable at 375px.
 *
 * Wave 1: окно подтверждения вместо confirm(), скелетон/ошибка/пусто —
 * три разных состояния, кнопка «убрать» 44 px, токены вместо hex.
 */
export function MobileAdminWaitlist() {
    const { users, fetchUsers } = useUserStore();
    const [entries, setEntries] = useState<WaitlistEntry[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState<string | null>(null);
    const { confirm } = useConfirmDialog();

    const load = async () => {
        setFailed(false);
        try {
            const data = await waitlistApi.getAllWaitlistAdmin();
            setEntries(data);
        } catch {
            // Сбой — не «никто не ждёт»: хорошие данные не затираем.
            setFailed(true);
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
        const ok = await confirm({
            title: 'Убрать из листа ожидания?',
            body: 'Клиент больше не получит уведомление, когда слот освободится.',
            confirmLabel: 'Убрать из листа',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(id);
        try {
            await waitlistApi.removeFromWaitlist(id);
            setEntries(prev => (prev || []).filter(e => e.id !== id));
            toast.success('Убрали из листа ожидания');
        } catch (e: any) {
            toastApiError(e, 'Не удалось убрать из листа. Попробуйте ещё раз');
        } finally {
            setBusy(null);
        }
    };

    return (
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* 09.11 фаза 3: внутренний экран — шапка со «←», число в подзаголовке. */}
            <MobilePageHeader
                title="Ожидание слотов"
                subtitle={entries === null ? 'Загружаем…' : `Активных записей: ${filtered.length}`}
                fallbackTo="/m/admin/dashboard"
            />

            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: 'var(--color-sunken)', borderRadius: 8,
                    padding: '0 12px', gap: 8, minHeight: 44, marginTop: 4,
                }}>
                    <Search size={16} color={COLOR.ink60} aria-hidden="true" />
                    <input
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        aria-label="Поиск в листе ожидания"
                        placeholder="Имя, email, кабинет…"
                        style={{
                            flex: 1, background: 'transparent', border: 'none',
                            outline: 'none', fontSize: 16, fontFamily: 'inherit', minWidth: 0,
                            color: 'var(--color-ink)',
                        }}
                    />
                </div>
            </div>

            {failed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось загрузить лист ожидания" onRetry={load} />
                </div>
            )}

            {entries === null ? (
                failed ? null : (
                    <div style={{ padding: '0 16px' }}>
                        <SkeletonList count={3} label="Загружаем лист ожидания" cardHeight={56} />
                    </div>
                )
            ) : grouped.length === 0 ? (
                <div style={{ padding: '0 16px' }}>
                    <EmptyState
                        compact
                        title={query ? 'Ничего не нашлось' : 'Сейчас никто не ждёт слот'}
                        hint={query ? 'Попробуйте другое имя или кабинет.' : undefined}
                    />
                </div>
            ) : (
                <div style={{ padding: '0 16px' }}>
                    {grouped.map(([dateKey, items]) => (
                        <ListGroup
                            key={dateKey}
                            title={formatDateLabel(dateKey, { capitalize: true })}
                            aside={<span className="num">{items.length}</span>}
                        >
                            {items.map(e => {
                                const r = RESOURCES.find(x => x.id === e.resourceId);
                                const l = LOCATIONS.find(x => x.id === r?.locationId);
                                const u = userByEmail.get(e.userId);
                                return (
                                    <ListRow
                                        key={e.id}
                                        lead={<ListTime start={e.startTime} end={e.endTime} />}
                                        title={u?.name || e.userId}
                                        subtitle={<>{r?.name || e.resourceId}{l && <span> · {l.name}</span>}</>}
                                        action={
                                            <button
                                                onClick={() => remove(e.id)}
                                                disabled={busy === e.id}
                                                style={{
                                                    background: 'transparent', color: 'var(--status-danger-fg)',
                                                    border: 'none', borderRadius: 8,
                                                    width: 44, height: 44,
                                                    display: 'grid', placeItems: 'center',
                                                    cursor: busy === e.id ? 'wait' : 'pointer',
                                                    opacity: busy === e.id ? 0.5 : 1,
                                                    flexShrink: 0,
                                                }}
                                                aria-label={`Убрать из листа ожидания: ${u?.name || e.userId}`}
                                            >
                                                {busy === e.id ? <Loader2 size={16} className="animate-spin" /> : <X size={18} aria-hidden="true" />}
                                            </button>
                                        }
                                    />
                                );
                            })}
                        </ListGroup>
                    ))}
                </div>
            )}
        </div>
    );
}
