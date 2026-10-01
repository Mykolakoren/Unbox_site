import { toast } from 'sonner';

/**
 * Extract a human-readable string from any axios error / API response.
 *
 * Backend HTTPException can carry either a string detail ("Not found")
 * or a structured object ({message, conflicts: [...]} for booking
 * conflict cases). React crashes (Minified error #31) the moment we
 * try to render that object as a child — toast.error / <span>{detail}</span>
 * both fall over. Always pipe API errors through this helper.
 *
 *   try { ... } catch (e) {
 *     toast.error(apiErrorMessage(e, 'Не удалось сохранить'));
 *   }
 *
 * Волна 2, шаг 0 (X5-04): английский технический текст наружу не отдаём.
 * Нет ответа сервера → «Нет соединения с сервером…», таймаут → «Сервер долго
 * не отвечает…», 429 → «Слишком много запросов…». err.message и английские
 * detail («Not found», «Network Error») заменяются на fallback — в нём
 * вызывающий код и так пишет, что не получилось («Не удалось забронировать»).
 *
 * Второе уведомление. Интерцептор в api/client.ts сам показывает тост на
 * сетевой сбой, таймаут и ошибку сервера у запросов записи — и помечает
 * ошибку markErrorToastShown(). Экран должен показывать свой тост через
 * toastApiError(e, 'Не удалось …') — он промолчит, если тост уже был.
 */

export const NETWORK_ERROR_TEXT = 'Нет соединения с сервером. Проверьте интернет и повторите';
export const TIMEOUT_ERROR_TEXT = 'Сервер долго не отвечает. Попробуйте ещё раз';
export const RATE_LIMIT_TEXT = 'Слишком много запросов. Подождите минуту и повторите';
export const SERVER_ERROR_TEXT = 'Ошибка сервера. Попробуйте позже';

/** Есть кириллица — значит, текст писали для людей (наш detail или наш throw). */
const CYRILLIC_RE = /[а-яё]/i;

function humanText(text: unknown): string | null {
    if (typeof text !== 'string') return null;
    const t = text.trim();
    return t && CYRILLIC_RE.test(t) ? t : null;
}

/** Таймаут запроса (axios: ECONNABORTED / ETIMEDOUT). */
export function isTimeoutError(err: any): boolean {
    return !!err && !err.response && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT');
}

/** Сервер не ответил вовсе: нет сети, сервер лежит, CORS (axios: «Network Error»). */
export function isNetworkError(err: any): boolean {
    if (!err || err.response || isTimeoutError(err)) return false;
    // Запрос отменили мы сами (AbortController, уход со страницы) — не сбой.
    if (err.code === 'ERR_CANCELED' || err.name === 'CanceledError') return false;
    return err.code === 'ERR_NETWORK' || err.message === 'Network Error' || !!err.request || !!err.isAxiosError;
}

export function apiErrorMessage(err: any, fallback = 'Что-то пошло не так'): string {
    if (!err) return fallback;

    // Ответа нет — сервер не виноват в тексте, говорим про связь.
    if (isTimeoutError(err)) return TIMEOUT_ERROR_TEXT;
    if (isNetworkError(err)) return NETWORK_ERROR_TEXT;
    if (err?.response?.status === 429) return RATE_LIMIT_TEXT;

    // Axios path: err.response.data.detail
    const detail = err?.response?.data?.detail;

    if (typeof detail === 'string') return humanText(detail) ?? fallback;
    if (detail && typeof detail === 'object') {
        const msg = (detail as any).message;
        if (typeof msg === 'string') {
            // Render up to 3 conflict reasons inline so the toast is actually
            // useful (not just "Конфликт в 5 датах").
            const conflicts = (detail as any).conflicts;
            if (Array.isArray(conflicts) && conflicts.length > 0) {
                const sample = conflicts.slice(0, 3).map((c: any) => {
                    const date = c.date || c.day || '';
                    const time = c.startTime || c.start_time || c.time || '';
                    const reason = c.reason || c.conflict || '';
                    return `${date}${time ? ' ' + time : ''}${reason ? ' — ' + reason : ''}`.trim();
                }).filter(Boolean);
                const more = conflicts.length > sample.length ? ` (+${conflicts.length - sample.length} ещё)` : '';
                return `${msg}: ${sample.join('; ')}${more}`;
            }
            return humanText(msg) ?? fallback;
        }
        // Pydantic-style validation list
        if (Array.isArray(detail)) {
            const texts = detail.map((d: any) => humanText(d?.msg) ?? humanText(d?.message)).filter(Boolean);
            return texts.length ? texts.join('; ') : fallback;
        }
        return fallback;
    }

    // Свой throw new Error('…') по-русски — показываем; английское — нет.
    return humanText(err?.message) ?? fallback;
}

// ── Запись денег в кассу: «получилось или нет» ─────────────────────────

/** Сервер не ответил (или ответил шлюз после таймаута): запись МОГЛА пройти. */
export const PAYMENT_UNCERTAIN_TEXT = 'Не удалось подтвердить запись. Проверьте журнал кассы, прежде чем вносить заново';

/** 409 duplicate_recent: такой же приход по клиенту уже записан минуту назад
 *  (backend cashbox/transactions.py). Это вопрос «записать ещё одну?», не ошибка —
 *  общий api/client.ts второй тост для него не показывает. */
export function isDuplicatePayment(err: any): boolean {
    const d = err?.response?.data?.detail;
    return err?.response?.status === 409 && !!d && typeof d === 'object' && d.code === 'duplicate_recent';
}

/**
 * Текст ошибки записи денег в кассу. Админ раньше видел «нужен доступ к кассе»
 * на ЛЮБОЙ сбой — в том числе когда платёж на самом деле записался (01.10
 * вторая оплата 45 ₾ после «красной ошибки»). Теперь:
 *   • сервер ответил отказом — его настоящие слова (или fallback);
 *   • ответа нет / шлюз 502-504 / сбой после ответа — честное «неизвестно,
 *     проверьте журнал», без догадок про права.
 */
export function paymentErrorText(err: any, fallback = 'Не удалось записать оплату'): string {
    const status = err?.response?.status;
    if (!err?.response || status === 502 || status === 503 || status === 504) return PAYMENT_UNCERTAIN_TEXT;
    return apiErrorMessage(err, fallback);
}

// ── «Уведомление уже показано» ─────────────────────────────────────────

const TOAST_SHOWN = '__unboxToastShown';

/** Пометить ошибку: тост о ней уже на экране (ставит интерцептор api/client.ts). */
export function markErrorToastShown(err: unknown): void {
    if (err && typeof err === 'object') {
        try { (err as any)[TOAST_SHOWN] = true; } catch { /* замороженный объект — не страшно */ }
    }
}

/** true — тост об этой ошибке уже показан, второй не нужен. */
export function wasErrorToastShown(err: unknown): boolean {
    return !!(err && typeof err === 'object' && (err as any)[TOAST_SHOWN]);
}

/**
 * Показать ошибку действия одним тостом:
 *   catch (e) { toastApiError(e, 'Не удалось забронировать'); }
 * Если интерцептор уже сказал «Нет соединения с сервером…» — промолчит.
 */
export function toastApiError(err: unknown, fallback = 'Что-то пошло не так', opts?: Parameters<typeof toast.error>[1]): void {
    if (wasErrorToastShown(err)) return;
    toast.error(apiErrorMessage(err, fallback), opts);
    markErrorToastShown(err);
}
