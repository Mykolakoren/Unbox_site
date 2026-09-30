import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScrollLock } from '../useScrollLock';
import { toast } from 'sonner';
import { ru } from 'date-fns/locale';
import {
    Check, X, MapPin, Calendar, Trash2,
    Unlink, ChevronRight, AlertTriangle,
} from 'lucide-react';
import { crmApi, type CrmSession, type CrmClient, type CrmNote } from '../../../api/crm';
import { formatBatumi, parseUTC } from '../../../utils/dateUtils';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { CURRENCIES } from '../../../utils/currency';
import { useUserStore } from '../../../store/userStore';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import type { BookingHistoryItem } from '../../../store/types';

/** Resolve the active currency for a session: session.currency overrides
 * client.currency (frozen at payment time), default to GEL. */
function sessionCurrency(s: CrmSession, c?: CrmClient): string {
    return s.currency || c?.currency || 'GEL';
}

function currencySymbol(code: string): string {
    return CURRENCIES.find(c => c.code === code)?.symbol ?? code;
}


/**
 * Bottom sheet with full per-session actions used by the mobile CRM day
 * view. Decoupled from the list so other places (client detail page,
 * notifications) can reuse it.
 *
 * Mounted with a single `session` prop; closes via `onClose`. After any
 * action that mutates the session, calls `onChange(updated)` so the parent
 * can patch its local state without a full reload.
 */

interface Props {
    session: CrmSession;
    client?: CrmClient;
    onClose: () => void;
    onChange: (updated: CrmSession) => void;
    onDeleted: (id: string) => void;
}

type Mode = 'main' | 'reschedule' | 'price' | 'notes' | 'delete' | 'cabinet';

/** Служебная пометка, которую бэкенд ставит сессиям из заявок с сайта
 *  (specialist_schedule.py). Это не заметка специалиста — не предлагаем
 *  её «переносить» в Заметки. */
const SITE_REQUEST_MARK = 'Заявка через публичный сайт';

