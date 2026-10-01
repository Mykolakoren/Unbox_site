import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
    ArrowLeft, Phone, MessageCircle, Mail, Plus, CalendarPlus, MapPin,
    CheckCircle2, Clock, XCircle, Wallet, FileText, ChevronRight,
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
import { getStatusDef, statusLabel } from '../../../design/statuses';
import { RESOURCES, LOCATIONS } from '../../../utils/data';
import { toastApiError } from '../../../utils/errors';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { phoneHref, telegramHref } from '../../../utils/contactLinks';
import { formatDateLabel, formatDayMonth, formatMoney, formatTime, formatTimeRange } from '../../../utils/format';
import { SessionActionSheet } from './SessionActionSheet';
import { linkCabinetPath, nextSessionLabel, useBookNext } from './crmFlows';

/** Дата/время из базы (UTC) — по Батуми. */
const TZ = { timeZone: BATUMI_TZ };
const CANCELLED = new Set(['CANCELLED_CLIENT', 'CANCELLED_THERAPIST']);

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
    const [noteOpen, setNoteOpen] = useState(false);
    // Без имени клиента: вкладку видно при показе экрана, и она остаётся в истории браузера.
    useDocumentTitle('Клиент · Psy-CRM');

    useEffect(() => { fetchBookings?.(); }, [fetchBookings]);

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
        return out.sort((a, b) => b.ts - a.ts).slice(0, 30);
    }, [sessions, payments, notes]);

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
    const debtItems = unpaid.map(s => ({
        amount: Number(s.price ?? client.basePrice ?? 0) || 0,
        currency: (s.currency || cur).toUpperCase(),
    }));
    const debtTotal = totalsLabel(debtItems);

    const cabinetOf = (s: CrmSession): string | null => {
        if (!s.isBooked) return null;
        const b = s.bookingId ? bookings.find(x => x.id === s.bookingId) : null;
        const res = b ? RESOURCES.find(r => r.id === b.resourceId) : null;
        const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
        return res ? (loc ? `${res.name} · ${loc.name}` : res.name) : 'Кабинет забронирован';
    };

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                    onClick={() => navigate('/m/crm/clients')}
                    aria-label="К списку клиентов"
                    style={{
                        background: 'var(--color-sunken)',
                        border: 'none',
                        borderRadius: 10,
                        width: 44, height: 44,
                        display: 'grid', placeItems: 'center',
                        cursor: 'pointer',
                        color: 'var(--color-ink)',
                        flexShrink: 0,
                    }}
                >
                    <ArrowLeft size={18} aria-hidden="true" />
                </button>
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0, flex: 1, minWidth: 0 }}>
                    {client.name}
                    {client.aliasCode && (
                        <span className="num" style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-ink-60)', marginLeft: 8 }}>
                            #{client.aliasCode}
                        </span>
                    )}
                </h1>
            </div>

            {/* Contacts row */}
            {(telHref || tgHref || client.email) && (
                <div style={{ padding: '0 16px', display: 'flex', gap: 8 }}>
                    {telHref && (
                        <a href={telHref} style={contactBtn}>
                            <Phone size={16} aria-hidden="true" />
                            <span style={{ fontSize: 12 }}>Звонок</span>
                        </a>
                    )}
                    {tgHref && (
                        <a
                            href={tgHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            // Нейтральная, как «Звонок» (аудит G6-18, X4-15).
                            style={contactBtn}
                        >
                            <MessageCircle size={16} aria-hidden="true" />
                            <span style={{ fontSize: 12 }}>Telegram</span>
                        </a>
                    )}
                    {client.email && (
                        <a href={`mailto:${client.email}`} style={contactBtn}>
                            <Mail size={16} aria-hidden="true" />
                            <span style={{ fontSize: 12 }}>Почта</span>
                        </a>
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

            {/* Следующая встреча */}
            <div style={{ padding: '0 16px' }}>
                {nextSession ? (
                    <div style={nextBox}>
                        <button type="button" onClick={() => setActiveSheet(nextSession)} className="press" style={nextBoxButton}>
                            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ink-60)' }}>
                                Следующая встреча
                            </span>
                            <span style={{ fontSize: 16, fontWeight: 600 }}>
                                {formatDateLabel(parseUTC(nextSession.date), { ...TZ, capitalize: true, withYear: 'auto' })}
                                {' · '}
                                <span className="num">{formatTimeRange(
                                    parseUTC(nextSession.date),
                                    new Date(parseUTC(nextSession.date).getTime() + (nextSession.durationMinutes || 60) * 60000),
                                    TZ,
                                )}</span>
                            </span>
                            <span style={{ fontSize: 14, color: 'var(--color-ink-60)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <MapPin size={14} aria-hidden="true" />
                                {cabinetOf(nextSession) ?? 'Кабинет не забронирован'}
                            </span>
                        </button>
                        {!nextSession.isBooked && !viewingOther && (
                            <Button
                                variant="secondary"
                                size="touch"
                                onClick={() => { const p = linkCabinetPath(nextSession); if (p) navigate(p); }}
                            >
                                Кабинет
                            </Button>
                        )}
                    </div>
                ) : (
                    <div style={{ ...nextBox, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                            <div style={{ fontSize: 16, fontWeight: 600 }}>Следующей нет</div>
                            <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>
                                {lastPast ? `была ${formatDayMonth(parseUTC(lastPast.date), { ...TZ, withYear: 'auto' })}` : 'сессий ещё не было'}
                            </div>
                        </div>
                        {!viewingOther && (
                            <Button
                                size="touch"
                                icon={<CalendarPlus size={16} aria-hidden="true" />}
                                onClick={() => bookNext.open(client, lastPast)}
                            >
                                {`Записать · ${nextSessionLabel(lastPast, client)}`}
                            </Button>
                        )}
                    </div>
                )}
            </div>

            {/* Долг — только когда он есть (G6-02) */}
            {unpaid.length > 0 && debtTotal && (
                <div style={{ padding: '0 16px' }}>
                    <div style={debtBox}>
                        <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                            <div className="num" style={{ fontSize: 16, fontWeight: 600 }}>Долг {debtTotal}</div>
                            <div style={{ fontSize: 14 }}>
                                {unpaid.length} {plural(unpaid.length, 'сессия', 'сессии', 'сессий')} без оплаты
                            </div>
                        </div>
                        {!viewingOther && (
                            // Кнопка только открывает список неоплаченных — подпись не
                            // обещает мгновенную оплату (оплата — по строке в шторке).
                            <Button size="touch" onClick={() => setUnpaidOpen(true)}>
                                {`Долг ${debtTotal} · Оплатить`}
                            </Button>
                        )}
                    </div>
                </div>
            )}

            {/* Деньги — строкой */}
            {balance && ((balance.totalPaid ?? 0) > 0 || (balance.prepayment ?? 0) > 0 || client.basePrice > 0) && (
                <div style={{ padding: '0 16px', fontSize: 14, color: 'var(--color-ink-80)' }}>
                    {[
                        client.basePrice > 0 ? `Ставка ${formatMoney(client.basePrice, { currency: cur })}` : '',
                        `оплачено всего ${formatMoney(balance.totalPaid ?? 0, { currency: cur })}`,
                        (balance.prepayment ?? 0) > 0 ? `аванс ${formatMoney(balance.prepayment, { currency: cur })}` : '',
                    ].filter(Boolean).join(' · ')}
                </div>
            )}

            {/* История — сессии, оплаты, заметки одной лентой */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                    <div>
                        <SectionTitle>История</SectionTitle>
                        <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                            {sessions.length} {plural(sessions.length, 'сессия', 'сессии', 'сессий')}
                            {' · '}{payments.length} {plural(payments.length, 'оплата', 'оплаты', 'оплат')}
                            {' · '}{notes.length} {plural(notes.length, 'заметка', 'заметки', 'заметок')}
                        </div>
                    </div>
                    {!viewingOther && (
                        <Button variant="secondary" size="touch" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setNoteOpen(true)}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {timeline.map(item => (
                            <TimelineRow
                                key={`${item.kind}-${itemId(item)}`}
                                item={item}
                                onOpenSession={setActiveSheet}
                            />
                        ))}
                    </div>
                )}
            </div>

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

const contactBtn: React.CSSProperties = {
    flex: 1,
    background: 'var(--color-card)',
    color: 'var(--color-ink)',
    border: '1px solid var(--color-ink-10)',
    borderRadius: 12,
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 600,
    textDecoration: 'none',
    cursor: 'pointer',
    minHeight: 56,
};

const nextBox: React.CSSProperties = {
    background: 'var(--color-sunken)', borderRadius: 14, padding: '12px 12px 12px 14px',
    display: 'flex', alignItems: 'center', gap: 10,
};

const nextBoxButton: React.CSSProperties = {
    flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, textAlign: 'left',
    fontFamily: 'inherit', color: 'var(--color-ink)', cursor: 'pointer',
    display: 'flex', flexDirection: 'column', gap: 4,
};

// Долг — янтарный тон «ждём оплату» (цвет только для статуса).
const debtBox: React.CSSProperties = {
    background: 'var(--status-pending-bg)', color: 'var(--status-pending-fg)',
    borderRadius: 14, padding: '12px 12px 12px 14px',
    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-ink-60)',
        }}>{children}</div>
    );
}

type TimelineItem =
    | { kind: 'session'; ts: number; session: CrmSession }
    | { kind: 'payment'; ts: number; payment: CrmPayment }
    | { kind: 'note'; ts: number; note: CrmNote };

function itemId(item: TimelineItem): string {
    return item.kind === 'session' ? item.session.id : item.kind === 'payment' ? item.payment.id : item.note.id;
}

/** Строка ленты клиента. Сессия — кнопка: открывает шторку сессии. */
function TimelineRow({ item, onOpenSession }: { item: TimelineItem; onOpenSession: (s: CrmSession) => void }) {
    if (item.kind === 'session') {
        const s = item.session;
        const isCancelled = s.status?.startsWith('CANCELLED');
        const isPlanned = s.status === 'PLANNED';
        // Прошла, но не отмечена — как на экране дня: янтарным, а не «Запланирована».
        const isUnmarked = isPlanned && item.ts + (s.durationMinutes ?? 60) * 60000 < Date.now();
        // Цвет — по тону статуса из общего словаря; «не отмечена» — янтарное «ждём».
        const tone = isUnmarked ? 'pending' : getStatusDef('session', s.status).tone;
        const color = { bg: `var(--status-${tone}-bg)`, fg: `var(--status-${tone}-fg)` };
        const Icon = isCancelled ? XCircle : isPlanned ? Clock : CheckCircle2;
        return (
            <button
                type="button"
                onClick={() => onOpenSession(s)}
                className="press"
                style={{
                    ...rowBase,
                    opacity: isCancelled ? 0.75 : 1,
                }}
            >
                <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: color.bg, color: color.fg,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                    <Icon size={14} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>
                        Сессия · {isUnmarked ? 'Не отмечена' : statusLabel('session', s.status)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                        {formatDateLabel(new Date(item.ts), TZ)}, {formatTime(new Date(item.ts), TZ)}
                        {s.price ? ` · ${formatMoney(s.price, { currency: s.currency || 'GEL' })}` : ''}
                        {s.isPaid ? ` · ${statusLabel('payment', 'paid').toLowerCase()}` : ''}
                    </div>
                </div>
                <ChevronRight size={16} aria-hidden="true" style={{ color: 'var(--color-ink-60)', flexShrink: 0 }} />
            </button>
        );
    }
    if (item.kind === 'payment') {
        const p = item.payment;
        return (
            <div style={{ ...rowBase, cursor: 'default' }}>
                <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: 'var(--status-ok-bg)', color: 'var(--status-ok-fg)',
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                    <Wallet size={14} aria-hidden="true" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>
                        Платёж · <span className="num">{formatMoney(p.amount || 0, { currency: p.currency || 'GEL' })}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                        {formatDayMonth(new Date(item.ts), TZ)}, {formatTime(new Date(item.ts), TZ)}
                        {p.account ? ` · ${p.account}` : ''}
                    </div>
                </div>
            </div>
        );
    }
    return <NoteRow note={item.note} />;
}

const rowBase: React.CSSProperties = {
    background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
    borderRadius: 10, padding: '8px 12px', minHeight: 52,
    display: 'flex', alignItems: 'center', gap: 10,
    width: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer',
    color: 'var(--color-ink)',
};

const NOTE_PREVIEW_CHARS = 140;

/** Заметка в ленте клиента. Текст — поле `content` (как во вкладке
 *  «Заметки»); раньше читалось несуществующее `text`, и плашки были пустыми.
 *  Длинная заметка обрезается, тап раскрывает её целиком. */
function NoteRow({ note: n }: { note: CrmNote }) {
    const [expanded, setExpanded] = useState(false);
    const content = n.content || '';
    const isLong = content.length > NOTE_PREVIEW_CHARS;
    return (
        <button
            type="button"
            onClick={() => { if (isLong) setExpanded(v => !v); }}
            aria-expanded={isLong ? expanded : undefined}
            // Заметка — нейтральная карточка: цвет только для статуса.
            style={{
                background: 'var(--color-sunken)', border: '1px solid var(--color-ink-08)',
                borderRadius: 10, padding: '9px 12px',
                display: 'flex', alignItems: 'flex-start', gap: 10,
                width: '100%', textAlign: 'left', fontFamily: 'inherit',
                cursor: isLong ? 'pointer' : 'default',
                color: 'var(--color-ink)',
            }}
        >
            <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'var(--color-card)', color: 'var(--color-ink-80)',
                display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
                <FileText size={14} aria-hidden="true" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>Заметка</div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-80)', marginTop: 2, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {expanded || !isLong ? content : `${content.slice(0, NOTE_PREVIEW_CHARS)}…`}
                </div>
                {isLong && (
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-ink)', marginTop: 4, textDecoration: 'underline' }}>
                        {expanded ? 'Свернуть' : 'Показать полностью'}
                    </div>
                )}
                {n.createdAt && (
                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 3 }}>
                        {formatDayMonth(parseUTC(n.createdAt), TZ)}, {formatTime(parseUTC(n.createdAt), TZ)}
                    </div>
                )}
            </div>
        </button>
    );
}
