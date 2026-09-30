import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Gift, MapPin, Plus, Ticket, Wallet } from 'lucide-react';
import { useUserStore } from '../store/userStore';
import { RESOURCES, LOCATIONS } from '../utils/data';
import { bonusesApi, type Bonus } from '../api/bonuses';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { SpecialistGateCard } from '../components/SpecialistGate';
import { useSpecialistApplicationStatus } from '../hooks/useSpecialistApplication';
import { canBookCabinets } from '../utils/permissions';
import { formatDayMonth, formatGel, formatRelativeDay, formatStartsIn } from '../utils/format';
import { timeToMin } from '../utils/bookingHelpers';
import type { BookingHistoryItem } from '../store/types';

/**
 * «Обзор» кабинета клиента на компьютере (/dashboard).
 *
 * Волна 2, пакет D (G3-06, G3-08): вместо полосы цифр «баланс / бонусы /
 * скидка 0 %» — карточка ближайшей брони (день, время, кабинет, адрес,
 * оплата, «Маршрут» и «Детали»), ниже одна главная кнопка и следующие брони
 * строками-ссылками. Блок «Последние платежи» убран: у клиента нет ленты
 * платежей (список жил только в памяти браузера и всегда был пуст).
 * Кто ещё не может бронировать — сверху статус анкеты.
 */

/** Адрес для карты: «Палиашвили, 4, Батуми». */
function mapsUrl(address: string): string {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address}, Батуми`)}`;
}

/** Начало брони (местное время) из даты «YYYY-MM-DD…» и «HH:MM». */
function startOf(b: BookingHistoryItem): Date | null {
    const day = String(b.date ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !b.startTime) return null;
    const d = new Date(`${day}T${b.startTime}`);
    return isNaN(d.getTime()) ? null : d;
}

