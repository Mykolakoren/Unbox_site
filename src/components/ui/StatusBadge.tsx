import { AlertCircle, ArrowRight, CalendarDays, Check, Clock, Minus, Repeat, Undo2, X } from 'lucide-react';
import clsx from 'clsx';
import { getStatusDef, statusLabel, type StatusIcon, type StatusKind } from '../../design/statuses';

/**
 * StatusBadge — статус брони / оплаты / сессии из ОДНОГО словаря
 * (src/design/statuses.ts). Цвет — только из --status-*, плюс значок, чтобы
 * смысл читался и без цвета (дальтонизм, солнце на экране).
 *
 *   <StatusBadge kind="booking" status={b.status} />
 *   <StatusBadge kind="booking" status="pending_approval" audience="staff" />
 *   <StatusBadge kind="payment" status={b.paymentStatus} variant="dot" />
 */
const ICONS: Record<StatusIcon, typeof Check> = {
    check: Check,
    clock: Clock,
    x: X,
    alert: AlertCircle,
    repeat: Repeat,
    move: ArrowRight,
    calendar: CalendarDays,
    undo: Undo2,
    minus: Minus,
};

export interface StatusBadgeProps {
    kind: StatusKind;
    status: string | null | undefined;
    /** staff — формы для админки («Ждёт подтверждения» вместо «Ждём»). */
    audience?: 'client' | 'staff';
    /** badge — плашка; dot — точка + текст для плотных таблиц. */
    variant?: 'badge' | 'dot';
    className?: string;
}

export function StatusBadge({ kind, status, audience = 'client', variant = 'badge', className }: StatusBadgeProps) {
    const def = getStatusDef(kind, status);
    const label = statusLabel(kind, status, audience);
    const Icon = ICONS[def.icon];
    return (
        <span
            className={clsx('ui-badge', `ui-badge--${def.tone}`, variant === 'dot' && 'ui-badge--dot', className)}
            title={def.known ? undefined : String(status ?? '')}
        >
            {variant === 'dot'
                ? <span className="ui-badge__dot" aria-hidden="true" />
                : <Icon size={14} strokeWidth={2.25} aria-hidden="true" />}
            {label}
        </span>
    );
}
