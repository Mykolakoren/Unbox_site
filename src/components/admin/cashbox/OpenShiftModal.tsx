import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Sun } from 'lucide-react';
import { toast } from 'sonner';
import { cashboxApi } from '../../../api/cashbox';
import { useCashboxStore } from '../../../store/cashboxStore';
import { GH, GH_SANS, GH_MONO } from '../../../hooks/useDesignFlag';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onOpened?: () => void;
    /** Pre-fill the branch the admin is opening for. Empty = global. */
    branch?: string;
}

const BRANCHES = ['Unbox Uni', 'Unbox One', 'Neo School'];

/**
 * "Открыть смену" — Excel #61, Иры. Audit-only event with a UX badge:
 * admin presses this in the morning and the finance page shows
 * "Смена открыта в 09:12 by Ира" so it's visually obvious work has started.
 *
 * Doesn't gate anything yet — operations remain accessible. The point is to
 * remove the "we're working blind" feeling reported in feedback.
 */
export function OpenShiftModal({ isOpen, onClose, onOpened, branch = '' }: Props) {
    const { balances } = useCashboxStore();
    const [selectedBranch, setSelectedBranch] = useState(branch);
    const [startingBalance, setStartingBalance] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setSelectedBranch(branch);
            setStartingBalance(balances?.cash != null ? balances.cash.toFixed(2) : '');
            setNotes('');
        }
    }, [isOpen, branch, balances?.cash]);

    const handleSubmit = async () => {
        const startingNum = parseFloat(startingBalance);
        if (isNaN(startingNum) || startingNum < 0) {
            toast.error('Укажите корректный стартовый остаток');
            return;
        }
        setSaving(true);
        try {
            await cashboxApi.openShift({
                branch: selectedBranch || undefined,
                starting_balance: startingNum,
                notes: notes.trim() || undefined,
            });
            toast.success('Смена открыта');
            onOpened?.();
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось открыть смену');
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(15,15,16,0.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 20,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: GH.paper, color: GH.ink, fontFamily: GH_SANS,
                    border: `1px solid ${GH.ink}`, width: '100%', maxWidth: 460,
                    padding: 28, position: 'relative',
                }}
            >
                <button
                    onClick={onClose}
                    aria-label="Закрыть"
                    style={{
                        position: 'absolute', top: 14, right: 14,
                        background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60,
                    }}
                >
                    <X size={18} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                    <Sun size={22} />
                    <div style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 }}>
                        Старт смены
                    </div>
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px', letterSpacing: '-0.01em' }}>
                    Открыть смену
                </h2>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: GH.ink60, margin: '0 0 22px' }}>
                    Подтверждение приёма кассы. Запись попадает в журнал —
                    видно, кто и когда начал работать.
                </p>

                {/* Branch */}
                <label style={labelStyle}>Филиал</label>
                <select
                    value={selectedBranch}
                    onChange={e => setSelectedBranch(e.target.value)}
                    style={{ ...inputStyle, marginBottom: 16 }}
                >
                    <option value="">Все филиалы</option>
                    {BRANCHES.map(b => (
                        <option key={b} value={b}>{b}</option>
                    ))}
                </select>

                {/* Starting cash */}
                <label style={labelStyle}>Наличные в кассе на старте, ₾</label>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={startingBalance}
                    onChange={e => setStartingBalance(e.target.value)}
                    placeholder="0.00"
                    style={{ ...inputStyle, marginBottom: 16, fontFamily: GH_MONO }}
                />

                {/* Notes */}
                <label style={labelStyle}>Заметка (опционально)</label>
                <textarea
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Например: «Принял кассу от Иры, расхождений нет»"
                    rows={3}
                    style={{ ...inputStyle, marginBottom: 22, resize: 'vertical', fontFamily: GH_SANS }}
                />

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button onClick={onClose} disabled={saving} style={outlineBtn}>
                        Отмена
                    </button>
                    <button onClick={handleSubmit} disabled={saving} style={inkBtn}>
                        {saving ? 'Сохранение...' : 'Открыть смену'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: GH.ink60, marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${GH.ink10}`,
    background: GH.paper,
    color: GH.ink,
    fontSize: 14,
    boxSizing: 'border-box',
};

const inkBtn: React.CSSProperties = {
    padding: '10px 18px',
    background: GH.ink,
    color: GH.paper,
    border: `1px solid ${GH.ink}`,
    fontFamily: GH_MONO,
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
};

const outlineBtn: React.CSSProperties = {
    padding: '10px 18px',
    background: 'transparent',
    color: GH.ink,
    border: `1px solid ${GH.ink}`,
    fontFamily: GH_MONO,
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
