import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { crmApi, type CrmClient, type CrmPayment, type CrmSession } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { formatDayMonth, formatMoney } from '../../utils/format';
import { toastApiError } from '../../utils/errors';
import { partialPayment, paymentMismatch, sessionCurrencyOf, sessionPriceOf } from '../../utils/sessionMoney';
import { accountLabel } from '../../utils/paymentAccounts';
import { PaymentEditSheet } from './PaymentEditSheet';

/**
 * SessionPaymentBlock — «Оплата» по сессии в Psy-CRM (этап А, 02.10).
 * Один блок на компьютер (панель правки сессии) и телефон (шторка сессии).
 *
 *   <SessionPaymentBlock session={s} client={c} payment={p} onChanged={reload} />
 *
 * Что показывает (платёж по сессии есть):
 *  - подпись «Оплата · счёт, сумма и день платежа правятся здесь», под ней
 *    «185 ₾ · Наличные · 30 сентября» и «Изменить» — правка суммы, валюты,
 *    счёта и даты платежа (PaymentEditSheet → PATCH /crm/payments/{id});
 *    счёт платежа правится ТОЛЬКО здесь (а не в поле «Счёт для оплаты» формы цены:
 *    то меняет счёт сессии, и путаница стоила платежа не на том счёте, 01.10);
 *  - частичная оплата — «Оплачено 100 из 185 ₾ · долг 85 ₾» и «Доплатить 85 ₾»;
 *  - цену поменяли после оплаты — спокойное «Цена и оплата не совпадают:
 *    оплачено 185 ₾, цена 200 ₾» и «Доплатить 15 ₾», если не хватает.
 * «Доплатить» — существующий POST /crm/payments с этой сессией: сервер сам
 * прибавит сумму к платежу и пересчитает «оплачено».
 *
 * Суммы приходят с сервера в валюте сессии (paidAmount / remaining) — здесь не
 * пересчитываем курсы сами.
 */

export interface SessionPaymentBlockProps {
    session: CrmSession;
    client: CrmClient;
    /** Платёж этой сессии (одна строка на сессию). Нет платежа — блок не рисуется. */
    payment: CrmPayment | null | undefined;
    /** «Просмотр как специалист»: только показать, ничего не менять. */
    readOnly?: boolean;
    /** Что-то изменили — родитель перечитывает сессии и платежи. */
    onChanged: () => void | Promise<void>;
}

export function SessionPaymentBlock({ session, client, payment, readOnly, onChanged }: SessionPaymentBlockProps) {
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const [editing, setEditing] = useState(false);
    const [topping, setTopping] = useState(false);

    if (!payment) return null;

    const cur = sessionCurrencyOf(session, client);
    const price = sessionPriceOf(session, client);
    const partial = partialPayment(session, client);
    const mismatch = paymentMismatch(session, client, payment.currency);
    const accountText = accountLabel(payment.account, paymentAccounts);
    const topUpAmount = partial ? partial.remaining : (mismatch?.shortfall ?? 0);

    const topUp = async () => {
        if (topping || topUpAmount <= 0) return;
        setTopping(true);
        try {
            if (partial) {
                // Частичная оплата: «Доплатить» = закрыть остаток. Это идемпотентный
                // quick-pay: повторный тап получит «уже оплачена», а не вторую доплату.
                const res = await crmApi.quickPaySession(session.id);
                // Сумма доплаты сервер считает в валюте ПЛАТЕЖА — так и подписываем.
                toast.success(`Доплата записана: ${formatMoney(res.added ?? topUpAmount, { currency: res.added != null ? res.currency : cur })}`);
            } else {
                // Цену подняли после оплаты: доплата по POST /payments, но с capToRemaining —
                // сервер не примет сумму больше остатка (двойной клик не задвоит платёж).
                await crmApi.createPayment({
                    clientId: session.clientId,
                    sessionId: session.id,
                    amount: topUpAmount,
                    currency: cur,
                    capToRemaining: true,
                    // Дата нужна серверу, но у доплаты она не меняет платёж: он один на сессию.
                    date: new Date().toISOString().slice(0, 19),
                });
                toast.success(`Доплата записана: ${formatMoney(topUpAmount, { currency: cur })}`);
            }
            await onChanged();
        } catch (e) {
            toastApiError(e, 'Не удалось записать доплату. Попробуйте ещё раз');
        } finally {
            setTopping(false);
        }
    };

    return (
        <div
            style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '10px 12px', border: '1px solid var(--color-ink-10)', background: 'var(--color-paper, transparent)',
                fontSize: 14, lineHeight: 1.5,
            }}
        >
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60, inherit)' }}>
                {readOnly ? 'Оплата' : 'Оплата · счёт, сумма и день платежа правятся здесь'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                    <b className="num">{formatMoney(payment.amount, { currency: payment.currency })}</b>
                    {' · '}{accountText}
                    {' · '}{formatDayMonth(payment.date || payment.createdAt, { withYear: 'auto' })}
                </span>
                {!readOnly && (
                    <Button size="compact" variant="secondary" onClick={() => setEditing(true)}>
                        Изменить
                    </Button>
                )}
            </div>

            {partial && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="num" style={{ flex: '1 1 200px', minWidth: 0 }}>
                        {`Оплачено ${formatMoney(partial.paid, { currency: cur })} из ${formatMoney(partial.price, { currency: cur })}`}
                        {` · долг ${formatMoney(partial.remaining, { currency: cur })}`}
                    </span>
                    {!readOnly && (
                        <Button size="compact" loading={topping} onClick={topUp}>
                            {`Доплатить ${formatMoney(partial.remaining, { currency: cur })}`}
                        </Button>
                    )}
                </div>
            )}

            {!partial && mismatch && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className="num" style={{ flex: '1 1 200px', minWidth: 0, color: 'var(--color-ink-80, inherit)' }}>
                        {`Цена и оплата не совпадают: оплачено ${formatMoney(mismatch.paid, { currency: cur })}, цена ${formatMoney(price, { currency: cur })}`}
                    </span>
                    {!readOnly && mismatch.shortfall > 0 && (
                        <Button size="compact" variant="secondary" loading={topping} onClick={topUp}>
                            {`Доплатить ${formatMoney(mismatch.shortfall, { currency: cur })}`}
                        </Button>
                    )}
                </div>
            )}

            {editing && (
                <PaymentEditSheet
                    payment={payment}
                    clientCurrency={client.currency}
                    onClose={() => setEditing(false)}
                    onSaved={async () => { setEditing(false); await onChanged(); }}
                />
            )}
        </div>
    );
}
