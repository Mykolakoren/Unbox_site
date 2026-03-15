import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { Shield, User, Phone, Mail, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { hasPermission } from '../utils/permissions';

export function ProfilePage() {
    const { currentUser, updateUser } = useUserStore();

    if (!currentUser) return null;

    const isAdmin = currentUser.role && ['owner', 'senior_admin', 'admin'].includes(currentUser.role);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-2xl font-bold">Настройки профиля</h1>

            <div className="bg-white p-6 rounded-2xl border border-unbox-light space-y-6">
                <div className="flex items-center gap-4 pb-6 border-b border-unbox-light">
                    <div className="relative group">
                        <div className="w-16 h-16 rounded-full overflow-hidden bg-unbox-dark text-white flex items-center justify-center text-2xl font-bold">
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
                        <div className="text-sm text-unbox-grey">Участник с декабря 2025</div>
                    </div>
                    <div className="ml-auto bg-unbox-light/30 px-4 py-2 rounded-xl text-right">
                        <div className="text-xs text-unbox-grey uppercase font-bold">Баланс</div>
                        <div className="text-xl font-bold text-unbox-dark">{currentUser.balance.toFixed(1)} ₾</div>
                    </div>
                </div>

                {/* Subscription Widget */}
                {currentUser.subscription ? (
                    <div className="pb-6 border-b border-unbox-light">
                        <SubscriptionCard user={currentUser} />
                    </div>
                ) : (
                    <div className="pb-6 border-b border-unbox-light text-center py-4 bg-unbox-light/30 rounded-xl">
                        <p className="text-unbox-grey text-sm">У вас нет активного абонемента</p>
                    </div>
                )}

                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-medium mb-2">Имя</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={currentUser.name}
                                onChange={(e) => updateUser({ name: e.target.value })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Email</label>
                        <div className="relative">
                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                            <input
                                type="email"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={currentUser.email}
                                onChange={(e) => updateUser({ email: e.target.value })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Телефон</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                            <input
                                type="tel"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
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

            {/* Admin Access Section — only for users with admin role or admin.access permission */}
            {(isAdmin || hasPermission(currentUser, 'admin.access')) && (
                <div className="bg-white p-6 rounded-2xl border border-unbox-light">
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
            )}
        </div>
    );
}
