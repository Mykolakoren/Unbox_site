import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Snowflake, Plus, MessageCircle } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { fmtHours, reservedSubscriptionHours, subscriptionHours } from '../../utils/paymentPriority';
import { extraKindLabel, extraPool } from '../../utils/subscriptionHours';
import { canBookCabinets } from '../../utils/permissions';
import { COLOR, RADIUS, STATUS, TEXT } from '../../design/tokens';
import { formatDayMonth } from '../../utils/format';
import { fmtFreezeDays, freezeBudget } from '../../utils/subscription';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/EmptyState';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { SummaryCard } from '../../components/ui/SummaryCard';
import { SkeletonList } from '../../components/ui/Skeleton';

const ADMIN_TG = 'UnboxCenter';

/* Заморозка по тарифу (владелец 01.10, «как на сайте»): бюджет ДНЕЙ паузы —
 * Регулярный 7, Профи+ 30, остальные 0; делится на несколько пауз. Сколько
 * осталось — freezeDaysLeft с сервера (utils/subscription.freezeBudget).
 * Раньше экран считал «1 раз, до недели» для любого тарифа. */

function adminTgLink(text: string): string {
    return `https://t.me/${ADMIN_TG}?text=${encodeURIComponent(text)}`;
}

/**
 * /m/subscription — «Мой абонемент» (волна 2).
 *
 * Сверху — сколько часов свободно для новых броней (часы будущих броней уже
 * обещаны, G4-19), ниже срок, переносы, заморозка. Главное действие —
 * «Забронировать кабинет»: потратить часы, пока абонемент не сгорел.
 *
 * Заморозка и оформление — через администратора в Telegram с готовым
 * текстом (решение владельца 30.09): сервер /subscriptions/toggle-freeze
 * отсюда не вызываем.
 */
