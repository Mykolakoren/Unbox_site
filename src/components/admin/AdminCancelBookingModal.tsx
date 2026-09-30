import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { STATUS } from '../../design/tokens';
import type { BookingHistoryItem } from '../../store/types';
import { ruCountWord } from '../../utils/plural';

export type RefundOption = 'full' | 'half' | 'none';
/** single — только эта бронь; series — эта и все следующие брони серии. */
export type CancelScope = 'single' | 'series';

/** Что отменит «эту и все следующие»: подписи для окна. */
export interface SeriesTail {
    /** «29.09, 10:00» — сама бронь, на которой нажали «Отменить». */
    thisLabel: string;
    /** Сколько броней отменится вместе с этой (включая её). */
    count: number;
    /** «17.11» — дата последней брони, которая отменится. */
    lastLabel: string;
}

const BOOKING_FORMS: [string, string, string] = ['бронь', 'брони', 'броней'];

// День брони «YYYY-MM-DD» (Тбилиси-наивно, как хранится).
function bookingDayKey(b: BookingHistoryItem): string {
    const raw: any = b.date;
    if (typeof raw === 'string') return raw.split('T')[0].split(' ')[0];
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const dayLabel = (key: string) => (key ? `${key.slice(8, 10)}.${key.slice(5, 7)}` : '');

/**
 * Хвост серии для «эту и все следующие» — считаем ровно как сервер
 * (DELETE /bookings/recurring/{id}?from_booking_id=…): сама бронь плюс все
 * подтверждённые брони той же серии в тот же день или позже. Более ранние
 * брони серии не трогаются. null — бронь не из серии или отменять больше нечего.
 */
export function seriesTailOf(anchor: BookingHistoryItem, all: BookingHistoryItem[]): SeriesTail | null {
    const gid = anchor.recurringGroupId;
    if (!gid) return null;
    const from = bookingDayKey(anchor);
    // Сама бронь — всегда (у прошедшей сегодняшней статус в ответе может быть
    // уже «completed», а сервер режет по статусу в базе).
    const tail = all.filter(x =>
        x.recurringGroupId === gid
        && (x.id === anchor.id || (x.status === 'confirmed' && bookingDayKey(x) >= from)),
    );
    if (tail.length < 2) return null;
    const last = tail.reduce((m, x) => (bookingDayKey(x) > m ? bookingDayKey(x) : m), from);
    return {
        thisLabel: `${dayLabel(from)}, ${anchor.startTime || ''}`.replace(/, $/, ''),
        count: tail.length,
        lastLabel: dayLabel(last),
    };
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (option: RefundOption, reason: string, scope: CancelScope) => void | Promise<void>;
    bookingLabel?: string;
    /** Бронь из серии — в окне появляется явный выбор «только эту / эту и
     *  следующие». Раньше это спрашивал системный confirm, где «ОК» отменял
     *  всю серию (аудит 29.09). */
    series?: SeriesTail | null;
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
export function AdminCancelBookingModal({ isOpen, onClose, onConfirm, bookingLabel, series }: Props) {
    const [option, setOption] = useState<RefundOption>('full');
    const [reason, setReason] = useState('');
    const [submitting, setSubmitting] = useState(false);
    // По умолчанию — только эта бронь: серию отменяют осознанно, отдельным выбором.
    const [scope, setScope] = useState<CancelScope>('single');

    useEffect(() => {
        if (isOpen) {
            setOption('full');
            setReason('');
            setSubmitting(false);
            setScope('single');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const penaltyRequiresReason = option !== 'full';
    const reasonIsValid = !penaltyRequiresReason || reason.trim().length >= 3;
    const isSeries = !!series && scope === 'series';
    const seriesCountLabel = series ? ruCountWord(series.count, BOOKING_FORMS) : '';

    const handleSubmit = async () => {
        if (!reasonIsValid) return;
        setSubmitting(true);
        try {
            await onConfirm(option, reason.trim(), isSeries ? 'series' : 'single');
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
                    // С выбором «эта / серия» окно выше — на ноутбуке не должно уходить за экран.
                    maxHeight: 'calc(100vh - 40px)', overflowY: 'auto', boxSizing: 'border-box',
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
                    {isSeries ? `Отменить ${seriesCountLabel} серии` : 'Отменить бронь'}
                </h2>
                {bookingLabel && (
                    <p style={{ fontSize: 13, color: GH.ink60, margin: '0 0 18px' }}>{bookingLabel}</p>
                )}

                {series && (
                    <>
                        <div style={{ ...monoLabel, marginBottom: 8 }}>Что отменить</div>
                        <div style={{ display: 'grid', gap: 10, marginBottom: 18 }}>
                            <OptionRow
                                selected={scope === 'single'}
                                onSelect={() => setScope('single')}
                                title={`Только эту бронь (${series.thisLabel})`}
                                desc="Остальные брони серии останутся у клиента."
                            />
                            <OptionRow
                                selected={scope === 'series'}
                                onSelect={() => setScope('series')}
                                title={`Эту и все следующие — ${seriesCountLabel} до ${series.lastLabel}`}
                                desc="Клиент потеряет своё постоянное время. Брони серии раньше этой даты останутся."
                                destructive
                            />
                        </div>
                        <div style={{ ...monoLabel, marginBottom: 8 }}>
                            {isSeries ? 'Возврат — за каждую бронь' : 'Возврат'}
                        </div>
                    </>
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
                        desc="Ничего не возвращается. Для неявки и злоупотреблений."
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
                            <div style={{ fontSize: 12, color: GH.danger, marginTop: 4 }}>
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
                        {submitting ? 'Отменяем…' : isSeries ? `Отменить ${seriesCountLabel}` : 'Отменить бронь'}
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
                background: selected ? (destructive ? STATUS.danger.bg : GH.ink5) : GH.paper,
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
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: GH.ink60,
};

const inkBtn: React.CSSProperties = {
    padding: '10px 18px',
    background: GH.ink,
    color: GH.paper,
    border: `1px solid ${GH.ink}`,
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
};

const outlineBtn: React.CSSProperties = {
    padding: '10px 18px',
    background: 'transparent',
    color: GH.ink,
    border: `1px solid ${GH.ink}`,
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer',
};
