import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button';

/**
 * EmptyState — «здесь пока пусто, и вот что сделать» (wave 1, 30.09).
 *
 * Показывать ТОЛЬКО после успешной загрузки, когда данных правда нет.
 * Пока грузится — Skeleton; если не загрузилось — ErrorBar.
 *
 * Текст — что человек видит + что делать: «Будущих броней пока нет» /
 * «Выберите свободное время — займёт минуту» + кнопка «Найти время».
 *
 * Wave 1: убрана моно-метка «ПУСТО» цветом ink30 (контраст 2:1) и пунктирная
 * рамка; кнопка — общий Button. API прежний (title, hint, action, icon, compact).
 */
interface Props {
    /** Короткая фраза — что человек видит. */
    title: string;
    /** Вторая строка — что с этим сделать. */
    hint?: string;
    /** Главное действие. Не добавляйте, если делать нечего. */
    action?: { label: string; onClick: () => void };
    /** Небольшой значок Lucide (24–32 px). */
    icon?: ReactNode;
    /** Меньше отступов — внутри шторки или маленькой карточки. */
    compact?: boolean;
    className?: string;
}

export function EmptyState({ title, hint, action, icon, compact, className }: Props) {
    return (
        <div className={clsx('ui-empty', compact && 'ui-empty--compact', className)}>
            {icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
            <p className="ui-empty__title">{title}</p>
            {hint && <p className="ui-empty__hint">{hint}</p>}
            {action && (
                <Button variant="primary" className="ui-empty__action" onClick={action.onClick}>
                    {action.label}
                </Button>
            )}
        </div>
    );
}
