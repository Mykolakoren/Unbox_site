import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { cashboxApi } from '../../../api/cashbox';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    branch?: string;
    /** Excel #54 — if the admin bypassed the pre-close checklist with a
     *  justification, that reason is passed here and appended to the shift
     *  report notes so the audit log records why the list was skipped. */
    checklistSkipReason?: string;
}

export function EndShiftModal({ isOpen, onClose, branch, checklistSkipReason }: Props) {
    const { balances, endShift } = useCashboxStore();
    const [actualBalance, setActualBalance] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [branchCash, setBranchCash] = useState<number | null>(null);
    const [loadingBranchCash, setLoadingBranchCash] = useState(false);
    // Excel #13 — backend breakdown so the admin can see how `expected` is
    // made up (starting + cash_in − cash_out) and spot backdated txs.
    const [preview, setPreview] = useState<Awaited<ReturnType<typeof cashboxApi.previewCloseShift>> | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setActualBalance('');
        setNotes('');
        setPreview(null);
        // Preview runs for every open; branch filter applied at backend.
        cashboxApi.previewCloseShift(branch || undefined)
            .then(setPreview)
            .catch(() => setPreview(null));
        if (branch) {
            setLoadingBranchCash(true);
            setBranchCash(null);
            cashboxApi.getBalance(branch)
                .then(b => setBranchCash(b.cash))
                .catch(() => setBranchCash(null))
                .finally(() => setLoadingBranchCash(false));
        } else {
            setBranchCash(null);
            setLoadingBranchCash(false);
        }
    }, [isOpen, branch]);

    if (!isOpen) return null;

    // For branch closes use the freshly fetched per-branch cash. For global
    // closes fall back to the store's overall cash total.
    // Defensive Number() — a missing `balances.cash` (store not yet populated,
    // or backend returning `{}`) blew up .toFixed() and crashed the whole
    // /admin/finance boundary. Reported by Иры.
    const cashBalance = Number(branch ? (branchCash ?? 0) : (balances?.cash ?? 0));

    const actualValue = parseFloat(actualBalance);
    const hasAmount = !isNaN(actualValue) && actualValue >= 0;
    const discrepancy = hasAmount && !loadingBranchCash
        ? Math.round((actualValue - cashBalance) * 100) / 100
        : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!hasAmount) {
            toast.error('Введите сумму в кассе');
            return;
        }
        setSaving(true);
        // Excel #54 — if the checklist was bypassed, prepend the reason to
        // notes so the shift report carries the justification forward.
        const finalNotes = checklistSkipReason
            ? `[Чек-лист пропущен: ${checklistSkipReason}]${notes ? '\n\n' + notes : ''}`
            : notes || undefined;
        try {
            const report = await endShift({
                actual_balance: actualValue,
                notes: finalNotes,
                branch: branch || undefined,
            });
            const disc = Number(report.discrepancy ?? 0);
            if (Math.abs(disc) < 0.01) {
                toast.success('Смена закрыта — расхождений нет');
            } else {
                toast.warning(`Смена закрыта — расхождение: ${disc > 0 ? '+' : ''}${disc.toFixed(2)} ₾`);
            }
            // Excel #75 — final lock-up reminder AFTER cash reconciliation.
            // Casa is now sealed in the report; admin can safely lock up and leave.
            // Long duration so admins walking out of the centre actually see it.
            toast('🔒 Не забудьте: запереть двери, закрыть окна, активировать сигнализацию', {
                duration: 15000,
                style: {
                    background: '#fef3c7',
                    border: '1px solid #fbbf24',
                    color: '#92400e',
                    fontWeight: 500,
                },
            });
            onClose();
        } catch {
            toast.error('Ошибка закрытия смены');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={onClose}
            />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-95 duration-200">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
                >
                    <X size={20} />
                </button>

                <h3 className="text-lg font-bold text-unbox-dark mb-1">Закрытие смены</h3>
                {checklistSkipReason && (
                    <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-xs text-amber-800">
                        <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                        <div>
                            <div className="font-semibold mb-0.5">Чек-лист пропущен</div>
                            <div className="leading-snug">«{checklistSkipReason}» — записано в журнал смены.</div>
                        </div>
                    </div>
                )}
                <p className="text-sm text-unbox-grey mb-5">
                    {branch
                        ? <>Филиал: <span className="font-semibold text-unbox-dark">{branch}</span> · пересчитайте наличные в кассе</>
                        : 'Общая касса · пересчитайте наличные во всех кассах'}
                </p>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Expected cash balance */}
                    <div className="bg-gray-50 rounded-xl px-4 py-3">
                        <div className="text-xs text-gray-500 mb-0.5">
                            Ожидаемый остаток наличных {branch && <span className="text-unbox-grey/70">· {branch}</span>}
                        </div>
                        <div className="text-xl font-bold text-unbox-dark flex items-center gap-2">
                            {loadingBranchCash
                                ? <><Loader2 size={18} className="animate-spin" /> <span className="text-gray-400 text-base">загрузка...</span></>
                                : `${cashBalance.toFixed(2)} ₾`}
                        </div>
                        {/* Excel #13 — backend breakdown so the admin can audit
                            where the expected figure came from. If the totals
                            don't match the display above, a backdated tx in
                            this branch's period is the usual culprit. */}
                        {preview && (
                            <div className="mt-2 pt-2 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
                                <div className="flex justify-between">
                                    <span>Остаток с прошлой смены</span>
                                    <span className="font-mono">{Number(preview.starting_balance ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between text-emerald-700">
                                    <span>+ Приход за смену</span>
                                    <span className="font-mono">{Number(preview.cash_in ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between text-red-700">
                                    <span>− Расход за смену</span>
                                    <span className="font-mono">{Number(preview.cash_out ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between font-semibold text-gray-700 mt-1 pt-1 border-t border-gray-100">
                                    <span>= Ожидается</span>
                                    <span className="font-mono">{Number(preview.expected ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="text-gray-400 mt-1">
                                    Движений за период: {preview.tx_count ?? 0}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Actual balance */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                            Фактически в кассе (₾)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            value={actualBalance}
                            onChange={e => setActualBalance(e.target.value)}
                            placeholder="0.00"
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green transition-shadow text-lg font-medium"
                            autoFocus
                        />
                    </div>

                    {/* Discrepancy indicator */}
                    {discrepancy !== null && (
                        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
                            Math.abs(discrepancy) < 0.01
                                ? 'bg-green-50 text-green-700'
                                : 'bg-amber-50 text-amber-700'
                        }`}>
                            {Math.abs(discrepancy) < 0.01
                                ? <CheckCircle size={16} />
                                : <AlertTriangle size={16} />}
                            {Math.abs(discrepancy) < 0.01
                                ? 'Расхождений нет'
                                : `Расхождение: ${discrepancy > 0 ? '+' : ''}${discrepancy.toFixed(2)} ₾`}
                        </div>
                    )}

                    {/* Notes */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Комментарий</label>
                        <textarea
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Необязательно..."
                            rows={2}
                            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm resize-none"
                        />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-3 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !hasAmount}
                            className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60"
                        >
                            {saving ? 'Сохранение...' : 'Закрыть смену'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body,
    );
}
