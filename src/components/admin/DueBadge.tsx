import { AlertCircle, AlertTriangle, Check, CircleDashed, Repeat } from 'lucide-react';
import clsx from 'clsx';
import { formatGel } from '../../utils/format';
import { statusLabel } from '../../design/statuses';
import { PAID_HINT } from '../../utils/dueAmounts';

/**
 * DueBadge — денежная метка у брони для сотрудников.
 *
 * Решение владельца 09.11 (как в компьютерной шахматке, «Метки оплаты у
 * сотрудников»): четыре вида, всегда цвет + текст + значок, не только цвет.
 *  - «(!) к оплате 36 ₾» — due > 0, тон danger; если часть брони уже покрыта
 *    (price > due) — «к оплате 11 ₾ из 20». Бронь, списанная В ДОЛГ, — всегда сюда;
 *  - «✓ оплачено» — деньги уже списаны с баланса (charged !== false) и долга
 *    на брони нет, тон ok;
 *  - «◌ с баланса» — ещё не списана (charged === false), но баланса клиента
 *    хватает, спишется само за 24 ч до начала; тон muted (выбор знака — тот же,
 *    что был у шахматки 01.10: due ≤ 0 и charged === false);
 *  - «абонемент» — бронь по абонементу без денежной доплаты (записи в dueMap
 *    нет, method = 'subscription'), тон muted.
 * У брони «Ждёт подтверждения» (status = 'pending_approval') денежной метки
 * нет вовсе: решение ещё не принято, денег не брали.
 * Прошедшая, но так и не списанная (uncharged, сбой крона) — «не списана».
 * Записи нет и это не абонемент (обслуживание, прощённая) — ничего.
 *
 * Только подписи — суммы считают computeDueByBooking + applyAllocation.
 * Новые пропсы (status, method) необязательные: компьютерные экраны, которые их
 * не передают, видят те же «к оплате / оплачено / с баланса».
 *
 *   <DueBadge due={info?.due} paid={!!info} charged={info?.charged} price={info?.price}
 *             status={b.status} method={b.paymentMethod} />
 */
export interface DueBadgeProps {
    /** Сколько взять, ₾ (DueInfo.due). null/undefined — записи нет. */
    due: number | null | undefined;
    /** true — запись в dueMap есть (бронь денежная): при due ≤ 0 — «оплачено» или «с баланса». */
    paid?: boolean;
    /** DueInfo.charged: false — ещё не списана → «◌ с баланса». */
    charged?: boolean;
    /** Цена брони (DueInfo.price): больше due — «к оплате N ₾ из M». */
    price?: number | null;
    /** Прошедшая бронь без списания (completed + pending) — «не списана». */
    uncharged?: boolean;
    /** Статус брони: 'pending_approval' — денежной метки нет. */
    status?: string | null;
    /** Способ оплаты брони: 'subscription' без записи — «абонемент». */
    method?: string | null;
    /** Подпись списанной; по умолчанию «оплачено». */
    paidLabel?: string;
    /** dot — для плотных таблиц Grid House (точка + текст без заливки). */
    variant?: 'badge' | 'dot';
    className?: string;
}

/** Подсказка у «◌ с баланса» (на телефоне её не видно — слово говорит само). */
export const COVERED_BADGE_HINT = 'Ещё не списано: баланса клиента хватает, спишется само за 24 ч до начала — брать ничего не нужно';

export function DueBadge({
    due, paid = false, charged, price, uncharged = false, status, method,
    paidLabel = statusLabel('payment', 'charged', 'staff'), variant = 'badge', className,
}: DueBadgeProps) {
    // Заявка «Ждёт подтверждения»: ни «к оплате», ни «оплачено» — денег не брали.
    if (status === 'pending_approval') return null;
    const dot = variant === 'dot';
    const amount = Number(due ?? 0);
    if (due != null && amount > 0) {
        const of = Number(price ?? 0);
        const partial = of > amount + 0.004;
        return (
            <span
                className={clsx('ui-badge', 'ui-badge--danger', dot && 'ui-badge--dot', className)}
                title={partial ? 'Часть брони уже покрыта балансом клиента — взять только разницу' : undefined}
            >
                {dot
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <AlertCircle size={14} strokeWidth={2.25} aria-hidden="true" />}
                <span>
                    к оплате <span className="num">{formatGel(amount)}</span>
                    {partial && <> из <span className="num">{formatGel(of).replace(/\s₾$/, '')}</span></>}
                </span>
            </span>
        );
    }
    if (uncharged && !paid) {
        return (
            <span
                className={clsx('ui-badge', 'ui-badge--pending', dot && 'ui-badge--dot', className)}
                title="Бронь прошла, а с баланса её так и не списали — проверьте в карточке клиента"
            >
                {dot
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <AlertTriangle size={14} strokeWidth={2.25} aria-hidden="true" />}
                {statusLabel('payment', 'not_charged', 'staff').toLowerCase()}
            </span>
        );
    }
    if (!paid) {
        if (method === 'subscription') {
            return (
                <span
                    data-due-mark="subscription"
                    className={clsx('ui-badge', 'ui-badge--muted', dot && 'ui-badge--dot', className)}
                    title="По абонементу: деньги за эту бронь брать не нужно"
                >
                    {dot
                        ? <span className="ui-badge__dot" aria-hidden="true" />
                        : <Repeat size={14} strokeWidth={2.25} aria-hidden="true" />}
                    {statusLabel('payment', 'subscription', 'staff')}
                </span>
            );
        }
        return null;
    }
    // Ещё не списана, но баланса хватает — «◌ с баланса» (не «оплачено»: денег ещё не брали).
    if (charged === false) {
        return (
            <span
                data-due-mark="covered"
                className={clsx('ui-badge', 'ui-badge--muted', dot && 'ui-badge--dot', className)}
                title={COVERED_BADGE_HINT}
            >
                {dot
                    ? <span className="ui-badge__dot" aria-hidden="true" />
                    : <CircleDashed size={14} strokeWidth={2.25} aria-hidden="true" />}
                {statusLabel('payment', 'covered', 'staff')}
            </span>
        );
    }
    // Уже списана с баланса, долга на ней нет — «✓ оплачено».
    return (
        <span
            data-due-mark="paid"
            className={clsx('ui-badge', 'ui-badge--ok', dot && 'ui-badge--dot', className)}
            title={PAID_HINT}
        >
            {dot
                ? <span className="ui-badge__dot" aria-hidden="true" />
                : <Check size={14} strokeWidth={2.25} aria-hidden="true" />}
            {paidLabel}
        </span>
    );
}