export function SessionActionSheet({ session, client, onClose, onChange, onDeleted }: Props) {
    const [mode, setMode] = useState<Mode>('main');
    const [busy, setBusy] = useState(false);
    const startY = useRef<number | null>(null);
    const sheetRef = useRef<HTMLDivElement | null>(null);
    const { confirm } = useConfirmDialog();

    // Lock scroll while sheet open — ref-counted, не залипает.
    useScrollLock();

    // Заметки к сессии — это те же записи (TherapistNote), что во вкладке
    // «Заметки», в истории клиента и в десктопной карточке. Раньше шторка
    // писала в отдельное поле session.notes, и написанное здесь больше
    // нигде не было видно. null = ещё грузим.
    const [sessionNotes, setSessionNotes] = useState<CrmNote[] | null>(null);
    const [notesFailed, setNotesFailed] = useState(false);
    const loadNotes = useCallback(() => {
        let cancelled = false;
        setSessionNotes(null);
        setNotesFailed(false);
        crmApi.getNotes(session.clientId, undefined, session.id)
            // Фильтруем и тут: если сервер не знает session_id, он вернёт
            // все заметки клиента.
            .then(list => { if (!cancelled) setSessionNotes(list.filter(n => n.sessionId === session.id)); })
            .catch(() => { if (!cancelled) { setSessionNotes([]); setNotesFailed(true); } });
        return () => { cancelled = true; };
    }, [session.id, session.clientId]);
    useEffect(() => loadNotes(), [loadNotes]);

    // Старый текст из session.notes (писался шторкой до 29.09). Показываем,
    // пока его копии нет среди заметок сессии.
    const legacyText = (session.notes || '').trim();
    const legacyNote = legacyText && sessionNotes
        && !sessionNotes.some(n => (n.content || '').trim() === legacyText)
        ? legacyText : null;

    const time = formatBatumi(session.date, 'HH:mm');
    // Wave 1: без русской локали шапка шторки была «29 September, Tue».
    const dateLabel = formatBatumi(session.date, 'd MMMM, EEE', ru);

    const update = async (patch: Parameters<typeof crmApi.updateSession>[1], successMsg = 'Сохранено') => {
        setBusy(true);
        try {
            const updated = await crmApi.updateSession(session.id, patch);
            onChange(updated);
            toast.success(successMsg);
            return updated;
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось');
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const handleStatus = async (status: CrmSession['status']) => {
        try { await update({ status }, status === 'COMPLETED' ? 'Сессия закрыта' : 'Статус обновлён'); setMode('main'); } catch { /* toast already shown */ }
    };

    const handlePaid = async (isPaid: boolean) => {
        // 2026-05-22: mark-paid must go through quick-pay (same as desktop)
        // so the payment is RECORDED — price/currency/account resolved from
        // the session + client, and a TherapistPayment row is written.
        // The old path just flipped `is_paid` with updateSession, which left
        // finances with no payment record (mobile-only "phantom paid" bug).
        setBusy(true);
        try {
            if (isPaid) {
                const res = await crmApi.quickPaySession(session.id);
                onChange({
                    ...session,
                    isPaid: true,
                    price: res.amount ?? session.price,
                    currency: res.currency ?? session.currency,
                    account: res.account ?? session.account,
                });
                toast.success(
                    res.amount
                        ? `Оплачено: ${res.amount} ${res.currency || ''}`.trim()
                        : 'Отмечено оплаченным',
                );
            } else {
                await crmApi.unmarkPaidSession(session.id);
                onChange({ ...session, isPaid: false });
                toast.success('Снято с оплаты');
            }
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось');
        } finally {
            setBusy(false);
        }
    };

    const handleDetach = async (cancelBooking: boolean) => {
        setBusy(true);
        try {
            await crmApi.detachCabinet(session.id, cancelBooking);
            onChange({ ...session, bookingId: undefined, isBooked: false });
            toast.success(cancelBooking ? 'Бронь кабинета отменена' : 'Сессия откреплена от кабинета');
            setMode('main');
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось');
        } finally { setBusy(false); }
    };

    const handleDelete = async (scope: 'this' | 'future') => {
        setBusy(true);
        try {
            await crmApi.deleteSession(session.id, scope);
            toast.success(scope === 'future' ? 'Сессия и будущие удалены' : 'Сессия удалена');
            onDeleted(session.id);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось удалить');
        } finally { setBusy(false); }
    };

    const handleAddNote = async (content: string): Promise<boolean> => {
        const text = content.trim();
        if (!text) return false;
        setBusy(true);
        try {
            const note = await crmApi.createNote({ clientId: session.clientId, sessionId: session.id, content: text });
            setSessionNotes(prev => [note, ...(prev ?? [])]);
            toast.success('Заметка сохранена');
            return true;
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось сохранить заметку');
            return false;
        } finally { setBusy(false); }
    };

    const handleDeleteNote = async (note: CrmNote) => {
        const ok = await confirm({
            title: 'Удалить заметку?',
            message: 'Восстановить её будет нельзя.',
            confirmLabel: 'Удалить',
            destructive: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            await crmApi.deleteNote(note.id);
            setSessionNotes(prev => (prev ?? []).filter(n => n.id !== note.id));
            toast.success('Заметка удалена');
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось удалить заметку');
        } finally { setBusy(false); }
    };

    // Drag-to-dismiss: track touchstart Y, on touchend if moved >120px down → close
    const onTouchStart = (e: React.TouchEvent) => {
        startY.current = e.touches[0].clientY;
    };
    const onTouchEnd = (e: React.TouchEvent) => {
        if (startY.current == null) return;
        const dy = e.changedTouches[0].clientY - startY.current;
        startY.current = null;
        if (dy > 120) onClose();
    };

    return (
        <div
            style={overlayStyle}
            onClick={onClose}
            role="dialog"
            aria-modal="true"
        >
            <div
                ref={sheetRef}
                style={sheetStyle}
                onClick={e => e.stopPropagation()}
                onTouchStart={onTouchStart}
                onTouchEnd={onTouchEnd}
            >
                {/* Drag handle */}
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
                    <div style={{ width: 36, height: 4, borderRadius: 2, background: '#ddd' }} />
                </div>

                {/* Header */}
                <div style={{ padding: '12px 18px 4px' }}>
                    <div style={{ fontSize: 12, color: '#888', fontWeight: 700, letterSpacing: '0.06em' }}>
                        {dateLabel} · {time} · {session.durationMinutes ?? 60} мин
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
                        {client?.name ?? `ID ${session.clientId.slice(0, 6)}…`}
                    </div>
                </div>

                {mode === 'main' && (
                    <Main
                        session={session}
                        client={client}
                        busy={busy}
                        notes={sessionNotes}
                        legacyNote={legacyNote}
                        onStatus={handleStatus}
                        onPaid={handlePaid}
                        onPrice={() => setMode('price')}
                        onNotes={() => setMode('notes')}
                        onReschedule={() => setMode('reschedule')}
                        onDelete={() => setMode('delete')}
                        onCabinet={() => setMode('cabinet')}
                    />
                )}
                {mode === 'reschedule' && (
                    <RescheduleForm
                        session={session}
                        busy={busy}
                        onSubmit={async (newDate, dur) => {
                            try { await update({ date: newDate, durationMinutes: dur }, 'Перенесено'); setMode('main'); } catch { /* */ }
                        }}
                        onBack={() => setMode('main')}
                    />
                )}
                {mode === 'price' && (
                    <PriceForm
                        session={session}
                        client={client}
                        busy={busy}
                        onSubmit={async (price) => {
                            try { await update({ price }, 'Цена обновлена'); setMode('main'); } catch { /* */ }
                        }}
                        onBack={() => setMode('main')}
                    />
                )}
                {mode === 'notes' && (
                    <NotesForm
                        busy={busy}
                        notes={sessionNotes}
                        failed={notesFailed}
                        legacyNote={legacyNote}
                        onRetry={loadNotes}
                        onAdd={async (text) => {
                            if (await handleAddNote(text)) setMode('main');
                        }}
                        onMoveLegacy={(text) => { handleAddNote(text); }}
                        onDeleteNote={handleDeleteNote}
                        onBack={() => setMode('main')}
                    />
                )}
                {mode === 'cabinet' && (
                    <CabinetForm
                        session={session}
                        busy={busy}
                        onDetach={() => handleDetach(false)}
                        onCancelBooking={() => handleDetach(true)}
                        onBack={() => setMode('main')}
                    />
                )}
                {mode === 'delete' && (
                    <DeleteConfirm
                        session={session}
                        busy={busy}
                        onDelete={handleDelete}
                        onBack={() => setMode('main')}
                    />
                )}
            </div>
        </div>
    );
}

function Main({
    session, client, busy, notes, legacyNote, onStatus, onPaid, onPrice, onNotes, onReschedule,
    onDelete, onCabinet,
}: {
    session: CrmSession;
    client?: CrmClient;
    busy: boolean;
    notes: CrmNote[] | null;
    legacyNote: string | null;
    onStatus: (s: CrmSession['status']) => void;
    onPaid: (v: boolean) => void;
    onPrice: () => void;
    onNotes: () => void;
    onReschedule: () => void;
    onDelete: () => void;
    onCabinet: () => void;
}) {
    const navigate = useNavigate();
    const cabinet = useLinkedBooking(session, false).label;
    const latestNote = notes?.[0]?.content || legacyNote;
    const currency = sessionCurrency(session, client);
    const symbol = currencySymbol(currency);
    const currencyIcon = (
        <span style={{ fontWeight: 800, fontSize: 16, lineHeight: 1 }}>{symbol}</span>
    );

    return (
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Status quick toggle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '0 6px 8px' }}>
                {session.status !== 'COMPLETED' ? (
                    <ActionTile
                        icon={<Check size={18} />}
                        label="Прошла"
                        tone="primary"
                        disabled={busy}
                        onClick={() => onStatus('COMPLETED')}
                    />
                ) : (
                    <ActionTile
                        icon={<Calendar size={18} />}
                        label="Запланирована"
                        disabled={busy}
                        onClick={() => onStatus('PLANNED')}
                    />
                )}
                {/* "Отмена" = удаление: 2026-05-14 spec — больше нет CANCELLED
                    статуса, отмена просто удаляет запись. Бронь кабинета при
                    этом НЕ отменяется (delete_session её не трогает). */}
                <ActionTile
                    icon={<X size={18} />}
                    label="Отменить"
                    tone="danger-soft"
                    disabled={busy}
                    onClick={onDelete}
                />
            </div>

            <Row
                icon={currencyIcon}
                label={session.isPaid ? 'Оплачено' : 'Не оплачено'}
                sub={session.price ? `${session.price.toFixed(0)} ${symbol}` : 'цена не указана'}
                right={
                    <input
                        type="checkbox"
                        checked={!!session.isPaid}
                        onChange={e => onPaid(e.target.checked)}
                        style={{ width: 22, height: 22 }}
                    />
                }
            />
            <Row
                icon={currencyIcon}
                label="Цена"
                sub={session.price ? `${session.price.toFixed(0)} ${symbol}` : '—'}
                onClick={onPrice}
            />
            <Row
                icon={<Calendar size={16} />}
                label="Перенести время"
                sub="Дата · время · длительность"
                onClick={onReschedule}
            />
            <Row
                icon={<MapPin size={16} />}
                label={session.isBooked ? `Кабинет: ${cabinet ?? 'привязан'}` : 'Привязать кабинет'}
                sub={session.isBooked ? 'Бронь активна · открепить или отменить' : 'Забронировать кабинет под эту сессию'}
                onClick={() => {
                    if (session.isBooked) {
                        // Отдельный шаг с последствиями: раньше «Отменить бронь»
                        // срабатывала с одного тапа, а «открепить» спрашивало
                        // непонятным системным confirm().
                        onCabinet();
                    } else {
                        const date = formatBatumi(session.date, 'yyyy-MM-dd');
                        const time = formatBatumi(session.date, 'HH:mm');
                        const dur = session.durationMinutes ?? 60;
                        navigate(`/m/find?linkSession=${session.id}&date=${date}&time=${time}&duration=${dur}`);
                    }
                }}
            />
            <Row
                icon={<ChevronRight size={16} />}
                label={notes && notes.length > 1 ? `Заметки · ${notes.length}` : 'Заметка'}
                sub={notes === null && !legacyNote ? '…' : latestNote ? truncate(latestNote, 60) : 'добавить заметку'}
                onClick={onNotes}
            />
        </div>
    );
}

function RescheduleForm({ session, busy, onSubmit, onBack }: {
    session: CrmSession;
    busy: boolean;
    onSubmit: (date: string, dur: number) => void;
    onBack: () => void;
}) {
    const initialDate = formatBatumi(session.date, 'yyyy-MM-dd');
    const initialTime = formatBatumi(session.date, 'HH:mm');
    const [date, setDate] = useState(initialDate);
    const [time, setTime] = useState(initialTime);
    const [dur, setDur] = useState(session.durationMinutes ?? 60);

    return (
        <FormShell title="Перенос сессии" onBack={onBack}>
            <Field label="Дата">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Время (Батуми)">
                <input type="time" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Длительность (мин)">
                <select value={dur} onChange={e => setDur(parseInt(e.target.value))} style={inputStyle}>
                    {[30, 45, 60, 75, 90, 120].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
            </Field>
            <SubmitButton
                disabled={busy}
                onClick={() => {
                    // Build a Tbilisi wall-clock ISO; backend converts to UTC.
                    const iso = `${date}T${time}:00`;
                    onSubmit(iso, dur);
                }}
            >
                Перенести
            </SubmitButton>
        </FormShell>
    );
}

function PriceForm({ session, client, busy, onSubmit, onBack }: {
    session: CrmSession; client?: CrmClient; busy: boolean;
    onSubmit: (price: number) => void; onBack: () => void;
}) {
    const [price, setPrice] = useState((session.price ?? 0).toString());
    const symbol = currencySymbol(sessionCurrency(session, client));
    return (
        <FormShell title="Цена сессии" onBack={onBack}>
            <Field label="Цена">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input
                        type="number" inputMode="decimal" min={0} step={1}
                        value={price} onChange={e => setPrice(e.target.value)}
                        style={inputStyle}
                    />
                    <span style={{ fontWeight: 700, color: '#666' }}>{symbol}</span>
                </div>
            </Field>
            <SubmitButton
                disabled={busy}
                onClick={() => onSubmit(parseFloat(price) || 0)}
            >
                Сохранить
            </SubmitButton>
        </FormShell>
    );
}

/** Заметки к сессии: список (новые сверху) + поле для новой. Пишутся
 *  в общие Заметки, поэтому видны во вкладке «Заметки», в истории клиента
 *  и на компьютере. Правки на сервере нет — только добавить или удалить. */
function NotesForm({ busy, notes, failed, legacyNote, onRetry, onAdd, onMoveLegacy, onDeleteNote, onBack }: {
    busy: boolean;
    notes: CrmNote[] | null;
    failed: boolean;
    legacyNote: string | null;
    onRetry: () => void;
    onAdd: (text: string) => void;
    onMoveLegacy: (text: string) => void;
    onDeleteNote: (note: CrmNote) => void;
    onBack: () => void;
}) {
    const [text, setText] = useState('');
    const isSiteMark = !!legacyNote && legacyNote.startsWith(SITE_REQUEST_MARK);
    return (
        <FormShell title="Заметки к сессии" onBack={onBack}>
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={5}
                placeholder="О чём говорили, домашнее задание, наблюдения…"
                style={{ ...inputStyle, resize: 'vertical', minHeight: 110 }}
            />
            <SubmitButton disabled={busy || !text.trim()} onClick={() => onAdd(text)}>Сохранить</SubmitButton>
            <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
                Заметка появится во вкладке «Заметки» и в истории клиента.
            </div>

            {failed && (
                <div style={warnBox}>
                    Не удалось загрузить прошлые заметки.
                    <button onClick={onRetry} style={linkBtn}>Повторить</button>
                </div>
            )}
            {notes === null && !failed && (
                <div style={{ fontSize: 13, color: '#888', marginTop: 14 }}>Загружаю заметки…</div>
            )}

            {legacyNote && (
                <div style={{ ...noteCard, background: '#F4F4F2', borderColor: 'rgba(0,0,0,0.06)' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#888', marginBottom: 4 }}>
                        {isSiteMark ? 'Пометка' : 'Раньше записано здесь · видно только в этой сессии'}
                    </div>
                    <div style={noteText}>{legacyNote}</div>
                    {!isSiteMark && (
                        <button onClick={() => onMoveLegacy(legacyNote)} disabled={busy} style={{ ...linkBtn, marginLeft: 0, marginTop: 8 }}>
                            Перенести в «Заметки»
                        </button>
                    )}
                </div>
            )}

            {(notes ?? []).map(n => (
                <div key={n.id} style={noteCard}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#8A5A00', flex: 1 }}>
                            {formatBatumi(n.createdAt, 'd MMM, HH:mm', ru)}
                        </span>
                        <button
                            onClick={() => onDeleteNote(n)}
                            disabled={busy}
                            aria-label="Удалить заметку"
                            style={{ background: 'none', border: 'none', padding: 4, color: '#C8253A', cursor: 'pointer' }}
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                    <div style={noteText}>{n.content}</div>
                </div>
            ))}
        </FormShell>
    );
}

/** Бронь кабинета, привязанная к сессии: ищем в уже загруженных бронях
 *  пользователя («Сегодня» их грузит). Нет в сторе — подгружаем, но только
 *  в шаге «Кабинет» (fetchIfMissing), чтобы не тянуть все брони на каждую шторку. */
function useLinkedBooking(session: CrmSession, fetchIfMissing = true): { booking: BookingHistoryItem | null; label: string | null } {
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const booking = session.bookingId ? bookings.find(b => b.id === session.bookingId) ?? null : null;
    const missing = fetchIfMissing && !!session.bookingId && !booking;
    useEffect(() => {
        if (missing) fetchBookings?.();
    }, [missing, fetchBookings]);
    const res = booking ? RESOURCES.find(r => r.id === booking.resourceId) : null;
    const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
    const label = res ? (loc ? `${res.name} · ${loc.name}` : res.name) : null;
    return { booking, label };
}

/** Начало брони (дата + время) — так же, как в BookingDetailSheet. */
function bookingStart(b: BookingHistoryItem): Date | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as unknown as string);
        if (isNaN(d.getTime()) || !b.startTime) return null;
        const [h, m] = b.startTime.split(':').map(Number);
        const out = new Date(d);
        out.setHours(h, m, 0, 0);
        return out;
    } catch { return null; }
}

/** Шаг «Кабинет»: открепить или отменить бронь — с понятными последствиями.
 *  Отмена — это обычная отмена брони: оплата возвращается, кабинет
 *  освобождается; меньше чем за сутки отменить нельзя (правило брони). */
function CabinetForm({ session, busy, onDetach, onCancelBooking, onBack }: {
    session: CrmSession;
    busy: boolean;
    onDetach: () => void;
    onCancelBooking: () => void;
    onBack: () => void;
}) {
    const navigate = useNavigate();
    const { booking, label } = useLinkedBooking(session);
    const start = (booking && bookingStart(booking)) || parseUTC(session.date);
    const hoursLeft = (start.getTime() - Date.now()) / 3600000;
    const whenLabel = booking && booking.startTime
        ? `${formatBatumi(start, 'd MMMM', ru)}, ${booking.startTime.slice(0, 5)} · ${booking.duration ?? 60} мин`
        : `${formatBatumi(session.date, 'd MMMM, HH:mm', ru)} · ${session.durationMinutes ?? 60} мин`;

    return (
        <FormShell title="Кабинет к сессии" onBack={onBack}>
            <div style={{ ...noteCard, marginTop: 0, background: '#fff', borderColor: 'rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{label ?? 'Кабинет'}</div>
                <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{whenLabel}</div>
            </div>

            <button onClick={onDetach} disabled={busy} style={{ ...neutralBtn, marginTop: 14 }}>
                <Unlink size={16} /> Только открепить от сессии
            </button>
            <div style={{ fontSize: 12, color: '#888', margin: '6px 2px 0' }}>
                Бронь останется за вами — её можно привязать к другой сессии.
            </div>

            <div style={{ height: 1, background: 'rgba(0,0,0,0.08)', margin: '16px 0' }} />

            {hoursLeft <= 0 ? (
                <div style={{ fontSize: 13, color: '#666' }}>
                    Бронь уже началась или прошла — отменить её нельзя.
                </div>
            ) : hoursLeft < 24 ? (
                <div style={{ ...warnBox, marginTop: 0 }}>
                    <div>
                        До начала меньше суток — отменить бронь уже нельзя.
                        Можно выставить её на переаренду в «Моих бронях».
                    </div>
                    <button onClick={() => navigate('/m/bookings')} style={{ ...linkBtn, marginLeft: 0, marginTop: 8 }}>
                        Открыть мои брони
                    </button>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#8A5A00', marginBottom: 10 }}>
                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 13, lineHeight: 1.4 }}>
                            Бронь отменится, и кабинет смогут занять другие. Если бронь
                            уже оплачена, оплата вернётся полностью. Сессия в CRM останется.
                        </span>
                    </div>
                    <button onClick={onCancelBooking} disabled={busy} style={destructiveBtn}>
                        Отменить бронь кабинета
                    </button>
                </>
            )}
        </FormShell>
    );
}

function DeleteConfirm({ session, busy, onDelete, onBack }: {
    session: CrmSession;
    busy: boolean;
    onDelete: (scope: 'this' | 'future') => void;
    onBack: () => void;
}) {
    return (
        <FormShell title="Отменить сессию?" onBack={onBack}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#8A5A00', marginBottom: 8 }}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 13 }}>
                    Сессия удалится из CRM и Google Calendar.
                    {session.isBooked && ' Бронь кабинета при этом не отменится — если кабинет не нужен, сначала отмените её: «Назад» → «Кабинет».'}
                </span>
            </div>
            <button onClick={() => onDelete('this')} disabled={busy} style={destructiveBtn}>
                Только эту сессию
            </button>
            {session.recurringGroupId && (
                <button onClick={() => onDelete('future')} disabled={busy} style={{ ...destructiveBtn, marginTop: 8 }}>
                    Эту и все будущие в серии
                </button>
            )}
        </FormShell>
    );
}

// ─── small building blocks ──────────────────────────────────────────────
function Row({ icon, label, sub, right, onClick, tone }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    right?: React.ReactNode;
    onClick?: () => void;
    tone?: 'danger-soft';
}) {
    const fg = tone === 'danger-soft' ? '#C8253A' : '#0E0E0E';
    return (
        <button
            onClick={onClick}
            disabled={!onClick && !right}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                background: '#fff',
                border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 12,
                cursor: onClick ? 'pointer' : 'default',
                fontFamily: 'inherit',
                color: fg,
                width: '100%',
                textAlign: 'left',
            }}
        >
            <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: tone === 'danger-soft' ? '#FEF2F2' : '#F4F4F2',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
            </div>
            {right ?? (onClick && <ChevronRight size={16} color="#bbb" />)}
        </button>
    );
}

