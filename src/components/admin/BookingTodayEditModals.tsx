import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { EXTRAS, RESOURCES, LOCATIONS } from '../../utils/data';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { BookingHistoryItem } from '../../store/types';
import { useUserStore } from '../../store/userStore';
import { AlertTriangle } from 'lucide-react';
import { STATUS } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { ruCountWord } from '../../utils/plural';

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
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: GH.ink60, marginBottom: 16,
};
const btnPrimary: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
    padding: '12px 18px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer', fontWeight: 600,
};
const btnGhost: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
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
                    На сколько добавить время? Проверим, что кабинет после свободен. Доплата
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

// ─── Деление брони ───────────────────────────────────────────────────────────

/** Варианты деления для брони длительностью `minutes`.
 *  Каждая часть — не меньше 30 минут и кратна 30 (правило бэкенда). */
export function splitOptions(minutes: number): { label: string; parts: number[] }[] {
    const out: { label: string; parts: number[] }[] = [];
    const seen = new Set<string>();
    const push = (label: string, parts: number[]) => {
        if (parts.some((p) => p < 30 || p % 30 !== 0)) return;
        if (parts.reduce((a, b) => a + b, 0) !== minutes) return;
        const key = parts.join('-');
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ label, parts });
    };
    if (minutes % 60 === 0 && minutes / 60 >= 2) {
        const n = minutes / 60;
        push(`По часу — ${ruCountWord(n, ['сессия', 'сессии', 'сессий'])}`, Array(n).fill(60));
    }
    if (minutes % 2 === 0 && (minutes / 2) % 30 === 0 && minutes / 2 >= 30) {
        push('Пополам', [minutes / 2, minutes / 2]);
    }
    if (minutes - 60 >= 30) push('Первый час отдельно', [60, minutes - 60]);
    if (minutes - 60 >= 30) push('Последний час отдельно', [minutes - 60, 60]);
    return out;
}

export function SplitBookingModal({
    bookingId, minutes, startTime, onClose, onDone,
}: {
    bookingId: string | null;
    minutes: number;
    startTime?: string;
    onClose: () => void;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState(false);
    if (!bookingId) return null;

    const options = splitOptions(minutes);

    const fmt = (mins: number) => (mins % 60 === 0 ? `${mins / 60} ч` : `${mins} мин`);
    const times = (parts: number[]) => {
        if (!startTime) return parts.map(fmt).join(' + ');
        const [h, m] = startTime.split(':').map(Number);
        let cur = h * 60 + m;
        return parts
            .map((p) => {
                const s = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
                cur += p;
                const e = `${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`;
                return `${s}–${e}`;
            })
            .join(' · ');
    };

    const split = async (parts: number[]) => {
        setBusy(true);
        try {
            const res = await bookingsApi.splitBooking(bookingId, parts);
            toast.success(`Бронь разделена на ${ruCountWord(res.length, ['часть', 'части', 'частей'])}`);
            onDone();
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось разделить бронь');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={card} onClick={(e) => e.stopPropagation()}>
                <div style={title}>Разделить бронь</div>
                <p style={{ fontSize: 14, color: GH.ink, marginBottom: 8 }}>
                    Слот {fmt(minutes)} станет несколькими подряд идущими бронями — к каждой
                    можно привязать своего клиента.
                </p>
                <p style={{ fontSize: 13, color: GH.ink60, marginBottom: 20 }}>
                    Цена не изменится: сумма частей останется прежней.
                </p>

                {options.length === 0 ? (
                    <p style={{ fontSize: 14, color: GH.ink60, marginBottom: 20 }}>
                        Эту бронь разделить нельзя — нужен слот от часа, кратный 30 минутам.
                    </p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                        {options.map((o) => (
                            <button
                                key={o.parts.join('-')}
                                disabled={busy}
                                onClick={() => split(o.parts)}
                                style={{
                                    ...btnPrimary, textAlign: 'left', opacity: busy ? 0.5 : 1,
                                    display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start',
                                }}
                            >
                                <span>{o.label}</span>
                                <span style={{ fontSize: 12, opacity: 0.75, letterSpacing: '0.04em' }}>
                                    {times(o.parts)}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
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
    // 16.09 (кейс Валентины): дефолт был «наличными» — админ дважды добавил
    // допы, ожидая «в счёт брони», а в кассу легли фантомные наличные приходы.
    // «С баланса» — безопасный дефолт: добавляется к цене брони и списывается
    // вместе с ней; наличные/карта админ выбирает осознанно.
    const [method, setMethod] = useState<PayMethod>('balance');
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
            toast.success(`Допы добавлены на ${formatGel(total)}`);
            onDone();
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось добавить допы');
        } finally {
            setBusy(false);
        }
    };

    const methods: { value: PayMethod; label: string }[] = [
        { value: 'balance', label: 'С баланса (в счёт брони)' },
        { value: 'cash', label: 'Наличными' },
        { value: 'card_tbc', label: 'Карта TBC' },
        { value: 'card_bog', label: 'Карта BOG' },
    ];
    const methodHint = method === 'balance'
        ? 'Добавится к цене брони и спишется вместе с ней.'
        : 'Гость платит на месте — уйдёт в кассу отдельным приходом, цена брони НЕ изменится.';

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
                                    {extra.name} · <span className="num">{formatGel(extra.price)}</span>
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
                                fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                                background: method === m.value ? GH.ink : 'transparent',
                                color: method === m.value ? GH.paper : GH.ink,
                            }}>
                            {m.label}
                        </button>
                    ))}
                </div>
                <div style={{ fontSize: 12, color: GH.ink60, margin: '-12px 0 18px', lineHeight: 1.4 }}>
                    {methodHint}
                </div>

                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button style={{ ...btnPrimary, flex: 1, opacity: (!ids.length || busy) ? 0.5 : 1 }}
                        disabled={!ids.length || busy} onClick={submit}>
                        Добавить {total > 0 ? `· ${formatGel(total)}` : ''}
                    </button>
                    <button style={btnGhost} onClick={onClose} disabled={busy}>Отмена</button>
                </div>
            </div>
        </div>
    );
}

