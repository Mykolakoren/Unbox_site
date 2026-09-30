import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';

/**
 * Chip — переключатель-фильтр (wave 1, 30.09). Высота 44 px на телефоне.
 * Выбранный — бирюза Unbox (подложка + рамка + вес + галочка), а не только
 * цвет; состояние озвучивается через aria-pressed.
 *
 *   <div className="ui-chip-row" role="group" aria-label="Филиал">
 *     <Chip selected={loc === 'one'} onClick={() => setLoc('one')}>Unbox One</Chip>
 *   </div>
 */
export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    selected?: boolean;
    icon?: ReactNode;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
    { selected = false, icon, className, children, type = 'button', ...rest },
    ref,
) {
    return (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={clsx('ui-chip', className)}
            {...rest}
        >
            {selected ? <Check size={16} strokeWidth={2.5} aria-hidden="true" /> : icon}
            {children}
        </button>
    );
});

/**
 * Segmented — выбор одного из 2–4 вариантов в одну строку («День / Неделя /
 * Месяц»). Для длинного списка — ряд Chip с переносом.
 */
export interface SegmentedOption<T extends string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
    options: SegmentedOption<T>[];
    value: T;
    onChange: (value: T) => void;
    /** Что выбираем — для экранного диктора («Период»). */
    'aria-label': string;
    className?: string;
}

export function Segmented<T extends string>({ options, value, onChange, className, ...aria }: SegmentedProps<T>) {
    return (
        <div role="group" aria-label={aria['aria-label']} className={clsx('ui-segmented', className)}>
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    className="ui-segmented__item"
                    aria-pressed={o.value === value}
                    disabled={o.disabled}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
