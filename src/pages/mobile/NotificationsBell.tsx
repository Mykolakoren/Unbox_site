import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CalendarDays, Gift, Ticket, type LucideIcon } from 'lucide-react';
import { notificationIcon } from '../../utils/notificationIcon';
import { notificationsApi, type AppNotification } from '../../api/notifications';
import { COLOR, SHAPE, TEXT } from '../../design/tokens';
import { ListGroup, ListIcon, ListRow } from '../../components/ui/ListRow';
import { Counter } from '../../components/ui/Counter';
import { formatDayMonth, formatTime } from '../../utils/format';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';

/**
 * Notifications bell for the mobile cabinet.
 *
 * Wave 1: список — в общей шторке Sheet (Esc, свайп, фокус, выше меню);
 * загрузка / ошибка / пусто — три разных состояния (раньше сбой
 * показывался как «Уведомлений пока нет»). Колокольчик — цель 44×44.
 *
 * Polls unread count every 60 seconds (cheap one-shot endpoint). Tap opens
 * a bottom-sheet with the latest 20 items. Tapping an item with a `link`
 * marks it read and opens the link inside the app (волна 2, X2-02: раньше
 * window.location — полная перезагрузка; компьютерный адрес вроде
 * /crm/clients/5 на телефоне App.tsx сам переводит в /m/crm/clients/5).
 *
 * Why polling and not websockets: the existing notifications service is
 * synchronous, no broadcast channel yet. Sixty-second cadence is fine for
 * "you have a hot-booking approval pending" / "your slot was approved" — by
 * the time a user opens their phone the count is fresh enough.
 */
export function NotificationsBell({ color = COLOR.ink }: { color?: string } = {}) {
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            try {
                const count = await notificationsApi.getUnreadCount();
                if (!cancelled) setUnread(count);
            } catch { /* ignore */ }
        };
        tick();
        const id = window.setInterval(tick, 60_000);
        return () => { cancelled = true; window.clearInterval(id); };
    }, []);

    const loadItems = async () => {
        setLoading(true);
        try {
            const list = await notificationsApi.getNotifications({ limit: 20 });
            setItems(list);
            setLoadFailed(false);
        } catch {
            setLoadFailed(true);
        } finally { setLoading(false); }
    };

    const openSheet = () => {
        setOpen(true);
        void loadItems();
    };

    const handleTap = async (n: AppNotification) => {
        if (!n.isRead) {
            try { await notificationsApi.markRead(n.id); } catch { /* ignore */ }
        }
        if (n.link) {
            setOpen(false);
            setUnread(c => (n.isRead ? c : Math.max(0, c - 1)));
            if (n.link.startsWith('/')) navigate(n.link);
            else window.open(n.link, '_blank', 'noopener,noreferrer');
        } else {
            // Refresh count and item state in place
            setItems(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
            setUnread(c => Math.max(0, c - 1));
        }
    };

    const markAllRead = async () => {
        try {
            await notificationsApi.markAllRead();
            setItems(prev => prev.map(x => ({ ...x, isRead: true })));
            setUnread(0);
        } catch { /* ignore */ }
    };

    return (
        <>
            <button
                onClick={openSheet}
                aria-label={unread > 0 ? `Уведомления, новых: ${unread}` : 'Уведомления'}
                // Ревью 09.11 (admin-design №14): колокольчик считает непрочитанные
                // уведомления, а число на вкладке «Заявки» — что ждёт решения. Разные вещи.
                title={unread > 0 ? `Непрочитанные уведомления: ${unread}. Заявки, которые ждут решения, — на вкладке «Заявки»` : 'Уведомления'}
                style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    width: 44,
                    height: 44,
                    padding: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color,
                }}
            >
                <Bell size={20} />
                {/* 09.11 фаза 3: тот же общий Counter, что во вкладках админки; тон новостей —
                    бирюза, не красный «долг/опасно». Без обводки: колокольчик стоит и на панели, и на бумаге. */}
                <Counter value={unread} tone="accent" style={{ position: 'absolute', top: 2, right: 2, boxShadow: 'none' }} />
            </button>

            <Sheet
                open={open}
                onClose={() => setOpen(false)}
                title="Уведомления"
                footer={unread > 0 ? (
                    <Button variant="secondary" block onClick={markAllRead}>
                        Прочитать все
                    </Button>
                ) : undefined}
            >
                {loading && items.length === 0 ? (
                    <SkeletonList count={3} cardHeight={64} label="Загружаем уведомления" />
                ) : loadFailed && items.length === 0 ? (
                    <ErrorBar message="Не удалось загрузить уведомления" onRetry={() => { void loadItems(); }} retrying={loading} />
                ) : items.length === 0 ? (
                    <EmptyState compact illustration="cup" title="Уведомлений пока нет" hint="Здесь появятся подтверждения броней, напоминания и подарки." />
                ) : (
                    // 09.11 фаза 3: без янтарной заливки (янтарь = «ждём/внимание», а тут
                    // просто новости). Непрочитанное — бирюзовая точка и заголовок 600,
                    // прочитанное — заголовок 500 ink-80. Строки — общий ListGroup bare.
                    <ListGroup bare aria-label="Уведомления">
                        {items.map(n => {
                            const Icon = pickIcon(n);
                            return (
                                <ListRow
                                    key={n.id}
                                    onClick={() => handleTap(n)}
                                    chevron={!!n.link}
                                    lead={<ListIcon><Icon size={20} /></ListIcon>}
                                    title={
                                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                            {!n.isRead && (
                                                <span
                                                    aria-hidden="true"
                                                    style={{ flex: 'none', width: 8, height: 8, borderRadius: SHAPE.pill, background: COLOR.accent, transform: 'translateY(-1px)' }}
                                                />
                                            )}
                                            <span style={n.isRead ? { fontWeight: 500, color: COLOR.ink80 } : undefined}>
                                                {n.title}
                                                {!n.isRead && <span className="sr-only"> (новое)</span>}
                                            </span>
                                        </span>
                                    }
                                    subtitle={<>
                                        {n.description && <span style={{ display: 'block', color: COLOR.ink80 }}>{n.description}</span>}
                                        <span className="num-inline">{formatDayMonth(n.createdAt)}, {formatTime(n.createdAt)}</span>
                                    </>}
                                />
                            );
                        })}
                    </ListGroup>
                )}
            </Sheet>
        </>
    );
}

/** Значок по типу: сервер часто шлёт общий «Bell» — тогда подарок/абонемент
 *  узнаём по типу уведомления (только вид, 09.11 фаза 3). */
function pickIcon(n: AppNotification): LucideIcon {
    const Icon = notificationIcon(n.icon);
    if (Icon !== Bell) return Icon;
    const t = `${n.type || ''}`.toLowerCase();
    if (t.includes('bonus') || t.includes('gift') || t.includes('welcome') || t === 'free_hour' || t === 'weekly_rebate') return Gift;
    if (t.startsWith('subscription')) return Ticket;
    if (t === 'slot_freed' || t.startsWith('booking') || t.startsWith('hot_booking')) return CalendarDays;
    return Bell;
}
