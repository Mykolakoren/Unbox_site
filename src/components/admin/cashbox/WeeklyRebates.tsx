import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cashboxReportsApi, type WeeklyRebateReport } from '../../../api/cashbox';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { ErrorBar } from '../../ui/ErrorBar';
import { SkeletonList } from '../../ui/Skeleton';
import { COLOR, RADIUS, STATUS } from '../../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel } from '../../../utils/format';
import { ruCountWord } from '../../../utils/plural';

/** «2026-09-21» ± дни (календарно). */
function addDays(key: string, delta: number): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** «22–28 сент.» / «29 сент. – 5 окт.». */
function weekLabel(from: string, to: string): string {
    if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8, 10))}–${formatDayMonthShort(to, { withYear: 'auto' })}`;
    return `${formatDayMonthShort(from, { withYear: 'auto' })} – ${formatDayMonthShort(to, { withYear: 'auto' })}`;
}

const hours = (h: number) => `${String(Math.round(h * 10) / 10).replace('.', ',')} ч`;

/**
 * «Недельные скидки» в кассе (решение владельца 02.10): Валя больше не считает
 * скидку вручную по понедельникам. Список за неделю броней: клиент, часы,
 * процент, сумма и итог — из журнала начислений (GET /cashbox/weekly-rebates).
 * Скидку за неделю сервер начисляет сам в понедельник после неё; здесь только
 * показ. По умолчанию — прошлая неделя (её скидки начислены в последний понедельник).
 */
export function WeeklyRebates({ compact = false, clientPath }: {
    compact?: boolean;
    clientPath?: (emailOrId: string) => string;
}) {
    // null — неделю выбирает сервер (прошлая); дальше листаем от неё.
    const [week, setWeek] = useState<string | null>(null);
    const [latest, setLatest] = useState<string | null>(null);
    // Ответ хранится с ключом запроса (неделя или «прошлая»): поздний ответ
    // старого запроса отбрасывается, пока ключ не совпал — идёт загрузка.
    const key = week ?? 'latest';
    const [result, setResult] = useState<{ key: string; data?: WeeklyRebateReport; failed?: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        cashboxReportsApi.getWeeklyRebates(week ?? undefined)
            .then(r => {
                if (cancelled) return;
                setResult({ key, data: r });
                if (week === null) setLatest(r.weekStart);
            })
            .catch(() => { if (!cancelled) setResult({ key, failed: true }); });
        return () => { cancelled = true; };
    }, [week, key, attempt]);
    const retry = () => { setResult(null); setAttempt(n => n + 1); };

    const current = week ?? latest;
    const done = result && result.key === key ? result : null;
    const shown = done?.data ?? null;
    const failed = !!done?.failed;
    const canNext = !!current && !!latest && current < latest;

    return (
        <section aria-label="Недельные скидки" data-weekly-rebates style={{ display: 'flex', flexDirection: 'column', gap: 12, color: COLOR.ink }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Button
                    variant="quiet"
                    size={compact ? 'touch' : 'auto'}
                    icon={<ChevronLeft size={compact ? 20 : 16} aria-hidden="true" />}
                    aria-label="Предыдущая неделя"
                    disabled={!current}
                    onClick={() => current && setWeek(addDays(current, -7))}
                />
                <span aria-live="polite" style={{ fontSize: 16, fontWeight: 600, minWidth: compact ? 0 : 160, flex: compact ? 1 : undefined, textAlign: 'center' }}>
                    {shown ? `Неделя ${weekLabel(shown.weekStart, shown.weekEnd)}` : 'Неделя …'}
                </span>
                <Button
                    variant="quiet"
                    size={compact ? 'touch' : 'auto'}
                    icon={<ChevronRight size={compact ? 20 : 16} aria-hidden="true" />}
                    aria-label="Следующая неделя"
                    disabled={!canNext}
                    onClick={() => current && canNext && setWeek(addDays(current, 7))}
                />
                {week !== null && week !== latest && (
                    <Button variant="secondary" size={compact ? 'touch' : 'auto'} onClick={() => setWeek(null)}>Прошлая неделя</Button>
                )}
            </div>

            {failed && <ErrorBar message="Не удалось загрузить недельные скидки" onRetry={retry} />}

            {!shown ? (
                !failed && <SkeletonList count={3} label="Загружаем недельные скидки" cardHeight={48} />
            ) : (
                <>
                    <p style={{ margin: 0, fontSize: 14, color: COLOR.ink60, lineHeight: 1.5 }}>
                        Начисляются сами в понедельник после недели — {formatDayMonth(shown.creditedOn)} — на баланс клиента
                        и уже учтены в «к оплате». Вручную считать не нужно.
                    </p>
                    {shown.items.length === 0 ? (
                        <EmptyState compact title="За эту неделю скидок нет" hint="Скидка появляется, когда за неделю набирается достаточно часов." />
                    ) : (
                        <div style={{ border: `1px solid ${COLOR.ink10}`, borderRadius: compact ? 12 : RADIUS.grid, background: COLOR.card, overflow: 'hidden' }}>
                            {!compact && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px 110px', gap: 12, padding: '8px 16px', background: COLOR.ink05, fontSize: 12, color: COLOR.ink60, fontWeight: 600 }}>
                                    <span>Клиент</span>
                                    <span style={{ textAlign: 'right' }}>Часы</span>
                                    <span style={{ textAlign: 'right' }}>Скидка</span>
                                    <span style={{ textAlign: 'right' }}>Сумма</span>
                                </div>
                            )}
                            {shown.items.map(it => {
                                const name = clientPath ? (
                                    <Link to={clientPath(it.email || it.userId)} style={{ color: COLOR.ink, textDecoration: 'none' }}>{it.name}</Link>
                                ) : it.name;
                                return compact ? (
                                    <div key={it.userId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '10px 14px', borderTop: `1px solid ${COLOR.ink08}` }}>
                                        <span style={{ minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                            <span style={{ display: 'block', fontSize: 12, color: COLOR.ink60 }}>{hours(it.hours)} за неделю · скидка {it.percent}%</span>
                                        </span>
                                        <span className="num" style={{ fontSize: 14, fontWeight: 600, color: STATUS.ok.fg, whiteSpace: 'nowrap' }}>{formatGel(it.amount, { sign: true })}</span>
                                    </div>
                                ) : (
                                    <div key={it.userId} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 90px 90px 110px', gap: 12, padding: '10px 16px', borderTop: `1px solid ${COLOR.ink08}`, fontSize: 14, alignItems: 'baseline' }}>
                                        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                                        <span className="num" style={{ textAlign: 'right' }}>{hours(it.hours)}</span>
                                        <span className="num" style={{ textAlign: 'right' }}>{it.percent}%</span>
                                        <span className="num" style={{ textAlign: 'right', fontWeight: 600, color: STATUS.ok.fg }}>{formatGel(it.amount, { sign: true })}</span>
                                    </div>
                                );
                            })}
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: compact ? '10px 14px' : '10px 16px', borderTop: `1px solid ${COLOR.ink}`, fontSize: 14, fontWeight: 600 }}>
                                <span>Итого · {ruCountWord(shown.count, ['клиент', 'клиента', 'клиентов'])}</span>
                                <span className="num">{formatGel(shown.total)}</span>
                            </div>
                        </div>
                    )}
                </>
            )}
        </section>
    );
}
