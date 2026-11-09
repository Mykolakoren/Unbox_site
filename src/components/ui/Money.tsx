import clsx from 'clsx';
import { formatMoney, type MoneyOptions } from '../../utils/format';

/**
 * Money — сумма ровными цифрами (Plex Sans, tabular-nums): «1 250 ₾».
 * Цифры в столбцах не прыгают, знак лари не отрывается от числа, сумма
 * не переносится. Все суммы на экранах — только через Money (и в кнопках:
 * «Оплата · <Money value={120} inline />»).
 *
 *   <Money value={balance} />                    → «1 250 ₾» (цвет от родителя)
 *   <Money value={x} currency="USD" />           → «35 $»
 *
 * ОДНО правило цвета денег (tone, 09.11):
 *
 *   tone="flow"    — движение денег (касса, лента баланса, итоги дня).
 *                    Знак по умолчанию: «+9 ₾» / «−35 ₾» (настоящий минус −).
 *                    приход > 0 → зелёный ok; расход < 0 → чернила ink
 *                    (НЕ красный: красный только у долга); 0 → серый ink-60.
 *   tone="balance" — остаток / баланс: минус → danger (это долг), 0 → серый,
 *                    плюс → обычный цвет.
 *   tone="debt"    — сумма долга / «к оплате» (положительное число = должны):
 *                    > 0 → danger, 0 → серый. Долг ВСЕГДА danger, никогда не янтарь.
 *   без tone       — цвет от родителя (заголовки, кнопки, итоги).
 *
 *   <Money value={+9} tone="flow" />            → «+9 ₾» зелёным
 *   <Money value={-35} tone="flow" />           → «−35 ₾» чернилами
 *   <Money value={-12.5} tone="balance" />      → «−12,5 ₾» красным
 *   <Money value={120} tone="debt" />           → «120 ₾» красным
 *   <Money value={0} tone="balance" />          → «0 ₾» серым, обычным весом
 *
 * signed — «+» у положительных (у flow включён по умолчанию; signed={false} — выключить).
 * inline — число внутри фразы: шрифт и вес как у фразы, только ровные цифры
 *          («осталось <Money value={7} inline /> …»).
 */
export type MoneyTone = 'flow' | 'balance' | 'debt';

export interface MoneyProps extends MoneyOptions {
    value: number | string | null | undefined;
    tone?: MoneyTone;
    /** «+» у положительных. По умолчанию — да у tone="flow", иначе нет. */
    signed?: boolean;
    /** Число внутри фразы (без своего шрифта, только ровные цифры). */
    inline?: boolean;
    className?: string;
}

function toNumber(v: MoneyProps['value']): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/** Класс тона для суммы — то же правило, если сумма рисуется не через <Money>. */
export function moneyToneClass(value: MoneyProps['value'], tone?: MoneyTone): string | undefined {
    if (!tone) return undefined;
    const n = toNumber(value);
    if (n === null) return undefined;
    // Ноль — по тому, что увидит человек: 0,004 ₾ выводится как «0 ₾».
    if (Math.round(Math.abs(n) * 100) === 0) return 'ui-money--zero';
    if (tone === 'flow') return n > 0 ? 'ui-money--in' : 'ui-money--out';
    if (tone === 'balance') return n < 0 ? 'ui-money--debt' : undefined;
    return 'ui-money--debt'; // debt: любая ненулевая сумма долга
}

export function Money({ value, tone, signed, inline = false, sign, className, ...opts }: MoneyProps) {
    const withSign = signed ?? sign ?? tone === 'flow';
    return (
        <span className={clsx(inline ? 'num-inline' : 'num', 'ui-money', moneyToneClass(value, tone), className)}>
            {formatMoney(value, { ...opts, sign: withSign })}
        </span>
    );
}
