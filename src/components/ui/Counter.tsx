import type { CSSProperties } from 'react';
import clsx from 'clsx';

/**
 * Counter — один вид счётчика во всём приложении (09.11 фаза 3; был
 * AdminCounter в мобильной админке, admin-design №14): круг 18 px, цифра
 * 12/600, обводка 2 px цветом фона (--counter-ring, по умолчанию card).
 *
 *   tone="danger" — «требует внимания» (заявки, анкеты на проверке): danger-solid;
 *   tone="accent" — новости (колокольчик уведомлений): бирюза, не «долг».
 *
 * 0 и меньше — не рисуется; больше 99 — «99+». label — для диктора, если
 * число стоит само по себе (иначе счётчик скрыт от диктора: число уже в
 * aria-label кнопки/вкладки).
 */
export interface CounterProps {
    value: number;
    tone?: 'danger' | 'accent';
    label?: string;
    className?: string;
    style?: CSSProperties;
}

export function Counter({ value, tone = 'danger', label, className, style }: CounterProps) {
    if (!(value > 0)) return null;
    return (
        <span
            className={clsx('ui-counter', tone === 'accent' && 'ui-counter--accent', className)}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            style={style}
        >
            {value > 99 ? '99+' : value}
        </span>
    );
}
