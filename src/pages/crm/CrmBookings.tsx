import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useCrmStore } from '../../store/crmStore';
import { type CrmClient } from '../../api/crm';
import { RESOURCES } from '../../utils/data';
import { isAfter, isBefore } from 'date-fns';
import type { BookingHistoryItem } from '../../store/types';
import { X, Repeat, AlertTriangle } from 'lucide-react';
import { bookingsApi } from '../../api/bookings';
import { toast } from 'sonner';
import { CrmChessboardView, PickList, PickRow } from '../../components/crm/CrmChessboardView';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { CURRENCIES } from '../../utils/currency';
import { formatMoney, formatGel, formatDayMonth } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, TextArea } from '../../components/ui/Field';
import { Chip, Segmented } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { apiErrorMessage, toastApiError } from '../../utils/errors';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';

/** «GEL» → «₾» в подписях полей («Стоимость, ₾»). */
const currencySign = (code?: string) => CURRENCIES.find(c => c.code === (code || 'GEL'))?.symbol ?? code ?? '₾';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

/** «1 бронь / 2 брони / 5 броней». */
function bookingsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'бронь';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'брони';
    return 'броней';
}

/** Скелетон строк таблицы Grid House — пока грузим, не пишем «пусто». */
function GHSkeletonRows({ label }: { label: string }) {
    return (
        <div role="status" aria-busy="true" style={{ padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <span className="sr-only">{label}…</span>
            {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={20} radius={0} />)}
        </div>
    );
}

// 2026-06-05 owner: getSafeBookingDate вынесена в utils/bookingHelpers
// (Фаза 1 — см. docs/REFACTOR-BOOKINGS-UNIFICATION.md). Свой форматтер
// раньше принимал Date | null, общий принимает str | Date | null —
// сигнатура шире, рендеринг тот же.
import { getSafeBookingDate } from '../../utils/bookingHelpers';

// Wave 1: даты в этом файле — через utils/format (formatDayMonth), статусы
// брони — через общий StatusBadge (src/design/statuses.ts).


// ─── Фильтры ─────────────────────────────────────────────────────────────────
type FilterType = 'all' | 'linked' | 'unlinked' | 'upcoming' | 'past';

// ─── Модал привязки сессии ────────────────────────────────────────────────────
interface SlotEntry {
    clientId: string;
    duration: number;
    price: string;
    notes: string;
}

interface LinkSessionModalProps {
    booking: BookingHistoryItem;
    clients: CrmClient[];
    existingSessionClientId?: string;
    onClose: () => void;
    onConfirm: (clientId: string, price: number, notes: string, duration?: number) => Promise<void>;
    /** Отвязать клиента: удалить привязанную сессию, бронь остаётся. */
    onUnlink?: () => Promise<void>;
}

function LinkSessionModal({ booking, clients, existingSessionClientId, onClose, onConfirm, onUnlink }: LinkSessionModalProps) {
    const totalDuration = booking.duration || 60;
    const [slots, setSlots] = useState<SlotEntry[]>([
        { clientId: existingSessionClientId || '', duration: totalDuration, price: '', notes: '' }
    ]);
    const [activeSlot, setActiveSlot] = useState(0);
    // 02.09 (владелец): режим разбивки больше не включается переключателем —
    // он «включён», как только слотов стало больше одного (пресетом или «+ Слот»).
    const splitMode = slots.length > 1;
    const [search, setSearch] = useState('');
    const [saving, setSaving] = useState(false);
    const { confirm } = useConfirmDialog();

    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateStr: bookingDate, dateObj: bookingDateObj } = getSafeBookingDate(booking);

    const filteredClients = useMemo(() =>
        clients.filter(c =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone || '').includes(search) ||
            (c.aliasCode || '').toLowerCase().includes(search.toLowerCase())
        ),
        [clients, search]
    );

    const currentSlot = slots[activeSlot];
    const selectedClient = clients.find(c => c.id === currentSlot?.clientId);
    const usedMinutes = slots.reduce((s, sl) => s + sl.duration, 0);
    const remainingMinutes = totalDuration - usedMinutes;

    // Pre-fill price from selected client
    useEffect(() => {
        if (selectedClient && !currentSlot?.price) {
            updateSlot(activeSlot, { price: String(selectedClient.basePrice || '') });
        }
    }, [currentSlot?.clientId]);

    const updateSlot = (idx: number, patch: Partial<SlotEntry>) => {
        setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
    };

    /** Пересобрать слоты по пресету: первый кусок наследует уже выбранного
     *  клиента/цену/заметку, остальные — пустые. */
    const applyPreset = (parts: number[]) => {
        const first = slots[0];
        setSlots(parts.map((d, i) => i === 0
            ? { ...first, duration: d }
            : { clientId: '', duration: d, price: '', notes: '' }));
        setActiveSlot(0);
        setSearch('');
    };

    const addSlot = () => {
        if (remainingMinutes <= 0) {
            toast.error('Всё время брони уже распределено');
            return;
        }
        setSlots(prev => [...prev, { clientId: '', duration: remainingMinutes, price: '', notes: '' }]);
        setActiveSlot(slots.length);
        setSearch('');
    };

    const removeSlot = (idx: number) => {
        if (slots.length <= 1) return;
        const removed = slots[idx];
        const newSlots = slots.filter((_, i) => i !== idx);
        // Give removed time to last slot
        if (newSlots.length > 0) {
            newSlots[newSlots.length - 1].duration += removed.duration;
        }
        setSlots(newSlots);
        setActiveSlot(Math.min(activeSlot, newSlots.length - 1));
    };

    const handleSubmit = async () => {
        for (const sl of slots) {
            if (!sl.clientId) { toast.error('Выберите клиента для каждой части брони'); return; }
            if (sl.duration <= 0) { toast.error('Длительность должна быть > 0'); return; }
        }
        setSaving(true);
        try {
            for (const sl of slots) {
                await onConfirm(sl.clientId, Number(sl.price) || 0, sl.notes, sl.duration);
            }
            onClose();
        } catch (e) {
            toastApiError(e, 'Не удалось сохранить сессии — попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    // Calculate start times for each slot
    const slotStartTimes = useMemo(() => {
        const base = booking.startTime || '00:00';
        const [bh, bm] = base.split(':').map(Number);
        let offset = 0;
        return slots.map(sl => {
            const totalMin = bh * 60 + bm + offset;
            offset += sl.duration;
            const h = Math.floor(totalMin / 60);
            const m = totalMin % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        });
    }, [slots, booking.startTime]);

    const submitLabel = existingSessionClientId
        ? 'Сохранить'
        : splitMode && slots.length > 1 ? `Создать ${slots.length} ${sessionsWord(slots.length)}` : 'Создать сессию';

    // Волна 3 (X4-04): общая шторка Sheet вместо самодельного оверлея —
    // Esc, фокус внутри, подвал с кнопкой всегда виден. Создание/изменение
    // сессий (onConfirm по слотам), цена, отвязка — прежние; поменялась обёртка.
    return (
        <Sheet
            open
            onClose={onClose}
            dismissible={!saving}
            title={existingSessionClientId ? 'Изменить клиента сессии' : 'Создать сессию из брони'}
            description={`${resource?.name || 'Кабинет'} · ${bookingDateObj ? formatDayMonth(bookingDateObj, { withYear: 'auto' }) : bookingDate} ${booking.startTime || ''}${booking.duration ? ` · ${booking.duration} мин` : ''}`}
            width={520}
            footer={
                <>
                    <Button
                        variant="primary"
                        loading={saving}
                        disabled={slots.some(s => !s.clientId) || (splitMode && remainingMinutes < 0)}
                        onClick={handleSubmit}
                    >
                        {submitLabel}
                    </Button>
                    <Button variant="secondary" disabled={saving} onClick={onClose}>Отмена</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Пресеты разбивки (02.09, владелец): без переключателя —
                    одна кнопка сразу отделяет кусок нужной длины, «По часу»
                    режет всю бронь на равные часовые слоты. */}
                {!existingSessionClientId && totalDuration > 60 && (
                    <div>
                        <div style={SHEET_LABEL}>Разбить бронь ({String(totalDuration / 60).replace('.', ',')} ч)</div>
                        <div className="ui-chip-row" role="group" aria-label="Разбить бронь">
                            {[60, 90, 120].filter(d => d < totalDuration).map(d => (
                                <Chip key={d} onClick={() => applyPreset([d, totalDuration - d])}>
                                    Отделить {d === 90 ? '1,5 ч' : `${d / 60} ч`}
                                </Chip>
                            ))}
                            {totalDuration >= 120 && totalDuration % 60 === 0 && (
                                <Chip onClick={() => applyPreset(Array(totalDuration / 60).fill(60))}>
                                    По часу × {totalDuration / 60}
                                </Chip>
                            )}
                            {slots.length > 1 && (
                                <Chip
                                    onClick={() => {
                                        setSlots([{ ...slots[0], duration: totalDuration }]);
                                        setActiveSlot(0);
                                    }}
                                >
                                    Не разбивать
                                </Chip>
                            )}
                        </div>
                    </div>
                )}

                {/* Части брони (если разбита) */}
                {splitMode && slots.length > 0 && (
                    <div className="ui-chip-row" role="group" aria-label="Части брони">
                        {slots.map((sl, idx) => {
                            const c = clients.find(cc => cc.id === sl.clientId);
                            return (
                                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                                    <Chip
                                        selected={activeSlot === idx}
                                        onClick={() => { setActiveSlot(idx); setSearch(''); }}
                                    >
                                        <span className="num">{slotStartTimes[idx]}</span>
                                        <span style={{ fontWeight: 400 }}>· {sl.duration} мин</span>
                                        {c && <span style={{ fontWeight: 400, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>· {c.name}</span>}
                                    </Chip>
                                    {slots.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={() => removeSlot(idx)}
                                            aria-label={`Убрать часть ${slotStartTimes[idx]}`}
                                            title="Убрать эту часть"
                                            style={{
                                                width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                background: 'none', border: 0, cursor: 'pointer', color: 'var(--status-danger-fg)',
                                            }}
                                        >
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    )}
                                </span>
                            );
                        })}
                        {remainingMinutes > 0 && (
                            <Chip onClick={addSlot}>+ Часть</Chip>
                        )}
                    </div>
                )}

                {/* Редактор выбранной части */}
                {currentSlot && (
                    <>
                        <div>
                            <Field label={splitMode ? `Клиент (часть ${activeSlot + 1})` : 'Клиент'} required>
                                <Input
                                    kind="search"
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    placeholder="Имя, телефон или код"
                                />
                            </Field>
                            <PickList label="Клиенты">
                                {filteredClients.length === 0 ? (
                                    <div style={{ fontSize: 'var(--text-small)', color: 'var(--color-ink-60)', padding: '12px' }}>
                                        Никого не нашли — проверьте имя или код
                                    </div>
                                ) : filteredClients.map(client => (
                                    <PickRow
                                        key={client.id}
                                        selected={currentSlot.clientId === client.id}
                                        onClick={() => updateSlot(activeSlot, { clientId: client.id })}
                                        meta={client.aliasCode ? `#${client.aliasCode}` : undefined}
                                    >
                                        {client.name}
                                    </PickRow>
                                ))}
                            </PickList>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
                            <Field label="Стоимость сессии">
                                {/* type="number" — как раньше: та же разборка суммы. */}
                                <Input
                                    kind="money"
                                    type="number"
                                    value={currentSlot.price}
                                    onChange={e => updateSlot(activeSlot, { price: e.target.value })}
                                    placeholder={selectedClient ? String(selectedClient.basePrice) : '0'}
                                    suffix={currencySign(selectedClient?.currency)}
                                />
                            </Field>
                            <Field label="Длительность" hint={splitMode ? undefined : 'Вся бронь'}>
                                <Input
                                    kind="integer"
                                    type="number"
                                    value={currentSlot.duration}
                                    onChange={e => {
                                        const v = Math.max(15, Math.min(Number(e.target.value) || 15, totalDuration));
                                        updateSlot(activeSlot, { duration: v });
                                    }}
                                    disabled={!splitMode}
                                    suffix="мин"
                                />
                            </Field>
                        </div>

                        <Field label="Заметка к сессии" optional hint="Попадёт в «Заметки» клиента">
                            <TextArea
                                value={currentSlot.notes}
                                onChange={e => updateSlot(activeSlot, { notes: e.target.value })}
                                placeholder="Тема сессии, подготовка…"
                                rows={2}
                            />
                        </Field>
                    </>
                )}

                {/* Итог по частям */}
                {splitMode && slots.length > 1 && (
                    <div style={{ background: 'var(--color-sunken)', padding: 12, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 'var(--text-small)' }}>
                        <div style={{ fontWeight: 500 }}>Частей: {slots.length}</div>
                        {slots.map((sl, idx) => {
                            const c = clients.find(cc => cc.id === sl.clientId);
                            return (
                                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, color: 'var(--color-ink-80)' }}>
                                    <span><span className="num">{slotStartTimes[idx]}</span> — {c?.name || 'клиент не выбран'}</span>
                                    <span className="num">{sl.duration} мин · {formatMoney(Number(sl.price) || 0, { currency: c?.currency })}</span>
                                </div>
                            );
                        })}
                        {remainingMinutes !== 0 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, color: remainingMinutes > 0 ? 'var(--status-pending-fg)' : 'var(--status-danger-fg)' }}>
                                <AlertTriangle size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
                                {remainingMinutes > 0 ? `Не распределено: ${remainingMinutes} мин` : `Превышение: ${Math.abs(remainingMinutes)} мин`}
                            </div>
                        )}
                    </div>
                )}

                {/* Отвязка клиента (02.09, владелец): сессия удаляется,
                    бронь остаётся свободной для привязки другого клиента. */}
                {existingSessionClientId && onUnlink && (
                    <Button
                        variant="secondary"
                        onClick={async () => {
                            const ok = await confirm({
                                title: 'Отвязать клиента от брони?',
                                body: 'Сессия удалится, а бронь кабинета останется — к ней можно будет привязать другого клиента.',
                                confirmLabel: 'Отвязать клиента',
                                cancelLabel: 'Оставить',
                                tone: 'danger',
                            });
                            if (!ok) return;
                            await onUnlink();
                        }}
                        style={{ color: 'var(--status-danger-fg)', alignSelf: 'flex-start' }}
                    >
                        Отвязать клиента от брони
                    </Button>
                )}
            </div>
        </Sheet>
    );
}