function ActionTile({ icon, label, onClick, tone, disabled }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    tone?: 'primary' | 'danger-soft';
    disabled?: boolean;
}) {
    const bg = tone === 'primary' ? '#0E0E0E' : tone === 'danger-soft' ? '#FEF2F2' : '#F4F4F2';
    const fg = tone === 'primary' ? '#fff' : tone === 'danger-soft' ? '#C8253A' : '#0E0E0E';
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            style={{
                background: bg, color: fg,
                border: 'none', borderRadius: 12,
                padding: '14px 12px',
                fontWeight: 700, fontSize: 14, fontFamily: 'inherit',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                cursor: 'pointer',
                opacity: disabled ? 0.6 : 1,
            }}
        >
            {icon}
            {label}
        </button>
    );
}

function FormShell({ title, onBack, children }: {
    title: string; onBack: () => void; children: React.ReactNode;
}) {
    return (
        <div style={{ padding: '8px 18px 18px' }}>
            <button onClick={onBack} style={backBtn}>
                ← Назад
            </button>
            <h3 style={{ margin: '8px 0 14px', fontSize: 18, fontWeight: 700 }}>{title}</h3>
            {children}
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                {label}
            </div>
            {children}
        </div>
    );
}

function SubmitButton({ children, onClick, disabled }: {
    children: React.ReactNode; onClick: () => void; disabled?: boolean;
}) {
    return (
        <button onClick={onClick} disabled={disabled} style={{
            background: '#0E0E0E', color: '#fff',
            border: 'none', borderRadius: 12,
            padding: '14px 18px', width: '100%',
            fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
            cursor: disabled ? 'wait' : 'pointer',
            marginTop: 8,
            opacity: disabled ? 0.6 : 1,
        }}>{children}</button>
    );
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ─── styles ─────────────────────────────────────────────────────────────
const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
    display: 'flex', alignItems: 'flex-end',
    zIndex: 200,
};

