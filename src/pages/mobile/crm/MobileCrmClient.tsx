import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Mail, Plus } from 'lucide-react';
import { crmApi, type CrmClient, type CrmSession, type CrmPayment, type CrmNote } from '../../../api/crm';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { CheckCircle2, Clock, XCircle, Wallet, FileText } from 'lucide-react';
import { useCrmDataVersion } from './crmDataVersion';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { Skeleton, SkeletonList } from '../../../components/ui/Skeleton';
import { getStatusDef, statusLabel } from '../../../design/statuses';
import { formatDateLabel, formatDayMonth, formatMoney, formatTime } from '../../../utils/format';

/** Дата/время из базы (UTC) — по Батуми. */
const TZ = { timeZone: BATUMI_TZ };

/** 1 сессия, 2 сессии, 5 сессий. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

/**
 * Mobile CRM — single client card.
 *
 * Quick view: contact, balance summary, last 10 sessions, "Новая сессия" CTA.
 * Phone/email/Telegram all tap-to-act (`tel:`, `mailto:`, t.me link).
 *
 * Wave 1: суммы — formatMoney («140 ₾», не «140 GEL»), статусы сессий — из
 * общего словаря, эмодзи-счётчики (🗓💳📝) → словами, кнопка Telegram —
 * нейтральная, как «Звонок»; «не найден» и «не загрузилось» — разные
 * состояния (раньше обрыв сети выглядел как «Клиент не найден»).
 */
