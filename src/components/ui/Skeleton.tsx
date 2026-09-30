import type { CSSProperties } from 'react';
import clsx from 'clsx';
import { RADIUS } from '../../design/tokens';

/**
 * Skeleton — заглушка «ещё грузится» по форме будущего контента (wave 1).
 *
 * Правило: пока данные не пришли, НЕ показываем «броней нет» / «0 ₾» —
 * показываем силуэты. Пустое состояние — только после ответа сервера.
 * Спокойная пульсация без бегущего блика; при «уменьшить движение» — статично.
 * Сам скелетон скрыт от диктора; область, где он стоит, пометьте
 * aria-busy="true" — или используйте SkeletonList, он делает это сам.
 */
export interface SkeletonProps {
    width?: number | string;
    height?: number | string;
    radius?: number;
    className?: string;
    style?: CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, radius = RADIUS.control, className, style }: SkeletonProps) {
    return (
        <span
            aria-hidden="true"
            className={clsx('skeleton', className)}
            style={{ display: 'block', width, height, borderRadius: radius, ...style }}
        />
    );
}

/** Несколько строк текста; последняя короче — похоже на абзац. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
    return (
        <span aria-hidden="true" className={className} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: lines }, (_, i) => (
                <Skeleton key={i} height={12} width={i === lines - 1 && lines > 1 ? '60%' : '100%'} />
            ))}
        </span>
    );
}

/**
 * Список карточек-заглушек (брони, сессии, операции кассы).
 * label — что грузим, для диктора: «Загружаем брони».
 */
export function SkeletonList({ count = 3, label = 'Загружаем', cardHeight = 76 }: { count?: number; label?: string; cardHeight?: number }) {
    return (
        <div role="status" aria-busy="true" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="sr-only">{label}…</span>
            {Array.from({ length: count }, (_, i) => (
                <div
                    key={i}
                    aria-hidden="true"
                    style={{
                        display: 'flex', gap: 12, alignItems: 'center', padding: 16,
                        minHeight: cardHeight, borderRadius: RADIUS.sheet,
                        border: '1px solid var(--color-ink-08)', background: 'var(--color-card)',
                    }}
                >
                    <Skeleton width={44} height={44} radius={RADIUS.control} />
                    <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <Skeleton height={14} width="55%" />
                        <Skeleton height={12} width="35%" />
                    </span>
                </div>
            ))}
        </div>
    );
}
