import { toast } from 'sonner';
import { crmApi, type CrmClient, type CrmSession } from '../../api/crm';
import { confirmAction } from '../../components/ui/ConfirmDialogProvider';
import { parseUTC } from '../../utils/dateUtils';
import { formatDayMonth, formatMoney } from '../../utils/format';
import { toastApiError } from '../../utils/errors';

/**
 * «Снять отметку об оплате» — одно действие для всей CRM на компьютере (10.11,
 * владелец: «поставил «оплачена» — не вижу, как отменить»). Раньше снять можно
 * было только крестиком в карточке клиента, галочкой в правке или «Вернуть» в
 * тосте за 5 с; в меню строки «Сессий» и на главной этого не было.
 *
 * Платёж удаляется целиком — поэтому всегда через вопрос (G5-07). Возвращает
 * true, если отметку сняли.
 */
export async function unmarkPaidWithConfirm(session: CrmSession, client?: CrmClient | null): Promise<boolean> {
    const amount = session.paidAmount ?? session.price ?? client?.basePrice ?? 0;
    const currency = session.currency ?? client?.currency;
    const what = ` ${formatMoney(amount, { currency })} за ${formatDayMonth(parseUTC(session.date))}`;
    const ok = await confirmAction({
        title: `Снять отметку об оплате${what}?`,
        body: 'Платёж удалится из истории оплат, и сессия снова станет долгом. Если потом отметить её заново, оплата запишется сегодняшним числом.',
        confirmLabel: 'Снять отметку об оплате',
        cancelLabel: 'Оставить',
        tone: 'danger',
    });
    if (!ok) return false;
    try {
        await crmApi.unmarkPaidSession(session.id);
        toast.success('Отметка об оплате снята');
        return true;
    } catch (e) {
        toastApiError(e, 'Не удалось снять отметку об оплате. Обновите страницу и попробуйте ещё раз');
        return false;
    }
}
