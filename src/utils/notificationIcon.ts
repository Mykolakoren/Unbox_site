import { AlertTriangle, Bell, CalendarX, CheckCircle, Clock, ListTodo, UserPlus, XCircle, type LucideIcon } from 'lucide-react';

/**
 * Значок уведомления по имени, которое пишет сервер (notification.icon):
 * «CheckCircle», «alert-triangle», «calendar-x»… Имена приходят в разном
 * написании, поэтому сравниваем без регистра и дефисов. Неизвестное — колокольчик.
 *
 * Обход мобильной версии 10.10: телефон печатал имя текстом
 * («CheckCircle Бронь подтверждена»).
 */
const ICONS: Record<string, LucideIcon> = {
    checkcircle: CheckCircle,
    xcircle: XCircle,
    clock: Clock,
    alerttriangle: AlertTriangle,
    calendarx: CalendarX,
    userplus: UserPlus,
    listtodo: ListTodo,
    bell: Bell,
};

export function notificationIcon(name?: string | null): LucideIcon {
    const key = (name || '').toLowerCase().replace(/[^a-z]/g, '');
    return ICONS[key] || Bell;
}
