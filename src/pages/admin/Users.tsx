import { useState } from 'react';
import { useUserStore, type User } from '../../store/userStore';
import { Search, Edit, Shield, User as UserIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';

export function AdminUsers() {
    const { users, updateUserById } = useUserStore();
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

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
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-6 animate-in zoom-in-95">
                        <div className="flex justify-between items-start">
                            <h2 className="text-xl font-bold">Настройки клиента</h2>
                            <button onClick={() => setSelectedUser(null)} className="text-gray-400 hover:text-black">
                                <span className="text-2xl">×</span>
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="text-sm text-gray-500 pb-2 border-b border-gray-100">
                                {selectedUser.name} ({selectedUser.email})
                            </div>

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
                                        checked={selectedUser.pricingSystem === 'personal'}
                                        onChange={() => {
                                            if (selectedUser) {
                                                const newSystem = selectedUser.pricingSystem === 'personal' ? 'standard' : 'personal';
                                                updateUserById(selectedUser.email, { pricingSystem: newSystem });
                                                // Update local state to reflect change immediately in modal
                                                setSelectedUser({ ...selectedUser, pricingSystem: newSystem });
                                            }
                                        }}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            {/* Personal Discount Input */}
                            {selectedUser.pricingSystem === 'personal' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">
                                        Размер персональной скидки (%)
                                    </label>
                                    <input
                                        type="number"
                                        min="0"
                                        max="100"
                                        value={selectedUser.personalDiscountPercent || ''}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (!isNaN(val)) {
                                                updateUserById(selectedUser.email, { personalDiscountPercent: val });
                                                setSelectedUser({ ...selectedUser, personalDiscountPercent: val });
                                            }
                                        }}
                                        className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-black"
                                    />
                                </div>
                            )}

                            {/* Status (Level) Selection - Optional / Legacy support if needed */}
                            {/* We removed 'status' UI per user request, but can re-add here if needed. Focusing on pricing. */}

                            <div className="pt-4 border-t border-gray-100 flex justify-end">
                                <button
                                    onClick={() => setSelectedUser(null)}
                                    className="px-4 py-2 bg-black text-white rounded-lg hover:bg-gray-800"
                                >
                                    Готово
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
