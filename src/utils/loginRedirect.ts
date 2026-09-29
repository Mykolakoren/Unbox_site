/**
 * Возврат после входа: страницы, которые отправляют на /login, передают
 * ?redirect=<куда вернуть>. Вход принимает только свои пути внутри сайта —
 * иначе ссылкой вида /login?redirect=https://… можно было бы увести
 * человека на чужой сайт сразу после ввода пароля.
 */

/** Безопасный локальный путь или null. Пропускаем только «/что-то»:
 *  не «//host» и не «/\host» (браузер читает их как чужой сайт), без схем
 *  и управляющих символов, и не саму страницу входа (петля). */
export function safeRedirectPath(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const path = raw.trim();
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    // Обратный слэш и управляющие символы: «/\evil.com» браузер превращает в «//evil.com».
    // eslint-disable-next-line no-control-regex
    if (/[\\\u0000-\u001f\u007f]/.test(path)) return null;
    if (/^\/login(?:[/?#]|$)/.test(path)) return null;
    return path;
}

/** Адрес входа с возвратом на `path` (по умолчанию — текущая страница). */
export function loginPathWithRedirect(path?: string): string {
    const here = path ?? (typeof window !== 'undefined'
        ? window.location.pathname + window.location.search + window.location.hash
        : '/');
    const safe = safeRedirectPath(here);
    return safe && safe !== '/' ? `/login?redirect=${encodeURIComponent(safe)}` : '/login';
}
