import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { cashboxApi } from '../../../api/cashbox';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input, TextArea } from '../../../components/ui/Field';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatGel } from '../../../utils/format';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from './parseMoneyInput';

/**
 * Mobile close-shift flow — упрощённая версия десктопной 2-шаговой модалки.
 * Один лист с чек-листом сверху + поле «факт наличных» снизу. Submit
 * блокируется пока все чекбоксы не отмечены и не указана сумма.
 *
 * Owner 2026-06-05: раньше закрытие смены было только на десктопе, и
 * Валентина застряла в админке One — не могла закрыть кассу с iPhone.
 * Эта версия — точная функциональная копия EndShiftModal, без графиков
 * и доп. опций; для нестандартных случаев останется десктоп через
 * ?forceDesktop=1.
 *
 * Wave 1: общий Sheet (кнопка «Закрыть смену» в подвале всегда видна),
 * расхождение без причины — окном подтверждения, а не confirm(); суммы —
 * formatGel; подсказка под кнопкой говорит, чего именно не хватает.
 */
interface Props {
    /** Бэкенд принимает branch как строку-метку (например «Unbox One»). */
    branch: string;
    /** Текущий баланс кассы по системе (для подсказки в форме). */
    systemBalance: number;
    onClose: () => void;
    onClosed: () => void;
}

interface ChecklistItem {
    key: string;
    label: string;
    sub: string;
}

const CHECKLIST: ChecklistItem[] = [
    {
        key: 'bookings',
        label: 'Все брони проверены',
        sub: 'Пришедшие отмечены, неявки отмечены, истёкшие закрыты',
    },
    {
        key: 'transactions',
        label: 'Все приходы и расходы внесены',
        sub: 'Наличные, переводы, мелкие расходы',
    },
    {
        key: 'cash_count',
        label: 'Наличные пересчитаны',
        sub: 'Сумма в кассе совпадает с купюрной разбивкой',
    },
    {
        key: 'rooms',
        label: 'Кабинеты осмотрены',
        sub: 'Свет и кондиционер выключены, вещей клиентов нет',
    },
];

