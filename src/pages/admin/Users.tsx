import { useState, useEffect } from 'react';
import { useUserStore, type User } from '../../store/userStore';
import { Search, Edit, Shield, User as UserIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

export function AdminUsers() {
    const { users, updateUserById, fetchUsers } = useUserStore();
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const filteredUsers = users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        u.phone.includes(search)
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Клиенты</h1>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input
                        type="text"
                        placeholder="Поиск клиента..."
                        className="pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black w-64"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm">
                <table className="w-full text-left">
                    <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                        <tr>
                            <th className="p-4 pl-6">Клиент</th>
                            <th className="p-4">Роль</th>
                            <th className="p-4">Баланс</th>
                            <th className="p-4">Скидка</th>
                            <th className="p-4">Тип цен</th>
                            <th className="p-4 text-right">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-unbox-light">
                        {filteredUsers.map(user => (
                            <tr key={user.email} className="hover:bg-unbox-light/30 transition-colors">
                                <td className="p-4 pl-6">
                                    <Link
                                        to={`/admin/users/${encodeURIComponent(user.email)}`}
                                        className="flex items-center gap-3 group cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-unbox-light flex items-center justify-center font-bold text-unbox-dark group-hover:bg-unbox-green group-hover:text-white transition-colors">
                                            {user.name.charAt(0)}
                                        </div>
                                        <div>
                                            <div className="font-medium text-unbox-dark flex items-center gap-2 group-hover:text-unbox-green transition-colors">
                                                {user.name}
                                                {user.isAdmin && <Shield size={14} className="text-unbox-green" />}
                                            </div>
                                            <div className="text-xs text-unbox-grey">{user.email}</div>
                                            {user.phone && <div className="text-xs text-unbox-grey">{user.phone}</div>}
                                        </div>
                                    </Link>
                                </td>
                                <td className="p-4">
                                    <span className={clsx(
                                        "px-2 py-1 rounded text-xs font-medium border",
                                        user.role === 'owner' ? "bg-purple-50 text-purple-700 border-purple-200" :
                                            user.role === 'senior_admin' ? "bg-blue-50 text-blue-700 border-blue-200" :
                                                user.role === 'admin' ? "bg-green-50 text-green-700 border-green-200" :
                                                    "bg-gray-50 text-gray-600 border-gray-200"
                                    )}>
                                        {user.role === 'owner' ? 'Владелец' :
                                            user.role === 'senior_admin' ? 'Ст. Админ' :
                                                user.role === 'admin' ? 'Админ' : 'Пользователь'}
                                    </span>
                                </td>
                                <td className="p-4">
                                    <span className={clsx(
                                        "font-medium",
                                        user.balance < 0 ? "text-red-500" : "text-unbox-green"
                                    )}>
                                        {user.balance.toFixed(2)} ₾
                                    </span>
                                </td>
                                <td className="p-4">
                                    {user.personalDiscountPercent ? (
                                        <span className="bg-unbox-light text-unbox-green px-2 py-1 rounded text-xs font-bold">
                                            {user.personalDiscountPercent}%
                                        </span>
                                    ) : (
                                        <span className="text-unbox-grey text-sm">—</span>
                                    )}
                                </td>
                                <td className="p-4 text-sm text-unbox-dark">
                                    {user.pricingSystem === 'personal' ? 'Персональный' : 'Стандарт'}
                                </td>
                                <td className="p-4 text-right">
                                    <div className="flex justify-end gap-2">
                                        <Link
                                            to={`/admin/users/${encodeURIComponent(user.email)}`}
                                            className="p-2 hover:bg-unbox-light rounded-lg text-unbox-green"
                                            title="Карточка клиента"
                                        >
                                            <UserIcon size={16} />
                                        </Link>
                                        <button
                                            className="p-2 hover:bg-unbox-light rounded-lg text-unbox-grey hover:text-unbox-dark"
                                            onClick={() => setSelectedUser(user)}
                                            title="Быстрые настройки"
                                        >
                                            <Edit size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {filteredUsers.length === 0 && (
                    <div className="p-8 text-center text-unbox-grey">
                        Ничего не найдено
                    </div>
                )}
            </div>

            {/* Edit User Modal */}
            {selectedUser && (
                <UserEditModal
                    user={selectedUser}
                    onClose={() => setSelectedUser(null)}
                    onUpdate={updateUserById}
                />
            )}
        </div>
    );
}

function UserEditModal({ user, onClose, onUpdate }: { user: User, onClose: () => void, onUpdate: (id: string, data: Partial<User>) => Promise<void> }) {
    const currentUser = useUserStore(s => s.currentUser);
    const isOwner = currentUser?.role === 'owner';
    const isSeniorAdmin = currentUser?.role === 'senior_admin';

    // Determine if the current user can edit the target user's role
    const canEditRole = (() => {
        if (isOwner) return true;
        if (isSeniorAdmin) {
            // Senior Admin cannot edit Owners or other Senior Admins
            if (user.role === 'owner' || user.role === 'senior_admin') return false;
            return true;
        }
        return false;
    })();

    // Determine available role options
    const availableRoles = (() => {
        if (isOwner) return ['user', 'admin', 'senior_admin', 'owner'];
        if (isSeniorAdmin) return ['user', 'admin'];
        return [];
    })();

    // Local state for all editable fields
    const [localRole, setLocalRole] = useState(user.role || 'user');
    const [localPricingSystem, setLocalPricingSystem] = useState(user.pricingSystem);
    const [localDiscount, setLocalDiscount] = useState(user.personalDiscountPercent || 0);

    const handleSave = async () => {
        const updates: Partial<User> = {};

        if (localRole !== user.role) updates.role = localRole;
        if (localPricingSystem !== user.pricingSystem) updates.pricingSystem = localPricingSystem;
        if (localDiscount !== user.personalDiscountPercent) updates.personalDiscountPercent = localDiscount;

        if (Object.keys(updates).length > 0) {
            await onUpdate(user.id, updates);
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-6 animate-in zoom-in-95">
                <div className="flex justify-between items-start">
                    <h2 className="text-xl font-bold">Настройки клиента</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-black">
                        <span className="text-2xl">×</span>
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="text-sm text-gray-500 pb-2 border-b border-gray-100">
                        {user.name} ({user.email})
                    </div>

                    {/* Role Management - Hierarchical Access */}
                    {canEditRole && (
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                            <label className="block text-sm font-medium text-gray-700">Роль в системе</label>
                            <select
                                className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                                value={localRole}
                                onChange={(e) => setLocalRole(e.target.value as any)}
                            >
                                {availableRoles.map(role => (
                                    <option key={role} value={role}>
                                        {role === 'user' ? 'Пользователь' :
                                            role === 'admin' ? 'Администратор' :
                                                role === 'senior_admin' ? 'Старший Админ' : 'Владелец'}
                                    </option>
                                ))}
                            </select>
                            {localRole !== user.role && (
                                <div className="text-xs text-amber-600 font-medium">
                                    Роль будет изменена после нажатия "Сохранить"
                                </div>
                            )}
                            <div className="text-xs text-gray-500">
                                {isSeniorAdmin
                                    ? "Вы можете назначать только Пользователей и Администраторов."
                                    : "Внимание: изменение роли влияет на доступ к функционалу."
                                }
                            </div>
                        </div>
                    )}

                    {/* Pricing System Toggle */}
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200">
                        <div>
                            <div className="font-medium text-sm text-gray-900">Персональное ценообразование</div>
                            <div className="text-xs text-gray-500">Отключает стандартные скидки</div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={localPricingSystem === 'personal'}
                                onChange={() => {
                                    setLocalPricingSystem(localPricingSystem === 'personal' ? 'standard' : 'personal');
                                }}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {/* Personal Discount Input */}
                    {localPricingSystem === 'personal' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Размер персональной скидки (%)
                            </label>
                            <input
                                type="number"
                                min="0"
                                max="100"
                                value={localDiscount}
                                onChange={(e) => {
                                    const val = parseInt(e.target.value);
                                    if (!isNaN(val)) setLocalDiscount(val);
                                }}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                            />
                        </div>
                    )}

                    <div className="pt-4 border-t border-gray-100 flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800"
                        >
                            Сохранить
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

