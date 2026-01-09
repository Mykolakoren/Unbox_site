import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { Shield, RefreshCcw, User, Phone, Mail, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SubscriptionCard } from '../components/SubscriptionCard';
import type { Format } from '../types';

import { ReconciliationModal } from '../components/ReconciliationModal';
import { useState } from 'react';

export function ProfilePage() {
    const { currentUser, updateUser } = useUserStore();
    const [isReconciliationModalOpen, setIsReconciliationModalOpen] = useState(false);

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
                    <div className="relative group">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-black text-white flex items-center justify-center text-2xl font-bold">
                            {currentUser.avatarUrl ? (
                                <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
                            ) : (
                                currentUser.name[0]?.toUpperCase()
                            )}
                        </div>
                        <label className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity">
                            <Plus size={20} />
                            <input
                                type="file"
                                className="hidden"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) {
                                        const reader = new FileReader();
                                        reader.onloadend = () => {
                                            updateUser({ avatarUrl: reader.result as string });
                                        };
                                        reader.readAsDataURL(file);
                                    }
                                }}
                            />
                        </label>
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
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-unbox-green focus:border-unbox-green"
                            value={currentUser.creditLimit}
                            onChange={(e) => updateUser({ creditLimit: Number(e.target.value) })}
                        />
                        <p className="text-xs text-gray-400 mt-1">Максимальная сумма долга</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-2">Установить баланс (₾)</label>
                        <input
                            type="number"
                            className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:ring-unbox-green focus:border-unbox-green"
                            value={currentUser.balance}
                            onChange={(e) => updateUser({ balance: Number(e.target.value) })}
                        />
                        <p className="text-xs text-gray-400 mt-1">Для теста (пополнение/списание)</p>
                    </div>
                    <div className="md:col-span-2 pt-4 border-t border-gray-200">
                        <label className="block text-sm font-medium mb-2">Абонемент</label>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="primary"
                                className="w-full md:w-auto"
                                onClick={handleGrantSubscription}
                            >
                                <Plus size={16} className="mr-2" />
                                Начислить тестовый абонемент (50ч)
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full md:w-auto"
                                onClick={() => setIsReconciliationModalOpen(true)}
                            >
                                <RefreshCcw size={16} className="mr-2" />
                                Пересчет скидки (Текущая неделя)
                            </Button>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">Добавит/перезапишет текущий абонемент</p>
                    </div>
                </div>

                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold">Профиль</h1>

                    {/* Reconciliation Button */}
                    <button
                        onClick={() => setIsReconciliationModalOpen(true)}
                        className="flex items-center gap-2 text-sm font-medium text-unbox-grey hover:text-unbox-dark bg-gray-50 hover:bg-unbox-light px-3 py-2 rounded-lg transition-colors"
                    >
                        <RefreshCcw size={16} />
                        Сверка бонусов
                    </button>
                </div>

                <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold">
                            {currentUser?.name?.[0].toUpperCase()}
                        </div>
                        <div>
                            <h2 className="text-xl font-bold">{currentUser?.name}</h2>
                            <p className="text-gray-500">{currentUser?.email}</p>
                            <p className="text-gray-400 text-sm">{currentUser?.phone}</p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Текущий баланс
                            </label>
                            <div className="text-2xl font-bold">
                                {currentUser?.balance ?? 0} ₾
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Статус
                            </label>
                            <div className="inline-flex items-center px-3 py-1 rounded-full bg-gray-100 text-gray-800 text-sm font-medium">
                                Standard
                            </div>
                        </div>
                    </div>
                </div>

                {/* Admin Access Section */}
                {(currentUser?.email === 'admin@unbox.ge' || true) && ( // Temporary: Allow everyone to see for demo
                    <div className="pt-6 border-t border-gray-100 mt-6">
                        <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                            <Shield className="text-unbox-green" size={20} />
                            Администрирование
                        </h3>

                        <div className="bg-unbox-light border border-unbox-green/20 rounded-xl p-6">
                            <p className="text-unbox-dark mb-4">
                                Вам доступна панель администратора для управления бронированиями и клиентами.
                            </p>
                            <Link to="/admin">
                                <Button className="w-full sm:w-auto">
                                    Перейти в панель администратора
                                </Button>
                            </Link>
                        </div>
                    </div>
                )}    </div>

            <ReconciliationModal
                isOpen={isReconciliationModalOpen}
                onClose={() => setIsReconciliationModalOpen(false)}
            />
        </div>
    );
}
