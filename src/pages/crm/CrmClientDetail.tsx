import { useEffect, useLayoutEffect, useState, useMemo, useCallback, type CSSProperties } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { DeleteSessionModal } from '../../components/crm/DeleteSessionModal';
import { NoteDeletePreview } from '../../components/crm/NoteDeletePreview';
import { NewSessionSheet } from '../../components/crm/NewSessionSheet';
import { UnpaidSessionsSheet } from '../../components/crm/UnpaidSessionsSheet';
import { SessionPaymentBlock } from '../../components/crm/SessionPaymentBlock';
import { PaymentEditSheet } from '../../components/crm/PaymentEditSheet';
import type { CrmClient, CrmSession, CrmNote, CrmPayment } from '../../api/crm';
import {
    Phone, Mail, Plus, Trash2, Check, X, Pencil, Send, RefreshCw, StickyNote,
} from 'lucide-react';
import { toast } from 'sonner';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { CURRENCIES } from '../../utils/currency';
import {
    formatMoney, formatDayMonth, formatDayMonthShort, formatDateLabel, formatTime, formatTimeRange, formatWeekdayShort,
} from '../../utils/format';
import { ruCountWord } from '../../utils/plural';
import { toastApiError } from '../../utils/errors';
import { suggestNextSession, toTbilisiNaive, utcNaiveToTbilisi } from '../../utils/crmNextSession';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { contactHref } from '../../utils/contactLinks';
import { STATUS } from '../../design/tokens';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { Skeleton } from '../../components/ui/Skeleton';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select, TextArea } from '../../components/ui/Field';
import { undoToast } from '../../components/ui/undoToast';
import { statusLabel } from '../../design/statuses';
import { paidLocally, partialPayment, sessionCurrencyOf, sessionDebt } from '../../utils/sessionMoney';
import { accountLabel, accountSelectValue, defaultPaymentAccount, lastPaymentAccountOf } from '../../utils/paymentAccounts';
import { parseMoneyInput, isMoneyInputBlank, MONEY_INPUT_ERROR } from '../mobile/admin/parseMoneyInput';

/**
 * Карточка клиента Psy-CRM на компьютере — вариант V1 «Что дальше»
 * (волна 3, пакет C; макет scratchpad/wave3/variants/project/Main.dc.html).
 *
 * Сверху то, что нужно перед сессией: следующая встреча (или «Записать на …»),
 * долг одной строкой (→ UnpaidSessionsSheet). Ниже две колонки: «История»
 * (сессия вместе с её заметками) и справа «Деньги» строкой текста, последние
 * оплаты и поле новой заметки. Раньше страница начиналась с «Всего оплачено»
 * 64 px и повторяла одни и те же цифры трижды (G5-05).
 *
 * Деньги здесь не пересчитываются: оплата — handleQuickPay / UnpaidSessionsSheet,
 * снятие оплаты и удаление платежа — прежние обработчики с прежними вопросами.
 */

const TZ = { timeZone: BATUMI_TZ };

/** Ширина элемента через ResizeObserver (первый замер — до отрисовки).
 *  Историю сессий раскладываем по ширине её колонки, а не окна: рядом
 *  сайдбар CRM (260 px) и колонка «Деньги». */
function useElementWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
    const [el, setEl] = useState<T | null>(null);
    const [w, setW] = useState(0);
    useLayoutEffect(() => {
        if (!el) return;
        setW(el.getBoundingClientRect().width);
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(entries => setW(entries[0].contentRect.width));
        ro.observe(el);
        return () => ro.disconnect();
    }, [el]);
    return [setEl, w];
}

/** Минимум сетки истории: 140 (дата) + 140 (статус) + 240 (сумма, кнопки) + 2×12. */
const HISTORY_TABLE_MIN = 544;
const HISTORY_COLUMNS = 'minmax(140px, 1fr) 140px 240px';

/** Сколько оплат видно сразу (G5-M4: раньше пятая строка обрезалась скроллом). */
const PAYMENTS_PREVIEW = 5;

/** «5 октября, 09:00» по Батуми (год — только если не текущий). */
function dayTime(d: Date | string): string {
    return `${formatDayMonth(d, { withYear: 'auto', ...TZ })}, ${formatTime(d, TZ)}`;
}

const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

// Подписи сессий — из общего словаря статусов (src/design/statuses.ts).
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
    ['PLANNED', 'COMPLETED', 'CANCELLED_CLIENT', 'CANCELLED_THERAPIST'].map(k => [k, statusLabel('session', k)]),
);

/** «вт, 7 окт.» — коротко для кнопки «Записать на …» (как в NewSessionSheet). */
function shortDayLabel(ymd: string): string {
    return `${formatWeekdayShort(ymd, { capitalize: false })}, ${formatDayMonthShort(ymd)}`;
}

/** «280 ₾» или «280 ₾ + 50 $» — по валютам, без пересчёта. */
function sumByCurrency(items: { amount: number; currency: string }[]): { label: string; single: boolean } {
    const by = new Map<string, number>();
    for (const it of items) by.set(it.currency, (by.get(it.currency) ?? 0) + it.amount);
    const parts = [...by.entries()].filter(([, v]) => v > 0);
    return {
        label: parts.map(([cur, v]) => formatMoney(v, { currency: cur })).join(' + '),
        single: parts.length <= 1,
    };
}

const cap: CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: GH.ink60 };
const hairline = `1px solid ${GH.ink10}`;
const textLink: CSSProperties = {
    background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
    fontFamily: GH_SANS, fontSize: 14, fontWeight: 600, color: GH.label,
    display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: 32,
};
const chip = (tone: 'ok' | 'muted'): CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', height: 22, padding: '0 8px', borderRadius: 8,
    fontSize: 12, fontWeight: 600, background: STATUS[tone].bg, color: STATUS[tone].fg,
});

