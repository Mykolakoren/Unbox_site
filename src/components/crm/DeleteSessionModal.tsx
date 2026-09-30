import { useState } from 'react';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';

/**
 * Delete-confirm dialog for CRM therapy sessions. When the session is part of
 * a recurring series (created via chessboard "Повторение"), it offers the same
 * choice Google Calendar shows when you delete one occurrence of a recurring
 * event:
 *   • Только эту встречу        — drops just this row
 *   • Эту и все будущие в серии — drops this + every later sibling
 *   • Оставить
 *
 * For one-off sessions (no recurringGroupId) it falls back to a single
 * "Удалить сессию" button so we don't bother the specialist with a meaningless choice.
 *
 * Wave 1 (30.09): вместо самодельного окна с красными Tailwind-кнопками —
 * общая шторка Sheet и Button variant="danger" (цвет --status-danger-solid).
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
    // Пока идёт удаление — кнопки заблокированы, второй клик не уйдёт.
    const [busy, setBusy] = useState<'this' | 'future' | null>(null);

    const run = async (scope: 'this' | 'future') => {
        setBusy(scope);
        try {
            await onConfirm(scope);
        } finally {
            setBusy(null);
            onClose();
        }
    };

    return (
        <Sheet
            open={isOpen}
            onClose={() => { if (!busy) onClose(); }}
            title={isRecurring ? 'Удалить из серии?' : 'Удалить сессию?'}
            role="alertdialog"
            width={420}
            footer={isRecurring ? (
                <>
                    <Button variant="danger" block loading={busy === 'this'} disabled={!!busy} onClick={() => run('this')}>
                        Удалить только эту встречу
                    </Button>
                    <Button variant="danger" block loading={busy === 'future'} disabled={!!busy} onClick={() => run('future')}>
                        Удалить эту и все будущие
                    </Button>
                    <Button variant="secondary" block disabled={!!busy} onClick={onClose}>
                        Оставить
                    </Button>
                </>
            ) : (
                <>
                    <Button variant="danger" block loading={busy === 'this'} disabled={!!busy} onClick={() => run('this')}>
                        Удалить сессию
                    </Button>
                    <Button variant="secondary" block disabled={!!busy} onClick={onClose}>
                        Оставить
                    </Button>
                </>
            )}
        >
            <div style={{ color: 'var(--color-ink-80)' }}>
                {isRecurring ? (
                    <>
                        Эта сессия — часть повторяющейся серии.
                        {label && <div style={{ marginTop: 4, fontWeight: 500, color: 'var(--color-ink)' }}>{label}</div>}
                        <div style={{ marginTop: 8 }}>Что удалить?</div>
                    </>
                ) : (
                    <>
                        Действие нельзя отменить. Событие в Google Calendar тоже удалится.
                        {label && <div style={{ marginTop: 8, fontWeight: 500, color: 'var(--color-ink)' }}>{label}</div>}
                    </>
                )}
            </div>
        </Sheet>
    );
}
