import { useSyncExternalStore } from 'react';

/**
 * Подписка на media query без «прыжка» после первого кадра.
 * Одна реализация вместо локальных useIsMobile/useNarrow по файлам.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            if (typeof window === 'undefined' || !window.matchMedia) return () => {};
            const mql = window.matchMedia(query);
            mql.addEventListener('change', onChange);
            return () => mql.removeEventListener('change', onChange);
        },
        () => (typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches),
        () => false,
    );
}

/** Компьютерная ширина — та же граница 768 px, что у редиректа на /m. */
export function useIsDesktop(): boolean {
    return useMediaQuery('(min-width: 768px)');
}
