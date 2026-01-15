import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Wallet, Plus, AlertCircle, TrendingUp } from 'lucide-react';
import { Button } from '../components/ui/Button';

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
                <p className="text-gray-500">Сводка вашего аккаунта и быстрые действия</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Balance Card */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <div className="text-sm text-gray-500 font-medium mb-1">
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
                                <span className="text-gray-500">Использовано кредита</span>
                                <span className={availableCredit < 50 ? 'text-red-500' : 'text-gray-700'}>
                                    Доступно: {availableCredit.toFixed(2)} ₾
                                </span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                                <div
                                    className={`h-full rounded-full ${availableCredit < 50 ? 'bg-red-500' : 'bg-blue-500'}`}
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

                {/* Quick Actions */}
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col justify-center gap-4">
                    <h3 className="font-bold text-lg">Быстрые действия</h3>
                    <Button onClick={() => navigate('/')} className="w-full justify-start" size="lg">
                        <Plus className="mr-2" />
                        Новое бронирование
                    </Button>
                    <Button onClick={() => navigate('/dashboard/bookings')} variant="outline" className="w-full justify-start" size="lg">
                        <AlertCircle className="mr-2" />
                        Мои бронирования
                    </Button>
                </div>
            </div>
        </div>
    );
}
