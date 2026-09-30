import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Ссылки каталога внутри мобильного приложения (волна 2, шаг 0; G2-02).
 *
 * Страницы каталога (специалист, центр, кабинет, тарифы, правила) рисуются
 * и на компьютере (/specialists/x), и внутри оболочки /m (/m/specialists/x).
 * Раньше их ссылки были зашиты компьютерными: клиент в /m нажимал «Кабинет 5 →»
 * или хлебные крошки и вылетал из приложения без нижнего меню.
 *
 *   const inShell = useInMobileShell();
 *   <Link to={catalogPath(`/cabinet/${id}`, inShell)}>…</Link>
 *   // или короче:
 *   const toCatalog = useCatalogPath();
 *   navigate(toCatalog('/subscriptions'));
 *
 * Вне /m путь возвращается как есть. Внутри /m — мобильный двойник, если
 * такой маршрут реально есть в App.tsx; иначе путь как есть (/news, /login).
 * Строка запроса (?cab=5) сохраняется; якорь — только если он не стал
 * частью самого пути (/#specialists → /m/specialists).
 */

/** Путь внутри мобильной оболочки: /m, /m/…, в том числе /m/crm и /m/admin. */
export function isMobileShellPath(pathname: string): boolean {
    return pathname === '/m' || pathname.startsWith('/m/');
}

/** true, если экран открыт внутри /m (клиентская, CRM или админская оболочка). */
export function useInMobileShell(): boolean {
    return isMobileShellPath(useLocation().pathname);
}

// Якоря главной страницы → отдельные экраны /m.
const HASH_MAP: Record<string, string> = {
    '#specialists': '/m/specialists',
    '#cabinets': '/m/places',
};

// [компьютерный путь, мобильный]. $1 — подставляется id из пути.
// Сверено с маршрутами /m в App.tsx (30.09): specialists, specialists/:id,
// places, location/:locationId, cabinet/:resourceId, tariffs, booking-rules,
// become-specialist, find, today, bookings, waitlist, bonuses, me.
const PATH_MAP: Array<[RegExp, string]> = [
    [/^\/$/, '/m'],
    [/^\/explore$/, '/m/find'],
    [/^\/checkout$/, '/m/find'],
    [/^\/specialists$/, '/m/specialists'],
    [/^\/specialists\/([^/]+)$/, '/m/specialists/$1'],
    [/^\/location\/([^/]+)$/, '/m/location/$1'],
    [/^\/cabinet\/([^/]+)$/, '/m/cabinet/$1'],
    // Каталог тарифов. /m/subscription — это «мой абонемент», не витрина.
    [/^\/subscriptions$/, '/m/tariffs'],
    [/^\/booking-rules$/, '/m/booking-rules'],
    [/^\/become-specialist$/, '/m/become-specialist'],
    [/^\/dashboard$/, '/m/today'],
    [/^\/dashboard\/bookings$/, '/m/bookings'],
    [/^\/dashboard\/waitlist$/, '/m/waitlist'],
    [/^\/dashboard\/bonuses$/, '/m/bonuses'],
    [/^\/dashboard\/profile$/, '/m/me'],
];

/** Чистая функция: компьютерный путь → мобильный двойник (или как есть). */
export function toMobilePath(path: string): string {
    if (!path.startsWith('/') || isMobileShellPath(path.split(/[?#]/)[0])) return path;
    const m = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(path);
    if (!m) return path;
    const pathname = m[1].length > 1 ? m[1].replace(/\/+$/, '') : m[1];
    const search = m[2] ?? '';
    const hash = m[3] ?? '';

    if (pathname === '/' && hash && HASH_MAP[hash]) return HASH_MAP[hash] + search;

    for (const [re, target] of PATH_MAP) {
        const hit = re.exec(pathname);
        if (hit) {
            const resolved = target.replace(/\$(\d+)/g, (_, n) => hit[Number(n)] ?? '');
            return resolved + search + hash;
        }
    }
    return path;
}

/**
 * Ссылка каталога с учётом оболочки. inShell не передан — смотрим на текущий
 * адрес (удобно в обработчиках); в разметке лучше передать useInMobileShell().
 */
export function catalogPath(path: string, inShell?: boolean): string {
    const shell = inShell ?? (typeof window !== 'undefined' && isMobileShellPath(window.location.pathname));
    return shell ? toMobilePath(path) : path;
}

/** Хук: функция-переводчик ссылок для текущего экрана. */
export function useCatalogPath(): (path: string) => string {
    const inShell = useInMobileShell();
    return useCallback((path: string) => catalogPath(path, inShell), [inShell]);
}
