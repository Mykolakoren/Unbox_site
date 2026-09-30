import { AlertCircle, RotateCw } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button';
import { formatTime } from '../../utils/format';

/**
 * ErrorBar — «не удалось загрузить» (wave 1, 30.09).
 *
 * Правило: ошибка загрузки ≠ «пусто». Если запрос упал, экран не рисует
 * «броней нет» и «0 ₾», а показывает эту полосу. Хорошие данные при ошибке
 * НЕ затираются: передайте staleAt — время, когда они были свежими, и полоса
 * станет янтарной «Показаны данные на 14:05».
 *
 *   {error && <ErrorBar onRetry={refetch} retrying={isFetching} staleAt={data ? updatedAt : undefined} />}
 */
export interface ErrorBarProps {
    onRetry?: () => void;
    retrying?: boolean;
    /** Что не загрузилось. По умолчанию «Не удалось загрузить». */
    message?: string;
    /** Когда данные на экране были получены (если они есть). */
    staleAt?: Date | string | number;
    className?: string;
}

export function ErrorBar({ onRetry, retrying = false, message = 'Не удалось загрузить', staleAt, className }: ErrorBarProps) {
    const stale = staleAt !== undefined && staleAt !== null;
    return (
        <div
            role="alert"
            className={clsx('ui-errorbar', stale ? 'ui-errorbar--pending' : 'ui-errorbar--danger', className)}
        >
            <AlertCircle size={18} aria-hidden="true" style={{ flex: 'none' }} />
            <div className="ui-errorbar__text">
                <span className="ui-errorbar__title">{message}</span>
                {stale && <span> · Показаны данные на <span className="tabular-nums">{formatTime(staleAt)}</span></span>}
            </div>
            {onRetry && (
                <Button
                    variant="quiet"
                    className="ui-errorbar__retry"
                    onClick={onRetry}
                    loading={retrying}
                    icon={<RotateCw size={16} aria-hidden="true" />}
                >
                    Повторить
                </Button>
            )}
        </div>
    );
}
