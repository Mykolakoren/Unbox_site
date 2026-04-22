import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

export type RefundOption = 'full' | 'half' | 'none';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (option: RefundOption, reason: string) => void | Promise<void>;
    bookingLabel?: string;
}

/**
 * Excel #66 — admin chooses refund policy when cancelling.
 *
 * Three mutually exclusive refund modes:
 *   full — 100% back to client's balance (default, equivalent to the old behaviour)
 *   half — 50% back, 50% retained as penalty (late cancellation, no-show warning)
 *   none — 0% back, full penalty (no-show, abuse)
 *
 * Reason is free-text and recorded to the timeline + booking.cancellation_reason
 * so admins can justify the choice later. Required for anything other than
 * "full" so half/none penalties always have an audit trail.
 */
export function AdminCancelBookingModal({ isOpen, onClose, onConfirm, bookingLabel }: Props) {
    const [option, setOption] = useState<RefundOption>('full');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setOption('full');
            setReason('');
            setSubmitting(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const penaltyRequiresReason = option !== 'full';
    const reasonIsValid = !penaltyRequiresReason || reason.trim().length >= 3;

    const handleSubmit = async () => {
        if (!reasonIsValid) return;
        setSubmitting(true);
        try {
            await onConfirm(option, reason.trim());
            onClose();
        } finally {
            setSubmitting(false);
        }
    };

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
                    border: `1px solid ${GH.ink}`, width: '100%', maxWidth: 480,
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

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <AlertTriangle size={20} color={GH.danger} />
                    <div style={monoLabel}>Отмена брони</div>
                </div>

                <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 8px' }}>
                    Выберите политику возврата
                </h2>
                {bookingLabel && (
                    <p style={{ fontSize: 13, color: GH.ink60, margin: '0 0 18px' }}>{bookingLabel}</p>
                )}

                <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
                    <OptionRow
                        selected={option === 'full'}
                        onSelect={() => setOption('full')}
                        title="Без штрафа · 100% возврат"
                        desc="Полный возврат на баланс клиента. Используется, если отмена по уважительной причине."
                    />
                    <OptionRow
                        selected={option === 'half'}
                        onSelect={() => setOption('half')}
                        title="Штраф 50% · вернуть половину"
                        desc="Половина суммы возвращается клиенту, половина остаётся центру. Для отмен за <24ч."
                    />
                    <OptionRow
                        selected={option === 'none'}
                        onSelect={() => setOption('none')}
                        title="Полный штраф · возврат 0%"
                        desc="Ничего не возвращается. Для no-show и злоупотреблений."
                        destructive
                    />
                </div>

                {penaltyRequiresReason && (
                    <div style={{ marginBottom: 18 }}>
                        <label style={{ ...monoLabel, display: 'block', marginBottom: 6 }}>
                            Причина штрафа (аудит) *
                        </label>
                        <textarea
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            placeholder="Например: клиент не пришёл, не предупредил"
                            rows={2}
                            style={{
                                width: '100%', padding: '10px 12px', boxSizing: 'border-box',
                                fontFamily: GH_SANS, fontSize: 13,
                                border: `1px solid ${GH.ink10}`, background: GH.paper, color: GH.ink,
                                resize: 'vertical',
                            }}
                        />
                        {!reasonIsValid && (
                            <div style={{ fontSize: 11, color: GH.danger, marginTop: 4 }}>
                                Минимум 3 символа
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                    <button onClick={onClose} disabled={submitting} style={outlineBtn}>
                        Не отменять
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={submitting || !reasonIsValid}
                        style={{ ...inkBtn, opacity: !reasonIsValid ? 0.6 : 1 }}
                    >
                        {submitting ? 'Отмена...' : 'Подтвердить отмену'}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

function OptionRow({
    selected, onSelect, title, desc, destructive,
}: {
    selected: boolean;
    onSelect: () => void;
    title: string;
    desc: string;
    destructive?: boolean;
}) {
    return (
        <button
            onClick={onSelect}
            type="button"
            style={{
                textAlign: 'left', padding: '12px 14px', cursor: 'pointer',
                background: selected ? (destructive ? 'rgba(184,74,47,0.08)' : GH.ink5) : GH.paper,
                border: `1px solid ${selected ? (destructive ? GH.danger : GH.ink) : GH.ink10}`,
                fontFamily: GH_SANS,
                transition: 'background 0.12s, border-color 0.12s',
            }}
        >
            <div style={{
                fontSize: 14, fontWeight: 600,
                color: destructive && selected ? GH.danger : GH.ink,
                marginBottom: 3,
            }}>
                {title}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.45, color: GH.ink60 }}>
                {desc}
            </div>
        </button>
    );
}

const monoLabel: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em',
    textTransform: 'uppercase', color: GH.ink60,
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
