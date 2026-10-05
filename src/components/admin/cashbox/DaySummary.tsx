import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cashboxReportsApi, type CashboxDaySummary, type DayBranchBlock, type DayCorrection, type DayMoney, type DayShift } from '../../../api/cashbox';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Field';
import { ErrorBar } from '../../ui/ErrorBar';
import { SkeletonList } from '../../ui/Skeleton';
import { COLOR, RADIUS, STATUS } from '../../../design/tokens';
import { formatDayMonth, formatGel, formatRelativeDay, formatTime } from '../../../utils/format';
import { BATUMI_TZ, parseUTC } from '../../../utils/dateUtils';
import { batumiDayKey } from '../../../utils/adminToday';
import { ruCountWord } from '../../../utils/plural';

/** Подсказка под блоком — одна на компьютере и телефоне (решение владельца 02.10). */
export const DAY_SUMMARY_HINT = 'Сверка с таблицей: сравните наличные, TBC и BOG по филиалу';

/** «2026-10-01» ± дни (календарно, без часовых поясов). */
function addDays(key: string, delta: number): string {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** «Сегодня, 2 октября» / «Вчера, 1 октября» / «ср, 30 сент.». */
function dayLabel(key: string): string {
    // «Сегодня» — по Тбилиси, а не по поясу браузера (иначе вне Грузии «Завтра»).
    const rel = formatRelativeDay(key, { capitalize: true, timeZone: BATUMI_TZ });
    return rel === 'Сегодня' || rel === 'Вчера' ? `${rel}, ${formatDayMonth(key)}` : rel;
}

const METHODS: { key: keyof Pick<DayMoney, 'cash' | 'cardTbc' | 'cardBog'>; label: string }[] = [
    { key: 'cash', label: 'Наличные' },
    { key: 'cardTbc', label: 'TBC' },
    { key: 'cardBog', label: 'BOG' },
];

/**
 * «Итоги дня» в кассе (решение владельца 02.10): админы сверяют день с сайтом,
 * а не со своим Excel. Компьютер (вкладка кассы) и телефон — один компонент.
 *
 * Все цифры считает сервер (GET /cashbox/day-summary → services/day_summary.py,
 * та же функция идёт в ежедневную сводку в Telegram). Здесь только показ.
 * День — по Тбилиси, по умолчанию сегодня; филиал — фильтр кассы (пусто — все).
 */
export function DaySummary({
    branch, compact = false, clientPath, reloadKey = 0,
}: {
    /** Филиал кассы; undefined — все филиалы. */
    branch?: string;
    /** Меняется после записи/правки операции или смены — итоги перечитываются,
     *  чтобы админ видел свою операцию и не внёс её второй раз. */
    reloadKey?: number;
    /** Телефон: карточки одна под другой, скругления как у мобильных карточек. */
    compact?: boolean;
    /** Ссылка на карточку клиента (почта или id) — в списке должников. */
    clientPath?: (emailOrId: string) => string;
}) {
    const today = batumiDayKey();
    const [day, setDay] = useState(today);
    // Ответ хранится вместе с ключом запроса (день + филиал): пока ключ не совпал
    // с текущим — идёт загрузка; быстро листают дни — поздний ответ старого
    // запроса отбрасывается (cancelled) и чужие цифры не показываются.
    const key = `${day}|${branch ?? ''}`;
    const [result, setResult] = useState<{ key: string; data?: CashboxDaySummary; failed?: boolean } | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let cancelled = false;
        cashboxReportsApi.getDaySummary({ date: day, branch })
            .then(r => { if (!cancelled) setResult({ key, data: r }); })
            .catch(() => { if (!cancelled) setResult({ key, failed: true }); });
        return () => { cancelled = true; };
    }, [day, branch, key, attempt, reloadKey]);
    const retry = () => { setResult(null); setAttempt(n => n + 1); };

    const isToday = day === today;
    const current = result && result.key === key ? result : null;
    const shown = current?.data ?? null;
    const failed = !!current?.failed;
    const radius = compact ? 12 : RADIUS.grid;

    return (
        <section aria-label="Итоги дня" data-day-summary style={{ display: 'flex', flexDirection: 'column', gap: 12, color: COLOR.ink }}>
            {/* Выбор дня: ‹ день › + «Сегодня» + календарь (на телефоне — второй строкой). */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                <Button
                    variant="quiet"
                    size={compact ? 'touch' : 'auto'}
                    icon={<ChevronLeft size={compact ? 20 : 16} aria-hidden="true" />}
                    aria-label="Предыдущий день"
                    onClick={() => setDay(d => addDays(d, -1))}
                />
                <span aria-live="polite" style={{ fontSize: 16, fontWeight: 600, minWidth: compact ? 0 : 200, flex: compact ? 1 : undefined, textAlign: 'center' }}>
                    {dayLabel(day)}
                </span>
                <Button
                    variant="quiet"
                    size={compact ? 'touch' : 'auto'}
                    icon={<ChevronRight size={compact ? 20 : 16} aria-hidden="true" />}
                    aria-label="Следующий день"
                    disabled={day >= today}
                    onClick={() => setDay(d => (d >= today ? d : addDays(d, 1)))}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: compact ? '1 0 100%' : undefined, marginLeft: compact ? 0 : 'auto' }}>
                    {!isToday && (
                        <Button variant="secondary" size={compact ? 'touch' : 'auto'} onClick={() => setDay(today)}>Сегодня</Button>
                    )}
                    <Input
                        kind="date"
                        aria-label="Выбрать день"
                        value={day}
                        max={today}
                        onChange={e => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setDay(e.target.value > today ? today : e.target.value); }}
                        style={{ width: compact ? undefined : 160, flex: compact ? 1 : undefined, minWidth: 0 }}
                    />
                </div>
            </div>

            {failed && (
                <ErrorBar message="Не удалось загрузить итоги дня" onRetry={retry} />
            )}

            {shown && branch && shown.unassigned.count > 0 && (
                <div role="note" data-day-summary-unassigned style={{
                    padding: '10px 14px', background: STATUS.pending.bg, color: STATUS.pending.fg,
                    borderRadius: compact ? 12 : RADIUS.grid, fontSize: 14, lineHeight: 1.45,
                }}>
                    Есть {ruCountWord(shown.unassigned.count, ['операция', 'операции', 'операций'])} без филиала
                    за этот день — они видны только во «Все»
                </div>
            )}

            {!shown ? (
                !failed && <SkeletonList count={compact ? 2 : 1} label="Считаем итоги дня" cardHeight={compact ? 160 : 200} />
            ) : (
                <>
                    <div style={{
                        display: 'grid', gap: 12,
                        gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(300px, 1fr))',
                    }}>
                        {shown.branches.map(b => (
                            <BranchCard key={b.branch ?? '—'} block={b} isToday={shown.isToday} day={shown.date} radius={radius} />
                        ))}
                        {shown.branches.length > 1 && (
                            <TotalCard total={shown.total} radius={radius} />
                        )}
                    </div>
                    <CommonCard data={shown} radius={radius} clientPath={clientPath} />
                    <ClientsCard data={shown} radius={radius} clientPath={clientPath} />
                </>
            )}

            <p data-day-summary-hint style={{ margin: 0, fontSize: 14, color: COLOR.ink60, lineHeight: 1.5 }}>
                {DAY_SUMMARY_HINT}
            </p>
        </section>
    );
}

