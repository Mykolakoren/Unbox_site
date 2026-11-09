import { useEffect, useState } from 'react';
import { Wallet } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { usersApi, type MyBalanceLedgerEntry } from '../../api/users';
import { REASON_LABELS } from '../../utils/ledgerReasons';
import { BATUMI_TZ } from '../../utils/dateUtils';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel, formatTime } from '../../utils/format';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
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
                <section aria-label="Баланс сейчас" style={{
                    background: COLOR.sunken, borderRadius: RADIUS.sheet, padding: '16px 18px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Wallet size={24} aria-hidden="true" />
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60 }}>
                                {debt ? 'Долг' : 'На балансе'}
                            </div>
                            <div className="num" style={{ fontSize: TEXT.heading, fontWeight: 600, color: debt ? STATUS.danger.fg : COLOR.ink }}>
                                {formatGel(balance)}
                            </div>
                        </div>
                    </div>
                    {creditLimit > 0 && (
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink80 }}>
                            Можно уйти в минус до {formatGel(creditLimit, { fraction: 0 })} — потом пополнить.
                        </div>
                    )}
                    <Button block size="touch" onClick={() => setTopUpOpen(true)}>Как пополнить</Button>
                </section>

                <section aria-label="История">
                    <h2 style={{ fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: COLOR.ink60, margin: '0 0 8px' }}>
                        История
                    </h2>
                    {failed ? (
                        <LoadErrorCard title="Не удалось загрузить историю" text="Деньги никуда не делись — просто сейчас не загрузилось." onRetry={load} />
                    ) : entries == null ? (
                        <SkeletonRows height={64} />
                    ) : entries.length === 0 ? (
                        <EmptyState compact title="Операций пока нет" hint="Здесь появятся пополнения, списания за брони и возвраты." />
                    ) : (
                        <div style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}`, borderRadius: RADIUS.sheet, overflow: 'hidden' }}>
                            {entries.map((e, i) => {
                                const when = parseUtc(e.date);
                                const { title, sub } = whatHappened(e);
                                const plus = e.delta > 0;
                                return (
                                    <div key={e.id} style={{
                                        display: 'flex', gap: 12, alignItems: 'flex-start',
                                        padding: '12px 16px', borderTop: i === 0 ? 'none' : `1px solid ${COLOR.ink10}`,
                                    }}>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: TEXT.small, fontWeight: 600, color: COLOR.ink }}>{title}</div>
                                            {sub && <div style={{ fontSize: TEXT.small, color: COLOR.ink80, marginTop: 2 }}>{sub}</div>}
                                            {when && (
                                                <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>
                                                    {formatDayMonth(when, { timeZone: BATUMI_TZ, withYear: 'auto' })}, {formatTime(when, { timeZone: BATUMI_TZ })}
                                                </div>
                                            )}
                                        </div>
                                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                            <div className="num" style={{ fontSize: TEXT.body, fontWeight: 600, color: plus ? STATUS.ok.fg : COLOR.ink }}>
                                                {formatGel(e.delta, { sign: true })}
                                            </div>
                                            <div className="num" style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>
                                                остаток {formatGel(e.balanceAfter)}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
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
