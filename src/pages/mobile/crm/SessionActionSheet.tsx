import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Check, X, MapPin, Calendar, Trash2,
    Unlink, ChevronRight, AlertTriangle, ArrowLeft, CalendarPlus, CalendarClock,
} from 'lucide-react';
import { crmApi, type CrmSession, type CrmClient, type CrmNote, type CrmPayment } from '../../../api/crm';
import { formatBatumi, parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { CURRENCIES } from '../../../utils/currency';
import { useUserStore } from '../../../store/userStore';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input, Select, TextArea } from '../../../components/ui/Field';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { COLOR } from '../../../design/tokens';
import { formatDateLabel, formatDayMonth, formatMoney, formatTime } from '../../../utils/format';
import type { BookingHistoryItem } from '../../../store/types';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from '../admin/parseMoneyInput';
import { useCrmStore } from '../../../store/crmStore';
import { nextSessionLabel } from './crmFlows';
import { SessionPaymentBlock } from '../../../components/crm/SessionPaymentBlock';
import { partialPayment } from '../../../utils/sessionMoney';

/** Resolve the active currency for a session: session.currency overrides
 * client.currency (frozen at payment time), default to GEL. */
function sessionCurrency(s: CrmSession, c?: CrmClient): string {
    return s.currency || c?.currency || 'GEL';
}

function currencySymbol(code: string): string {
    return CURRENCIES.find(c => c.code === code)?.symbol ?? code;
}

/** Дата/время сессии из базы (UTC) — по Батуми. */
const TZ = { timeZone: BATUMI_TZ };

/**
 * Bottom sheet with full per-session actions used by the mobile CRM day
 * view. Decoupled from the list so other places (client detail page,
 * notifications) can reuse it.
 *
 * Mounted with a single `session` prop; closes via `onClose`. After any
 * action that mutates the session, calls `onChange(updated)` so the parent
 * can patch its local state without a full reload.
 *
 * Wave 1: контейнер — общий Sheet (слой выше меню, Esc, свайп за ручку,
 * крестик «Закрыть», фокус внутри, появление 220 мс). Оплата — вся строка
 * кнопка (раньше системный чекбокс 22×22 внутри кнопки), снятие оплаты
 * спрашивает подтверждение. Поля и кнопки — общие Field/Button.
 * Главная кнопка шагов «Перенос», «Цена», «Заметки» — в подвале шторки
 * (всегда видна над клавиатурой), поэтому поля этих шагов живут в родителе.
 */

interface Props {
    session: CrmSession;
    client?: CrmClient;
    onClose: () => void;
    onChange: (updated: CrmSession) => void;
    onDeleted: (id: string) => void;
    /** Волна 3: первая строка «Записать следующую · вт, 7 окт., 19:00».
     *  Родитель закрывает эту шторку и открывает NewSessionSheet. */
    onBookNext?: (session: CrmSession) => void;
}

type Mode = 'main' | 'reschedule' | 'price' | 'notes' | 'delete' | 'cabinet';

/** Служебная пометка, которую бэкенд ставит сессиям из заявок с сайта
 *  (specialist_schedule.py). Это не заметка специалиста — не предлагаем
 *  её «переносить» в Заметки. */
const SITE_REQUEST_MARK = 'Заявка через публичный сайт';

