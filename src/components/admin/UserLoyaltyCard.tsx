import { useState } from 'react';
import { Crown, Percent, History, TrendingUp, Info, Pencil } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import clsx from 'clsx';



interface UserLoyaltyCardProps {
    email: string;
}

export function UserLoyaltyCard({ email }: UserLoyaltyCardProps) {
    const { users, bookings, updatePersonalDiscount } = useUserStore();
    const user = users.find(u => u.email === email);
    const [isEditDiscount, setIsEditDiscount] = useState(false);
    const [newDiscount, setNewDiscount] = useState(0);
    const [discountReason, setDiscountReason] = useState('Коррекция администратора');

    if (!user) return null;

    // Calculate Total Hours
    const totalHours = bookings
        .filter(b => b.userId === user.email && (b.status === 'completed' || b.status === 'confirmed'))
        .reduce((sum, b) => sum + (b.duration / 60), 0);

    // Determine Level
    let level: 'basic' | 'loyal' | 'vip' = 'basic';
    let nextLevelHours = 10;

    if (totalHours >= 30) {
        level = 'vip';
        nextLevelHours = 0; // Max level
    } else if (totalHours >= 10) {
        level = 'loyal';
        nextLevelHours = 30;
    }

    const progress = level === 'vip' ? 100 : (totalHours / nextLevelHours) * 100;

    const LEVEL_CONFIG = {
        basic: { label: 'Базовый', color: 'text-gray-600', bg: 'bg-gray-100', icon: Info },
        loyal: { label: 'Лояльный', color: 'text-blue-600', bg: 'bg-blue-100', icon: TrendingUp },
        vip: { label: 'VIP', color: 'text-purple-600', bg: 'bg-purple-100', icon: Crown },
    };

    const LevelIcon = LEVEL_CONFIG[level].icon;

    const handleUpdateDiscount = () => {
        updatePersonalDiscount(user.id, newDiscount, discountReason);
        setIsEditDiscount(false);
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-6">
            <h3 className="font-bold text-lg flex items-center gap-2">
                <Crown size={20} className="text-gray-400" />
                Лояльность и Скидки
            </h3>

            {/* Level Section */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex justify-between items-center mb-3">
                    <div>
                        <div className="text-xs text-gray-500 uppercase tracking-wider font-bold mb-1">Уровень клиента</div>
                        <div className={clsx("flex items-center gap-2 font-bold text-lg", LEVEL_CONFIG[level].color)}>
                            <LevelIcon size={20} />
                            {LEVEL_CONFIG[level].label}
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-2xl font-bold">{totalHours.toFixed(1)}</div>
                        <div className="text-xs text-gray-400">часов накоплено</div>
                    </div>
                </div>

                {level !== 'vip' && (
                    <div className="space-y-2">
                        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden">
                            <div
                                className={clsx("h-full rounded-full transition-all duration-500",
                                    level === 'loyal' ? 'bg-blue-500' : 'bg-gray-500'
                                )}
                                style={{ width: `${Math.min(progress, 100)}%` }}
                            />
                        </div>
                        <div className="text-xs text-gray-500 text-center">
                            Ещё {(nextLevelHours - totalHours).toFixed(1)} часов до уровня {level === 'basic' ? 'Лояльный' : 'VIP'}
                        </div>
                    </div>
                )}
            </div>

            {/* Active Discounts Section */}
            <div>
                <div className="text-sm font-bold text-gray-800 mb-3 flex items-center justify-between">
                    <span>Активные скидки</span>
                    {user.personalDiscountPercent ? (
                        <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">
                            Да
                        </span>
                    ) : null}
                </div>

                <div className="space-y-2">
                    {/* Fixed Personal Discount */}
                    <div className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg hover:border-gray-200 transition-colors">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                                <Percent size={14} />
                            </div>
                            <div>
                                <div className="text-sm font-medium">Персональная</div>
                                <div className="text-xs text-gray-400">Постоянная скидка</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-2">
                                {isEditDiscount ? (
                                    <div className="flex items-center gap-2 animate-in fade-in zoom-in duration-200">
                                        <div className="relative">
                                            <input
                                                type="number"
                                                value={newDiscount}
                                                onChange={(e) => setNewDiscount(Number(e.target.value))}
                                                className="w-16 px-2 py-1 text-sm border border-unbox-green rounded focus:outline-none focus:ring-1 focus:ring-unbox-green"
                                                autoFocus
                                            />
                                            <span className="absolute right-1 top-1 text-xs text-gray-400 font-bold">%</span>
                                        </div>
                                        <input
                                            type="text"
                                            value={discountReason}
                                            onChange={(e) => setDiscountReason(e.target.value)}
                                            placeholder="Причина"
                                            className="w-32 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-unbox-green"
                                        />
                                        <button onClick={handleUpdateDiscount} className="text-xs bg-black text-white px-2 py-1 rounded hover:bg-gray-800 transition-colors">Ok</button>
                                        <button onClick={() => setIsEditDiscount(false)} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200 transition-colors">X</button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-3">
                                        <span className={clsx("font-bold text-lg", user.personalDiscountPercent ? "text-unbox-green" : "text-gray-400")}>
                                            {user.personalDiscountPercent || 0}%
                                        </span>
                                        <button
                                            onClick={() => {
                                                setNewDiscount(user.personalDiscountPercent || 0);
                                                setIsEditDiscount(true);
                                            }}
                                            className="p-1.5 rounded-full hover:bg-gray-100 text-gray-400 hover:text-unbox-dark transition-colors"
                                            title="Изменить скидку"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Automated Discounts Info */}
                    <div className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg opacity-80">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-orange-50 flex items-center justify-center text-orange-600">
                                <TrendingUp size={14} />
                            </div>
                            <div>
                                <div className="text-sm font-medium">За объём</div>
                                <div className="text-xs text-gray-400">5+ часов: 10% | 11+ часов: 25%</div>
                            </div>
                        </div>
                        <div className="text-xs text-gray-400 font-medium">Авто</div>
                    </div>

                    <div className="flex items-center justify-between p-3 bg-white border border-gray-100 rounded-lg opacity-80">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center text-purple-600">
                                <Crown size={14} />
                            </div>
                            <div>
                                <div className="text-sm font-medium">VIP Спецпредложение</div>
                                <div className="text-xs text-gray-400">Индивидуальные условия</div>
                            </div>
                        </div>
                        <div className="text-xs text-gray-400 font-medium">По запросу</div>
                    </div>
                </div>
            </div>

            {/* Discount History Log */}
            <div>
                <div className="text-sm font-bold text-gray-800 mb-3 flex items-center gap-2">
                    <History size={16} className="text-gray-400" />
                    История изменений
                </div>

                <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2">
                    {(!user.discountHistory || user.discountHistory.length === 0) && (
                        <div className="text-center text-xs text-gray-400 py-4">История изменений пуста</div>
                    )}
                    {user.discountHistory?.map(log => (
                        <div key={log.id} className="text-sm border-l-2 border-gray-200 pl-3 py-1 relative">
                            <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-gray-300"></div>
                            <div className="flex justify-between">
                                <span className="font-medium text-gray-900">{log.oldValue}% → {log.newValue}%</span>
                                <span className="text-xs text-gray-400">{format(new Date(log.date), 'd MMM yyyy', { locale: ru })}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">{log.reason}</div>
                            <div className="text-[10px] text-gray-400 mt-0.5">by {log.adminName}</div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
