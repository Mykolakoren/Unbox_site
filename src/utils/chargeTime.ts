/** «Когда спишутся деньги» для брони: сервер списывает за 24 ч до начала
 *  (для броней ближе суток — сразу). Общая формулировка для шторки брони
 *  и экрана оформления. */
function hhmm(d: Date) {
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
export function formatChargeAt(start: Date): string {
    const charge = new Date(start.getTime() - 24 * 3600 * 1000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);
    const dayAfter = new Date(today.getTime() + 48 * 3600 * 1000);
    const dCharge = new Date(charge);
    dCharge.setHours(0, 0, 0, 0);

    if (charge.getTime() <= Date.now()) return `совсем скоро`;
    if (dCharge.getTime() === today.getTime()) return `сегодня в ${hhmm(charge)}`;
    if (dCharge.getTime() === tomorrow.getTime()) return `завтра в ${hhmm(charge)}`;
    if (dCharge.getTime() === dayAfter.getTime()) return `послезавтра в ${hhmm(charge)}`;
    return charge.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ` в ${hhmm(charge)}`;
}
