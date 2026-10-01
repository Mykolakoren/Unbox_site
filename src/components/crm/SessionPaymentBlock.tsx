import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { crmApi, type CrmClient, type CrmPayment, type CrmPaymentUpdate, type CrmSession } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { CURRENCIES } from '../../utils/currency';
import { formatDayMonth, formatMoney } from '../../utils/format';
import { toastApiError } from '../../utils/errors';
import { partialPayment, paymentMismatch, sessionCurrencyOf, sessionPriceOf } from '../../utils/sessionMoney';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from '../../pages/mobile/admin/parseMoneyInput';

/**
 * SessionPaymentBlock — «Оплата» по сессии в Psy-CRM (этап А, 02.10).
 * Один блок на компьютер (панель правки сессии) и телефон (шторка сессии).
 *
 *   <SessionPaymentBlock session={s} client={c} payment={p} onChanged={reload} />
 *
 * Что показывает (платёж по сессии есть):
 *  - «Оплата: 185 ₾ · Наличные · 30 сентября» и «Изменить» — правка суммы,
 *    валюты, счёта и даты платежа (PATCH /crm/payments/{id});
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
    const accountLabel = paymentAccounts.find(a => a.id === payment.account)?.label || payment.account;
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px', minWidth: 0 }}>
                    Оплата:{' '}
                    <b className="num">{formatMoney(payment.amount, { currency: payment.currency })}</b>
                    {' · '}{accountLabel}
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

// ── Окно «Изменить оплату» ───────────────────────────────────────────────────

function PaymentEditSheet({ payment, clientCurrency, onClose, onSaved }: {
    payment: CrmPayment;
    clientCurrency: string;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}) {
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const dateStr = String(payment.date || payment.createdAt || '');
    const [amount, setAmount] = useState(String(payment.amount));
    const [currency, setCurrency] = useState((payment.currency || clientCurrency || 'GEL').toUpperCase());
    const [account, setAccount] = useState(payment.account);
    const [day, setDay] = useState(dateStr.slice(0, 10));
    const [saving, setSaving] = useState(false);

    // Старый платёж мог лежать на счёте/в валюте, которых нет в списках, —
    // оставляем их выбираемыми, чтобы форма не подменила значение молча.
    const accountOptions = useMemo(() => {
        const list = paymentAccounts.map(a => ({ id: a.id, label: a.label }));
        if (payment.account && !list.some(a => a.id === payment.account)) list.push({ id: payment.account, label: payment.account });
        return list;
    }, [paymentAccounts, payment.account]);
    const currencyOptions = useMemo(() => {
        const list = CURRENCIES.map(c => ({ code: c.code, label: `${c.symbol} ${c.code}` }));
        if (currency && !list.some(c => c.code === currency)) list.push({ code: currency, label: currency });
        return list;
    }, [currency]);

    const parsed = parseMoneyInput(amount);
    const amountError = isMoneyInputBlank(amount)
        ? 'Введите сумму оплаты'
        : parsed === null ? MONEY_INPUT_ERROR : parsed <= 0 ? 'Сумма должна быть больше нуля' : undefined;

    const save = async () => {
        if (parsed === null || parsed <= 0 || saving) return;
        const patch: CrmPaymentUpdate = {};
        if (Math.abs(parsed - Number(payment.amount)) > 0.001) patch.amount = parsed;
        if (currency !== (payment.currency || '').toUpperCase()) patch.currency = currency;
        if (account !== payment.account) patch.account = account;
        if (day && day !== dateStr.slice(0, 10)) {
            // День меняем, время оставляем прежнее: касса считается по дню оплаты.
            patch.date = `${day}T${dateStr.slice(11, 19) || '12:00:00'}`;
        }
        if (Object.keys(patch).length === 0) { onClose(); return; }
        setSaving(true);
        try {
            await crmApi.updatePayment(payment.id, patch);
            toast.success('Оплата изменена');
            await onSaved();
        } catch (e) {
            toastApiError(e, 'Не удалось изменить оплату. Попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open
            onClose={() => { if (!saving) onClose(); }}
            title="Изменить оплату"
            description="Сумма, валюта, счёт и день платежа. Если сумма станет меньше цены, остаток вернётся в долг."
            width={440}
            dismissible={!saving}
            footer={(
                <>
                    <Button block loading={saving} disabled={!!amountError} onClick={save}>
                        Сохранить оплату
                    </Button>
                    <Button block variant="secondary" disabled={saving} onClick={onClose}>
                        Не менять
                    </Button>
                </>
            )}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Field label="Сумма оплаты" error={amountError}>
                    <Input kind="money" value={amount} onChange={e => setAmount(e.target.value)} />
                </Field>
                <Field label="Валюта">
                    <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                        {currencyOptions.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </Select>
                </Field>
                <Field label="Счёт">
                    <Select value={account} onChange={e => setAccount(e.target.value)}>
                        {accountOptions.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                    </Select>
                </Field>
                <Field label="День оплаты" hint={day ? formatDayMonth(day, { withYear: true }) : undefined}>
                    <Input kind="date" value={day} onChange={e => setDay(e.target.value)} />
                </Field>
            </div>
        </Sheet>
    );
}
