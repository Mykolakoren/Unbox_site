import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bell, UserPlus, CalendarX, AlertTriangle, Clock,
    CheckCheck, Loader2, ListTodo,
} from 'lucide-react';
import clsx from 'clsx';
import { notificationsApi, type AppNotification } from '../../api/notifications';
import { useAdminTaskStore } from '../../store/adminTaskStore';

// Icon mapping
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    UserPlus, CalendarX, AlertTriangle, Clock, ListTodo, Bell,
};

function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'сейчас';
    if (mins < 60) return `${mins} мин.`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} ч.`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return 'вчера';
    if (days < 7) return `${days} дн.`;
    return `${Math.floor(days / 7)} нед.`;
}

export function NotificationBell() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [unreadCount, setUnreadCount] = useState(0);
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Poll unread count every 30s
    const fetchCount = useCallback(async () => {
        try {
            const count = await notificationsApi.getUnreadCount();
            setUnreadCount(count);
        } catch {
            // silent
        }
    }, []);

    useEffect(() => {
        fetchCount();
        const interval = setInterval(fetchCount, 30000);
        return () => clearInterval(interval);
    }, [fetchCount]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    // Load full list when opening
    const handleOpen = async () => {
        if (open) { setOpen(false); return; }
        setOpen(true);
        setLoading(true);
        try {
            const data = await notificationsApi.getNotifications({ limit: 30 });
            setNotifications(data);
        } catch {
            setNotifications([]);
        } finally {
            setLoading(false);
        }
    };

    // Task deadline virtual notifications
    const taskDeadlineNotifications = (() => {
        try {
            const tasks = useAdminTaskStore.getState().tasks;
            const now = Date.now();
            const cutoff = now + 24 * 60 * 60 * 1000;
            return tasks
                .filter(t => t.status !== 'DONE' && t.deadline && new Date(t.deadline).getTime() < cutoff)
                .map(t => ({
                    id: `task-${t.id}`,
                    type: 'task_deadline',
                    title: new Date(t.deadline!).getTime() < now ? 'Задача просрочена' : 'Дедлайн приближается',
                    description: t.title,
                    icon: 'ListTodo',
                    link: '/admin/tasks',
                    recipientId: '',
                    isRead: false,
                    createdAt: t.deadline!,
                } as AppNotification));
        } catch { return []; }
    })();

    const allNotifications = [...taskDeadlineNotifications, ...notifications];

    const handleClick = async (n: AppNotification) => {
        if (!n.isRead && !n.id.startsWith('task-')) {
            await notificationsApi.markRead(n.id).catch(() => {});
            setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
            setUnreadCount(prev => Math.max(0, prev - 1));
        }
        if (n.link) navigate(n.link);
        setOpen(false);
    };

    const handleMarkAll = async () => {
        setMarkingAll(true);
        try {
            await notificationsApi.markAllRead();
            setNotifications(prev => prev.map(x => ({ ...x, isRead: true })));
            setUnreadCount(0);
        } catch { /* */ }
        setMarkingAll(false);
    };

    const totalUnread = unreadCount + taskDeadlineNotifications.length;

    return (
        <div ref={ref} className="relative">
            <button
                onClick={handleOpen}
                className={clsx(
                    "relative p-2 rounded-xl transition-colors",
                    open ? "bg-white/15" : "hover:bg-white/10"
                )}
            >
                <Bell size={18} className="text-white/80" />
                {totalUnread > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 shadow-lg animate-in zoom-in-50 duration-200">
                        {totalUnread > 99 ? '99+' : totalUnread}
                    </span>
                )}
            </button>

            {open && (
                <>
                    <div
                        className="absolute right-0 top-full mt-2 w-80 max-h-[420px] rounded-xl overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-150 flex flex-col"
                        style={{
                            background: 'rgba(255,255,255,0.97)',
                            backdropFilter: 'blur(20px)',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.1)',
                        }}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                            <span className="font-bold text-sm text-gray-800">Уведомления</span>
                            {unreadCount > 0 && (
                                <button
                                    onClick={handleMarkAll}
                                    disabled={markingAll}
                                    className="flex items-center gap-1 text-[11px] text-unbox-green hover:text-unbox-dark font-medium transition-colors disabled:opacity-50"
                                >
                                    {markingAll ? <Loader2 size={12} className="animate-spin" /> : <CheckCheck size={12} />}
                                    Прочитать все
                                </button>
                            )}
                        </div>

                        {/* List */}
                        <div className="overflow-y-auto flex-1">
                            {loading ? (
                                <div className="flex items-center justify-center py-10">
                                    <Loader2 size={20} className="animate-spin text-unbox-grey" />
                                </div>
                            ) : allNotifications.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-10 text-unbox-grey">
                                    <Bell size={24} className="opacity-30 mb-2" />
                                    <span className="text-sm">Нет уведомлений</span>
                                </div>
                            ) : (
                                allNotifications.map(n => {
                                    const IconComp = ICON_MAP[n.icon || ''] || Bell;
                                    return (
                                        <button
                                            key={n.id}
                                            onClick={() => handleClick(n)}
                                            className={clsx(
                                                "w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0",
                                                !n.isRead && "border-l-2 border-l-unbox-green bg-unbox-green/[0.03]"
                                            )}
                                        >
                                            <div className={clsx(
                                                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                                                n.type === 'crm_access_request' ? "bg-blue-50 text-blue-500" :
                                                n.type === 'task_deadline' ? "bg-amber-50 text-amber-600" :
                                                n.type === 'booking_cancelled' ? "bg-red-50 text-red-500" :
                                                "bg-gray-100 text-gray-500"
                                            )}>
                                                <IconComp size={16} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className={clsx("text-sm leading-tight", !n.isRead ? "font-semibold text-gray-800" : "text-gray-600")}>
                                                    {n.title}
                                                </div>
                                                {n.description && (
                                                    <div className="text-xs text-gray-400 mt-0.5 truncate">{n.description}</div>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-gray-400 shrink-0 mt-1">{timeAgo(n.createdAt)}</span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
