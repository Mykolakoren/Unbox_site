/**
 * Подписи причин движения баланса (UserBalanceLedger.reason) — по-русски.
 *
 * Вынесено из components/admin/UserBalanceLedger.tsx (волна 4, шаг 0), чтобы
 * карточка клиента на телефоне показывала «Движения баланса» теми же словами.
 * Неизвестная причина — «Прочее (код)», как в ленте баланса.
 */
export const REASON_LABELS: Record<string, string> = {
    topup: 'Пополнение',
    baseline: 'Стартовый остаток',
    booking_charge: 'Списание за бронь',
    booking_refund: 'Возврат за бронь',
    booking_charge_revert: 'Откат списания',
    extend_charge: 'Доплата за продление',
    extras_charge: 'Допы',
    shorten_refund: 'Возврат за сокращение',
    weekly_rebate: 'Недельная скидка',
    consecutive_recompute: 'Пересчёт «часы подряд»',
    correction: 'Ручная корректировка',
    merge: 'Перенос со склеенного профиля',
    subscription_purchase: 'Оплата абонемента',
    booking_to_subscription: 'Бронь переведена на абонемент',
    double_charge_refund: 'Возврат двойного списания',
    // Причины, которые сервер пишет, а подписи не было — в колонке стоял
    // английский код (аудит 29.09, X3-10).
    price_change: 'Изменение цены брони',
    reschedule_diff: 'Разница при переносе',
    format_change: 'Смена формата брони',
    trim_booking: 'Сокращение брони',
    trim_refund: 'Возврат за сокращение',
    extras_refund: 'Возврат за допы',
    topup_adjust: 'Правка пополнения',
    topup_reversal: 'Отмена пополнения',
};
