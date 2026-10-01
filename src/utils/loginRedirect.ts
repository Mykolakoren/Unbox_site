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

// ── Возврат после входа через Telegram (доработка 01.10) ─────────────────
//
// Вход через Telegram уходит со страницы на oauth.telegram.org, а сервер
// после него всегда отправляет на /dashboard?source=telegram — про ?redirect=
// он не знает. Поэтому куда вернуть, запоминаем на фронте перед уходом в
// Telegram (sessionStorage живёт в этой же вкладке и переживает переход на
// чужой сайт и обратно), а после возврата забираем один раз. И при записи,
// и при чтении путь проходит safeRedirectPath — только «/…», не «//…».

const TG_REDIRECT_KEY = 'tgLoginRedirect';

/** Перед уходом в Telegram: запомнить, куда вернуть (или забыть старое). */
export function rememberTelegramRedirect(raw: string | null | undefined): void {
    try {
        const safe = safeRedirectPath(raw);
        if (safe) sessionStorage.setItem(TG_REDIRECT_KEY, safe);
        else sessionStorage.removeItem(TG_REDIRECT_KEY);
    } catch { /* приватный режим без хранилища — вернём в кабинет, как раньше */ }
}

/** После возврата из Telegram: куда вернуть (один раз) или null. */
export function takeTelegramRedirect(): string | null {
    try {
        const raw = sessionStorage.getItem(TG_REDIRECT_KEY);
        sessionStorage.removeItem(TG_REDIRECT_KEY);
        return safeRedirectPath(raw);
    } catch {
        return null;
    }
}