export function SessionActionSheet({ session, client, onClose, onChange, onDeleted, onBookNext }: Props) {
    // В «просмотре как специалист» записывать нельзя — строку не показываем.
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const [mode, setMode] = useState<Mode>('main');
    const [busy, setBusy] = useState(false);
    // Поля шагов живут здесь: кнопка шага — в подвале общей шторки.
    const [resDate, setResDate] = useState('');
    const [resTime, setResTime] = useState('');
    const [resDur, setResDur] = useState(60);
    const [priceRaw, setPriceRaw] = useState('');
    // Валюта и счёт сессии правятся вместе с ценой (раньше шла одна цена).
    const [currencyRaw, setCurrencyRaw] = useState('GEL');
    const [accountRaw, setAccountRaw] = useState('');
    const [noteText, setNoteText] = useState('');
    const { confirm } = useConfirmDialog();

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

    // Платёж этой сессии — для блока «Оплата» (правка, доплата, расхождение с ценой).
    // Перечитываем, когда сессия поменялась (оплатили, правили цену или платёж).
    const [payment, setPayment] = useState<CrmPayment | null>(null);
    useEffect(() => {
        if (!session.isPaid && !(session.paidAmount && session.paidAmount > 0)) { setPayment(null); return; }
        let cancelled = false;
        crmApi.getPayments({ clientId: session.clientId })
            .then(list => { if (!cancelled) setPayment(list.find(p => p.sessionId === session.id) ?? null); })
            .catch(() => { if (!cancelled) setPayment(null); });
        return () => { cancelled = true; };
    }, [session.id, session.clientId, session.isPaid, session.price, session.currency, session.paidAmount]);
    // Платёж поправили или доплатили: берём свежую сессию (внесено/остаток считает сервер).
    const refreshSession = useCallback(async () => {
        try {
            const list = await crmApi.getSessions({ clientId: session.clientId });
            const fresh = list.find(x => x.id === session.id);
            if (fresh) onChange(fresh);
        } catch { /* тихо: данные обновятся при следующем открытии */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.id, session.clientId]);

    // Старый текст из session.notes (писался шторкой до 29.09). Показываем,
    // пока его копии нет среди заметок сессии.
    const legacyText = (session.notes || '').trim();
    const legacyNote = legacyText && sessionNotes
        && !sessionNotes.some(n => (n.content || '').trim() === legacyText)
        ? legacyText : null;

    const when = parseUTC(session.date);
    const time = formatTime(when, TZ);
    // Wave 1: «вт, 29 сентября» (раньше «29 September, Tue»).
    const dateLabel = formatDateLabel(when, TZ);

    const update = async (patch: Parameters<typeof crmApi.updateSession>[1], successMsg = 'Сохранено') => {
        setBusy(true);
        try {
            const updated = await crmApi.updateSession(session.id, patch);
            onChange(updated);
            toast.success(successMsg);
            return updated;
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось сохранить. Попробуйте ещё раз');
            throw e;
        } finally {
            setBusy(false);
        }
    };

    const handleStatus = async (status: CrmSession['status']) => {
        try { await update({ status }, status === 'COMPLETED' ? 'Сессия отмечена как прошедшая' : 'Статус обновлён'); setMode('main'); } catch { /* toast already shown */ }
    };

    const handlePaid = async (isPaid: boolean) => {
        // 2026-05-22: mark-paid must go through quick-pay (same as desktop)
        // so the payment is RECORDED — price/currency/account resolved from
        // the session + client, and a TherapistPayment row is written.
        // The old path just flipped `is_paid` with updateSession, which left
        // finances with no payment record (mobile-only "phantom paid" bug).
        if (!isPaid) {
            // Снятие оплаты удаляет платёж — раньше это делал один тап по галочке.
            const ok = await confirm({
                title: 'Снять оплату?',
                body: 'Платёж за эту сессию уберём из финансов, сессия снова станет неоплаченной.',
                confirmLabel: 'Снять оплату',
                cancelLabel: 'Оставить',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setBusy(true);
        try {
            if (isPaid) {
                const res = await crmApi.quickPaySession(session.id);
                // Цену и валюту сессии из платежа НЕ подставляем (платёж мог быть в другой
                // валюте и цена превратилась бы в сумму платежа) — перечитываем сессию.
                onChange({ ...session, isPaid: true, remaining: 0 });
                refreshSession();
                const added = res.added ?? res.amount;
                toast.success(
                    added
                        ? `Оплачено: ${formatMoney(added, { currency: res.currency || 'GEL' })}`
                        : 'Сессия отмечена оплаченной',
                );
            } else {
                await crmApi.unmarkPaidSession(session.id);
                // Снятая оплата: «внесено/остаток» от прежней оплаты больше неверны — сбрасываем,
                // долг снова считается по полной цене, пока сервер не пришлёт свежие.
                onChange({ ...session, isPaid: false, paidAmount: undefined, remaining: undefined });
                toast.success('Оплата снята');
            }
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось изменить оплату. Попробуйте ещё раз');
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
            toast.error(typeof msg === 'string' ? msg : 'Не удалось изменить бронь кабинета. Попробуйте ещё раз');
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
            toast.error(typeof msg === 'string' ? msg : 'Не удалось удалить сессию. Попробуйте ещё раз');
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
            body: 'Восстановить её будет нельзя.',
            confirmLabel: 'Удалить заметку',
            cancelLabel: 'Оставить',
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

    // Drag-to-dismiss, лок прокрутки, Esc и фокус — теперь у общего Sheet.

    /** Переход на шаг: поля шага заполняются заново из сессии. */
    const openMode = (m: Mode) => {
        if (m === 'reschedule') {
            setResDate(formatBatumi(session.date, 'yyyy-MM-dd'));
            setResTime(formatBatumi(session.date, 'HH:mm'));
            setResDur(session.durationMinutes ?? 60);
        }
        if (m === 'price') {
            setPriceRaw((session.price ?? client?.basePrice ?? 0).toString());
            setCurrencyRaw(sessionCurrency(session, client).toUpperCase());
            setAccountRaw(session.account ?? client?.defaultAccount ?? 'cash');
        }
        if (m === 'notes') setNoteText('');
        setMode(m);
    };

    // Цена — общий разбор суммы. Пустое или кривое поле не сохраняем
    // (раньше пустое поле через «|| 0» записывало цену 0).
    const parsedPrice = parseMoneyInput(priceRaw);
    const priceError = !isMoneyInputBlank(priceRaw) && parsedPrice === null ? MONEY_INPUT_ERROR : undefined;

    const submitReschedule = async () => {
        // Build a Tbilisi wall-clock ISO; backend converts to UTC.
        const iso = `${resDate}T${resTime}:00`;
        try { await update({ date: iso, durationMinutes: resDur }, 'Сессия перенесена'); setMode('main'); } catch { /* toast already shown */ }
    };
    const submitPrice = async () => {
        if (parsedPrice === null) return;
        try {
            // Валюту и счёт шлём, только если их поменяли (иначе счёт клиента по умолчанию
            // «замораживался» бы на сессии при правке одной цены).
            const patch: Parameters<typeof crmApi.updateSession>[1] = { price: parsedPrice };
            if (currencyRaw !== sessionCurrency(session, client).toUpperCase()) patch.currency = currencyRaw;
            if (accountRaw !== (session.account ?? client?.defaultAccount ?? 'cash')) patch.account = accountRaw;
            await update(patch, 'Цена обновлена');
            setMode('main');
        } catch { /* toast already shown */ }
    };
    const submitNote = async () => {
        if (await handleAddNote(noteText)) setMode('main');
    };

    const footer = mode === 'reschedule' ? (
        <Button block loading={busy} disabled={!resDate || !resTime} onClick={submitReschedule}>
            Перенести сессию
        </Button>
    ) : mode === 'price' ? (
        <Button block loading={busy} disabled={parsedPrice === null} onClick={submitPrice}>
            Сохранить цену
        </Button>
    ) : mode === 'notes' ? (
        <Button block loading={busy} disabled={!noteText.trim()} onClick={submitNote}>
            Сохранить заметку
        </Button>
    ) : undefined;

    return (
        <Sheet
            open
            onClose={onClose}
            title={client?.name ?? 'Клиент…'}
            description={`${dateLabel}, ${time} · ${session.durationMinutes ?? 60} мин`}
            footer={footer}
        >
            {mode === 'main' && (
                <Main
                    session={session}
                    client={client}
                    busy={busy}
                    notes={sessionNotes}
                    legacyNote={legacyNote}
                    onStatus={handleStatus}
                    onPaid={handlePaid}
                    onPrice={() => openMode('price')}
                    onNotes={() => openMode('notes')}
                    onReschedule={() => openMode('reschedule')}
                    onDelete={() => openMode('delete')}
                    onCabinet={() => openMode('cabinet')}
                    onBookNext={onBookNext && !viewingOther ? () => onBookNext(session) : undefined}
                    paymentBlock={client && payment ? (
                        <SessionPaymentBlock
                            session={session}
                            client={client}
                            payment={payment}
                            readOnly={viewingOther}
                            onChanged={refreshSession}
                        />
                    ) : undefined}
                />
            )}
            {mode === 'reschedule' && (
                <RescheduleForm
                    date={resDate}
                    time={resTime}
                    dur={resDur}
                    onDate={setResDate}
                    onTime={setResTime}
                    onDur={setResDur}
                    onBack={() => setMode('main')}
                />
            )}
            {mode === 'price' && (
                <PriceForm
                    value={priceRaw}
                    error={priceError}
                    currency={currencyRaw}
                    account={accountRaw}
                    onChange={setPriceRaw}
                    onCurrency={setCurrencyRaw}
                    onAccount={setAccountRaw}
                    onBack={() => setMode('main')}
                />
            )}
            {mode === 'notes' && (
                <NotesForm
                    busy={busy}
                    text={noteText}
                    onText={setNoteText}
                    notes={sessionNotes}
                    failed={notesFailed}
                    legacyNote={legacyNote}
                    onRetry={loadNotes}
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
        </Sheet>
    );
}

function Main({
    session, client, busy, notes, legacyNote, onStatus, onPaid, onPrice, onNotes, onReschedule,
    onDelete, onCabinet, onBookNext, paymentBlock,
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
    onBookNext?: () => void;
    /** Блок «Оплата» (правка платежа, доплата, расхождение с ценой). */
    paymentBlock?: ReactNode;
}) {
    const navigate = useNavigate();
    // G6-M4: у будущей сессии нет «Прошла» — случайный тап делал завтрашнюю
    // сессию долгом. Главное действие будущей — «Перенести».
    const isFuture = parseUTC(session.date).getTime() > Date.now();
    const cabinet = useLinkedBooking(session, false).label;
    const latestNote = notes?.[0]?.content || legacyNote;
    const currency = sessionCurrency(session, client);
    const symbol = currencySymbol(currency);
    const currencyIcon = (
        <span aria-hidden="true" style={{ fontWeight: 600, fontSize: 16, lineHeight: 1 }}>{symbol}</span>
    );
    const priceText = session.price ? formatMoney(session.price, { currency }) : null;
    // Частично оплачена: внесено, но не всё — на кнопке остаток, а не «Отметить оплату».
    const partial = partialPayment(session, client);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Волна 3: «записать следующую» — второй тап из трёх
                (карточка → эта строка → «Записать»). Тот же день недели и
                время через неделю (utils/crmNextSession, по Батуми). */}
            {onBookNext && (
                <Row
                    icon={<CalendarPlus size={16} aria-hidden="true" />}
                    label={`Записать следующую · ${nextSessionLabel(session, client)}`}
                    sub="Тот же день недели и время"
                    onClick={onBookNext}
                />
            )}
            {/* Status quick toggle */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, paddingBottom: 8, paddingTop: onBookNext ? 6 : 0 }}>
                {session.status !== 'COMPLETED' && isFuture ? (
                    <ActionTile
                        icon={<CalendarClock size={18} aria-hidden="true" />}
                        label="Перенести"
                        disabled={busy}
                        onClick={onReschedule}
                    />
                ) : session.status !== 'COMPLETED' ? (
                    <ActionTile
                        icon={<Check size={18} aria-hidden="true" />}
                        label="Прошла"
                        tone="primary"
                        disabled={busy}
                        onClick={() => onStatus('COMPLETED')}
                    />
                ) : (
                    <ActionTile
                        icon={<Calendar size={18} aria-hidden="true" />}
                        label="Запланирована"
                        disabled={busy}
                        onClick={() => onStatus('PLANNED')}
                    />
                )}
                {/* "Отмена" = удаление: 2026-05-14 spec — больше нет CANCELLED
                    статуса, отмена просто удаляет запись. Бронь кабинета при
                    этом НЕ отменяется (delete_session её не трогает). */}
                <ActionTile
                    icon={<X size={18} aria-hidden="true" />}
                    label="Отменить"
                    tone="danger-soft"
                    disabled={busy}
                    onClick={onDelete}
                />
            </div>

            {/* Оплата: вся строка — кнопка. Раньше срабатывал только системный
                чекбокс 22×22 внутри кнопки (вложенные элементы, мимо легко
                промахнуться), а снятие оплаты удаляло платёж без вопроса. */}
            <Row
                icon={currencyIcon}
                label={session.isPaid ? 'Оплачено' : partial ? `Доплатить ${formatMoney(partial.remaining, { currency })}` : 'Отметить оплату'}
                sub={partial
                    ? `Оплачено ${formatMoney(partial.paid, { currency })} из ${formatMoney(partial.price, { currency })}`
                    : (priceText ?? 'цена не указана')}
                pressed={!!session.isPaid}
                disabled={busy}
                right={<CheckMark on={!!session.isPaid} />}
                onClick={() => onPaid(!session.isPaid)}
            />
            {paymentBlock}
            <Row
                icon={currencyIcon}
                label="Цена"
                sub={priceText ?? '—'}
                onClick={onPrice}
            />
            <Row
                icon={<Calendar size={16} aria-hidden="true" />}
                label="Перенести время"
                sub="Дата · время · длительность"
                onClick={onReschedule}
            />
            <Row
                icon={<MapPin size={16} aria-hidden="true" />}
                label={session.isBooked ? `Кабинет: ${cabinet ?? 'привязан'}` : 'Привязать кабинет'}
                sub={session.isBooked ? 'Бронь активна · открепить или отменить' : 'Забронировать кабинет под эту сессию'}
                onClick={() => {
                    if (session.isBooked) {
                        // Отдельный шаг с последствиями: раньше «Отменить бронь»
                        // срабатывала с одного тапа, а «открепить» спрашивало
                        // непонятным системным окном.
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
                icon={<ChevronRight size={16} aria-hidden="true" />}
                label={notes && notes.length > 1 ? `Заметки · ${notes.length}` : 'Заметка'}
                sub={notes === null && !legacyNote ? '…' : latestNote ? truncate(latestNote, 60) : 'добавить заметку'}
                onClick={onNotes}
            />
        </div>
    );
}

function RescheduleForm({ date, time, dur, onDate, onTime, onDur, onBack }: {
    date: string;
    time: string;
    dur: number;
    onDate: (v: string) => void;
    onTime: (v: string) => void;
    onDur: (v: number) => void;
    onBack: () => void;
}) {
    // Кнопка «Перенести сессию» — в подвале шторки (SessionActionSheet).
    return (
        <FormShell title="Перенос сессии" onBack={onBack}>
            {/* Поле даты браузер рисует на языке телефона («10/07/2026», «Oct 7»).
                Под ним — та же дата по-русски из format.ts, как в «Новой сессии». */}
            <Field label="Дата" hint={date ? formatDateLabel(date, { capitalize: true, withYear: 'auto' }) : undefined}>
                <Input kind="date" lang="ru" value={date} onChange={e => onDate(e.target.value)} />
            </Field>
            <Field label="Время (Батуми)">
                <Input kind="time" value={time} onChange={e => onTime(e.target.value)} />
            </Field>
            <Field label="Длительность">
                <Select value={dur} onChange={e => onDur(parseInt(e.target.value))}>
                    {[30, 45, 60, 75, 90, 120].map(n => <option key={n} value={n}>{n} мин</option>)}
                </Select>
            </Field>
        </FormShell>
    );
}

function PriceForm({ value, error, currency, account, onChange, onCurrency, onAccount, onBack }: {
    value: string; error?: string;
    currency: string; account: string;
    onChange: (v: string) => void;
    onCurrency: (v: string) => void;
    onAccount: (v: string) => void;
    onBack: () => void;
}) {
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const symbol = currencySymbol(currency);
    // Старое значение, которого нет в списках, остаётся выбираемым — форма не подменит его молча.
    const currencies = CURRENCIES.some(c => c.code === currency) ? CURRENCIES : [...CURRENCIES, { code: currency, symbol: currency, label: currency }];
    const accounts = paymentAccounts.some(a => a.id === account) || !account
        ? paymentAccounts : [...paymentAccounts, { id: account, label: account }];
    // Кнопка «Сохранить цену» — в подвале шторки, неактивна при пустом поле.
    return (
        <FormShell title="Цена сессии" onBack={onBack}>
            <Field label="Цена" error={error}>
                <Input
                    kind="money"
                    suffix={symbol}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                />
            </Field>
            <Field label="Валюта">
                <Select value={currency} onChange={e => onCurrency(e.target.value)}>
                    {currencies.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                </Select>
            </Field>
            <Field label="Счёт для оплаты">
                <Select value={account} onChange={e => onAccount(e.target.value)}>
                    {accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                </Select>
            </Field>
        </FormShell>
    );
}

/** Заметки к сессии: список (новые сверху) + поле для новой. Пишутся
 *  в общие Заметки, поэтому видны во вкладке «Заметки», в истории клиента
 *  и на компьютере. Правки на сервере нет — только добавить или удалить.
 *  Кнопка «Сохранить заметку» — в подвале шторки. */
function NotesForm({ busy, text, onText, notes, failed, legacyNote, onRetry, onMoveLegacy, onDeleteNote, onBack }: {
    busy: boolean;
    text: string;
    onText: (v: string) => void;
    notes: CrmNote[] | null;
    failed: boolean;
    legacyNote: string | null;
    onRetry: () => void;
    onMoveLegacy: (text: string) => void;
    onDeleteNote: (note: CrmNote) => void;
    onBack: () => void;
}) {
    const isSiteMark = !!legacyNote && legacyNote.startsWith(SITE_REQUEST_MARK);
    return (
        <FormShell title="Заметки к сессии" onBack={onBack}>
            <Field label="Новая заметка" hint="Появится во вкладке «Заметки» и в истории клиента.">
                <TextArea
                    value={text}
                    onChange={e => onText(e.target.value)}
                    rows={5}
                    placeholder="О чём говорили, домашнее задание, наблюдения…"
                    style={{ minHeight: 110 }}
                />
            </Field>

            {failed && (
                <div style={{ marginTop: 12 }}>
                    <ErrorBar message="Не удалось загрузить прошлые заметки" onRetry={onRetry} />
                </div>
            )}
            {notes === null && !failed && (
                <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 14 }}>Загружаем заметки…</div>
            )}

            {legacyNote && (
                <div style={noteCard}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)', marginBottom: 4 }}>
                        {isSiteMark ? 'Пометка' : 'Раньше записано здесь · видно только в этой сессии'}
                    </div>
                    <div style={noteText}>{legacyNote}</div>
                    {!isSiteMark && (
                        <Button
                            variant="quiet"
                            disabled={busy}
                            onClick={() => onMoveLegacy(legacyNote)}
                            style={{ marginTop: 4, paddingLeft: 0, textDecoration: 'underline' }}
                        >
                            Перенести в «Заметки»
                        </Button>
                    )}
                </div>
            )}

            {(notes ?? []).map(n => {
                const created = parseUTC(n.createdAt);
                return (
                    <div key={n.id} style={noteCard}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink-60)', flex: 1 }}>
                                {formatDayMonth(created, TZ)}, {formatTime(created, TZ)}
                            </span>
                            <button
                                onClick={() => onDeleteNote(n)}
                                disabled={busy}
                                aria-label="Удалить заметку"
                                style={{
                                    background: 'none', border: 'none', width: 44, height: 44,
                                    margin: '-10px -8px -10px 0', display: 'grid', placeItems: 'center',
                                    color: 'var(--status-danger-fg)', cursor: 'pointer',
                                }}
                            >
                                <Trash2 size={16} aria-hidden="true" />
                            </button>
                        </div>
                        <div style={noteText}>{n.content}</div>
                    </div>
                );
            })}
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
    const sessionStart = parseUTC(session.date);
    const whenLabel = booking && booking.startTime
        ? `${formatDayMonth(start, TZ)}, ${booking.startTime.slice(0, 5)} · ${booking.duration ?? 60} мин`
        : `${formatDayMonth(sessionStart, TZ)}, ${formatTime(sessionStart, TZ)} · ${session.durationMinutes ?? 60} мин`;

    return (
        <FormShell title="Кабинет к сессии" onBack={onBack}>
            <div style={{ ...noteCard, marginTop: 0, background: 'var(--color-card)' }}>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{label ?? 'Кабинет'}</div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2 }}>{whenLabel}</div>
            </div>

            <Button
                variant="secondary"
                block
                disabled={busy}
                icon={<Unlink size={16} aria-hidden="true" />}
                onClick={onDetach}
                style={{ marginTop: 14 }}
            >
                Только открепить от сессии
            </Button>
            <div style={{ fontSize: 12, color: 'var(--color-ink-60)', margin: '6px 2px 0' }}>
                Бронь останется за вами — её можно привязать к другой сессии.
            </div>

            <div style={{ height: 1, background: 'var(--color-ink-08)', margin: '16px 0' }} />

            {hoursLeft <= 0 ? (
                <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                    Бронь уже началась или прошла — отменить её нельзя.
                </div>
            ) : hoursLeft < 24 ? (
                <div style={{ ...warnBox, marginTop: 0 }}>
                    <div>
                        До начала меньше суток — отменить бронь уже нельзя.
                        Её можно пересдать в «Моих бронях»: если время займут, вернём 50%.
                    </div>
                    <Button
                        variant="quiet"
                        onClick={() => navigate('/m/bookings')}
                        style={{ marginTop: 4, paddingLeft: 0, textDecoration: 'underline', color: 'var(--color-ink)' }}
                    >
                        Открыть мои брони
                    </Button>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--status-pending-fg)', marginBottom: 10 }}>
                        <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 14, lineHeight: 1.4 }}>
                            Бронь отменится, и кабинет смогут занять другие. Если бронь
                            уже оплачена, оплата вернётся полностью. Сессия в CRM останется.
                        </span>
                    </div>
                    <Button variant="danger" block loading={busy} onClick={onCancelBooking}>
                        Отменить бронь кабинета
                    </Button>
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
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--status-pending-fg)', marginBottom: 12 }}>
                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 14 }}>
                    Сессия удалится из CRM и Google Календаря.
                    {session.isBooked && ' Бронь кабинета при этом не отменится — если кабинет не нужен, сначала отмените её: «Назад» → «Кабинет».'}
                </span>
            </div>
            <Button variant="danger" block disabled={busy} onClick={() => onDelete('this')}>
                Отменить только эту сессию
            </Button>
            {session.recurringGroupId && (
                <Button variant="danger" block disabled={busy} onClick={() => onDelete('future')} style={{ marginTop: 8 }}>
                    Отменить эту и все будущие в серии
                </Button>
            )}
        </FormShell>
    );
}

// ─── small building blocks ──────────────────────────────────────────────
function Row({ icon, label, sub, right, onClick, tone, pressed, disabled }: {
    icon: React.ReactNode;
    label: string;
    sub?: string;
    right?: React.ReactNode;
    onClick?: () => void;
    tone?: 'danger-soft';
    /** Для переключателя (оплата): состояние для экранного диктора. */
    pressed?: boolean;
    disabled?: boolean;
}) {
    const fg = tone === 'danger-soft' ? 'var(--status-danger-fg)' : 'var(--color-ink)';
    return (
        <button
            onClick={onClick}
            disabled={disabled || (!onClick && !right)}
            aria-pressed={pressed}
            className={onClick ? 'press' : undefined}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 14px',
                minHeight: 56,
                background: 'var(--color-card)',
                border: '1px solid var(--color-ink-08)',
                borderRadius: 12,
                cursor: onClick ? 'pointer' : 'default',
                fontFamily: 'inherit',
                color: fg,
                width: '100%',
                textAlign: 'left',
            }}
        >
            <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: tone === 'danger-soft' ? 'var(--status-danger-bg)' : 'var(--color-sunken)',
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>{icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
            </div>
            {right ?? (onClick && <ChevronRight size={16} color={COLOR.ink40} aria-hidden="true" />)}
        </button>
    );
}

