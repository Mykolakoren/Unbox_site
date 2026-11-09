import { useState } from 'react';
import { toast } from 'sonner';
import { createIncomeWithDuplicateGuard, isDuplicateDeclined } from '../../../utils/cashboxDuplicate';
import { paymentErrorText, toastApiError } from '../../../utils/errors';
import { cashboxApi } from '../../../api/cashbox';
import { undoToast } from '../../../components/ui/undoToast';
import { claimCashUndo, releaseCashUndo } from '../../../components/admin/cashbox/cashMoney';
import { CASH_BRANCHES } from '../../../utils/cashBranch';
import type { User } from '../../../store/types';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input } from '../../../components/ui/Field';
import { formatGel } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';
import { topupLooksLikeTypo, topupTypoQuestion } from '../../../utils/topupGuard';
import { branchLabel } from './branchLabel';

/**
 * Пополнить баланс клиента с телефона (волна 4, пакет A).
 *
 * Тот же атомарный вызов, что и на компьютере — приход в кассу + зачисление
 * на баланс одной операцией (category_id 'cat-topup', credit_user_balance).
 * Открывается из «Клиентов» (＋₾), из карточки клиента, из «Кассы» и из
 * «Сегодня» («Принять оплату»).
 *
 * Решение владельца В3: из «Сегодня» сумма по умолчанию — весь долг клиента
 * (adminToday.byClient → total), подпись «из них за сегодня 36 ₾».
 *
 * Ревью 09.11 (№1): филиал и способ оплаты программа сама НЕ выбирает —
 * раньше молча стояли «Наличные · Unbox Uni», и деньги One уходили в кассу Uni.
 * Филиал подставляется только если его знает экран (филиал брони, фильтр
 * кассы); иначе кнопка неактивна с подсказкой «Выберите филиал» /
 * «Выберите способ», как в «Новой операции». Сумма подставляется только при
 * долге. На кнопке — вся операция: «Пополнить на 40 ₾ · карта TBC · One».
 * №4: после записи — «Вернуть» 5 с (удаление операции само откатывает
 * зачисление на баланс, сервер разрешает админу удалить сегодняшнюю).
 *
 * Шторка — общий Sheet: слой выше нижнего меню, главная кнопка в подвале.
 */
export interface TopupSheetProps {
    user: User;
    onClose: () => void;
    onDone: () => Promise<void> | void;
    /** Сумма по умолчанию, ₾ (В3 — весь долг). Нет — минус на балансе или пусто. */
    defaultAmount?: number;
    /** «из них за сегодня …» — сколько из суммы приходится на сегодняшние брони. */
    todayAmount?: number;
    /** Филиал кассы, если экран его знает (филиал брони, фильтр кассы). Нет — не выбран. */
    defaultBranch?: string;
}

type Method = 'cash' | 'card_tbc' | 'card_bog';

/** Способ оплаты на кнопке: «наличные», «карта TBC». */
const METHOD_ON_BUTTON: Record<Method, string> = {
    cash: 'наличные',
    card_tbc: 'карта TBC',
    card_bog: 'карта BOG',
};

