import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { CURRENCIES } from '../../utils/currency';
import { formatMoney } from '../../utils/format';
import { isMoneyInputBlank, MONEY_INPUT_ERROR, parseMoneyInput } from '../../pages/mobile/admin/parseMoneyInput';

/**
 * «Сколько заплатили?» (09.11, решение владельца 2) — для ЛЮБОГО места, где
 * отмечают оплату сессии без цены (компьютерная CRM, «Неоплаченные сессии»,
 * неделя). Сервер без суммы отвечает 400 code=price_required, и api/crm.ts
 * спрашивает сумму здесь, а потом повторяет оплату с суммой.
 *
 *  - сумма подставлена из «Базовой цены сессии» анкеты;
 *  - у клиента нет своей ставки — галочка «Запомнить как ставку клиента» (вкл.).
 *
 * Отдельный корень React: так окно работает из любого экрана без провайдера.
 * null — специалист передумал.
 */
export interface PaymentAmountAnswer {
    amount: number;
    rememberRate: boolean;
}

export function askPaymentAmount(opts: {
    currency: string;
    defaultPrice?: number;
    /** Ставка клиента; 0 — показать «Запомнить как ставку клиента». */
    clientRate?: number;
}): Promise<PaymentAmountAnswer | null> {
    return new Promise(resolve => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        let done = false;
        const finish = (v: PaymentAmountAnswer | null) => {
            if (done) return;
            done = true;
            resolve(v);
            // Даём шторке закрыться, потом убираем корень.
            setTimeout(() => { root.unmount(); host.remove(); }, 250);
        };
        root.render(<PayAmountDialog {...opts} onDone={finish} />);
    });
}

function PayAmountDialog({ currency, defaultPrice = 0, clientRate = 0, onDone }: {
    currency: string; defaultPrice?: number; clientRate?: number;
    onDone: (v: PaymentAmountAnswer | null) => void;
}) {
    const [open, setOpen] = useState(true);
    const [raw, setRaw] = useState(defaultPrice > 0 ? String(defaultPrice) : '');
    const [remember, setRemember] = useState(true);
    const parsed = parseMoneyInput(raw);
    const ok = parsed !== null && parsed > 0;
    const error = !isMoneyInputBlank(raw) && !ok ? MONEY_INPUT_ERROR : undefined;
    const showRemember = !(clientRate > 0);
    const close = (v: PaymentAmountAnswer | null) => { setOpen(false); onDone(v); };
    const symbol = CURRENCIES.find(c => c.code === currency)?.symbol ?? currency;
    return (
        <Sheet
            open={open}
            onClose={() => close(null)}
            title="Сколько заплатили?"
            description="У сессии нет цены — без суммы оплата не запишется в «Финансы»"
            footer={(
                <Button block disabled={!ok} onClick={() => { if (ok) close({ amount: parsed as number, rememberRate: showRemember && remember }); }}>
                    {ok ? `Отметить оплату · ${formatMoney(parsed as number, { currency })}` : 'Отметить оплату'}
                </Button>
            )}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Сумма" error={error} hint={defaultPrice > 0 ? 'Подставлена базовая цена сессии из вашей анкеты' : undefined}>
                    <Input kind="money" suffix={symbol} value={raw} onChange={e => setRaw(e.target.value)} autoFocus />
                </Field>
                {showRemember && <RememberRateCheck checked={remember} onChange={setRemember} />}
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--color-ink-60)' }}>
                    Сумма станет ценой этой сессии.
                </p>
            </div>
        </Sheet>
    );
}

/** Галочка «Запомнить как ставку клиента» — общая для телефона и компьютера. */
export function RememberRateCheck({ checked, onChange, disabled }: {
    checked: boolean; onChange: (v: boolean) => void; disabled?: boolean;
}) {
    return (
        <label style={{
            display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '6px 12px',
            borderRadius: 10, background: 'var(--color-sunken)', cursor: disabled ? 'default' : 'pointer',
            fontSize: 14, lineHeight: 1.4, color: 'var(--color-ink)',
        }}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={e => onChange(e.target.checked)}
                style={{ width: 20, height: 20, flexShrink: 0, accentColor: 'var(--color-accent)' }}
            />
            <span>Запомнить как ставку клиента — в следующий раз не спросим</span>
        </label>
    );
}
