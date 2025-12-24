import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { User, Phone, Mail } from 'lucide-react';

export function ProfilePage() {
    const { user, updateUser } = useUserStore();

    if (!user) return null;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h1 className="text-2xl font-bold">Настройки профиля</h1>

            <div className="bg-white p-6 rounded-2xl border border-gray-200 space-y-6">
                <div className="flex items-center gap-4 pb-6 border-b border-gray-100">
                    <div className="w-16 h-16 rounded-full bg-black text-white flex items-center justify-center text-2xl font-bold">
                        {user.name[0].toUpperCase()}
                    </div>
                    <div>
                        <div className="font-bold text-xl">{user.name}</div>
                        <div className="text-sm text-gray-500">Участник с декабря 2025</div>
                    </div>
                </div>

                <div className="space-y-4 max-w-md">
                    <div>
                        <label className="block text-sm font-medium mb-2">Имя</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                value={user.name}
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
                                value={user.email}
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
                                value={user.phone}
                                onChange={(e) => updateUser({ phone: e.target.value })}
                            />
                        </div>
                    </div>

                    <div className="pt-4">
                        <Button>Сохранить изменения</Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
