import type { ReactNode } from 'react';
import clsx from 'clsx';
import { Button } from './Button';
import { EmptyIllustration, type EmptyArt } from './EmptyIllustration';

/**
 * EmptyState — «здесь пока пусто, и вот что сделать» (wave 1, 30.09; 09.11 —
 * картинка и второе действие).
 *
 * Показывать ТОЛЬКО после успешной загрузки, когда данных правда нет.
 * Пока грузится — Skeleton; если не загрузилось — ErrorBar.
 *
 * Текст — тепло и по делу, от «мы»/«у вас», без «Нет данных», «Пусто», «0»:
 *   title — что человек видит, спокойно: «Будущих броней пока нет»,
 *           «Сегодня свободный день», «Долгов нет — всё оплачено».
 *   hint  — что сделать и сколько это займёт: «Выберите свободное время —
 *           займёт минуту».
 *   action — одно главное действие («Найти время»); secondaryAction — тихое
 *           второе («Показать задачи команды · 7»).
 *
 * Картинка: illustration="chair" | "plant" | "cup" | "door" — спокойная
 * линейная картинка 120 px (80 в compact) для пустых экранов целиком;
 * или своя ReactNode. Мелкий значок Lucide — icon (24–32 px), для пустых
 * блоков внутри экрана. Одно из двух, не оба.
 */
const EMPTY_ARTS = ['chair', 'plant', 'cup', 'door'] as const;

interface Props {
    /** Короткая фраза — что человек видит. */
    title: string;
    /** Вторая строка — что с этим сделать. */
    hint?: string;
    /** Действие. Не добавляйте, если делать нечего. variant (09.11 фаза 3):
     *  primary — по умолчанию; secondary — если главная кнопка экрана уже есть
     *  в шапке («+ Сессия», «+ Клиент»): одна главная на экран. */
    action?: { label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'quiet' };
    /** Второе, тихое действие. */
    secondaryAction?: { label: string; onClick: () => void };
    /** Небольшой значок Lucide (24–32 px) — для пустого блока внутри экрана. */
    icon?: ReactNode;
    /** Спокойная картинка для пустого экрана: готовая (chair/plant/cup/door) или своя. */
    illustration?: EmptyArt | ReactNode;
    /** Меньше отступов — внутри шторки или маленькой карточки. */
    compact?: boolean;
    className?: string;
}

export function EmptyState({ title, hint, action, secondaryAction, icon, illustration, compact, className }: Props) {
    const art = typeof illustration === 'string' && (EMPTY_ARTS as readonly string[]).includes(illustration)
        ? <EmptyIllustration art={illustration as EmptyArt} />
        : illustration;
    return (
        <div className={clsx('ui-empty', compact && 'ui-empty--compact', className)}>
            {art
                ? <div className="ui-empty__art" aria-hidden="true">{art}</div>
                : icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
            <p className="ui-empty__title">{title}</p>
            {hint && <p className="ui-empty__hint">{hint}</p>}
            {(action || secondaryAction) && (
                <div className="ui-empty__actions">
                    {action && (
                        <Button variant={action.variant ?? 'primary'} className="ui-empty__action" onClick={action.onClick}>
                            {action.label}
                        </Button>
                    )}
                    {secondaryAction && (
                        <Button variant="quiet" onClick={secondaryAction.onClick}>
                            {secondaryAction.label}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