/** Конец брони из начала и длительности (мин): у броней из истории нет endTime. */
function endFromDuration(start: string | null | undefined, durationMin: number | null | undefined): string | null {
    if (!start || !durationMin) return null;
    const end = timeToMin(start) + durationMin;
    return `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

const fmtHours = (h: number) =>
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(h) || 0)} ч`;

/** Строка оплаты: «Оплачено: 1,5 ч из абонемента» / «Спишем за сутки до начала: 20 ₾». */
function paymentLine(b: BookingHistoryItem): string {
    if (b.status === 'pending_approval') return 'Ждём подтверждения администратора';
    const hours = Number(b.hoursDeducted) || (b.duration || 0) / 60;
    if (b.paymentMethod === 'bonus') return `Бонус: ${fmtHours(hours)} бесплатно`;
    if (b.paymentMethod === 'subscription') {
        return b.paymentStatus === 'pending'
            ? `Спишем за сутки до начала: ${fmtHours(hours)} абонемента`
            : `Оплачено: ${fmtHours(hours)} из абонемента`;
    }
    return b.paymentStatus === 'pending'
        ? `Спишем с баланса за сутки до начала: ${formatGel(b.finalPrice)}`
        : `Оплачено с баланса: ${formatGel(b.finalPrice)}`;
}

export function DashboardOverview() {
    const { currentUser, bookings } = useUserStore();
    const navigate = useNavigate();
    const [bonuses, setBonuses] = useState<Bonus[]>([]);

    useEffect(() => {
        bonusesApi.getMyBonuses().then(setBonuses).catch(() => {});
    }, [currentUser?.id]);

    const canBook = canBookCabinets(currentUser);
    const applicationStatus = useSpecialistApplicationStatus(currentUser, !!currentUser && !canBook);

    // Предстоящие брони (подтверждённые и «ждём подтверждения»), ближайшая первой.
    const upcoming = useMemo(() => {
        if (!currentUser) return [];
        const now = Date.now();
        return bookings
            .filter(b => b.userId === currentUser.email || b.userId === currentUser.id
                || (b as { userUuid?: string }).userUuid === currentUser.id)
            .filter(b => b.status === 'confirmed' || b.status === 'pending_approval')
            .map(b => ({ b, start: startOf(b) }))
            .filter(x => {
                if (!x.start) return false;
                // Идущая сейчас бронь остаётся «ближайшей» до своего конца.
                return x.start.getTime() + (x.b.duration || 0) * 60000 > now;
            })
            .sort((a, z) => a.start!.getTime() - z.start!.getTime());
    }, [bookings, currentUser]);

    if (!currentUser) return null;

    const bookPath = '/dashboard/bookings?view=grid';
    const next = upcoming[0];
    const rest = upcoming.slice(1, 4);

    const isNegative = currentUser.balance < 0;
    const creditLimit = currentUser.creditLimit || 0;
    const availableCredit = creditLimit + currentUser.balance;
    const activeBonuses = bonuses.filter(b => b.status === 'active');
    const totalBonusHours = activeBonuses.reduce((sum, b) => sum + (b.quantity || 0), 0);
    const bonusExpiry = activeBonuses
        .map(b => b.expiresAt)
        .filter((d): d is string => !!d)
        .sort()[0];

    const nextRes = next ? RESOURCES.find(r => r.id === next.b.resourceId) : null;
    const nextLoc = nextRes ? LOCATIONS.find(l => l.id === nextRes.locationId) : null;
    const nextEnd = next ? endFromDuration(next.b.startTime, next.b.duration) : null;

    return (
        <div className="text-ink">
            {/* Шапка */}
            <header className="mb-8 border-b border-ink-10 pb-4">
                <h1 className="m-0 text-heading font-semibold">Обзор</h1>
                <p className="mt-1 text-body text-ink-60">
                    Здравствуйте, {currentUser.name?.split(' ')[0] || 'рады вас видеть'}
                </p>
            </header>

            {/* Ещё не специалист — статус анкеты сверху, вместо пустой карточки брони. */}
            {!canBook && (
                <div className="mb-8">
                    <SpecialistGateCard variant="desktop" status={applicationStatus} />
                </div>
            )}

            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
                <div className="min-w-0">
                    {/* Ближайшая бронь */}
                    {next ? (
                        <section aria-labelledby="next-booking-title" className="border border-ink-10 bg-card">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-10 px-6 py-3">
                                <h2 id="next-booking-title" className="m-0 text-small font-medium text-ink-60">
                                    Ближайшая бронь
                                </h2>
                                <StatusBadge kind="booking" status={next.b.status} />
                            </div>
                            <div className="px-6 py-5">
                                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                    <span className="text-title font-semibold">
                                        {formatRelativeDay(String(next.b.date).slice(0, 10))}
                                    </span>
                                    <span className="text-small text-ink-60">
                                        {formatStartsIn(next.start!, { end: new Date(next.start!.getTime() + (next.b.duration || 0) * 60000) })}
                                    </span>
                                </div>
                                <div className="num mt-2 text-heading font-semibold leading-none">
                                    {next.b.startTime}{nextEnd ? `–${nextEnd}` : ''}
                                </div>
                                <div className="mt-3 text-body">
                                    {nextRes?.name || 'Кабинет'}{nextLoc ? ` · ${nextLoc.name}` : ''}
                                </div>
                                {nextLoc?.address && (
                                    <div className="mt-1 text-small text-ink-60">{nextLoc.address}, Батуми</div>
                                )}
                                <div className="mt-3 text-small text-ink-80">{paymentLine(next.b)}</div>
                                <div className="mt-5 flex flex-wrap gap-2">
                                    {nextLoc?.address && (
                                        <a
                                            href={mapsUrl(nextLoc.address)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="ui-btn ui-btn--secondary ui-btn--touch"
                                        >
                                            <MapPin size={18} aria-hidden="true" />
                                            Маршрут
                                        </a>
                                    )}
                                    <Link to="/dashboard/bookings" className="ui-btn ui-btn--secondary ui-btn--touch">
                                        Детали
                                    </Link>
                                </div>
                            </div>
                        </section>
                    ) : canBook ? (
                        <EmptyState
                            title="Предстоящих броней нет"
                            hint="Свободное время по всем кабинетам — в шахматке."
                            action={{ label: 'Забронировать кабинет', onClick: () => navigate(bookPath) }}
                        />
                    ) : null}

                    {/* Одна главная кнопка */}
                    {canBook && next && (
                        <div className="mt-6">
                            <Button size="touch" icon={<Plus size={18} aria-hidden="true" />} onClick={() => navigate(bookPath)}>
                                Забронировать кабинет
                            </Button>
                        </div>
                    )}

                    {/* Дальше — следующие брони строками, каждая кликабельна. */}
                    {rest.length > 0 && (
                        <section aria-labelledby="next-list-title" className="mt-10">
                            <div className="mb-3 flex items-baseline justify-between gap-3">
                                <h2 id="next-list-title" className="m-0 text-title font-semibold">Дальше</h2>
                                <Link to="/dashboard/bookings" className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-ink underline underline-offset-2">
                                    Все брони <ArrowRight size={16} aria-hidden="true" />
                                </Link>
                            </div>
                            <ul className="m-0 list-none border border-ink-10 bg-card p-0">
                                {rest.map(({ b }, i) => {
                                    const res = RESOURCES.find(r => r.id === b.resourceId);
                                    const loc = res ? LOCATIONS.find(l => l.id === res.locationId) : null;
                                    const end = endFromDuration(b.startTime, b.duration);
                                    return (
                                        <li key={b.id} className={i > 0 ? 'border-t border-ink-10' : ''}>
                                            <Link
                                                to="/dashboard/bookings"
                                                className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-ink no-underline hover:bg-ink-05 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                                            >
                                                <span className="min-w-[180px] text-body font-medium">
                                                    {formatRelativeDay(String(b.date).slice(0, 10))} · <span className="num">{b.startTime}{end ? `–${end}` : ''}</span>
                                                </span>
                                                <span className="flex-1 text-small text-ink-80">
                                                    {res?.name || 'Кабинет'}{loc ? ` · ${loc.name}` : ''}
                                                </span>
                                                {b.status === 'pending_approval'
                                                    ? <StatusBadge kind="booking" status={b.status} />
                                                    : <span className="num text-small text-ink-80">
                                                        {b.paymentMethod === 'bonus' ? 'Бонус'
                                                            : b.paymentMethod === 'subscription' ? `${fmtHours(Number(b.hoursDeducted) || (b.duration || 0) / 60)} абонемента`
                                                            : formatGel(b.finalPrice)}
                                                    </span>}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}
                </div>

                {/* Кошелёк — спокойно, сбоку. Без «Скидка 0 %». */}
                <aside aria-label="Кошелёк" className="border border-ink-10 bg-card">
                    <div className="border-b border-ink-10 px-5 py-4">
                        <div className="flex items-center gap-2 text-small text-ink-60">
                            <Wallet size={16} aria-hidden="true" /> Баланс
                        </div>
                        <div className={`num mt-1 text-heading font-semibold ${isNegative ? 'text-[var(--status-danger-fg)]' : 'text-ink'}`}>
                            {formatGel(currentUser.balance ?? 0)}
                        </div>
                        {creditLimit > 0 && (
                            <div className="mt-1 text-small text-ink-60">
                                Кредит: {formatGel(availableCredit)} из {formatGel(creditLimit)}
                            </div>
                        )}
                    </div>
                    <div className="border-b border-ink-10 px-5 py-4">
                        <div className="flex items-center gap-2 text-small text-ink-60">
                            <Gift size={16} aria-hidden="true" /> Бонусные часы
                        </div>
                        <div className="mt-1 text-body">
                            {totalBonusHours > 0
                                ? <>
                                    <span className="num font-semibold">{fmtHours(totalBonusHours)}</span> бесплатно
                                    {bonusExpiry && <span className="text-ink-60"> · до {formatDayMonth(bonusExpiry)}</span>}
                                </>
                                : <span className="text-ink-60">Нет активных бонусов</span>}
                        </div>
                    </div>
                    {currentUser.subscription && (
                        <div className="border-b border-ink-10 px-5 py-4">
                            <div className="flex items-center gap-2 text-small text-ink-60">
                                <Ticket size={16} aria-hidden="true" /> Абонемент
                            </div>
                            <div className="mt-1 text-body">
                                {currentUser.subscription.name}: <span className="num font-semibold">{fmtHours(currentUser.subscription.remainingHours)}</span>
                            </div>
                        </div>
                    )}
                    <nav aria-label="Ещё" className="flex flex-col px-2 py-2">
                        <Link to="/dashboard/bonuses" className="flex min-h-11 items-center justify-between px-3 text-small font-medium text-ink no-underline hover:bg-ink-05">
                            Скидки и бонусы <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                        <Link to="/subscriptions" className="flex min-h-11 items-center justify-between px-3 text-small font-medium text-ink no-underline hover:bg-ink-05">
                            Абонементы <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                    </nav>
                </aside>
            </div>
        </div>
    );
}
