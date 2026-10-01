import { AlertCircle, Check } from 'lucide-react';
import clsx from 'clsx';
import { formatGel } from '../../utils/format';

/**
 * DueBadge — «к оплате 36 ₾» / «✓ оплачено» у брони (волна 4, решение В2).
 *
 * Владелец 01.10: неоплаченные брони должны бросаться в глаза, чтобы админы
 * были внимательнее. Поэтому:
 *  - due > 0 (прошедшая или будущая) — тон danger: заливка --status-danger-bg,
 *    текст --status-danger-fg «к оплате 36 ₾»;
 *  - оплачено (due ≤ 0, запись в dueMap есть) — спокойный ok-тон «✓ оплачено»;
 *  - записи нет (абонемент, обслуживание, прощённая) — ничего не рисуем.
 * Всегда цвет + текст + значок, не только цвет.
 *
 *   <DueBadge due={dueMap.get(b.id)?.due} paid={!!dueMap.get(b.id)} />
 */
export interface DueBadgeProps {
    /** Сколько взять, ₾ (DueInfo.due). null/undefined — записи нет. */
    due: number | null | undefined;
    /** true — запись в dueMap есть (бронь денежная): при due ≤ 0 покажем «✓ оплачено». */
    paid?: boolean;
    /** Подпись оплаченного; по умолчанию «оплачено». */
    paidLabel?: string;
    /** dot — для плотных таблиц Grid House (точка + текст без заливки). */
    variant?: 'badge' | 'dot';
    className?: string;
}

export function DueBadge({ due, paid = false, paidLabel = 'оплачено', variant = 'badge', className }: DueBadgeProps) {
    const amount = Number(due ?? 0);
    if (due != null && amount > 0) {
        return (
            <span className={clsx('ui-badge', 'ui-badge--danger', variant === 'dot' && 'ui-badge--dot', className)}>
                {variant === 'dot'
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <AlertCircle size={14} strokeWidth={2.25} aria-hidden="true" />}
                <span>к оплате <span className="num">{formatGel(amount)}</span></span>
            </span>
        );
    }
    if (!paid) return null;
    return (
        <span className={clsx('ui-badge', 'ui-badge--ok', variant === 'dot' && 'ui-badge--dot', className)}>
            {variant === 'dot'
                ? <span className="ui-badge__dot" aria-hidden="true" />
                : <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
            {paidLabel}
        </span>
    );
}
