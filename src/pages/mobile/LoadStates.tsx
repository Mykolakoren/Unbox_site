import { Loader2, RefreshCw } from 'lucide-react';
import type { LoadStatus } from '../../store/types';

/**
 * Честные состояния загрузки для клиентских экранов /m.
 *
 * Раньше, пока брони грузились или когда запрос падал, экраны писали
 * «броней нет» — клиент думал, что бронь слетела. Теперь три разных
 * состояния: заглушки (грузим), ошибка с «Повторить», и настоящее «пусто».
 */

/** Серые карточки-заглушки по форме строки брони. Мягкая пульсация
 *  отключается глобальным правилом prefers-reduced-motion. */
export function SkeletonRows({ count = 3, height = 58 }: { count?: number; height?: number }) {
    return (
        <div aria-busy="true" aria-label="Загружаем" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    className="animate-pulse"
                    style={{ background: '#F4F4F2', borderRadius: 14, height }}
                />
            ))}
        </div>
    );
}

/** Ошибка, когда показать нечего: короткое объяснение и «Повторить». */
export function LoadErrorCard({ title, text, onRetry }: {
    title: string;
    text: string;
    onRetry: () => void;
}) {
    return (
        <div role="alert" style={{
            background: '#F4F4F2',
            borderRadius: 14,
            padding: 18,
            textAlign: 'center',
            color: '#444',
            fontSize: 14,
            lineHeight: 1.4,
        }}>
            <div style={{ fontWeight: 700, color: '#0E0E0E' }}>{title}</div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{text}</div>
            <button
                onClick={onRetry}
                style={{
                    marginTop: 12,
                    background: '#0E0E0E',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 18px',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                }}
            >
                <RefreshCw size={14} /> Повторить
            </button>
        </div>
    );
}

/** Плашка над списком, когда на экране данные прошлой удачной загрузки:
 *  «Не удалось обновить · данные на 14:32 · Повторить» или «Обновляем…». */
export function StaleBar({ status, loadedAt, onRetry }: {
    status: LoadStatus;
    loadedAt: number | null;
    onRetry: () => void;
}) {
    if (status === 'ready' || status === 'idle' || loadedAt == null) return null;
    const time = new Date(loadedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const retrying = status === 'loading';
    return (
        <div role="status" style={{
            background: '#FEF3C7',
            border: '1px solid #FCD34D',
            color: '#8A5A00',
            borderRadius: 12,
            padding: '8px 12px',
            marginBottom: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            lineHeight: 1.35,
        }}>
            <span style={{ flex: 1 }}>
                {retrying ? 'Обновляем…' : `Не удалось обновить · данные на ${time}`}
            </span>
            {retrying ? (
                <Loader2 size={14} className="animate-spin" />
            ) : (
                <button
                    onClick={onRetry}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#8A5A00',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        padding: 0,
                        textDecoration: 'underline',
                    }}
                >
                    Повторить
                </button>
            )}
        </div>
    );
}
