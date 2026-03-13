import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Wallet, Plus, AlertCircle, TrendingUp } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DiscountProgress } from '../components/Dashboard/DiscountProgress';

export function DashboardOverview() {
    const { currentUser } = useUserStore();
    const navigate = useNavigate();

    if (!currentUser) return null;

    const isNegative = currentUser.balance < 0;
    const creditLimit = currentUser.creditLimit || 0;
    const availableCredit = creditLimit + currentUser.balance;
    const usagePercent = Math.min(100, Math.max(0, (Math.abs(currentUser.balance) / creditLimit) * 100));

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h1 className="text-2xl font-bold mb-2">Обзор</h1>
                <p className="text-unbox-grey">Сводка вашего аккаунта и быстрые действия</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    {/* Balance Card */}
                    <div className="p-6 rounded-2xl relative overflow-hidden"
                        style={{
                            background: 'rgba(255,255,255,0.45)',
                            backdropFilter: 'blur(24px) saturate(150%)',
                            WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                            border: '1px solid rgba(255,255,255,0.65)',
                            boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
                        }}>
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <div className="text-sm text-unbox-grey font-medium mb-1">
                                    {isNegative ? 'Текущая задолженность' : 'Текущий баланс'}
                                </div>
                                <div className={`text-4xl font-bold ${isNegative ? 'text-red-500' : 'text-green-600'}`}>
                                    {currentUser.balance.toFixed(2)} ₾
                                </div>
                                {isNegative && (
                                    <div className="text-xs text-red-400 mt-1 font-medium">
                                        Кредитный лимит: {currentUser.creditLimit} ₾
                                    </div>
                                )}
                            </div>
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isNegative ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                                <Wallet size={24} />
                            </div>
                        </div>

                        {/* Credit Status Bar (Only if using credit) */}
                        {isNegative && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-medium">
                                    <span className="text-unbox-grey">Использовано кредита</span>
                                    <span className={availableCredit < 50 ? 'text-red-500' : 'text-unbox-dark'}>
                                        Доступно: {availableCredit.toFixed(2)} ₾
                                    </span>
                                </div>
                                <div className="w-full bg-unbox-light/50 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${availableCredit < 50 ? 'bg-red-500' : 'bg-unbox-green'}`}
                                        style={{ width: `${usagePercent}%` }}
                                    ></div>
                                </div>
                            </div>
                        )}

                        {!isNegative && (
                            <div className="flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-lg w-fit">
                                <TrendingUp size={16} />
                                <span>Активный депозит</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Discount Progress Visualizer */}
                <DiscountProgress />

                {/* Quick Actions (Full width on smaller, grid column on larger) */}
                <div className="p-6 rounded-2xl flex flex-col justify-center gap-4 lg:col-span-2"
                    style={{
                        background: 'rgba(255,255,255,0.45)',
                        backdropFilter: 'blur(24px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                        border: '1px solid rgba(255,255,255,0.65)',
                        boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
                    }}>
                    <h3 className="font-bold text-lg">Быстрые действия</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Button onClick={() => navigate('/')} className="w-full justify-start py-6" size="lg">
                            <Plus className="mr-2" />
                            Новое бронирование
                        </Button>
                        <Button onClick={() => navigate('/dashboard/bookings')} variant="outline" className="w-full justify-start py-6" size="lg">
                            <AlertCircle className="mr-2" />
                            Мои бронирования
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
