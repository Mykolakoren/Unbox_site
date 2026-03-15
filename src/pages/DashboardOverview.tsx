import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Wallet, Plus, AlertCircle, TrendingUp, Calendar, ArrowDownCircle, CreditCard, RotateCcw, Pencil, Receipt, Clock } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DiscountProgress } from '../components/Dashboard/DiscountProgress';
import { RESOURCES } from '../utils/data';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

export function DashboardOverview() {
    const { currentUser, bookings, getTransactionsByUser } = useUserStore();
    const navigate = useNavigate();

    if (!currentUser) return null;

    const isNegative = currentUser.balance < 0;
    const creditLimit = currentUser.creditLimit || 0;
    const availableCredit = creditLimit + currentUser.balance;
    const usagePercent = Math.min(100, Math.max(0, (Math.abs(currentUser.balance) / creditLimit) * 100));

    // Recent bookings
    const recentBookings = bookings
        .filter(b => b.userId === currentUser.email || b.userId === currentUser.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);

    // Recent transactions
    const recentTransactions = getTransactionsByUser(currentUser.id).slice(0, 5);

    const statusConfig: Record<string, { label: string; color: string }> = {
        confirmed: { label: 'Активно', color: 'bg-emerald-50 text-emerald-700' },
        completed: { label: 'Завершено', color: 'bg-blue-50 text-blue-700' },
        cancelled: { label: 'Отменено', color: 'bg-red-50 text-red-600' },
        no_show: { label: 'Неявка', color: 'bg-amber-50 text-amber-700' },
        're-rented': { label: 'Пересдано', color: 'bg-purple-50 text-purple-700' },
        rescheduled: { label: 'Перенесено', color: 'bg-sky-50 text-sky-700' },
    };

    const transactionTypeConfig: Record<string, { label: string; icon: typeof ArrowDownCircle; color: string }> = {
        deposit: { label: 'Пополнение', icon: ArrowDownCircle, color: 'text-green-600' },
        booking_payment: { label: 'Оплата бронирования', icon: CreditCard, color: 'text-blue-600' },
        refund: { label: 'Возврат', icon: RotateCcw, color: 'text-amber-600' },
        manual_correction: { label: 'Корректировка', icon: Pencil, color: 'text-purple-600' },
        subscription_purchase: { label: 'Покупка абонемента', icon: Receipt, color: 'text-indigo-600' },
        expense: { label: 'Расход', icon: CreditCard, color: 'text-red-600' },
    };

    const formatBookingDate = (dateValue: Date | string) => {
        try {
            const d = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
            return format(d, 'd MMM yyyy', { locale: ru });
        } catch {
            return String(dateValue);
        }
    };

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

                {/* Booking History */}
                <div className="p-6 rounded-2xl lg:col-span-2"
                    style={{
                        background: 'rgba(255,255,255,0.45)',
                        backdropFilter: 'blur(24px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                        border: '1px solid rgba(255,255,255,0.65)',
                        boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
                    }}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Calendar size={20} className="text-unbox-green" />
                            История бронирований
                        </h3>
                        {recentBookings.length > 0 && (
                            <button
                                onClick={() => navigate('/dashboard/bookings')}
                                className="text-sm text-unbox-green hover:underline font-medium"
                            >
                                Все →
                            </button>
                        )}
                    </div>
                    {recentBookings.length === 0 ? (
                        <p className="text-unbox-grey text-sm py-4 text-center">У вас пока нет бронирований</p>
                    ) : (
                        <div className="space-y-2">
                            {recentBookings.map(b => {
                                const resource = RESOURCES.find(r => r.id === b.resourceId);
                                const status = statusConfig[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-600' };
                                return (
                                    <div key={b.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/40 hover:bg-white/60 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-10 h-10 rounded-lg bg-unbox-green/10 flex items-center justify-center flex-shrink-0">
                                                <Calendar size={18} className="text-unbox-green" />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm truncate">
                                                    {resource?.name || 'Кабинет'} · {formatBookingDate(b.date)}
                                                </div>
                                                <div className="text-xs text-unbox-grey flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {b.startTime || '—'} · {b.duration ? `${b.duration / 60}ч` : '—'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0">
                                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                                                {status.label}
                                            </span>
                                            <span className="font-semibold text-sm w-16 text-right">
                                                {b.finalPrice?.toFixed(0) ?? '—'} ₾
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Payment History */}
                <div className="p-6 rounded-2xl lg:col-span-2"
                    style={{
                        background: 'rgba(255,255,255,0.45)',
                        backdropFilter: 'blur(24px) saturate(150%)',
                        WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                        border: '1px solid rgba(255,255,255,0.65)',
                        boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
                    }}>
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg flex items-center gap-2">
                            <Wallet size={20} className="text-unbox-green" />
                            История платежей
                        </h3>
                    </div>
                    {recentTransactions.length === 0 ? (
                        <p className="text-unbox-grey text-sm py-4 text-center">Платежей пока нет</p>
                    ) : (
                        <div className="space-y-2">
                            {recentTransactions.map(t => {
                                const config = transactionTypeConfig[t.type] || { label: t.type, icon: CreditCard, color: 'text-gray-600' };
                                const TxIcon = config.icon;
                                const isPositive = t.type === 'deposit' || t.type === 'refund';
                                return (
                                    <div key={t.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/40 hover:bg-white/60 transition-colors">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50`}>
                                                <TxIcon size={18} className={config.color} />
                                            </div>
                                            <div className="min-w-0">
                                                <div className="font-medium text-sm truncate">{config.label}</div>
                                                <div className="text-xs text-unbox-grey">
                                                    {t.description || format(new Date(t.date), 'd MMM yyyy, HH:mm', { locale: ru })}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-3 flex-shrink-0">
                                            <span className="text-xs text-unbox-grey capitalize">
                                                {t.paymentMethod === 'cash' ? 'Наличные' :
                                                 t.paymentMethod === 'tbc' ? 'TBC' :
                                                 t.paymentMethod === 'bog' ? 'BOG' :
                                                 t.paymentMethod === 'balance' ? 'Баланс' :
                                                 t.paymentMethod === 'card' ? 'Карта' :
                                                 t.paymentMethod === 'transfer' ? 'Перевод' :
                                                 t.paymentMethod === 'admin_adjustment' ? 'Админ' :
                                                 t.paymentMethod}
                                            </span>
                                            <span className={`font-semibold text-sm w-20 text-right ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                                                {isPositive ? '+' : '−'}{Math.abs(t.amount).toFixed(0)} {t.currency === 'GEL' ? '₾' : t.currency}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
