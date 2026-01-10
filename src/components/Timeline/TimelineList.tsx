import { useEffect, useState } from 'react';
import { fetchTimelineEvents, type TimelineEvent } from '../../api/timeline';
import clsx from 'clsx';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface TimelineListProps {
    targetId?: string; // Filter by user or booking ID
    limit?: number;
    className?: string;
}

export function TimelineList({ targetId, limit = 20, className }: TimelineListProps) {
    const [events, setEvents] = useState<TimelineEvent[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadEvents();
    }, [targetId]);

    const loadEvents = async () => {
        try {
            setLoading(true);
            const data = await fetchTimelineEvents({ target_id: targetId, limit });
            setEvents(data);
        } catch (error) {
            console.error('Failed to load timeline:', error);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-4 text-center text-gray-500 text-sm">Загрузка истории...</div>;
    if (events.length === 0) return <div className="p-4 text-center text-gray-500 text-sm">История пуста</div>;

    return (
        <div className={clsx("space-y-4", className)}>
            {events.map((event) => (
                <div key={event.id} className="relative pl-6 border-l-2 border-gray-100 last:border-0 pb-4">
                    <div className={clsx(
                        "absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full border border-white",
                        getEventColor(event.event_type)
                    )}></div>

                    <div className="text-xs text-gray-400 mb-0.5">
                        {format(new Date(event.timestamp), "d MMM HH:mm", { locale: ru })} •
                        <span className="ml-1 font-medium text-gray-600">
                            {event.actor_req_role === 'owner' ? 'Владелец' :
                                event.actor_req_role === 'senior_admin' ? 'Ст. Админ' : 'Админ'}
                        </span>
                    </div>

                    <div className="text-sm text-gray-900 font-medium">
                        {event.event_type === 'role_change' && 'Изменение роли'}
                        {event.event_type === 'discount_change' && 'Изменение скидки'}
                        {event.event_type === 'subscription_freeze' && 'Заморозка абонемента'}
                        {event.event_type === 'booking_cancelled' && 'Отмена бронирования'}
                        {!['role_change', 'discount_change', 'subscription_freeze', 'booking_cancelled'].includes(event.event_type) && event.event_type}
                    </div>

                    <div className="text-xs text-gray-600 mt-1">
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
        case 'role_change': return 'bg-purple-500';
        case 'discount_change': return 'bg-green-500';
        case 'subscription_freeze': return 'bg-blue-500';
        case 'booking_cancelled': return 'bg-red-500';
        default: return 'bg-gray-400';
    }
}
