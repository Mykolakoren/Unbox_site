import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { notificationsApi, type AppNotification } from '../../api/notifications';

/**
 * Notifications bell for the mobile cabinet.
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
export function NotificationsBell({ color = '#0E0E0E' }: { color?: string } = {}) {
    const [unread, setUnread] = useState(0);
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(false);

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

    const openSheet = async () => {
        setOpen(true);
        setLoading(true);
        try {
            const list = await notificationsApi.getNotifications({ limit: 20 });
            setItems(list);
        } catch { /* ignore */ }
        finally { setLoading(false); }
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
                aria-label="Уведомления"
                style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 6,
                    color,
                }}
            >
                <Bell size={20} />
                {unread > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        background: '#C8253A',
                        color: '#fff',
                        fontSize: 10,
                        fontWeight: 700,
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

            {open && (
                <div
                    onClick={() => setOpen(false)}
                    style={{
                        position: 'fixed', inset: 0,
                        background: 'rgba(0,0,0,0.55)',
                        zIndex: 200,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%',
                            maxWidth: 480,
                            background: '#fff',
                            borderRadius: '20px 20px 0 0',
                            padding: 20,
                            paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            maxHeight: '80vh',
                            overflow: 'auto',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Уведомления</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                {unread > 0 && (
                                    <button
                                        onClick={markAllRead}
                                        style={{
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: '#0E0E0E',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            padding: 0,
                                            textDecoration: 'underline',
                                        }}
                                    >
                                        Прочитать все
                                    </button>
                                )}
                                <button
                                    onClick={() => setOpen(false)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 0 }}
                                >
                                    <X size={22} />
                                </button>
                            </div>
                        </div>

                        {loading && <div style={{ color: '#666', fontSize: 13 }}>Загружаю…</div>}

                        {!loading && items.length === 0 && (
                            <div style={{ background: '#F4F4F2', borderRadius: 12, padding: 24, textAlign: 'center', color: '#666', fontSize: 14 }}>
                                Уведомлений пока нет.
                            </div>
                        )}

                        {items.map(n => (
                            <button
                                key={n.id}
                                onClick={() => handleTap(n)}
                                style={{
                                    width: '100%',
                                    background: n.isRead ? '#fff' : '#FEF7E6',
                                    border: '1px solid rgba(0,0,0,0.08)',
                                    borderRadius: 12,
                                    padding: '12px 14px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'left',
                                    color: '#0E0E0E',
                                }}
                            >
                                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>
                                    {n.icon ? `${n.icon} ` : ''}{n.title}
                                </div>
                                <div style={{ fontSize: 12, color: '#444', lineHeight: 1.35 }}>
                                    {n.description}
                                </div>
                                <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                                    {new Date(n.createdAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
