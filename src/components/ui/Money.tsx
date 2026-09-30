import clsx from 'clsx';
import { formatMoney, type MoneyOptions } from '../../utils/format';

/**
 * Money — сумма моно-цифрами (Plex Mono, tabular-nums): «1 250 ₾».
 * Цифры в столбцах не прыгают, знак лари не отрывается от числа.
 *
 *   <Money value={balance} />            → «1 250 ₾»
 *   <Money value={+20} sign />           → «+20 ₾»
 *   <Money value={x} currency="USD" />   → «35 $»
 */
export interface MoneyProps extends MoneyOptions {
    value: number | string | null | undefined;
    className?: string;
}

export function Money({ value, className, ...opts }: MoneyProps) {
    return <span className={clsx('num', className)}>{formatMoney(value, opts)}</span>;
}
