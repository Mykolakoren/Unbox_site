/**
 * Разбор суммы из текстового поля (wave 1, ревью 30.09).
 *
 * Поля сумм на телефоне — текстовые с цифровой клавиатурой (Input kind="money"),
 * поэтому люди вводят как привыкли: «1 280,50», «1280,5», «1280.50». Раньше
 * закрытие смены делало replace(/[\s,]/g, '.') — и «1 280,50» превращалось
 * в 1.28 ₾. Здесь:
 *   - убираем все пробелы (в том числе неразрывные: \s в JS их включает);
 *   - один разделитель дробной части — запятая или точка;
 *   - два и больше разделителей, буквы, знаки, минус — ошибка (null);
 *   - не больше двух знаков после разделителя (тетри);
 *   - больше MAX_MONEY_INPUT — ошибка: ловим опечатку вроде «12800000».
 * Пустое поле — тоже null: отличайте его через isMoneyInputBlank().
 *
 * Модуль без импортов — сторож гоняет его через node как есть.
 */
const MONEY_RE = /^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/;

/** Потолок одной суммы в поле, ₾. Больше — почти наверняка лишний ноль. */
export const MAX_MONEY_INPUT = 1_000_000;

/** true — в поле ничего не введено (одни пробелы). */
export function isMoneyInputBlank(raw: string | null | undefined): boolean {
    return (raw ?? '').replace(/\s+/g, '') === '';
}

/** «1 280,50» → 1280.5; «12abc», «1,2,3», «-5», «» → null. */
export function parseMoneyInput(raw: string | number | null | undefined): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 && raw <= MAX_MONEY_INPUT ? raw : null;
    const s = (raw ?? '').replace(/\s+/g, '');
    if (s === '') return null;
    const separators = (s.match(/[.,]/g) || []).length;
    if (separators > 1) return null;
    const normalized = s.replace(',', '.');
    if (!MONEY_RE.test(normalized)) return null;
    const n = Number(normalized);
    return Number.isFinite(n) && n <= MAX_MONEY_INPUT ? n : null;
}

/** Текст ошибки под полем суммы: что сделать, а не «неверный формат». */
export const MONEY_INPUT_ERROR = 'Введите сумму, например 1280,50';
