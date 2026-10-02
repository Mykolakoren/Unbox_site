import { AlertCircle, AlertTriangle, Check, CircleDashed } from 'lucide-react';
import clsx from 'clsx';
import { formatGel } from '../../utils/format';
import { statusLabel } from '../../design/statuses';
import { COVERED_HINT } from '../../utils/dueAmounts';

/**
 * DueBadge — «к оплате 36 ₾» / «✓ оплачено» у брони (волна 4, решение В2).
 *
 * Владелец 01.10: неоплаченные брони должны бросаться в глаза, чтобы админы
 * были внимательнее. Поэтому:
 *  - due > 0 (прошедшая или будущая) — тон danger: заливка --status-danger-bg,
 *    текст --status-danger-fg «к оплате 36 ₾»;
 *  - оплачено (due ≤ 0, запись в dueMap есть) — спокойный ok-тон «✓ оплачено»;
 *    если бронь ещё НЕ списана (charged = false), а взять нечего — значит, её
 *    заранее покрывает плюс на балансе: пишем «покрыто балансом» нейтральным
 *    тоном и контурным кружком вместо «✓» (денег за неё никто не вносил, их
 *    спишут с баланса за сутки до начала — как в клетке шахматки);
 *  - прошла, но так и не списана (uncharged, сбой крона) — нейтрально-
 *    предупреждающий тон pending «не списана»: проверить, не долг;
 *  - записи нет (абонемент, обслуживание, прощённая) — ничего не рисуем.
 * Всегда цвет + текст + значок, не только цвет. Только подписи — суммы
 * считает computeDueByBooking, здесь ничего не пересчитываем.
 *
 *   <DueBadge due={info?.due} paid={!!info} charged={info?.charged} />
 */
export interface DueBadgeProps {
    /** Сколько взять, ₾ (DueInfo.due). null/undefined — записи нет. */
    due: number | null | undefined;
    /** true — запись в dueMap есть (бронь денежная): при due ≤ 0 покажем «✓ оплачено». */
    paid?: boolean;
    /** DueInfo.charged. false при due ≤ 0 — «покрыто балансом». Не передан — как раньше. */
    charged?: boolean;
    /** Прошедшая бронь без списания (completed + pending) — «не списана». */
    uncharged?: boolean;
    /** Подпись оплаченного; по умолчанию «оплачено». */
    paidLabel?: string;
    /** dot — для плотных таблиц Grid House (точка + текст без заливки). */
    variant?: 'badge' | 'dot';
    className?: string;
}

export function DueBadge({
    due, paid = false, charged, uncharged = false, paidLabel = 'оплачено', variant = 'badge', className,
}: DueBadgeProps) {
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
    if (uncharged && !paid) {
        return (
            <span
                className={clsx('ui-badge', 'ui-badge--pending', variant === 'dot' && 'ui-badge--dot', className)}
                title="Бронь прошла, а с баланса её так и не списали — проверьте в карточке клиента"
            >
                {variant === 'dot'
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <AlertTriangle size={14} strokeWidth={2.25} aria-hidden="true" />}
                {statusLabel('payment', 'not_charged', 'staff').toLowerCase()}
            </span>
        );
    }
    if (!paid) return null;
    // Ещё не списана, а взять нечего — покрыта плюсом на балансе: другой знак
    // (контурный кружок, нейтральный тон), не «✓» — денег за неё никто не вносил.
    const covered = charged === false;
    const label = charged === false ? 'покрыто балансом' : paidLabel;
    return (
        <span
            className={clsx('ui-badge', covered ? 'ui-badge--muted' : 'ui-badge--ok', variant === 'dot' && 'ui-badge--dot', className)}
            title={covered ? COVERED_HINT : undefined}
        >
            {variant === 'dot'
                ? <span className="ui-badge__dot" aria-hidden="true" />
                : covered
                    ? <CircleDashed size={14} strokeWidth={2.25} aria-hidden="true" />
                    : <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
            {label}
        </span>
    );
}
