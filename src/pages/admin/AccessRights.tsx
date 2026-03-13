import { useEffect, useState } from 'react';
import { Shield, Search, Zap, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { PERMISSION_GROUPS } from '../../components/admin/PermissionsEditor';

// Flat list of all permissions
const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap(g => g.permissions);
const SPECIALIST_PRESET = ['crm.access', 'crm.clients', 'crm.sessions', 'crm.finances'];

interface RowState {
    permissions: Set<string>;
    dirty: boolean;
    saving: boolean;
    expanded: boolean;
}

function roleLabel(role?: string) {
    switch (role) {
        case 'owner': return 'Владелец';
        case 'senior_admin': return 'Ст. Админ';
        case 'admin': return 'Admin';
        case 'specialist': return 'Специалист';
        default: return 'Клиент';
    }
}

function roleBadgeClass(role?: string) {
    switch (role) {
        case 'owner': return 'bg-purple-100 text-purple-700';
        case 'senior_admin': return 'bg-blue-100 text-blue-700';
        case 'admin': return 'bg-green-100 text-green-700';
        case 'specialist': return 'bg-amber-100 text-amber-700';
        default: return 'bg-gray-100 text-gray-600';
    }
}

export function AdminAccessRights() {
    const users = useUserStore(s => s.users);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const currentUser = useUserStore(s => s.currentUser);
    const [search, setSearch] = useState('');
    const [rows, setRows] = useState<Record<string, RowState>>({});

    const isOwner = currentUser?.role === 'owner';
    const isSeniorAdmin = currentUser?.role === 'senior_admin';

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    // Initialize row state from user data
    useEffect(() => {
        setRows(prev => {
            const next = { ...prev };
            for (const u of users) {
                if (!next[u.id]) {
                    next[u.id] = {
                        permissions: new Set(u.permissions ?? []),
                        dirty: false,
                        saving: false,
                        expanded: false,
                    };
                }
            }
            return next;
        });
    }, [users]);

    const canToggle = (permId: string, seniorAdminOk: boolean) => {
        if (isOwner) return true;
        if (isSeniorAdmin && seniorAdminOk) return true;
        return false;
    };

    const toggle = (userId: string, permId: string, seniorAdminOk: boolean) => {
        if (!canToggle(permId, seniorAdminOk)) return;
        setRows(prev => {
            const row = prev[userId];
            if (!row) return prev;
            const perms = new Set(row.permissions);
            if (perms.has(permId)) perms.delete(permId);
            else perms.add(permId);
            return { ...prev, [userId]: { ...row, permissions: perms, dirty: true } };
        });
    };

    const applyPreset = (userId: string) => {
        setRows(prev => {
            const row = prev[userId];
            if (!row) return prev;
            const perms = new Set(row.permissions);
            for (const p of SPECIALIST_PRESET) perms.add(p);
            return { ...prev, [userId]: { ...row, permissions: perms, dirty: true } };
        });
    };

    const save = async (userId: string) => {
        const row = rows[userId];
        if (!row) return;
        setRows(prev => ({ ...prev, [userId]: { ...prev[userId], saving: true } }));
        try {
            await api.patch(`/users/${userId}/permissions`, {
                permissions: Array.from(row.permissions),
            });
            await fetchUsers();
            setRows(prev => ({ ...prev, [userId]: { ...prev[userId], dirty: false, saving: false } }));
            toast.success('Права сохранены');
        } catch {
            toast.error('Ошибка сохранения');
            setRows(prev => ({ ...prev, [userId]: { ...prev[userId], saving: false } }));
        }
    };

    const toggleExpand = (userId: string) => {
        setRows(prev => {
            const row = prev[userId];
            if (!row) return prev;
            return { ...prev, [userId]: { ...row, expanded: !row.expanded } };
        });
    };

    const filtered = users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
    );

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

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" />
                <input
                    type="text"
                    placeholder="Поиск по имени или email..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl border border-unbox-light bg-white/80 focus:outline-none focus:ring-2 focus:ring-unbox-green/30 focus:border-unbox-green"
                />
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3 text-xs text-unbox-grey">
                <span className="flex items-center gap-1">
                    <Zap size={12} className="text-unbox-green" />
                    Пресет специалиста — автоматически выдаёт все crm.* права
                </span>
                {!isOwner && isSeniorAdmin && (
                    <span className="opacity-60">Серые разрешения — только для владельца</span>
                )}
            </div>

            {/* Users table */}
            <div className="space-y-2">
                {filtered.map(user => {
                    const row = rows[user.id];
                    if (!row) return null;

                    // Count active permissions
                    const activeCnt = ALL_PERMISSIONS.filter(p => row.permissions.has(p.id)).length;

                    return (
                        <div key={user.id} className="bg-white/80 rounded-2xl border border-white/80 shadow-sm overflow-hidden">
                            {/* Row header */}
                            <div className="flex items-center gap-3 px-5 py-3.5">
                                <div className="w-9 h-9 rounded-xl bg-unbox-dark text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                                    {user.name[0].toUpperCase()}
                                </div>

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-unbox-dark truncate">{user.name}</span>
                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${roleBadgeClass(user.role)}`}>
                                            {roleLabel(user.role)}
                                        </span>
                                    </div>
                                    <div className="text-xs text-unbox-grey truncate">{user.email}</div>
                                </div>

                                {/* Permission count badge */}
                                <div className="hidden sm:flex items-center gap-1 text-xs text-unbox-grey">
                                    <span className={`font-semibold ${activeCnt > 0 ? 'text-unbox-green' : ''}`}>{activeCnt}</span>
                                    <span>/ {ALL_PERMISSIONS.length} прав</span>
                                </div>

                                {/* Quick crm status */}
                                <div className="hidden md:flex items-center gap-1">
                                    {SPECIALIST_PRESET.map(p => (
                                        <div
                                            key={p}
                                            title={p}
                                            className={`w-2 h-2 rounded-full ${row.permissions.has(p) ? 'bg-unbox-green' : 'bg-gray-200'}`}
                                        />
                                    ))}
                                </div>

                                {/* Save button */}
                                {row.dirty && (
                                    <button
                                        onClick={() => save(user.id)}
                                        disabled={row.saving}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-unbox-green text-white text-xs font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60 flex-shrink-0"
                                    >
                                        {row.saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                        Сохранить
                                    </button>
                                )}

                                {/* Expand */}
                                <button
                                    onClick={() => toggleExpand(user.id)}
                                    className="p-1.5 text-unbox-grey hover:text-unbox-dark rounded-lg hover:bg-unbox-light/50 transition-colors flex-shrink-0"
                                >
                                    {row.expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                            </div>

                            {/* Expanded permissions */}
                            {row.expanded && (
                                <div className="px-5 pb-4 border-t border-unbox-light/50 pt-3 space-y-3">
                                    {/* Preset button */}
                                    {(isOwner || isSeniorAdmin) && (
                                        <button
                                            type="button"
                                            onClick={() => applyPreset(user.id)}
                                            className="flex items-center gap-1.5 text-xs text-unbox-green hover:text-unbox-green/80 transition-colors font-medium"
                                        >
                                            <Zap size={12} />
                                            Применить пресет специалиста
                                        </button>
                                    )}

                                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                        {PERMISSION_GROUPS.map(group => (
                                            <div key={group.group}>
                                                <div className="text-[10px] font-semibold uppercase tracking-wide text-unbox-grey mb-1.5">
                                                    {group.group}
                                                </div>
                                                <div className="bg-white rounded-xl border border-unbox-light overflow-hidden">
                                                    {group.permissions.map((perm, idx) => {
                                                        const active = row.permissions.has(perm.id);
                                                        const editable = canToggle(perm.id, perm.seniorAdmin);
                                                        return (
                                                            <button
                                                                key={perm.id}
                                                                type="button"
                                                                onClick={() => toggle(user.id, perm.id, perm.seniorAdmin)}
                                                                disabled={!editable}
                                                                className={[
                                                                    'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors text-xs',
                                                                    idx > 0 && 'border-t border-unbox-light',
                                                                    editable && active && 'bg-unbox-green/5',
                                                                    editable && !active && 'hover:bg-unbox-light/50',
                                                                    !editable && 'opacity-35 cursor-not-allowed',
                                                                ].filter(Boolean).join(' ')}
                                                            >
                                                                <div className={[
                                                                    'w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-all',
                                                                    active ? 'bg-unbox-green border-unbox-green' : 'border-unbox-light bg-white',
                                                                ].join(' ')}>
                                                                    {active && <Check size={8} strokeWidth={3} className="text-white" />}
                                                                </div>
                                                                <span className={active ? 'text-unbox-dark font-medium' : 'text-unbox-grey'}>
                                                                    {perm.label}
                                                                </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
