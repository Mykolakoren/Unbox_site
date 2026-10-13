/**
 * Защита от опечатки в сумме пополнения (13.10, Михаил Стефанович: через
 * «Принять оплату» внесли 2020 ₾ при долге 20 — в поле осталась лишняя «20»,
 * и окно записало без вопроса; в кассе Uni по карте повисли лишние 2000 ₾).
 *
 * Сумма подозрительно большая — переспросить, а не запрещать (предоплата
 * бывает). Ориентир — сколько ждали (подставленный долг или цена брони); без
 * ориентира — крупная сумма сама по себе.
 */
export const BIG_TOPUP_GEL = 500;

export function topupLooksLikeTypo(value: number, expected?: number | null): boolean {
    if (!(value > 0)) return false;
    const exp = expected && expected > 0 ? expected : 0;
    if (exp > 0) return value >= Math.max(exp * 5, exp + 100);
    return value >= BIG_TOPUP_GEL;
}

/** Текст вопроса: «Вы вносите 2 020 ₾, а ждали 20 ₾. Точно 2 020?» */
export function topupTypoQuestion(value: number, expected: number | null | undefined, fmt: (n: number) => string): string {
    const exp = expected && expected > 0 ? expected : 0;
    return exp > 0
        ? `Вы вносите ${fmt(value)}, а к оплате ${fmt(exp)}. Проверьте сумму — точно ${fmt(value)}?`
        : `Сумма ${fmt(value)} — больше обычной. Проверьте — точно ${fmt(value)}?`;
}