/** Визуальная галочка оплаты (не отдельный элемент управления). */
function CheckMark({ on }: { on: boolean }) {
    return (
        <span aria-hidden="true" style={{
            width: 24, height: 24, borderRadius: 6, flexShrink: 0,
            display: 'grid', placeItems: 'center',
            background: on ? 'var(--status-ok-fg)' : 'transparent',
            border: on ? 'none' : '2px solid var(--color-ink-40)',
            color: 'var(--color-on-ink)',
        }}>
            {on && <Check size={16} strokeWidth={3} />}
        </span>
    );
}

function ActionTile({ icon, label, onClick, tone, disabled }: {
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    tone?: 'primary' | 'danger-soft';
    disabled?: boolean;
}) {
    const bg = tone === 'primary' ? 'var(--color-ink)' : tone === 'danger-soft' ? 'var(--status-danger-bg)' : 'var(--color-sunken)';
    const fg = tone === 'primary' ? 'var(--color-on-ink)' : tone === 'danger-soft' ? 'var(--status-danger-fg)' : 'var(--color-ink)';
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className="press"
            style={{
                background: bg, color: fg,
                border: 'none', borderRadius: 12,
                padding: '14px 12px',
                minHeight: 64,
                fontWeight: 600, fontSize: 14, fontFamily: 'inherit',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Button
                variant="quiet"
                icon={<ArrowLeft size={16} aria-hidden="true" />}
                onClick={onBack}
                style={{ alignSelf: 'flex-start', paddingLeft: 0, color: 'var(--color-ink-60)' }}
            >
                Назад
            </Button>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h3>
            {children}
        </div>
    );
}

function truncate(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ─── styles ─────────────────────────────────────────────────────────────
const warnBox: React.CSSProperties = {
    background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
    borderRadius: 10, padding: '10px 12px', marginTop: 12,
    fontSize: 14, lineHeight: 1.4,
};

// Заметка — нейтральная карточка (раньше жёлтая «стикер»: цвет — только для статуса).
const noteCard: React.CSSProperties = {
    background: 'var(--color-sunken)', border: '1px solid var(--color-ink-08)',
    borderRadius: 12, padding: '10px 12px', marginTop: 10,
};

const noteText: React.CSSProperties = {
    fontSize: 14, color: 'var(--color-ink-80)', lineHeight: 1.45,
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
};
