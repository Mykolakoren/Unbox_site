import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Phone, MessageCircle, Mail, Plus } from 'lucide-react';
import { format as fmtDate } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { crmApi, type CrmClient, type CrmSession, type CrmPayment, type CrmNote } from '../../../api/crm';
import { parseUTC, formatBatumi } from '../../../utils/dateUtils';
import { CheckCircle2, Clock, XCircle, Wallet, FileText, Calendar as CalIcon } from 'lucide-react';

/**
 * Mobile CRM — single client card.
 *
 * Quick view: contact, balance summary, last 10 sessions, "Новая сессия" CTA.
 * Phone/email/Telegram all tap-to-act (`tel:`, `mailto:`, t.me link).
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

    useEffect(() => {
        if (!clientId) return;
        let cancelled = false;
        setLoading(true);
        Promise.all([
            crmApi.getClient(clientId),
            crmApi.getSessions({ clientId }),
            crmApi.getClientBalance(clientId).catch(() => null),
            crmApi.getPayments({ clientId }).catch(() => []),
            crmApi.getNotes(clientId).catch(() => []),
        ])
            .then(([c, ss, bal, pp, nn]) => {
                if (cancelled) return;
                setClient(c);
                setSessions(ss);
                setBalance(bal as any);
                setPayments(pp as CrmPayment[]);
                setNotes(nn as CrmNote[]);
            })
            .catch((e: any) => {
                const msg = e?.response?.data?.detail ?? e?.message ?? 'Не удалось загрузить';
                toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить');
            })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [clientId]);

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
            const t = (n as any).createdAt || (n as any).created_at;
            const ts = t ? new Date(t).getTime() : 0;
            if (Number.isFinite(ts) && ts > 0) out.push({ kind: 'note', ts, note: n });
        }
        return out.sort((a, b) => b.ts - a.ts).slice(0, 30);
    }, [sessions, payments, notes]);

    if (loading) {
        return <div style={{ padding: 20, color: '#666' }}>Загружаю…</div>;
    }
    if (!client) {
        return (
            <div style={{ padding: 20 }}>
                <div style={{ color: '#C8253A', fontSize: 14 }}>Клиент не найден.</div>
                <Link to="/m/crm/clients" style={{ color: '#0E0E0E', fontSize: 13 }}>← К списку клиентов</Link>
            </div>
        );
    }

    const phoneClean = client.phone?.replace(/\s/g, '');

    return (
        <div style={{ paddingTop: 12, paddingBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                    onClick={() => navigate('/m/crm/clients')}
                    style={{
                        background: '#F4F4F2',
                        border: 'none',
                        borderRadius: 10,
                        width: 36, height: 36,
                        display: 'grid', placeItems: 'center',
                        cursor: 'pointer',
                    }}
                >
                    <ArrowLeft size={18} />
                </button>
                <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, flex: 1, minWidth: 0 }}>
                    {client.aliasCode ? `${client.aliasCode} · ` : ''}{client.name}
                </h1>
            </div>

            {/* Contacts row */}
            <div style={{ padding: '0 16px', display: 'flex', gap: 8 }}>
                {phoneClean && (
                    <a href={`tel:${phoneClean}`} style={contactBtn}>
                        <Phone size={16} />
                        <span style={{ fontSize: 11 }}>Звонок</span>
                    </a>
                )}
                {client.telegram && (
                    <a
                        href={`https://t.me/${client.telegram.replace('@', '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ ...contactBtn, background: '#229ED9', color: '#fff' }}
                    >
                        <MessageCircle size={16} />
                        <span style={{ fontSize: 11 }}>Telegram</span>
                    </a>
                )}
                {client.email && (
                    <a href={`mailto:${client.email}`} style={contactBtn}>
                        <Mail size={16} />
                        <span style={{ fontSize: 11 }}>Email</span>
                    </a>
                )}
            </div>

            {/* Balance */}
            {balance && (
                <div style={{ padding: '0 16px' }}>
                    <SectionTitle>Баланс</SectionTitle>
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 14,
                        display: 'flex',
                        gap: 12,
                    }}>
                        <Stat label="Всего оплачено" value={`${(balance.totalPaid ?? 0).toFixed(0)}`} unit={client.currency || 'GEL'} />
                        {(balance.debt ?? 0) > 0 && (
                            <Stat label="Долг" value={`${(balance.debt ?? 0).toFixed(0)}`} unit={client.currency || 'GEL'} tone="danger" />
                        )}
                        {(balance.prepayment ?? 0) > 0 && (
                            <Stat label="Аванс" value={`${(balance.prepayment ?? 0).toFixed(0)}`} unit={client.currency || 'GEL'} tone="ok" />
                        )}
                    </div>
                </div>
            )}

            {/* Timeline — unified chronological feed: sessions, payments, notes */}
            <div style={{ padding: '0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <SectionTitle>История · {timeline.length}</SectionTitle>
                    <span style={{ fontSize: 10, color: '#999' }}>
                        {sessions.length}🗓 · {payments.length}💳 · {notes.length}📝
                    </span>
                </div>
                {timeline.length === 0 ? (
                    <div style={{ background: '#F4F4F2', borderRadius: 12, padding: 14, color: '#666', fontSize: 13, textAlign: 'center' }}>
                        История пуста. Создайте первую сессию.
                    </div>
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
                    background: '#FEF3C7',
                    border: '1px solid #FCD34D',
                    color: '#8A5A00',
                    borderRadius: 10,
                    padding: '10px 12px',
                    fontSize: 12,
                    lineHeight: 1.4,
                }}>
                    Редактирование заметок, история платежей и тонкие настройки — в десктопной CRM.
                </div>
            </div>

            {/* CTA: new booking pre-linked to this client */}
            <div style={{ padding: '0 16px' }}>
                <button
                    onClick={() => navigate('/m/find')}
                    style={{
                        width: '100%',
                        background: '#0E0E0E',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 14,
                        fontWeight: 700,
                    }}
                >
                    <Plus size={16} />
                    Забронировать кабинет
                </button>
            </div>
        </div>
    );
}

const contactBtn: React.CSSProperties = {
    flex: 1,
    background: '#fff',
    color: '#0E0E0E',
    border: '1px solid rgba(0,0,0,0.10)',
    borderRadius: 12,
    padding: '10px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
    fontFamily: 'inherit',
    fontSize: 11,
    fontWeight: 700,
    textDecoration: 'none',
    cursor: 'pointer',
};

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: '#999',
            marginBottom: 8,
        }}>{children}</div>
    );
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: 'danger' | 'ok' }) {
    return (
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#999', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 }}>
                {label}
            </div>
            <div style={{
                fontSize: 16, fontWeight: 700,
                color: tone === 'danger' ? '#C8253A' : tone === 'ok' ? '#1B6E36' : '#0E0E0E',
                marginTop: 2,
                lineHeight: 1.1,
            }}>
                {value}
                {unit && <span style={{ fontSize: 11, color: '#999', marginLeft: 3 }}>{unit}</span>}
            </div>
        </div>
    );
}

function statusLabel(s: string): string {
    if (s === 'COMPLETED') return 'Прошла';
    if (s === 'CANCELLED_CLIENT') return 'Отменил клиент';
    if (s === 'CANCELLED_THERAPIST') return 'Отменили вы';
    if (s === 'PLANNED') return 'Запланирована';
    return s;
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
        const color = isCancelled
            ? { bg: 'rgba(179,38,30,0.10)', fg: '#B3261E' }
            : isPlanned
                ? { bg: 'rgba(76,138,255,0.10)', fg: '#3F6BD8' }
                : { bg: 'rgba(76,138,107,0.10)', fg: '#1B7430' };
        const Icon = isCancelled ? XCircle : isPlanned ? Clock : CheckCircle2;
        return (
            <div style={{
                background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 10, padding: '9px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
                opacity: isCancelled ? 0.6 : 1,
            }}>
                <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: color.bg, color: color.fg,
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                    <Icon size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0E0E0E' }}>
                        Сессия · {statusLabel(s.status)}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                        {formatBatumi(s.date, 'd MMM, EEE HH:mm', ru)}
                        {s.price ? ` · ${s.price.toFixed(0)} ${s.currency || '₾'}` : ''}
                        {s.isPaid ? ' · оплачено' : ''}
                    </div>
                </div>
            </div>
        );
    }
    if (item.kind === 'payment') {
        const p = item.payment;
        return (
            <div style={{
                background: '#fff', border: '1px solid rgba(0,0,0,0.06)',
                borderRadius: 10, padding: '9px 12px',
                display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <div style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: 'rgba(76,138,107,0.10)', color: '#1B7430',
                    display: 'grid', placeItems: 'center', flexShrink: 0,
                }}>
                    <Wallet size={14} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#0E0E0E' }}>
                        Платёж · {(p.amount || 0).toFixed(0)} {p.currency || '₾'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                        {formatBatumi(p.date, 'd MMM HH:mm', ru)}
                        {p.account ? ` · ${p.account}` : ''}
                    </div>
                </div>
            </div>
        );
    }
    // note
    const n = item.note;
    const created = (n as any).createdAt || (n as any).created_at;
    return (
        <div style={{
            background: '#FFFBEB', border: '1px solid #FCD34D',
            borderRadius: 10, padding: '9px 12px',
            display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
            <div style={{
                width: 30, height: 30, borderRadius: 8,
                background: 'rgba(217,119,6,0.15)', color: '#92400E',
                display: 'grid', placeItems: 'center', flexShrink: 0,
            }}>
                <FileText size={14} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>Заметка</div>
                <div style={{ fontSize: 12, color: '#444', marginTop: 2, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>
                    {((n as any).text || '').slice(0, 140)}
                    {((n as any).text || '').length > 140 ? '…' : ''}
                </div>
                {created && (
                    <div style={{ fontSize: 10, color: '#8A5A00', marginTop: 3 }}>
                        {fmtDate(new Date(created), 'd MMM HH:mm', { locale: ru })}
                    </div>
                )}
            </div>
        </div>
    );
}