const SHEET_LABEL: React.CSSProperties = {
    fontSize: 'var(--text-small)', fontWeight: 500, color: 'var(--color-ink-60)', marginBottom: 8,
};

// BookingCard (карточка старого списка до Grid House) нигде не рендерилась —
// удалена в wave 1 вместе со своими синими/фиолетовыми цветами.

export function CrmBookings() {
        const { currentUser, bookings: allBookings } = useUserStore();
    const { clients, sessions, fetchClients, fetchSessions } = useCrmStore();

    // Default = chessboard (matching admin /admin/bookings convention).
    // Specialists work in shahmatka day-to-day; the list is secondary.
    const [viewMode, setViewMode] = useState<'list' | 'chess' | 'series'>('chess');
    const [filter, setFilter] = useState<FilterType>('upcoming');
    const [modalBooking, setModalBooking] = useState<BookingHistoryItem | null>(null);
    const [modalExistingSessionId, setModalExistingSessionId] = useState<string | undefined>();
    const [modalExistingClientId, setModalExistingClientId] = useState<string | undefined>();
    const [loadingClients, setLoadingClients] = useState(false);
    const [recurringGroups, setRecurringGroups] = useState<Awaited<ReturnType<typeof bookingsApi.getRecurringGroups>>>([]);
    const [loadingGroups, setLoadingGroups] = useState(false);
    const [cancellingGroupId, setCancellingGroupId] = useState<string | null>(null);
    const [confirmCancelGroupId, setConfirmCancelGroupId] = useState<string | null>(null);

    // Load clients and sessions on mount
    useEffect(() => {
        if (clients.length === 0) {
            setLoadingClients(true);
            fetchClients().finally(() => setLoadingClients(false));
        }
        fetchSessions();
    }, []);

    // Load recurring groups when series tab opens.
    // scope=mine forces backend to scope by current user even when the caller
    // is an admin — /crm/bookings is a per-specialist page, not a global view.
    const reloadGroups = useCallback(() => {
        setLoadingGroups(true);
        return bookingsApi.getRecurringGroups({ scope: 'mine' })
            .then(setRecurringGroups)
            .catch(() => {})
            .finally(() => setLoadingGroups(false));
    }, []);
    useEffect(() => {
        if (viewMode === 'series') reloadGroups();
    }, [viewMode, reloadGroups]);

    const handleCancelSeries = async (groupId: string) => {
        setCancellingGroupId(groupId);
        try {
            const res = await bookingsApi.cancelRecurringSeries(groupId);
            toast.success(`Серия отменена: ${res.cancelled} ${bookingsWord(res.cancelled)}`);
            setRecurringGroups(prev => prev.filter(g => g.recurringGroupId !== groupId));
        } catch (e: any) {
            toast.error(apiErrorMessage(e, 'Не удалось отменить серию — проверьте интернет и попробуйте ещё раз'));
        } finally {
            setCancellingGroupId(null);
            setConfirmCancelGroupId(null);
        }
    };

    // Filter bookings by specialist email
    const myBookings = useMemo(() =>
        allBookings.filter(b => b.userId === currentUser?.email),
        [allBookings, currentUser?.email]
    );

    // Build lookup: bookingId → LIVE sessions (array for multi-client splits).
    // Cancelled rows must be excluded — otherwise an old CANCELLED_CLIENT
    // session that was later replaced by an active one for the same client
    // gets counted twice → `hasMultiple = true` → the row renders the same
    // client name twice ("double name" bug Микола reported on /crm/bookings).
    const sessionsByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions>();
        sessions.forEach(s => {
            if (!s.bookingId) return;
            if (s.status === 'CANCELLED_CLIENT' || s.status === 'CANCELLED_THERAPIST') return;
            const arr = map.get(s.bookingId) || [];
            arr.push(s);
            map.set(s.bookingId, arr);
        });
        return map;
    }, [sessions]);

    // Compat: single session lookup
    const sessionByBookingId = useMemo(() => {
        const map = new Map<string, typeof sessions[0]>();
        sessionsByBookingId.forEach((arr, key) => { if (arr[0]) map.set(key, arr[0]); });
        return map;
    }, [sessionsByBookingId]);

    // Build lookup: clientId → client
    const clientById = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach(c => map.set(c.id, c));
        return map;
    }, [clients]);

    const now = new Date();

    // Apply filter
    const filteredBookings = useMemo(() => {
        return myBookings.filter(b => {
            const { dateObj } = getSafeBookingDate(b);
            const hasSession = sessionByBookingId.has(b.id);
            switch (filter) {
                case 'linked': return hasSession;
                case 'unlinked': return !hasSession && (b.status === 'confirmed' || b.status === 'completed');
                case 'upcoming': return dateObj ? isAfter(dateObj, now) && b.status === 'confirmed' : false;
                case 'past': return dateObj ? isBefore(dateObj, now) : false;
                default: return true;
            }
        }).sort((a, b) => {
            const { dateStr: da } = getSafeBookingDate(a);
            const { dateStr: db } = getSafeBookingDate(b);
            const ta = `${da}T${a.startTime || '00:00'}`;
            const tb = `${db}T${b.startTime || '00:00'}`;
            return filter === 'upcoming'
                ? ta.localeCompare(tb)
                : tb.localeCompare(ta);
        });
    }, [myBookings, filter, sessionByBookingId, now]);

    // Stats
    const stats = useMemo(() => ({
        total: myBookings.length,
        upcoming: myBookings.filter(b => {
            const { dateObj } = getSafeBookingDate(b);
            return dateObj ? isAfter(dateObj, now) && b.status === 'confirmed' : false;
        }).length,
        linked: myBookings.filter(b => sessionByBookingId.has(b.id)).length,
        unlinked: myBookings.filter(b => !sessionByBookingId.has(b.id) && (b.status === 'confirmed' || b.status === 'completed')).length,
    }), [myBookings, sessionByBookingId, now]);

    const handleOpenModal = (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => {
        slotOffsetRef.current = 0; // Reset offset for new modal
        setModalBooking(booking);
        setModalExistingSessionId(existingSessionId);
        setModalExistingClientId(existingClientId);
    };

    // Мост из личного кабинета (02.09): попап брони на «Моих бронированиях»
    // шлёт сюда ?link=<bookingId> — сразу открываем окно привязки/разбивки,
    // чтобы длинную бронь можно было разбить на сессии по клиентам, не ища
    // её заново в списке. Параметр гасим, чтобы окно не всплывало повторно.
    const [linkParams, setLinkParams] = useSearchParams();
    useEffect(() => {
        const linkId = linkParams.get('link');
        if (!linkId || myBookings.length === 0) return;
        const target = myBookings.find(b => b.id === linkId);
        setLinkParams({}, { replace: true });
        if (target) {
            handleOpenModal(target);
        } else {
            toast.error('Бронь не найдена в списке CRM — проверьте фильтр периода');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkParams, myBookings.length]);

    // Track cumulative offset for split slots
    const slotOffsetRef = useRef(0);

    // Отвязка клиента (02.09): удаляем привязанную сессию, бронь остаётся.
    const handleUnlinkSession = async () => {
        if (!modalExistingSessionId) return;
        try {
            await useCrmStore.getState().deleteSession(modalExistingSessionId);
            toast.success('Клиент отвязан — бронь снова без клиента');
            setModalBooking(null);
            setModalExistingSessionId(undefined);
            setModalExistingClientId(undefined);
            await fetchSessions();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось отвязать');
        }
    };

    const handleLinkSession = async (clientId: string, price: number, notes: string, slotDuration?: number) => {
        if (!modalBooking) return;

        const { dateStr: bookingDate } = getSafeBookingDate(modalBooking);
        const timeStr = modalBooking.startTime && /^\d{2}:\d{2}/.test(modalBooking.startTime)
            ? modalBooking.startTime
            : '00:00';

        // Calculate offset time for split slots
        const [bh, bm] = timeStr.split(':').map(Number);
        const totalMin = bh * 60 + bm + slotOffsetRef.current;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        const offsetTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        const sessionDate = `${bookingDate || new Date().toISOString().split('T')[0]}T${offsetTime}:00`;
        const dur = slotDuration || modalBooking.duration || 60;

        // 29.09: «Заметка к сессии» — обычная заметка (TherapistNote),
        // как в карточке клиента. Раньше текст уходил в поле session.notes,
        // которое не показывается ни во вкладке «Заметки», ни в истории клиента.
        const noteText = notes.trim();
        const addSessionNote = async (sessionId: string) => {
            if (!noteText) return;
            // Сессия уже сохранена — сбой заметки не должен выглядеть как
            // сбой привязки (иначе повтор создаст вторую сессию). Тост
            // «Не удалось создать заметку» покажет сам стор.
            try {
                await useCrmStore.getState().createNote({ clientId, sessionId, content: noteText });
            } catch { /* тост уже показан */ }
        };

        if (modalExistingSessionId) {
            // 02.09: раньше выбранный клиент здесь ИГНОРИРОВАЛСЯ — окно
            // называлось «Изменить клиента сессии», а клиента не меняло.
            await useCrmStore.getState().updateSession(modalExistingSessionId, {
                clientId,
                date: sessionDate,
                durationMinutes: dur,
                price: price || undefined,
            });
            await addSessionNote(modalExistingSessionId);
            toast.success('Сессия обновлена');
        } else {
            const created = await useCrmStore.getState().createSession({
                clientId,
                date: sessionDate,
                durationMinutes: dur,
                price: price || undefined,
                bookingId: modalBooking.id,
                isBooked: true,
            });
            // Accumulate offset for next slot in split mode
            slotOffsetRef.current += dur;
            await addSessionNote(created.id);
        }

        // Refresh sessions
        await fetchSessions();
    };

    const FILTERS: { key: FilterType; label: string; count?: number }[] = [
        { key: 'upcoming', label: 'Предстоящие', count: stats.upcoming },
        { key: 'unlinked', label: 'Без клиента', count: stats.unlinked },
        { key: 'linked', label: 'С клиентом', count: stats.linked },
        { key: 'past', label: 'Прошедшие' },
        { key: 'all', label: 'Все', count: stats.total },
    ];

    return (

        <GridHouseCrmBookings
            viewMode={viewMode} setViewMode={setViewMode}
            filter={filter} setFilter={setFilter}
            stats={stats} filteredBookings={filteredBookings}
            loadingClients={loadingClients} loadingGroups={loadingGroups}
            recurringGroups={recurringGroups}
            confirmCancelGroupId={confirmCancelGroupId} setConfirmCancelGroupId={setConfirmCancelGroupId}
            cancellingGroupId={cancellingGroupId} handleCancelSeries={handleCancelSeries}
            reloadGroups={reloadGroups}
            handleOpenModal={handleOpenModal}
            sessionsByBookingId={sessionsByBookingId} clientById={clientById}
            clients={clients}
            modalBooking={modalBooking} setModalBooking={setModalBooking}
            modalExistingClientId={modalExistingClientId}
            setModalExistingSessionId={setModalExistingSessionId}
            setModalExistingClientId={setModalExistingClientId}
            handleLinkSession={handleLinkSession}
            modalExistingSessionId={modalExistingSessionId}
            handleUnlinkSession={handleUnlinkSession}
        />
    );
}


// ─── Grid House: CrmBookings ─────────────────────────────────────────────────

interface GHCrmBookingsProps {
    viewMode: 'list' | 'chess' | 'series';
    setViewMode: (v: 'list' | 'chess' | 'series') => void;
    filter: FilterType;
    setFilter: (f: FilterType) => void;
    stats: { total: number; upcoming: number; linked: number; unlinked: number };
    filteredBookings: BookingHistoryItem[];
    loadingClients: boolean;
    loadingGroups: boolean;
    recurringGroups: any[];
    confirmCancelGroupId: string | null;
    setConfirmCancelGroupId: (id: string | null) => void;
    cancellingGroupId: string | null;
    handleCancelSeries: (groupId: string) => Promise<void>;
    reloadGroups: () => Promise<void> | void;
    handleOpenModal: (booking: BookingHistoryItem, existingSessionId?: string, existingClientId?: string) => void;
    sessionsByBookingId: Map<string, any[]>;
    clientById: Map<string, CrmClient>;
    clients: CrmClient[];
    modalBooking: BookingHistoryItem | null;
    setModalBooking: (b: BookingHistoryItem | null) => void;
    modalExistingClientId?: string;
    setModalExistingSessionId: (id: string | undefined) => void;
    setModalExistingClientId: (id: string | undefined) => void;
    handleLinkSession: (clientId: string, price: number, notes: string, slotDuration?: number) => Promise<void>;
    modalExistingSessionId?: string;
    handleUnlinkSession: () => Promise<void>;
}

const ghMono = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60 };
const ghHairline = `1px solid ${GH.ink10}`;

