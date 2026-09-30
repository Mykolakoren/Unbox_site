import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

/**
 * Button — общая кнопка дизайн-системы (wave 1, 30.09).
 *
 * Варианты:
 *   primary   — главное действие экрана (бирюза Unbox). Одно на экран/шторку.
 *   secondary — второе действие («Оставить», «Отмена»): тонкая рамка.
 *   quiet     — третье, «тихое»: без рамки и заливки.
 *   danger    — необратимое («Удалить», «Отменить 6 броней»).
 *
 * Размер по умолчанию — из плотности (--control-h): 44 px на телефоне и в /m,
 * 36 px на компьютере. size="touch" / "compact" — задать явно.
 *
 * Текст называет действие: «Пополнить на 20 ₾», а не «ОК» и не «Да».
 *
 * loading — пока идёт запрос: кнопка заблокирована (повторный тап не
 * отправит второй запрос), рядом со словом крутится значок, ширина не прыгает.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: 'auto' | 'touch' | 'compact';
    /** Растянуть на всю ширину (главная кнопка в шторке на телефоне). */
    block?: boolean;
    loading?: boolean;
    /** Значок Lucide слева от текста. Во время loading заменяется спиннером. */
    icon?: ReactNode;
    /** Значок справа (стрелка «→» и т.п.). */
    iconRight?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
    {
        variant = 'primary',
        size = 'auto',
        block = false,
        loading = false,
        icon,
        iconRight,
        disabled,
        className,
        children,
        type = 'button',
        ...rest
    },
    ref,
) {
    const iconOnly = !children && !!(icon || iconRight);
    return (
        <button
            ref={ref}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={clsx(
                'ui-btn',
                `ui-btn--${variant}`,
                size !== 'auto' && `ui-btn--${size}`,
                block && 'ui-btn--block',
                iconOnly && 'ui-btn--icon',
                className,
            )}
            {...rest}
        >
            {loading
                ? <Loader2 size={18} className="ui-spin" aria-hidden="true" />
                : icon}
            {children}
            {!loading && iconRight}
        </button>
    );
});
