import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { crmApi, type CrmSession } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { parseUTC, BATUMI_TZ } from '../../../utils/dateUtils';
import { SessionActionSheet } from './SessionActionSheet';
import { useCrmDataVersion } from './crmDataVersion';
import { Chip } from '../../../components/ui/Chip';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { statusLabel } from '../../../design/statuses';
import { formatDateLabel, formatMoney, formatTime } from '../../../utils/format';
import { ListGroup, ListRow, ListTime } from '../../../components/ui/ListRow';
import { Money } from '../../../components/ui/Money';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { CrmSearch } from './CrmSearch';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { addDaysYmd, tbilisiToday, utcNaiveToTbilisi } from '../../../utils/crmNextSession';
import { normalizeClientQuery, useBookNext } from './crmFlows';
import { Button } from '../../../components/ui/Button';
import {
    isBillableStatus, isCancelledStatus, partialPayment, sessionCurrencyOf, sessionDebt, sessionPriceOf,
} from '../../../utils/sessionMoney';

type Window = '7d' | '30d' | 'past7d' | 'past30d' | 'all';

// Ревью п. 15: «Будущие 7 дней» включали утренние, уже прошедшие сессии —
// называем честно «7 дней с сегодня»; «Прошедшие» путались со статусом.
const WINDOW_LABEL: Record<Window, string> = {
    '7d':     '7 дней с сегодня',
    '30d':    '30 дней с сегодня',
    'past7d': 'Прошлые 7 дней',
    'past30d':'Прошлые 30 дней',
    'all':    'Все даты',
};

type StatusFilter = 'all' | 'planned' | 'completed' | 'unpaid' | 'cancelled';


