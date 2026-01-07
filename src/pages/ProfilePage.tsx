import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { User, Phone, Mail, Plus } from 'lucide-react';
import { SubscriptionCard } from '../components/SubscriptionCard';
import type { Format } from '../types';

export function ProfilePage() {
    const { currentUser, updateUser } = useUserStore();

    if (!currentUser) return null;

    const handleGrantSubscription = () => {
        updateUser({
            subscription: {
                id: `sub-test-${Date.now()}`,
                name: 'Unbox Pro (Test)',
                totalHours: 50,
                remainingHours: 50,
                freeReschedules: 5,
                expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                isFrozen: false,
                includedFormats: ['individual', 'group'] as Format[]
            }
        });
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-2xl font-bold">Настройки профиля</h1>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-6">
                <div className="flex items-center gap-4 pb-6 border-b border-gray-100">
                    <div className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold">
                        {currentUser.name[0].toUpperCase()}
                    </div>
                    <div>
                        <div className="font-bold text-xl">{currentUser.name}</div>
                        <div className="text-sm text-gray-500">Участник с декабря 2025</div>
                    </div>
                    <div className="ml-auto bg-gray-50 px-4 py-2 rounded-xl text-right">
                        <div className="text-xs text-gray-500 uppercase font-bold">Баланс</div>
                        <div className="text-xl font-bold text-black">{currentUser.balance.toFixed(1)} ₾</div>
                    </div>
                </div>

                {/* Subscription Widget */}
                {currentUser.subscription ? (
                    <div className="pb-6 border-b border-gray-100">
                        <SubscriptionCard user={currentUser} />
                    </div>
                ) : (
                    <div className="pb-6 border-b border-gray-100 text-center py-4 bg-gray-50 rounded-xl">
                        <p className="text-gray-500 text-sm">У вас нет активного абонемента</p>
                    </div>
                )}

                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-medium mb-2">Имя</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                value={currentUser.name}
                                onChange={(e) => updateUser({ name: e.target.value })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="email"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                value={currentUser.email}
                                onChange={(e) => updateUser({ email: e.target.value })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Телефон</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="tel"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                value={currentUser.phone}
                                onChange={(e) => updateUser({ phone: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button>Сохранить изменения</Button>
                    </div>
                </div>
            </div>

            {/* Mock Admin Controls */}
            <div className="bg-gray-50 border border-dashed border-gray-300 p-6 rounded-2xl">
                <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">⚙️ Админ-панель (Демо)</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium mb-2">Кредитный лимит (₾)</label>
                        <input
                            type="number"
                            className="w-full px-4 py-2 rounded-xl border border-gray-200"
                            value={currentUser.creditLimit}
                            onChange={(e) => updateUser({ creditLimit: Number(e.target.value) })}
                        />
                        <p className="text-xs text-gray-400 mt-1">Максимальная сумма долга</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Установить баланс (₾)</label>
                        <input
                            type="number"
                            className="w-full px-4 py-2 rounded-xl border border-gray-200"
                            value={currentUser.balance}
                            onChange={(e) => updateUser({ balance: Number(e.target.value) })}
                        />
                        <p className="text-xs text-gray-400 mt-1">Для теста (пополнение/списание)</p>
                    </div>
                    <div className="md:col-span-2 pt-4 border-t border-gray-200">
                        <label className="block text-sm font-medium mb-2">Абонемент</label>
                        <Button
                            variant="primary"
                            className="w-full md:w-auto"
                            onClick={handleGrantSubscription}
                        >
                            <Plus size={16} className="mr-2" />
                            Начислить тестовый абонемент (50ч)
                        </Button>
                        <p className="text-xs text-gray-400 mt-1">Добавит/перезапишет текущий абонемент</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
