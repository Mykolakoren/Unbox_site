import { useEffect, useState, useMemo } from 'react';
import { Shield, Search, ChevronDown, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { PermissionsEditor } from '../../components/admin/PermissionsEditor';
import type { User } from '../../store/types';
import clsx from 'clsx';

function roleLabel(role?: string) {
    switch (role) {
        case 'owner':        return 'Владелец';
        case 'senior_admin': return 'Ст. Админ';
        case 'admin':        return 'Администратор';
        case 'specialist':   return 'Специалист';
        default:             return 'Пользователь';
    }
}

function roleBadgeClass(role?: string) {
    switch (role) {
        case 'owner':        return 'bg-purple-100 text-purple-700';
        case 'senior_admin': return 'bg-blue-100 text-blue-700';
        case 'admin':        return 'bg-green-100 text-green-700';
        case 'specialist':   return 'bg-amber-100 text-amber-700';
        default:             return 'bg-gray-100 text-gray-600';
    }
}

export function AdminAccessRights() {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const currentUser = useUserStore(s => s.currentUser);

    const [search, setSearch] = useState('');
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);

    useEffect(() => { fetchUsers(); }, [fetchUsers]);

    const filtered = useMemo(() =>
        users.filter(u =>
            u.name.toLowerCase().includes(search.toLowerCase()) ||
            u.email.toLowerCase().includes(search.toLowerCase())
        ),
        [users, search]
    );

    // Sync selectedUser when users list refreshes (after save)
    useEffect(() => {
        if (selectedUser) {
            const updated = users.find(u => u.id === selectedUser.id);
            if (updated) setSelectedUser(updated);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [users]);

    const handleSelect = (user: User) => {
        setSelectedUser(user);
        setDropdownOpen(false);
        setSearch('');
    };

    const currentUserRole = currentUser?.role ?? '';

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-unbox-green/10 flex items-center justify-center">
                    <Shield size={20} className="text-unbox-green" />
                </div>
                <div>
                    <h1 className="text-xl font-semibold text-unbox-dark">Права доступа</h1>
                    <p className="text-sm text-unbox-grey">Управление разрешениями пользователей</p>
                </div>
            </div>

            {/* User selector */}
            <div className="bg-white/80 rounded-2xl border border-white/80 shadow-sm p-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-unbox-grey">Выберите пользователя</p>

                <div className="relative">
                    <button
                        onClick={() => setDropdownOpen(v => !v)}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-unbox-light bg-white hover:border-unbox-green/50 transition-colors text-left"
                    >
                        {selectedUser ? (
                            <>
                                <div className="w-8 h-8 rounded-lg bg-unbox-dark text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {selectedUser.name[0].toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm font-semibold text-unbox-dark truncate">{selectedUser.name}</div>
                                    <div className="text-xs text-unbox-grey truncate">{selectedUser.email}</div>
                                </div>
                                <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0', roleBadgeClass(selectedUser.role))}>
                                    {roleLabel(selectedUser.role)}
                                </span>
                            </>
                        ) : (
                            <>
                                <UserIcon size={18} className="text-unbox-grey" />
                                <span className="text-sm text-unbox-grey flex-1">Не выбран...</span>
                            </>
                        )}
                        <ChevronDown size={16} className={clsx('text-unbox-grey transition-transform flex-shrink-0', dropdownOpen && 'rotate-180')} />
                    </button>

                    {dropdownOpen && (
                        <>
                            <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                            <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl border border-unbox-light shadow-xl z-20 overflow-hidden">
                                <div className="p-2 border-b border-unbox-light">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Поиск по имени или email..."
                                            value={search}
                                            onChange={e => setSearch(e.target.value)}
                                            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green/30"
                                        />
                                    </div>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {filtered.length === 0 && (
                                        <div className="px-4 py-3 text-sm text-unbox-grey text-center">Ничего не найдено</div>
                                    )}
                                    {filtered.map(user => (
                                        <button
                                            key={user.id}
                                            onClick={() => handleSelect(user)}
                                            className={clsx(
                                                'w-full flex items-center gap-3 px-4 py-2.5 hover:bg-unbox-light/50 transition-colors text-left',
                                                selectedUser?.id === user.id && 'bg-unbox-green/5'
                                            )}
                                        >
                                            <div className="w-7 h-7 rounded-lg bg-unbox-dark text-white flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                {user.name[0].toUpperCase()}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium text-unbox-dark truncate">{user.name}</div>
                                                <div className="text-xs text-unbox-grey truncate">{user.email}</div>
                                            </div>
                                            <span className={clsx('text-[10px] font-semibold px-1.5 py-0.5 rounded-md flex-shrink-0', roleBadgeClass(user.role))}>
                                                {roleLabel(user.role)}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Permissions panel */}
            {selectedUser ? (
                <div className="bg-white/80 rounded-2xl border border-white/80 shadow-sm p-5">
                    <PermissionsEditor
                        user={selectedUser}
                        currentUserRole={currentUserRole}
                        onUpdate={(updated) => {
                            setSelectedUser(updated as User);
                            fetchUsers();
                        }}
                    />
                </div>
            ) : (
                <div className="bg-white/40 rounded-2xl border border-white/60 p-10 text-center text-unbox-grey">
                    <Shield size={32} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Выберите пользователя чтобы управлять правами доступа</p>
                </div>
            )}
        </div>
    );
}