export function TopupSheet({ user, onClose, onDone, defaultAmount, todayAmount, defaultBranch }: TopupSheetProps) {
    const balance = user.balance ?? 0;
    const debt = balance < 0 ? -balance : 0;
    // Сумму подставляем только при долге (раньше — «20 ₾» всегда: легко нажать не глядя).
    const initial = defaultAmount && defaultAmount > 0
        ? defaultAmount
        : debt > 0 ? debt : null;
    const [amount, setAmount] = useState<string>(initial !== null ? String(initial) : '');
    const [method, setMethod] = useState<Method | ''>('');
    // Только филиалы кассы (Uni/One). Филиал брони Neo School — не касса: пусть выберут.
    const [branch, setBranch] = useState<string>(
        defaultBranch && (CASH_BRANCHES as readonly string[]).includes(defaultBranch) ? defaultBranch : '',
    );
    const [saving, setSaving] = useState(false);
    // Поле текстовое (цифровая клавиатура): «1 280,50», «20.5» — общий разбор.
    const parsed = parseMoneyInput(amount);
    const value = parsed ?? 0;
    const amountError = !isMoneyInputBlank(amount) && parsed === null ? MONEY_INPUT_ERROR : undefined;
    const fullDebt = defaultAmount && defaultAmount > debt ? defaultAmount : 0;
    // 13.10: сумма сильно больше ожидаемой — сначала переспрашиваем (topupGuard).
    const expected = defaultAmount && defaultAmount > 0 ? defaultAmount : debt;
    const [confirmFor, setConfirmFor] = useState<number | null>(null);
    const askTypo = confirmFor !== null && confirmFor === value;
    const missing = !branch ? 'Выберите филиал' : !method ? 'Выберите способ оплаты' : null;

    const save = async () => {
        if (value <= 0) { toast.error('Введите сумму больше 0'); return; }
        if (!branch || !method) { toast.error(missing || 'Выберите филиал и способ оплаты'); return; }
        if (topupLooksLikeTypo(value, expected) && confirmFor !== value) { setConfirmFor(value); return; }
        setSaving(true);
        let created: { id?: string } | null = null;
        try {
            // 01.10: через защиту от дубля (409 duplicate_recent → «Записать ещё одну?»).
            created = await createIncomeWithDuplicateGuard({
                type: 'income',
                amount: value,
                payment_method: method,
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${user.name || user.email}`,
                branch,
                client_id: user.id || user.email,
                credit_user_balance: true,
            } as any);
        } catch (err: any) {
            setSaving(false);
            // Не подтвердили повтор — не ошибка, ничего не пишем и не ругаемся.
            if (isDuplicateDeclined(err)) return;
            toast.error(paymentErrorText(err, 'Не удалось пополнить баланс'));
            return;
        }
        // Платёж уже записан: сбой обновления экрана не должен выглядеть как «не прошло».
        const what = `Баланс пополнен на ${formatGel(value)} — теперь ${formatGel(balance + value)}`;
        const id = created?.id;
        if (id) offerUndo(id, what, onDone);
        else toast.success(what);
        try {
            await onDone();
        } catch {
            setSaving(false);
        }
    };

    // Вся операция на кнопке: «Пополнить на 40 ₾ · карта TBC · One».
    const opTail = [method ? METHOD_ON_BUTTON[method] : '', branch ? branchLabel(branch) : ''].filter(Boolean);

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
                <>
                    <Button
                        block
                        loading={saving}
                        disabled={value <= 0 || !!missing}
                        onClick={save}
                    >
                        {askTypo
                            ? `Да, внести ${formatGel(value)}`
                            : [`Пополнить на ${value > 0 ? formatGel(value) : '—'}`, ...opTail].join(' · ')}
                    </Button>
                    {missing && value > 0 && (
                        <div data-topup-missing style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            {missing}
                        </div>
                    )}
                </>
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
                        <Input kind="money" suffix="₾" value={amount} placeholder="0" onChange={e => { setAmount(e.target.value); setConfirmFor(null); }} />
                    </Field>
                    {askTypo && (
                        <p role="alert" data-topup-typo style={{ margin: '8px 0 0', fontSize: 14, fontWeight: 600, color: 'var(--status-danger-fg)', background: 'var(--status-danger-bg)', borderRadius: 12, padding: '8px 12px' }}>
                            {topupTypoQuestion(value, expected, formatGel)}
                        </p>
                    )}
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Способ оплаты</div>
                    <Segmented<Method>
                        aria-label="Способ оплаты"
                        options={[
                            { value: 'cash', label: 'Наличные' },
                            { value: 'card_tbc', label: 'Карта TBC' },
                            { value: 'card_bog', label: 'Карта BOG' },
                        ]}
                        value={method as Method}
                        onChange={setMethod}
                    />
                </div>

                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Филиал</div>
                    <Segmented
                        aria-label="Филиал"
                        options={CASH_BRANCHES.map(b => ({ value: b, label: b }))}
                        value={branch}
                        onChange={setBranch}
                    />
                </div>
            </div>
        </Sheet>
    );
}

/**
 * «Баланс пополнен … · Вернуть» 5 с — как своя операция в «Кассе» (В5).
 * Удаление операции пополнения сервер откатывает и на балансе клиента
 * (wallet.debit «topup_reversal»). Двойной тап — второй ничего не делает.
 */
function offerUndo(id: string, what: string, onDone: () => Promise<void> | void) {
    undoToast(what, async () => {
        if (!claimCashUndo(id)) return;
        try {
            await cashboxApi.deleteTransaction(id);
            toast.success('Пополнение отменено — деньги сняты с баланса клиента и из кассы');
        } catch (e) {
            releaseCashUndo(id);
            toastApiError(e, 'Не получилось вернуть — попросите старшего админа удалить операцию');
        } finally {
            try { await onDone(); } catch { /* экран обновится при следующем заходе */ }
        }
    });
}
