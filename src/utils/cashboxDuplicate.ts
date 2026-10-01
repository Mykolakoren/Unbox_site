import { cashboxApi, type CashboxTransaction, type CashboxTransactionCreate } from '../api/cashbox';
import { confirmAction } from '../components/ui/ConfirmDialogProvider';
import { isDuplicatePayment } from './errors';

/**
 * Приход от клиента с защитой от двойного внесения (01.10).
 *
 * Случай: админ нажала «Принять оплату» (45 ₾), увидела красную ошибку, хотя
 * платёж записался, и внесла заново — у клиента два платежа. Теперь сервер на
 * второй такой же приход по клиенту в течение 3 минут отвечает 409
 * `duplicate_recent` (backend cashbox/transactions.py). Здесь этот ответ
 * превращается в вопрос с текстом сервера:
 *   «Записать ещё одну» — повтор с confirm_duplicate: true;
 *   «Отмена»            — ничего не пишем, бросаем DuplicatePaymentDeclined.
 *
 * ВСЕ экраны, где приход привязан к клиенту (credit_user_balance / client_id),
 * вносят деньги через эту функцию, а не напрямую через cashboxApi.createTransaction
 * (сторож guard_duplicate_payment_2026_10). Вызывающий ловит отказ так:
 *   catch (e) { if (isDuplicateDeclined(e)) return; … }
 */
export class DuplicatePaymentDeclined extends Error {
    constructor() {
        super('Повторная запись не подтверждена');
        this.name = 'DuplicatePaymentDeclined';
    }
}

export function isDuplicateDeclined(err: unknown): boolean {
    return err instanceof DuplicatePaymentDeclined;
}

export async function createIncomeWithDuplicateGuard(
    payload: CashboxTransactionCreate,
): Promise<CashboxTransaction> {
    try {
        return await cashboxApi.createTransaction(payload);
    } catch (err) {
        if (!isDuplicatePayment(err)) throw err;
        // Тело ошибки не проходит camelCase-конвертер — поля в snake_case.
        const detail = (err as { response?: { data?: { detail?: { message?: unknown } } } }).response?.data?.detail;
        const message = typeof detail?.message === 'string' && detail.message
            ? detail.message
            : 'Такая же операция по этому клиенту уже записана только что. Если это не ошибка, подтвердите ещё одну запись.';
        const again = await confirmAction({
            title: 'Такой платёж уже записан',
            body: message,
            confirmLabel: 'Записать ещё одну',
            cancelLabel: 'Отмена',
        });
        if (!again) throw new DuplicatePaymentDeclined();
        return cashboxApi.createTransaction({ ...payload, confirm_duplicate: true });
    }
}
