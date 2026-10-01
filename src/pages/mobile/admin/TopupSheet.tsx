import { useState } from 'react';
import { toast } from 'sonner';
import { cashboxApi } from '../../../api/cashbox';
import type { User } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input } from '../../../components/ui/Field';
import { formatGel } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';

/**
 * Пополнить баланс клиента с телефона (волна 4, пакет A).
 *
 * Вынесено из MobileAdminUsers.tsx без изменений оплаты: тот же атомарный
 * вызов, что и на компьютере — приход в кассу + зачисление на баланс одной
 * операцией (category_id 'cat-topup', credit_user_balance). Открывается из
 * «Клиентов» (＋₾), из карточки клиента и из «Сегодня» («Принять оплату»).
 *
 * Решение владельца В3: из «Сегодня» сумма по умолчанию — весь долг клиента
 * (adminToday.byClient → total), подпись «из них за сегодня 36 ₾».
 *
 * Шторка — общий Sheet: слой выше нижнего меню, главная кнопка в подвале
 * всегда видна (раньше её закрывало меню — G9-01).
 */
export interface TopupSheetProps {
    user: User;
    onClose: () => void;
    onDone: () => Promise<void> | void;
    /** Сумма по умолчанию, ₾ (В3 — весь долг). Нет — минус на балансе или 20. */
    defaultAmount?: number;
    /** «из них за сегодня …» — сколько из суммы приходится на сегодняшние брони. */
    todayAmount?: number;
    /** Филиал по умолчанию (например, филиал брони). Нет — Unbox Uni, как раньше. */
    defaultBranch?: string;
}

export function TopupSheet({ user, onClose, onDone, defaultAmount, todayAmount, defaultBranch }: TopupSheetProps) {
    const balance = user.balance ?? 0;
    const debt = balance < 0 ? -balance : 0;
    const initial = defaultAmount && defaultAmount > 0
        ? defaultAmount
        : balance < 0 ? -balance : 20;
    const [amount, setAmount] = useState<string>(String(initial));
    const [method, setMethod] = useState<'cash' | 'card_tbc' | 'card_bog'>('cash');
    const [branch, setBranch] = useState<string>(defaultBranch === 'Unbox One' ? 'Unbox One' : 'Unbox Uni');
    const [saving, setSaving] = useState(false);
    // Поле текстовое (цифровая клавиатура): «1 280,50», «20.5» — общий разбор.
    const parsed = parseMoneyInput(amount);
    const value = parsed ?? 0;
    const amountError = !isMoneyInputBlank(amount) && parsed === null ? MONEY_INPUT_ERROR : undefined;
    const fullDebt = defaultAmount && defaultAmount > debt ? defaultAmount : 0;

    const save = async () => {
        if (value <= 0) { toast.error('Введите сумму больше 0'); return; }
        setSaving(true);
        try {
            await cashboxApi.createTransaction({
                type: 'income',
                amount: value,
                payment_method: method,
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${user.name || user.email}`,
                branch,
                client_id: user.id || user.email,
                credit_user_balance: true,
            } as any);
            toast.success(`Баланс пополнен на ${formatGel(value)} — теперь ${formatGel(balance + value)}`);
            await onDone();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось пополнить баланс (нужен доступ к кассе)');
            setSaving(false);
        }
    };

    return (
        <Sheet
            open
            onClose={onClose}
            title="Пополнить баланс"
            description={
                <>
                    {user.name || user.email} · сейчас{' '}
                    <b className="num" style={{ color: balance < 0 ? 'var(--status-danger-fg)' : 'var(--color-ink)' }}>{formatGel(balance)}</b>
                </>
            }
            footer={
                <Button
                    block
                    loading={saving}
                    disabled={value <= 0}
                    onClick={save}
                >
                    Пополнить на {value > 0 ? formatGel(value) : '—'}
                </Button>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                    <div role="group" aria-label="Быстрая сумма" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {fullDebt > 0 && (
                            <Chip selected={value === fullDebt} onClick={() => setAmount(String(fullDebt))}>
                                Весь долг ({formatGel(fullDebt)})
                            </Chip>
                        )}
                        {balance < 0 && (
                            <Chip selected={value === -balance} onClick={() => setAmount(String(-balance))}>
                                Закрыть долг ({formatGel(-balance)})
                            </Chip>
                        )}
                        {[20, 40, 60, 100].map(v => (
                            <Chip key={v} selected={value === v} onClick={() => setAmount(String(v))}>{formatGel(v)}</Chip>
                        ))}
                    </div>
                    <Field
                        label="Сумма"
                        error={amountError}
                        hint={todayAmount && todayAmount > 0 ? `Из них за сегодня ${formatGel(todayAmount)}` : undefined}
                    >
                        <Input kind="money" suffix="₾" value={amount} onChange={e => setAmount(e.target.value)} />
                    </Field>
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Способ оплаты</div>
                    <Segmented<'cash' | 'card_tbc' | 'card_bog'>
                        aria-label="Способ оплаты"
                        options={[
                            { value: 'cash', label: 'Наличные' },
                            { value: 'card_tbc', label: 'Карта TBC' },
                            { value: 'card_bog', label: 'Карта BOG' },
                        ]}
                        value={method}
                        onChange={setMethod}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Филиал</div>
                    <Segmented
                        aria-label="Филиал"
                        options={[
                            { value: 'Unbox Uni', label: 'Unbox Uni' },
                            { value: 'Unbox One', label: 'Unbox One' },
                        ]}
                        value={branch}
                        onChange={setBranch}
                    />
                </div>
            </div>
        </Sheet>
    );
}