const sheetStyle: React.CSSProperties = {
    background: '#F8F8F6',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    width: '100%',
    maxWidth: 480,
    margin: '0 auto',
    maxHeight: '90vh',
    overflow: 'auto',
    paddingBottom: 'env(safe-area-inset-bottom, 16px)',
    fontFamily: 'inherit',
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '12px 14px',
    borderRadius: 10, border: '1px solid rgba(0,0,0,0.10)',
    fontSize: 15, fontFamily: 'inherit',
    background: '#fff',
};

const backBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0,
    fontSize: 14, fontWeight: 600, color: '#666',
    cursor: 'pointer', fontFamily: 'inherit',
};

const neutralBtn: React.CSSProperties = {
    background: '#fff', color: '#0E0E0E',
    border: '1px solid rgba(0,0,0,0.12)', borderRadius: 12,
    padding: '14px 18px', width: '100%',
    fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};

const warnBox: React.CSSProperties = {
    background: '#FEF3C7', border: '1px solid #FCD34D', color: '#8A5A00',
    borderRadius: 10, padding: '10px 12px', marginTop: 12,
    fontSize: 13, lineHeight: 1.4,
};

const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', padding: 0, marginLeft: 6,
    color: '#0E0E0E', fontWeight: 700, fontSize: 13,
    textDecoration: 'underline', cursor: 'pointer', fontFamily: 'inherit',
};

const noteCard: React.CSSProperties = {
    background: '#FFFBEB', border: '1px solid #FCD34D',
    borderRadius: 12, padding: '10px 12px', marginTop: 10,
};

const noteText: React.CSSProperties = {
    fontSize: 14, color: '#333', lineHeight: 1.45,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};

const destructiveBtn: React.CSSProperties = {
    background: '#fff', color: '#C8253A',
    border: '1px solid #FBCFD4', borderRadius: 12,
    padding: '14px 18px', width: '100%',
    fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
    cursor: 'pointer',
};
