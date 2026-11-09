import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
    Phone, MessageCircle, Mail, Plus, CalendarPlus, MapPin,
    CheckCircle2, Clock, XCircle, Wallet, FileText, Pencil, PauseCircle,
} from 'lucide-react';
import { crmApi, type CrmClient, type CrmSession, type CrmPayment, type CrmNote } from '../../../api/crm';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { useCrmDataVersion } from './crmDataVersion';
import { useCrmStore } from '../../../store/crmStore';
import { useUserStore } from '../../../store/userStore';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { Skeleton, SkeletonList } from '../../../components/ui/Skeleton';
import { Sheet } from '../../../components/ui/Sheet';
import { Field, TextArea } from '../../../components/ui/Field';
import { UnpaidSessionsSheet } from '../../../components/crm/UnpaidSessionsSheet';
import { PaymentEditSheet } from '../../../components/crm/PaymentEditSheet';
import { accountLabel } from '../../../utils/paymentAccounts';
import { statusLabel } from '../../../design/statuses';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { toastApiError } from '../../../utils/errors';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { phoneHref, telegramHref } from '../../../utils/contactLinks';
import { formatDateLabel, formatDayMonth, formatMoney, formatMonthLabel, formatTime, formatTimeRange } from '../../../utils/format';
import clsx from 'clsx';
import { ListGroup, ListIcon, ListRow } from '../../../components/ui/ListRow';
import { Money, moneyToneClass } from '../../../components/ui/Money';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { SummaryCard } from '../../../components/ui/SummaryCard';
import { SessionActionSheet } from './SessionActionSheet';
import { ClientEditSheet } from './ClientEditSheet';
import { undoToast } from '../../../components/ui/undoToast';
import { aliasLabel, linkCabinetPath, nextSessionLabel, useBookNext } from './crmFlows';
import {
    isBillableStatus, partialPayment, priceFromClientRate, sessionCurrencyOf, sessionDebt, sessionPriceOf,
} from '../../../utils/sessionMoney';
import { useNotesHidden } from './notesPrivacy';

/** Дата/время из базы (UTC) — по Батуми. */
const TZ = { timeZone: BATUMI_TZ };
const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);
/** Лента клиента показывается порциями (ревью п. 16): было молча 30 последних. */
const FEED_PAGE = 30;

/** 1 сессия, 2 сессии, 5 сессий. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

/** «280 ₾ + 50 $» — по валютам, без пересчёта (как в UnpaidSessionsSheet). */
function totalsLabel(items: { amount: number; currency: string }[]): string {
    const by = new Map<string, number>();
    for (const it of items) by.set(it.currency, (by.get(it.currency) ?? 0) + it.amount);
    return [...by.entries()]
        .filter(([, v]) => v > 0)
        .map(([cur, v]) => formatMoney(Math.round(v * 100) / 100, { currency: cur }))
        .join(' + ');
}

type Balance = { totalPaid: number; totalExpected: number; debt: number; prepayment: number };

/**
 * Psy-CRM на телефоне — карточка клиента (волна 3, пакет A).
 *
 *  - «Следующая встреча: вт, 7 окт. · 19:00–19:50 · Кабинет 2» (тап —
 *    шторка сессии); если её нет — «Следующей нет · была 23 сент.» и
 *    [Записать · вт, 7 окт., 19:00] → NewSessionSheet со значениями
 *    прошлой сессии (G6-06).
 *  - Долг (G6-02): «Долг 280 ₾ · 2 сессии» [Долг 280 ₾ · Оплатить] →
 *    UnpaidSessionsSheet (оплата по строке — quickPaySession, «все» — с
 *    вопросом). После оплаты карточка перечитывается.
 *  - История: строки сессий — кнопки, открывают ту же шторку сессии;
 *    «+ Заметка» пишет в общие заметки (createNote, шифруются на сервере).
 *  - «Забронировать кабинет» без клиента убрали: кабинет бронируется под
 *    конкретную сессию (тост после записи или «Кабинет» у следующей).
 *  - Ошибки: «не найден» (404) ≠ «не загрузилось»; если не пришли заметки
 *    или оплаты — строка «… не загрузились · Повторить», а не тихий ноль (X5-04).
 */
