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
 */
export function apiErrorMessage(err: any, fallback = 'Что-то пошло не так'): string {
    if (!err) return fallback;

    // Axios path: err.response.data.detail
    const detail = err?.response?.data?.detail;

    if (typeof detail === 'string') return detail;
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
            return msg;
        }
        // Pydantic-style validation list
        if (Array.isArray(detail)) {
            return detail.map((d: any) => d?.msg || d?.message || JSON.stringify(d)).join('; ');
        }
        // Last resort — show keys so we know what shape came back
        try { return JSON.stringify(detail); } catch { return fallback; }
    }

    if (typeof err.message === 'string') return err.message;
    return fallback;
}
