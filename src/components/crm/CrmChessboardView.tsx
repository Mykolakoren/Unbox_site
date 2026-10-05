import { useState, useMemo, useEffect, useRef, useCallback, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { SplitBookingModal } from '../admin/BookingTodayEditModals';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import {
    format, addMinutes, setHours, setMinutes, startOfToday,
    addWeeks, subWeeks, startOfWeek, endOfWeek, eachDayOfInterval,
    isSameDay, isToday,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, X, UserPlus, Bell, Repeat, ArrowLeftRight, Check, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { toast } from 'sonner';
import { bookingsApi } from '../../api/bookings';
import { isPeakTime } from '../../utils/pricing';
import type { BookingHistoryItem } from '../../store/types';
import type { CrmClient } from '../../api/crm';
import { ChessboardScroller } from '../ui/ChessboardScroller';
import { parseUTC } from '../../utils/dateUtils';
import { apiErrorMessage } from '../../utils/errors';
import { CancelBookingChoiceModal } from '../CancelBookingChoiceModal';
import { TrimBookingModal } from '../TrimBookingModal';
import { RescheduleScopeChoiceModal } from '../RescheduleScopeChoiceModal';
import { clientCanModifyBooking } from '../../utils/subscription';
import { ADMIN_ROLES } from '../../utils/permissions';
import { WaitlistSubscribeModal } from '../ui/WaitlistSubscribeModal';
import { tbilisiNow } from '../../utils/dateUtils';
import { utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { CURRENCIES } from '../../utils/currency';
import { formatDayMonth } from '../../utils/format';
import { ruPlural } from '../../utils/plural';
import { useConfirmDialog } from '../ui/ConfirmDialogProvider';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field, Input } from '../ui/Field';

/** «GEL» → «₾» в подписях полей («Стоимость, ₾»). */
const currencySign = (code?: string) => CURRENCIES.find(c => c.code === (code || 'GEL'))?.symbol ?? code ?? '₾';

// 2026-06-06 owner (Фаза 3 — см. docs/REFACTOR-BOOKINGS-UNIFICATION.md):
// TIME_SLOTS, timeToMin, parseBookingDate раньше дублировались в
// AdminChessboardView и CrmChessboardView. Теперь — общие.
// parseUTC заменяет локальный parseBookingDate (тело идентичное).
import { TIME_SLOTS, timeToMin } from '../../utils/bookingHelpers';
import { createSessionResolvingCalendar, type SeriesCalendarChoice } from '../../utils/crmCalendarConflict';

const _minToTime = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

type CellInfo =
    | { type: 'free'; slot: string; past: boolean }
    | { type: 'booking'; slot: string; booking: BookingHistoryItem; colspan: number; isMine: boolean };

// ─── CRM Quick Booking Modal ──────────────────────────────────────────────────
function CrmQuickBookModal({
    slot,
    crmClients,
    onClose,
    onBooked,
    presetClientId,
}: {
    slot: { resId: string; time: string; date: Date; duration: number };
    crmClients: CrmClient[];
    onClose: () => void;
    onBooked: (bookingId: string, clientId: string | null, price: number) => Promise<void>;
    /** 05.10: «Снять кабинет» у сессии без кабинета — клиент уже известен. */
    presetClientId?: string;
}) {
    const resource = RESOURCES.find(r => r.id === slot.resId);
    const [duration, setDuration] = useState(slot.duration);
    const [selectedClientId, setSelectedClientId] = useState(presetClientId || '');
    const [price, setPrice] = useState('');
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(12);
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    const endTime = (() => {
        try {
            const [h, m] = slot.time.split(':').map(Number);
            return format(addMinutes(setMinutes(setHours(slot.date, h), m), duration), 'HH:mm');
        } catch { return '—'; }
    })();

    const selectedClient = crmClients.find(c => c.id === selectedClientId);
    useEffect(() => {
        if (selectedClient && !price) setPrice(String(selectedClient.basePrice || ''));
    }, [selectedClientId]);

    const filteredClients = useMemo(() =>
        crmClients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [crmClients, search]
    );

    const DURATIONS = [30, 60, 90, 120];

    const handleBook = async () => {
        setSaving(true);
        try {
            if (recurringPattern) {
                const result = await bookingsApi.createRecurringBooking({
                    resourceId: slot.resId,
                    locationId: resource?.locationId || 'unbox_one',
                    startTime: slot.time,
                    duration,
                    format: resource?.formats?.[0] || 'individual',
                    paymentMethod: 'balance',
                    firstDate: dateStr,
                    occurrences: recurringOccurrences,
                    pattern: recurringPattern,
                    crmClientId: selectedClientId || undefined,
                });
                const patternLabel = recurringPattern === 'weekly' ? 'еженедельно' : recurringPattern === 'biweekly' ? 'раз в 2 нед.' : 'раз в 4 нед.';
                toast.success(`Серия создана: ${result.created} бронирований (${patternLabel})`);
                await useUserStore.getState().fetchBookings();
                onClose();
                return;
            }

            const res = await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr,
                startTime: slot.time,
                duration,
                format: resource?.formats?.[0] || 'individual',
                locationId: resource?.locationId,
            } as any);
            await useUserStore.getState().fetchBookings();
            const newBooking = useUserStore.getState().bookings.find(b => {
                const bd = parseUTC(b.date);
                return format(bd, 'yyyy-MM-dd') === dateStr &&
                    b.startTime === slot.time &&
                    b.resourceId === slot.resId &&
                    b.status === 'confirmed';
            });
            await onBooked(
                newBooking?.id || (res as any)?.id || '',
                selectedClientId || null,
                Number(price) || 0
            );
            toast.success('Бронирование создано' + (selectedClientId ? ' и сессия привязана' : ''));
            // onClose здесь НЕ зовём: onClose = «Отмена» и сбрасывает очередь
            // периодов. После успеха окно ведёт родитель (handleBooked): открывает
            // следующий период из очереди или закрывает окно, если очередь пуста.
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                toast.error(`Конфликт: заняты ${detail.conflicts.map((c: any) => c.date).join(', ')}`, { duration: 8000 });
            } else {
                const msg = typeof detail === 'string' ? detail : e.message || 'Ошибка бронирования';
                toast.error(msg);
            }
        } finally {
            setSaving(false);
        }
    };

    // Волна 3 (X4-04): общая шторка Sheet вместо самодельного оверлея —
    // Esc, фокус внутри, подвал с кнопкой всегда виден. Логика брони, цены,
    // способа оплаты и серии (handleBook) — прежняя, поменялась только обёртка.
    const occWord = ruPlural(recurringOccurrences, ['бронь', 'брони', 'броней']);
    return (
        <Sheet
            open
            onClose={onClose}
            dismissible={!saving}
            title="Забронировать кабинет"
            description={`${resource?.name || slot.resId} · ${formatDayMonth(slot.date, { withYear: 'auto' })}`}
            width={480}
            footer={
                <>
                    <Button variant="primary" loading={saving} onClick={handleBook}>
                        {recurringPattern ? `Создать серию · ${recurringOccurrences} ${occWord}` : selectedClientId ? 'Забронировать + сессия' : 'Забронировать'}
                    </Button>
                    <Button variant="secondary" disabled={saving} onClick={onClose}>Отмена</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Время */}
                <div className="num" style={{ fontSize: 'var(--text-title)', fontWeight: 600 }}>
                    {slot.time} – {endTime}
                </div>

                {/* Длительность */}
                <div>
                    <div style={PICK_LABEL}>Длительность</div>
                    <div className="ui-chip-row" role="group" aria-label="Длительность">
                        {DURATIONS.map(d => (
                            <Chip key={d} selected={duration === d} onClick={() => setDuration(d)}>
                                {durationLabel(d)}
                            </Chip>
                        ))}
                    </div>
                </div>

                {/* Клиент CRM (необязательно) */}
                <div>
                    <Field label="Клиент" optional>
                        <Input
                            kind="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Имя, телефон или код"
                        />
                    </Field>
                    <PickList label="Клиенты">
                        <PickRow selected={!selectedClientId} onClick={() => setSelectedClientId('')}>
                            Без клиента
                        </PickRow>
                        {filteredClients.slice(0, 6).map(client => (
                            <PickRow
                                key={client.id}
                                selected={selectedClientId === client.id}
                                onClick={() => setSelectedClientId(client.id)}
                                meta={client.aliasCode ? `#${client.aliasCode}` : undefined}
                            >
                                {client.name}
                            </PickRow>
                        ))}
                        {filteredClients.length === 0 && search && (
                            <div style={PICK_EMPTY}>Никого не нашли — проверьте имя или код</div>
                        )}
                    </PickList>

                    {/* Стоимость сессии — если выбран клиент */}
                    {selectedClient && (
                        <div style={{ marginTop: 16 }}>
                            <Field label="Стоимость сессии">
                                {/* type="number" — как раньше: та же разборка суммы. */}
                                <Input
                                    kind="money"
                                    type="number"
                                    value={price}
                                    onChange={e => setPrice(e.target.value)}
                                    placeholder={String(selectedClient.basePrice || 0)}
                                    suffix={currencySign(selectedClient.currency)}
                                />
                            </Field>
                        </div>
                    )}
                </div>

                {/* Повторение. У сессии из календаря — без серии: первая встреча
                    серии задвоилась бы с уже существующей (05.10). */}
                {!presetClientId && <div>
                    <div style={PICK_LABEL}>Повторение</div>
                    <div className="ui-chip-row" role="group" aria-label="Повторение">
                        {([
                            { id: '', label: 'Разово' },
                            { id: 'weekly', label: 'Каждую неделю' },
                            { id: 'biweekly', label: 'Раз в 2 недели' },
                            { id: 'monthly', label: 'Раз в 4 недели' },
                        ] as const).map(p => (
                            <Chip key={p.id} selected={recurringPattern === p.id} onClick={() => setRecurringPattern(p.id)}>
                                {p.label}
                            </Chip>
                        ))}
                    </div>
                    {recurringPattern && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                            <input
                                type="number"
                                value={recurringOccurrences}
                                onChange={e => {
                                    const max = recurringPattern === 'monthly' ? 24 : 52;
                                    setRecurringOccurrences(Math.max(2, Math.min(max, Number(e.target.value))));
                                }}
                                min={2}
                                max={recurringPattern === 'monthly' ? 24 : 52}
                                aria-label="Сколько раз повторить"
                                className="ui-input tabular-nums"
                                style={{ width: 88, textAlign: 'center' }}
                            />
                            <span style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>
                                {occWord} · {recurringPattern === 'monthly'
                                    ? `≈ ${Math.round(recurringOccurrences * 4 / 4.3)} мес.`
                                    : recurringPattern === 'biweekly'
                                        ? `≈ ${Math.round(recurringOccurrences / 2)} мес.`
                                        : `≈ ${Math.round(recurringOccurrences / 4.3)} мес.`}
                            </span>
                        </div>
                    )}
                </div>}
            </div>
        </Sheet>
    );
}

/** Enter / пробел на клетке-брони — то же, что клик (клавиатура, G5-14). */
function activateOnKey(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.currentTarget.click();
    }
}

/** «30 мин», «1 ч», «1,5 ч», «2 ч». */
function durationLabel(min: number): string {
    if (min < 60) return `${min} мин`;
    const h = min / 60;
    return `${String(h).replace('.', ',')} ч`;
}

const PICK_LABEL: CSSProperties = {
    fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-ink-60)', marginBottom: 8,
};
const PICK_EMPTY: CSSProperties = {
    fontSize: 'var(--text-small)', color: 'var(--color-ink-60)', padding: '12px 4px',
};

/** Список выбора клиента в шторках брони: строки 44 px, выбранная — с
 *  галочкой и подложкой акцента, озвучивается через aria-pressed. */
export function PickList({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div
            role="group"
            aria-label={label}
            style={{
                display: 'flex', flexDirection: 'column', maxHeight: 220, overflowY: 'auto',
                border: '1px solid var(--color-ink-10)', borderRadius: 'var(--radius-control)', marginTop: 8,
            }}
        >
            {children}
        </div>
    );
}

