import { useEffect, useState } from 'react';
import { fetchTimelineEvents, type TimelineEvent } from '../../api/timeline';
import clsx from 'clsx';
import { formatDayMonth, formatTime } from '../../utils/format';
import { SkeletonText } from '../ui/Skeleton';
import { ErrorBar } from '../ui/ErrorBar';
import { EmptyState } from '../ui/EmptyState';

interface TimelineListProps {
    targetId?: string; // Filter by user or booking ID
    limit?: number;
    className?: string;
}

export function TimelineList({ targetId, limit = 20, className }: TimelineListProps) {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);
    // Загрузка упала ≠ «история пуста» (wave 1): раньше при ошибке
    // показывалось «История пуста».
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        loadEvents();
    }, [targetId]);

    const loadEvents = async () => {
        try {
            setLoading(true);
            setFailed(false);
            const data = await fetchTimelineEvents({ target_id: targetId, limit });
            setEvents(data);
        } catch (error) {
            console.error('Failed to load timeline:', error);
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return (
        <div className="p-4" role="status" aria-busy="true">
            <span className="sr-only">Загружаем историю…</span>
            <SkeletonText lines={4} />
        </div>
    );
    if (failed) return <div className="p-4"><ErrorBar message="Не удалось загрузить историю" onRetry={loadEvents} /></div>;
    if (events.length === 0) return <EmptyState compact title="Истории пока нет" hint="Здесь появятся смена роли, скидки и заморозки абонемента." />;

    return (
        <div className={clsx("space-y-4", className)}>
            {events.map((event) => (
                <div key={event.id} className="relative pl-6 border-l-2 border-ink-10 last:border-0 pb-4">
                    <div className={clsx(
                        "absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full border border-card",
                        getEventColor(event.event_type)
                    )}></div>

                    <div className="text-xs text-ink-60 mb-0.5">
                        <span className="num">{formatDayMonth(new Date(event.timestamp))}, {formatTime(new Date(event.timestamp))}</span> ·
                        <span className="ml-1 font-medium text-ink-80">
                            {event.actor_req_role === 'owner' ? 'Владелец' :
                                event.actor_req_role === 'senior_admin' ? 'Старший админ' : 'Админ'}
                        </span>
                    </div>

                    <div className="text-sm text-ink font-medium">
                        {event.event_type === 'role_change' && 'Изменение роли'}
                        {event.event_type === 'discount_change' && 'Изменение скидки'}
                        {event.event_type === 'subscription_freeze' && 'Заморозка абонемента'}
                        {event.event_type === 'booking_cancelled' && 'Отмена бронирования'}
                        {!['role_change', 'discount_change', 'subscription_freeze', 'booking_cancelled'].includes(event.event_type) && event.event_type}
                    </div>

                    <div className="text-xs text-ink-80 mt-1">
                        {event.description}
                    </div>

                    {/* Metadata Dump (Optional - useful for debug or details) */}
                    {/* {JSON.stringify(event.metadata_dump)} */}
                </div>
            ))}
        </div>
    );
}

function getEventColor(type: string): string {
    switch (type) {
        // Цвет только по смыслу (wave 1): без фиолетового «для красоты».
        case 'role_change': return 'bg-ink';
        case 'discount_change': return 'bg-[var(--status-ok-fg)]';
        case 'subscription_freeze': return 'bg-[var(--status-info-fg)]';
        case 'booking_cancelled': return 'bg-[var(--status-danger-fg)]';
        default: return 'bg-ink-40';
    }
}
