import type { FC } from 'react';
import { toast } from 'sonner';
import { useUserStore, type User } from '../store/userStore';
import { Calendar, RefreshCcw, Snowflake, CheckCircle2 } from 'lucide-react';
import { LegacyButton as Button } from './ui/LegacyButton';
import { parseISO } from 'date-fns';
import { formatDayMonth } from '../utils/format';
import { SUBSCRIPTION_PLANS } from '../utils/data';

interface SubscriptionCardProps {
    user: User;
}

export const SubscriptionCard: FC<SubscriptionCardProps> = ({ user }) => {
    const { toggleSubscriptionFreeze, currentUser } = useUserStore();
    const sub = user.subscription;
    // Заморозку проводит только админ (эндпоинт require_admin). Клиенту
    // раньше показывалась рабочая на вид кнопка → 403 «Not enough privileges».
    const viewerIsAdmin = ['owner', 'senior_admin', 'admin'].includes(currentUser?.role || '') || !!currentUser?.isAdmin;

    if (!sub) return null;

    const plan = SUBSCRIPTION_PLANS.find(p => p.id === sub.planId);
    const totalWithBonus = sub.totalHours + (sub.bonusHours || 0);
    const percentRemaining = (sub.remainingHours / totalWithBonus) * 100;

    const canFreeze = !sub.isFrozen && sub.freezeCount < 1;
    const frozenUntil = sub.isFrozen && sub.frozenUntil ? parseISO(sub.frozenUntil) : null;
    const pauseOver = !!frozenUntil && frozenUntil.getTime() < Date.now();
    const frozenUntilLabel = frozenUntil ? formatDayMonth(frozenUntil) : '';

    return (
        // Wave 1: светлая карточка Grid House (бумага, тонкая рамка) вместо
        // тёмной со свечением — один визуальный язык с остальным кабинетом.
        <div className="bg-card text-ink p-6 rounded-lg border border-ink-10 relative overflow-hidden">
            <div className="relative">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="text-ink-60 text-sm font-medium mb-1">Абонемент</div>
                        <h3 className="text-2xl font-semibold flex items-center gap-2">
                            {sub.name}
                            {(sub.bonusHours || 0) > 0 && (
                                <span className="bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] text-caption font-medium px-1.5 py-0.5 rounded">
                                    +{sub.bonusHours} ч бонус
                                </span>
                            )}
                        </h3>
                    </div>
                    {sub.isFrozen && (
                        <div className="bg-[var(--status-info-bg)] text-[var(--status-info-fg)] px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1">
                            <Snowflake size={12} aria-hidden="true" />
                            Заморожен
                        </div>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="mb-5">
                    <div className="flex justify-between text-sm mb-2">
                        <span className="text-ink-60">Остаток часов</span>
                        <span className="num font-semibold">{sub.remainingHours} / {totalWithBonus} ч</span>
                    </div>
                    <div className="h-2 bg-ink-10 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${sub.remainingHours < 5 ? 'bg-[var(--status-danger-solid)]' : 'bg-accent'}`}
                            style={{ width: `${percentRemaining}%` }}
                        />
                    </div>
                </div>

                {/* Perks Section */}
                {plan?.perks && plan.perks.length > 0 && (
                    <div className="mb-5 space-y-1.5">
                        {plan.perks.map((perk, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-ink-80">
                                <CheckCircle2 size={12} className="text-[var(--status-ok-fg)] shrink-0" aria-hidden="true" />
                                {perk}
                            </div>
                        ))}
                    </div>
                )}

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="bg-sunken p-2.5 rounded-lg">
                        <div className="flex items-center gap-2 text-ink-60 text-caption uppercase tracking-[0.06em] mb-1">
                            <Calendar size={12} />
                            Действует до
                        </div>
                        <div className="font-semibold text-sm">
                            {formatDayMonth(parseISO(sub.expiryDate), { withYear: 'auto' })}
                        </div>
                    </div>

                    <div className="bg-sunken p-2.5 rounded-lg">
                        <div className="flex items-center gap-2 text-ink-60 text-caption uppercase tracking-[0.06em] mb-1">
                            <RefreshCcw size={12} />
                            Переносы
                        </div>
                        <div className="font-semibold text-sm">
                            {sub.freeReschedules > 0 ? `${sub.freeReschedules} доступно` : 'Нет'}
                        </div>
                    </div>
                </div>

                {/* Action */}
                {viewerIsAdmin ? (
                <div className="space-y-2">
                    <Button
                        variant="outline"
                        disabled={!canFreeze && !sub.isFrozen}
                        className={`w-full h-11 border border-ink-20 bg-card hover:bg-ink-05 text-ink hover:text-ink rounded-lg ${sub.isFrozen ? 'bg-[var(--status-info-bg)] text-[var(--status-info-fg)] border-transparent' : ''}`}
                        onClick={() => toggleSubscriptionFreeze(user.email).catch((err: any) =>
                            toast.error(err?.response?.data?.detail || 'Не удалось изменить заморозку'))}
                    >
                        <Snowflake size={16} className="mr-2" />
                        {sub.isFrozen ? 'Разморозить' : 'Заморозить на 7 дней'}
                    </Button>

                    {!canFreeze && !sub.isFrozen && (
                        <p className="text-caption text-center text-ink-60">
                            Лимит заморозок исчерпан (1 раз)
                        </p>
                    )}
                </div>
                ) : (
                <div className="space-y-2 text-center">
                    {sub.isFrozen ? (
                        <p className="text-xs text-ink-80 leading-snug">
                            {pauseOver
                                ? `Пауза закончилась ${frozenUntilLabel}, но ещё не снята. Пока абонемент на паузе, брони оплачиваются с баланса.`
                                : 'Пока абонемент на паузе, часы не списываются — брони оплачиваются с баланса.'}
                        </p>
                    ) : (
                        <p className="text-xs text-ink-60 leading-snug">
                            {canFreeze
                                ? 'Абонемент можно один раз поставить на паузу на 7 дней — через администратора.'
                                : 'Пауза по этому абонементу уже использована.'}
                        </p>
                    )}
                    {(canFreeze || sub.isFrozen) && (
                        <a
                            href="https://t.me/UnboxCenter"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-center gap-2 w-full h-11 rounded-lg border border-ink-20 text-sm text-ink hover:bg-ink-05 transition-colors"
                        >
                            <Snowflake size={16} />
                            {sub.isFrozen ? 'Снять паузу — написать администратору' : 'Попросить паузу у администратора'}
                        </a>
                    )}
                </div>
                )}

                {sub.isFrozen && frozenUntil && (
                    <div className={`text-center text-caption font-medium mt-3 py-1.5 rounded-lg ${pauseOver ? 'text-[var(--status-pending-fg)] bg-[var(--status-pending-bg)]' : 'text-[var(--status-info-fg)] bg-[var(--status-info-bg)]'}`}>
                        {pauseOver ? `Пауза должна была закончиться ${frozenUntilLabel}` : `На паузе до ${frozenUntilLabel}`}
                    </div>
                )}
            </div>
        </div>
    );
};
