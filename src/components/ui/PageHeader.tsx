import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';

/**
 * Шапки экранов (wave 1, 30.09).
 *
 * PageHeader — компьютер (Grid House): «← Назад» (по желанию), заголовок
 * 28 px, пояснение ink-60, действия справа, снизу тонкая линия.
 *
 * MobilePageHeader — внутри /m, два вида (09.11):
 *   variant="bar" (по умолчанию) — внутренний экран: липкая строка 56 px —
 *     «←» (44×44), заголовок 20 px, подзаголовок 14 (по желанию), одно
 *     действие справа.
 *   variant="large" — корень раздела (Сегодня, Клиенты, Сессии, Финансы,
 *     Касса…): заголовок 28/600, подзаголовок 14 ink-60, действие справа
 *     (единственная главная кнопка экрана — Button primary), поля 16.
 *     «←» по умолчанию нет; если back — строкой над заголовком.
 * Стрелка ТОЛЬКО возвращает назад (раздел переключается подписанной кнопкой,
 * не стрелкой). Если истории нет (открыли по ссылке из Telegram) — уходит на
 * fallbackTo. Подзаголовок не повторяет заголовок и не пишет «Всего: 8 ·
 * показано: 8» — только полезное («4 сотрудника», «Найдено 3»).
 */

/** Назад по истории, а если её нет — на запасной адрес. */
function useBack(fallbackTo: string, onBack?: () => void) {
    const navigate = useNavigate();
    return () => {
        if (onBack) { onBack(); return; }
        // react-router кладёт в history.state порядковый номер записи (idx).
        const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        if (idx > 0) navigate(-1);
        else navigate(fallbackTo, { replace: true });
    };
}

export interface PageHeaderProps {
    title: ReactNode;
    description?: ReactNode;
    /** Показать «← Назад». */
    back?: boolean;
    backLabel?: string;
    backTo?: string;
    onBack?: () => void;
    actions?: ReactNode;
    className?: string;
}

export function PageHeader({
    title, description, back = false, backLabel = 'Назад', backTo = '/', onBack, actions, className,
}: PageHeaderProps) {
    const goBack = useBack(backTo, onBack);
    return (
        <header className={clsx('ui-page-header', className)}>
            <div className="ui-page-header__main">
                {back && (
                    <button type="button" className="ui-page-header__back" onClick={goBack}>
                        <ArrowLeft size={16} aria-hidden="true" />
                        {backLabel}
                    </button>
                )}
                <h1 className="ui-page-header__title">{title}</h1>
                {description && <p className="ui-page-header__desc">{description}</p>}
            </div>
            {actions && <div className="ui-page-header__actions">{actions}</div>}
        </header>
    );
}

export interface MobilePageHeaderProps {
    title: ReactNode;
    /** Строка под заголовком, 14 ink-60. */
    subtitle?: ReactNode;
    /** bar — внутренний экран (липкая строка, 20 px); large — корень раздела (28 px). */
    variant?: 'bar' | 'large';
    /** Показать «←». По умолчанию: да у bar, нет у large. */
    back?: boolean;
    /** Куда уйти, если истории нет. */
    fallbackTo?: string;
    onBack?: () => void;
    /** Одно действие справа (кнопка 44×44, короткая тихая кнопка; у large —
     *  главная кнопка экрана, например «+ Сессия»). */
    action?: ReactNode;
    className?: string;
}

export function MobilePageHeader({
    title, subtitle, variant = 'bar', back, fallbackTo = '/m', onBack, action, className,
}: MobilePageHeaderProps) {
    const goBack = useBack(fallbackTo, onBack);
    const showBack = back ?? variant === 'bar';
    const backButton = showBack && (
        <button type="button" className="ui-btn ui-btn--quiet ui-btn--touch ui-btn--icon" onClick={goBack} aria-label="Назад">
            <ArrowLeft size={22} aria-hidden="true" />
        </button>
    );

    if (variant === 'large') {
        return (
            <header className={clsx('ui-m-header-lg', className)}>
                {backButton && <div className="ui-m-header-lg__top">{backButton}</div>}
                <div className="ui-m-header-lg__row">
                    <div className="ui-m-header-lg__titles">
                        <h1 className="ui-m-header-lg__title">{title}</h1>
                        {subtitle && <p className="ui-m-header-lg__sub">{subtitle}</p>}
                    </div>
                    {action && <div className="ui-m-header-lg__slot">{action}</div>}
                </div>
            </header>
        );
    }

    return (
        <header className={clsx('ui-m-header', className)}>
            {backButton}
            {subtitle ? (
                <div className="ui-m-header__titles">
                    <h1 className="ui-m-header__title">{title}</h1>
                    <p className="ui-m-header__sub">{subtitle}</p>
                </div>
            ) : (
                <h1 className="ui-m-header__title">{title}</h1>
            )}
            {action && <div className="ui-m-header__slot">{action}</div>}
        </header>
    );
}
