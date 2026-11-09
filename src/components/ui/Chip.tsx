import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

/**
 * Chip — переключатель-фильтр (wave 1, 30.09; 09.11 — без галочки).
 * Высота 44 px на телефоне.
 *
 * Выбранный — ОДИН язык «выбрано» на всё приложение (как ChoiceCard и
 * Segmented): подложка accent-soft, рамка accent 1.5 px, текст accent-ink 600.
 * Галочки нет: она добавляла ~24 px, и ряд фильтров переносился или
 * обрезался. Выбранное отличается не только цветом (рамка + вес), а для
 * диктора — aria-pressed. Чёрной заливки для «выбрано» нет.
 *
 *   <div className="ui-chip-row" role="group" aria-label="Филиал">
 *     <Chip selected={loc === 'one'} onClick={() => setLoc('one')}>Unbox One</Chip>
 *   </div>
 *
 * Ряд, который листается вбок, — className="ui-chip-row ui-chip-row--scroll"
 * (затухание справа подсказывает, что есть ещё).
 */
export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
    selected?: boolean;
    /** Значок слева — одинаковый в обоих состояниях (ширина не прыгает). */
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
            {icon}
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
