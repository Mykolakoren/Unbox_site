import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, Input, Select } from '../ui/Field';
import { crmApi, type CrmPayment, type CrmPaymentUpdate } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { CURRENCIES } from '../../utils/currency';
import { formatDayMonth } from '../../utils/format';
import { toastApiError } from '../../utils/errors';
import { accountSelectValue } from '../../utils/paymentAccounts';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from '../../pages/mobile/admin/parseMoneyInput';

/**
 * PaymentEditSheet — окно «Изменить оплату» в Psy-CRM: сумма, валюта, счёт и
 * день платежа (PATCH /crm/payments/{id}).
 *
 * Одно окно на всё: блок «Оплата» в панели сессии (SessionPaymentBlock) и
 * карандаш в списке «Последние оплаты» (компьютер и телефон). Раньше окно
 * жило внутри блока «Оплата», и платёж из списка оплат поправить было нельзя.
 *
 * Платёж без сессии (sessionId пустой) правится так же: сервер для него ничего
 * не пересчитывает («оплачено» бывает только у сессии).
 */

export interface PaymentEditSheetProps {
    payment: CrmPayment;
    /** Валюта клиента — запасная, если у платежа валюта не записана. */
    clientCurrency?: string;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
}

export function PaymentEditSheet({ payment, clientCurrency, onClose, onSaved }: PaymentEditSheetProps) {
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const dateStr = String(payment.date || payment.createdAt || '');
    // «Cash» и «cash» — один счёт: выбранным показываем пункт из списка, а в базу
    // счёт уходит, только если его выбрали заново (иначе не переписываем).
    const startAccount = accountSelectValue(payment.account, paymentAccounts);
    const [amount, setAmount] = useState(String(payment.amount));
    const [currency, setCurrency] = useState((payment.currency || clientCurrency || 'GEL').toUpperCase());
    const [account, setAccount] = useState(startAccount);
    const [day, setDay] = useState(dateStr.slice(0, 10));
    const [saving, setSaving] = useState(false);

    // Старый платёж мог лежать на счёте/в валюте, которых нет в списках, —
    // оставляем их выбираемыми, чтобы форма не подменила значение молча.
    const accountOptions = useMemo(() => {
        const list = paymentAccounts.map(a => ({ id: a.id, label: a.label }));
        if (startAccount && !list.some(a => a.id === startAccount)) list.push({ id: startAccount, label: startAccount });
        return list;
    }, [paymentAccounts, startAccount]);
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
        if (account !== startAccount) patch.account = account;
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
            description={payment.sessionId
                ? 'Сумма, валюта, счёт и день платежа. Если сумма станет меньше цены, остаток вернётся в долг.'
                : 'Сумма, валюта, счёт и день платежа.'}
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
