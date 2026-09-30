import type { LoadStatus } from '../../store/types';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { COLOR, TEXT } from '../../design/tokens';

/**
 * Честные состояния загрузки для клиентских экранов /m.
 *
 * Раньше, пока брони грузились или когда запрос падал, экраны писали
 * «броней нет» — клиент думал, что бронь слетела. Теперь три разных
 * состояния: заглушки (грузим), ошибка с «Повторить», и настоящее «пусто».
 *
 * Wave 1 (30.09): те же три функции, но поверх общих SkeletonList / ErrorBar
 * из дизайн-системы — экраны /m выглядят так же, как CRM и админка.
 * API прежний, вызовы на экранах не менялись. Пустое состояние — общий
 * EmptyState прямо на экране.
 */

/** Карточки-заглушки по форме строки брони (общий SkeletonList).
 *  height — высота одной карточки. */
export function SkeletonRows({ count = 3, height = 58 }: { count?: number; height?: number }) {
    return <SkeletonList count={count} cardHeight={height} label="Загружаем" />;
}

/** Ошибка, когда показать нечего: полоса «не удалось» с «Повторить»
 *  и под ней одна спокойная строка пояснения. */
export function LoadErrorCard({ title, text, onRetry }: {
    title: string;
    text: string;
    onRetry: () => void;
}) {
    return (
        <div>
            <ErrorBar message={title} onRetry={onRetry} />
            {text && (
                <p style={{ margin: '8px 4px 0', fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink60 }}>
                    {text}
                </p>
            )}
        </div>
    );
}

/** Полоса над списком, когда на экране данные прошлой удачной загрузки:
 *  «Не удалось обновить · Показаны данные на 14:32 · Повторить». Пока идёт
 *  повтор — та же полоса, у кнопки крутится значок (полоса не мигает). */
export function StaleBar({ status, loadedAt, onRetry }: {
    status: LoadStatus;
    loadedAt: number | null;
    onRetry: () => void;
}) {
    if (status === 'ready' || status === 'idle' || loadedAt == null) return null;
    return (
        <ErrorBar
            message="Не удалось обновить"
            staleAt={loadedAt}
            onRetry={onRetry}
            retrying={status === 'loading'}
            className="mb-2"
        />
    );
}
