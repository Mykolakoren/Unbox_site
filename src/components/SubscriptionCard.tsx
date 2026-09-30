import type { FC } from 'react';
import { toast } from 'sonner';
import { useUserStore, type User } from '../store/userStore';
import { Calendar, RefreshCcw, Snowflake, CheckCircle2 } from 'lucide-react';
import { LegacyButton as Button } from './ui/LegacyButton';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
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
    const frozenUntilLabel = frozenUntil ? format(frozenUntil, 'd MMMM', { locale: ru }) : '';

    return (
        <div className="bg-unbox-dark text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-unbox-green/20 rounded-full blur-2xl -mr-10 -mt-10" />

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <div className="text-white/60 text-sm font-medium mb-1">Абонемент</div>
                        <h3 className="text-2xl font-bold flex items-center gap-2">
                            {sub.name}
                            {(sub.bonusHours || 0) > 0 && (
                                <span className="bg-unbox-green/20 text-unbox-green text-[10px] px-1.5 py-0.5 rounded border border-unbox-green/30">
                                    +{sub.bonusHours}ч бонус
                                </span>
                            )}
                        </h3>
                    </div>
                    {sub.isFrozen && (
                        <div className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-1 border border-blue-500/30">
                            <Snowflake size={12} />
                            Заморожен
                        </div>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="mb-5">
                    <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-400">Остаток часов</span>
                        <span className="font-bold">{sub.remainingHours} / {totalWithBonus} ч</span>
                    </div>
                    <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${sub.remainingHours < 5 ? 'bg-red-500' : 'bg-unbox-green'}`}
                            style={{ width: `${percentRemaining}%` }}
                        />
                    </div>
                </div>

                {/* Perks Section */}
                {plan?.perks && plan.perks.length > 0 && (
                    <div className="mb-5 space-y-1.5">
                        {plan.perks.map((perk, i) => (
                            <div key={i} className="flex items-center gap-2 text-xs text-white/80">
                                <CheckCircle2 size={12} className="text-unbox-green" />
                                {perk}
                            </div>
                        ))}
                    </div>
                )}

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-3 mb-5">
                    <div className="bg-white/5 p-2.5 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 text-gray-400 text-[10px] uppercase tracking-wider mb-1">
                            <Calendar size={12} />
                            Действует до
                        </div>
                        <div className="font-bold text-sm">
                            {format(parseISO(sub.expiryDate), 'd MMM yyyy', { locale: ru })}
                        </div>
                    </div>

                    <div className="bg-white/5 p-2.5 rounded-xl border border-white/10">
                        <div className="flex items-center gap-2 text-gray-400 text-[10px] uppercase tracking-wider mb-1">
                            <RefreshCcw size={12} />
                            Переносы
                        </div>
                        <div className="font-bold text-sm">
                            {sub.freeReschedules > 0 ? `${sub.freeReschedules} дост.` : 'Нет'}
                        </div>
                    </div>
                </div>

                {/* Action */}
                {viewerIsAdmin ? (
                <div className="space-y-2">
                    <Button
                        variant="outline"
                        disabled={!canFreeze && !sub.isFrozen}
                        className={`w-full h-10 border-white/10 hover:bg-white/10 text-white hover:text-white rounded-xl ${sub.isFrozen ? 'bg-blue-600/30 border-blue-500/50 text-blue-100' : ''}`}
                        onClick={() => toggleSubscriptionFreeze(user.email).catch((err: any) =>
                            toast.error(err?.response?.data?.detail || 'Не удалось изменить заморозку'))}
                    >
                        <Snowflake size={16} className="mr-2" />
                        {sub.isFrozen ? 'Разморозить' : 'Заморозить на 7 дней'}
                    </Button>

                    {!canFreeze && !sub.isFrozen && (
                        <p className="text-[10px] text-center text-white/40">
                            Лимит заморозок исчерпан (1 раз)
                        </p>
                    )}
                </div>
                ) : (
                <div className="space-y-2 text-center">
                    {sub.isFrozen ? (
                        <p className="text-xs text-blue-100 leading-snug">
                            {pauseOver
                                ? `Пауза закончилась ${frozenUntilLabel}, но ещё не снята. Пока абонемент на паузе, брони оплачиваются с баланса.`
                                : 'Пока абонемент на паузе, часы не списываются — брони оплачиваются с баланса.'}
                        </p>
                    ) : (
                        <p className="text-xs text-white/60 leading-snug">
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
                            className="flex items-center justify-center gap-2 w-full h-11 rounded-xl border border-white/15 text-sm text-white hover:bg-white/10 transition-colors"
                        >
                            <Snowflake size={16} />
                            {sub.isFrozen ? 'Снять паузу — написать администратору' : 'Попросить паузу у администратора'}
                        </a>
                    )}
                </div>
                )}

                {sub.isFrozen && frozenUntil && (
                    <div className={`text-center text-[11px] font-medium mt-3 py-1.5 rounded-lg border ${pauseOver ? 'text-amber-200 bg-amber-500/10 border-amber-500/30' : 'text-blue-300 bg-blue-500/10 border-blue-500/20'}`}>
                        {pauseOver ? `Пауза должна была закончиться ${frozenUntilLabel}` : `На паузе до ${frozenUntilLabel}`}
                    </div>
                )}
            </div>
        </div>
    );
};