// ── Карточки ─────────────────────────────────────────────────────────────

function Card({ title, aside, radius, children }: { title: ReactNode; aside?: ReactNode; radius: number; children: ReactNode }) {
    return (
        <div style={{ border: `1px solid ${COLOR.ink10}`, background: COLOR.card, borderRadius: radius, padding: '12px 16px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
                {aside}
            </div>
            {children}
        </div>
    );
}

/** Строка «подпись … сумма»; sub — пояснение мельче под ней. */
function Line({ label, value, sub, tone, strong = true, text = false }: {
    label: ReactNode; value?: ReactNode; sub?: ReactNode; tone?: string; strong?: boolean;
    /** Значение — слова, а не сумма: обычный шрифт, перенос строк. */
    text?: boolean;
}) {
    return (
        <div style={{ padding: '8px 0', borderTop: `1px solid ${COLOR.ink08}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <span style={{ fontSize: 14, fontWeight: strong ? 600 : 400 }}>{label}</span>
                {value !== undefined && (
                    <span
                        className={text ? undefined : 'num'}
                        style={{
                            fontSize: strong && !text ? 16 : 14, fontWeight: strong ? 600 : 400, color: tone || COLOR.ink,
                            whiteSpace: text ? 'normal' : 'nowrap', textAlign: 'right',
                        }}
                    >
                        {value}
                    </span>
                )}
            </div>
            {sub && <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2, lineHeight: 1.45 }}>{sub}</div>}
        </div>
    );
}

/** «Наличные 150 ₾ · TBC 179,5 ₾ · BOG 41 ₾» — всегда все три счёта (для сверки). */
function ByMethod({ money }: { money: DayMoney }) {
    return (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {METHODS.map(m => (
                <span key={m.key} style={{ whiteSpace: 'nowrap' }}>
                    {m.label} <span className="num" style={{ color: COLOR.ink }}>{formatGel(money[m.key])}</span>
                </span>
            ))}
        </span>
    );
}

/** «расхождение смены +2 ₾ — в «пришло» не входит» (только если было). */
function correctionNote(c: DayCorrection, what: string): string | null {
    if (!c || c.count === 0) return null;
    return `${what} ${formatGel(c.net, { sign: true })} — в «пришло» и «ушло» не входит`;
}

/** «Переводы между счетами 500 ₾ — …» — сумма по приходной половине перевода. */
function transferNote(c: DayCorrection | undefined): string | null {
    if (!c || c.count === 0) return null;
    return `Переводы между счетами ${formatGel(c.income || c.expense)} — в «пришло» и «ушло» не входят`;
}

/** Подсказка под «Списано с балансов» (ревизия 02.10): брони считаются по их
 *  нынешней дате, поэтому перенос брони меняет итог того дня. */
const CHARGES_SCHEDULE_HINT = 'по текущему расписанию: перенос брони меняет итог того дня';

function BranchCard({ block, isToday, day, radius }: { block: DayBranchBlock; isToday: boolean; day: string; radius: number }) {
    const notes = [
        correctionNote(block.shiftRecon, 'Расхождение смены'),
        correctionNote(block.balanceFix, 'Корректировка остатка'),
        transferNote(block.transfer),
    ].filter(Boolean) as string[];
    return (
        <Card title={block.branch || 'Без филиала'} radius={radius}>
            <Line
                label="Пришло за день"
                value={formatGel(block.income.total)}
                sub={<>
                    <ByMethod money={block.income} />
                    {notes.map(n => <span key={n} style={{ display: 'block', marginTop: 2 }}>{n}</span>)}
                </>}
            />
            <Line
                label="Ушло"
                value={block.expense.total > 0 ? formatGel(-block.expense.total) : formatGel(0)}
                sub={block.expense.count > 0 ? <ByMethod money={block.expense} /> : 'Расходов не было'}
            />
            <Line
                label="Списано с балансов клиентов"
                value={formatGel(block.charges.net)}
                sub={<>{chargesSub(block.charges)}<span style={{ display: 'block', marginTop: 2 }}>{CHARGES_SCHEDULE_HINT}</span></>}
            />
            {block.shift && <ShiftLine shift={block.shift} isToday={isToday} day={day} />}
        </Card>
    );
}

function chargesSub(c: DayBranchBlock['charges']): string {
    if (c.charged === 0 && c.refunded === 0) return 'За брони этого дня с баланса ничего не списано';
    const parts = [`за ${ruCountWord(c.bookings, ['бронь', 'брони', 'броней'])} этого дня`];
    if (c.refunded !== 0) parts.push(`списано ${formatGel(c.charged)}, возвраты ${formatGel(c.refunded, { sign: true })}`);
    return parts.join(' · ');
}

function ShiftLine({ shift, isToday, day }: { shift: DayShift; isToday: boolean; day: string }) {
    /** «в 21:45» — в этот день; «1 октября в 21:45» — в другой (по Тбилиси). */
    const at = (iso: string | null) => {
        if (!iso) return '';
        const d = parseUTC(iso);
        const time = formatTime(d, { timeZone: BATUMI_TZ });
        return batumiDayKey(d) === day ? `в ${time}` : `${formatDayMonth(d, { timeZone: BATUMI_TZ })} в ${time}`;
    };
    let text: string;
    let tone: string;
    if (shift.status === 'open') {
        text = `Открыта ${at(shift.openedAt).replace(/^в /, 'с ')}${shift.openedBy ? ` · ${shift.openedBy}` : ''}`;
        tone = STATUS.ok.fg;
    } else if (shift.status === 'closed') {
        text = `Закрыта ${at(shift.closedAt)}${shift.closedBy ? ` · ${shift.closedBy}` : ''}`;
        tone = COLOR.ink;
    } else {
        text = isToday ? 'Ещё не закрыта' : 'В этот день не закрывали';
        tone = STATUS.pending.fg;
    }
    const disc = shift.discrepancy ?? 0;
    const discTone = Math.abs(disc) < 0.01 ? STATUS.ok.fg : disc > 0 ? STATUS.pending.fg : STATUS.danger.fg;
    return (
        <Line
            label="Смена"
            text
            tone={tone}
            value={text}
            sub={shift.closedAt && shift.closedAllBranches ? (
                <span>закрыли общую смену по всем филиалам — цифры смотрите в «Сменах»</span>
            ) : shift.closedAt ? (
                <span>
                    {shift.status === 'open' && <>закрывали {at(shift.closedAt)} · </>}
                    ожидалось <span className="num" style={{ color: COLOR.ink }}>{formatGel(shift.expected)}</span>
                    {' · '}по факту <span className="num" style={{ color: COLOR.ink }}>{formatGel(shift.actual)}</span>
                    {' · '}расхождение <span className="num" style={{ color: discTone, fontWeight: 600 }}>
                        {Math.abs(disc) < 0.01 ? formatGel(0) : formatGel(disc, { sign: true })}
                    </span>
                    {shift.closes > 1 && <> · закрывали {shift.closes} раза</>}
                </span>
            ) : (
                <span>
                    наличных по записям {isToday ? 'сейчас' : 'на конец дня'}{' '}
                    <span className="num" style={{ color: COLOR.ink }}>{formatGel(shift.cashByRecords)}</span>
                </span>
            )}
        />
    );
}

function TotalCard({ total, radius }: { total: CashboxDaySummary['total']; radius: number }) {
    return (
        <Card title="Всего по филиалам" radius={radius}>
            <Line
                label="Пришло за день"
                value={formatGel(total.income.total)}
                sub={<>
                    <ByMethod money={total.income} />
                    {transferNote(total.transfer) && <span style={{ display: 'block', marginTop: 2 }}>{transferNote(total.transfer)}</span>}
                </>}
            />
            <Line
                label="Ушло"
                value={total.expense.total > 0 ? formatGel(-total.expense.total) : formatGel(0)}
                sub={total.expense.count > 0 ? <ByMethod money={total.expense} /> : 'Расходов не было'}
            />
            <Line
                label="Списано с балансов клиентов"
                value={formatGel(total.charges.net)}
                sub={<>{chargesSub(total.charges)}<span style={{ display: 'block', marginTop: 2 }}>{CHARGES_SCHEDULE_HINT}</span></>}
            />
        </Card>
    );
}

/** Общее для всех филиалов: должники на конец дня, недельные скидки, корректировки. */
function CommonCard({ data, radius, clientPath }: { data: CashboxDaySummary; radius: number; clientPath?: (k: string) => string }) {
    const [all, setAll] = useState(false);
    const debtors = data.debtors;
    const list = all ? debtors.items : debtors.items.slice(0, 5);
    const adj = data.adjustments;
    // До стартовых остатков ленты баланса (21.07.2026) долги не восстановить.
    const noData = debtors.available === false;
    const sinceLabel = debtors.since ? debtors.since.split('-').reverse().join('.') : '';
    return (
        <Card
            title="Должны на конец дня"
            aside={noData ? undefined : (
                <span className="num" style={{ fontSize: 16, fontWeight: 600, color: debtors.amount > 0 ? STATUS.danger.fg : STATUS.ok.fg, whiteSpace: 'nowrap' }}>
                    {debtors.amount > 0 ? formatGel(debtors.amount) : 'никто'}
                </span>
            )}
            radius={radius}
        >
            <div style={{ fontSize: 12, color: COLOR.ink60, marginBottom: 6, lineHeight: 1.45 }}>
                {noData
                    ? `Нет данных о долгах до ${sinceLabel}`
                    : debtors.count > 0
                        ? `${ruCountWord(debtors.count, ['клиент', 'клиента', 'клиентов'])}, ${formatGel(debtors.amount)}`
                            + (debtors.staffCount > 0 ? ` · из них сотрудники: ${debtors.staffCount}, ${formatGel(debtors.staffAmount)}` : '')
                        : 'Ни у кого нет минуса на балансе'}
                {!noData && data.isToday ? ' — сейчас, день ещё идёт' : ''}
                {!noData && ' · общее по всем филиалам'}
            </div>
            {list.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {list.map(d => (
                        <li key={d.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: `1px solid ${COLOR.ink08}`, fontSize: 14 }}>
                            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                                {clientPath ? (
                                    <Link to={clientPath(d.email || d.userId)} style={{ color: COLOR.ink, textDecoration: 'none', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {d.name}
                                    </Link>
                                ) : (
                                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</span>
                                )}
                                {d.staff && <span className="ui-badge ui-badge--muted" style={{ flexShrink: 0 }}>сотрудник</span>}
                            </span>
                            <span className="num" style={{ color: STATUS.danger.fg, whiteSpace: 'nowrap' }}>{formatGel(d.debt)}</span>
                        </li>
                    ))}
                </ul>
            )}
            {debtors.items.length > 5 && (
                <Button variant="quiet" size="compact" onClick={() => setAll(v => !v)} style={{ marginTop: 4 }}>
                    {all ? 'Свернуть' : `Показать всех · ${debtors.items.length}`}
                </Button>
            )}
            {all && debtors.items.length < debtors.count && (
                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 4 }}>
                    Показано {debtors.items.length} из {debtors.count} — остальные в списке клиентов
                </div>
            )}
            {data.weeklyRebates.count > 0 && (
                <Line
                    label="Начислены недельные скидки"
                    value={formatGel(data.weeklyRebates.amount, { sign: true })}
                    tone={STATUS.ok.fg}
                    sub={`${ruCountWord(data.weeklyRebates.count, ['клиенту', 'клиентам', 'клиентам'])} на баланс — уже учтены в «к оплате»`}
                />
            )}
            {!data.branch && adj.count > 0 && (
                <Line
                    label="Корректировки балансов"
                    strong={false}
                    value={[adj.income > 0 ? formatGel(adj.income, { sign: true }) : '', adj.expense > 0 ? formatGel(-adj.expense) : ''].filter(Boolean).join(' / ')}
                    sub="Не деньги: правки балансов клиентов и недельные скидки. В «пришло» и «ушло» не входят"
                />
            )}
        </Card>
    );
}

/** Клиенты дня (владелец 05.10): для вечерней сверки с таблицей — баланс каждого,
 *  кто был в этот день, на конец дня. Старый бэк поля не отдаёт — блока нет. */
function ClientsCard({ data, radius, clientPath }: { data: CashboxDaySummary; radius: number; clientPath?: (k: string) => string }) {
    const clients = data.clients;
    if (!clients || clients.count === 0) return null;
    return (
        <Card
            title="Клиенты дня — для сверки"
            aside={<span className="num" style={{ fontSize: 14, color: COLOR.ink60 }}>{ruCountWord(clients.count, ['клиент', 'клиента', 'клиентов'])}</span>}
            radius={radius}
        >
            <div style={{ fontSize: 12, color: COLOR.ink60, marginBottom: 6, lineHeight: 1.45 }}>
                Баланс на конец дня{data.isToday ? ' (день ещё идёт — сейчас)' : ''}. Сравните с таблицей; не совпало — напишите владельцу.
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {clients.items.map(c => (
                    <li key={c.userId} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderTop: `1px solid ${COLOR.ink08}`, fontSize: 14 }}>
                        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            {clientPath ? (
                                <Link to={clientPath(c.userId)} style={{ color: COLOR.ink, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Link>
                            ) : (
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                            )}
                            <span style={{ fontSize: 12, color: COLOR.ink60 }}>{c.branch} · {String(c.hours).replace('.', ',')} ч{c.staff ? ' · сотрудник' : ''}</span>
                        </span>
                        <span className="num" style={{ whiteSpace: 'nowrap', color: c.balance < 0 ? STATUS.danger.fg : COLOR.ink }}>{formatGel(c.balance)}</span>
                    </li>
                ))}
            </ul>
        </Card>
    );
}