function GridHouseCrmBookings(props: GHCrmBookingsProps) {
    const {
        viewMode, setViewMode, filter, setFilter, stats, filteredBookings,
        loadingClients, loadingGroups, recurringGroups,
        confirmCancelGroupId, setConfirmCancelGroupId, cancellingGroupId, handleCancelSeries, reloadGroups,
        handleOpenModal, sessionsByBookingId, clientById, clients,
        modalBooking, setModalBooking, modalExistingClientId,
        setModalExistingSessionId, setModalExistingClientId, handleLinkSession,
        modalExistingSessionId, handleUnlinkSession,
    } = props;

    const VIEW_MODES: { key: typeof viewMode; label: string }[] = [
        { key: 'list', label: 'Список' },
        { key: 'chess', label: 'Шахматка' },
        { key: 'series', label: 'Серии' },
    ];

    const GH_FILTERS: { key: FilterType; label: string; count?: number }[] = [
        { key: 'upcoming', label: 'Предстоящие', count: stats.upcoming },
        { key: 'unlinked', label: 'Без клиента', count: stats.unlinked },
        { key: 'linked', label: 'С клиентом', count: stats.linked },
        { key: 'past', label: 'Прошедшие' },
        { key: 'all', label: 'Все', count: stats.total },
    ];

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Волна 3 (G5-22 / G5-16): общая шапка PageHeader. «+ Бронь» убрана:
                она лишь переключала на шахматку, где специалист уже стоит, а
                «ближайший свободный слот» пришлось бы угадывать — кабинет и
                время за специалиста выбирать нельзя (это деньги). Бронь
                создаётся в самой шахматке: выделить свободное время → окно брони. */}
            <PageHeader
                title="Бронирования"
                description={
                    <span className="num" style={{ fontSize: 'var(--text-small)' }}>
                        {stats.upcoming} впереди · {stats.linked} с клиентом
                        {stats.unlinked > 0 && <> · {stats.unlinked} без клиента</>}
                        {' '}· всего {stats.total}
                    </span>
                }
                actions={
                    <div style={{ width: 320, maxWidth: '100%' }}>
                        <Segmented
                            aria-label="Вид"
                            options={VIEW_MODES.map(v => ({ value: v.key, label: v.label }))}
                            value={viewMode}
                            onChange={setViewMode}
                        />
                    </div>
                }
            />

            {/* ── Content ── */}
            <div style={{ paddingBottom: 48 }}>
                {viewMode === 'chess' ? (
                    <CrmChessboardView />
                ) : viewMode === 'series' ? (
                    <GHSeriesView
                        loadingGroups={loadingGroups} recurringGroups={recurringGroups}
                        confirmCancelGroupId={confirmCancelGroupId} setConfirmCancelGroupId={setConfirmCancelGroupId}
                        cancellingGroupId={cancellingGroupId} handleCancelSeries={handleCancelSeries}
                        clientById={clientById} reloadGroups={reloadGroups}
                    />
                ) : (
                    <>
                        {/* Filter row */}
                        <div className="ui-chip-row" role="group" aria-label="Какие брони показать" style={{ marginBottom: 16 }}>
                            {GH_FILTERS.map(f => (
                                <Chip key={f.key} selected={filter === f.key} onClick={() => setFilter(f.key)}>
                                    {f.label}{f.count !== undefined ? <span className="num" style={{ fontWeight: 400 }}> {f.count}</span> : null}
                                </Chip>
                            ))}
                        </div>

                        {/* Table header — скрываем на узком экране (<700px),
                            где строка-карточка стоит в одну колонку и
                            табличный header теряет смысл. */}
                        {!loadingClients && filteredBookings.length > 0 && (
                            <div className="cb-table-header" style={{
                                display: 'grid', gridTemplateColumns: '110px 1fr 120px 100px',
                                gap: 8,
                                padding: '8px 0', borderBottom: ghHairline,
                            }}>
                                {['Дата', 'Клиент', 'Кабинет', 'Статус'].map(h => (
                                    <div key={h} style={{ ...ghMono, fontSize: 12 }}>{h}</div>
                                ))}
                            </div>
                        )}
                        <style>{`
                            @media (max-width: 700px) {
                                .cb-table-header { display: none !important; }
                            }
                        `}</style>

                        {/* Rows. Загрузка ≠ пусто (rule 8). */}
                        {loadingClients ? (
                            <GHSkeletonRows label="Загружаем брони" />
                        ) : filteredBookings.length === 0 ? (
                            <EmptyState
                                title={filter === 'upcoming' ? 'Предстоящих броней нет' :
                                    filter === 'unlinked' ? 'Все брони привязаны к клиентам' :
                                    filter === 'linked' ? 'Привязанных броней нет' :
                                    'Броней пока нет'}
                                hint={filter === 'unlinked' ? undefined : 'Забронируйте кабинет в шахматке.'}
                                action={filter === 'unlinked' ? undefined : { label: 'Открыть шахматку', onClick: () => setViewMode('chess') }}
                            />
                        ) : (
                            <div>
                                {filteredBookings.map((booking) => {
                                    const allLinked = sessionsByBookingId.get(booking.id) || [];
                                    const linkedSession = allLinked[0];
                                    const linkedClient = linkedSession ? clientById.get(linkedSession.clientId) : undefined;
                                    return (
                                        <GHBookingRow
                                            key={booking.id}
                                            booking={booking}
                                            linkedClient={linkedClient}
                                            linkedSessionId={linkedSession?.id}
                                            linkedSessions={allLinked}
                                            clientById={clientById}
                                            onLink={handleOpenModal}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Окно привязки сессии к брони (Sheet) */}
            {modalBooking && (
                <LinkSessionModal
                    booking={modalBooking}
                    clients={clients.filter(c => c.isActive)}
                    existingSessionClientId={modalExistingClientId}
                    onClose={() => {
                        setModalBooking(null);
                        setModalExistingSessionId(undefined);
                        setModalExistingClientId(undefined);
                    }}
                    onConfirm={handleLinkSession}
                    onUnlink={modalExistingSessionId ? handleUnlinkSession : undefined}
                />
            )}
        </div>
    );
}

// ─── GH: Строка бронирования ─────────────────────────────────────────────────

function GHBookingRow({ booking, linkedClient, linkedSessionId, linkedSessions, clientById, onLink }: {
    booking: BookingHistoryItem;
    linkedClient?: CrmClient; linkedSessionId?: string; linkedSessions?: any[];
    clientById: Map<string, CrmClient>;
    onLink: (b: BookingHistoryItem, sid?: string, cid?: string) => void;
}) {
    const resource = RESOURCES.find(r => r.id === booking.resourceId);
    const { dateObj } = getSafeBookingDate(booking);
    const isActive = booking.status === 'confirmed' || booking.status === 'completed';
    const hasMultiple = (linkedSessions?.length || 0) > 1;
    // Cabinets 7 & 8 have a group rate that differs from individual; for
    // others the toggle would be a no-op so we hide the button.
    // Cab 2 in One — мини-группы до 4 чел, добавлен по запросу админа.
    const groupCapable = ['unbox_uni_room_7', 'unbox_uni_room_8', 'unbox_one_room_2'].includes(booking.resourceId || '');
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const { confirm } = useConfirmDialog();

    // Причина снятия штрафа — поле в шторке вместо системного окна браузера.
    const [waiveOpen, setWaiveOpen] = useState(false);
    const [waiveReason, setWaiveReason] = useState('');
    const [waiveError, setWaiveError] = useState<string | undefined>();
    const [waiveBusy, setWaiveBusy] = useState(false);
    const openWaive = () => { setWaiveReason(''); setWaiveError(undefined); setWaiveOpen(true); };

    const handleWaive = async () => {
        const reason = waiveReason.trim();
        if (!reason) { setWaiveError('Напишите причину — без неё штраф не снять'); return; }
        setWaiveBusy(true);
        try {
            const res = await bookingsApi.waiveCharge(booking.id, reason);
            toast.success(
                res.scenario === 'waived_paid_refunded'
                    ? 'Штраф снят, средства возвращены'
                    : 'Штраф снят (списание не произойдёт)'
            );
            setWaiveOpen(false);
            await fetchBookings?.();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось снять штраф');
        } finally {
            setWaiveBusy(false);
        }
    };

    const handleChangeFormat = async () => {
        const target: 'individual' | 'group' = (booking.format === 'group') ? 'individual' : 'group';
        const targetLabel = target === 'group' ? 'Групповой' : 'Индивидуальный';
        const ok = await confirm({
            title: `Сменить формат на «${targetLabel}»?`,
            body: 'Цена брони пересчитается.',
            confirmLabel: `Сменить на «${targetLabel}»`,
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        try {
            await bookingsApi.changeFormat(booking.id, target);
            toast.success(`Формат изменён на «${targetLabel}»`);
            await fetchBookings?.();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось сменить формат');
        }
    };

    return (
        // Раньше grid `40px 110px 1fr 130px 100px 130px` (510px фиксированных
        // колонок + gaps) — на узком мобильном это не помещалось, имя клиента
        // съедалось до нуля, а статус и actions уезжали за правый край.
        // Теперь flex с wrap: дата+время и клиент остаются вверху строки,
        // кабинет/статус/действия переносятся в новую строку на мобильном.
        <div
            style={{
                display: 'flex', alignItems: 'center', flexWrap: 'wrap',
                padding: '14px 0', borderBottom: ghHairline,
                // Неактивные — приглушаем цветом, не прозрачностью (текст ≥ ink-60).
                color: isActive ? undefined : GH.ink60, transition: 'background 120ms',
                gap: '8px 14px',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            {/* Дата + время */}
            <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {booking.recurringGroupId && (
                        <span style={{ display: 'inline-flex' }} title="Постоянная бронь (серия)">
                            <Repeat size={12} aria-label="Постоянная бронь (серия)" />
                        </span>
                    )}
                    {dateObj ? formatDayMonth(dateObj) : '—'}
                </div>
                <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {booking.startTime || '—'}{booking.duration ? ` · ${booking.duration} мин` : ''}
                </div>
            </div>

            {/* Клиент */}
            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                {hasMultiple ? (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {linkedSessions!.map((sess, idx) => {
                            const cl = clientById.get(sess.clientId);
                            return (
                                <span key={sess.id} style={{ fontSize: 13, fontWeight: 500 }}>
                                    {cl?.name || '—'}{idx < linkedSessions!.length - 1 ? ' \u00b7' : ''}
                                </span>
                            );
                        })}
                        {isActive && (
                            <button onClick={() => onLink(booking, linkedSessionId, linkedClient?.id)}
                                style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                Изменить
                            </button>
                        )}
                    </div>
                ) : linkedClient ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>{linkedClient.name}</span>
                        {linkedClient.aliasCode && (
                            <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>{linkedClient.aliasCode}</span>
                        )}
                        {isActive && (
                            <button onClick={() => onLink(booking, linkedSessionId, linkedClient.id)}
                                style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                                Изменить
                            </button>
                        )}
                    </div>
                ) : isActive ? (
                    <button onClick={() => onLink(booking)}
                        style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.accent, background: 'none', border: `1px solid ${GH.accent}`, padding: '4px 12px', cursor: 'pointer' }}>
                        + Привязать
                    </button>
                ) : (
                    <span style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, color: GH.ink60 }}>Неактивна</span>
                )}
            </div>

            {/* Кабинет */}
            <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {resource?.name || booking.resourceId}
            </div>

            {/* Статус брони и оплаты — слова и цвета из общего словаря (statuses.ts). */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <StatusBadge kind="booking" status={booking.status} audience="staff" variant="dot" />
                {booking.paymentStatus && (
                    <span title={booking.paymentStatus === 'waived' && booking.waiverReason ? booking.waiverReason : undefined}>
                        <StatusBadge
                            kind="payment"
                            status={booking.paymentStatus === 'pending' || booking.paymentStatus === 'waived' ? booking.paymentStatus : 'paid'}
                            audience="staff"
                            variant="dot"
                        />
                    </span>
                )}
            </div>

            {/* Действия — waive + format change. Скрываем для прошедших/отменённых */}
            <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {isActive && (booking.paymentStatus === 'pending' || booking.paymentStatus === 'paid') && (
                    <button onClick={openWaive}
                        title="Снять штраф (с причиной)"
                        style={{
                            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                            padding: '4px 8px', background: 'transparent', border: ghHairline, color: GH.ink60, cursor: 'pointer',
                        }}>
                        Снять штраф
                    </button>
                )}
                {isActive && groupCapable && (
                    <button onClick={handleChangeFormat}
                        title="Сменить формат (индивидуальный / групповой)"
                        style={{
                            fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                            padding: '4px 8px', background: 'transparent', border: ghHairline, color: GH.ink60, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                        }}>
                        {/* Без значка: Repeat во всей CRM значит «серия», а здесь смена формата. */}
                        {booking.format === 'group' ? 'В индивидуальный' : 'В групповой'}
                    </button>
                )}
            </div>

            <Sheet
                open={waiveOpen}
                onClose={() => { if (!waiveBusy) setWaiveOpen(false); }}
                dismissible={!waiveBusy}
                title="Снять штраф"
                description={`${resource?.name || 'Кабинет'} · ${dateObj ? formatDayMonth(dateObj) : '—'}${booking.startTime ? `, ${booking.startTime}` : ''}`}
                width={440}
                footer={
                    <>
                        <Button variant="primary" block loading={waiveBusy} onClick={handleWaive}>Снять штраф</Button>
                        <Button variant="secondary" block disabled={waiveBusy} onClick={() => setWaiveOpen(false)}>Оставить</Button>
                    </>
                }
            >
                <Field label="Причина" required error={waiveError}>
                    <TextArea
                        rows={3}
                        value={waiveReason}
                        onChange={e => { setWaiveReason(e.target.value); if (waiveError) setWaiveError(undefined); }}
                    />
                </Field>
            </Sheet>
        </div>
    );
}

// ─── GH: Вид серий ───────────────────────────────────────────────────────────

function GHSeriesView({ loadingGroups, recurringGroups, confirmCancelGroupId, setConfirmCancelGroupId, cancellingGroupId, handleCancelSeries, clientById, reloadGroups }: {
    loadingGroups: boolean; recurringGroups: any[];
    confirmCancelGroupId: string | null; setConfirmCancelGroupId: (id: string | null) => void;
    cancellingGroupId: string | null; handleCancelSeries: (groupId: string) => Promise<void>;
    clientById: Map<string, CrmClient>;
    reloadGroups: () => Promise<void> | void;
}) {
    // Продление серии (Q2 owner): периодичность + по числу / до даты.
    const [extendFor, setExtendFor] = useState<string | null>(null);
    const [exPattern, setExPattern] = useState<'weekly' | 'biweekly' | 'monthly'>('weekly');
    const [exMode, setExMode] = useState<'count' | 'until'>('count');
    const [exCount, setExCount] = useState(4);
    const [exUntil, setExUntil] = useState('');
    const [exBusy, setExBusy] = useState(false);
    const { confirm } = useConfirmDialog();
    // Отмена серии — общее окно подтверждения с числом броней вместо «Да / Нет» в строке.
    const askCancelSeries = async (g: any, resourceName: string) => {
        setConfirmCancelGroupId(g.recurringGroupId);
        const n = Number(g.futureCount) || 0;
        const ok = await confirm({
            title: 'Отменить серию?',
            body: `${resourceName} · ${g.startTime}. Отменим будущие брони серии: ${n}.`,
            confirmLabel: n > 0 ? `Отменить ${n} ${bookingsWord(n)}` : 'Отменить серию',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) { setConfirmCancelGroupId(null); return; }
        await handleCancelSeries(g.recurringGroupId);
    };
    const submitExtend = async () => {
        if (!extendFor) return;
        if (exMode === 'until' && !exUntil) { toast.error('Укажите дату «до»'); return; }
        setExBusy(true);
        try {
            const r = await bookingsApi.extendRecurringSeries(extendFor,
                exMode === 'until' ? { untilDate: exUntil, pattern: exPattern } : { addOccurrences: exCount, pattern: exPattern });
            toast.success(`Добавлено ${r.created} ${bookingsWord(r.created)}${r.totalCost ? ` (${formatGel(r.totalCost, { sign: true, fraction: 0 })})` : ''}`);
            setExtendFor(null);
            await reloadGroups();
        } catch (e: any) {
            const d = e?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : (d?.message || 'Не удалось продлить серию'));
        } finally { setExBusy(false); }
    };

    if (loadingGroups) {
        return <GHSkeletonRows label="Загружаем серии" />;
    }
    if (recurringGroups.length === 0) {
        return (
            <EmptyState
                title="Серий пока нет"
                hint="Постоянную бронь можно создать в шахматке: выберите время и включите повторение."
            />
        );
    }
    return (
        <div style={{ marginTop: 24 }}>
            {/* Table header — Клиент column shows who the series was booked
                for (looked up via crmClientId). Without it the user couldn't
                tell which series belongs to which client at a glance. */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 130px 70px 70px 90px 110px 160px',
                padding: '8px 0', borderBottom: ghHairline,
            }}>
                {['Кабинет', 'Клиент', 'Повтор', 'Осталось', 'Всего', 'Следующая', 'Последняя', ''].map(h => (
                    <div key={h || 'empty'} style={{ ...ghMono, fontSize: 12 }}>{h}</div>
                ))}
            </div>
            {recurringGroups.map(g => {
                const resource = RESOURCES.find((r: any) => r.id === g.resourceId);
                const patternLabel = g.pattern === 'monthly' ? 'Раз в 4 недели' : g.pattern === 'biweekly' ? 'Раз в 2 недели' : 'Каждую неделю';
                const isConfirming = confirmCancelGroupId === g.recurringGroupId;
                const isCancelling = cancellingGroupId === g.recurringGroupId;
                return (
                    <div key={g.recurringGroupId}
                        style={{
                            display: 'grid', gridTemplateColumns: '1fr 1fr 130px 70px 70px 90px 110px 160px',
                            alignItems: 'center', padding: '14px 0', borderBottom: ghHairline, transition: 'background 120ms',
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = GH.ink5)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                        <div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{resource?.name || g.resourceId}</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 2 }}>
                                {g.startTime} · {g.duration} мин
                            </div>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {g.crmClientId
                                ? (clientById.get(g.crmClientId)?.name || <span style={{ color: GH.ink60 }}>—</span>)
                                : <span style={{ color: GH.ink60, fontStyle: 'italic' }}>без клиента</span>}
                        </div>
                        <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{patternLabel}</div>
                        <div style={{ fontSize: 18, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{g.futureCount}</div>
                        <div style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>{g.totalCount}</div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {g.nextDate ? formatDayMonth(g.nextDate) : '—'}
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {g.lastDate ? formatDayMonth(g.lastDate, { withYear: 'auto' }) : '—'}
                        </div>
                        <div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => { setExtendFor(g.recurringGroupId); setExPattern((g.pattern as any) || 'weekly'); }}
                                    disabled={isCancelling}
                                    style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, padding: '5px 10px', background: GH.ink, color: GH.paper, border: 'none', cursor: 'pointer' }}>
                                    Продлить
                                </button>
                                <button onClick={() => askCancelSeries(g, resource?.name || g.resourceId)}
                                    disabled={isConfirming || isCancelling}
                                    style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const, padding: '5px 10px', background: 'transparent', border: `1px solid ${GH.danger}`, color: GH.danger, cursor: 'pointer', opacity: isCancelling ? 0.5 : 1 }}>
                                    {isCancelling ? 'Отменяем…' : 'Отменить'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })}

            {(() => {
                const inp: React.CSSProperties = { width: 170 };
                // Общая шторка вместо самодельного окна: Esc, фокус внутри, подвал с кнопкой.
                return (
                    <Sheet
                        open={!!extendFor}
                        onClose={() => { if (!exBusy) setExtendFor(null); }}
                        dismissible={!exBusy}
                        title="Продлить серию"
                        width={420}
                        footer={
                            <>
                                <Button variant="primary" block loading={exBusy} onClick={submitExtend}>Добавить</Button>
                                <Button variant="secondary" block disabled={exBusy} onClick={() => setExtendFor(null)}>Отмена</Button>
                            </>
                        }
                    >
                        <div>
                            <div style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: GH.ink60, marginBottom: 8 }}>Как часто</div>
                            <div className="ui-chip-row" role="group" aria-label="Как часто" style={{ marginBottom: 16 }}>
                                {([['weekly', 'Каждую неделю'], ['biweekly', 'Раз в 2 недели'], ['monthly', 'Раз в 4 недели']] as const).map(([p, l]) => (
                                    <Chip key={p} selected={exPattern === p} onClick={() => setExPattern(p)}>{l}</Chip>
                                ))}
                            </div>
                            <div style={{ fontSize: 'var(--text-small)', fontWeight: 500, color: GH.ink60, marginBottom: 8 }}>Сколько добавить</div>
                            <div className="ui-chip-row" role="group" aria-label="Сколько добавить" style={{ marginBottom: 12 }}>
                                {([['count', 'По числу'], ['until', 'До даты']] as const).map(([m, l]) => (
                                    <Chip key={m} selected={exMode === m} onClick={() => setExMode(m)}>{l}</Chip>
                                ))}
                            </div>
                            {exMode === 'count' ? (
                                <input type="number" min={1} max={52} value={exCount} aria-label="Сколько броней добавить" onChange={e => setExCount(Math.max(1, Math.min(52, Number(e.target.value))))} className="ui-input tabular-nums" style={inp} />
                            ) : (
                                <input type="date" value={exUntil} aria-label="До какой даты продлить" min={new Date().toISOString().slice(0, 10)} onChange={e => setExUntil(e.target.value)} className="ui-input" style={inp} />
                            )}
                        </div>
                    </Sheet>
                );
            })()}
        </div>
    );
}
