import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import clsx from 'clsx';

/**
 * ChoiceCard — выбираемая карточка (09.11): способ оплаты («Абонемент ·
 * осталось 7 ч»), тип помещения, вариант в фильтрах. Для коротких слов в
 * ряд с переносом — Chip, для 2–4 вариантов в строку — Segmented.
 *
 * «Выбрано» — тот же язык, что у Chip: подложка accent-soft, рамка accent
 * 1.5 px, название accent-ink. Справа кружок-отметка 20 px есть всегда
 * (пустой / бирюзовый с галочкой), поэтому ширина не прыгает. Чёрной
 * заливки нет — в тёмной теме она становилась белым пятном.
 * Скругление 8 (это элемент управления, как поле и чип).
 *
 *   <ChoiceGroup label="Чем платите" columns={1}>
 *     <ChoiceCard selected={m === 'sub'} onClick={() => setM('sub')}
 *                 icon={<Ticket size={20} />} title="Абонемент"
 *                 description="Осталось 7 ч из 10" />
 *     <ChoiceCard selected={m === 'balance'} onClick={() => setM('balance')}
 *                 icon={<Wallet size={20} />} title="Баланс" trail={<Money value={245} />} />
 *   </ChoiceGroup>
 *
 *   // Плитки в ряд (отметка в углу только у выбранной):
 *   <ChoiceGroup label="Помещение" columns={3}>
 *     <ChoiceCard layout="tile" icon={<DoorOpen size={20} />} title="Кабинет" … />
 *   </ChoiceGroup>
 *
 * Состояние для диктора — aria-pressed (как у Chip).
 */
export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title' | 'onChange'> {
    selected?: boolean;
    title: ReactNode;
    /** Вторая строка: «Осталось 7 ч из 10», адрес. Переносится, не режется. */
    description?: ReactNode;
    /** Значок Lucide 20 px слева (в плитке — сверху). */
    icon?: ReactNode;
    /** Справа: сумма, остаток. Не переносится. */
    trail?: ReactNode;
    /** row — строка во всю ширину (по умолчанию); tile — плитка для 2–3 в ряд. */
    layout?: 'row' | 'tile';
}

export const ChoiceCard = forwardRef<HTMLButtonElement, ChoiceCardProps>(function ChoiceCard(
    { selected = false, title, description, icon, trail, layout = 'row', className, type = 'button', ...rest },
    ref,
) {
    const tile = layout === 'tile';
    return (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={clsx('ui-choice', tile && 'ui-choice--tile', className)}
            {...rest}
        >
            {icon && <span className="ui-choice__icon" aria-hidden="true">{icon}</span>}
            <span className="ui-choice__body">
                <span className="ui-choice__title">{title}</span>
                {description && <span className="ui-choice__desc">{description}</span>}
            </span>
            {trail && !tile && <span className="ui-choice__trail">{trail}</span>}
            <span className="ui-choice__mark" aria-hidden="true">
                {selected && <Check size={tile ? 12 : 14} strokeWidth={3} />}
            </span>
        </button>
    );
});

export interface ChoiceGroupProps {
    /** Что выбираем — для диктора («Чем платите»). */
    label: string;
    /** Колонок в ряд: 1 — список карточек, 2–3 — плитки. */
    columns?: 1 | 2 | 3;
    children: ReactNode;
    className?: string;
}

/** Обёртка для набора ChoiceCard: сетка с отступом 8 и подпись для диктора. */
export function ChoiceGroup({ label, columns = 1, children, className }: ChoiceGroupProps) {
    return (
        <div
            role="group"
            aria-label={label}
            className={clsx('ui-choice-grid', className)}
            style={{ '--choice-cols': columns } as CSSProperties}
        >
            {children}
        </div>
    );
}
