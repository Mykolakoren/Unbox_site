import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ClipboardCheck, Check } from 'lucide-react';

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
        sub: 'Пришедшие клиенты отмечены как посетившие. Неявки помечены "No-show". Истёкшие без отметки — закрыты.',
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
    {
        key: 'secured',
        label: 'Помещение заперто',
        sub: 'Окна закрыты, двери заперты, сигнализация (если есть) активирована',
    },
];

export function PreCloseShiftChecklist({ isOpen, onClose, onProceed }: Props) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});

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
        const reason = window.prompt(
            'Пропустить чек-лист с обоснованием?\n\n' +
            'Причина попадёт в журнал закрытия смены. Используйте только в нестандартных ситуациях.\n\n' +
            'Укажите причину:',
            '',
        );
        if (reason === null) return; // cancelled
        const trimmed = reason.trim();
        if (trimmed.length < 5) {
            window.alert('Слишком короткая причина (минимум 5 символов).');
            return;
        }
        setChecked({});
        onProceed(trimmed);
    };

    return createPortal(
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
                        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                            <ClipboardCheck size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-gray-900">Закрытие смены · шаг 1 из 2</h3>
                            <p className="text-sm text-gray-500 mt-0.5">Вечерний чек-лист</p>
                        </div>
                    </div>
                    <button onClick={handleClose} className="text-gray-400 hover:text-gray-700">
                        <X size={20} />
                    </button>
                </div>

                {/* Progress */}
                <div className="px-6 pt-4 pb-2">
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
                        <span>{doneCount} из {ITEMS.length} готово</span>
                        {allDone && <span className="text-emerald-600 font-semibold">Всё проверено ✓</span>}
                    </div>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-emerald-500 transition-all"
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
                                        ? 'border-emerald-300 bg-emerald-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50')
                                }
                            >
                                <div
                                    className={
                                        'mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ' +
                                        (isDone ? 'bg-emerald-500 text-white' : 'border-2 border-gray-300 bg-white')
                                    }
                                >
                                    {isDone && <Check size={14} strokeWidth={3} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className={'text-sm font-medium ' + (isDone ? 'text-emerald-800' : 'text-gray-900')}>
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
                                : 'bg-gray-100 text-gray-400 cursor-not-allowed')
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
                            className="w-full text-amber-700 hover:text-amber-900 text-xs font-semibold py-2 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-xl transition-colors"
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
    );
}