export function PickRow({ selected, onClick, meta, children }: {
    /** undefined — строка-действие («Открепить клиента»), не выбор. */
    selected?: boolean; onClick: () => void; meta?: ReactNode; children: ReactNode;
}) {
    return (
        <button
            type="button"
            aria-pressed={selected}
            onClick={onClick}
            style={{
                display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, padding: '0 12px',
                textAlign: 'left', border: 0, borderBottom: '1px solid var(--color-ink-08)',
                background: selected ? 'var(--color-accent-soft)' : 'transparent',
                color: 'var(--color-ink)', fontSize: 'var(--text-small)', fontWeight: selected ? 600 : 400,
                cursor: 'pointer', flexShrink: 0,
            }}
        >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</span>
            {meta && <span className="num" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }}>{meta}</span>}
            {selected && <Check size={16} aria-hidden="true" style={{ color: 'var(--color-accent-ink)', flexShrink: 0 }} />}
        </button>
    );
}

// ─── Link Client to Existing Booking Modal (multi-slot) ───────────────────────
interface SlotAssignment {
    hour: number; // start minute of the slot (e.g., 840 for 14:00)
    label: string; // e.g., "14:00 – 15:00"
    clientId: string | null;
    price: number;
    existingSessionId?: string;
}

function LinkBookingModal({
    booking,
    crmClients,
    existingSessions,
    onClose,
    onSaveMulti,
    onDeleteBooking,
    onTrim,
    onSplit,
}: {
    booking: BookingHistoryItem;
    crmClients: CrmClient[];
    existingSessions: { id: string; clientId: string; date: string | Date; durationMinutes?: number }[];
    onClose: () => void;
    /**
     * Persist the slot assignments. Resolve to `false` when the save was
     * partial / aborted (e.g. recurring series rejected because of a
     * cabinet-booking conflict) — the modal will stay open so the user can
     * tweak inputs without losing context. Resolve to anything else (true /
     * void / undefined) for a fully-successful save and the modal closes.
     */
    onSaveMulti: (assignments: SlotAssignment[], opts?: { recurringPattern?: 'weekly' | 'biweekly' | 'monthly' | ''; occurrences?: number }) => Promise<boolean | void>;
    onDeleteBooking: (booking: BookingHistoryItem) => Promise<void>;
    onTrim: (booking: BookingHistoryItem) => void;
    onSplit: (booking: any) => void;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const duration = booking.duration || 60;
    const numSlots = Math.max(1, Math.floor(duration / 60));
    const startMin = booking.startTime ? timeToMin(booking.startTime) : 0;

    // Build initial slot assignments from existing sessions
    const [slots, setSlots] = useState<SlotAssignment[]>(() => {
        const result: SlotAssignment[] = [];
        const bookingEnd = startMin + duration;
        for (let i = 0; i < numSlots; i++) {
            const slotStart = startMin + i * 60;
            // Последний слот тянется до реального конца брони — иначе бронь
            // на 90 мин показывалась как «18:00 – 19:00» (теряли 30 мин).
            // Фидбэк Яны 2026-07-06: слот не совпадал с длительностью.
            const slotEnd = i === numSlots - 1 ? bookingEnd : slotStart + 60;
            const h1 = Math.floor(slotStart / 60);
            const m1 = slotStart % 60;
            const h2 = Math.floor(slotEnd / 60);
            const m2 = slotEnd % 60;
            const label = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')} – ${String(h2).padStart(2, '0')}:${String(m2).padStart(2, '0')}`;

            // Find existing session for this hour
            const existing = existingSessions.find(s => {
                try {
                    const d = s.date instanceof Date ? s.date : new Date(String(s.date));
                    const sMin = d.getUTCHours() * 60 + d.getUTCMinutes();
                    return Math.abs(sMin - slotStart) < 30;
                } catch { return false; }
            });

            result.push({
                hour: slotStart,
                label,
                clientId: existing?.clientId || null,
                price: 0,
                existingSessionId: existing?.id,
            });
        }
        return result;
    });

    const [activeSlotIdx, setActiveSlotIdx] = useState(0);
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // Recurring options for the linked sessions — repeats the client→slot
    // assignment N times into the future (matches the booking-recurrence
    // pattern used elsewhere). Future CRM sessions are created with the
    // same client; if the cabinet isn't booked yet, the specialist will
    // see them as "сессия без брони" and can add the cabinet booking
    // separately (or через recurring booking flow).
    const [recurringPattern, setRecurringPattern] = useState<'' | 'weekly' | 'biweekly' | 'monthly'>('');
    const [recurringOccurrences, setRecurringOccurrences] = useState(8);
    const { confirm } = useConfirmDialog();

    const activeSlot = slots[activeSlotIdx];
    const activeClient = crmClients.find(c => c.id === activeSlot?.clientId);

    const filteredClients = useMemo(() =>
        crmClients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [crmClients, search]
    );

    const updateSlot = (idx: number, clientId: string | null, price?: number) => {
        setSlots(prev => prev.map((s, i) =>
            i === idx ? { ...s, clientId, price: price ?? s.price } : s
        ));
    };

    // Ref guard against double-clicks — `disabled` propagates one render
    // tick after setSaving, so a fast double-click can sneak two requests
    // through (which is exactly how we got two identical conflict toasts).
    const savingRef = useRef(false);
    const handleSave = async () => {
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const result = await onSaveMulti(slots, recurringPattern ? { recurringPattern, occurrences: recurringOccurrences } : undefined);
            // onSaveMulti returns `true` only when the save fully landed.
            // Recurring conflicts return `false` so we keep the modal open
            // and the specialist can adjust the start date or occurrence
            // count without re-opening from the chessboard.
            if (result !== false) onClose();
        } catch {
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        const ok = await confirm({
            title: 'Удалить эту бронь кабинета?',
            body: (
                <>
                    <div style={{ fontWeight: 500 }}>{resource?.name || 'Кабинет'} · {bookingDateStr} · {duration} мин</div>
                    <div style={{ marginTop: 8 }}>
                        Привязанные сессии ({assignedCount}) останутся в CRM, но потеряют связь с этой бронью.
                    </div>
                </>
            ),
            confirmLabel: 'Удалить бронь',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setDeleting(true);
        try {
            await onDeleteBooking(booking);
            onClose();
        } catch {
        } finally {
            setDeleting(false);
        }
    };

    const bookingDateStr = (() => {
        try {
            const d = booking.date instanceof Date
                ? booking.date
                : new Date(String(booking.date).replace(' 12:00', '').split(' ')[0]);
            return isNaN(d.getTime()) ? '' : formatDayMonth(d, { withYear: 'auto' });
        } catch { return ''; }
    })();

    const assignedCount = slots.filter(s => s.clientId).length;

    const canTrimOrSplit = duration >= 120
        && (booking.status === 'confirmed' || (booking.status as any) === undefined)
        && !booking.isReRentListed;

    // Волна 3 (X4-04): общая шторка Sheet вместо самодельного оверлея.
    // Сохранение (onSaveMulti, защита savingRef от двойного клика), серии,
    // удаление/обрезка/разделение брони — прежние; поменялась только обёртка.
    return (
        <Sheet
            open
            onClose={onClose}
            dismissible={!saving && !deleting}
            title="Распределить клиентов"
            description={`${resource?.name || 'Кабинет'} · ${bookingDateStr} · ${duration} мин (${numSlots} ${ruPlural(numSlots, ['сессия', 'сессии', 'сессий'])})`}
            width={480}
            headerAction={
                <Button
                    variant="quiet"
                    size="compact"
                    onClick={handleDelete}
                    disabled={saving}
                    loading={deleting}
                    icon={<Trash2 size={16} aria-hidden="true" />}
                    aria-label="Удалить эту бронь"
                    title="Удалить эту бронь"
                    style={{ color: 'var(--status-danger-fg)' }}
                />
            }
            footer={
                <>
                    <Button
                        variant="primary"
                        loading={saving}
                        disabled={assignedCount === 0 && !recurringPattern}
                        onClick={handleSave}
                    >
                        {assignedCount > 0
                            ? `Сохранить (${assignedCount}/${numSlots})${recurringPattern ? ` × ${recurringOccurrences}` : ''}`
                            : recurringPattern
                                ? `Повторить бронь × ${recurringOccurrences}`
                                : 'Сохранить'}
                    </Button>
                    <Button variant="secondary" disabled={saving} onClick={onClose}>Отмена</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Слоты по часу */}
                {numSlots > 1 && (
                    <div className="ui-chip-row" role="group" aria-label="Час брони">
                        {slots.map((slot, idx) => {
                            const client = crmClients.find(c => c.id === slot.clientId);
                            return (
                                <Chip
                                    key={idx}
                                    selected={activeSlotIdx === idx}
                                    onClick={() => { setActiveSlotIdx(idx); setSearch(''); }}
                                >
                                    <span className="num">{slot.label.split(' – ')[0]}</span>
                                    <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 400 }}>
                                        · {client ? client.name : 'без клиента'}
                                    </span>
                                </Chip>
                            );
                        })}
                    </div>
                )}

                <div>
                    <Field label={<>Клиент на <span className="num">{activeSlot.label}</span></>}>
                        <Input
                            kind="search"
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Имя, телефон или код"
                        />
                    </Field>
                    <PickList label="Клиенты">
                        {/* Открепить клиента от этого часа */}
                        {activeSlot.clientId && (
                            <PickRow onClick={() => updateSlot(activeSlotIdx, null)}>
                                Открепить клиента
                            </PickRow>
                        )}
                        {filteredClients.slice(0, 8).map(client => {
                            const isSelected = activeSlot.clientId === client.id;
                            // Клиент уже стоит на другом часе этой брони — показываем, на каком.
                            const otherSlot = slots.find((s, i) => i !== activeSlotIdx && s.clientId === client.id);
                            return (
                                <PickRow
                                    key={client.id}
                                    selected={isSelected}
                                    meta={otherSlot && !isSelected ? `уже на ${otherSlot.label.split(' – ')[0]}` : undefined}
                                    onClick={() => {
                                        updateSlot(activeSlotIdx, client.id, client.basePrice || 0);
                                        // Auto-advance to next empty slot
                                        if (numSlots > 1) {
                                            const nextEmpty = slots.findIndex((s, i) => i > activeSlotIdx && !s.clientId);
                                            if (nextEmpty >= 0) setTimeout(() => setActiveSlotIdx(nextEmpty), 150);
                                        }
                                    }}
                                >
                                    {client.name}
                                </PickRow>
                            );
                        })}
                        {filteredClients.length === 0 && (
                            <div style={PICK_EMPTY}>Никого не нашли — проверьте имя или код</div>
                        )}
                    </PickList>
                </div>

                {/* Стоимость сессии для выбранного клиента */}
                {activeClient && (
                    <Field label="Стоимость сессии">
                        {/* type="number" — как раньше: та же разборка суммы. */}
                        <Input
                            kind="money"
                            type="number"
                            value={activeSlot.price || ''}
                            onChange={e => updateSlot(activeSlotIdx, activeSlot.clientId, Number(e.target.value) || 0)}
                            placeholder={String(activeClient.basePrice || 0)}
                            suffix={currencySign(activeClient.currency)}
                        />
                    </Field>
                )}

                {/* Повторение — видно всегда, даже без клиента. С клиентом —
                    будущие сессии CRM (pushToCalendar=true, в Google Календарь
                    специалиста). Без клиента — серия броней кабинета через
                    createRecurringBooking. */}
                <div>
                    <div style={PICK_LABEL}>Повторять</div>
                    <div className="ui-chip-row" role="group" aria-label="Повторять">
                        {([
                            { id: '', label: 'Не повторять' },
                            { id: 'weekly', label: 'Каждую неделю' },
                            { id: 'biweekly', label: 'Раз в 2 недели' },
                            { id: 'monthly', label: 'Раз в 4 недели' },
                        ] as const).map(p => (
                            <Chip key={p.id} selected={recurringPattern === p.id} onClick={() => setRecurringPattern(p.id as any)}>
                                {p.label}
                            </Chip>
                        ))}
                    </div>
                    {recurringPattern && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 'var(--text-small)', color: 'var(--color-ink-60)' }}>
                            <span>Сколько раз:</span>
                            <input
                                type="number"
                                min={2}
                                max={recurringPattern === 'monthly' ? 24 : 52}
                                value={recurringOccurrences}
                                onChange={(e) => {
                                    const max = recurringPattern === 'monthly' ? 24 : 52;
                                    const v = Math.max(2, Math.min(max, parseInt(e.target.value) || 8));
                                    setRecurringOccurrences(v);
                                }}
                                aria-label="Сколько раз повторить"
                                className="ui-input tabular-nums"
                                style={{ width: 88, textAlign: 'center' }}
                            />
                            <span>включая эту</span>
                        </div>
                    )}
                </div>

                {/* Отменить часть / Разделить — только для обычных активных броней от 2 ч.
                    «Разделить» — несколько самостоятельных броней (отменить или
                    перенести только один час, разные плательщики). Цена не меняется. */}
                {canTrimOrSplit && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--color-ink-08)', paddingTop: 16 }}>
                        <Button variant="secondary" disabled={deleting || saving} onClick={() => onSplit(booking)}>
                            Разделить на отдельные брони
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={deleting || saving}
                            onClick={() => onTrim(booking)}
                            style={{ color: 'var(--status-danger-fg)' }}
                        >
                            Отменить часть
                        </Button>
                    </div>
                )}
            </div>
        </Sheet>
    );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function CrmChessboardView({ initialDate }: { initialDate?: Date } = {}) {
    const { bookings, currentUser, fetchBookings } = useUserStore();
    const { resources, fetchResources } = useBookingStore();
    const { clients, sessions, fetchClients, fetchSessions, createSession, updateSession, deleteSession } = useCrmStore();

    const [filterLocation, setFilterLocation] = useState<string>('all');
    const [selectedDate, setSelectedDate] = useState(initialDate ?? new Date());
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [bookSlot, setBookSlot] = useState<{ resId: string; time: string; date: Date; duration: number } | null>(null);
    const [linkBooking, setLinkBooking] = useState<BookingHistoryItem | null>(null);
    // Open instead of bookingsApi.cancelBooking when the target booking is
    // part of a recurring series — gives the specialist the same "this /
    // future" choice the CRM /sessions delete already offers.
    const [seriesCancelTarget, setSeriesCancelTarget] = useState<BookingHistoryItem | null>(null);
    // Partial-cancel ("trim") target — opens TrimBookingModal for this booking.
    const [trimTarget, setTrimTarget] = useState<BookingHistoryItem | null>(null);
    const [splitTarget, setSplitTarget] = useState<BookingHistoryItem | null>(null);
    // Waitlist subscribe modal — fired when specialist taps a foreign booking
    // (someone else's slot). Backend then notifies them when ANY cabinet in
    // the same branch frees up at the same time.
    const [waitlistTarget, setWaitlistTarget] = useState<{
        resourceId: string;
        resourceName: string;
        locationName?: string | null;
        date: Date;
        startTime: string;
        endTime: string;
    } | null>(null);
    const openWaitlistFor = useCallback((b: BookingHistoryItem) => {
        // Diagnostic toast on missing data — было: silent return на пустых
        // полях, юзер видел dead тап. Теперь админ хотя бы видит причину.
        if (!b.startTime || !b.duration || !b.resourceId) {
            toast.error(
                `Не удалось открыть подписку (нет данных): ` +
                `time=${b.startTime ?? '?'}, dur=${b.duration ?? '?'}, res=${b.resourceId ?? '?'}`,
            );
            return;
        }
        const res = RESOURCES.find(r => r.id === b.resourceId);
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        const endTimeStr = _minToTime(timeToMin(b.startTime) + b.duration);
        setWaitlistTarget({
            resourceId: b.resourceId,
            resourceName: res?.name || b.resourceId,
            locationName: loc?.name ?? null,
            date: parseUTC(b.date),
            startTime: b.startTime,
            endTime: endTimeStr,
        });
    }, []);
    // Same idea for drag-and-drop reschedule of a series booking — after
    // the drop we collect the chosen slot here, the modal asks scope, and
    // the actual API call (single vs propagate) happens inside the modal.
    const [seriesMoveTarget, setSeriesMoveTarget] = useState<{
        booking: BookingHistoryItem;
        newDate: string;
        newStartTime: string;
        newResourceId?: string;
    } | null>(null);

    // Drag to select. Multi-period in the same cabinet is supported the
    // same way the dashboard chessboard does it: each contiguous run of
    // slots in `newSlots` becomes a separate "chunk" with its own resize
    // handles, summary chip and × button.
    const [newSlots, setNewSlots] = useState<string[]>([]);
    // 'new' — drag-painting empty slots to pick a fresh booking range.
    // 'move' — grab an existing OWN booking and drop it onto a free
    // slot to reschedule it via PATCH /bookings/:id/reschedule.
    type DragMode = 'new' | 'move' | null;
    const dragModeRef = useRef<DragMode>(null);
    const dragStartRef = useRef<{ resId: string; time: string } | null>(null);
    // Snapshot of all slots at the moment a 'new' drag begins. Lets the
    // drag handler ADD a draft chunk on top of this snapshot without
    // wiping other chunks the user has already drawn.
    const dragInitialSlotsRef = useRef<string[]>([]);
    // For 'move' drag — the booking being relocated and a hover preview slot
    const movingBookingRef = useRef<BookingHistoryItem | null>(null);
    const [moveHover, setMoveHover] = useState<{ resId: string; time: string } | null>(null);
    const [reschedSaving, setReschedSaving] = useState(false);
    const [, setDragTick] = useState(0);
    const forceDragUpdate = () => setDragTick(t => t + 1);

    useEffect(() => {
        fetchBookings();
        fetchResources();
        if (clients.length === 0) fetchClients();
        fetchSessions();
    }, []);

    const weekDays = useMemo(() =>
        eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 1 }) }),
        [weekStart]
    );

    const filteredResources = useMemo(() =>
        resources.filter(r =>
            r.isActive !== false &&
            (filterLocation === 'all' || r.locationId === filterLocation)
        ),
        [resources, filterLocation]
    );

    // Bookings for selected date
    const bookingsOnDate = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        return bookings.filter(b => {
            if (!b.date) return false;
            try {
                const bd = parseUTC(b.date);
                return format(bd, 'yyyy-MM-dd') === dateStr &&
                    (b.status === 'confirmed' || b.status === 're-rented' || b.status === 'completed');
            } catch { return false; }
        });
    }, [bookings, selectedDate]);

    // Slot map
    const slotMap = useMemo(() => {
        const map = new Map<string, { booking: BookingHistoryItem; isStart: boolean }>();
        bookingsOnDate.forEach(booking => {
            if (!booking.startTime || !booking.duration || !booking.resourceId) return;
            const startMin = timeToMin(booking.startTime);
            const dur = booking.duration;
            TIME_SLOTS.forEach(slot => {
                const sMin = timeToMin(slot);
                if (sMin >= startMin && sMin < startMin + dur) {
                    map.set(`${booking.resourceId}|${slot}`, {
                        booking,
                        isStart: sMin === startMin,
                    });
                }
            });
        });
        return map;
    }, [bookingsOnDate]);

    // Session lookup by bookingId (one booking can have multiple hourly sessions)
    const sessionsByBookingId = useMemo(() => {
        const map = new Map<string, (typeof sessions[0])[]>();
        sessions.forEach(s => {
            if (s.bookingId) {
                const arr = map.get(s.bookingId) || [];
                arr.push(s);
                map.set(s.bookingId, arr);
            }
        });
        return map;
    }, [sessions]);

    // Client lookup
    const clientById = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach(c => map.set(c.id, c));
        return map;
    }, [clients]);

    // 05.10 (владелец): «сессии без кабинета» — встречи из календаря (CRM-сессии без
    // аренды) на выбранный день. Только показ; деньги не двигаются, пока специалист
    // сам не снимет кабинет. Онлайн-встречи тоже попадут сюда — строку можно скрыть.
    const [showGhosts, setShowGhosts] = useState<boolean>(() => {
        try { return localStorage.getItem('crm.showGhosts') !== '0'; } catch { return true; }
    });
    useEffect(() => {
        try { localStorage.setItem('crm.showGhosts', showGhosts ? '1' : '0'); } catch { /* приватный режим */ }
    }, [showGhosts]);
    const ghostSessions = useMemo(() => {
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const out: { session: (typeof sessions)[number]; time: string; duration: number }[] = [];
        for (const sess of sessions) {
            if (sess.bookingId || sess.status === 'CANCELLED_CLIENT' || sess.status === 'CANCELLED_THERAPIST') continue;
            const wc = utcNaiveToTbilisi(sess.date);
            if (!wc || wc.date !== dateStr) continue;
            out.push({ session: sess, time: wc.time, duration: sess.durationMinutes || 60 });
        }
        return out.sort((a, b) => a.time.localeCompare(b.time));
    }, [sessions, selectedDate]);
    const [ghostTarget, setGhostTarget] = useState<(typeof ghostSessions)[number] | null>(null);
    // Сессия, которую привязать к брони после «Снять кабинет» (вместо новой сессии).
    const ghostLinkRef = useRef<{ sessionId: string; clientId: string } | null>(null);

    // Row cells. Tbilisi-aware now() — without it admins on UK VPN saw
    // wrong "is past" boundary (slots already over by Tbilisi-clock still
    // looked free in their browser-local 22:00 evening).
    const rowCellsMap = useMemo(() => {
        const now = tbilisiNow();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = now.ymd;

        const isPast = (slot: string): boolean => {
            if (dateStr < nowStr) return true;
            if (dateStr > nowStr) return false;
            return timeToMin(slot) < now.totalMins;
        };

        const map = new Map<string, CellInfo[]>();
        filteredResources.forEach(resource => {
            const cells: CellInfo[] = [];
            let i = 0;
            while (i < TIME_SLOTS.length) {
                const slot = TIME_SLOTS[i];
                const entry = slotMap.get(`${resource.id}|${slot}`);
                if (entry?.isStart) {
                    const colspan = Math.min(
                        Math.ceil((entry.booking.duration || 60) / 30),
                        TIME_SLOTS.length - i
                    );
                    const isMine = entry.booking.userId === currentUser?.email;
                    cells.push({ type: 'booking', slot, booking: entry.booking, colspan, isMine });
                    i += colspan;
                } else {
                    cells.push({ type: 'free', slot, past: isPast(slot) });
                    i++;
                }
            }
            map.set(resource.id, cells);
        });
        return map;
    }, [filteredResources, slotMap, selectedDate, currentUser?.email]);

    // Drag helpers
    const isSlotOccupied = useCallback((resId: string, time: string) => {
        const now = tbilisiNow();
        const dateStr = format(selectedDate, 'yyyy-MM-dd');
        const nowStr = now.ymd;
        if (dateStr < nowStr) return true;
        if (dateStr === nowStr && timeToMin(time) < now.totalMins) return true;
        return slotMap.has(`${resId}|${time}`);
    }, [selectedDate, slotMap]);

    const isNewSlotSelected = (resId: string, time: string) =>
        newSlots.includes(`${resId}|${time}`);

    const setNewSlotRange = useCallback((resId: string, times: string[]) => {
        setNewSlots(prev => {
            const other = prev.filter(s => !s.startsWith(`${resId}|`));
            return [...other, ...times.map(t => `${resId}|${t}`)];
        });
    }, []);

    /** Selected blocks — every CONTIGUOUS run of slots within a resource
     *  becomes its own block (so cab 5 with 10:00-11:00 + 15:00-16:00 is
     *  two blocks, not one 10:00-16:00 monstrosity). */
    const selectedBlocks = useMemo(() => {
        const byRes: Record<string, number[]> = {};
        for (const slot of newSlots) {
            if (!slot || !slot.includes('|')) continue;
            const [resId, timeStr] = slot.split('|');
            const idx = TIME_SLOTS.indexOf(timeStr);
            if (idx === -1) continue;
            (byRes[resId] ||= []).push(idx);
        }
        const blocks: { resId: string; start: number; end: number }[] = [];
        for (const [resId, raw] of Object.entries(byRes)) {
            const sorted = [...raw].sort((a, b) => a - b);
            let cur: number[] = [];
            for (const i of sorted) {
                if (cur.length === 0 || i === cur[cur.length - 1] + 1) cur.push(i);
                else { blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] }); cur = [i]; }
            }
            if (cur.length) blocks.push({ resId, start: cur[0], end: cur[cur.length - 1] });
        }
        return blocks;
    }, [newSlots]);

    /** Block containing a specific (resource, slot-idx). Used by cell
     *  rendering for chunk-aware start/end edges. */
    const getBlockAt = (resId: string, idx: number) =>
        selectedBlocks.find(b => b.resId === resId && idx >= b.start && idx <= b.end) ?? null;

    /** Legacy single-block view — first chunk in the resource. Kept only
     *  for code paths that do not yet know about multi-period (mobile tap,
     *  initial focus on continue, etc). */
    const selectedBlock = selectedBlocks[0] ?? null;

    /** Drop a single chunk from the selection. Other chunks (in the same
     *  or other resources) stay untouched. */
    const removeBlock = useCallback((block: { resId: string; start: number; end: number }) => {
        const idsToRemove = new Set<string>();
        for (let i = block.start; i <= block.end; i++) {
            idsToRemove.add(`${block.resId}|${TIME_SLOTS[i]}`);
        }
        setNewSlots(prev => prev.filter(s => !idsToRemove.has(s)));
    }, []);

    const handleDragDown = (resId: string, time: string) => {
        if (isSlotOccupied(resId, time)) return;
        dragModeRef.current = 'new';
        dragStartRef.current = { resId, time };
        // Snapshot at drag-start. New drags ADD a fresh chunk on top of
        // this; resize/move replace ONLY the chunk being touched.
        dragInitialSlotsRef.current = [...newSlots];
        // Add the click point as a draft single-slot chunk; do NOT wipe
        // the resource's other chunks (which the legacy `setNewSlotRange`
        // did, breaking multi-period in the same cabinet).
        setNewSlots(prev => {
            const slotId = `${resId}|${time}`;
            return prev.includes(slotId) ? prev : [...prev, slotId];
        });
        forceDragUpdate();
    };

    /** Start dragging an OWN booking to relocate it. The booking can be
     *  dropped on any free slot (any cabinet, any time within the day);
     *  on drop we PATCH /bookings/:id/reschedule. Forbid past slots. */
    const handleBookingMoveDown = (booking: BookingHistoryItem) => {
        // Only confirmed bookings; cancelled/completed don't move
        if (booking.status !== 'confirmed') return;
        dragModeRef.current = 'move';
        movingBookingRef.current = booking;
        forceDragUpdate();
    };

    const handleDragEnter = useCallback((resId: string, time: string) => {
        if (dragModeRef.current === 'move') {
            setMoveHover({ resId, time });
            return;
        }
        if (!dragModeRef.current || !dragStartRef.current) return;
        if (dragStartRef.current.resId !== resId) return;
        const startIdx = TIME_SLOTS.indexOf(dragStartRef.current.time);
        const curIdx = TIME_SLOTS.indexOf(time);
        if (startIdx === -1 || curIdx === -1) return;
        const minIdx = Math.min(startIdx, curIdx);
        const maxIdx = Math.max(startIdx, curIdx);
        const draftSlots: string[] = [];
        let blocked = false;
        for (let i = minIdx; i <= maxIdx; i++) {
            if (isSlotOccupied(resId, TIME_SLOTS[i])) { blocked = true; break; }
            draftSlots.push(TIME_SLOTS[i]);
        }
        if (blocked) return;
        // Strip only the draft slots (anything we may have added during
        // earlier ticks of THIS drag) from the snapshot, then re-add the
        // current draft. Existing chunks — same cabinet or different —
        // survive intact, which is what makes multi-period selection work.
        const draftIds = new Set(draftSlots.map(t => `${resId}|${t}`));
        const survivors = dragInitialSlotsRef.current.filter(s => !draftIds.has(s));
        setNewSlots([...survivors, ...draftIds]);
    }, [isSlotOccupied]);

    const handleDragUp = useCallback(() => {
        if (!dragModeRef.current) return;

        // Reschedule branch: dropped a moved booking onto a free slot
        if (dragModeRef.current === 'move') {
            const booking = movingBookingRef.current;
            const target = moveHover;
            dragModeRef.current = null;
            movingBookingRef.current = null;
            setMoveHover(null);
            forceDragUpdate();
            if (!booking || !target) return;
            // Same slot? — no-op
            const sameSlot = (booking.resourceId === target.resId)
                && (booking.startTime === target.time)
                && (format(parseUTC(booking.date), 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd'));
            if (sameSlot) return;
            // Verify target slot is free for the full duration of the booking
            const dur = booking.duration || 60;
            const need = Math.ceil(dur / 30);
            const idx = TIME_SLOTS.indexOf(target.time);
            if (idx < 0) { toast.error('Слот вне расписания'); return; }
            for (let i = idx; i < idx + need; i++) {
                if (i >= TIME_SLOTS.length) { toast.error('Бронь не помещается до конца дня'); return; }
                if (isSlotOccupied(target.resId, TIME_SLOTS[i])) { toast.error('Слот занят целиком — выберите другое время'); return; }
            }
            // Fire reschedule
            const newDate = format(selectedDate, 'yyyy-MM-dd');
            // Series → defer to the choice modal so the specialist picks
            // "this only" vs "this + every later sibling". Otherwise hit
            // the single-booking endpoint directly.
            if (booking.recurringGroupId) {
                setSeriesMoveTarget({
                    booking,
                    newDate,
                    newStartTime: target.time,
                    newResourceId: target.resId,
                });
                return;
            }
            setReschedSaving(true);
            bookingsApi.rescheduleBooking(booking.id, {
                newDate,
                newStartTime: target.time,
                newResourceId: target.resId,
            }).then(async () => {
                toast.success('Бронь перенесена');
                await fetchBookings();
            }).catch((err) => {
                toast.error(apiErrorMessage(err, 'Не удалось перенести бронь'));
            }).finally(() => setReschedSaving(false));
            return;
        }

        const dragRes = dragStartRef.current?.resId ?? null;
        const dragTime = dragStartRef.current?.time ?? null;
        dragModeRef.current = null;
        dragStartRef.current = null;
        forceDragUpdate();
        // Auto-extend to at least 60min — applies only to the slot the
        // user just clicked, and only if it's currently a SINGLETON
        // chunk (no immediate neighbor in selection). With multi-period
        // support we can't just check "total length === 1" anymore.
        if (dragRes && dragTime) {
            setNewSlots(prev => {
                const idx = TIME_SLOTS.indexOf(dragTime);
                if (idx < 0) return prev;
                const startId = `${dragRes}|${dragTime}`;
                if (!prev.includes(startId)) return prev;
                const nextTime = idx + 1 < TIME_SLOTS.length ? TIME_SLOTS[idx + 1] : null;
                const prevTime = idx > 0 ? TIME_SLOTS[idx - 1] : null;
                if (nextTime && prev.includes(`${dragRes}|${nextTime}`)) return prev;
                if (prevTime && prev.includes(`${dragRes}|${prevTime}`)) return prev;
                if (!nextTime || isSlotOccupied(dragRes, nextTime)) return prev;
                return [...prev, `${dragRes}|${nextTime}`];
            });
        }
    }, [isSlotOccupied, moveHover, selectedDate, fetchBookings]);

    useEffect(() => {
        const handleMove = (e: PointerEvent) => {
            if (!dragModeRef.current) return;
            const target = document.elementFromPoint(e.clientX, e.clientY);
            if (!target) return;
            const el = target.closest('[data-crm-resid][data-crm-time]');
            if (el) {
                const rId = el.getAttribute('data-crm-resid');
                const tStr = el.getAttribute('data-crm-time');
                if (rId && tStr) handleDragEnter(rId, tStr);
            }
        };
        window.addEventListener('pointerup', handleDragUp);
        window.addEventListener('pointermove', handleMove);
        return () => {
            window.removeEventListener('pointerup', handleDragUp);
            window.removeEventListener('pointermove', handleMove);
        };
    }, [handleDragUp, handleDragEnter]);

    useEffect(() => { setNewSlots([]); }, [selectedDate]);

    // Queue of remaining chunks waiting for the booking modal. When the
    // user picks N chunks and clicks "Забронировать", we open the modal
    // for the first chunk, and on each successful confirm pull the next
    // one off this queue. Empty queue → close modal & clear selection.
    const [pendingChunks, setPendingChunks] = useState<{ resId: string; time: string; duration: number }[]>([]);

    const handleContinue = () => {
        if (selectedBlocks.length === 0) return;
        const queue = selectedBlocks.map(b => ({
            resId: b.resId,
            time: TIME_SLOTS[b.start],
            duration: (b.end - b.start + 1) * 30,
        }));
        const [first, ...rest] = queue;
        setPendingChunks(rest);
        setBookSlot({ resId: first.resId, time: first.time, date: selectedDate, duration: first.duration });
    };

    const handleBooked = async (bookingId: string, clientId: string | null, price: number) => {
        const ghost = ghostLinkRef.current;
        ghostLinkRef.current = null;
        if (ghost && bookingId && (!clientId || clientId === ghost.clientId)) {
            // Встреча уже есть в календаре — привязываем её к новой аренде.
            await updateSession(ghost.sessionId, { bookingId, isBooked: true });
        } else if (clientId && bookingId) {
            const bookingDate = format(selectedDate, 'yyyy-MM-dd');
            const timeStr = bookSlot?.time || '00:00';
            // 01.10: сессия сразу уходит в Google Календарь (если подключён) —
            // иначе синк потом делал из события специалиста вторую сессию.
            await createSessionResolvingCalendar(createSession, updateSession, {
                clientId,
                date: `${bookingDate}T${timeStr}:00`,
                durationMinutes: bookSlot?.duration || 60,
                price: price || undefined,
                bookingId,
                isBooked: true,
                pushToCalendar: true,
            });
        }
        await fetchBookings();
        await fetchSessions();
        // Drop only the just-booked chunk from the selection — keep the
        // remaining pending chunks visible while the modal advances.
        if (bookSlot) {
            const slotIdx = TIME_SLOTS.indexOf(bookSlot.time);
            const slotCount = Math.max(1, Math.round((bookSlot.duration || 60) / 30));
            const idsToRemove = new Set<string>();
            for (let i = 0; i < slotCount; i++) {
                const t = TIME_SLOTS[slotIdx + i];
                if (t) idsToRemove.add(`${bookSlot.resId}|${t}`);
            }
            setNewSlots(prev => prev.filter(s => !idsToRemove.has(s)));
        }
        // If more chunks are queued, open the modal for the next one;
        // otherwise close it and reset the queue.
        if (pendingChunks.length > 0) {
            const [next, ...rest] = pendingChunks;
            setPendingChunks(rest);
            setBookSlot({ resId: next.resId, time: next.time, date: selectedDate, duration: next.duration });
        } else {
            setBookSlot(null);
        }
    };

    // Handle saving multi-slot client assignments for a booking
    const handleMultiSlotSave = async (
        booking: BookingHistoryItem,
        slotAssignments: { hour: number; clientId: string | null; price: number; existingSessionId?: string }[],
        opts?: { recurringPattern?: 'weekly' | 'biweekly' | 'monthly' | ''; occurrences?: number }
    ) => {
        const rawDate = booking.date as any;
        let dateStr: string;
        if (rawDate instanceof Date) {
            dateStr = format(rawDate, 'yyyy-MM-dd');
        } else {
            dateStr = String(rawDate).replace(' 12:00', '').split('T')[0].split(' ')[0];
        }

        for (const slot of slotAssignments) {
            const h = Math.floor(slot.hour / 60);
            const m = slot.hour % 60;
            const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const sessionDate = `${dateStr}T${timeStr}:00`;

            if (slot.existingSessionId) {
                if (slot.clientId) {
                    await updateSession(slot.existingSessionId, {
                        clientId: slot.clientId,
                        price: slot.price || undefined,
                        date: sessionDate,
                    });
                } else {
                    await deleteSession(slot.existingSessionId);
                }
            } else if (slot.clientId) {
                await createSessionResolvingCalendar(createSession, updateSession, {
                    clientId: slot.clientId,
                    date: sessionDate,
                    durationMinutes: 60,
                    price: slot.price || undefined,
                    bookingId: booking.id,
                    isBooked: true,
                    pushToCalendar: true,
                });
            }
        }

        // Recurring strategy:
        //   • If at least one slot has a linked client → spawn future CRM
        //     sessions (with pushToCalendar=true so they appear in the
        //     specialist's Google Calendar — that's the user-visible side).
        //   • If NO clients are linked → user just wants to repeat the
        //     cabinet booking on the same weekday. Use createRecurringBooking
        //     which clones the booking N times and writes GCal events from
        //     the booking-side sync (each cabinet has its own Google
        //     Calendar that shows the rental).
        let recurringCreated = 0;
        let recurringBookings = 0;
        // Set when the cabinet recurring call returned a 4xx (atomic fail).
        // Used below to suppress the misleading green "Сохранено" toast.
        let recurringFailed = false;
        if (opts?.recurringPattern && opts.occurrences && opts.occurrences > 1) {
            const hasClients = slotAssignments.some(s => s.clientId);
            if (hasClients) {
                const baseDate = new Date(`${dateStr}T00:00:00`);
                // One UUID stamped on every CRM session in this series — lets
                // the delete UI later offer "this one vs this+future" the way
                // Google Calendar does. Generated once per click, not per slot,
                // so multi-client recurring (rare but possible) shares a group.
                // Один ответ на near-конфликты календаря на всю серию (не 24 вопроса подряд).
                const seriesCalendarChoice: SeriesCalendarChoice = {};
                const recurringGroupId = (typeof crypto !== 'undefined' && crypto.randomUUID)
                    ? crypto.randomUUID()
                    : `rg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                for (let n = 1; n < opts.occurrences; n++) {
                    let nextDate: Date;
                    if (opts.recurringPattern === 'weekly') {
                        nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 7 * n);
                    } else if (opts.recurringPattern === 'biweekly') {
                        nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 14 * n);
                    } else { // «раз в 4 недели» — +28 дней, день недели фиксирован
                        nextDate = new Date(baseDate); nextDate.setDate(nextDate.getDate() + 28 * n);
                    }
                    const nextDateStr = format(nextDate, 'yyyy-MM-dd');
                    for (const slot of slotAssignments) {
                        if (!slot.clientId) continue;
                        const h = Math.floor(slot.hour / 60);
                        const m = slot.hour % 60;
                        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                        try {
                            const made = await createSessionResolvingCalendar(createSession, updateSession, {
                                clientId: slot.clientId,
                                date: `${nextDateStr}T${timeStr}:00`,
                                durationMinutes: 60,
                                price: slot.price || undefined,
                                // pushToCalendar=true so each future session
                                // shows up in the specialist's Google Calendar
                                // (calendar_id from /crm/settings).
                                pushToCalendar: true,
                                recurringGroupId,
                                isBooked: false,
                            }, seriesCalendarChoice);
                            if (made) recurringCreated++;
                        } catch (e) {
                            // Don't swallow silently — earlier we did, and a
                            // missing gcal_event_id was invisible to the
                            // specialist. Log so it surfaces in DevTools.
                            console.error('Recurring CRM session create failed', {
                                date: `${nextDateStr}T${timeStr}:00`,
                                clientId: slot.clientId,
                                error: e,
                            });
                        }
                    }
                }
            } else {
                // No clients → recurring CABINET booking. Bot the back-end
                // creates one bookings per occurrence and syncs each into
                // the cabinet's Google Calendar.
                try {
                    const res = await bookingsApi.createRecurringBooking({
                        resourceId: booking.resourceId || '',
                        locationId: (booking as any).locationId || booking.resourceId || '',
                        startTime: booking.startTime || '00:00',
                        duration: booking.duration || 60,
                        format: (booking as any).format || 'individual',
                        paymentMethod: (booking as any).paymentMethod || 'balance',
                        firstDate: dateStr,
                        occurrences: opts.occurrences,
                        pattern: opts.recurringPattern,
                    });
                    recurringBookings = res.created || 0;
                } catch (e: any) {
                    toast.error(apiErrorMessage(e, 'Не удалось создать серию броней'));
                    // Atomic backend: nothing was created. Mark the failure so
                    // we don't follow up with a misleading "Сохранено" toast.
                    recurringFailed = true;
                }
            }
        }

        // Toast logic — distinguish "everything saved", "partial save", and
        // "nothing saved". Earlier we always closed with toast.success which
        // showed a green "Сохранено" right next to a red conflict toast and
        // confused the user.
        const savedSomething =
            slotAssignments.some(s => s.clientId || s.existingSessionId) ||
            recurringCreated > 0 ||
            recurringBookings > 0;
        const partsMsg: string[] = [];
        if (slotAssignments.some(s => s.clientId || s.existingSessionId)) partsMsg.push('сессии сохранены');
        if (recurringCreated > 0) partsMsg.push(`+${recurringCreated} будущих сессий в Google Calendar`);
        if (recurringBookings > 0) partsMsg.push(`+${recurringBookings} будущих броней кабинета`);
        if (savedSomething) {
            toast.success(partsMsg.length ? partsMsg.join(' · ') : 'Сохранено');
        }
        // If only the recurring failed, stay quiet — the red conflict toast
        // already explains everything; a green companion would lie.
        await fetchSessions();
        if (recurringBookings > 0) await fetchBookings();
        // Keep the modal open after a failed series so the specialist can
        // tweak (e.g. shift start date by a week) without re-opening from
        // the chessboard. Modal closes itself when this returns truthy.
        if (recurringFailed && !savedSomething) {
            return false;
        }
        setLinkBooking(null);
        return true;
    };

    const handleDeleteBooking = async (booking: BookingHistoryItem) => {
        if (booking.recurringGroupId) {
            // Defer to the choice modal so the specialist picks "this" vs
            // "all future". Close the link modal first so the choice
            // modal isn't competing for focus.
            setLinkBooking(null);
            setSeriesCancelTarget(booking);
            return;
        }
        try {
            await bookingsApi.cancelBooking(booking.id);
            toast.success('Бронь удалена');
            await fetchBookings();
            await fetchSessions();
            setLinkBooking(null);
        } catch (err: any) {
            toast.error(apiErrorMessage(err, 'Не удалось удалить бронь'));
            throw err;
        }
    };

    const SLOT_W = 48; // px per 30-min slot

    // ── Mobile detection ──
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', handler);
        return () => window.removeEventListener('resize', handler);
    }, []);

    const [mobileResIdx, setMobileResIdx] = useState(0);
    const mobileRes = filteredResources[mobileResIdx] || filteredResources[0];

    // Mobile tap: tap full-hour = select pair (XX:00 + XX:30), tap individual = extend/toggle
    const handleMobileTap = (resId: string, time: string, _isHourTap: boolean) => {
        if (isSlotOccupied(resId, time)) return;
        const slotIdx = TIME_SLOTS.indexOf(time);

        // If tapping an already-selected slot, deselect all
        if (newSlots.includes(`${resId}|${time}`)) {
            setNewSlots([]);
            return;
        }

        // If we already have a block, extend it — always +1 slot at a time
        if (selectedBlock && selectedBlock.resId === resId) {
            const newStart = Math.min(selectedBlock.start, slotIdx);
            const newEnd = Math.max(selectedBlock.end, slotIdx);
            const slots: string[] = [];
            for (let i = newStart; i <= newEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        } else {
            // First selection — ALWAYS auto-select pair (1h minimum)
            const pairStart = slotIdx % 2 === 0 ? slotIdx : slotIdx - 1;
            const pairEnd = pairStart + 1;
            if (pairEnd >= TIME_SLOTS.length) return;
            const slots: string[] = [];
            for (let i = pairStart; i <= pairEnd; i++) {
                if (isSlotOccupied(resId, TIME_SLOTS[i])) return;
                slots.push(TIME_SLOTS[i]);
            }
            setNewSlotRange(resId, slots);
        }
    };

    // Group TIME_SLOTS into hour-pairs for mobile grid: [[09:00, 09:30], [10:00, 10:30], ...]
    const mobileHourPairs = useMemo(() => {
        const pairs: [string, string | null][] = [];
        for (let i = 0; i < TIME_SLOTS.length; i += 2) {
            pairs.push([TIME_SLOTS[i], TIME_SLOTS[i + 1] ?? null]);
        }
        return pairs;
    }, []);

    // ── Shared controls (used in both mobile and desktop) ──
    const weekNav = (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={() => setWeekStart(subWeeks(weekStart, 1))}
                aria-label="Предыдущая неделя"
                className="p-2.5 border border-ink-20 text-ink hover:bg-ink-05 transition-colors"
            >
                <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <span className="text-sm font-medium min-w-[100px] md:min-w-[160px] text-center">
                {formatDayMonth(weekStart)} – {formatDayMonth(endOfWeek(weekStart, { weekStartsOn: 1 }))}
            </span>
            <button
                type="button"
                onClick={() => setWeekStart(addWeeks(weekStart, 1))}
                aria-label="Следующая неделя"
                className="p-2.5 border border-ink-20 text-ink hover:bg-ink-05 transition-colors"
            >
                <ChevronRight size={16} aria-hidden="true" />
            </button>
        </div>
    );

    const daySelector = (
        <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {weekDays.map(day => {
                const active = isSameDay(day, selectedDate);
                const today = isToday(day);
                return (
                    <button
                        key={day.toISOString()}
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        aria-pressed={active}
                        aria-label={formatDayMonth(day) + (today ? ', сегодня' : '')}
                        className={clsx(
                            'flex flex-col items-center px-2.5 md:px-3 py-2 min-w-[44px] md:min-w-[52px] text-sm transition-colors border',
                            active
                                ? 'bg-accent text-on-accent border-accent'
                                : today
                                    ? 'border-accent text-accent-ink hover:bg-accent-soft'
                                    : 'border-transparent text-ink-60 hover:bg-ink-05'
                        )}
                    >
                        <span className="text-xs uppercase font-semibold">
                            {format(day, 'EEEEEE', { locale: ru })}
                        </span>
                        <span className="font-semibold text-base leading-none">{format(day, 'd')}</span>
                    </button>
                );
            })}
        </div>
    );

    // Summary bar — one chip per chunk so multi-period selection
    // ("Кабинет 5 · 10:00-11:00", "Кабинет 5 · 15:00-16:00") shows
    // both periods with independent × buttons.
    const selectedBar = selectedBlocks.length > 0 ? (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 bg-accent-soft border border-accent/30 px-3 sm:px-4 py-2.5">
            <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                {selectedBlocks.map((b, i) => {
                    const resName = RESOURCES.find(r => r.id === b.resId)?.name || b.resId;
                    const startT = TIME_SLOTS[b.start];
                    const endT = TIME_SLOTS[b.end + 1] ?? '21:00';
                    const mins = (b.end - b.start + 1) * 30;
                    return (
                        <div
                            key={`${b.resId}-${b.start}-${i}`}
                            className="inline-flex items-center gap-1.5 bg-card border border-accent/30 px-2 py-1 text-xs font-semibold text-ink"
                        >
                            <span className="text-ink-60 font-normal">{resName}</span>
                            <span className="font-mono">{startT}–{endT}</span>
                            <span className="text-ink-60 font-normal">· {durationLabel(mins)}</span>
                            <button
                                type="button"
                                onClick={() => removeBlock(b)}
                                className="ml-1 hover:bg-[var(--status-danger-bg)] p-1 transition-colors"
                                title="Убрать этот период"
                                aria-label={`Убрать ${resName}, ${startT}–${endT}`}
                            >
                                <X size={12} className="text-[var(--status-danger-fg)]" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-2 shrink-0">
                <Button variant="secondary" onClick={() => setNewSlots([])}>
                    Сбросить
                </Button>
                <Button variant="primary" onClick={handleContinue}>
                    Забронировать{selectedBlocks.length > 1 ? ` (${selectedBlocks.length})` : ''} →
                </Button>
            </div>
        </div>
    ) : null;

    // ── MOBILE VIEW ──
    // ── 05.10: «Сессии без кабинета» — окно действий, строка шахматки, полоса на телефоне ──
    useEffect(() => { if (!bookSlot) ghostLinkRef.current = null; }, [bookSlot]);
    const ghostAligned = (time: string) => _minToTime(Math.floor(timeToMin(time) / 30) * 30);
    const ghostSlots = (time: string, duration: number) => {
        const first = TIME_SLOTS.indexOf(ghostAligned(time));
        if (first < 0) return [] as string[];
        const n = Math.max(1, Math.ceil((timeToMin(time) - timeToMin(ghostAligned(time)) + duration) / 30));
        return TIME_SLOTS.slice(first, first + n);
    };
    const ghostFreeRooms = ghostTarget
        ? filteredResources.filter(r => {
            const slots = ghostSlots(ghostTarget.time, ghostTarget.duration);
            return slots.length > 0 && slots.every(t => !isSlotOccupied(r.id, t));
        })
        : [];
    const ghostOwnBookings = ghostTarget
        ? bookingsOnDate.filter(b => {
            if (b.userId !== currentUser?.email || b.status !== 'confirmed') return false;
            const bs = timeToMin(b.startTime), be = bs + (b.duration || 60);
            const gs = timeToMin(ghostTarget.time), ge = gs + ghostTarget.duration;
            return bs < ge && gs < be;
        })
        : [];
    const ghostName = (g: { session: { clientId: string } }) => clientById.get(g.session.clientId)?.name || 'Клиент';
    // Есть своя аренда на это время, к которой ещё не привязана живая сессия.
    const ghostHasOwnBooking = (g: { time: string; duration: number }) => {
        const gs = timeToMin(g.time), ge = gs + g.duration;
        return bookingsOnDate.some(b => {
            if (b.userId !== currentUser?.email || b.status !== 'confirmed') return false;
            const bs = timeToMin(b.startTime), be = bs + (b.duration || 60);
            const live = (sessionsByBookingId.get(b.id) || []).filter(x => x.status !== 'CANCELLED_CLIENT' && x.status !== 'CANCELLED_THERAPIST');
            return bs < ge && gs < be && live.length === 0;
        });
    };
    const ghostLabel = (g: (typeof ghostSessions)[number]) =>
        `${g.time} ${ghostName(g)} · ${ghostHasOwnBooking(g) ? 'есть ваша аренда — привязать' : 'нет кабинета'}`;
    const linkGhostToBooking = async (bookingId: string) => {
        if (!ghostTarget) return;
        try {
            await updateSession(ghostTarget.session.id, { bookingId, isBooked: true });
            toast.success('Сессия привязана к аренде');
            setGhostTarget(null);
            await fetchSessions();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось привязать сессию'));
        }
    };
    const bookCabinetForGhost = (resId: string) => {
        if (!ghostTarget) return;
        ghostLinkRef.current = { sessionId: ghostTarget.session.id, clientId: ghostTarget.session.clientId };
        const t = ghostAligned(ghostTarget.time);
        const dur = Math.max(30, Math.ceil((timeToMin(ghostTarget.time) - timeToMin(t) + ghostTarget.duration) / 30) * 30);
        setGhostTarget(null);
        setBookSlot({ resId, time: t, date: selectedDate, duration: dur });
    };
    const ghostSheet = ghostTarget && (
        <Sheet
            open
            onClose={() => setGhostTarget(null)}
            title="Сессия без кабинета"
            description={`${ghostName(ghostTarget)} · ${ghostTarget.time} · ${ghostTarget.duration} мин`}
            width={440}
        >
            <div className="space-y-4 text-sm">
                <p className="text-ink-60 m-0">Встреча есть в календаре, а кабинет под неё не снят. Если это онлайн-сессия — кабинет не нужен.</p>
                {ghostOwnBookings.length > 0 && (
                    <PickList label="Привязать к вашей аренде">
                        {ghostOwnBookings.map(b => (
                            <PickRow key={b.id} onClick={() => linkGhostToBooking(b.id)} meta={`${b.startTime} · ${b.duration || 60} мин`}>
                                {RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId}
                            </PickRow>
                        ))}
                    </PickList>
                )}
                <PickList label="Снять кабинет на это время">
                    {ghostFreeRooms.length === 0
                        ? <div style={PICK_EMPTY}>Свободных кабинетов на это время нет{filterLocation !== 'all' ? ' в выбранном филиале' : ''}</div>
                        : ghostFreeRooms.map(r => (
                            <PickRow key={r.id} onClick={() => bookCabinetForGhost(r.id)} meta={LOCATIONS.find(l => l.id === r.locationId)?.name}>
                                {r.name}
                            </PickRow>
                        ))}
                </PickList>
                <p className="text-xs text-ink-60 m-0">Кабинет оплачивается по обычным правилам, только после вашего подтверждения в следующем окне.</p>
            </div>
        </Sheet>
    );
    const ghostStrip = showGhosts && ghostSessions.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Сессии без кабинета">
            {ghostSessions.map(g => (
                <button
                    key={g.session.id}
                    type="button"
                    onClick={() => setGhostTarget(g)}
                    className="px-2 py-1 text-xs border border-dashed border-ink-40 text-ink opacity-70 hover:opacity-100 bg-card"
                    title="Встреча из календаря без аренды кабинета — нажмите, чтобы снять кабинет или привязать"
                >
                    {ghostLabel(g)}
                </button>
            ))}
        </div>
    );

    if (isMobile) {
        // Build a lookup for booking cells by slot
        const mobileCells = mobileRes ? (rowCellsMap.get(mobileRes.id) ?? []) : [];
        const bookingBySlot = new Map<string, CellInfo>();
        mobileCells.forEach(c => { if (c.type === 'booking') bookingBySlot.set(c.slot, c); });
        // Track which slots are "consumed" by a multi-slot booking so we skip them
        const consumedSlots = new Set<string>();
        mobileCells.forEach(c => {
            if (c.type === 'booking') {
                const startIdx = TIME_SLOTS.indexOf(c.slot);
                for (let i = 1; i < c.colspan; i++) consumedSlots.add(TIME_SLOTS[startIdx + i]);
            }
        });

        // Render a single mobile slot cell
        const renderMobileSlot = (slot: string | null, isHourCol: boolean) => {
            if (!slot || !mobileRes) return <div className="flex-1" />;

            // If consumed by a booking that started earlier, skip
            if (consumedSlots.has(slot)) return null;

            const bookingCell = bookingBySlot.get(slot);
            if (bookingCell && bookingCell.type === 'booking') {
                const { booking, isMine, colspan } = bookingCell;
                // Mirror desktop's filter: cancelled CRM sessions don't count
                // for naming the slot. Without this, a slot whose only linked
                // session was cancelled by the client kept rendering the
                // client's name on mobile (matching the desktop bug Анна
                // / Максим/Нурлана reported on the cabinet chessboard).
                const allLinkedSessions = sessionsByBookingId.get(booking.id) || [];
                const linkedSessions = allLinkedSessions.filter(
                    s => s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST'
                );
                const firstSession = linkedSessions[0];
                const allCancelled = allLinkedSessions.length > 0 && linkedSessions.length === 0;
                const linkedClient = firstSession
                    ? clientById.get(firstSession.clientId)
                    : (booking.crmClientId && !allCancelled ? clientById.get(booking.crmClientId) : undefined);
                const endSlotIdx = TIME_SLOTS.indexOf(slot) + colspan;
                const endTime = endSlotIdx < TIME_SLOTS.length ? TIME_SLOTS[endSlotIdx] : '21:00';
                // For multi-slot bookings that span to the next column, we'll handle via colspan spanning
                // claimable: чужой слот на пересдаче — забрать (паритет с desktop/admin)
                const claimable = !isMine && booking.isReRentListed;
                return (
                    <button
                        onClick={() => {
                            if (isMine) { setLinkBooking(booking); return; }
                            if (claimable && booking.resourceId && booking.startTime) {
                                setBookSlot({
                                    resId: booking.resourceId,
                                    time: booking.startTime,
                                    date: selectedDate,
                                    duration: booking.duration ?? 60,
                                });
                                return;
                            }
                            openWaitlistFor(booking);
                        }}
                        title={isMine ? undefined : claimable ? 'Слот на пересдаче — нажмите, чтобы забрать' : 'Нажмите, чтобы следить за слотом'}
                        // Волна 3 (G5-16): свои — тёмная заливка, чужие — тонкая рамка.
                        className={clsx(
                            'group flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors min-h-[48px] active:scale-[0.97]',
                            isMine
                                ? 'bg-ink border border-ink text-on-ink'
                                : claimable
                                    ? 'bg-[var(--status-pending-bg)] border border-[var(--status-pending-fg)]/40 border-dashed text-[var(--status-pending-fg)] hover:bg-[var(--status-pending-bg)]/70'
                                    : 'bg-transparent border border-ink-20 text-ink-60'
                        )}
                    >
                        <div className="min-w-0">
                            <div className="text-xs font-semibold tabular-nums">{slot}–{endTime}</div>
                            <div className="text-xs truncate">
                                {isMine
                                    ? (linkedSessions.length > 1
                                        ? `${linkedSessions.length} ${ruPlural(linkedSessions.length, ['клиент', 'клиента', 'клиентов'])}`
                                        : linkedClient?.name || 'Без клиента — привязать')
                                    : claimable
                                        ? 'На пересдаче — нажмите, чтобы забрать'
                                        : 'Занято — нажмите, чтобы следить'
                                }
                            </div>
                        </div>
                        {isMine
                            ? <UserPlus size={14} className="shrink-0" aria-hidden="true" />
                            : claimable
                                ? <ArrowLeftRight size={14} className="shrink-0" aria-hidden="true" />
                                : <Bell size={14} className="shrink-0 opacity-0 group-focus-visible:opacity-100" aria-hidden="true" />}
                    </button>
                );
            }

            // Free slot
            const past = (() => {
                const cell = mobileCells.find(c => c.slot === slot);
                return cell?.type === 'free' ? cell.past : false;
            })();
            const selected = isNewSlotSelected(mobileRes.id, slot);

            return (
                <button
                    onClick={() => !past && handleMobileTap(mobileRes.id, slot, isHourCol)}
                    disabled={past}
                    className={clsx(
                        'flex-1 flex items-center justify-between px-3 py-2.5 rounded-xl transition-all min-h-[48px]',
                        past
                            ? 'bg-sunken text-ink-60 cursor-not-allowed'
                            : selected
                                ? 'bg-accent text-on-accent'
                                : isPeakTime(slot)
                                    ? 'bg-[var(--status-pending-bg)]/60 text-[var(--status-pending-fg)] border border-[var(--status-pending-fg)]/15 active:scale-[0.97]'
                                    : 'bg-card text-ink border border-ink-10 active:scale-[0.97]'
                    )}
                >
                    <span className={clsx('text-sm font-semibold tabular-nums', selected ? 'text-on-accent' : past ? 'text-ink-60' : 'text-ink')}>
                        {slot}
                    </span>
                    {selected ? (
                        <Check size={16} strokeWidth={3} aria-hidden="true" />
                    ) : !past ? (
                        <div className="w-5 h-5 rounded-full border-2 border-ink-20" aria-hidden="true" />
                    ) : null}
                </button>
            );
        };

        return (
            <div className="space-y-3">
                {weekNav}
                {daySelector}
                {ghostStrip}

                {/* Resource tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" role="group" aria-label="Кабинет">
                    {filteredResources.map((r, idx) => (
                        <Chip key={r.id} className="shrink-0" selected={mobileResIdx === idx} onClick={() => setMobileResIdx(idx)}>
                            {r.name}
                        </Chip>
                    ))}
                </div>
                <p className="text-small text-ink-60">Нажмите на свободное время, чтобы забронировать.</p>

                {selectedBar}

                {/* 2-column time grid */}
                <div className="rounded-2xl bg-card border border-ink-10 p-2 space-y-1">
                    {mobileHourPairs.map(([left, right]) => {
                        const leftRendered = renderMobileSlot(left, true);
                        const rightRendered = right ? renderMobileSlot(right, false) : <div className="flex-1" />;
                        // If both are null (consumed by booking), skip row
                        if (!leftRendered && !rightRendered) return null;
                        return (
                            <div key={left} className="flex gap-1.5">
                                {leftRendered || <div className="flex-1" />}
                                {rightRendered}
                            </div>
                        );
                    })}
                </div>

                {/* Modals */}
                {bookSlot && (
                    <CrmQuickBookModal
                        key={`${bookSlot.resId}|${bookSlot.time}|${bookSlot.duration}`} // новый период — новое окно: иначе 2-й и далее брались с длительностью 1-го
                        slot={bookSlot}
                        crmClients={clients}
                        presetClientId={ghostLinkRef.current?.clientId}
                        // Cancel at any point in the queue → drop remaining
                        // chunks. The user has the chips & can re-trigger
                        // "Забронировать" if they want to retry.
                        onClose={() => { setBookSlot(null); setPendingChunks([]); }}
                        onBooked={handleBooked}
                    />
                )}
                {ghostSheet}
                {linkBooking && (
                    <LinkBookingModal
                        booking={linkBooking}
                        crmClients={clients}
                        existingSessions={sessionsByBookingId.get(linkBooking.id)?.map(s => ({ id: s.id, clientId: s.clientId, date: s.date, durationMinutes: s.durationMinutes })) || []}
                        onClose={() => setLinkBooking(null)}
                        onSaveMulti={(assignments, recOpts) => handleMultiSlotSave(linkBooking, assignments, recOpts)}
                        onDeleteBooking={handleDeleteBooking}
                        onTrim={(b) => { setLinkBooking(null); setTrimTarget(b); }}
                        onSplit={(b) => { setLinkBooking(null); setSplitTarget(b); }}
                    />
                )}
                {/* Slot-watch (waitlist) modal — раньше был только в desktop-ветке,
                    из-за чего мобильный тап по «Занято» открывал состояние, но
                    окно не рендерилось. Дублируем здесь чтобы модал был
                    доступен и на mobile. */}
                <WaitlistSubscribeModal
                    isOpen={!!waitlistTarget}
                    onClose={() => setWaitlistTarget(null)}
                    resourceId={waitlistTarget?.resourceId ?? ''}
                    resourceName={waitlistTarget?.resourceName ?? ''}
                    locationName={waitlistTarget?.locationName}
                    date={waitlistTarget?.date ?? new Date()}
                    startTime={waitlistTarget?.startTime ?? ''}
                    endTime={waitlistTarget?.endTime ?? ''}
                    extraNote="Уведомим, как только в этом филиале освободится любой кабинет в это же время."
                />
            </div>
        );
    }

    // ── DESKTOP VIEW ──

    return (
        // space-y-4 → space-y-2: tighter vertical rhythm so the filter
        // row, day strip and chessboard sit close together. User asked to
        // kill empty space across the page.
        <div className="space-y-2" onPointerUp={handleDragUp}>
            {/* Top row — week-nav on the LEFT, location filter on the RIGHT.
                Used to be two separate rows; collapsing them saves a row
                of vertical space and groups the two "global controls"
                together. Day picker stays on its own row below so day
                buttons can grow to fill width without squeezing. */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="shrink-0">
                    {weekNav}
                </div>
                <div className="ui-chip-row ml-auto" role="group" aria-label="Филиал">
                    {[{ id: 'all', name: 'Все филиалы' }, ...LOCATIONS].map(loc => (
                        <Chip key={loc.id} selected={filterLocation === loc.id} onClick={() => setFilterLocation(loc.id)}>
                            {loc.name}
                        </Chip>
                    ))}
                    <Chip selected={showGhosts} onClick={() => setShowGhosts(v => !v)}>
                        Сессии без кабинета{ghostSessions.length ? ` · ${ghostSessions.length}` : ''}
                    </Chip>
                </div>
            </div>

            {daySelector}

            {selectedBar}

            {/* Grid */}
            <ChessboardScroller minGridWidth={180 + TIME_SLOTS.length * SLOT_W}>
                <table className="border-collapse" style={{ minWidth: `${180 + TIME_SLOTS.length * SLOT_W}px` }}>
                    <thead>
                        <tr>
                            <th className="sticky left-0 z-10 bg-card border-b border-r border-ink-10 px-3 py-2 text-left text-xs text-ink-60 font-medium min-w-[180px]">
                                Кабинет
                            </th>
                            {TIME_SLOTS.map((slot, i) => (
                                <th
                                    key={slot}
                                    className={clsx(
                                        "border-b border-ink-08 text-xs font-normal py-1 text-center",
                                        isPeakTime(slot) ? "text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]/30" : "text-ink-60"
                                    )}
                                    style={{ width: SLOT_W, minWidth: SLOT_W }}
                                >
                                    {i % 2 === 0 ? slot : ''}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {showGhosts && ghostSessions.length > 0 && (() => {
                            // Настоящие клетки таблицы (colSpan), как у броней: абсолютные
                            // пиксели расходились с колонками, когда таблица шире экрана.
                            // Пересекающиеся встречи — каждая дорожка своей строкой.
                            const lanes: { g: (typeof ghostSessions)[number]; first: number; span: number }[][] = [];
                            for (const g of ghostSessions) {
                                const slots = ghostSlots(g.time, g.duration);
                                if (slots.length === 0) continue;
                                const first = TIME_SLOTS.indexOf(slots[0]);
                                const item = { g, first, span: slots.length };
                                const lane = lanes.find(l => l.every(x => x.first + x.span <= first || first + item.span <= x.first));
                                if (lane) lane.push(item); else lanes.push([item]);
                            }
                            return lanes.map((lane, li) => {
                                const byFirst = new Map(lane.map(x => [x.first, x]));
                                const cells: ReactNode[] = [];
                                for (let k = 0; k < TIME_SLOTS.length; ) {
                                    const x = byFirst.get(k);
                                    if (x) {
                                        cells.push(
                                            <td key={k} colSpan={x.span} className="border-b border-ink-08 p-0.5">
                                                <button
                                                    type="button"
                                                    onClick={() => setGhostTarget(x.g)}
                                                    className="w-full h-7 border border-dashed border-ink-40 bg-card text-ink text-xs px-1.5 truncate text-left opacity-70 hover:opacity-100 focus-visible:opacity-100"
                                                    title={`${ghostName(x.g)} · ${x.g.time} · ${x.g.duration} мин — встреча из календаря без кабинета. Нажмите, чтобы снять кабинет или привязать`}
                                                >
                                                    {ghostLabel(x.g)}
                                                </button>
                                            </td>
                                        );
                                        k += x.span;
                                    } else {
                                        cells.push(<td key={k} className="border-b border-ink-08" />);
                                        k += 1;
                                    }
                                }
                                return (
                                    <tr key={`ghost-${li}`}>
                                        {li === 0 && (
                                            <td rowSpan={lanes.length} className="sticky left-0 z-10 bg-card border-b border-r border-ink-10 px-3 py-2 text-xs font-medium text-ink-60 min-w-[180px] align-top">
                                                Сессии без кабинета
                                            </td>
                                        )}
                                        {cells}
                                    </tr>
                                );
                            });
                        })()}
                        {filteredResources.map(resource => {
                            const cells = rowCellsMap.get(resource.id) ?? [];
                            return (
                                <tr key={resource.id} className="group/row">
                                    <td className="sticky left-0 z-10 bg-card border-b border-r border-ink-10 px-3 py-2 text-sm font-medium text-ink group-hover/row:bg-ink-05 transition-colors">
                                        {resource.name}
                                    </td>
                                    {cells.map((cell) => {
                                        if (cell.type === 'booking') {
                                            const { booking, colspan, isMine } = cell;
                                            // Only LIVE sessions count for naming the slot. A cancelled
                                            // CRM session leaves the cabinet booked (specialist paid for
                                            // it and may want to re-rent) but the slot is no longer
                                            // attached to that client — rendering "Алена грум" on a
                                            // slot whose session is CANCELLED_CLIENT confused several
                                            // specialists ("в календаре нет, а тут есть"). Filter
                                            // cancelled out before deciding the label.
                                            const allLinkedSessions = sessionsByBookingId.get(booking.id) || [];
                                            const linkedSessions = allLinkedSessions.filter(
                                                s => s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST'
                                            );
                                            // For single-hour bookings, show the first linked client; for multi-hour, show count
                                            const firstSession = linkedSessions[0];
                                            // Prefer the explicit TherapySession link, but fall back to the
                                            // booking's own crm_client_id — recurring cabinet bookings created
                                            // with a linked client carry crmClientId on the booking itself
                                            // and the matching session sometimes lags (sync race) or doesn't
                                            // exist at all on legacy rows. Skip the fallback if every linked
                                            // session was cancelled — the booking is genuinely "free for
                                            // a new client" at that point.
                                            const allCancelled = allLinkedSessions.length > 0 && linkedSessions.length === 0;
                                            const linkedClient = firstSession
                                                ? clientById.get(firstSession.clientId)
                                                : (booking.crmClientId && !allCancelled ? clientById.get(booking.crmClientId) : undefined);

                                            // Несколько клиентов в одной своей брони. Волна 3 (G5-16):
                                            // свои брони — сплошная тёмная заливка; клиентов
                                            // разделяет светлая пунктирная черта.
                                            const SEGMENT_COLORS = [
                                                'bg-ink border-ink hover:bg-ink-80',
                                                'bg-ink-80 border-ink hover:bg-ink',
                                            ];

                                            const hasMultipleClients = isMine && linkedSessions.length > 1;
                                            // 05.10: своя аренда, под которую нет сессии в календаре.
                                            const noSession = isMine && linkedSessions.length === 0;

                                            return (
                                                <td
                                                    key={`${resource.id}-${cell.slot}`}
                                                    colSpan={colspan}
                                                    className="border-b border-ink-08 py-1 px-0.5"
                                                >
                                                    {hasMultipleClients ? (
                                                        <div
                                                            role="button"
                                                            tabIndex={0}
                                                            aria-label={`Моя бронь, клиентов: ${linkedSessions.length} — изменить`}
                                                            className="h-8 flex overflow-hidden cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                                                            onClick={() => setLinkBooking(booking)}
                                                            onKeyDown={activateOnKey}
                                                        >
                                                            {linkedSessions
                                                                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                                                                .map((sess, idx) => {
                                                                    const cl = clientById.get(sess.clientId);
                                                                    const totalDur = linkedSessions.reduce((s, x) => s + (x.durationMinutes || 60), 0);
                                                                    const pct = ((sess.durationMinutes || 60) / totalDur) * 100;
                                                                    const color = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
                                                                    return (
                                                                        <div
                                                                            key={sess.id}
                                                                            style={{ width: `${pct}%` }}
                                                                            className={clsx(
                                                                                'h-full border-y first:border-l last:border-r',
                                                                                'text-xs font-semibold flex items-center px-1 overflow-hidden select-none transition-colors',
                                                                                'text-on-ink',
                                                                                color,
                                                                                idx > 0 && 'border-l border-dashed border-l-on-ink/50'
                                                                            )}
                                                                            title={cl ? `${cl.name} · ${sess.durationMinutes || 60} мин` : `Слот ${idx + 1}`}
                                                                        >
                                                                            <span className="truncate">{cl?.name || `#${idx + 1}`}</span>
                                                                        </div>
                                                                    );
                                                                })}
                                                        </div>
                                                    ) : (() => {
                                                        // 2026-06-13 owner: чужой слот, выставленный на
                                                        // пересдачу — это НЕ глухое «занято», а claimable
                                                        // слот. Специалист может забрать его (backend
                                                        // авто-отменит пересдачу оригиналу с возвратом
                                                        // 50%). Раньше CRM-шахматка показывала его как
                                                        // обычный серый «Занято» с подпиской на слежение —
                                                        // совпадало с админом только частично. Теперь паритет.
                                                        const claimable = !isMine && booking.isReRentListed;
                                                        return (
                                                        <div
                                                            // Клавиатура: Tab до брони, Enter/пробел — то же, что клик.
                                                            role="button"
                                                            tabIndex={0}
                                                            onKeyDown={activateOnKey}
                                                            // pointerdown → start drag-to-move; click → open link modal.
                                                            // The drag handler waits for pointer-move before
                                                            // committing to "move" so a plain tap still opens
                                                            // the modal (handled in handleDragUp branch).
                                                            onPointerDown={isMine ? (e) => {
                                                                if (e.pointerType === 'mouse' && e.button !== 0) return;
                                                                e.preventDefault();
                                                                handleBookingMoveDown(booking);
                                                            } : undefined}
                                                            onClick={isMine
                                                                ? (e) => {
                                                                    // Only treat as click if no drag happened
                                                                    if (dragModeRef.current === 'move' && moveHover) return;
                                                                    e.stopPropagation();
                                                                    setLinkBooking(booking);
                                                                }
                                                                : claimable
                                                                    ? (e) => {
                                                                        // Забрать слот с пересдачи → открыть
                                                                        // booking-модал на этот слот/кабинет/время.
                                                                        e.stopPropagation();
                                                                        if (booking.resourceId && booking.startTime) {
                                                                            setBookSlot({
                                                                                resId: booking.resourceId,
                                                                                time: booking.startTime,
                                                                                date: selectedDate,
                                                                                duration: booking.duration ?? 60,
                                                                            });
                                                                        }
                                                                    }
                                                                    : (e) => {
                                                                        // Foreign booking → offer slot-watch
                                                                        e.stopPropagation();
                                                                        openWaitlistFor(booking);
                                                                    }}
                                                            // Волна 3 (G5-16): свои — сплошная тёмная заливка,
                                                            // чужие — тонкая рамка без заливки, колокольчик
                                                            // «следить» — только при наведении или фокусе.
                                                            className={clsx(
                                                                'group h-8 border text-xs font-semibold flex items-center px-1.5 overflow-hidden select-none gap-1 transition-colors',
                                                                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                                                                isMine
                                                                    ? (noSession
                                                                        ? 'bg-ink/45 text-on-ink border-ink border-dashed cursor-grab active:cursor-grabbing hover:bg-ink/60'
                                                                        : 'bg-ink text-on-ink border-ink cursor-grab active:cursor-grabbing hover:bg-ink-80')
                                                                    : claimable
                                                                        ? 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] border-[var(--status-pending-fg)]/40 border-dashed cursor-pointer hover:bg-[var(--status-pending-bg)]/70'
                                                                        : 'bg-transparent text-ink-60 border-ink-20 font-medium cursor-pointer hover:border-ink-40 hover:text-ink',
                                                                reschedSaving && 'opacity-60 pointer-events-none'
                                                            )}
                                                            title={isMine
                                                                ? `${linkedClient ? linkedClient.name : 'Слот'} — потяните на свободное время, чтобы перенести; нажмите, чтобы изменить клиента`
                                                                : claimable
                                                                    ? 'Слот на пересдаче — нажмите, чтобы забрать'
                                                                    : 'Нажмите, чтобы следить за слотом — уведомим, когда освободится'}
                                                        >
                                                            {/* Серийная бронь — значок Repeat (раньше эмодзи-звёздочка).
                                                                Виден и владельцу, и админу/наблюдателю. */}
                                                            {booking.recurringGroupId && (
                                                                <span className="shrink-0 inline-flex" title="Постоянная бронь (серия)">
                                                                    <Repeat size={12} aria-label="Постоянная бронь (серия)" />
                                                                </span>
                                                            )}
                                                            <span className="truncate flex-1">
                                                                {isMine
                                                                    ? (linkedClient ? linkedClient.name : 'Без клиента') + (noSession ? ' · нет сессии' : '')
                                                                    : claimable
                                                                        ? 'На пересдаче'
                                                                        : 'Занято'}
                                                            </span>
                                                            {claimable && <ArrowLeftRight size={12} className="shrink-0" aria-hidden="true" />}
                                                            {!isMine && !claimable && (
                                                                <Bell
                                                                    size={12}
                                                                    className="shrink-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                            {isMine && (
                                                                <UserPlus
                                                                    size={12}
                                                                    aria-hidden="true"
                                                                    className={clsx(
                                                                        'shrink-0 transition-opacity',
                                                                        linkedClient ? 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100' : 'opacity-70 group-hover:opacity-100'
                                                                    )}
                                                                />
                                                            )}
                                                        </div>
                                                        );
                                                    })()}
                                                </td>
                                            );
                                        }

                                        // Free cell
                                        const { slot, past } = cell;
                                        const isSelected = isNewSlotSelected(resource.id, slot);

                                        return (
                                            <td
                                                key={`${resource.id}-${slot}`}
                                                data-crm-resid={resource.id}
                                                data-crm-time={slot}
                                                onPointerDown={e => {
                                                    if (past) return;
                                                    e.preventDefault();
                                                    handleDragDown(resource.id, slot);
                                                }}
                                                onPointerEnter={() => {
                                                    if (!past) handleDragEnter(resource.id, slot);
                                                }}
                                                className={clsx(
                                                    'border-b border-r border-ink-08 py-1 px-0.5 transition-colors',
                                                    past
                                                        ? 'bg-sunken cursor-not-allowed'
                                                        : isSelected
                                                            ? 'bg-accent-soft cursor-pointer'
                                                            : (dragModeRef.current === 'move' && moveHover?.resId === resource.id && moveHover?.time === slot)
                                                                ? 'bg-accent-soft ring-2 ring-accent cursor-copy'
                                                                : isPeakTime(slot)
                                                                    ? 'bg-[var(--status-pending-bg)]/40 hover:bg-[var(--status-pending-bg)]/70 cursor-pointer'
                                                                    : 'hover:bg-accent-soft cursor-pointer'
                                                )}
                                                style={{ width: SLOT_W, minWidth: SLOT_W, height: 40 }}
                                            >
                                                {isSelected && (
                                                    <div className="h-full w-full bg-accent/30" />
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </ChessboardScroller>

            {/* Легенда (волна 3, G5-16): объясняет КАЖДЫЙ вид клетки на сетке,
                теми же стилями, что и сами клетки. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-small text-ink-60" aria-label="Обозначения">
                <span>Чтобы забронировать, выделите мышью свободное время в строке кабинета.</span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 bg-ink border border-ink inline-block" aria-hidden="true" />
                    Мои брони
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 border border-ink-20 inline-block" aria-hidden="true" />
                    Чужие — нажмите, чтобы следить
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 bg-[var(--status-pending-bg)] border border-dashed border-[var(--status-pending-fg)]/40 inline-block" aria-hidden="true" />
                    На пересдаче — можно забрать
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 bg-[var(--status-pending-bg)]/40 inline-block" aria-hidden="true" />
                    Пиковые часы
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 bg-accent/30 inline-block" aria-hidden="true" />
                    Выбрано
                </span>
                <span className="flex items-center gap-1.5">
                    <span className="w-4 h-3 bg-sunken inline-block" aria-hidden="true" />
                    Прошло
                </span>
            </div>

            {/* New booking modal (drag-to-select) */}
            {bookSlot && (
                <CrmQuickBookModal
                    key={`${bookSlot.resId}|${bookSlot.time}|${bookSlot.duration}`} // новый период — новое окно: иначе 2-й и далее брались с длительностью 1-го
                    slot={bookSlot}
                    crmClients={clients.filter(c => c.isActive)}
                    presetClientId={ghostLinkRef.current?.clientId}
                    onClose={() => {
                        // Cancel mid-queue → drop remaining chunks; keep
                        // the chips so the user can retry without
                        // re-selecting from scratch.
                        setBookSlot(null);
                        setPendingChunks([]);
                    }}
                    onBooked={handleBooked}
                />
            )}

            {/* Link client to existing booking modal */}
            {ghostSheet}
                {linkBooking && (
                <LinkBookingModal
                    booking={linkBooking}
                    crmClients={clients.filter(c => c.isActive)}
                    existingSessions={sessionsByBookingId.get(linkBooking.id) || []}
                    onClose={() => setLinkBooking(null)}
                    onSaveMulti={(assignments, recOpts) => handleMultiSlotSave(linkBooking, assignments, recOpts)}
                    onDeleteBooking={handleDeleteBooking}
                    onTrim={(b) => { setLinkBooking(null); setTrimTarget(b); }}
                    onSplit={(b) => { setLinkBooking(null); setSplitTarget(b); }}
                />
            )}

            <SplitBookingModal
                bookingId={splitTarget?.id ?? null}
                minutes={splitTarget?.duration ?? 0}
                startTime={splitTarget?.startTime ?? undefined}
                onClose={() => setSplitTarget(null)}
                onDone={() => { fetchBookings(); fetchSessions(); }}
            />

            {trimTarget && (
                <TrimBookingModal
                    booking={{
                        id: trimTarget.id,
                        startTime: trimTarget.startTime!,
                        duration: trimTarget.duration,
                        date: trimTarget.date as any,
                    }}
                    onClose={() => setTrimTarget(null)}
                    onDone={async () => {
                        await fetchBookings();
                        await fetchSessions();
                    }}
                />
            )}

            {seriesCancelTarget && seriesCancelTarget.recurringGroupId && (
                <CancelBookingChoiceModal
                    bookingId={seriesCancelTarget.id}
                    groupId={seriesCancelTarget.recurringGroupId}
                    onClose={() => setSeriesCancelTarget(null)}
                    onCompleted={async () => {
                        setSeriesCancelTarget(null);
                        await fetchBookings();
                        await fetchSessions();
                    }}
                />
            )}

            {seriesMoveTarget && (
                <RescheduleScopeChoiceModal
                    // Позже суток серию целиком переносит только администратор.
                    allowSeries={ADMIN_ROLES.includes(currentUser?.role || '')
                        || clientCanModifyBooking(seriesMoveTarget.booking)}
                    bookingId={seriesMoveTarget.booking.id}
                    newDate={seriesMoveTarget.newDate}
                    newStartTime={seriesMoveTarget.newStartTime}
                    newResourceId={seriesMoveTarget.newResourceId}
                    onClose={() => setSeriesMoveTarget(null)}
                    onCompleted={async () => {
                        setSeriesMoveTarget(null);
                        await fetchBookings();
                        await fetchSessions();
                    }}
                />
            )}

            {/* Slot-watch (waitlist) — shared modal opened from any
                "Занято" tap in this chessboard, desktop and mobile. */}
            <WaitlistSubscribeModal
                isOpen={!!waitlistTarget}
                onClose={() => setWaitlistTarget(null)}
                resourceId={waitlistTarget?.resourceId ?? ''}
                resourceName={waitlistTarget?.resourceName ?? ''}
                locationName={waitlistTarget?.locationName}
                date={waitlistTarget?.date ?? new Date()}
                startTime={waitlistTarget?.startTime ?? ''}
                endTime={waitlistTarget?.endTime ?? ''}
                extraNote="Уведомим, как только в этом филиале освободится любой кабинет в это же время."
            />
        </div>
    );
}