// ─── Перенос брони (дата + время + КАБИНЕТ) ──────────────────────────────────
// Бэкенд reschedule умеет менять кабинет (new_resource_id) — не хватало выбора
// в интерфейсе. Раньше «Перенести» спрашивало только дату/время (тот же кабинет).

/** Локальный день брони (YYYY-MM-DD). Не через toISOString — она даёт UTC,
 *  и бронь на 24.09 00:00 Тбилиси превращалась бы в «23.09». */
function _bookingDay(raw: any): string {
    if (!raw) return '';
    if (typeof raw === 'string') return raw.split('T')[0].split(' ')[0];
    try {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return '';
        const p = (n: number) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    } catch { return ''; }
}

/** Принимаем и «30.09.2026» / «30/09/2026» — Safari без нативного пикера
 *  или ручной набор. Возвращает YYYY-MM-DD либо ''. */
function _normalizeDay(v: string): string {
    const s = (v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    return '';
}

export function MoveBookingModal({
    booking, onClose, onSubmit,
}: {
    booking: BookingHistoryItem | null;
    onClose: () => void;
    onSubmit: (newDate: string, newStartTime: string, newResourceId: string) => Promise<void> | void;
}) {
    const [date, setDate] = useState(() => _bookingDay(booking?.date));
    const [time, setTime] = useState(() => booking?.startTime || '10:00');
    const [resourceId, setResourceId] = useState(() => booking?.resourceId || '');
    const [busy, setBusy] = useState(false);
    const dateRef = useRef<HTMLInputElement>(null);
    const timeRef = useRef<HTMLInputElement>(null);

    // Модалка смонтирована постоянно (booking=null → null), поэтому
    // useState-инициализаторы срабатывают один раз при старте шахматки.
    // Пересобираем поля при каждом открытии — иначе дата и кабинет пустые
    // (кейс Валентины 23.09: «Дата: ГГГГ-ММ-ДД» на переносе брони Марины).
    useEffect(() => {
        if (!booking) return;
        setDate(_bookingDay(booking.date));
        setTime(booking.startTime || '10:00');
        setResourceId(booking.resourceId || '');
    }, [booking?.id]);

    // Занятость выбранного кабинета в выбранный день — прямо в окне. Раньше
    // админ узнавал о конфликте только после «Перенести» и подбирал время
    // наугад (в логах: 6 неудачных попыток на одну бронь).
    const allBookings = useUserStore(s => s.bookings);
    const users = useUserStore(s => s.users);
    const occupied = useMemo(() => {
        if (!booking || !resourceId || !date) return [];
        const toMin = (t?: string | null) => { const [h, m] = (t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
        return allBookings
            .filter(b => b.id !== booking.id && b.resourceId === resourceId
                && (b.status === 'confirmed' || b.status === 'pending_approval')
                && _bookingDay(b.date) === date)
            .map(b => {
                const st = toMin(b.startTime);
                const u = users.find(x => x.email === b.userId || x.id === b.userId);
                const who = String(b.paymentMethod || '') === 'service' ? 'обслуживание' : (u?.name || '');
                return { start: st, end: st + (b.duration || 60), who };
            })
            .sort((a, b) => a.start - b.start);
    }, [allBookings, users, booking, resourceId, date]);

    if (!booking) return null;

    const _fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const _newStart = /^\d{2}:\d{2}/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) : -1;
    const _newEnd = _newStart + (booking.duration || 60);
    const clash = _newStart >= 0 ? occupied.find(x => x.start < _newEnd && _newStart < x.end) : undefined;

    const submit = async () => {
        // Safari с controlled date/time-полем не всегда дёргает onChange —
        // читаем значение прямо из инпута, стейт лишь запасной вариант.
        const day = _normalizeDay(dateRef.current?.value || date);
        const hhmm = (timeRef.current?.value || time).slice(0, 5);
        if (!day) { toast.error('Укажите дату переноса (например 30.09.2026)'); return; }
        if (!/^\d{2}:\d{2}$/.test(hhmm)) { toast.error('Укажите время начала (например 10:00)'); return; }
        if (!resourceId) { toast.error('Выберите кабинет'); return; }
        setBusy(true);
        try {
            await onSubmit(day, hhmm, resourceId);
            onClose();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={overlay} onClick={onClose}>
            <div style={card} onClick={(e) => e.stopPropagation()}>
                <div style={title}>Перенести бронь</div>

                <label style={{ fontSize: 12, color: GH.ink60, display: 'block', marginBottom: 4 }}>Дата</label>
                <input ref={dateRef} type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    style={{ width: '100%', padding: '10px', border: `1px solid ${GH.ink}`, marginBottom: 14, fontFamily: GH_SANS, fontSize: 14 }} />

                <label style={{ fontSize: 12, color: GH.ink60, display: 'block', marginBottom: 4 }}>Время начала</label>
                <input ref={timeRef} type="time" value={time} onChange={(e) => setTime(e.target.value)} step={1800}
                    style={{ width: '100%', padding: '10px', border: `1px solid ${GH.ink}`, marginBottom: 14, fontFamily: GH_SANS, fontSize: 14 }} />

                <label style={{ fontSize: 12, color: GH.ink60, display: 'block', marginBottom: 4 }}>Кабинет</label>
                <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}
                    style={{ width: '100%', padding: '10px', border: `1px solid ${GH.ink}`, marginBottom: 10, fontFamily: GH_SANS, fontSize: 14, background: GH.paper }}>
                    {LOCATIONS.map((loc) => (
                        <optgroup key={loc.id} label={loc.name}>
                            {RESOURCES.filter((r) => r.locationId === loc.id).map((r) => (
                                <option key={r.id} value={r.id}>
                                    {r.name}{r.id === booking.resourceId ? ' (текущий)' : ''}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </select>

                <div style={{ fontSize: 12, marginBottom: 16, lineHeight: 1.45 }}>
                    {occupied.length === 0 ? (
                        <span style={{ color: GH.ink60 }}>В этот день кабинет свободен.</span>
                    ) : (
                        <span style={{ color: GH.ink60 }}>
                            Занято: {occupied.map(x => `${_fmtMin(x.start)}–${_fmtMin(x.end)}${x.who ? ` (${x.who})` : ''}`).join(' · ')}
                        </span>
                    )}
                    {clash && (
                        <div style={{ color: STATUS.danger.fg, fontWeight: 600, marginTop: 4, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                            <AlertTriangle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>{_fmtMin(_newStart)}–{_fmtMin(_newEnd)} пересекается с {_fmtMin(clash.start)}–{_fmtMin(clash.end)} — выберите другое время или кабинет.</span>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                    <button style={{ ...btnPrimary, flex: 1, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={submit}>
                        Перенести
                    </button>
                    <button style={btnGhost} onClick={onClose} disabled={busy}>Отмена</button>
                </div>
            </div>
        </div>
    );
}


/** Сократить бронь с начала или с конца (PATCH /bookings/{id}/shorten —
 *  тот же путь и те же возвраты, что раньше). Заменяет два системных
 *  prompt'а подряд («сколько минут?», «начало/конец?»). Итог — не меньше 60 мин. */
export function ShortenBookingModal({
    booking, onClose, onSubmit,
}: {
    booking: BookingHistoryItem | null;
    onClose: () => void;
    onSubmit: (removeMinutes: number, side: 'start' | 'end') => Promise<void> | void;
}) {
    const [remove, setRemove] = useState(30);
    const [side, setSide] = useState<'start' | 'end'>('end');
    const [busy, setBusy] = useState(false);
    useEffect(() => { setRemove(30); setSide('end'); }, [booking?.id]);
    if (!booking) return null;
    const dur = booking.duration || 60;
    const options: number[] = [];
    for (let m = 30; m <= dur - 60; m += 30) options.push(m);
    const [h, mm] = (booking.startTime || '00:00').split(':').map(Number);
    const startMin = (h || 0) * 60 + (mm || 0);
    const fmt = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const newStart = side === 'start' ? startMin + remove : startMin;
    const newEnd = side === 'end' ? startMin + dur - remove : startMin + dur;
    const chip = (active: boolean): React.CSSProperties => ({
        padding: '10px 12px', minWidth: 64, border: `1px solid ${GH.ink}`, cursor: 'pointer',
        background: active ? GH.ink : GH.paper, color: active ? GH.paper : GH.ink,
        fontFamily: GH_SANS, fontSize: 14, fontWeight: 600,
    });
    const label = (m: number) => (m % 60 === 0 ? `${m / 60} ч` : m > 60 ? `${Math.floor(m / 60)} ч 30 мин` : `${m} мин`);
    const submit = async () => {
        setBusy(true);
        try { await onSubmit(remove, side); onClose(); } catch { /* тост уже показан */ } finally { setBusy(false); }
    };
    return (
        <div style={overlay} onClick={onClose}>
            <div style={card} onClick={(e) => e.stopPropagation()}>
                <div style={title}>Сократить бронь</div>
                <div style={{ fontSize: 13, color: GH.ink60, marginBottom: 14 }}>
                    Сейчас {fmt(startMin)}–{fmt(startMin + dur)}. Деньги или часы за убранное время вернутся клиенту.
                </div>
                {options.length === 0 ? (
                    <div style={{ fontSize: 14, marginBottom: 16 }}>Бронь уже минимальная (60 мин) — сократить нельзя.</div>
                ) : (
                    <>
                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 6 }}>Убрать</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
                            {options.map(m => (
                                <button key={m} style={chip(remove === m)} onClick={() => setRemove(m)}>{label(m)}</button>
                            ))}
                        </div>
                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 6 }}>С какой стороны</div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                            <button style={{ ...chip(side === 'end'), flex: 1 }} onClick={() => setSide('end')}>С конца</button>
                            <button style={{ ...chip(side === 'start'), flex: 1 }} onClick={() => setSide('start')}>С начала</button>
                        </div>
                        <div style={{ fontSize: 14, marginBottom: 18 }}>
                            Останется: <b>{fmt(newStart)}–{fmt(newEnd)}</b>
                        </div>
                    </>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                    {options.length > 0 && (
                        <button style={{ ...btnPrimary, flex: 1, opacity: busy ? 0.5 : 1 }} disabled={busy} onClick={submit}>
                            Сократить
                        </button>
                    )}
                    <button style={btnGhost} onClick={onClose} disabled={busy}>Отмена</button>
                </div>
            </div>
        </div>
    );
}
