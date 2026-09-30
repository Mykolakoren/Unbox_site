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
 * MobilePageHeader — внутри /m: липкая строка 56 px — «←» (44×44), заголовок
 * 20 px, одно действие справа. Стрелка ТОЛЬКО возвращает назад (раздел
 * переключается подписанной кнопкой, не стрелкой). Если истории нет
 * (открыли по ссылке из Telegram) — уходит на fallbackTo.
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
    /** Показать «←». По умолчанию да. */
    back?: boolean;
    /** Куда уйти, если истории нет. */
    fallbackTo?: string;
    onBack?: () => void;
    /** Одно действие справа (кнопка 44×44 или короткая тихая кнопка). */
    action?: ReactNode;
    className?: string;
}

export function MobilePageHeader({
    title, back = true, fallbackTo = '/m', onBack, action, className,
}: MobilePageHeaderProps) {
    const goBack = useBack(fallbackTo, onBack);
    return (
        <header className={clsx('ui-m-header', className)}>
            {back && (
                <button type="button" className="ui-btn ui-btn--quiet ui-btn--touch ui-btn--icon" onClick={goBack} aria-label="Назад">
                    <ArrowLeft size={22} aria-hidden="true" />
                </button>
            )}
            <h1 className="ui-m-header__title">{title}</h1>
            {action && <div className="ui-m-header__slot">{action}</div>}
        </header>
    );
}