export function MobileCrmClient() {
    const { clientId } = useParams<{ clientId: string }>();
    const navigate = useNavigate();
    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [payments, setPayments] = useState<CrmPayment[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    // Field names: the API client interceptor (`toCamelCase`) silently
    // rewrites server snake_case → camelCase before this state lands. So
    // even though the backend returns `{total_paid, total_expected, ...}`,
    // at runtime we read camelCase. The crm.ts type still says snake_case
    // — that's a known inaccuracy in the API typings; trust the actual
    // shape, not the declared one.
    const [balance, setBalance] = useState<{ totalPaid: number; totalExpected: number; debt: number; prepayment: number } | null>(null);
    const [loading, setLoading] = useState(true);
    // Сбой загрузки (сеть, 5xx) — не «клиент не найден» (аудит X5-04).
    const [loadFailed, setLoadFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    // Растёт, когда прошедшие сессии автоматически закрылись — долг мог
    // измениться, перечитываем карточку (см. MobileCrmLayout).
    const dataVersion = useCrmDataVersion();
    const loadedFor = useRef<string | null>(null);

    useEffect(() => {
        if (!clientId) return;
        let cancelled = false;
        // Полноэкранное «Загружаю…» — только при смене клиента; тихое
        // обновление той же карточки не прячет её.
        if (loadedFor.current !== clientId) setLoading(true);
        Promise.all([
            crmApi.getClient(clientId),
            crmApi.getSessions({ clientId }),
            crmApi.getClientBalance(clientId).catch(() => null),
            crmApi.getPayments({ clientId }).catch(() => []),
            crmApi.getNotes(clientId).catch(() => []),
        ])
            .then(([c, ss, bal, pp, nn]) => {
                if (cancelled) return;
                loadedFor.current = clientId;
                setLoadFailed(false);
                setClient(c);
                setSessions(ss);
                setBalance(bal as any);
                setPayments(pp as CrmPayment[]);
                setNotes(nn as CrmNote[]);
            })
            .catch((e: any) => {
                if (cancelled) return;
                // 404 — клиента правда нет; всё остальное — «не загрузилось».
                if (e?.response?.status !== 404) setLoadFailed(true);
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [clientId, attempt, dataVersion]);

    const recentSessions = useMemo(() => {
        // parseUTC for sort — same UTC-naive convention as everywhere in CRM.
        return [...sessions]
            .sort((a, b) => parseUTC(b.date).getTime() - parseUTC(a.date).getTime())
            .slice(0, 10);
    }, [sessions]);

    /** Unified chronological feed across sessions / payments / notes.
     *  Owner 2026-05-27: scattered tabs lose context. One feed gives the
     *  specialist a coherent history of "what happened with this client".
     *  Past sessions, payments and notes are merged and sorted desc. */
    type TimelineItem =
        | { kind: 'session'; ts: number; session: CrmSession }
        | { kind: 'payment'; ts: number; payment: CrmPayment }
        | { kind: 'note'; ts: number; note: CrmNote };

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
                <ErrorBar message="Не удалось загрузить карточку клиента" onRetry={() => setAttempt(a => a + 1)} />
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

    const phoneClean = client.phone?.replace(/\s/g, '');

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
                    {client.aliasCode ? `${client.aliasCode} · ` : ''}{client.name}
                </h1>
            </div>

            {/* Contacts row */}
            <div style={{ padding: '0 16px', display: 'flex', gap: 8 }}>
                {phoneClean && (
                    <a href={`tel:${phoneClean}`} style={contactBtn}>
                        <Phone size={16} aria-hidden="true" />
                        <span style={{ fontSize: 12 }}>Звонок</span>
                    </a>
                )}
                {client.telegram && (
                    <a
                        href={`https://t.me/${client.telegram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        // Wave 1: нейтральная, как «Звонок» (голубая #229ED9 кричала
                        // громче всего и не проходила контраст — аудит G6-18, X4-15).
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

            {loadFailed && (
                <div style={{ padding: '0 16px' }}>
                    <ErrorBar message="Не удалось обновить карточку" onRetry={() => setAttempt(a => a + 1)} />
                </div>
            )}

            {/* Balance */}
            {balance && (
                <div style={{ padding: '0 16px' }}>
                    <SectionTitle>Баланс</SectionTitle>
                    <div style={{
                        background: 'var(--color-sunken)',
                        borderRadius: 14,
                        padding: 14,
                        display: 'flex',
                        gap: 12,
                    }}>
                        <Stat label="Всего оплачено" value={formatMoney(balance.totalPaid ?? 0, { currency: client.currency || 'GEL' })} />
                        {(balance.debt ?? 0) > 0 && (
                            <Stat label="Долг" value={formatMoney(balance.debt ?? 0, { currency: client.currency || 'GEL' })} tone="danger" />
                        )}
                        {(balance.prepayment ?? 0) > 0 && (
                            <Stat label="Аванс" value={formatMoney(balance.prepayment ?? 0, { currency: client.currency || 'GEL' })} tone="ok" />
                        )}
                    </div>
                </div>
            )}

            {/* Timeline — unified chronological feed: sessions, payments, notes */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <SectionTitle>История · {timeline.length}</SectionTitle>
                    <span style={{ fontSize: 12, color: 'var(--color-ink-60)', marginBottom: 8 }}>
                        {sessions.length} {plural(sessions.length, 'сессия', 'сессии', 'сессий')}
                        {' · '}{payments.length} {plural(payments.length, 'оплата', 'оплаты', 'оплат')}
                        {' · '}{notes.length} {plural(notes.length, 'заметка', 'заметки', 'заметок')}
                    </span>
                </div>
                {timeline.length === 0 ? (
                    <EmptyState
                        compact
                        title="История пока пуста"
                        hint="Сессии появятся здесь после записи в Google Календарь и синхронизации."
                    />
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {timeline.map(item => (
                            <TimelineRow key={`${item.kind}-${item.ts}-${(item as any)[item.kind].id}`} item={item} />
                        ))}
                    </div>
                )}
            </div>

            {/* Note about full editing */}
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    background: 'var(--color-sunken)',
                    color: 'var(--color-ink-80)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12,
                    lineHeight: 1.5,
                }}>
                    Редактировать заметки, платежи и настройки клиента удобнее на компьютере, в полной версии CRM.
                </div>
            </div>

            {/* CTA: new booking pre-linked to this client */}
            <div style={{ padding: '0 16px' }}>
                <Button
                    block
                    icon={<Plus size={16} aria-hidden="true" />}
                    onClick={() => navigate('/m/find')}
                >
                    Забронировать кабинет
                </Button>
            </div>
        </div>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-ink-60)',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'ok' }) {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'var(--color-ink-60)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                {label}
            </div>
            <div className="num" style={{
                fontSize: 16, fontWeight: 600,
                color: tone === 'danger' ? 'var(--status-danger-fg)' : tone === 'ok' ? 'var(--status-ok-fg)' : 'var(--color-ink)',
                marginTop: 2,
                lineHeight: 1.1,
            }}>
                {value}
            </div>
        </div>
    );
}

type TimelineItemUnion =
    | { kind: 'session'; ts: number; session: CrmSession }
    | { kind: 'payment'; ts: number; payment: CrmPayment }
    | { kind: 'note'; ts: number; note: CrmNote };

/** Single row in the unified client timeline. Icon + colour communicate the
 *  event kind at a glance so the specialist scans by silhouette, not text. */
function TimelineRow({ item }: { item: TimelineItemUnion }) {
    if (item.kind === 'session') {
        const s = item.session;
        const isCancelled = s.status?.startsWith('CANCELLED');
        const isPlanned = s.status === 'PLANNED';
        // Прошла, но не отмечена — как на экране дня: жёлтым, а не «Запланирована».
        const isUnmarked = isPlanned && item.ts + (s.durationMinutes ?? 60) * 60000 < Date.now();
        // Цвет — по тону статуса из общего словаря; «не отмечена» — янтарное «ждём».
        const tone = isUnmarked ? 'pending' : getStatusDef('session', s.status).tone;
        const color = { bg: `var(--status-${tone}-bg)`, fg: `var(--status-${tone}-fg)` };
        const Icon = isCancelled ? XCircle : isPlanned ? Clock : CheckCircle2;
        return (
            <div style={{
                background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
                borderRadius: 10, padding: '9px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
                opacity: isCancelled ? 0.75 : 1,
            }}>
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
            </div>
        );
    }
    if (item.kind === 'payment') {
        const p = item.payment;
        return (
            <div style={{
                background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
                borderRadius: 10, padding: '9px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
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
