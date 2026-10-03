import type { FC } from 'react';
import { toast } from 'sonner';
import { useUserStore, type User } from '../store/userStore';
import { Calendar, RefreshCcw, Snowflake, CheckCircle2, Send } from 'lucide-react';
import { Button } from './ui/Button';
import { parseISO } from 'date-fns';
import { formatDayMonth } from '../utils/format';
import { SUBSCRIPTION_PLANS } from '../utils/data';
import { fmtFreezeDays, freezeBudget } from '../utils/subscription';
import { extraKindLabel, extraPool, extraPoolLabel } from '../utils/subscriptionHours';

const ADMIN_TG = 'https://t.me/UnboxCenter';

const fmtHours = (h: number) =>
    `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(Number(h) || 0)} ч`;

/** Ссылка на Telegram администратора с готовым текстом (решение владельца 30.09). */
function adminTelegramUrl(text: string): string {
    return `${ADMIN_TG}?text=${encodeURIComponent(text)}`;
}

interface SubscriptionCardProps {
    user: User;
}

export const SubscriptionCard: FC<SubscriptionCardProps> = ({ user }) => {
    const { toggleSubscriptionFreeze, currentUser } = useUserStore();
    const sub = user.subscription;
    // Заморозку напрямую проводит только админ (эндпоинт require_admin). Клиенту
    // раньше показывалась рабочая на вид кнопка → 403 «Not enough privileges».
    // Клиент просит паузу у администратора в Telegram — готовым сообщением;
    // /subscriptions/toggle-freeze отсюда не зовём (решение владельца 30.09).
    const viewerIsAdmin = ['owner', 'senior_admin', 'admin'].includes(currentUser?.role || '') || !!currentUser?.isAdmin;

    if (!sub) return null;

    const plan = SUBSCRIPTION_PLANS.find(p => p.id === sub.planId);
    const totalWithBonus = sub.totalHours + (sub.bonusHours || 0);
    const percentRemaining = totalWithBonus > 0 ? Math.min(100, (sub.remainingHours / totalWithBonus) * 100) : 0;

    // Заморозка по тарифу (владелец 01.10): бюджет ДНЕЙ паузы — Регулярный 7,
    // Профи+ 30, остальные 0; делится на несколько пауз. Показываем, сколько
    // дней ОСТАЛОСЬ (freezeDaysLeft с сервера), а не сколько использовано.
    const freeze = freezeBudget(sub);
    const canFreeze = !sub.isFrozen && freeze.left > 0;
    const frozenUntil = sub.isFrozen && sub.frozenUntil ? parseISO(sub.frozenUntil) : null;
    const pauseOver = !!frozenUntil && frozenUntil.getTime() < Date.now();
    const frozenUntilLabel = frozenUntil ? formatDayMonth(frozenUntil) : '';

    const who = [user.name, user.email].filter(Boolean).join(', ');
    const freezeRequestUrl = adminTelegramUrl(
        `Здравствуйте! Прошу поставить на паузу мой абонемент «${sub.name}» (по тарифу осталось ${fmtFreezeDays(freeze.left)}). ${who}. С какого числа и на сколько дней: `,
    );
    const unfreezeRequestUrl = adminTelegramUrl(
        `Здравствуйте! Прошу снять паузу с моего абонемента «${sub.name}». ${who}`,
    );

    const cell = 'border-t border-ink-10 py-3';

    return (
        // Grid House: бумага, тонкая линия, без скруглений, тени и свечения.
        <section className="bg-card text-ink p-5 border border-ink-10" aria-label={`Абонемент «${sub.name}»`}>
            <div className="flex justify-between items-start gap-3 mb-4">
                <div className="min-w-0">
                    <div className="text-ink-60 text-small mb-1">Абонемент</div>
                    <h3 className="text-title font-semibold flex flex-wrap items-center gap-2 m-0">
                        {sub.name}
                        {(sub.bonusHours || 0) > 0 && (
                            <span className="ui-badge ui-badge--ok">+{fmtHours(sub.bonusHours || 0)} бонус</span>
                        )}
                    </h3>
                </div>
                {sub.isFrozen && (
                    <span className="ui-badge ui-badge--info shrink-0">
                        <Snowflake size={14} aria-hidden="true" />
                        На паузе
                    </span>
                )}
            </div>

            {/* Остаток часов */}
            <div className="mb-4">
                <div className="flex justify-between text-small mb-2">
                    <span className="text-ink-60">Осталось часов</span>
                    <span className="num font-semibold">{fmtHours(sub.remainingHours)} из {fmtHours(totalWithBonus)}</span>
                </div>
                <div
                    className="h-2 bg-ink-10 overflow-hidden"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={totalWithBonus}
                    aria-valuenow={sub.remainingHours}
                    aria-label="Остаток часов абонемента"
                >
                    <div
                        className={`h-full transition-all duration-500 ${sub.remainingHours < 5 ? 'bg-[var(--status-danger-solid)]' : 'bg-accent'}`}
                        style={{ width: `${percentRemaining}%` }}
                    />
                </div>
            </div>

            {/* Доп. пул (владелец 01.10): часы капсулы / «4 ч индивидуально» —
                тратятся первыми, только на свой вид брони. */}
            {extraPoolLabel(sub) && (
                <div className="mb-4 flex justify-between gap-3 text-small border-t border-ink-10 pt-3">
                    <span className="text-ink-60">{extraKindLabel(extraPool(sub)!.kind)}</span>
                    <span className="num font-semibold">
                        осталось {fmtHours(extraPool(sub)!.remaining)} из {fmtHours(extraPool(sub)!.total)}
                    </span>
                </div>
            )}

            {/* Что входит */}
            {plan?.perks && plan.perks.length > 0 && (
                <ul className="mb-4 space-y-1.5 list-none p-0">
                    {plan.perks.map((perk, i) => (
                        <li key={i} className="flex items-center gap-2 text-small text-ink-80">
                            <CheckCircle2 size={14} className="text-[var(--status-ok-fg)] shrink-0" aria-hidden="true" />
                            {perk}
                        </li>
                    ))}
                </ul>
            )}

            <dl className="m-0 text-small">
                <div className={`${cell} flex justify-between gap-3`}>
                    <dt className="flex items-center gap-2 text-ink-60"><Calendar size={14} aria-hidden="true" /> Действует до</dt>
                    <dd className="m-0 font-medium">{formatDayMonth(parseISO(sub.expiryDate), { withYear: 'auto' })}</dd>
                </div>
                <div className={`${cell} flex justify-between gap-3`}>
                    {/* Владелец 01.10: перенос позже суток (не позже чем за 3 ч) —
                        N раз за абонемент; сервер тратит счётчик freeReschedules. */}
                    <dt className="flex items-center gap-2 text-ink-60"><RefreshCcw size={14} aria-hidden="true" /> Переносов позже суток</dt>
                    <dd className="m-0 font-medium">{(Number(sub.freeReschedules) || 0) > 0 ? `осталось ${sub.freeReschedules}` : 'нет'}</dd>
                </div>
                <div className={`${cell} flex justify-between gap-3`}>
                    <dt className="flex items-center gap-2 text-ink-60"><Snowflake size={14} aria-hidden="true" /> Заморозка</dt>
                    <dd className="m-0 font-medium">
                        {sub.isFrozen
                            ? 'идёт сейчас'
                            : freeze.total > 0
                                ? `осталось ${fmtFreezeDays(freeze.left)} из ${fmtFreezeDays(freeze.total)}`
                                : 'не входит в тариф'}
                    </dd>
                </div>
            </dl>

            {sub.isFrozen && frozenUntil && (
                <div className={`mt-3 px-3 py-2 text-small font-medium ${pauseOver ? 'text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]' : 'text-[var(--status-info-fg)] bg-[var(--status-info-bg)]'}`}>
                    {/* Владелец 03.10: бронь часами абонемента сама снимает паузу. */}
                    {pauseOver
                        ? `Пауза закончилась ${frozenUntilLabel}, но ещё не снята. Бронь часами абонемента снимет её сама — неиспользованные дни паузы сохранятся.`
                        : `На паузе до ${frozenUntilLabel}. Если забронируете часами абонемента, пауза снимется сама — неиспользованные дни паузы сохранятся.`}
                </div>
            )}

            {/* Действие */}
            <div className="mt-4 space-y-2">
                {viewerIsAdmin ? (
                    <>
                        <Button
                            variant="secondary"
                            size="touch"
                            block
                            disabled={!canFreeze && !sub.isFrozen}
                            icon={<Snowflake size={16} aria-hidden="true" />}
                            onClick={() => toggleSubscriptionFreeze(user.email).catch((err: any) =>
                                toast.error(err?.response?.data?.detail || 'Не удалось изменить заморозку'))}
                        >
                            {sub.isFrozen ? 'Снять паузу' : `Поставить на паузу на ${fmtFreezeDays(freeze.left)}`}
                        </Button>
                        {!canFreeze && !sub.isFrozen && (
                            <p className="text-caption text-center text-ink-60 m-0">
                                {freeze.total > 0 ? 'Дни заморозки по этому абонементу израсходованы' : 'Заморозка не входит в этот тариф'}
                            </p>
                        )}
                    </>
                ) : sub.isFrozen ? (
                    <a
                        href={unfreezeRequestUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--secondary ui-btn--touch ui-btn--block"
                    >
                        <Send size={16} aria-hidden="true" />
                        Попросить снять паузу
                    </a>
                ) : canFreeze ? (
                    <>
                        <a
                            href={freezeRequestUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ui-btn ui-btn--secondary ui-btn--touch ui-btn--block"
                        >
                            <Snowflake size={16} aria-hidden="true" />
                            Попросить заморозку
                        </a>
                        <p className="text-caption text-center text-ink-60 m-0">
                            Откроется Telegram администратора с готовым сообщением
                        </p>
                    </>
                ) : (
                    <p className="text-small text-center text-ink-60 m-0">
                        {freeze.total > 0 ? 'Дни заморозки по этому абонементу израсходованы' : 'Заморозка не входит в этот тариф'}
                    </p>
                )}
            </div>
        </section>
    );
};
