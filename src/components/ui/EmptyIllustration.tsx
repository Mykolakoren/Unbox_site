/**
 * Спокойные линейные картинки для EmptyState (09.11): кресло, растение,
 * чашка, дверь — предметы кабинета, а не «ошибка 404». Штрих 1.5 px цветом
 * родителя (ink-40 в .ui-empty__art), одна мягкая заливка sunken. Своих
 * цветов нет — работают в обеих темах. Только для пустых экранов.
 */
export type EmptyArt = 'chair' | 'plant' | 'cup' | 'door';

const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};
const soft = { fill: 'var(--color-sunken)', stroke: 'none' };

export function EmptyIllustration({ art }: { art: EmptyArt }) {
    return (
        <svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">
            <ellipse cx="60" cy="102" rx="40" ry="5" {...soft} />
            {art === 'chair' && (
                <g {...common}>
                    <rect x="30" y="28" width="60" height="48" rx="14" fill="var(--color-sunken)" />
                    <rect x="22" y="56" width="16" height="30" rx="8" />
                    <rect x="82" y="56" width="16" height="30" rx="8" />
                    <rect x="36" y="66" width="48" height="18" rx="6" />
                    <path d="M33 86l-2 12M87 86l2 12" />
                </g>
            )}
            {art === 'plant' && (
                <g {...common}>
                    <path d="M60 74V40" />
                    <path d="M60 58c-12-2-19-11-17-22 10 2 17 10 17 22z" fill="var(--color-sunken)" />
                    <path d="M60 50c12-2 19-11 17-22-10 2-17 10-17 22z" />
                    <path d="M60 68c10 0 17-6 19-14-10 0-17 6-19 14z" />
                    <rect x="40" y="74" width="40" height="8" rx="3" />
                    <path d="M44 82h32l-4 18H48z" />
                </g>
            )}
            {art === 'cup' && (
                <g {...common}>
                    <ellipse cx="60" cy="94" rx="34" ry="6" />
                    <path d="M36 58h44v14c0 12-10 20-22 20s-22-8-22-20z" fill="var(--color-sunken)" />
                    <path d="M80 63c11 0 11 15 0 15" />
                    <path d="M50 48c-4-6 4-10 0-16M62 48c-4-6 4-10 0-16" />
                </g>
            )}
            {art === 'door' && (
                <g {...common}>
                    <path d="M38 100V22h44v78" />
                    <rect x="44" y="28" width="32" height="72" fill="var(--color-sunken)" />
                    <rect x="50" y="36" width="20" height="22" rx="2" />
                    <rect x="50" y="66" width="20" height="24" rx="2" />
                    <circle cx="71" cy="62" r="2" />
                    <path d="M24 100h72" />
                </g>
            )}
        </svg>
    );
}
