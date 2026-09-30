import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ClipboardCheck, Check } from 'lucide-react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { Field, TextArea } from '../../ui/Field';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Called when every checklist item is confirmed. Parent opens the
     *  actual "Закрыть смену" (cash reconciliation) modal from here.
     *  Excel #54 — optional `skipReason` is set when admin bypassed the
     *  checklist via "Пропустить с обоснованием". Parent should persist
     *  it to audit log / shift report notes. */
    onProceed: (skipReason?: string) => void;
}

/**
 * Pre-close checklist — step 1 of the two-step shift closing flow (Excel #53).
 *
 * Rationale from the brief: "состояние центра на момент закрытия не менее
 * важно, чем состояние кассы". The admin cannot reach the cash reconciliation
 * screen until every operational item is ticked. This is a soft gate: items
 * are not persisted, the list resets each time the modal opens. It only
 * prevents accidental clicks on "Закрыть смену" without walking through the
 * mental checklist.
 */

interface Item {
    key: string;
    label: string;
    sub?: string;
}

const ITEMS: Item[] = [
    {
        key: 'bookings',
        label: 'Все брони за день проверены',
        // Excel #74 — rewrite for clarity. "Переведены в соответствующий статус"
        // was opaque; spell out what the two groups are.
        sub: 'Пришедшие клиенты отмечены как посетившие. Неявки помечены «Неявка». Истёкшие без отметки — закрыты.',
    },
    {
        key: 'transactions',
        label: 'Все приходы и расходы внесены в систему',
        sub: 'Включая наличные платежи, переводы на карту, расходы на хоз-нужды',
    },
    {
        key: 'cash_count',
        label: 'Наличные пересчитаны',
        sub: 'Сумма в кассе совпадает с купюрной разбивкой',
    },
    {
        key: 'rooms',
        label: 'Кабинеты осмотрены',
        sub: 'Свет и кондиционеры выключены, кабинеты прибраны, вещей клиентов нет',
    },
    // Excel #75 — "Помещение заперто" moved OUT of the pre-close checklist.
    // Admin cannot physically count cash after locking up; we now remind them
    // AFTER cash reconciliation in EndShiftModal.
];