/**
 * Mobile CRM — Sessions list across all clients, filterable by period
 * and status. Complements /m/crm/today (single-day view) — used when
 * a specialist wants "all my upcoming" or "what did I cancel last
 * month" at a glance.
 *
 * Tap a row → SessionActionSheet (full controls + bottom sheet).
 *
 * Wave 1: заголовок экрана, фильтры полными словами, статус строки —
 * из общего словаря, суммы — formatMoney («140 ₾», не «140 GEL»),
 * загрузка/ошибка/пусто — Skeleton/ErrorBar/EmptyState.
 *
 * Волна 3: «Сессии» — вкладка. После действия в шторке шторка показывает
 * ТОТ ЖЕ обновлённый объект, а список обновляется в фоне без спиннера
 * (G6-09: раньше шторка оставалась «Не оплачено», и повторный тап давал
 * «Сессия уже отмечена оплаченной»). Прошедшие — от новых к старым (G6-17).
 * Период — по дням Батуми. «Записать следующую» — как на «Сегодня».
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
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    // Прошедшие сессии закрылись автоматически → статусы поменялись.
    const dataVersion = useCrmDataVersion();
    useDocumentTitle('Сессии · Psy-CRM');

    useEffect(() => {
        // 06.11: клиентов грузим всегда, не только при пустом списке — синк календаря
        // мог завести новую карточку, а в памяти страницы её нет (встреча «без имени»).
        fetchClients(false, true).catch(() => {});
    }, [fetchClients]);

    // Границы — календарные дни по Батуми. Сервер сравнивает с UTC, поэтому
    // начало берём на день раньше: сессия в 00:30 по Батуми не теряется.
    const range = useMemo(() => {
        const today = tbilisiToday();
        switch (period) {
            case '7d':       return { from: today, to: addDaysYmd(today, 7) };
            case '30d':      return { from: today, to: addDaysYmd(today, 30) };
            case 'past7d':   return { from: addDaysYmd(today, -7), to: today };
            case 'past30d':  return { from: addDaysYmd(today, -30), to: today };
            case 'all':      return { from: addDaysYmd(today, -365), to: addDaysYmd(today, 365) };
        }
    }, [period]);

    // Номер запроса: ответ за прошлый период не перезапишет новый.
    const reqSeq = useRef(0);
    /** quiet — обновить в фоне, не приглушая список (после действия в шторке). */
    const reload = async (quiet = false) => {
        const seq = ++reqSeq.current;
        if (!quiet) setLoading(true);
        try {
            const list = await crmApi.getSessions({ dateFrom: addDaysYmd(range.from, -1), dateTo: range.to });
            if (seq !== reqSeq.current) return;
            setSessions(list);
            setFailed(false);
        } catch {
            // Сбой — не «нет сессий»: прежний список не затираем.
            if (seq === reqSeq.current) setFailed(true);
        } finally {
            if (seq === reqSeq.current) setLoading(false);
        }
    };

    const bookNext = useBookNext(() => { reload(true); fetchClients(false, true).catch(() => {}); }, clients);
    const isPast = period === 'past7d' || period === 'past30d';

    useEffect(() => { reload(); }, [period, dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        const needle = normalizeClientQuery(q);
        const now = Date.now();
        return sessions
            .filter(s => {
                // Запрос взят с запасом в день — оставляем свои дни по Батуми.
                const day = utcNaiveToTbilisi(s.date)?.date;
                if (day && (day < range.from || day > range.to)) return false;
                if (statusFilter === 'planned' && s.status !== 'PLANNED') return false;
                if (statusFilter === 'completed' && s.status !== 'COMPLETED') return false;
                // «Неявка · оплачивается» — тоже отмена, но в долге: видна и в «Не оплачены».
                if (statusFilter === 'cancelled' && !isCancelledStatus(s.status) && s.status !== 'NO_SHOW') return false;
                if (statusFilter === 'unpaid') {
                    const owes = isBillableStatus(s.status) || (s.status === 'PLANNED' && parseUTC(s.date).getTime() <= now);
                    const client = clients.find(c => c.id === s.clientId);
                    if (!owes || s.isPaid || sessionDebt(s, client).amount <= 0) return false;
                }
                if (needle) {
                    const client = clients.find(c => c.id === s.clientId);
                    const hay = `${client?.name || ''} ${(client?.aliasCode || '').replace(/^#+/, '')} ${client?.phone || ''}`.toLowerCase();
                    if (!hay.includes(needle)) return false;
                }
                return true;
            })
            .sort((a, b) => {
                const ad = parseUTC(a.date).getTime();
                const bd = parseUTC(b.date).getTime();
                // Прошедшие — сначала свежие (G6-17), будущие — по порядку.
                return isPast ? bd - ad : ad - bd;
            });
    }, [sessions, statusFilter, q, clients, isPast, range]);

    const initialLoading = loading && sessions.length === 0 && !failed;

    // 09.11 фаза 3 (дизайн-ревью п. 3, 11): строки — общий ListRow, сгруппированы по дням
    // («Сегодня», «Завтра», «Пн, 16 ноября»), как брони клиента в /m/bookings.
    const groups = useMemo(() => {
        const out: { day: string; items: CrmSession[] }[] = [];
        for (const s of filtered) {
            const day = utcNaiveToTbilisi(s.date)?.date ?? '';
            const last = out[out.length - 1];
            if (last && last.day === day) last.items.push(s);
            else out.push({ day, items: [s] });
        }
        return out;
    }, [filtered]);
    const todayYmd = tbilisiToday();
    const dayTitle = (ymd: string) => ymd === todayYmd ? 'Сегодня'
        : ymd === addDaysYmd(todayYmd, 1) ? 'Завтра'
        : ymd === addDaysYmd(todayYmd, -1) ? 'Вчера'
        : formatDateLabel(ymd, { capitalize: true, withYear: 'auto' });

    return (
        <div style={{ paddingBottom: 90 }}>
            <MobilePageHeader
                variant="large"
                title="Сессии"
                subtitle={q.trim() && !initialLoading ? `Найдено: ${filtered.length}` : undefined}
                action={!viewingOther ? (
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => bookNext.open()}>
                        Сессия
                    </Button>
                ) : undefined}
            />

            <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {/* Фильтры — ряд, который листается вбок (затухание справа подсказывает, что есть ещё). */}
                <div role="group" aria-label="Период" className="ui-chip-row ui-chip-row--scroll">
                    {(['7d', '30d', 'past7d', 'past30d', 'all'] as Window[]).map(p => (
                        <Chip key={p} selected={period === p} onClick={() => setPeriod(p)} style={{ flexShrink: 0 }}>
                            {WINDOW_LABEL[p]}
                        </Chip>
                    ))}
                </div>
                <div role="group" aria-label="Статус" className="ui-chip-row ui-chip-row--scroll">
                    {([
                        { id: 'all', label: 'Все' },
                        { id: 'planned', label: 'Запланированные' },
                        { id: 'completed', label: 'Состоялись' },
                        { id: 'unpaid', label: 'Не оплачены' },
                        { id: 'cancelled', label: 'Отменённые' },
                    ] as { id: StatusFilter; label: string }[]).map(f => (
                        <Chip key={f.id} selected={statusFilter === f.id} onClick={() => setStatusFilter(f.id)} style={{ flexShrink: 0 }}>
                            {f.label}
                        </Chip>
                    ))}
                </div>
                <CrmSearch
                    value={q}
                    onChange={setQ}
                    label="Поиск: имя, код или телефон клиента"
                    placeholder="Имя, код, телефон"
                />
            </div>

            <div style={{ padding: '24px 16px 0' }}>
                {failed && !loading && (
                    <ErrorBar message="Не удалось загрузить сессии" onRetry={() => reload()} className="mb-3" />
                )}

                {initialLoading ? (
                    <SkeletonList count={5} label="Загружаем сессии" cardHeight={56} />
                ) : failed && sessions.length === 0 ? null : filtered.length === 0 ? (
                    <EmptyState compact title="В этом фильтре сессий нет" hint="Выберите другой период или статус." />
                ) : (
                    <div style={{ opacity: loading ? 0.6 : 1 }}>
                        {groups.map(g => (
                            <ListGroup key={g.day} title={dayTitle(g.day)} aside={`${g.items.length}`}>
                                {g.items.map(s => {
                                    const client = clients.find(c => c.id === s.clientId);
                                    const dt = parseUTC(s.date);
                                    const end = new Date(dt.getTime() + (s.durationMinutes || 60) * 60000);
                                    const isCancelled = isCancelledStatus(s.status);
                                    const isFuture = dt.getTime() > Date.now();
                                    const cur = sessionCurrencyOf(s, client);
                                    // Ревью п. 1, 8: одна цена (своя или ставка клиента) и частичная оплата.
                                    const price = sessionPriceOf(s, client);
                                    const partial = partialPayment(s, client);
                                    const owes = !s.isPaid && (isBillableStatus(s.status)
                                        || (s.status === 'PLANNED' && dt.getTime() <= Date.now()))
                                        && sessionDebt(s, client).amount > 0;
                                    // «Запланирована» — обычное состояние, её не пишем; пишем только особое.
                                    const statusWord = s.status === 'PLANNED' ? '' : statusLabel('session', s.status);
                                    const sub = [
                                        statusWord,
                                        partial ? `оплачено ${formatMoney(partial.paid, { currency: cur })} из ${formatMoney(partial.price, { currency: cur })}` : '',
                                    ].filter(Boolean).join(' · ');
                                    return (
                                        <ListRow
                                            key={s.id}
                                            dimmed={isCancelled}
                                            lead={<ListTime start={formatTime(dt, { timeZone: BATUMI_TZ })} end={formatTime(end, { timeZone: BATUMI_TZ })} />}
                                            title={client?.name || 'Клиент'}
                                            subtitle={sub || undefined}
                                            onClick={() => setActiveSheet(s)}
                                            trail={owes ? (
                                                <Money value={partial ? partial.remaining : sessionDebt(s, client).amount} currency={cur} tone="debt" />
                                            ) : price > 0 && !isCancelled ? (
                                                <span style={isFuture ? { color: 'var(--color-ink-60)', fontWeight: 500 } : undefined}>
                                                    <Money value={price} currency={cur} />
                                                </span>
                                            ) : undefined}
                                            meta={owes ? (
                                                <StatusBadge kind="payment" status={partial ? 'partial' : 'unpaid'} variant="dot" />
                                            ) : undefined}
                                        />
                                    );
                                })}
                            </ListGroup>
                        ))}
                    </div>
                )}
            </div>

            {activeSheet && (
                <SessionActionSheet
                    session={activeSheet}
                    client={clients.find(c => c.id === activeSheet.clientId)}
                    onClose={() => setActiveSheet(null)}
                    onChange={(updated) => {
                        // G6-09: шторка показывает тот же обновлённый объект,
                        // список подменяем сразу и тихо перечитываем.
                        setSessions(prev => prev.map(x => x.id === updated.id ? updated : x));
                        setActiveSheet(updated);
                        reload(true);
                    }}
                    onDeleted={(id) => {
                        setSessions(prev => prev.filter(x => x.id !== id));
                        setActiveSheet(null);
                        reload(true);
                    }}
                    onBookNext={viewingOther ? undefined : (s) => {
                        setActiveSheet(null);
                        bookNext.open(clients.find(c => c.id === s.clientId) ?? null, s);
                    }}
                />
            )}
            {bookNext.sheet}
        </div>
    );
}