export function MobileSubscription() {
    const navigate = useNavigate();
    const { currentUser, fetchCurrentUser, bookings, fetchBookings } = useUserStore();

    const sub = currentUser?.subscription;

    useEffect(() => {
        if (!currentUser) fetchCurrentUser().catch(() => {});
    }, [currentUser, fetchCurrentUser]);

    // Брони нужны, чтобы честно показать остаток: часы будущих броней ещё не
    // списаны (спишутся за сутки до встречи), но уже обещаны (G4-client-mobile-M1).
    useEffect(() => {
        if (currentUser && bookings.length === 0) fetchBookings().catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentUser?.id]);
    // 09.11 (ревью №3): одно число на всех экранах — как в «Я»
    // (subscriptionOverview) и в оплате: та же subscriptionHours.
    const reservedAll = reservedSubscriptionHours(sub, bookings, currentUser?.email);

    if (!currentUser) {
        return (
            <div style={{ padding: '24px 16px' }}>
                <SkeletonList count={3} label="Загружаем" />
            </div>
        );
    }

    const who = currentUser.email ? ` (${currentUser.email})` : '';

    return (
        <div style={{ paddingBottom: 24 }}>
            <MobilePageHeader title="Абонемент" fallbackTo="/m/me" />

            <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {!sub ? (
                    <EmptyState
                        illustration="chair"
                        title="Абонемента пока нет"
                        hint="Час по абонементу дешевле обычного. Подберите тариф под то, как часто вы бронируете."
                        action={{ label: 'Выбрать тариф', onClick: () => navigate('/m/tariffs') }}
                    />
                ) : (() => {
                    // Пул сервера = часы тарифа + бонусные (у Профи+ 40 + 2).
                    // «Свободно» и «всего» — та же функция, что в оформлении и в «Я»
                    // (subscriptionOverview → subscriptionHours), чтобы цифры совпадали.
                    const h = subscriptionHours(sub, {
                        format: ((sub.includedFormats && sub.includedFormats[0]) || 'individual') as 'individual',
                        bookingDate: new Date(), bookings, ownerEmail: currentUser.email,
                    });
                    const poolTotal = h.ok ? h.total : Math.max((Number(sub.totalHours) || 0) + (Number(sub.bonusHours) || 0), sub.remainingHours);
                    const free = h.ok ? h.free : Math.max(0, sub.remainingHours - reservedAll);
                    const reserved = h.ok ? h.reserved : reservedAll;
                    const usedRaw = Number((sub as any).usedHours);
                    const usedHours = Number.isFinite(usedRaw) && (sub as any).usedHours != null
                        ? usedRaw
                        : Math.max(0, poolTotal - sub.remainingHours);
                    const freeze = freezeBudget(sub);
                    return (
                        <>
                            {/* 09.11 фаза 3: итог — общий SummaryCard, крупно ОДНА цифра
                                («свободно для брони»); остальное — строками ниже. Была
                                тёмная плита, в шапке «2 ч из 10 ч», а ниже «Осталось 7 ч». */}
                            <SummaryCard
                                size="lg"
                                label={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    {sub.isFrozen && <Snowflake size={14} aria-hidden="true" />}
                                    {sub.isFrozen ? 'Заморожен' : 'Свободно для брони'}
                                </span>}
                                value={<span className="num">{hoursNumber(free)}</span>}
                                unit={<>ч из {fmtHours(poolTotal)}</>}
                                caption={<>
                                    {sub.name} · до {formatDayMonth(sub.expiryDate, { withYear: 'auto' })}
                                    {reserved > 0.01 && (
                                        <span style={{ display: 'block', marginTop: 4 }}>
                                            Ещё {fmtHours(reserved)} в ваших бронях — спишутся за сутки до встреч.
                                        </span>
                                    )}
                                    {!!sub.bonusHours && (
                                        <span style={{ display: 'block' }}>Из них {fmtHours(sub.bonusHours)} — бонусные</span>
                                    )}
                                </>}
                            />

                            {/* Подробности — строками, без плиток с нулями. */}
                            <dl style={{
                                margin: 0,
                                background: COLOR.card, border: `1px solid ${COLOR.ink10}`, borderRadius: RADIUS.sheet,
                                overflow: 'hidden',
                            }}>
                                <InfoRow label="Действует до" value={formatDayMonth(sub.expiryDate, { withYear: 'auto' })} />
                                {/* Свободно (крупно выше) + в бронях + использовано = всего. */}
                                {reserved > 0.01 && <InfoRow label="В ваших бронях" value={fmtHours(reserved)} />}
                                <InfoRow label="Уже использовано" value={fmtHours(usedHours)} />
                                <InfoRow label="Всего в абонементе" value={fmtHours(poolTotal)} />
                                {/* Доп. пул (владелец 01.10): часы капсулы / «4 ч индивидуально». */}
                                {extraPool(sub) && (
                                    <InfoRow
                                        label={extraKindLabel(extraPool(sub)!.kind)}
                                        value={`осталось ${fmtHours(extraPool(sub)!.remaining)} из ${fmtHours(extraPool(sub)!.total)}`}
                                    />
                                )}
                                {/* Владелец 01.10: перенос позже суток (не позже чем за 3 ч) —
                                    N раз за абонемент. Показываем и 0, если переносы были. */}
                                {((Number(sub.freeReschedules) || 0) > 0 || (Number(sub.freeReschedulesUsed) || 0) > 0) && (
                                    <InfoRow label="Переносов позже суток" value={`осталось ${Number(sub.freeReschedules) || 0}`} />
                                )}
                                <InfoRow
                                    label="Заморозка"
                                    value={sub.isFrozen
                                        ? (sub.frozenUntil ? `до ${formatDayMonth(sub.frozenUntil)}` : 'сейчас')
                                        : freeze.left > 0
                                            ? `осталось ${fmtFreezeDays(freeze.left)} из ${fmtFreezeDays(freeze.total)}`
                                            : freeze.total > 0 ? 'дни израсходованы' : 'не входит в тариф'}
                                />
                            </dl>

                            {sub.isFrozen && (
                                <div role="status" style={{
                                    background: STATUS.info.bg, color: STATUS.info.fg,
                                    borderRadius: RADIUS.sheet, padding: '12px 16px',
                                    fontSize: TEXT.small, lineHeight: 1.45,
                                    display: 'flex', alignItems: 'flex-start', gap: 8,
                                }}>
                                    <Snowflake size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                                    <span>
                                        {sub.frozenUntil ? `Заморожен до ${formatDayMonth(sub.frozenUntil)}. ` : 'Абонемент заморожен. '}
                                        Часы и срок не тратятся. Если забронируете часами абонемента,
                                        {' '}пауза снимется сама — неиспользованные дни паузы сохранятся.
                                    </span>
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {/* Главное — потратить часы, пока абонемент не сгорел. */}
                                {!sub.isFrozen && free > 0 && canBookCabinets(currentUser) && (
                                    <Button block size="touch" icon={<Plus size={18} aria-hidden="true" />} onClick={() => navigate('/m/find')}>
                                        Забронировать кабинет
                                    </Button>
                                )}
                                {sub.isFrozen ? (
                                    <TgButton
                                        href={adminTgLink(`Здравствуйте! Хочу разморозить абонемент «${sub.name}»${who}.`)}
                                        label="Попросить разморозить"
                                    />
                                ) : freeze.left > 0 ? (
                                    <TgButton
                                        href={adminTgLink(`Здравствуйте! Хочу заморозить абонемент «${sub.name}»${who}. С какого числа и на сколько дней (по тарифу осталось ${fmtFreezeDays(freeze.left)}): `)}
                                        label="Попросить заморозку"
                                        icon={<Snowflake size={16} aria-hidden="true" />}
                                    />
                                ) : null}
                                <TgButton
                                    href={adminTgLink(`Хочу оформить абонемент «${sub.name}»`)}
                                    label="Продлить абонемент"
                                />
                                <Button block variant="quiet" onClick={() => navigate('/m/tariffs')}>
                                    Сравнить тарифы
                                </Button>
                            </div>
                            <p style={{ margin: 0, fontSize: TEXT.small, color: COLOR.ink60, lineHeight: 1.45 }}>
                                Заморозку и продление оформляет администратор — откроется Telegram с готовым сообщением.
                            </p>
                        </>
                    );
                })()}
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12,
            minHeight: 48, padding: '12px 16px', borderTop: `1px solid ${COLOR.ink10}`, marginTop: -1,
        }}>
            <dt style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>{label}</dt>
            <dd style={{ margin: 0, fontSize: TEXT.small, fontWeight: 600, color: COLOR.ink, textAlign: 'right' }}>{value}</dd>
        </div>
    );
}

/** Кнопка-ссылка в Telegram администратора (вторичная). */
function TgButton({ href, label, icon }: { href: string; label: string; icon?: React.ReactNode }) {
    return (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-btn ui-btn--secondary ui-btn--touch ui-btn--block"
            style={{ textDecoration: 'none' }}
        >
            {icon ?? <MessageCircle size={16} aria-hidden="true" />}
            {label}
        </a>
    );
}

/** «7» / «1,5» — число часов без «ч» (единица — рядом, мельче). */
function hoursNumber(h: number): string {
    return fmtHours(h).replace(/\s*ч$/, '');
}
