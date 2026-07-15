import { useState } from 'react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { EXTRAS } from '../../utils/data';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

/**
 * Быстрые правки СЕГОДНЯШНЕЙ брони для админа:
 *  - ExtendBookingModal — продлить на выбранное время (30/60/90/120).
 *  - AddExtrasModal — дозаказ допов (кофе и т.п.) в моменте.
 *
 * Бэкенд: PATCH /bookings/{id}/extend, PATCH /bookings/{id}/add-extras.
 */

const overlay: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
};
const card: React.CSSProperties = {
    background: GH.paper, border: `2px solid ${GH.ink}`, maxWidth: 420, width: '100%', padding: 24,
    fontFamily: GH_SANS,
};
const title: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: GH.ink60, marginBottom: 16,
};
const btnPrimary: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '12px 18px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer', fontWeight: 600,
};
const btnGhost: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '12px 18px', background: 'transparent', color: GH.ink, border: `1px solid ${GH.ink}`, cursor: 'pointer',
};

// ─── Продление ───────────────────────────────────────────────────────────────

export function ExtendBookingModal({
    bookingId, onClose, onDone,
}: { bookingId: string | null; onClose: () => void; onDone: () => void }) {
    const [busy, setBusy] = useState(false);
    if (!bookingId) return null;

    const extend = async (minutes: number) => {
        setBusy(true);
        try {
            await bookingsApi.extendBooking(bookingId, minutes);
            toast.success(`Бронь продлена на ${minutes} мин`);
            onDone();
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось продлить — возможно, следующий слот занят');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={card} onClick={(e) => e.stopPropagation()}>
                <div style={title}>Продлить бронь</div>
                <p style={{ fontSize: 14, color: GH.ink, marginBottom: 20 }}>
                    На сколько добавить время? Проверю, что кабинет после свободен. Доплата
                    за добавленное время спишется с депозита клиента.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
                    {[30, 60, 90, 120].map((m) => (
                        <button key={m} disabled={busy} onClick={() => extend(m)}
                            style={{ ...btnPrimary, flex: 1, minWidth: 70, opacity: busy ? 0.5 : 1 }}>
                            +{m < 60 ? `${m} мин` : m % 60 === 0 ? `${m / 60} ч` : `${Math.floor(m / 60)}:${m % 60}`}
                        </button>
                    ))}
                </div>
                <button style={btnGhost} onClick={onClose} disabled={busy}>Отмена</button>
            </div>
        </div>
    );
}

// ─── Допы ─────────────────────────────────────────────────────────────────────

type PayMethod = 'cash' | 'card_tbc' | 'card_bog' | 'balance';

export function AddExtrasModal({
    bookingId, onClose, onDone,
}: { bookingId: string | null; onClose: () => void; onDone: () => void }) {
    const [selected, setSelected] = useState<Record<string, number>>({});
    const [method, setMethod] = useState<PayMethod>('cash');
    const [busy, setBusy] = useState(false);
    if (!bookingId) return null;

    const toggle = (id: string) => setSelected((s) => {
        const next = { ...s };
        next[id] = (next[id] || 0) + 1;
        return next;
    });
    const dec = (id: string) => setSelected((s) => {
        const next = { ...s };
        if (!next[id]) return next;
        next[id] -= 1;
        if (next[id] <= 0) delete next[id];
        return next;
    });

    // Разворачиваем количество в плоский список id (2 кофе → [coffee, coffee]).
    const ids = Object.entries(selected).flatMap(([id, n]) => Array(n).fill(id));
    const total = ids.reduce((sum, id) => sum + (EXTRAS.find((e) => e.id === id)?.price || 0), 0);

    const submit = async () => {
        if (!ids.length) return;
        setBusy(true);
        try {
            await bookingsApi.addBookingExtras(bookingId, ids, method);
            toast.success(`Допы добавлены на ${total} ₾`);
            onDone();
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось добавить допы');
        } finally {
            setBusy(false);
        }
    };

    const methods: { value: PayMethod; label: string }[] = [
        { value: 'cash', label: 'Наличными' },
        { value: 'card_tbc', label: 'Карта TBC' },
        { value: 'card_bog', label: 'Карта BOG' },
        { value: 'balance', label: 'С баланса' },
    ];

    return (
        <div style={overlay} onClick={onClose}>
            <div style={card} onClick={(e) => e.stopPropagation()}>
                <div style={title}>Дозаказ — допы к броне</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                    {EXTRAS.map((extra) => {
                        const count = selected[extra.id] || 0;
                        return (
                            <div key={extra.id} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                border: `1px solid ${count ? GH.ink : GH.ink10}`, padding: '10px 12px',
                            }}>
                                <span style={{ fontSize: 14, color: GH.ink }}>
                                    {extra.name} · {extra.price} ₾
                                </span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    {count > 0 && (
                                        <>
                                            <button onClick={() => dec(extra.id)} style={{ ...btnGhost, padding: '2px 10px' }}>−</button>
                                            <span style={{ fontFamily: GH_MONO, fontSize: 13, minWidth: 16, textAlign: 'center' }}>{count}</span>
                                        </>
                                    )}
                                    <button onClick={() => toggle(extra.id)} style={{ ...btnPrimary, padding: '2px 10px' }}>+</button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div style={title}>Оплата</div>
                <div style={{ display: 'flex', gap: 0, border: `1px solid ${GH.ink}`, marginBottom: 20, flexWrap: 'wrap' }}>
                    {methods.map((m) => (
                        <button key={m.value} onClick={() => setMethod(m.value)}
                            style={{
                                flex: 1, minWidth: 90, padding: '10px 8px', border: 'none',
                                borderRight: `1px solid ${GH.ink10}`, cursor: 'pointer',
                                fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase',
                                background: method === m.value ? GH.ink : 'transparent',
                                color: method === m.value ? GH.paper : GH.ink,
                            }}>
                            {m.label}
                        </button>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button style={{ ...btnPrimary, flex: 1, opacity: (!ids.length || busy) ? 0.5 : 1 }}
                        disabled={!ids.length || busy} onClick={submit}>
                        Добавить {total > 0 ? `· ${total} ₾` : ''}
                    </button>
                    <button style={btnGhost} onClick={onClose} disabled={busy}>Отмена</button>
                </div>
            </div>
        </div>
    );
}
