import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usersApi, type MyBalanceLedgerEntry } from '../../api/users';
import { REASON_LABELS } from '../../utils/ledgerReasons';
import { BATUMI_TZ } from '../../utils/dateUtils';
import { COLOR, TEXT } from '../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel, formatTime } from '../../utils/format';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Money } from '../../components/ui/Money';
import { SummaryCard } from '../../components/ui/SummaryCard';
import { ListGroup, ListRow } from '../../components/ui/ListRow';
import { Sheet } from '../../components/ui/Sheet';
import { EmptyState } from '../../components/ui/EmptyState';
import { LoadErrorCard, SkeletonRows } from './LoadStates';

const ADMIN_TG = 'UnboxCenter';

/** Подписи для клиента: там, где админское слово звучит служебно, — проще. */
const CLIENT_REASON_LABELS: Record<string, string> = {
    ...REASON_LABELS,
    booking_charge: 'Списание за бронь',
    booking_refund: 'Возврат за бронь',
    booking_charge_revert: 'Списание отменено',
    extend_charge: 'Продление брони',
    extras_charge: 'Допуслуги',
    extras_refund: 'Возврат за допуслуги',
    correction: 'Корректировка администратором',
    topup_adjust: 'Пополнение исправлено',
    topup_reversal: 'Пополнение отменено',
    consecutive_recompute: 'Пересчёт за часы подряд',
    merge: 'Перенос с другого вашего профиля',
    baseline: 'Остаток на начало учёта',
};

/** Сервер пишет время без пояса (UTC) — читаем как UTC, показываем по Тбилиси. */
function parseUtc(iso: string | null): Date | null {
    if (!iso) return null;
    const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d : null;
}

function whatHappened(e: MyBalanceLedgerEntry): { title: string; sub: string | null } {
    const title = CLIENT_REASON_LABELS[e.reason] ?? (e.delta >= 0 ? 'Зачисление' : 'Списание');
    if (e.booking) {
        const b = e.booking;
        const when = [b.date ? formatDayMonthShort(b.date) : null, b.startTime].filter(Boolean).join(', ');
        return { title, sub: [b.resourceName, when].filter(Boolean).join(' · ') || null };
    }
    // «Оплата абонемента · Оплата абонемента «Тёплый старт»» — без повтора.
    const d = (e.description || '').trim();
    const sub = d.toLowerCase().startsWith(title.toLowerCase()) ? d.slice(title.length).trim() : d;
    return { title, sub: sub || null };
}

/**
 * /m/balance — история баланса клиента (ревью клиентской части 09.11, №6).
 *
 * «Куда ушли мои деньги?»: пополнения, списания за брони, возвраты, пиковые
 * доплаты — из той же ленты, что видит администратор (balance_ledger), только
 * свои строки и без служебных подробностей. «Как пополнить» — кнопкой здесь.
 */
export function MobileBalance() {
    const currentUser = useUserStore(s => s.currentUser);
    const [entries, setEntries] = useState<MyBalanceLedgerEntry[] | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [failed, setFailed] = useState(false);
    const [topUpOpen, setTopUpOpen] = useState(false);

    const load = () => {
        setFailed(false);
        usersApi.getMyBalanceLedger()
            .then(r => {
                // Строки «0 ₾» (например, бронь целиком часами) — шум: прячем.
                setEntries(r.entries.filter(e => Math.abs(e.delta) >= 0.005));
                setTruncated(r.truncated);
            })
            .catch(() => setFailed(true));
    };
    useEffect(load, []);

    const balance = currentUser?.balance ?? 0;
    const debt = balance < 0;
    const creditLimit = currentUser?.creditLimit ?? 0;

    return (
        <div style={{ paddingBottom: 24 }}>
            <MobilePageHeader title="Баланс" fallbackTo="/m/me" />
            <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* 09.11 фаза 3: итог — общий SummaryCard (как абонемент и бонусы);
                    цвет суммы — только tone="balance" (минус = долг, красный). */}
                <SummaryCard
                    size="lg"
                    label={debt ? 'Долг' : 'На балансе'}
                    value={<Money value={balance} tone="balance" />}
                    caption={creditLimit > 0
                        ? `Можно уйти в минус до ${formatGel(creditLimit, { fraction: 0 })} — потом пополнить.`
                        : undefined}
                >
                    <div style={{ marginTop: 12 }}>
                        <Button block size="touch" onClick={() => setTopUpOpen(true)}>Как пополнить</Button>
                    </div>
                </SummaryCard>

                <section aria-label="История">
                    {failed ? (
                        <LoadErrorCard title="Не удалось загрузить историю" text="Деньги никуда не делись — просто сейчас не загрузилось." onRetry={load} />
                    ) : entries == null ? (
                        <SkeletonRows height={64} />
                    ) : entries.length === 0 ? (
                        <EmptyState compact illustration="cup" title="Операций пока нет" hint="Здесь появятся пополнения, списания за брони и возвраты." />
                    ) : (
                        <ListGroup title="История">
                            {entries.map(e => {
                                const when = parseUtc(e.date);
                                const { title, sub } = whatHappened(e);
                                return (
                                    <ListRow
                                        key={e.id}
                                        title={<span style={{ fontSize: TEXT.small }}>{title}</span>}
                                        subtitle={<>
                                            {sub && <span style={{ display: 'block', color: COLOR.ink80 }}>{sub}</span>}
                                            {when && (
                                                <span style={{ display: 'block', fontSize: TEXT.caption }}>
                                                    {formatDayMonth(when, { timeZone: BATUMI_TZ, withYear: 'auto' })}, {formatTime(when, { timeZone: BATUMI_TZ })}
                                                </span>
                                            )}
                                        </>}
                                        trail={<Money value={e.delta} tone="flow" />}
                                        trailSub={<span className="num">остаток {formatGel(e.balanceAfter)}</span>}
                                    />
                                );
                            })}
                        </ListGroup>
                    )}
                    {truncated && (
                        <p style={{ margin: '8px 4px 0', fontSize: TEXT.small, color: COLOR.ink60 }}>
                            Показаны последние операции. Более старые — у администратора.
                        </p>
                    )}
                    <p style={{ margin: '8px 4px 0', fontSize: TEXT.small, color: COLOR.ink60, lineHeight: 1.45 }}>
                        Здесь только деньги. Часы абонемента и бонусные часы — в «Абонементе» и «Бонусах».
                    </p>
                </section>
            </div>

            <Sheet
                open={topUpOpen}
                onClose={() => setTopUpOpen(false)}
                title="Как пополнить баланс"
                footer={
                    <>
                        <a
                            href={`https://t.me/${ADMIN_TG}?text=${encodeURIComponent('Здравствуйте! Хочу пополнить баланс.')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn ui-btn--primary ui-btn--block"
                            style={{ textDecoration: 'none' }}
                        >
                            Написать администратору
                        </a>
                        <Button variant="secondary" block onClick={() => setTopUpOpen(false)}>Понятно</Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: TEXT.body, lineHeight: 1.5 }}>
                    <p style={{ margin: 0 }}>
                        Сейчас на балансе <b className="num">{formatGel(balance, { fraction: 0 })}</b>.
                    </p>
                    <p style={{ margin: 0, color: COLOR.ink80 }}>
                        Баланс пополняет администратор: наличными в центре или переводом. Напишите нам — подскажем,
                        как удобнее, и зачислим деньги.
                    </p>
                </div>
            </Sheet>
        </div>
    );
}
