import { useState, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle, Loader2 } from 'lucide-react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import { cashboxApi } from '../../../api/cashbox';

const BRANCHES = ['Unbox Uni', 'Unbox One'] as const;

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Pre-selected branch when the modal is opened from a branch-scoped view.
     *  The admin still has to confirm/change it via the picker — accidental
     *  closes against the wrong branch were trashing the cash math. */
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
    // Branch is now selectable inside the modal — explicitly REQUIRED before
    // the close button enables. We seed from the `branch` prop (admin opened
    // from a branch-scoped pane) but still let them flip if they realise it's
    // wrong. Empty string = "not selected yet".
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    // Excel #13 — backend breakdown so the admin can see how `expected` is
    // made up (starting + cash_in − cash_out) and spot backdated txs.
    const [preview, setPreview] = useState<Awaited<ReturnType<typeof cashboxApi.previewCloseShift>> | null>(null);

    // Reset everything when the modal opens. Branch comes from the prop the
    // first time around — admin can change it via the picker.
    useEffect(() => {
        if (!isOpen) return;
        setActualBalance('');
        setNotes('');
        setPreview(null);
        setSelectedBranch(branch || '');
    }, [isOpen, branch]);

    // Re-fetch preview + branch cash whenever the selected branch changes.
    // Without a branch we don't fetch — admin has to pick one first.
    useEffect(() => {
        if (!isOpen) return;
        if (!selectedBranch) {
            setPreview(null);
            setBranchCash(null);
            setLoadingBranchCash(false);
            return;
        }
        cashboxApi.previewCloseShift(selectedBranch)
            .then(setPreview)
            .catch(() => setPreview(null));
        setLoadingBranchCash(true);
        setBranchCash(null);
        cashboxApi.getBalance(selectedBranch)
            .then(b => setBranchCash(b.cash))
            .catch(() => setBranchCash(null))
            .finally(() => setLoadingBranchCash(false));
    }, [isOpen, selectedBranch]);

    if (!isOpen) return null;

    // Lifetime cash balance for the branch (every cash income minus every
    // cash expense ever). Useful as a sanity check, but it is NOT what the
    // backend will compare against — that's `preview.expected`, the
    // algorithm's "previous shift's actual + this shift's flow". When prior
    // shifts ended with discrepancies, the two numbers drift apart, and an
    // admin who typed the lifetime number (because the till physically
    // showed it) ended up with a phantom -82.5 ₾ "discrepancy" because the
    // backend was comparing against the algorithm number instead.
    const lifetimeBalance = Number(selectedBranch ? (branchCash ?? 0) : (balances?.cash ?? 0));
    // Drive the headline number from the preview — same number the backend
    // will use to compute discrepancy on submit. Falls back to lifetime
    // until preview loads so the modal doesn't render an empty box.
    const expectedBalance = preview ? Number(preview.expected ?? lifetimeBalance) : lifetimeBalance;
    const drift = preview ? Math.round((lifetimeBalance - expectedBalance) * 100) / 100 : 0;

    const actualValue = parseFloat(actualBalance);
    const hasAmount = !isNaN(actualValue) && actualValue >= 0;
    const discrepancy = hasAmount && !loadingBranchCash && preview
        ? Math.round((actualValue - expectedBalance) * 100) / 100
        : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Branch is required — picking the wrong branch silently re-anchors
        // an entire location's cash math, so we never let admins close
        // without an explicit choice.
        if (!selectedBranch) {
            toast.error('Выберите филиал');
            return;
        }
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
                branch: selectedBranch,
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
                <p className="text-sm text-unbox-grey mb-3">
                    Выберите филиал — кассу которого вы закрываете. От этого зависит «ожидаемый остаток».
                </p>

                {/* Branch picker — REQUIRED. Closing without an explicit branch
                    would mix all locations' cash and silently re-anchor the
                    next shift's expected. Picker uses chip-style buttons so
                    the active branch is unambiguous. */}
                <div className="mb-4">
                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
                        Филиал <span className="text-red-500">*</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {BRANCHES.map(b => {
                            const active = selectedBranch === b;
                            return (
                                <button
                                    key={b}
                                    type="button"
                                    onClick={() => setSelectedBranch(b)}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                                        active
                                            ? 'bg-unbox-dark text-white border-unbox-dark'
                                            : 'bg-white text-unbox-dark border-gray-200 hover:border-unbox-dark/40'
                                    }`}
                                >
                                    {b}
                                </button>
                            );
                        })}
                    </div>
                    {!selectedBranch && (
                        <div className="mt-2 text-xs text-amber-700 flex items-start gap-1.5">
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                            <span>Закрытие без указания филиала отключено — выберите выше.</span>
                        </div>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Expected cash balance — uses the SAME number the backend
                        will compare against on submit (preview.expected),
                        not the lifetime cash sum. They drift apart when past
                        shifts ended with un-reconciled discrepancies, and the
                        old layout silently showed the wrong number which
                        admins then typed verbatim → phantom discrepancy. */}
                    <div className="bg-gray-50 rounded-xl px-4 py-3">
                        <div className="text-xs text-gray-500 mb-0.5">
                            Ожидаемый остаток наличных {selectedBranch && <span className="text-unbox-grey/70">· {selectedBranch}</span>}
                        </div>
                        <div className="text-xl font-bold text-unbox-dark flex items-center gap-2">
                            {!selectedBranch
                                ? <span className="text-gray-400 text-base font-medium">Выберите филиал ↑</span>
                                : loadingBranchCash || !preview
                                    ? <><Loader2 size={18} className="animate-spin" /> <span className="text-gray-400 text-base">загрузка...</span></>
                                    : `${expectedBalance.toFixed(2)} ₾`}
                        </div>
                        {/* Drift warning: if total cash flow ever ≠ algorithm's
                            running expected, surface it so the admin knows
                            their till is "supposed" to physically have one
                            number while history says another. Past
                            un-reconciled discrepancies live here. */}
                        {preview && Math.abs(drift) >= 0.01 && (
                            <div className="mt-1 text-[11px] text-amber-700 leading-snug">
                                ⚠ Сумма по истории ({lifetimeBalance.toFixed(2)} ₾) расходится с ожидаемой на {drift > 0 ? '+' : ''}{drift.toFixed(2)} ₾ — накопилось из прошлых незакрытых расхождений.
                            </div>
                        )}
                        {/* Excel #13 — backend breakdown so the admin can audit
                            where the expected figure came from. If the totals
                            don't match the display above, a backdated tx in
                            this branch's period is the usual culprit.
                            Note: API transformer converts snake_case → camelCase,
                            so we read `startingBalance`, not `starting_balance`
                            (root cause of the Safari crash admins reported). */}
                        {preview && (
                            <div className="mt-2 pt-2 border-t border-gray-200 text-[11px] text-gray-500 leading-relaxed">
                                <div className="flex justify-between">
                                    <span>Остаток с прошлой смены</span>
                                    <span className="font-mono">{Number(preview.startingBalance ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between text-emerald-700">
                                    <span>+ Приход за смену</span>
                                    <span className="font-mono">{Number(preview.cashIn ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between text-red-700">
                                    <span>− Расход за смену</span>
                                    <span className="font-mono">{Number(preview.cashOut ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="flex justify-between font-semibold text-gray-700 mt-1 pt-1 border-t border-gray-100">
                                    <span>= Ожидается</span>
                                    <span className="font-mono">{Number(preview.expected ?? 0).toFixed(2)} ₾</span>
                                </div>
                                <div className="text-gray-400 mt-1">
                                    Движений за период: {preview.txCount ?? 0}
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
                            disabled={saving || !hasAmount || !selectedBranch}
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
