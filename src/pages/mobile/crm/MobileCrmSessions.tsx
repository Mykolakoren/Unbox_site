import { useEffect, useMemo, useState } from 'react';
import { Search, CheckCircle2, XCircle, Clock, X } from 'lucide-react';
import { format as fmtDate, addDays } from 'date-fns';
import { crmApi, type CrmSession } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';
import { useCrmDataVersion } from './crmDataVersion';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { getStatusDef, statusLabel } from '../../../design/statuses';
import { COLOR } from '../../../design/tokens';
import { formatDayMonth, formatMoney, formatTime } from '../../../utils/format';

type Window = '7d' | '30d' | 'past7d' | 'past30d' | 'all';

const WINDOW_LABEL: Record<Window, string> = {
    '7d':     'Будущие 7 дней',
    '30d':    'Будущие 30 дней',
    'past7d': 'Прошедшие 7 дней',
    'past30d':'Прошедшие 30 дней',
    'all':    'Все даты',
};

type StatusFilter = 'all' | 'planned' | 'completed' | 'cancelled';

/** Цвет плашки-значка — по тону статуса из общего словаря (statuses.ts). */
const TONE_BG: Record<string, { bg: string; fg: string }> = {
    ok: { bg: 'var(--status-ok-bg)', fg: 'var(--status-ok-fg)' },
    pending: { bg: 'var(--status-pending-bg)', fg: 'var(--status-pending-fg)' },
    danger: { bg: 'var(--status-danger-bg)', fg: 'var(--status-danger-fg)' },
    info: { bg: 'var(--status-info-bg)', fg: 'var(--status-info-fg)' },
    muted: { bg: 'var(--status-muted-bg)', fg: 'var(--status-muted-fg)' },
};

/**
 * Mobile CRM — Sessions list across all clients, filterable by period
 * and status. Complements /m/crm/today (single-day view) — used when
 * a specialist wants "all my upcoming" or "what did I cancel last
 * month" at a glance.
 *
 * Tap a row → SessionActionSheet (full controls + bottom sheet).
 *
 * Wave 1: заголовок экрана, фильтры полными словами («Заплан./Завер./
 * Отмен.» → «Запланированные / Прошедшие / Отменённые»), статус строки —
 * из общего словаря, суммы — formatMoney («140 ₾», не «140 GEL»),
 * загрузка/ошибка/пусто — Skeleton/ErrorBar/EmptyState.
 */
export function MobileCrmSessions() {
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [activeSheet, setActiveSheet] = useState<CrmSession | null>(null);
    const [period, setPeriod] = useState<Window>('7d');
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
    const [q, setQ] = useState('');
    const { clients, fetchClients } = useCrmStore();
    // Прошедшие сессии закрылись автоматически → статусы поменялись.
    const dataVersion = useCrmDataVersion();

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
            setFailed(false);
        } catch {
            // Сбой — не «нет сессий»: прежний список не затираем.
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { reload(); }, [period, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

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

    const initialLoading = loading && sessions.length === 0 && !failed;

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '2px 2px 12px' }}>
                Все сессии
            </h1>

            {/* Period chips */}
            <div role="group" aria-label="Период" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 8, paddingBottom: 4 }}>
                {(['7d', '30d', 'past7d', 'past30d', 'all'] as Window[]).map(p => (
                    <Chip key={p} selected={period === p} onClick={() => setPeriod(p)} style={{ flexShrink: 0 }}>
                        {WINDOW_LABEL[p]}
                    </Chip>
                ))}
            </div>

            {/* Status filter */}
            <div role="group" aria-label="Статус" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10, paddingBottom: 4 }}>
                {([
                    { id: 'all', label: 'Все' },
                    { id: 'planned', label: 'Запланированные' },
                    { id: 'completed', label: 'Прошедшие' },
                    { id: 'cancelled', label: 'Отменённые' },
                ] as { id: StatusFilter; label: string }[]).map(f => (
                    <Chip key={f.id} selected={statusFilter === f.id} onClick={() => setStatusFilter(f.id)} style={{ flexShrink: 0 }}>
                        {f.label}
                    </Chip>
                ))}
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
                <Search size={16} color={COLOR.ink60} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14 }} />
                <input
                    type="text"
                    aria-label="Поиск по клиенту или коду"
                    placeholder="Клиент или код"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    style={{
                        width: '100%',
                        minHeight: 44,
                        padding: '10px 44px 10px 36px',
                        border: '1px solid var(--color-ink-20)',
                        borderRadius: 8,
                        fontSize: 16,
                        background: 'var(--color-card)',
                        color: 'var(--color-ink)',
                        outline: 'none',
                    }}
                />
                {q && (
                    <button
                        onClick={() => setQ('')}
                        aria-label="Очистить поиск"
                        style={{
                            position: 'absolute', right: 0, top: 0, width: 44, height: 44,
                            display: 'grid', placeItems: 'center',
                            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-ink-60)',
                        }}
                    >
                        <X size={16} aria-hidden="true" />
                    </button>
                )}
            </div>

            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-ink-60)',
                marginBottom: 8,
            }}>
                Сессий: {initialLoading ? '—' : filtered.length}
            </div>

            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить сессии" onRetry={reload} className="mb-3" />
            )}

            {initialLoading ? (
                <SkeletonList count={5} label="Загружаем сессии" cardHeight={56} />
            ) : failed && sessions.length === 0 ? null : filtered.length === 0 ? (
                <EmptyState compact title="В этом фильтре сессий нет" hint="Выберите другой период или статус." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: loading ? 0.6 : 1 }}>
                    {filtered.map(s => {
                        const client = clients.find(c => c.id === s.clientId);
                        const dt = parseUTC(s.date as any);
                        const isCancelled = (s.status || '').startsWith('CANCELLED');
                        const isCompleted = s.status === 'COMPLETED';
                        const tone = TONE_BG[getStatusDef('session', s.status).tone];
                        const cur = s.currency || client?.currency || 'GEL';
                        return (
                            <button
                                key={s.id}
                                onClick={() => setActiveSheet(s)}
                                className="press"
                                style={{
                                    background: 'var(--color-card)',
                                    border: '1px solid var(--color-ink-08)',
                                    borderRadius: 10,
                                    padding: '10px 12px',
                                    minHeight: 56,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'left',
                                    width: '100%',
                                    opacity: isCancelled ? 0.7 : 1,
                                }}
                            >
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: tone.bg,
                                    color: tone.fg,
                                    display: 'grid', placeItems: 'center',
                                    flexShrink: 0,
                                }}>
                                    {isCancelled ? <XCircle size={16} aria-hidden="true" />
                                        : isCompleted ? <CheckCircle2 size={16} aria-hidden="true" />
                                        : <Clock size={16} aria-hidden="true" />}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontWeight: 600, fontSize: 14, color: 'var(--color-ink)',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {client?.aliasCode ? `${client.aliasCode} · ` : ''}{client?.name || 'Клиент'}
                                        {!s.isPaid && isCompleted && (
                                            <span style={{ color: 'var(--status-danger-fg)', fontWeight: 600, marginLeft: 4 }}>
                                                · {statusLabel('payment', 'unpaid')}
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                                        {formatDayMonth(dt, { timeZone: BATUMI_TZ })}, {formatTime(dt, { timeZone: BATUMI_TZ })}
                                        {' · '}{statusLabel('session', s.status)}
                                        {s.price ? ` · ${formatMoney(s.price, { currency: cur })}` : ''}
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
