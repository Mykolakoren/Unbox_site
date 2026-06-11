import { useEffect, useMemo, useState } from 'react';
import { Loader2, Calendar as CalendarIcon, Search, CheckCircle2, XCircle, Clock, X } from 'lucide-react';
import { format as fmtDate, addDays, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { crmApi, type CrmSession } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { parseUTC, formatBatumi } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';

type Window = '7d' | '30d' | 'past7d' | 'past30d' | 'all';

const WINDOW_LABEL: Record<Window, string> = {
    '7d':     'Будущие 7 дней',
    '30d':    'Будущие 30 дней',
    'past7d': 'Прошедшие 7 дней',
    'past30d':'Прошедшие 30 дней',
    'all':    'Всё',
};

type StatusFilter = 'all' | 'planned' | 'completed' | 'cancelled';

/**
 * Mobile CRM — Sessions list across all clients, filterable by period
 * and status. Complements /m/crm/today (single-day view) — used when
 * a specialist wants "all my upcoming" or "what did I cancel last
 * month" at a glance.
 *
 * Tap a row → SessionActionSheet (full controls + bottom sheet).
 */
export function MobileCrmSessions() {
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeSheet, setActiveSheet] = useState<CrmSession | null>(null);
    const [period, setPeriod] = useState<Window>('7d');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [q, setQ] = useState('');
    const { clients, fetchClients } = useCrmStore();

    useEffect(() => {
        if (clients.length === 0) fetchClients(true).catch(() => {});
    }, [clients.length, fetchClients]);

    const range = useMemo(() => {
        const today = new Date();
        switch (period) {
            case '7d':       return { from: today, to: addDays(today, 7) };
            case '30d':      return { from: today, to: addDays(today, 30) };
            case 'past7d':   return { from: addDays(today, -7), to: today };
            case 'past30d':  return { from: addDays(today, -30), to: today };
            case 'all':      return { from: addDays(today, -365), to: addDays(today, 365) };
        }
    }, [period]);

    const reload = async () => {
        setLoading(true);
        try {
            const list = await crmApi.getSessions({
                dateFrom: fmtDate(range.from, 'yyyy-MM-dd'),
                dateTo: fmtDate(range.to, 'yyyy-MM-dd'),
            });
            setSessions(list);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return sessions
            .filter(s => {
                if (statusFilter === 'planned' && s.status !== 'PLANNED') return false;
                if (statusFilter === 'completed' && s.status !== 'COMPLETED') return false;
                if (statusFilter === 'cancelled' && !s.status?.startsWith('CANCELLED')) return false;
                if (needle) {
                    const client = clients.find(c => c.id === s.clientId);
                    const hay = `${client?.name || ''} ${client?.aliasCode || ''}`.toLowerCase();
                    if (!hay.includes(needle)) return false;
                }
                return true;
            })
            .sort((a, b) => {
                const ad = parseUTC(a.date as any).getTime();
                const bd = parseUTC(b.date as any).getTime();
                return ad - bd;
            });
    }, [sessions, statusFilter, q, clients]);

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            {/* Period chips */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 4 }}>
                {(['7d', '30d', 'past7d', 'past30d', 'all'] as Window[]).map(p => (
                    <button
                        key={p}
                        onClick={() => setPeriod(p)}
                        style={{
                            flexShrink: 0,
                            padding: '7px 12px',
                            borderRadius: 999,
                            border: period === p ? '1px solid #0E0E0E' : '1px solid rgba(0,0,0,0.12)',
                            background: period === p ? '#0E0E0E' : '#fff',
                            color: period === p ? '#fff' : '#0E0E0E',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {WINDOW_LABEL[p]}
                    </button>
                ))}
            </div>

            {/* Status filter */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {([
                    { id: 'all', label: 'Все' },
                    { id: 'planned', label: 'Заплан.' },
                    { id: 'completed', label: 'Завер.' },
                    { id: 'cancelled', label: 'Отмен.' },
                ] as { id: StatusFilter; label: string }[]).map(f => (
                    <button
                        key={f.id}
                        onClick={() => setStatusFilter(f.id)}
                        style={{
                            flex: 1,
                            padding: '6px 0',
                            background: statusFilter === f.id ? '#0E0E0E' : 'rgba(0,0,0,0.04)',
                            color: statusFilter === f.id ? '#fff' : '#0E0E0E',
                            border: 'none',
                            borderRadius: 7,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        {f.label}
                    </button>
                ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={13} style={{ position: 'absolute', left: 11, top: 10, color: '#888' }} />
                <input
                    type="text"
                    placeholder="Клиент или код"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '8px 12px 8px 30px',
                        border: '1px solid rgba(0,0,0,0.1)',
                        borderRadius: 8,
                        fontSize: 13,
                        outline: 'none',
                    }}
                />
                {q && (
                    <button
                        onClick={() => setQ('')}
                        style={{
                            position: 'absolute', right: 8, top: 8,
                            background: 'none', border: 'none', cursor: 'pointer', color: '#888',
                        }}
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#888',
                marginBottom: 8,
            }}>
                Сессий: {filtered.length}
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : filtered.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>
                    Нет сессий в этом фильтре
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {filtered.map(s => {
                        const client = clients.find(c => c.id === s.clientId);
                        const dt = parseUTC(s.date as any);
                        const isPast = dt < new Date();
                        const isCancelled = (s.status || '').startsWith('CANCELLED');
                        const isCompleted = s.status === 'COMPLETED';
                        return (
                            <button
                                key={s.id}
                                onClick={() => setActiveSheet(s)}
                                style={{
                                    background: '#fff',
                                    border: '1px solid rgba(0,0,0,0.06)',
                                    borderRadius: 10,
                                    padding: '10px 12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'left',
                                    width: '100%',
                                    opacity: isCancelled ? 0.55 : 1,
                                }}
                            >
                                <div style={{
                                    width: 30, height: 30, borderRadius: 8,
                                    background:
                                        isCancelled ? 'rgba(179,38,30,0.10)' :
                                        isCompleted ? 'rgba(76,138,107,0.10)' :
                                                       'rgba(76,138,255,0.10)',
                                    color:
                                        isCancelled ? '#B3261E' :
                                        isCompleted ? '#1B7430' :
                                                      '#3F6BD8',
                                    display: 'grid', placeItems: 'center',
                                    flexShrink: 0,
                                }}>
                                    {isCancelled ? <XCircle size={14} />
                                        : isCompleted ? <CheckCircle2 size={14} />
                                        : <Clock size={14} />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontWeight: 600, fontSize: 13, color: '#0E0E0E',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {client?.aliasCode ? `${client.aliasCode} · ` : ''}{client?.name || 'Клиент'}
                                        {!s.isPaid && isCompleted && (
                                            <span style={{ color: '#B3261E', fontWeight: 700, marginLeft: 4 }}>· не оплачено</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                        {formatBatumi(dt, 'd MMM, HH:mm', ru)} · {isPast ? 'прошла' : 'предстоит'}
                                        {s.price ? ` · ${s.price.toFixed(0)} ${client?.currency || '₾'}` : ''}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {activeSheet && (
                <SessionActionSheet
                    session={activeSheet}
                    client={clients.find(c => c.id === activeSheet.clientId)}
                    onClose={() => setActiveSheet(null)}
                    onChange={() => { reload(); }}
                    onDeleted={() => { reload(); setActiveSheet(null); }}
                />
            )}
        </div>
    );
}
