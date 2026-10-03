import { AlertCircle, AlertTriangle, Check } from 'lucide-react';
import clsx from 'clsx';
import { formatGel } from '../../utils/format';
import { statusLabel } from '../../design/statuses';
import { COVERED_HINT, PAID_HINT } from '../../utils/dueAmounts';

/**
 * DueBadge — «к оплате 36 ₾» / «✓ оплачено» у брони (волна 4, решение В2;
 * правило значков — решение владельца 03.10).
 *
 * Владелец 01.10: неоплаченные брони должны бросаться в глаза, чтобы админы
 * были внимательнее. Владелец 03.10: брони, которые покрывает скидка за прошлую
 * неделю (и вообще плюс на балансе), — «оплачено»; если покрыта часть — к оплате
 * только разница. Поэтому:
 *  - due > 0 — тон danger «к оплате 36 ₾»; если часть брони уже покрыта
 *    (price > due) — «к оплате 11 ₾ из 20»;
 *  - оплачено (due ≤ 0, запись в dueMap есть) — ok-тон «✓ оплачено». Два случая:
 *    уже списана и долга на ней нет; ещё не списана, но её целиком покрывает плюс
 *    на балансе (спишется за 24 ч до начала — это в подсказке). Бронь, списанная
 *    В ДОЛГ, сюда не попадает никогда: у неё due > 0;
 *  - прошла, но так и не списана (uncharged, сбой крона) — нейтрально-
 *    предупреждающий тон pending «не списана»: проверить, не долг;
 *  - записи нет (абонемент без доплаты, обслуживание, прощённая) — ничего.
 * Всегда цвет + текст + значок, не только цвет. Только подписи — суммы
 * считают computeDueByBooking + applyAllocation, здесь ничего не пересчитываем.
 *
 *   <DueBadge due={info?.due} paid={!!info} charged={info?.charged} price={info?.price} />
 */
export interface DueBadgeProps {
    /** Сколько взять, ₾ (DueInfo.due). null/undefined — записи нет. */
    due: number | null | undefined;
    /** true — запись в dueMap есть (бронь денежная): при due ≤ 0 покажем «✓ оплачено». */
    paid?: boolean;
    /** DueInfo.charged: false — ещё не списана (подсказка «спишется за 24 ч до начала»). */
    charged?: boolean;
    /** Цена брони (DueInfo.price): больше due — «к оплате N ₾ из M». */
    price?: number | null;
    /** Прошедшая бронь без списания (completed + pending) — «не списана». */
    uncharged?: boolean;
    /** Подпись оплаченного; по умолчанию «оплачено». */
    paidLabel?: string;
    /** dot — для плотных таблиц Grid House (точка + текст без заливки). */
    variant?: 'badge' | 'dot';
    className?: string;
}

export function DueBadge({
    due, paid = false, charged, price, uncharged = false, paidLabel = 'оплачено', variant = 'badge', className,
}: DueBadgeProps) {
    const amount = Number(due ?? 0);
    if (due != null && amount > 0) {
        const of = Number(price ?? 0);
        const partial = of > amount + 0.004;
        return (
            <span
                className={clsx('ui-badge', 'ui-badge--danger', variant === 'dot' && 'ui-badge--dot', className)}
                title={partial ? 'Часть брони уже покрыта балансом клиента — взять только разницу' : undefined}
            >
                {variant === 'dot'
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <AlertCircle size={14} strokeWidth={2.25} aria-hidden="true" />}
                <span>
                    к оплате <span className="num">{formatGel(amount)}</span>
                    {partial && <> из <span className="num">{formatGel(of)}</span></>}
                </span>
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
    // Оплачено (03.10): и списанная без долга, и ещё не списанная, которую целиком
    // покрывает плюс на балансе (скидка за прошлую неделю, предоплата).
    return (
        <span
            className={clsx('ui-badge', 'ui-badge--ok', variant === 'dot' && 'ui-badge--dot', className)}
            title={charged === false ? COVERED_HINT : PAID_HINT}
        >
            {variant === 'dot'
                ? <span className="ui-badge__dot" aria-hidden="true" />
                : <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
            {paidLabel}
        </span>
    );
}
