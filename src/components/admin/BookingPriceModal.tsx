import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import type { BookingHistoryItem } from '../../store/types';

/**
 * «22,5» → 22.5. Админы набирают цену с запятой, а parseFloat('22,5') = 22 —
 * дробная часть молча отрезалась (аудит 29.09, G7-04). null — не число.
 */
export function parseMoneyInput(raw: string): number | null {
    const v = raw.trim().replace(/\s+/g, '').replace(',', '.');
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

const money = (n: number) => String(Math.round(n * 100) / 100);

/**
 * Правка цены брони — вместо системного prompt(). Поле принимает запятую,
 * а под ним видно, что будет с деньгами клиента: сервер для оплаченной брони
 * сразу возвращает или списывает разницу (PATCH /bookings/{id}/price).
 */
export function BookingPriceModal({
    booking,
    onClose,
    onSaved,
}: {
    booking: BookingHistoryItem | null;
    onClose: () => void;
    onSaved?: () => void | Promise<void>;
}) {
    const [value, setValue] = useState('');
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (booking) {
            setValue(money(Number(booking.finalPrice || 0)).replace('.', ','));
            setReason('');
            setSaving(false);
        }
    }, [booking?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!booking) return null;

    const oldPrice = Number(booking.finalPrice || 0);
    const parsed = parseMoneyInput(value);
    const error = value.trim() === ''
        ? 'Введите цену'
        : parsed === null
            ? 'Только число, например 22,5'
            : null;
    const same = parsed !== null && Math.abs(parsed - oldPrice) < 0.005;
    // > 0 — клиенту вернётся, < 0 — доплата (та же формула, что на сервере).
    const delta = parsed !== null ? Math.round((oldPrice - parsed) * 100) / 100 : 0;

    let effect: string | null = null;
    if (parsed !== null && !same) {
        if (booking.paymentStatus === 'pending') {
            effect = 'Бронь ещё не оплачена — при оплате спишется новая цена.';
        } else if (booking.paymentStatus !== 'paid') {
            effect = 'Баланс клиента сейчас не изменится — меняется только цена брони.';
        } else if (booking.paymentMethod === 'subscription') {
            effect = 'Бронь по абонементу — часы клиента пересчитаются по новой цене.';
        } else if (delta > 0) {
            effect = `Клиенту вернётся ${money(delta)} ₾ на баланс.`;
        } else {
            effect = `С баланса клиента спишется ещё ${money(-delta)} ₾.`;
        }
    }

    const canSave = !error && !same && !saving;

    const handleSave = async () => {
        if (!canSave || parsed === null) return;
        setSaving(true);
        try {
            await bookingsApi.setPrice(booking.id, parsed, reason.trim() || undefined);
            toast.success(`Цена изменена: ${money(oldPrice)} ₾ → ${money(parsed)} ₾`);
            onClose();
            await onSaved?.();
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'Не удалось изменить цену');
        } finally {
            setSaving(false);
        }
    };

    const dateLabel = (() => {
        const raw: any = booking.date;
        const day = typeof raw === 'string' ? raw.split('T')[0].split(' ')[0] : '';
        return day ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : '';
    })();

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={() => { if (!saving) onClose(); }}
            />
            <form
                className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6"
                onSubmit={(e) => { e.preventDefault(); handleSave(); }}
            >
                <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-unbox-grey hover:text-unbox-dark"
                >
                    <X size={20} />
                </button>

                <h3 className="text-xl font-bold text-unbox-dark mb-1">Изменить цену</h3>
                <p className="text-sm text-unbox-grey mb-4">
                    {[dateLabel, booking.startTime].filter(Boolean).join(', ')} · сейчас {money(oldPrice)} ₾
                </p>

                <label className="block text-xs font-semibold text-unbox-grey mb-1" htmlFor="booking-new-price">
                    Новая цена, ₾
                </label>
                <input
                    id="booking-new-price"
                    type="text"
                    inputMode="decimal"
                    autoFocus
                    value={value}
                    onChange={e => setValue(e.target.value)}
                    placeholder="0,00"
                    className="w-full px-3 py-2.5 rounded-xl border border-unbox-light text-lg font-semibold tabular-nums focus:outline-none focus:border-unbox-green"
                />
                <div className="min-h-[20px] mt-1.5 text-xs">
                    {error ? (
                        <span className="text-red-600">{error}</span>
                    ) : same ? (
                        <span className="text-unbox-grey">Цена та же, что сейчас</span>
                    ) : effect ? (
                        <span className="text-unbox-dark font-medium">{effect}</span>
                    ) : null}
                </div>

                <label className="block text-xs font-semibold text-unbox-grey mt-3 mb-1" htmlFor="booking-price-reason">
                    Причина (необязательно, для истории)
                </label>
                <input
                    id="booking-price-reason"
                    type="text"
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Например: скидка за неудобство"
                    className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:border-unbox-green"
                />

                <div className="flex gap-3 mt-5">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className="flex-1 py-2.5 rounded-xl border border-unbox-light text-sm font-medium text-unbox-dark hover:bg-unbox-light/50 disabled:opacity-50"
                    >
                        Отмена
                    </button>
                    <button
                        type="submit"
                        disabled={!canSave}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-dark disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        Сохранить
                    </button>
                </div>
            </form>
        </div>,
        document.body,
    );
}
