import { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import { notificationsApi, type AppNotification } from '../../api/notifications';
import { COLOR, STATUS } from '../../design/tokens';
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
 * marks it read and hard-navigates — same UX as the desktop bell.
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
            window.location.href = n.link;
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
                {unread > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: STATUS.danger.fg,
                        color: COLOR.onInk,
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 999,
                        minWidth: 16,
                        height: 16,
                        padding: '0 4px',
                        display: 'grid',
                        placeItems: 'center',
                        lineHeight: 1,
                    }}>
                        {unread > 99 ? '99+' : unread}
                    </span>
                )}
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
                    <EmptyState compact title="Уведомлений пока нет" />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {items.map(n => (
                            <button
                                key={n.id}
                                onClick={() => handleTap(n)}
                                style={{
                                    width: '100%',
                                    background: n.isRead ? COLOR.card : STATUS.pending.bg,
                                    border: `1px solid ${COLOR.ink08}`,
                                    borderRadius: 12,
                                    padding: '12px 14px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'left',
                                    color: COLOR.ink,
                                }}
                            >
                                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>
                                    {/* Значок приходит с сервера вместе с текстом уведомления. */}
                                    {n.icon ? `${n.icon} ` : ''}{n.title}
                                </div>
                                <div style={{ fontSize: 12, color: COLOR.ink80, lineHeight: 1.35 }}>
                                    {n.description}
                                </div>
                                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>
                                    {formatDayMonth(n.createdAt)}, {formatTime(n.createdAt)}
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </Sheet>
        </>
    );
}