export function PreCloseShiftChecklist({ isOpen, onClose, onProceed }: Props) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    // «Пропустить с обоснованием» — шторка с полем вместо prompt()/alert().
    const [skipOpen, setSkipOpen] = useState(false);
    const [skipReason, setSkipReason] = useState('');
    const [skipError, setSkipError] = useState('');

    if (!isOpen) return null;

    const allDone = ITEMS.every(i => checked[i.key]);
    const doneCount = ITEMS.filter(i => checked[i.key]).length;

    const toggle = (key: string) => {
        setChecked(c => ({ ...c, [key]: !c[key] }));
    };

    const handleClose = () => {
        setChecked({});  // reset for next time
        onClose();
    };

    const handleProceed = () => {
        if (!allDone) return;
        setChecked({});  // reset for next time
        onProceed();
    };

    // Excel #54 — mandatory checklist was too rigid (can't close if a fire
    // just broke out and you haven't counted the cash yet). Soft bypass with
    // a required reason — still gates the cash step, still audited.
    const handleSkipWithReason = () => {
        setSkipReason('');
        setSkipError('');
        setSkipOpen(true);
    };
    const submitSkip = () => {
        const trimmed = skipReason.trim();
        if (trimmed.length < 5) {
            setSkipError('Напишите причину подробнее — хотя бы 5 символов');
            return;
        }
        setSkipOpen(false);
        setChecked({});
        onProceed(trimmed);
    };

    // Шторка причины — рядом с окном, а не внутри его подложки: клик в шторке
    // (портал) всплывает по дереву React и закрыл бы весь чек-лист.
    const skipSheet = (
        <Sheet
            open={skipOpen}
            onClose={() => setSkipOpen(false)}
            title="Пропустить чек-лист?"
            description="Причина попадёт в журнал закрытия смены. Пропускайте только в нестандартной ситуации."
            width={440}
            footer={
                <>
                    <Button block onClick={submitSkip}>Пропустить и перейти к кассе</Button>
                    <Button variant="secondary" block onClick={() => setSkipOpen(false)}>Вернуться к чек-листу</Button>
                </>
            }
        >
            <Field label="Причина" error={skipError || undefined} required>
                <TextArea
                    rows={3}
                    value={skipReason}
                    onChange={e => { setSkipReason(e.target.value); if (skipError) setSkipError(''); }}
                    placeholder="Например: срочно закрываем, кассу пересчитаем утром"
                />
            </Field>
        </Sheet>
    );

    return <>{skipSheet}{createPortal(
        <div
            className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
            onClick={handleClose}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-md flex flex-col max-h-[90vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-6 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-sunken flex items-center justify-center text-ink-60">
                            <ClipboardCheck size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-gray-900">Закрытие смены · шаг 1 из 2</h3>
                            <p className="text-sm text-gray-500 mt-0.5">Вечерний чек-лист</p>
                        </div>
                    </div>
                    <button onClick={handleClose} aria-label="Закрыть" className="text-ink-60 hover:text-gray-700">
                        <X size={20} />
                    </button>
                </div>

                {/* Progress */}
                <div className="px-6 pt-4 pb-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                        <span>{doneCount} из {ITEMS.length} готово</span>
                        {allDone && (
                            <span className="text-[var(--status-ok-fg)] font-semibold inline-flex items-center gap-1">
                                Всё проверено <Check size={14} aria-hidden="true" />
                            </span>
                        )}
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-[var(--status-ok-fg)] transition-all"
                            style={{ width: `${(doneCount / ITEMS.length) * 100}%` }}
                        />
                    </div>
                </div>

                {/* Checklist */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                    {ITEMS.map((item) => {
                        const isDone = !!checked[item.key];
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => toggle(item.key)}
                                className={
                                    'w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ' +
                                    (isDone
                                        ? 'border-[var(--status-ok-fg)]/30 bg-[var(--status-ok-bg)]'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50')
                                }
                            >
                                <div
                                    className={
                                        'mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ' +
                                        (isDone ? 'bg-[var(--status-ok-fg)] text-white' : 'border-2 border-gray-300 bg-white')
                                    }
                                >
                                    {isDone && <Check size={14} strokeWidth={3} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={'text-sm font-medium ' + (isDone ? 'text-[var(--status-ok-fg)]' : 'text-gray-900')}>
                                        {item.label}
                                    </div>
                                    {item.sub && (
                                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">
                                            {item.sub}
                                        </div>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-gray-100 space-y-2">
                    <button
                        onClick={handleProceed}
                        disabled={!allDone}
                        className={
                            'w-full font-semibold py-3 rounded-xl transition-all ' +
                            (allDone
                                ? 'bg-unbox-green text-white hover:bg-unbox-dark'
                                : 'bg-gray-100 text-ink-60 cursor-not-allowed')
                        }
                    >
                        {allDone ? 'Дальше — сверка кассы' : `Ещё ${ITEMS.length - doneCount} пункт${ITEMS.length - doneCount === 1 ? '' : 'а'}`}
                    </button>
                    {/* Excel #54 — soft bypass. Only offered when the admin
                        hasn't ticked everything, to avoid tempting them to
                        skip when they're already done. */}
                    {!allDone && (
                        <button
                            onClick={handleSkipWithReason}
                            className="w-full text-[var(--status-pending-fg)] text-xs font-semibold py-2 border border-[var(--status-pending-fg)]/30 bg-[var(--status-pending-bg)] hover:brightness-95 rounded-xl transition-colors"
                        >
                            Пропустить с обоснованием →
                        </button>
                    )}
                    <button
                        onClick={handleClose}
                        className="w-full text-gray-500 text-sm font-medium py-1.5 hover:text-gray-800"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    )}</>;
}
