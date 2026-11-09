import clsx from 'clsx';

/**
 * PageTabs — вкладки страницы (09.11 фаза 3, admin-design №8; перенесён из
 * мобильной админки): текст 16/600, выбранная — подчёркивание 2 px цветом
 * accent, без рамки и заливки. Так раздел экрана («Операции / Итоги дня /
 * Скидки») не путается с фильтром ниже (Segmented «День / Неделя / Месяц»).
 * Цель нажатия — 44 px; длинный ряд листается вбок.
 */
export interface PageTabsProps<T extends string> {
    options: { value: T; label: string }[];
    value: T;
    onChange: (v: T) => void;
    'aria-label': string;
    className?: string;
}

export function PageTabs<T extends string>({ options, value, onChange, className, ...aria }: PageTabsProps<T>) {
    return (
        <div role="tablist" aria-label={aria['aria-label']} className={clsx('ui-page-tabs', className)}>
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={o.value === value}
                    onClick={() => onChange(o.value)}
                    className="ui-page-tabs__tab"
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
