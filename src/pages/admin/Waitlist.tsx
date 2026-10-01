import { useEffect, useState } from 'react';
import { Bell, Clock, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { WaitlistEntry } from '../../store/types';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { formatDateLabel, formatDayMonth, formatTime } from '../../utils/format';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { ruCountWord } from '../../utils/plural';
import { toastApiError } from '../../utils/errors';
import { waitlistApi } from '../../api/waitlist';

/**
 * Лист ожидания — клиенты, которые ждут, когда освободится время (волна 4, D).
 *
 * G8-01: раньше страница брала waitlist из стора, а стор грузил
 * GET /waitlist/my — личную очередь самого админа. За компьютером было
 * «Никто не ждёт», хотя на телефоне — пять клиентов. Теперь, как и
 * на телефоне, — GET /waitlist/admin/all. Удаление — тем же путём, что на
 * телефоне, с ошибкой на экране, а не «Запись удалена» при сбое.
 */
export function AdminWaitlist() {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const { resources, fetchResources } = useBookingStore();
    const { confirm } = useConfirmDialog();
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        setFailed(false);
        try {
            setEntries(await waitlistApi.getAllWaitlistAdmin());
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // Имён в ответе нет (только почта) — берём из списка клиентов.
        if (users.length === 0) fetchUsers();
        fetchResources();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const userOf = (email: string) => users.find(u => u.email === email);
    const resourceName = (id: string) => resources.find(r => r.id === id)?.name || id;

    const handleNotify = async (entry: WaitlistEntry) => {
        setBusy(`n-${entry.id}`);
        try {
            const r = await waitlistApi.notifyEntry(entry.id);
            toast.success(`Уведомление отправлено${r.notified ? ` — ${r.notified}` : ''}`);
        } catch (e) {
            toastApiError(e, 'Не удалось отправить уведомление');
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (entry: WaitlistEntry) => {
        const who = userOf(entry.userId)?.name || entry.userId;
        const ok = await confirm({
            title: 'Убрать из листа ожидания?',
            body: `${who}, ${formatDayMonth(entry.date)} ${entry.startTime}–${entry.endTime}: клиент больше не получит уведомление, когда время освободится.`,
            confirmLabel: 'Убрать из листа',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(`d-${entry.id}`);
        try {
            await waitlistApi.removeFromWaitlist(entry.id);
            setEntries(prev => prev.filter(e => e.id !== entry.id));
            toast.success('Убрали из листа ожидания');
        } catch (e) {
            toastApiError(e, 'Не удалось убрать из листа. Попробуйте ещё раз');
        } finally {
            setBusy(null);
        }
    };

    const count = entries.length;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            <PageHeader
                title="Лист ожидания"
                description={!loading && !failed && count > 0
                    ? `Ждут, когда освободится время: ${ruCountWord(count, ['клиент', 'клиента', 'клиентов'])}. Освободилось — нажмите «Уведомить».`
                    : 'Клиенты, которые ждут, когда освободится время в кабинете.'}
            />

            {loading ? (
                <SkeletonList count={4} label="Загружаем лист ожидания" cardHeight={56} />
            ) : failed ? (
                <ErrorBar message="Не удалось загрузить лист ожидания" onRetry={load} />
            ) : count === 0 ? (
                <div style={{ border: `1px solid ${GH.ink10}`, background: GH.card }}>
                    <EmptyState
                        icon={<Clock size={24} />}
                        title="Сейчас никто не ждёт"
                        hint="Когда клиент попросит сообщить о свободном времени, он появится здесь."
                        compact
                    />
                </div>
            ) : (
                <div style={{ overflowX: 'auto', border: `1px solid ${GH.ink10}`, background: GH.card }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720, fontSize: 14 }}>
                        <thead>
                            <tr>
                                {['Клиент', 'Когда нужно', 'Кабинет', 'Записался', ''].map((h, i) => (
                                    <th
                                        key={i}
                                        scope="col"
                                        style={{
                                            textAlign: i === 4 ? 'right' : 'left',
                                            padding: '10px 16px',
                                            borderBottom: `1px solid ${GH.ink10}`,
                                            fontFamily: GH_MONO, fontSize: 12, fontWeight: 500,
                                            letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60,
                                        }}
                                    >
                                        {h || <span className="sr-only">Действия</span>}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {entries.map(entry => {
                                const u = userOf(entry.userId);
                                const created = entry.createdAt ? parseUTC(entry.createdAt) : null;
                                return (
                                    <tr key={entry.id} style={{ borderBottom: `1px solid ${GH.ink10}` }}>
                                        <td style={cell}>
                                            <div style={{ fontWeight: 600 }}>{u?.name || entry.userId}</div>
                                            <div style={{ color: GH.ink60, fontSize: 12, overflowWrap: 'anywhere' }}>
                                                {[u?.phone, u ? entry.userId : null].filter(Boolean).join(' · ')}
                                            </div>
                                        </td>
                                        <td style={cell}>
                                            <div style={{ fontWeight: 500 }}>
                                                {formatDateLabel(String(entry.date).slice(0, 10), { capitalize: true, withYear: 'auto' })}
                                            </div>
                                            <div className="num" style={{ color: GH.ink60 }}>{entry.startTime}–{entry.endTime}</div>
                                        </td>
                                        <td style={cell}>{resourceName(entry.resourceId)}</td>
                                        <td style={{ ...cell, color: GH.ink60 }} className="num">
                                            {created && !isNaN(created.getTime())
                                                ? `${formatDayMonth(created, { timeZone: BATUMI_TZ })}, ${formatTime(created, { timeZone: BATUMI_TZ })}`
                                                : '—'}
                                        </td>
                                        <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                            <div style={{ display: 'inline-flex', gap: 8 }}>
                                                <Button
                                                    variant="secondary"
                                                    size="compact"
                                                    icon={<Bell size={16} aria-hidden="true" />}
                                                    loading={busy === `n-${entry.id}`}
                                                    onClick={() => handleNotify(entry)}
                                                >
                                                    Уведомить
                                                </Button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDelete(entry)}
                                                    disabled={busy === `d-${entry.id}`}
                                                    aria-label={`Убрать ${u?.name || entry.userId} из листа ожидания`}
                                                    title="Убрать из листа ожидания"
                                                    className="admin-trash"
                                                    style={{
                                                        width: 36, height: 36, display: 'grid', placeItems: 'center',
                                                        background: 'none', border: `1px solid ${GH.ink10}`, borderRadius: 8,
                                                        color: GH.ink60, cursor: 'pointer',
                                                    }}
                                                >
                                                    <Trash2 size={16} aria-hidden="true" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <style>{`.admin-trash:hover { color: var(--status-danger-fg) !important; border-color: var(--status-danger-fg) !important; }`}</style>
                </div>
            )}
        </div>
    );
}

const cell: React.CSSProperties = { padding: '10px 16px', verticalAlign: 'top' };