export function MobileCloseShiftSheet({ branch, systemBalance, onClose, onClosed }: Props) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [actualBalance, setActualBalance] = useState<string>('');
    const [notes, setNotes] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [preview, setPreview] = useState<Awaited<ReturnType<typeof cashboxApi.previewCloseShift>> | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const { confirm } = useConfirmDialog();

    // Подгружаем preview сразу при открытии — там настоящее expected,
    // которое сервер сравнит с введённой суммой.
    useEffect(() => {
        let alive = true;
        cashboxApi.previewCloseShift(branch)
            .then(p => { if (alive) setPreview(p); })
            .catch(e => {
                if (alive) setPreviewError(e?.response?.data?.detail || 'Не удалось получить ожидаемую сумму — показан остаток по кассе');
            });
        return () => { alive = false; };
    }, [branch]);

    const allChecked = CHECKLIST.every(i => checked[i.key]);
    // Ревью 30.09: раньше replace(/[\s,]/g, '.') превращал «1 280,50» в 1.28 ₾.
    // Общий разбор: пробелы убираем, одна запятая или точка, остальное — ошибка.
    const parsedActual = parseMoneyInput(actualBalance);
    const hasAmount = parsedActual !== null;
    const actualNum = parsedActual ?? 0;
    const amountError = !isMoneyInputBlank(actualBalance) && parsedActual === null ? MONEY_INPUT_ERROR : undefined;
    const expected = preview?.expected ?? systemBalance;
    // До тетри: без float-шума вида 0.1 + 0.2 в подписи расхождения.
    const drift = hasAmount ? Math.round((actualNum - expected) * 100) / 100 : 0;
    const hasDrift = hasAmount && Math.abs(drift) >= 0.01;
    const canSubmit = allChecked && hasAmount && !submitting;

    const branchLabel = branch;

    // Подсказка под кнопкой — что именно мешает закрыть смену.
    const missingHint = amountError
        ? 'Проверьте сумму в кассе'
        : !allChecked && !hasAmount
            ? 'Отметьте все пункты чек-листа и введите сумму в кассе'
            : !allChecked
                ? 'Отметьте все пункты чек-листа'
                : !hasAmount
                    ? 'Введите, сколько наличных в кассе'
                    : null;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        if (hasDrift && !notes.trim()) {
            const ok = await confirm({
                title: 'Закрыть смену без причины расхождения?',
                body: `Расхождение ${formatGel(drift, { sign: true })}: в кассе ${formatGel(actualNum)}, ожидалось ${formatGel(expected)}. Лучше коротко пояснить в поле «Заметки».`,
                confirmLabel: 'Закрыть без причины',
                cancelLabel: 'Добавить причину',
            });
            if (!ok) return;
        }
        setSubmitting(true);
        try {
            await cashboxApi.endShift({
                actual_balance: actualNum,
                notes: notes.trim() || undefined,
                branch,
            });
            toast.success(`Смена закрыта — ${branchLabel}`);
            onClosed();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось закрыть смену. Попробуйте ещё раз');
            setSubmitting(false);
        }
    };

    return (
        <Sheet
            open
            onClose={onClose}
            title="Закрытие смены"
            description={branchLabel}
            footer={
                <>
                    <Button
                        block
                        loading={submitting}
                        disabled={!canSubmit}
                        icon={<Lock size={16} aria-hidden="true" />}
                        onClick={handleSubmit}
                    >
                        Закрыть смену · {branchLabel}
                    </Button>
                    {missingHint && (
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)', textAlign: 'center' }}>
                            {missingHint}
                        </div>
                    )}
                </>
            }
        >
            {/* Checklist */}
            <div role="group" aria-label="Чек-лист закрытия" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {CHECKLIST.map(item => {
                    const isOn = !!checked[item.key];
                    return (
                        <label
                            key={item.key}
                            style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '12px',
                                minHeight: 44,
                                background: isOn ? 'var(--status-ok-bg)' : 'var(--color-sunken)',
                                borderRadius: 10, cursor: 'pointer',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={isOn}
                                onChange={e => setChecked(c => ({ ...c, [item.key]: e.target.checked }))}
                                style={{
                                    width: 20, height: 20, marginTop: 2,
                                    cursor: 'pointer', flexShrink: 0,
                                    accentColor: 'var(--color-accent)',
                                }}
                            />
                            <div style={{ flex: 1 }}>
                                <div style={{
                                    fontSize: 14, fontWeight: 600,
                                    color: isOn ? 'var(--status-ok-fg)' : 'var(--color-ink)',
                                }}>
                                    {item.label}
                                </div>
                                <div style={{
                                    fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2, lineHeight: 1.45,
                                }}>
                                    {item.sub}
                                </div>
                            </div>
                        </label>
                    );
                })}
            </div>

            {/* Cash count */}
            <div style={{
                background: 'var(--color-sunken)', borderRadius: 12, padding: '14px 16px',
                display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink-60)' }}>
                        По системе в кассе должно быть
                    </div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>
                        {formatGel(expected)}
                    </div>
                    {previewError && (
                        <div style={{ fontSize: 12, color: 'var(--status-danger-fg)', marginTop: 4 }}>
                            {previewError}
                        </div>
                    )}
                </div>

                <Field label="Фактически в кассе" error={amountError}>
                    <Input
                        kind="money"
                        suffix="₾"
                        placeholder="Например, 1280"
                        value={actualBalance}
                        onChange={e => setActualBalance(e.target.value)}
                    />
                </Field>

                {hasAmount && (
                    <div style={{
                        display: 'flex', justifyContent: 'space-between',
                        fontSize: 14,
                        color: hasDrift ? 'var(--status-danger-fg)' : 'var(--status-ok-fg)',
                        fontWeight: 600,
                    }}>
                        <span>Расхождение</span>
                        <span className="num">
                            {formatGel(drift, { sign: true })}
                        </span>
                    </div>
                )}

                <Field
                    label={hasDrift ? 'Заметки — откуда расхождение' : 'Заметки'}
                    optional={!hasDrift}
                >
                    <TextArea
                        placeholder={hasDrift
                            ? 'Сдача, недосчёт, инкассация…'
                            : 'Свободный комментарий'}
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        rows={hasDrift ? 3 : 2}
                    />
                </Field>
            </div>
        </Sheet>
    );
}
