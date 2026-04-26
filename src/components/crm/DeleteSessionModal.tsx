import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../ui/Button';

/**
 * Delete-confirm dialog for CRM therapy sessions. When the session is part of
 * a recurring series (created via chessboard "Повторение"), it offers the same
 * choice Google Calendar shows when you delete one occurrence of a recurring
 * event:
 *   • Только эту встречу        — drops just this row
 *   • Эту и все будущие в серии — drops this + every later sibling
 *   • Отмена
 *
 * For one-off sessions (no recurringGroupId) it falls back to a single
 * "Удалить" button so we don't bother the specialist with a meaningless choice.
 */
export interface DeleteSessionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (scope: 'this' | 'future') => void | Promise<void>;
    /** True when this session has siblings — flips on the 3-option layout. */
    isRecurring: boolean;
    /** "01.05.2026 18:00" or similar; shown in the dialog body for clarity. */
    label?: string;
}

export function DeleteSessionModal({
    isOpen,
    onClose,
    onConfirm,
    isRecurring,
    label,
}: DeleteSessionModalProps) {
    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200 transform">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-unbox-grey hover:text-unbox-dark transition-colors"
                >
                    <X size={20} />
                </button>

                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 bg-red-100 text-red-600">
                        <AlertTriangle size={24} />
                    </div>

                    <h3 className="text-xl font-bold text-unbox-dark mb-2">
                        {isRecurring ? 'Удалить из серии?' : 'Удалить сессию?'}
                    </h3>

                    <div className="text-unbox-grey mb-6 text-sm leading-relaxed">
                        {isRecurring ? (
                            <>
                                Эта сессия — часть повторяющейся серии.
                                {label && <div className="mt-1 font-medium text-unbox-dark">{label}</div>}
                                <div className="mt-2">Что удалить?</div>
                            </>
                        ) : (
                            <>
                                Действие нельзя отменить. Также удалится событие в Google Calendar.
                                {label && <div className="mt-2 font-medium text-unbox-dark">{label}</div>}
                            </>
                        )}
                    </div>

                    {isRecurring ? (
                        <div className="flex flex-col gap-2 w-full">
                            <Button
                                variant="ghost"
                                className="w-full bg-red-600 text-white hover:bg-red-700 hover:text-white"
                                onClick={async () => {
                                    await onConfirm('this');
                                    onClose();
                                }}
                            >
                                Только эту встречу
                            </Button>
                            <Button
                                variant="ghost"
                                className="w-full bg-red-600 text-white hover:bg-red-700 hover:text-white"
                                onClick={async () => {
                                    await onConfirm('future');
                                    onClose();
                                }}
                            >
                                Эту и все будущие в серии
                            </Button>
                            <Button variant="outline" className="w-full" onClick={onClose}>
                                Отмена
                            </Button>
                        </div>
                    ) : (
                        <div className="flex gap-3 w-full">
                            <Button variant="outline" className="flex-1" onClick={onClose}>
                                Отмена
                            </Button>
                            <Button
                                variant="ghost"
                                className="flex-1 bg-red-600 text-white hover:bg-red-700 hover:text-white"
                                onClick={async () => {
                                    await onConfirm('this');
                                    onClose();
                                }}
                            >
                                Удалить
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body,
    );
}
