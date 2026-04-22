import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun, Check } from 'lucide-react';

/**
 * Excel #54 variant B — morning checklist as a *soft* reminder, not a
 * blocking gate.
 *
 * Behaviour:
 *   - Shown at most once per calendar day per admin (persisted in
 *     localStorage key `unbox_morning_checklist_<YYYY-MM-DD>_<user>`).
 *   - Closable with ✕ or "Позже" — doesn't gate access to Finance.
 *   - "Готово" ticks the day and dismisses, marking the admin as
 *     having acknowledged it.
 *
 * The items are operational: what the admin verifies when opening the
 * centre in the morning. No money math.
 */

const ITEMS = [
    { key: 'lights', label: 'Свет, кондиционеры, роутеры включены' },
    { key: 'cleaning', label: 'Клининг прошёл, кабинеты готовы к приёму' },
    { key: 'cash', label: 'Касса на месте — есть размен на ₾20 и ₾50' },
    { key: 'schedule', label: 'Расписание на день просмотрено' },
];

function storageKey(userEmail: string): string {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `unbox_morning_checklist_${today}_${userEmail}`;
}

interface Props {
    /** Current admin email — used to key the per-day seen flag. */
    adminEmail: string;
}

export function MorningChecklistModal({ adminEmail }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [checked, setChecked] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!adminEmail) return;
        try {
            const key = storageKey(adminEmail);
            const seen = localStorage.getItem(key);
            if (!seen) setIsOpen(true);
        } catch {
            // localStorage unavailable — fail open, don't show
        }
    }, [adminEmail]);

    if (!isOpen) return null;

    const allDone = ITEMS.every(i => checked[i.key]);

    const markSeen = () => {
        try {
            localStorage.setItem(storageKey(adminEmail), new Date().toISOString());
        } catch { /* ignore */ }
    };

    const handleDismiss = () => {
        // "Позже" — don't mark as done, just close for this session. Will
        // show again if admin refreshes the page during the same day.
        setIsOpen(false);
    };

    const handleAcknowledge = () => {
        markSeen();
        setIsOpen(false);
    };

    return createPortal(
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={handleDismiss}
        >
            <div
                className="bg-white rounded-2xl w-full max-w-md flex flex-col max-h-[90vh] shadow-xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-100">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600">
                            <Sun size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-gray-900">Доброе утро</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Короткий чек-лист открытия центра</p>
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="text-gray-400 hover:text-gray-700"
                        title="Позже"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Checklist */}
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                    {ITEMS.map((item) => {
                        const isDone = !!checked[item.key];
                        return (
                            <button
                                key={item.key}
                                type="button"
                                onClick={() => setChecked(c => ({ ...c, [item.key]: !c[item.key] }))}
                                className={
                                    'w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ' +
                                    (isDone
                                        ? 'border-emerald-300 bg-emerald-50'
                                        : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50')
                                }
                            >
                                <div
                                    className={
                                        'w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors ' +
                                        (isDone ? 'bg-emerald-500 text-white' : 'border-2 border-gray-300 bg-white')
                                    }
                                >
                                    {isDone && <Check size={14} strokeWidth={3} />}
                                </div>
                                <span className={'text-sm ' + (isDone ? 'text-emerald-800 font-medium' : 'text-gray-900')}>
                                    {item.label}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-gray-100 space-y-2">
                    <button
                        onClick={handleAcknowledge}
                        className={
                            'w-full font-semibold py-2.5 rounded-xl transition-all ' +
                            (allDone
                                ? 'bg-unbox-green text-white hover:bg-unbox-dark'
                                : 'bg-unbox-light text-unbox-dark hover:bg-unbox-light/80')
                        }
                    >
                        {allDone ? 'Всё проверено — начать день' : 'Принято, больше не показывать сегодня'}
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="w-full text-gray-500 text-xs font-medium py-1.5 hover:text-gray-800"
                    >
                        Позже (покажется снова)
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
