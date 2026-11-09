import type { ReactNode } from 'react';
import clsx from 'clsx';

/**
 * SummaryCard — «итог» экрана (09.11): одна карточка с главным числом.
 * Абонемент («7 ч из 10»), бонусы, баланс, «Сейчас в кассе», сводка дня
 * админа. Раньше одно и то же «сколько у меня осталось» было чёрной плитой,
 * серой плашкой и строкой списка.
 *
 *   <SummaryCard
 *     label="Абонемент"
 *     value={<span className="num">7</span>} unit="ч из 10"
 *     caption="Тёплый старт · до 12 декабря"
 *     aside={<Button variant="secondary" size="sm">Продлить</Button>}
 *   />
 *
 *   <SummaryCard label="Сегодня" stats={[
 *     { label: 'Взять сегодня', value: <Money value={86} tone="debt" />, onClick: … },
 *     { label: 'Долги', value: <Money value={12.5} tone="debt" /> },
 *     { label: 'Срочные', value: 2 },
 *   ]} />
 *
 * Крупным — ОДНО число. Остальное — строкой caption или ячейками stats.
 * variant="panel" — тёмная плита (--color-panel), не больше одной на экран;
 * по умолчанию — обычная карточка.
 */
export interface SummaryStat {
    label: ReactNode;
    value: ReactNode;
    /** Ячейка ведёт на свой экран. */
    onClick?: () => void;
}

export interface SummaryCardProps {
    /** Подпись сверху (12/600 капсом): «Абонемент», «Баланс». */
    label?: ReactNode;
    /** Главное число: <Money/> или <span className="num">7</span>. */
    value?: ReactNode;
    /** Единица на той же линии, 20/500 ink-60: «ч из 10», «₾». */
    unit?: ReactNode;
    /** Строка под числом, 14 ink-60. */
    caption?: ReactNode;
    /** Справа от числа: тихая кнопка («Продлить», «Пополнить»). */
    aside?: ReactNode;
    /** Ячейки-показатели (2–4) под числом или вместо него. */
    stats?: SummaryStat[];
    /** md — число 28, lg — 40 (одно главное число экрана). */
    size?: 'md' | 'lg';
    variant?: 'card' | 'panel';
    className?: string;
    children?: ReactNode;
}

export function SummaryCard({
    label, value, unit, caption, aside, stats, size = 'md', variant = 'card', className, children,
}: SummaryCardProps) {
    return (
        <section className={clsx('ui-summary', variant === 'panel' && 'ui-summary--panel', size === 'lg' && 'ui-summary--lg', className)}>
            {(label || value !== undefined || aside) && (
                <div className="ui-summary__top">
                    <div className="ui-summary__main">
                        {label && <div className="ui-summary__label">{label}</div>}
                        {value !== undefined && (
                            <div className="ui-summary__value">
                                {value}
                                {unit && <span className="ui-summary__unit">{unit}</span>}
                            </div>
                        )}
                        {caption && <div className="ui-summary__caption">{caption}</div>}
                    </div>
                    {aside && <div className="ui-summary__aside">{aside}</div>}
                </div>
            )}
            {stats && stats.length > 0 && (
                <div className="ui-summary__stats" style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 4)}, minmax(0, 1fr))` }}>
                    {stats.map((s, i) => {
                        const inner = (
                            <>
                                <span className="ui-summary__stat-label">{s.label}</span>
                                <span className="ui-summary__stat-value">{s.value}</span>
                            </>
                        );
                        return s.onClick
                            ? <button key={i} type="button" className="ui-summary__stat" onClick={s.onClick}>{inner}</button>
                            : <div key={i} className="ui-summary__stat">{inner}</div>;
                    })}
                </div>
            )}
            {children}
        </section>
    );
}