export function MobileCrmClient() {
    const { clientId } = useParams<{ clientId: string }>();
    const navigate = useNavigate();
    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [payments, setPayments] = useState<CrmPayment[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    // Ответ сервера приходит в camelCase (интерцептор toCamelCase), хотя тип
    // в crm.ts описан snake_case — читаем фактическую форму.
    const [balance, setBalance] = useState<Balance | null>(null);
    const [partFailed, setPartFailed] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);
    // Сбой загрузки (сеть, 5xx) — не «клиент не найден» (аудит X5-04).
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    // Растёт, когда прошедшие сессии автоматически закрылись — долг мог
    // измениться, перечитываем карточку (см. MobileCrmLayout).
    const dataVersion = useCrmDataVersion();
    const loadedFor = useRef<string | null>(null);
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const storeClients = useCrmStore(s => s.clients);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    const [activeSheet, setActiveSheet] = useState<CrmSession | null>(null);
    const [unpaidOpen, setUnpaidOpen] = useState(false);
    // Платёж, который правят карандашом в ленте (то же окно, что в блоке «Оплата» сессии).
    const [editingPayment, setEditingPayment] = useState<CrmPayment | null>(null);
    const [noteOpen, setNoteOpen] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [pausing, setPausing] = useState(false);
    const [feedLimit, setFeedLimit] = useState(FEED_PAGE);
    useEffect(() => { setFeedLimit(FEED_PAGE); }, [clientId]);
    // Без имени клиента: вкладку видно при показе экрана, и она остаётся в истории браузера.
    useDocumentTitle('Клиент · Psy-CRM');

    useEffect(() => { fetchBookings?.(); }, [fetchBookings]);
    // Счета специалиста (свои названия, не только «Наличные / TBC / BOG») —
    // для подписи платежа в истории, как на компьютере (CrmLayout грузит их там).
    const fetchPaymentAccounts = useCrmStore(s => s.fetchPaymentAccounts);
    useEffect(() => { fetchPaymentAccounts(); }, [fetchPaymentAccounts]);

    /** Перечитать карточку (после записи, оплаты, заметки, правок в шторке). */
    const refresh = useCallback(() => setAttempt(a => a + 1), []);

    useEffect(() => {
        if (!clientId) return;
        let cancelled = false;
        // Полноэкранный скелетон — только при смене клиента; тихое
        // обновление той же карточки не прячет её.
        if (loadedFor.current !== clientId) setLoading(true);
        const failed: string[] = [];
        const part = <T,>(p: Promise<T>, label: string, fallback: T) =>
            p.catch(() => { failed.push(label); return fallback; });
        Promise.all([
            crmApi.getClient(clientId),
            crmApi.getSessions({ clientId }),
            part(crmApi.getClientBalance(clientId) as Promise<unknown>, 'баланс', null),
            part(crmApi.getPayments({ clientId }), 'оплаты', [] as CrmPayment[]),
            part(crmApi.getNotes(clientId), 'заметки', [] as CrmNote[]),
        ])
            .then(([c, ss, bal, pp, nn]) => {
                if (cancelled) return;
                loadedFor.current = clientId;
                setLoadFailed(false);
                setClient(c);
                setSessions(ss);
                setBalance(bal as Balance | null);
                setPayments(pp);
                setNotes(nn);
                setPartFailed(failed);
            })
            .catch((e: { response?: { status?: number } }) => {
                if (cancelled) return;
                // 404 — клиента правда нет; всё остальное — «не загрузилось».
                if (e?.response?.status !== 404) setLoadFailed(true);
                else { setClient(null); loadedFor.current = clientId; }
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [clientId, attempt, dataVersion]);

    // ── Записать следующую ───────────────────────────────────────────
    const bookNext = useBookNext(() => refresh(), storeClients.length ? storeClients : client ? [client] : []);

    const now = Date.now();
    const { nextSession, lastPast, unpaid } = useMemo(() => {
        const live = sessions.filter(s => !CANCELLED.has(s.status));
        const t = (s: CrmSession) => parseUTC(s.date).getTime();
        const future = live.filter(s => t(s) > now).sort((a, b) => t(a) - t(b));
        const past = live.filter(s => t(s) <= now).sort((a, b) => t(b) - t(a));
        // Тот же отбор, что у UnpaidSessionsSheet и mark-all-paid на сервере.
        const unpaidList = past.filter(s => !s.isPaid);
        return { nextSession: future[0] ?? null, lastPast: past[0] ?? null, unpaid: unpaidList };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessions]);

    /** Unified chronological feed across sessions / payments / notes. */
    const timeline = useMemo<TimelineItem[]>(() => {
        const out: TimelineItem[] = [];
        for (const s of sessions) {
            const ts = parseUTC(s.date).getTime();
            if (Number.isFinite(ts)) out.push({ kind: 'session', ts, session: s });
        }
        for (const p of payments) {
            const ts = parseUTC(p.date).getTime();
            if (Number.isFinite(ts)) out.push({ kind: 'payment', ts, payment: p });
        }
        for (const n of notes) {
            // createdAt с сервера — UTC без зоны, как даты сессий: parseUTC,
            // иначе заметки съезжают в ленте на смещение часового пояса.
            const ts = n.createdAt ? parseUTC(n.createdAt).getTime() : 0;
            if (Number.isFinite(ts) && ts > 0) out.push({ kind: 'note', ts, note: n });
        }
        return out.sort((a, b) => b.ts - a.ts);
    }, [sessions, payments, notes]);
    const sessionById = useMemo(() => new Map(sessions.map(s => [s.id, s])), [sessions]);

    if (loading) {
        return (
            <div role="status" aria-busy="true" style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                <span className="sr-only">Загружаем карточку клиента…</span>
                <Skeleton height={28} width="60%" />
                <Skeleton height={60} />
                <SkeletonList count={3} label="Загружаем историю" cardHeight={52} />
            </div>
        );
    }
    if (!client && loadFailed) {
        return (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <ErrorBar message="Не удалось загрузить карточку клиента" onRetry={refresh} />
                <Link to="/m/crm/clients" style={{ color: 'var(--color-ink)', fontSize: 14, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>← К списку клиентов</Link>
            </div>
        );
    }
    if (!client) {
        return (
            <div style={{ padding: 16 }}>
                <EmptyState
                    compact
                    title="Клиент не найден"
                    hint="Возможно, его удалили или объединили с другим."
                    action={{ label: 'К списку клиентов', onClick: () => navigate('/m/crm/clients') }}
                />
            </div>
        );
    }

    const telHref = phoneHref(client.phone);
    const tgHref = telegramHref(client.telegram);
    const cur = client.currency || 'GEL';
    // Долг по сессии — остаток (цена минус внесённое), а не вся цена.
    const debtItems = unpaid.map(s => sessionDebt(s, client));
    const debtTotal = totalsLabel(debtItems);

    const cabinetOf = (s: CrmSession): string | null => {
        if (!s.isBooked) return null;
        const b = s.bookingId ? bookings.find(x => x.id === s.bookingId) : null;
        const res = b ? RESOURCES.find(r => r.id === b.resourceId) : null;
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        return res ? (loc ? `${res.name} · ${loc.name}` : res.name) : 'Кабинет забронирован';
    };

    // Пауза — как на компьютере (CrmClientDetail): мягко, is_active=false,
    // ничего не удаляется; «Вернуть» в тосте — 5 секунд передумать.
    const togglePause = async () => {
        if (pausing) return;
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

    const contactLinks = [
        telHref && { href: telHref, label: 'Позвонить', icon: <Phone size={16} aria-hidden="true" />, external: false },
        tgHref && { href: tgHref, label: 'Написать', icon: <MessageCircle size={16} aria-hidden="true" />, external: true, aria: 'Написать в Telegram' },
        client.email && { href: `mailto:${client.email}`, label: 'Почта', icon: <Mail size={16} aria-hidden="true" />, external: false },
    ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode; external: boolean; aria?: string }[];
    const moneyStats = balance && ((balance.totalPaid ?? 0) > 0 || (balance.prepayment ?? 0) > 0 || client.basePrice > 0)
        ? [
            ...(client.basePrice > 0 ? [{ label: 'Ставка', value: <Money value={client.basePrice} currency={cur} /> }] : []),
            { label: 'Оплачено за всё время', value: <Money value={balance.totalPaid ?? 0} currency={cur} /> },
            ...((balance.prepayment ?? 0) > 0 ? [{ label: 'Аванс', value: <Money value={balance.prepayment} currency={cur} /> }] : []),
        ]
        : null;
    const hasDebt = unpaid.length > 0 && !!debtTotal;
    const feedGroups = groupByMonth(timeline.slice(0, feedLimit));

    return (
        <div style={{ paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 09.11 фаза 3: общая крупная шапка: «←» к списку, имя 28, код для календаря
                мелко под именем (.mono), карандаш справа. */}
            <MobilePageHeader
                variant="large"
                back
                onBack={() => navigate('/m/crm/clients')}
                title={client.name}
                subtitle={client.aliasCode ? (
                    <>код для календаря <span className="mono">{aliasLabel(client.aliasCode)}</span></>
                ) : undefined}
                action={!viewingOther ? (
                    <Button
                        variant="secondary"
                        onClick={() => setEditOpen(true)}
                        aria-label="Изменить клиента"
                        icon={<Pencil size={18} aria-hidden="true" />}
                    />
                ) : undefined}
                className="crm-client-header"
            />
            <style>{'.crm-client-header { padding-bottom: 0; }'}</style>

            {/* Связь — компактные кнопки по содержимому (дизайн-ревью п. 13). */}
            {contactLinks.length > 0 && (
                <div style={{ padding: '0 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {contactLinks.map(l => (
                        <a
                            key={l.label}
                            href={l.href}
                            className="ui-btn ui-btn--secondary"
                            aria-label={l.aria}
                            {...(l.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        >
                            {l.icon}
                            {l.label}
                        </a>
                    ))}
                </div>
            )}

            {!client.isActive && (
                <div style={{
                    margin: '0 16px', padding: '12px 16px', borderRadius: 16,
                    background: 'var(--color-card)', border: '1px solid var(--color-ink-10)',
                    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                }}>
                    <span style={{ flex: 1, minWidth: 160, fontSize: 14, lineHeight: 1.45 }}>
                        <b>На паузе.</b> Сессии, оплаты и заметки сохранены; в списке «Активные» клиента не видно.
                    </span>
                    {!viewingOther && (
                        <Button variant="secondary" size="sm" loading={pausing} onClick={togglePause}>
                            Вернуть в работу
                        </Button>
                    )}
                </div>
            )}

            {loadFailed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось обновить карточку" onRetry={refresh} />
                </div>
            )}
            {!loadFailed && partFailed.length > 0 && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message={`Не загрузились: ${partFailed.join(', ')}`} onRetry={refresh} />
                </div>
            )}

            {/* Следующая встреча — тот же предмет, что «Дальше» на «Сегодня», в лёгком
                виде: карточка с рамкой; дата строкой, время одной строкой (не рвётся). */}
            <div style={{ padding: '0 16px' }}>
                {nextSession ? (
                    <div style={nextBox}>
                        <button type="button" onClick={() => setActiveSheet(nextSession)} className="press" style={nextBoxButton}>
                            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60)' }}>
                                Следующая встреча
                            </span>
                            <span style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                                {formatDateLabel(parseUTC(nextSession.date), { ...TZ, capitalize: true, withYear: 'auto' })}
                            </span>
                            <span className="num" style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                                {formatTimeRange(
                                    parseUTC(nextSession.date),
                                    new Date(parseUTC(nextSession.date).getTime() + (nextSession.durationMinutes || 60) * 60000),
                                    TZ,
                                )}
                            </span>
                            <span style={{ fontSize: 14, color: 'var(--color-ink-60)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MapPin size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                                {cabinetOf(nextSession) ?? 'Кабинет не забронирован'}
                            </span>
                        </button>
                        {!nextSession.isBooked && !viewingOther && (
                            <div>
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => { const p = linkCabinetPath(nextSession); if (p) navigate(p); }}
                                >
                                    Забронировать кабинет
                                </Button>
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={nextBox}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>Следующей нет</div>
                            <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                                {lastPast ? `была ${formatDayMonth(parseUTC(lastPast.date), { ...TZ, withYear: 'auto' })}` : 'сессий ещё не было'}
                            </div>
                        </div>
                        {!viewingOther && (
                            <div>
                                <Button
                                    icon={<CalendarPlus size={16} aria-hidden="true" />}
                                    onClick={() => bookNext.open(client, lastPast)}
                                >
                                    {`Записать · ${nextSessionLabel(lastPast, client)}`}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Деньги клиента — одна карточка (дизайн-ревью п. 6, 7, 13): долг — danger
                (не янтарь), сумма один раз; ставка и «оплачено всего» — ячейками. */}
            {(hasDebt || moneyStats) && (
                <div style={{ padding: '0 16px' }}>
                    <SummaryCard
                        label={hasDebt ? 'Долг' : undefined}
                        value={hasDebt ? <span className={clsx('num', 'ui-money', moneyToneClass(1, 'debt'))}>{debtTotal}</span> : undefined}
                        caption={hasDebt ? `${unpaid.length} ${plural(unpaid.length, 'сессия', 'сессии', 'сессий')} без оплаты` : undefined}
                        aside={hasDebt && !viewingOther ? (
                            // Кнопка только открывает список неоплаченных — оплата по строке.
                            <Button variant="secondary" size="sm" onClick={() => setUnpaidOpen(true)}>
                                Отметить оплату…
                            </Button>
                        ) : undefined}
                        stats={moneyStats ?? undefined}
                    />
                </div>
            )}

            {/* История — сессии, оплаты, заметки одной лентой, по месяцам */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '8px 0 12px', padding: '0 4px' }}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, lineHeight: 1.2 }}>История</h2>
                        <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 2 }}>
                            {sessions.length} {plural(sessions.length, 'сессия', 'сессии', 'сессий')}
                            {' · '}{payments.length} {plural(payments.length, 'оплата', 'оплаты', 'оплат')}
                            {' · '}{notes.length} {plural(notes.length, 'заметка', 'заметки', 'заметок')}
                        </div>
                    </div>
                    {!viewingOther && (
                        <Button variant="secondary" size="sm" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNoteOpen(true)}>
                            Заметка
                        </Button>
                    )}
                </div>
                {timeline.length === 0 ? (
                    <EmptyState
                        compact
                        title="История пока пуста"
                        hint="Запишите первую сессию — она появится здесь."
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div>
                            {feedGroups.map(g => (
                                <ListGroup key={g.key} title={g.title}>
                                    {g.items.map(item => (
                                        <TimelineRow
                                            key={`${item.kind}-${itemId(item)}`}
                                            item={item}
                                            client={client}
                                            sessionById={sessionById}
                                            onOpenSession={setActiveSheet}
                                            onEditPayment={viewingOther ? undefined : setEditingPayment}
                                        />
                                    ))}
                                </ListGroup>
                            ))}
                        </div>
                        {timeline.length > feedLimit && (
                            <Button variant="secondary" block onClick={() => setFeedLimit(n => n + FEED_PAGE)}>
                                {`Показать ещё ${Math.min(FEED_PAGE, timeline.length - feedLimit)} · всего ${timeline.length}`}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* «Поставить на паузу» — строка группы «Ещё», а не висящий жирный текст. */}
            {client.isActive && !viewingOther && (
                <div style={{ padding: '8px 16px 0' }}>
                    <ListGroup title="Ещё">
                        <ListRow
                            lead={<ListIcon><PauseCircle size={20} /></ListIcon>}
                            title={<span style={{ color: 'var(--color-ink-80)' }}>Поставить на паузу</span>}
                            subtitle="Скроется из «Активных»; сессии, оплаты и заметки сохранятся"
                            disabled={pausing}
                            onClick={togglePause}
                            chevron={false}
                        />
                    </ListGroup>
                </div>
            )}

            {activeSheet && (
                <SessionActionSheet
                    session={activeSheet}
                    client={client}
                    onClose={() => setActiveSheet(null)}
                    onChange={(updated) => {
                        setSessions(prev => prev.map(x => x.id === updated.id ? updated : x));
                        setActiveSheet(updated);
                        refresh();
                    }}
                    onDeleted={(id) => {
                        setSessions(prev => prev.filter(x => x.id !== id));
                        setActiveSheet(null);
                        refresh();
                    }}
                    onBookNext={viewingOther ? undefined : (s) => {
                        setActiveSheet(null);
                        bookNext.open(client, s);
                    }}
                />
            )}
            {bookNext.sheet}
            <UnpaidSessionsSheet
                open={unpaidOpen}
                onClose={() => setUnpaidOpen(false)}
                client={client}
                sessions={sessions}
                onChanged={refresh}
            />
            {editingPayment && (
                <PaymentEditSheet
                    payment={editingPayment}
                    clientCurrency={client.currency}
                    onClose={() => setEditingPayment(null)}
                    onSaved={() => { setEditingPayment(null); refresh(); }}
                />
            )}
            <ClientEditSheet
                open={editOpen}
                client={client}
                onClose={() => setEditOpen(false)}
                onSaved={(updated, reloadSessions) => {
                    setClient(updated);
                    setEditOpen(false);
                    if (reloadSessions) refresh();
                }}
            />
            <NewNoteSheet
                open={noteOpen}
                clientId={client.id}
                clientName={client.name}
                onClose={() => setNoteOpen(false)}
                onCreated={(note) => { setNotes(prev => [note, ...prev]); refresh(); }}
            />
        </div>
    );
}

/** «+ Заметка» — общая заметка о клиенте (без сессии). Только createNote:
 *  заметки шифруются на сервере; в client.notesText ничего не пишем. */
function NewNoteSheet({ open, clientId, clientName, onClose, onCreated }: {
    open: boolean; clientId: string; clientName: string;
    onClose: () => void; onCreated: (note: CrmNote) => void;
}) {
    const [text, setText] = useState('');
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    useEffect(() => { if (open) setText(''); }, [open]);
    const save = async () => {
        const content = text.trim();
        if (!content || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            const note = await crmApi.createNote({ clientId, content });
            toast.success('Заметка сохранена');
            onCreated(note);
            onClose();
        } catch (e) {
            toastApiError(e, 'Не удалось сохранить заметку');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };
    return (
        <Sheet
            open={open}
            onClose={() => { if (!saving) onClose(); }}
            title="Новая заметка"
            description={clientName}
            footer={(
                <Button block loading={saving} disabled={!text.trim()} onClick={save}>
                    Сохранить заметку
                </Button>
            )}
        >
            <Field label="Заметка" hint="Появится во вкладке «Заметки» и в истории клиента.">
                <TextArea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    rows={6}
                    placeholder="Наблюдения, договорённости, домашнее задание…"
                    style={{ minHeight: 140 }}
                />
            </Field>
        </Sheet>
    );
}

// Лёгкая версия «Дальше» с «Сегодня»: карточка с рамкой, без тёмной заливки.
const nextBox: React.CSSProperties = {
    background: 'var(--color-card)', border: '1px solid var(--color-ink-10)', borderRadius: 16,
    padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
};

const nextBoxButton: React.CSSProperties = {
    minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left',
    fontFamily: 'inherit', color: 'var(--color-ink)', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 4,
};

type TimelineItem =
    | { kind: 'session'; ts: number; session: CrmSession }
    | { kind: 'payment'; ts: number; payment: CrmPayment }
    | { kind: 'note'; ts: number; note: CrmNote };

function itemId(item: TimelineItem): string {
    return item.kind === 'session' ? item.session.id : item.kind === 'payment' ? item.payment.id : item.note.id;
}

/** Лента по месяцам («Ноябрь 2026») — подписи групп, как в /m/bookings по дням. */
function groupByMonth(items: TimelineItem[]): { key: string; title: string; items: TimelineItem[] }[] {
    const out: { key: string; title: string; items: TimelineItem[] }[] = [];
    for (const it of items) {
        const d = new Date(it.ts);
        const title = formatMonthLabel(d, { ...TZ, capitalize: true });
        const last = out[out.length - 1];
        if (last && last.title === title) last.items.push(it);
        else out.push({ key: `${title}-${out.length}`, title, items: [it] });
    }
    return out;
}

/** Строка ленты клиента (09.11 фаза 3, дизайн-ревью п. 21): общий ListRow,
 *  слева значок без цветной плитки (часы / кошелёк / лист), справа статус
 *  оплаты точкой или сумма. Тап по строке — шторка (сессия, правка платежа). */
function TimelineRow({ item, client, sessionById, onOpenSession, onEditPayment }: {
    item: TimelineItem;
    client: CrmClient;
    sessionById: Map<string, CrmSession>;
    onOpenSession: (s: CrmSession) => void;
    /** Правка платежа по тапу; нет — «просмотр как специалист». */
    onEditPayment?: (p: CrmPayment) => void;
}) {
    // Счёт платежа — человеческим названием («Наличные»), а не id («cash»).
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    if (item.kind === 'session') {
        const s = item.session;
        const isCancelled = s.status?.startsWith('CANCELLED');
        const isPlanned = s.status === 'PLANNED';
        const future = isPlanned && item.ts > Date.now();
        // Прошла, но не отмечена — «Не отмечена», а не «Запланирована».
        const isUnmarked = isPlanned && item.ts + (s.durationMinutes ?? 60) * 60000 < Date.now();
        const Icon = isCancelled ? XCircle : isPlanned ? Clock : CheckCircle2;
        const pay = sessionPayState(s, client, future);
        return (
            <ListRow
                dimmed={isCancelled}
                lead={<ListIcon><Icon size={20} /></ListIcon>}
                title={`Сессия · ${isUnmarked ? 'Не отмечена' : statusLabel('session', s.status)}`}
                subtitle={<>
                    {formatDateLabel(new Date(item.ts), TZ)}, <span className="num-inline">{formatTime(new Date(item.ts), TZ)}</span>
                    {sessionPriceLine(s, client) ? ` · ${sessionPriceLine(s, client)}` : ''}
                </>}
                // Статус оплаты — третьей строкой (meta): справа длинный бейдж сжимал текст при 360 px.
                meta={pay ? <StatusBadge kind="payment" status={pay} variant="dot" /> : undefined}
                onClick={() => onOpenSession(s)}
            />
        );
    }
    if (item.kind === 'payment') {
        const p = item.payment;
        // Ревью п. 8: за какую сессию платёж («за 3 нояб.»).
        const forSession = p.sessionId ? sessionById.get(p.sessionId) : undefined;
        return (
            <ListRow
                lead={<ListIcon><Wallet size={20} /></ListIcon>}
                title="Платёж"
                subtitle={<>
                    {formatDayMonth(new Date(item.ts), TZ)}, <span className="num-inline">{formatTime(new Date(item.ts), TZ)}</span>
                    {forSession ? ` · за ${formatDayMonth(parseUTC(forSession.date), TZ)}` : ''}
                    {p.account ? ` · ${accountLabel(p.account, paymentAccounts)}` : ''}
                </>}
                trail={<Money value={p.amount || 0} currency={p.currency || 'GEL'} tone="flow" />}
                onClick={onEditPayment ? () => onEditPayment(p) : undefined}
                aria-label={onEditPayment ? `Изменить оплату ${formatMoney(p.amount || 0, { currency: p.currency || 'GEL' })}` : undefined}
            />
        );
    }
    return <NoteRow note={item.note} />;
}

const NOTE_PREVIEW_CHARS = 140;

/** Заметка в ленте клиента. Текст — поле `content` (как во вкладке
 *  «Заметки»); раньше читалось несуществующее `text`, и плашки были пустыми.
 *  Длинная заметка обрезается, тап раскрывает её целиком. Отличается от
 *  сессий только значком и цветом текста — без отдельного фона. */
function NoteRow({ note: n }: { note: CrmNote }) {
    const [expanded, setExpanded] = useState(false);
    // Ревью п. 10: «Скрывать текст» (общая настройка, по умолчанию вкл.) —
    // «Заметка · 9 нояб.», текст по тапу.
    const [hidden] = useNotesHidden();
    const [revealed, setRevealed] = useState(false);
    const content = n.content || '';
    const isLong = content.length > NOTE_PREVIEW_CHARS;
    const masked = hidden && !revealed;
    const when = n.createdAt ? formatDayMonth(parseUTC(n.createdAt), TZ) : '';
    if (masked) {
        return (
            <ListRow
                lead={<ListIcon><FileText size={20} /></ListIcon>}
                title={`Заметка${when ? ` · ${when}` : ''}`}
                subtitle="Текст скрыт · нажмите, чтобы показать"
                onClick={() => setRevealed(true)}
                aria-label="Заметка — показать текст"
                chevron={false}
            />
        );
    }
    return (
        <ListRow
            lead={<ListIcon><FileText size={20} /></ListIcon>}
            title="Заметка"
            subtitle={<>
                <span style={{ display: 'block', color: 'var(--color-ink-80)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {expanded || !isLong ? content : `${content.slice(0, NOTE_PREVIEW_CHARS)}…`}
                </span>
                {isLong && (
                    <span style={{ display: 'block', fontWeight: 600, color: 'var(--color-accent-ink)', marginTop: 4 }}>
                        {expanded ? 'Свернуть' : 'Показать полностью'}
                    </span>
                )}
            </>}
            trail={n.createdAt ? <span style={{ color: 'var(--color-ink-60)', fontWeight: 500 }}>{when}</span> : undefined}
            trailSub={n.createdAt ? <span className="num">{formatTime(parseUTC(n.createdAt), TZ)}</span> : undefined}
            onClick={isLong ? () => setExpanded(v => !v) : hidden ? () => setRevealed(false) : undefined}
            chevron={false}
        />
    );
}

/**
 * Цена сессии строкой (ревью п. 1, 8): «120 ₾ (ставка) · оплачено 60, долг 60».
 * Цена — своя или ставка клиента (как считает сервер). «Оплачено / не оплачено» —
 * бейджем справа (sessionPayState).
 */
function sessionPriceLine(s: CrmSession, client: CrmClient): string {
    const price = sessionPriceOf(s, client);
    const currency = sessionCurrencyOf(s, client);
    const parts: string[] = [];
    if (price > 0) parts.push(`${formatMoney(price, { currency })}${priceFromClientRate(s, client) ? ' (ставка)' : ''}`);
    const partial = partialPayment(s, client);
    if (!s.isPaid && partial) parts.push(`оплачено ${formatMoney(partial.paid, { currency })}, долг ${formatMoney(partial.remaining, { currency })}`);
    return parts.join(' · ');
}

/** Статус оплаты сессии для бейджа: те же условия, что раньше у строки «оплачено / не оплачено». */
function sessionPayState(s: CrmSession, client: CrmClient, future: boolean): 'paid' | 'partial' | 'unpaid' | null {
    if (s.isPaid) return 'paid';
    if (partialPayment(s, client)) return 'partial';
    if (!future && (isBillableStatus(s.status) || s.status === 'PLANNED') && sessionDebt(s, client).amount > 0) return 'unpaid';
    return null;
}
