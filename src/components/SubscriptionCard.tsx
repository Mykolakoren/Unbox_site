import type { FC } from 'react';
import { useUserStore, type User } from '../store/userStore';
import { Calendar, RefreshCcw, Snowflake } from 'lucide-react';
import { Button } from './ui/Button';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

interface SubscriptionCardProps {
    user: User;
}

export const SubscriptionCard: FC<SubscriptionCardProps> = ({ user }) => {
    const { toggleSubscriptionFreeze } = useUserStore();
    const sub = user.subscription;

    if (!sub) return null;

    const percentRemaining = (sub.remainingHours / sub.totalHours) * 100;

    return (
        <div className="bg-gradient-to-br from-gray-900 to-black text-white p-6 rounded-2xl shadow-lg relative overflow-hidden">
            {/* Background Decor */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-2xl -mr-10 -mt-10" />

            <div className="relative z-10">
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <div className="text-white/60 text-sm font-medium mb-1">Абонемент</div>
                        <h3 className="text-2xl font-bold">{sub.name}</h3>
                    </div>
                    {sub.isFrozen && (
                        <div className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-xs flex items-center gap-1 border border-blue-500/30">
                            <Snowflake size={12} />
                            Заморожен
                        </div>
                    )}
                </div>

                {/* Progress Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-sm mb-2">
                        <span className="text-gray-400">Остаток часов</span>
                        <span className="font-bold">{sub.remainingHours} / {sub.totalHours} ч</span>
                    </div>
                    <div className="h-2 bg-gray-700/50 rounded-full overflow-hidden">
                        <div
                            className={`h-full rounded-full transition-all duration-500 ${sub.remainingHours < 5 ? 'bg-red-500' : 'bg-white'}`}
                            style={{ width: `${percentRemaining}%` }}
                        />
                    </div>
                </div>

                {/* Details Grid */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                            <Calendar size={14} />
                            Действует до
                        </div>
                        <div className="font-medium text-sm">
                            {format(parseISO(sub.expiryDate), 'd MMM yyyy', { locale: ru })}
                        </div>
                    </div>

                    <div className="bg-white/5 p-3 rounded-lg border border-white/10">
                        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
                            <RefreshCcw size={14} />
                            Переносы
                        </div>
                        <div className="font-medium text-sm">
                            {sub.freeReschedules > 0 ? `${sub.freeReschedules} доступно` : 'Нет'}
                        </div>
                    </div>
                </div>

                {/* Action */}
                <Button
                    variant="outline"
                    className={`w-full border-white/20 hover:bg-white/10 text-white ${sub.isFrozen ? 'bg-blue-500/20 border-blue-500/50 text-blue-200' : ''}`}
                    onClick={() => toggleSubscriptionFreeze(user.email)}
                >
                    <Snowflake size={16} className="mr-2" />
                    {sub.isFrozen ? 'Разморозить' : 'Заморозить абонемент'}
                </Button>

                {sub.isFrozen && sub.frozenUntil && (
                    <div className="text-center text-xs text-blue-300/70 mt-2">
                        До {format(parseISO(sub.frozenUntil), 'd MMM', { locale: ru })}
                    </div>
                )}
            </div>
        </div>
    );
};