export function CrmClientDetail() {
    const { clientId } = useParams<{ clientId: string }>();
    const navigate = useNavigate();
    const { updateSession, createNote, deleteNote, paymentAccounts } = useCrmStore();
    // «Просмотр как специалист» (админ смотрит чужую CRM): кнопки записи прячем.
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    // Одно окно подтверждения на всё, что стирает деньги или записи
    // (аудит 29.09, G5-07/G5-01): раньше часть мест спрашивала через
    // window.confirm, а часть не спрашивала вовсе.
    const { confirm: askConfirm } = useConfirmDialog();

    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [payments, setPayments] = useState<CrmPayment[]>([]);
    const [balance, setBalance] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [editingSession, setEditingSession] = useState<string | null>(null);
    const [editSessionPrice, setEditSessionPrice] = useState('');
    const [editSessionAccount, setEditSessionAccount] = useState('');
    const [editSessionCurrency, setEditSessionCurrency] = useState('GEL');
    const [sessionNoteId, setSessionNoteId] = useState<string | null>(null);
    const [sessionNoteText, setSessionNoteText] = useState('');
    const [savingSessionNote, setSavingSessionNote] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const [showSyncPicker, setShowSyncPicker] = useState(false);
    const [syncMonthsBack, setSyncMonthsBack] = useState(1);
    const [syncMonthsForward, setSyncMonthsForward] = useState(1);
    const [syncing, setSyncing] = useState(false);
    const [editingProfile, setEditingProfile] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '', phone: '', email: '', telegram: '', aliasCode: '', basePrice: '', currency: 'GEL', defaultAccount: 'cash', tags: '',
    });
    const [applyPriceTo, setApplyPriceTo] = useState<'none' | 'all_unpaid' | 'future_only'>('none');
    // Pending session-delete confirmation; when set, shows the modal asking
    // "this one only" vs "this and all future in the series" for recurring
    // sessions (one-off sessions get the simpler single-button confirm).
    const [pendingDelete, setPendingDelete] = useState<CrmSession | null>(null);
    // Загрузка упала ≠ «клиент не найден»: раньше при сбое сети карточка
    // писала «Клиент не найден», будто его удалили.
    const [loadError, setLoadError] = useState(false);
    // Волна 3: шторки «Новая сессия», «Долг клиента», «Перенести».
    const [newSessionOpen, setNewSessionOpen] = useState(false);
    const [unpaidOpen, setUnpaidOpen] = useState(false);
    const [rescheduleFor, setRescheduleFor] = useState<CrmSession | null>(null);
    const [payingId, setPayingId] = useState<string | null>(null);
    const [showAllPayments, setShowAllPayments] = useState(false);
    // Платёж, который правят карандашом в «Последних оплатах» (то же окно, что в блоке «Оплата»).
    const [editingPayment, setEditingPayment] = useState<CrmPayment | null>(null);
    const [pausing, setPausing] = useState(false);

    // Без имени клиента: вкладку видно при показе экрана, и она остаётся в истории браузера.
    useDocumentTitle('Клиент · Psy-CRM');

    const loadData = useCallback(async () => {
        if (!clientId) return;
        setLoading(true);
        setLoadError(false);
        try {
            const [c, s, n, p, b] = await Promise.all([
                crmApi.getClient(clientId),
                crmApi.getSessions({ clientId }),
                crmApi.getNotes(clientId),
                crmApi.getPayments({ clientId }),
                crmApi.getClientBalance(clientId),
            ]);
            setClient(c);
            setSessions(s);
            setNotes(n);
            setPayments(p);
            setBalance(b);
        } catch {
            setLoadError(true);
            toast.error('Не удалось загрузить данные клиента');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { loadData(); }, [loadData]);

    // Тихо перечитать после шторок: они пишут через crmApi и стор не
    // обновляют — без этого карточка показывала бы старый долг и историю.
    const reloadQuietly = useCallback(async () => {
        if (!clientId) return;
        try {
            const [c, s, n, p, b] = await Promise.all([
                crmApi.getClient(clientId),
                crmApi.getSessions({ clientId }),
                crmApi.getNotes(clientId),
                crmApi.getPayments({ clientId }),
                crmApi.getClientBalance(clientId),
            ]);
            setClient(c);
            setSessions(s);
            setNotes(n);
            setPayments(p);
            setBalance(b);
        } catch (e) {
            toastApiError(e, 'Не удалось обновить карточку. Обновите страницу');
        }
    }, [clientId]);

    const stats = useMemo(() => {
        const completed = sessions.filter(s => s.status === 'COMPLETED').length;
        const unpaid = sessions.filter(s => !s.isPaid && s.status === 'COMPLETED');
        const totalPaid = balance?.totalPaid ?? 0;
        const paidByCurrency: Record<string, number> = balance?.paidByCurrency ?? {};
        const debtByCurrency: Record<string, number> = balance?.debtByCurrency ?? {};
        return { completed, unpaidCount: unpaid.length, totalPaid, paidByCurrency, debtByCurrency };
    }, [sessions, client, balance]);

    // Заметки к сессии — все, а не только последняя: «История» показывает
    // сессию вместе с её заметками.
    const notesBySession = useMemo(() => {
        const map = new Map<string, CrmNote[]>();
        notes.forEach(n => {
            if (!n.sessionId) return;
            const list = map.get(n.sessionId) ?? [];
            list.push(n);
            map.set(n.sessionId, list);
        });
        return map;
    }, [notes]);

    // Платёж по сессии (на сессию один) — для блока «Оплата» в панели правки.
    const paymentBySession = useMemo(() => {
        const map = new Map<string, CrmPayment>();
        payments.forEach(p => { if (p.sessionId) map.set(p.sessionId, p); });
        return map;
    }, [payments]);

    // Split sessions into future and past
    const now = new Date();
    const futureSessions = useMemo(() =>
        sessions.filter(s => parseUTC(s.date) > now && s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST')
            .sort((a, b) => parseUTC(a.date).getTime() - parseUTC(b.date).getTime()),
        [sessions]
    );
    const pastSessions = useMemo(() =>
        sessions.filter(s => parseUTC(s.date) <= now)
            .sort((a, b) => parseUTC(b.date).getTime() - parseUTC(a.date).getTime()),
        [sessions]
    );
    // Прошлая состоявшаяся (не отменённая) — от неё «Записать на …».
    const lastHeld = useMemo(() => pastSessions.find(s => !CANCELLED.has(s.status)) ?? null, [pastSessions]);

    // Долг — тот же отбор, что у UnpaidSessionsSheet и сервера в mark-all-paid:
    // прошла, не оплачена, не отменена. Шторка покажет ровно эти сессии.
    const unpaidPast = useMemo(() => pastSessions.filter(s => !s.isPaid && !CANCELLED.has(s.status)), [pastSessions]);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleQuickPay = async (sessionId: string, account?: string) => {
        try {
            const result = await crmApi.quickPaySession(sessionId, account);
            setSessions(prev => prev.map(s => s.id === sessionId ? paidLocally(s) : s));
            const accLabel = result.account ? accountLabel(result.account, paymentAccounts) : '';
            // Сколько добавилось ЭТИМ нажатием (при доплате остатка — только он), а не весь платёж.
            const addedNow = result.added ?? result.amount;
            toast.success(`Оплата отмечена: ${formatMoney(addedNow, { currency: result.currency })}${accLabel ? ` · ${accLabel}` : ''}`);
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleUnmarkPaid = async (sessionId: string) => {
        // Снятие оплаты удаляет платёж целиком: у клиента снова появляется
        // долг, а повторная отметка запишет оплату сегодняшним числом. Раньше
        // это делал один клик по плашке «Оплачено» — теперь только через вопрос.
        // Одни слова для оплаты во всей CRM (G5-06): «Оплачено» — статус,
        // «Отметить оплату» — действие, «Снять отметку об оплате» — отмена.
        const s = sessions.find(x => x.id === sessionId);
        const what = s
            ? ` ${formatMoney(s.price ?? client?.basePrice ?? 0, { currency: s.currency ?? client?.currency })} за ${formatDayMonth(parseUTC(s.date))}`
            : '';
        const ok = await askConfirm({
            title: `Снять отметку об оплате${what}?`,
            message: 'Платёж удалится из истории оплат, и сессия снова станет долгом. Если потом отметить её заново, оплата запишется сегодняшним числом.',
            confirmLabel: 'Снять отметку об оплате',
            cancelLabel: 'Оставить',
            destructive: true,
        });
        if (!ok) return;
        try {
            await crmApi.unmarkPaidSession(sessionId);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPaid: false, paidAmount: undefined, remaining: undefined } : s));
            toast.success('Отметка об оплате снята');
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    // Волна 3: «Отметить все» теперь в UnpaidSessionsSheet (тот же markAllPaid
    // и тот же вопрос). Обработчик оставлен без изменений.
    const handleMarkAllPaid = async () => {
        if (!clientId || !client) return;
        const ok = await askConfirm({
            title: `Отметить оплату всех сессий с долгом (${stats.unpaidCount})?`,
            message: 'Будущие сессии не трогаем — только прошедшие без оплаты.',
            confirmLabel: `Отметить оплату (${stats.unpaidCount})`,
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        setMarkingAll(true);
        try {
            const result = await crmApi.markAllPaid(clientId);
            toast.success(`Оплата отмечена: ${result.marked}`);
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        } finally {
            setMarkingAll(false);
        }
    };

    const handleUpdateSession = async (sessionId: string, data: Partial<CrmSession>) => {
        try {
            const updated = await updateSession(sessionId, data);
            setSessions(prev => prev.map(s => s.id === sessionId ? updated : s));
            setEditingSession(null);
            toast.success('Сессия обновлена');
            // Цена, валюта и счёт двигают долг и баланс — перечитываем карточку.
            if ('price' in data || 'currency' in data || 'account' in data) reloadQuietly();
        } catch {
            // Ошибку уже показал стор (crmStore.updateSession) — второй тост не нужен.
        }
    };

    const handleAddSessionNote = async (sId: string) => {
        if (!clientId || !sessionNoteText.trim()) return;
        setSavingSessionNote(true);
        try {
            const note = await createNote({ clientId, sessionId: sId, content: sessionNoteText.trim() });
            setNotes(prev => [note, ...prev]);
            setSessionNoteId(null);
            setSessionNoteText('');
            toast.success('Заметка к сессии добавлена');
        } catch {
            // Ошибку уже показал стор (crmStore.createNote).
        } finally {
            setSavingSessionNote(false);
        }
    };

    const handleAddNote = async (content: string): Promise<boolean> => {
        if (!clientId) return false;
        try {
            // Только createNote: заметки шифруются на сервере. В client.notesText
            // (не шифруется) терапевтический текст не пишем.
            const note = await createNote({ clientId, content });
            setNotes(prev => [note, ...prev]);
            toast.success('Заметка сохранена');
            return true;
        } catch {
            // Ошибку уже показал стор (crmStore.createNote).
            return false;
        }
    };

    const openEditProfile = () => {
        if (!client) return;
        setEditForm({
            name: client.name,
            phone: client.phone || '',
            email: client.email || '',
            telegram: client.telegram || '',
            aliasCode: client.aliasCode || '',
            basePrice: String(client.basePrice || ''),
            currency: client.currency || 'GEL',
            defaultAccount: client.defaultAccount || 'cash',
            tags: (client.tags || []).join(', '),
        });
        setEditingProfile(true);
    };

    const handleSaveProfile = async () => {
        if (!clientId || !editForm.name.trim()) return;
        try {
            const tags = editForm.tags.split(',').map(t => t.trim()).filter(Boolean);
            const updated = await crmApi.updateClient(clientId, {
                name: editForm.name.trim(),
                phone: editForm.phone || undefined,
                email: editForm.email || undefined,
                telegram: editForm.telegram || undefined,
                aliasCode: editForm.aliasCode || undefined,
                basePrice: editForm.basePrice ? Number(editForm.basePrice) : undefined,
                currency: editForm.currency,
                defaultAccount: editForm.defaultAccount,
                tags: tags.length ? tags : [],
            }, applyPriceTo !== 'none' ? applyPriceTo : undefined);
            setClient(updated);
            setEditingProfile(false);
            setApplyPriceTo('none');
            toast.success('Профиль обновлён');
            if (applyPriceTo !== 'none') loadData();
        } catch (e: any) {
            toastApiError(e, 'Не удалось сохранить профиль. Проверьте поля и попробуйте ещё раз');
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        // Заметка стирается из базы насовсем (мягкого удаления нет) —
        // поэтому сначала спрашиваем и показываем, какую именно (G5-01).
        const note = notes.find(n => n.id === noteId);
        const ok = await askConfirm({
            title: 'Удалить заметку?',
            message: <NoteDeletePreview content={note?.content} />,
            confirmLabel: 'Удалить заметку',
            cancelLabel: 'Оставить',
            destructive: true,
        });
        if (!ok) return;
        try {
            await deleteNote(noteId);
            setNotes(prev => prev.filter(n => n.id !== noteId));
            toast.success('Заметка удалена');
        } catch {
            // Ошибку уже показал стор (crmStore.deleteNote) — второй тост не нужен.
        }
    };

    const handleDeletePayment = async (paymentId: string) => {
        const p = payments.find(x => x.id === paymentId);
        const ok = await askConfirm({
            title: p
                ? `Удалить оплату ${formatMoney(p.amount, { currency: p.currency })} от ${formatDayMonth(p.date || p.createdAt)}?`
                : 'Удалить оплату?',
            message: 'Если это единственная оплата сессии, сессия снова станет неоплаченной.',
            confirmLabel: 'Удалить оплату',
            cancelLabel: 'Оставить',
            destructive: true,
        });
        if (!ok) return;
        try {
            await crmApi.deletePayment(paymentId);
            toast.success('Оплата удалена');
            await loadData();
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    // G5-10: пауза вместо точки-выключателя в списке. Мягко (is_active=false),
    // ничего не удаляется; «Вернуть» в тосте — 5 секунд передумать.
    const handleTogglePause = async () => {
        if (!client || pausing) return;
        const wasActive = client.isActive;
        const setActive = async (active: boolean) => {
            if (active) await crmApi.updateClient(client.id, { isActive: true });
            else await crmApi.deleteClient(client.id); // без permanent — только пауза
            setClient(c => (c ? { ...c, isActive: active } : c));
        };
        setPausing(true);
        try {
            await setActive(!wasActive);
            undoToast(
                wasActive ? `${client.name} на паузе` : `${client.name} снова в работе`,
                () => setActive(wasActive).catch(e => toastApiError(e, 'Не удалось вернуть как было')),
            );
        } catch (e) {
            toastApiError(e, wasActive ? 'Не удалось поставить на паузу' : 'Не удалось вернуть в работу');
        } finally {
            setPausing(false);
        }
    };

    const payOne = async (sessionId: string, account?: string) => {
        if (payingId) return;
        setPayingId(sessionId);
        try {
            await handleQuickPay(sessionId, account);
        } finally {
            setPayingId(null);
        }
    };

    const runSync = async () => {
        if (!clientId) return;
        setSyncing(true);
        setShowSyncPicker(false);
        try {
            const r = await crmApi.syncClientHistory(clientId, syncMonthsBack, syncMonthsForward);
            toast.success(`Нашли в календаре: ${r.totalFound}, добавили: ${r.created}`);
            loadData();
        } catch (err: any) {
            toastApiError(err, 'Не удалось синхронизировать с календарём. Попробуйте ещё раз');
        } finally {
            setSyncing(false);
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading && !client) {
        // Скелет шапки и строк вместо крутилки посреди пустой страницы (G5-23).
        return (
            <div role="status" aria-busy="true" style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <span className="sr-only">Загружаем карточку клиента…</span>
                <Skeleton height={14} width={160} radius={0} />
                <Skeleton height={34} width="40%" radius={0} />
                <Skeleton height={72} radius={0} />
                {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} height={40} radius={0} />)}
            </div>
        );
    }

    if (!client && loadError) {
        return (
            <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
                <ErrorBar message="Не удалось загрузить карточку клиента" onRetry={loadData} />
            </div>
        );
    }

    if (!client) {
        return (
            <div className="text-center py-20" style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
                <p className="text-lg font-medium">Клиент не найден</p>
                <Link to="/crm/clients" style={{ ...textLink, marginTop: 16 }}>Вернуться к списку</Link>
            </div>
        );
    }

    const closeDelete = () => setPendingDelete(null);
    const handleDeleteSession = async (scope: 'this' | 'future') => {
        if (!pendingDelete) return;
        try {
            const res = await crmApi.deleteSession(pendingDelete.id, scope);
            toast.success(
                scope === 'future' && res.deleted > 1
                    ? `Удалено из серии: ${ruCountWord(res.deleted, ['сессия', 'сессии', 'сессий'])}`
                    : 'Сессия удалена',
            );
            loadData();
        } catch (e) {
            toastApiError(e, 'Не удалось удалить сессию. Попробуйте ещё раз');
        }
    };

    const next = futureSessions[0] ?? null;
    const contact = contactHref(client);
    const suggestion = suggestNextSession({ lastSession: lastHeld, client });
    // Долг по сессии — цена МИНУС внесённое (remaining с сервера), а не вся цена.
    const debt = sumByCurrency(unpaidPast.map(s => {
        const d = sessionDebt(s, client);
        return { amount: d.amount, currency: d.currency };
    }));
    const paidSessions = sessions.filter(s => s.isPaid).length;
    const paidEntries = Object.entries(stats.paidByCurrency).filter(([, v]) => v > 0);
    const paidLabel = paidEntries.length > 0
        ? paidEntries.map(([cur, amt]) => formatMoney(amt, { currency: cur })).join(' + ')
        : formatMoney(stats.totalPaid, { currency: client.currency });
    const sortedPayments = [...payments].sort(
        (a, b) => parseUTC(b.date || b.createdAt).getTime() - parseUTC(a.date || a.createdAt).getTime(),
    );
    const visiblePayments = showAllPayments ? sortedPayments : sortedPayments.slice(0, PAYMENTS_PREVIEW);
    // Счёт «по умолчанию» для новой оплаты: счёт клиента → счёт его последнего платежа → наличные.
    const defaultAccount = defaultPaymentAccount(paymentAccounts, client.defaultAccount, lastPaymentAccountOf(payments));

    const goBookRoom = (s: CrmSession) => navigate('/dashboard/bookings', {
        state: { crmMode: { sessionId: s.id, clientId: client.id, clientName: client.name, date: /Z$|[+-]\d{2}:\d{2}$/.test(s.date) ? s.date : s.date + 'Z', duration: s.durationMinutes } },
    });

    return (
        <>
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            <PageHeader
                back
                backLabel="Клиенты"
                backTo="/crm/clients"
                title={client.name}
                description={
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 14 }}>
                        {client.aliasCode && <span style={{ fontFamily: GH_MONO, color: GH.ink }}>#{client.aliasCode}</span>}
                        <span style={chip(client.isActive ? 'ok' : 'muted')}>{client.isActive ? 'В работе' : 'На паузе'}</span>
                        {client.tags?.map(tag => <span key={tag} style={chip('muted')}>{tag}</span>)}
                        {client.phone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={12} aria-hidden="true" />{client.phone}</span>}
                        {client.telegram && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Send size={12} aria-hidden="true" />{client.telegram}</span>}
                        {client.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={12} aria-hidden="true" />{client.email}</span>}
                    </span>
                }
                actions={
                    <>
                        {contact && (
                            contact.href.startsWith('tel:') ? (
                                <a href={contact.href} className="ui-btn ui-btn--secondary">
                                    <Phone size={16} aria-hidden="true" /> {contact.label}
                                </a>
                            ) : (
                                <a href={contact.href} target="_blank" rel="noopener noreferrer" className="ui-btn ui-btn--secondary" aria-label={contact.label}>
                                    <Send size={16} aria-hidden="true" /> Написать
                                </a>
                            )
                        )}
                        {!viewingOther && (
                            <>
                                <Button variant="secondary" icon={<Pencil size={16} aria-hidden="true" />} onClick={openEditProfile}>Изменить</Button>
                                <Button variant="quiet" loading={pausing} onClick={handleTogglePause}>
                                    {client.isActive ? 'Поставить на паузу' : 'Вернуть в работу'}
                                </Button>
                            </>
                        )}
                    </>
                }
            />

            {loadError && (
                <ErrorBar message="Не удалось обновить карточку" onRetry={loadData} retrying={loading} className="mb-4" />
            )}

            {/* ── Следующая встреча ── */}
            <section
                aria-label="Следующая встреча"
                style={{ border: `1.5px solid ${GH.ink}`, background: GH.card, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}
            >
                <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                    <div style={cap}>Следующая встреча</div>
                    {next ? (
                        <>
                            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                                {formatDateLabel(parseUTC(next.date), { capitalize: true, ...TZ })}
                                {' · '}
                                <span className="num">
                                    {formatTimeRange(parseUTC(next.date), new Date(parseUTC(next.date).getTime() + (next.durationMinutes || 60) * 60000), TZ)}
                                </span>
                                {' · '}
                                <span style={{ fontWeight: 400, color: next.isBooked ? GH.ink : STATUS.pending.fg }}>
                                    {next.isBooked ? 'Кабинет забронирован' : 'Без кабинета'}
                                </span>
                            </div>
                            {futureSessions.length > 1 && (
                                <div style={{ fontSize: 14, color: GH.ink60, marginTop: 4 }}>
                                    Дальше: {futureSessions.slice(1, 4).map(s => formatDayMonth(parseUTC(s.date), TZ)).join(', ')}
                                    {futureSessions.length > 4 ? ` и ещё ${futureSessions.length - 4}` : ''}
                                </div>
                            )}
                        </>
                    ) : (
                        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                            Следующей нет
                            {lastHeld && (
                                <span style={{ fontWeight: 400, color: GH.ink60 }}> · была {formatDayMonth(parseUTC(lastHeld.date), { withYear: 'auto', ...TZ })}</span>
                            )}
                        </div>
                    )}
                </div>
                {!viewingOther && (next ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button variant="secondary" onClick={() => setRescheduleFor(next)}>Перенести</Button>
                        {!next.isBooked && <Button variant="secondary" onClick={() => goBookRoom(next)}>Кабинет</Button>}
                    </div>
                ) : (
                    <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNewSessionOpen(true)}>
                        Записать на {shortDayLabel(suggestion.date)}, {suggestion.time}
                    </Button>
                ))}
            </section>

            {/* ── Долг — только если он есть ── */}
            {unpaidPast.length > 0 && debt.label && (
                <section
                    aria-label="Долг клиента"
                    style={{ background: STATUS.pending.bg, padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}
                >
                    <div style={{ flex: '1 1 280px', fontSize: 15, color: STATUS.pending.fg }}>
                        <b>Долг {debt.label}</b>
                        {' · '}{ruCountWord(unpaidPast.length, ['сессия', 'сессии', 'сессий'])}
                        {unpaidPast.length <= 3 && (
                            <>: {unpaidPast.map(s => formatDayMonth(parseUTC(s.date), TZ)).join(', ')}</>
                        )}
                    </div>
                    {!viewingOther && (
                        <Button variant="primary" onClick={() => setUnpaidOpen(true)}>
                            {debt.single ? `Отметить оплату · ${debt.label}` : 'Отметить оплату'}
                        </Button>
                    )}
                </section>
            )}

            {/* ── Две колонки: история | деньги и заметка ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, marginTop: 24, alignItems: 'flex-start' }}>
                <HistorySection
                    client={client}
                    pastSessions={pastSessions}
                    generalNotes={notes.filter(n => !n.sessionId)}
                    notesBySession={notesBySession}
                    viewingOther={viewingOther}
                    syncing={syncing}
                    onOpenSync={() => setShowSyncPicker(true)}
                    onNewSession={() => setNewSessionOpen(true)}
                    payingId={payingId}
                    onPay={payOne}
                    handleUnmarkPaid={handleUnmarkPaid}
                    handleDeleteNote={handleDeleteNote}
                    editingSession={editingSession}
                    setEditingSession={setEditingSession}
                    editSessionPrice={editSessionPrice}
                    setEditSessionPrice={setEditSessionPrice}
                    editSessionAccount={editSessionAccount}
                    setEditSessionAccount={setEditSessionAccount}
                    editSessionCurrency={editSessionCurrency}
                    setEditSessionCurrency={setEditSessionCurrency}
                    paymentBySession={paymentBySession}
                    defaultAccount={defaultAccount}
                    onPaymentChanged={reloadQuietly}
                    handleUpdateSession={handleUpdateSession}
                    setPendingDelete={setPendingDelete}
                    sessionNoteId={sessionNoteId}
                    setSessionNoteId={setSessionNoteId}
                    sessionNoteText={sessionNoteText}
                    setSessionNoteText={setSessionNoteText}
                    savingSessionNote={savingSessionNote}
                    handleAddSessionNote={handleAddSessionNote}
                />

                <aside style={{ flex: '1 1 280px', maxWidth: 360, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <div style={{ ...cap, marginBottom: 8 }}>Деньги</div>
                        <div style={{ fontSize: 14, lineHeight: 1.6 }}>
                            Ставка <b className="num">{formatMoney(client.basePrice, { currency: client.currency })}</b>
                            {' · '}оплачено всего <b className="num">{paidLabel}</b>
                            {paidSessions > 0 && <> за {ruCountWord(paidSessions, ['сессию', 'сессии', 'сессий'])}</>}
                        </div>
                    </div>

                    <div style={{ borderTop: hairline, paddingTop: 12 }}>
                        <div style={{ ...cap, marginBottom: 6 }}>Последние оплаты</div>
                        {sortedPayments.length === 0 ? (
                            <div style={{ fontSize: 14, color: GH.ink60, padding: '4px 0' }}>Оплат пока нет.</div>
                        ) : (
                            <>
                                {visiblePayments.map(p => (
                                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, padding: '2px 0' }}>
                                        <span style={{ flex: 1, minWidth: 0 }}>
                                            {formatDayMonth(p.date || p.createdAt, { withYear: 'auto' })}
                                            {' · '}{accountLabel(p.account, paymentAccounts)}
                                        </span>
                                        <span className="num" style={{ whiteSpace: 'nowrap' }}>{formatMoney(p.amount, { currency: p.currency })}</span>
                                        {!viewingOther && (
                                            <button
                                                onClick={() => setEditingPayment(p)}
                                                title="Изменить оплату"
                                                aria-label={`Изменить оплату ${formatMoney(p.amount, { currency: p.currency })}`}
                                                style={{
                                                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, flexShrink: 0,
                                                }}
                                            >
                                                <Pencil size={13} aria-hidden="true" />
                                            </button>
                                        )}
                                        {!viewingOther && (
                                            <button
                                                onClick={() => handleDeletePayment(p.id)}
                                                title="Удалить оплату"
                                                aria-label={`Удалить оплату ${formatMoney(p.amount, { currency: p.currency })}`}
                                                style={{
                                                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, flexShrink: 0,
                                                }}
                                            >
                                                <Trash2 size={13} aria-hidden="true" />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {sortedPayments.length > PAYMENTS_PREVIEW && (
                                    <button type="button" style={textLink} onClick={() => setShowAllPayments(v => !v)} aria-expanded={showAllPayments}>
                                        {showAllPayments ? 'Свернуть' : `Показать все (${sortedPayments.length})`}
                                    </button>
                                )}
                            </>
                        )}
                    </div>

                    {!viewingOther && (
                        <div style={{ borderTop: hairline, paddingTop: 12 }}>
                            <NoteComposer onSave={handleAddNote} />
                        </div>
                    )}
                </aside>
            </div>
        </div>

        <DeleteSessionModal
            isOpen={!!pendingDelete}
            onClose={closeDelete}
            onConfirm={handleDeleteSession}
            isRecurring={Boolean(pendingDelete?.recurringGroupId)}
            label={pendingDelete ? `${client?.name || 'Клиент'} — ${dayTime(parseUTC(pendingDelete.date))}` : undefined}
        />

        <NewSessionSheet
            open={newSessionOpen}
            onClose={() => setNewSessionOpen(false)}
            client={client}
            lastSession={lastHeld}
            onCreated={() => { setNewSessionOpen(false); reloadQuietly(); }}
        />

        <UnpaidSessionsSheet
            open={unpaidOpen}
            onClose={() => setUnpaidOpen(false)}
            client={client}
            sessions={sessions}
            onChanged={reloadQuietly}
        />

        {/* Изменить оплату — то же окно, что в блоке «Оплата» панели сессии. */}
        {editingPayment && (
            <PaymentEditSheet
                payment={editingPayment}
                clientCurrency={client.currency}
                onClose={() => setEditingPayment(null)}
                onSaved={async () => { setEditingPayment(null); await reloadQuietly(); }}
            />
        )}

        <RescheduleSheet
            session={rescheduleFor}
            clientName={client.name}
            onClose={() => setRescheduleFor(null)}
            onDone={() => { setRescheduleFor(null); reloadQuietly(); }}
        />

        {/* Изменить профиль — шторка вместо формы посреди страницы (X4-04/X4-05). */}
        <Sheet
            open={editingProfile}
            onClose={() => { setEditingProfile(false); setApplyPriceTo('none'); }}
            title="Изменить клиента"
            width={640}
            footer={
                <>
                    <Button onClick={handleSaveProfile} disabled={!editForm.name.trim()} icon={<Check size={16} aria-hidden="true" />}>Сохранить</Button>
                    <Button variant="secondary" onClick={() => { setEditingProfile(false); setApplyPriceTo('none'); }}>Не сохранять</Button>
                </>
            }
        >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <Field label="Имя" required>
                    <Input kind="name" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                </Field>
                <Field label="Телефон" optional>
                    <Input kind="phone" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+995…" />
                </Field>
                <Field label="E-mail" optional>
                    <Input kind="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                </Field>
                <Field label="Telegram" optional>
                    <Input value={editForm.telegram} onChange={e => setEditForm(f => ({ ...f, telegram: e.target.value }))} placeholder="@username" />
                </Field>
                <Field label="Код клиента" hint="4 цифры: в календаре пишите «Анна #4821»" optional>
                    <Input kind="integer" value={editForm.aliasCode} onChange={e => setEditForm(f => ({ ...f, aliasCode: e.target.value }))} maxLength={4} />
                </Field>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <Field label="Ставка" className="flex-1">
                        <Input kind="money" value={editForm.basePrice} onChange={e => setEditForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="0" />
                    </Field>
                    <Field label="Валюта">
                        <Select value={editForm.currency} onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}>
                            {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                        </Select>
                    </Field>
                </div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500 }}>
                    Счёт по умолчанию
                    <AccountSelect className="ui-input" value={editForm.defaultAccount} onChange={(v) => setEditForm(f => ({ ...f, defaultAccount: v }))} />
                </label>
                <Field label="Теги" hint="Через запятую: тревога, пары, онлайн" optional>
                    <Input value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} />
                </Field>
            </div>
            {(editForm.basePrice !== String(client?.basePrice || '') || editForm.currency !== (client?.currency || 'GEL') || editForm.defaultAccount !== (client?.defaultAccount || 'cash')) && (
                <fieldset style={{ marginTop: 16, padding: 12, background: STATUS.pending.bg, border: 'none' }}>
                    <legend style={{ fontSize: 14, fontWeight: 600, color: STATUS.pending.fg, padding: 0, float: 'left', marginBottom: 8, width: '100%' }}>Применить к существующим сессиям:</legend>
                    {[
                        { value: 'none' as const, label: 'Только для новых сессий' },
                        { value: 'future_only' as const, label: 'Ко всем запланированным (незавершённым)' },
                        { value: 'all_unpaid' as const, label: 'Ко всем неоплаченным' },
                    ].map(opt => (
                        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: STATUS.pending.fg, cursor: 'pointer', minHeight: 32 }}>
                            <input type="radio" name="ghApplyPriceTo" checked={applyPriceTo === opt.value} onChange={() => setApplyPriceTo(opt.value)} />
                            {opt.label}
                        </label>
                    ))}
                </fieldset>
            )}
        </Sheet>

        {/* Синхронизация истории с календарём — на общем Sheet (X4-04). */}
        <Sheet
            open={showSyncPicker}
            onClose={() => setShowSyncPicker(false)}
            title="Подтянуть сессии из календаря"
            description="Найдём события с кодом клиента в Google Календаре и добавим недостающие сессии."
            width={420}
            footer={
                <>
                    <Button onClick={runSync} loading={syncing} icon={<RefreshCw size={16} aria-hidden="true" />}>Синхронизировать</Button>
                    <Button variant="secondary" onClick={() => setShowSyncPicker(false)}>Не сейчас</Button>
                </>
            }
        >
            <div style={{ display: 'grid', gap: 16 }}>
                <Field label="Назад">
                    <Select value={syncMonthsBack} onChange={e => setSyncMonthsBack(Number(e.target.value))}>
                        {[1, 3, 6, 12, 24, 60].map(m => <option key={m} value={m}>{m === 1 ? '1 месяц' : m === 3 ? '3 месяца' : m === 6 ? '6 месяцев' : m === 12 ? '1 год' : m === 24 ? '2 года' : '5 лет'}</option>)}
                    </Select>
                </Field>
                <Field label="Вперёд">
                    <Select value={syncMonthsForward} onChange={e => setSyncMonthsForward(Number(e.target.value))}>
                        {[1, 3, 6, 12].map(m => <option key={m} value={m}>{m === 1 ? '1 месяц' : m === 3 ? '3 месяца' : m === 6 ? '6 месяцев' : '1 год'}</option>)}
                    </Select>
                </Field>
            </div>
        </Sheet>
        </>
    );
}


// ── История: сессии вместе с их заметками + общие заметки ────────────────────

interface HistoryProps {
    client: CrmClient;
    pastSessions: CrmSession[];
    generalNotes: CrmNote[];
    notesBySession: Map<string, CrmNote[]>;
    viewingOther: boolean;
    syncing: boolean;
    onOpenSync: () => void;
    onNewSession: () => void;
    payingId: string | null;
    onPay: (sessionId: string, account?: string) => Promise<void>;
    handleUnmarkPaid: (sessionId: string) => Promise<void>;
    handleDeleteNote: (noteId: string) => Promise<void>;
    editingSession: string | null;
    setEditingSession: (id: string | null) => void;
    editSessionPrice: string;
    setEditSessionPrice: (v: string) => void;
    editSessionAccount: string;
    setEditSessionAccount: (v: string) => void;
    editSessionCurrency: string;
    setEditSessionCurrency: (v: string) => void;
    /** Платёж каждой сессии — для блока «Оплата» в панели правки. */
    paymentBySession: Map<string, CrmPayment>;
    /** Счёт по умолчанию для новой оплаты (клиента → последнего платежа → наличные). */
    defaultAccount: string;
    onPaymentChanged: () => void | Promise<void>;
    handleUpdateSession: (sessionId: string, data: Partial<CrmSession>) => Promise<void>;
    setPendingDelete: (s: CrmSession | null) => void;
    sessionNoteId: string | null;
    setSessionNoteId: (id: string | null) => void;
    sessionNoteText: string;
    setSessionNoteText: (v: string) => void;
    savingSessionNote: boolean;
    handleAddSessionNote: (sId: string) => Promise<void>;
}

type HistoryItem =
    | { kind: 'session'; t: number; session: CrmSession }
    | { kind: 'note'; t: number; note: CrmNote };

function HistorySection(props: HistoryProps) {
    const {
        client, pastSessions, generalNotes, notesBySession, viewingOther, syncing, onOpenSync, onNewSession,
        payingId, onPay, handleUnmarkPaid, handleDeleteNote,
        editingSession, setEditingSession, editSessionPrice, setEditSessionPrice,
        editSessionAccount, setEditSessionAccount, editSessionCurrency, setEditSessionCurrency,
        paymentBySession, defaultAccount, onPaymentChanged, handleUpdateSession, setPendingDelete,
        sessionNoteId, setSessionNoteId, sessionNoteText, setSessionNoteText, savingSessionNote, handleAddSessionNote,
    } = props;

    const paymentAccounts = useCrmStore(s => s.paymentAccounts);

    // Шапка и строки — одна сетка с одинаковыми колонками и зазором, чтобы
    // статус не наезжал на сумму (M4). Если колонка уже минимума сетки
    // (окно ~1024–1300 с сайдбаром) — одна колонка: дата, статус, сумма.
    const [historyRef, historyW] = useElementWidth<HTMLDivElement>();
    const historyStacked = historyW > 0 && historyW < HISTORY_TABLE_MIN;
    const historyColumns = historyStacked ? '1fr' : HISTORY_COLUMNS;

    const items = useMemo<HistoryItem[]>(() => {
        const list: HistoryItem[] = [
            ...pastSessions.map(session => ({ kind: 'session' as const, t: parseUTC(session.date).getTime(), session })),
            ...generalNotes.map(note => ({ kind: 'note' as const, t: parseUTC(note.createdAt).getTime(), note })),
        ];
        return list.sort((a, b) => b.t - a.t);
    }, [pastSessions, generalNotes]);

    // Цена в панели правки: общий разбор суммы («1 280,50»), пустое поле не сохраняем.
    const parsedEditPrice = parseMoneyInput(editSessionPrice);
    const editPriceError = !isMoneyInputBlank(editSessionPrice) && parsedEditPrice === null ? MONEY_INPUT_ERROR : undefined;
    // Текущая валюта сессии выбираема, даже если её убрали из списка валют.
    const currencyChoices = CURRENCIES.some(c => c.code === editSessionCurrency)
        ? CURRENCIES
        : [...CURRENCIES, { code: editSessionCurrency, symbol: '', label: editSessionCurrency }];

    const noteBlock = (note: CrmNote, withDate: boolean) => (
        <div key={note.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 6 }}>
            <div style={{ flex: 1, minWidth: 0, maxWidth: '72ch' }}>
                {withDate && (
                    <div style={{ ...cap, marginBottom: 2 }}>Заметка · {dayTime(parseUTC(note.createdAt))}</div>
                )}
                <p style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap', margin: 0, color: GH.ink80, wordBreak: 'break-word' }}>
                    {note.content}
                </p>
                {note.tags && <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>{note.tags}</div>}
            </div>
            {!viewingOther && (
                // Зона нажатия 32×32: корзину не промахнуть (G5-01).
                <button
                    onClick={() => handleDeleteNote(note.id)}
                    title="Удалить заметку"
                    aria-label="Удалить заметку"
                    style={{
                        background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60,
                        width: 32, height: 32,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = GH.danger)}
                    onMouseLeave={e => (e.currentTarget.style.color = GH.ink60)}
                >
                    <Trash2 size={13} aria-hidden="true" />
                </button>
            )}
        </div>
    );

    return (
        <section ref={historyRef} aria-label="История" style={{ flex: '999 1 520px', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                <h2 style={{ ...cap, margin: 0 }}>История</h2>
                {!viewingOther && (
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <button type="button" style={{ ...textLink, color: GH.ink60, fontWeight: 500 }} onClick={onOpenSync} disabled={syncing}>
                            <RefreshCw size={14} aria-hidden="true" className={syncing ? 'animate-spin' : undefined} />
                            {syncing ? 'Синхронизируем…' : 'Из календаря'}
                        </button>
                        <button type="button" style={textLink} onClick={onNewSession}>
                            <Plus size={14} aria-hidden="true" /> Новая сессия
                        </button>
                    </div>
                )}
            </div>

            {items.length === 0 ? (
                <div style={{ padding: '24px 0', color: GH.ink60, fontSize: 14, borderTop: hairline }}>
                    Здесь появятся прошедшие сессии и заметки.
                </div>
            ) : (
                <div style={{ borderTop: hairline }}>
                    {items.map(item => {
                        if (item.kind === 'note') {
                            return (
                                <div key={`n-${item.note.id}`} style={{ padding: '12px 0', borderBottom: hairline }}>
                                    {noteBlock(item.note, true)}
                                </div>
                            );
                        }
                        const session = item.session;
                        const dt = parseUTC(session.date);
                        const sessionPrice = session.price ?? client.basePrice;
                        const isCancelled = CANCELLED.has(session.status);
                        const isEditing = editingSession === session.id;
                        const sNotes = notesBySession.get(session.id) ?? [];
                        // Частично оплачена: внесено, но не всё — долг равен остатку.
                        const partial = partialPayment(session, client);

                        return (
                            <div key={session.id} style={{ padding: '12px 0', borderBottom: hairline }}>
                                <div style={{
                                    display: 'grid', gridTemplateColumns: historyColumns, columnGap: 12, rowGap: 6,
                                    alignItems: 'center',
                                }}>
                                    {/* Дата и время */}
                                    <div style={{ minWidth: 0 }}>
                                        <b style={{ fontSize: 15, fontWeight: 600 }}>{formatDateLabel(dt, { capitalize: true, ...TZ })}</b>
                                        <span className="num" style={{ fontSize: 13, color: GH.ink60, marginLeft: 8, whiteSpace: 'nowrap' }}>
                                            {formatTime(dt, TZ)}{session.durationMinutes ? ` · ${session.durationMinutes} мин` : ''}
                                        </span>
                                    </div>

                                    {/* Статус */}
                                    <div style={{ minWidth: 0 }}>
                                        <StatusBadge kind="session" status={session.status} audience="staff" className="whitespace-nowrap" />
                                    </div>

                                    {/* Сумма и действия */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: historyStacked ? 'flex-start' : 'flex-end', gap: 8, minWidth: 0 }}>
                                        <span className="num" style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap' }}>
                                            {formatMoney(sessionPrice, { currency: session.currency ?? client.currency })}
                                        </span>
                                        {!isCancelled && (
                                            session.isPaid ? (
                                                // «Оплачено» — только статус, не кнопка: раньше
                                                // один клик по нему удалял платёж (G5-07). Снять
                                                // оплату — отдельный крестик с подтверждением.
                                                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                                                    <StatusBadge kind="payment" status="paid" audience="staff" />
                                                    {!viewingOther && (
                                                    <button
                                                        onClick={() => handleUnmarkPaid(session.id)}
                                                        title="Снять отметку об оплате"
                                                        aria-label="Снять отметку об оплате"
                                                        style={{
                                                            width: 32, height: 32,
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60,
                                                        }}
                                                        onMouseEnter={e => (e.currentTarget.style.color = GH.danger)}
                                                        onMouseLeave={e => (e.currentTarget.style.color = GH.ink60)}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                    )}
                                                </span>
                                            ) : (
                                                !viewingOther && (
                                                    <Button
                                                        size="compact"
                                                        variant="secondary"
                                                        loading={payingId === session.id}
                                                        disabled={!!payingId && payingId !== session.id}
                                                        onClick={() => onPay(session.id, isEditing ? editSessionAccount : undefined)}
                                                    >
                                                        {partial ? `Доплатить ${formatMoney(partial.remaining, { currency: partial.currency })}` : 'Отметить оплату'}
                                                    </Button>
                                                )
                                            )
                                        )}
                                        {!viewingOther && (
                                            <button
                                                onClick={() => {
                                                    if (isEditing) {
                                                        setEditingSession(null);
                                                    } else {
                                                        setEditingSession(session.id);
                                                        setEditSessionPrice(String(session.price ?? client.basePrice));
                                                        setEditSessionAccount(accountSelectValue(session.account ?? defaultAccount, paymentAccounts));
                                                        setEditSessionCurrency(sessionCurrencyOf(session, client));
                                                    }
                                                }}
                                                aria-label="Изменить сессию"
                                                aria-expanded={isEditing}
                                                title="Изменить сессию"
                                                style={{
                                                    width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    background: isEditing ? GH.ink5 : 'transparent',
                                                    border: 'none', cursor: 'pointer',
                                                    color: isEditing ? GH.accent : GH.ink60, flexShrink: 0,
                                                }}
                                            >
                                                <Pencil size={13} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {partial && !isEditing && (
                                    <div className="num" style={{ fontSize: 13, color: GH.ink60, marginTop: 4 }}>
                                        {`Оплачено ${formatMoney(partial.paid, { currency: partial.currency })} из ${formatMoney(partial.price, { currency: partial.currency })}`}
                                        {` · долг ${formatMoney(partial.remaining, { currency: partial.currency })}`}
                                    </div>
                                )}

                                {/* Заметки этой сессии */}
                                {sNotes.map(n => noteBlock(n, false))}

                                {!viewingOther && (sessionNoteId === session.id ? (
                                    <div style={{ marginTop: 8, maxWidth: '72ch' }}>
                                        <Field label="Заметка к сессии">
                                            <TextArea
                                                value={sessionNoteText}
                                                onChange={e => setSessionNoteText(e.target.value)}
                                                rows={3}
                                                autoFocus
                                            />
                                        </Field>
                                        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                                            <Button
                                                size="compact"
                                                loading={savingSessionNote}
                                                disabled={!sessionNoteText.trim()}
                                                onClick={() => handleAddSessionNote(session.id)}
                                            >
                                                Сохранить заметку
                                            </Button>
                                            <Button size="compact" variant="quiet" onClick={() => setSessionNoteId(null)}>Не сохранять</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        style={{ ...textLink, color: GH.ink60, fontWeight: 500, fontSize: 13 }}
                                        onClick={() => { setSessionNoteId(session.id); setSessionNoteText(''); }}
                                    >
                                        <StickyNote size={13} aria-hidden="true" /> Заметка к сессии
                                    </button>
                                ))}

                                {/* Правка цены, валюты, счёта и статуса */}
                                {isEditing && (() => {
                                    // Платёж по сессии уже есть: «Счёт для оплаты» тут менял бы счёт СЕССИИ,
                                    // а в «Последних оплатах» стоит счёт ПЛАТЕЖА (01.10 владелец менял поле
                                    // и не понимал, почему платёж остался на Cash). Поэтому при платеже
                                    // поля нет — счёт правится в блоке «Оплата» сверху.
                                    const payment = paymentBySession.get(session.id);
                                    const sessionAccountStart = accountSelectValue(session.account ?? defaultAccount, paymentAccounts);
                                    return (
                                    <div style={{ marginTop: 8, padding: 12, background: GH.sunken, border: hairline }}>
                                        {payment && (
                                            <div style={{ marginBottom: 10 }}>
                                                <SessionPaymentBlock
                                                    session={session}
                                                    client={client}
                                                    payment={payment}
                                                    readOnly={viewingOther}
                                                    onChanged={onPaymentChanged}
                                                />
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                            <Field label="Цена" className="flex-1" error={editPriceError}>
                                                <Input kind="money" value={editSessionPrice} onChange={e => setEditSessionPrice(e.target.value)} />
                                            </Field>
                                            <Field label="Валюта" className="flex-1">
                                                <Select value={editSessionCurrency} onChange={e => setEditSessionCurrency(e.target.value)}>
                                                    {currencyChoices.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                                                </Select>
                                            </Field>
                                            {!payment && (
                                                <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 500, minWidth: 160 }}>
                                                    Счёт для оплаты
                                                    <AccountSelect className="ui-input" value={editSessionAccount} onChange={setEditSessionAccount} />
                                                </label>
                                            )}
                                            <Button
                                                size="compact"
                                                disabled={parsedEditPrice === null}
                                                onClick={() => {
                                                    if (parsedEditPrice === null) return;
                                                    // Валюту и счёт шлём, только если их поменяли: иначе правка
                                                    // одной цены «замораживала» бы счёт клиента по умолчанию
                                                    // (и счёт, выбранный позже при «Отметить оплату», игнорировался).
                                                    // Счёт шлём лишь пока платежа нет: после оплаты он правится
                                                    // в блоке «Оплата», а здесь молча менять счёт сессии нельзя.
                                                    const patch: Partial<CrmSession> = { price: parsedEditPrice };
                                                    if (editSessionCurrency !== sessionCurrencyOf(session, client)) patch.currency = editSessionCurrency;
                                                    if (!payment && accountSelectValue(editSessionAccount, paymentAccounts) !== sessionAccountStart) patch.account = editSessionAccount;
                                                    handleUpdateSession(session.id, patch);
                                                }}
                                            >
                                                Сохранить
                                            </Button>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: hairline }}>
                                            {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                                <button
                                                    key={key}
                                                    onClick={() => handleUpdateSession(session.id, { status: key as CrmSession['status'] })}
                                                    aria-pressed={session.status === key}
                                                    style={{
                                                        fontSize: 13, padding: '0 10px', minHeight: 32,
                                                        background: session.status === key ? GH.ink : 'transparent',
                                                        color: session.status === key ? GH.paper : GH.ink,
                                                        border: session.status === key ? `1px solid ${GH.ink}` : hairline,
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                            <button
                                                onClick={() => setPendingDelete(session)}
                                                style={{
                                                    fontSize: 13, padding: '0 10px', minHeight: 32,
                                                    background: 'transparent', border: `1px solid ${GH.danger}`,
                                                    color: GH.danger, cursor: 'pointer', marginLeft: 'auto',
                                                }}
                                            >
                                                Удалить сессию
                                            </button>
                                        </div>
                                    </div>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}


// ── Новая заметка к клиенту (правая колонка) ─────────────────────────────────

function NoteComposer({ onSave }: { onSave: (content: string) => Promise<boolean> }) {
    const [content, setContent] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        const text = content.trim();
        if (!text || saving) return;
        setSaving(true);
        try {
            if (await onSave(text)) setContent('');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div>
            <Field label="Заметка" hint="Видите только вы. Хранится зашифрованной.">
                <TextArea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    rows={3}
                    placeholder="Новая заметка к клиенту"
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }}
                />
            </Field>
            {content.trim() && (
                <div style={{ marginTop: 8 }}>
                    <Button size="compact" loading={saving} onClick={submit}>Сохранить заметку</Button>
                </div>
            )}
        </div>
    );
}


// ── «Перенести» следующую встречу ───────────────────────────────────────────

function RescheduleSheet({ session, clientName, onClose, onDone }: {
    session: CrmSession | null;
    clientName: string;
    onClose: () => void;
    onDone: () => void;
}) {
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!session) return;
        const wall = utcNaiveToTbilisi(session.date);
        setDate(wall?.date ?? '');
        setTime(wall?.time ?? '');
        setError(null);
    }, [session]);

    const submit = async () => {
        if (!session || saving) return;
        let naive: string;
        try {
            // Сервер ждёт naive-время по Батуми и сам переводит в UTC
            // (как перенос в шторке сессии на телефоне). Без toISOString().
            naive = toTbilisiNaive(date, time);
        } catch (e: any) {
            setError(e?.message || 'Проверьте дату и время');
            return;
        }
        setSaving(true);
        try {
            // crmApi напрямую: если кабинет в новое время занят, сервер скажет
            // это словами — стор показал бы только «Не удалось обновить сессию».
            await crmApi.updateSession(session.id, { date: naive });
            toast.success(`Перенесли на ${formatDayMonth(date)}, ${time}`);
            onDone();
        } catch (e) {
            toastApiError(e, 'Не удалось перенести сессию. Попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    const from = session ? dayTime(parseUTC(session.date)) : '';
    return (
        <Sheet
            open={!!session}
            onClose={onClose}
            title="Перенести сессию"
            description={session ? `${clientName}, сейчас — ${from}.${session.isBooked ? ' Бронь кабинета переедет вместе с сессией, если он свободен.' : ''}` : undefined}
            width={420}
            footer={
                <>
                    <Button onClick={submit} loading={saving} disabled={!date || !time}>
                        {date && time ? `Перенести на ${formatDayMonth(date)}, ${time}` : 'Перенести'}
                    </Button>
                    <Button variant="secondary" onClick={onClose}>Оставить как есть</Button>
                </>
            }
        >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Дата" error={error ?? undefined}>
                    <Input kind="date" value={date} onChange={e => { setDate(e.target.value); setError(null); }} />
                </Field>
                <Field label="Время">
                    <Input kind="time" value={time} onChange={e => { setTime(e.target.value); setError(null); }} />
                </Field>
            </div>
        </Sheet>
    );
}
