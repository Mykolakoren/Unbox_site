import { useEffect, useState, useMemo } from 'react';
import { Shield, Search, ChevronDown, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { PermissionsEditor } from '../../components/admin/PermissionsEditor';
import type { User } from '../../store/types';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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

        <GridHouseAccessRights
            users={users}
            filtered={filtered}
            search={search}
            setSearch={setSearch}
            dropdownOpen={dropdownOpen}
            setDropdownOpen={setDropdownOpen}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            handleSelect={handleSelect}
            currentUserRole={currentUserRole}
            fetchUsers={fetchUsers}
        />
    );
}


// ═════════════════════════════════════════════════════════════════════════
// GRID HOUSE VARIANT
// Rollback: delete everything below + the early-return block above.
// ═════════════════════════════════════════════════════════════════════════

const gharHairline = `1px solid ${GH.ink10}`;
const gharMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

interface GHAccessRightsProps {
    users: User[];
    filtered: User[];
    search: string;
    setSearch: (v: string) => void;
    dropdownOpen: boolean;
    setDropdownOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
    selectedUser: User | null;
    setSelectedUser: (u: User | null) => void;
    handleSelect: (u: User) => void;
    currentUserRole: string;
    fetchUsers: () => void;
}

function GridHouseAccessRights({
    filtered,
    search,
    setSearch,
    dropdownOpen,
    setDropdownOpen,
    selectedUser,
    setSelectedUser,
    handleSelect,
    currentUserRole,
    fetchUsers,
}: GHAccessRightsProps) {
    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 28, marginBottom: 32 }}>
                <div style={{ ...gharMono, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Shield size={12} /> Раздел · Права доступа
                </div>
                <h1
                    style={{
                        fontFamily: GH_SANS,
                        fontWeight: 800,
                        fontSize: 'clamp(28px, 3.5vw, 42px)',
                        lineHeight: 0.95,
                        letterSpacing: '-0.02em',
                        margin: 0,
                    }}
                >
                    Ролевой контроль.
                </h1>
                <div style={{ ...gharMono, marginTop: 10 }}>Разрешения · Владелец · Администраторы</div>
            </div>

            {/* ── User selector ── */}
            <div style={{ marginBottom: 32 }}>
                <div style={{ ...gharMono, marginBottom: 10 }}>→ Выберите пользователя</div>
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setDropdownOpen((v: boolean) => !v)}
                        style={{
                            width: '100%',
                            display: 'grid',
                            gridTemplateColumns: '1fr auto auto',
                            gap: 16,
                            alignItems: 'center',
                            padding: '18px 20px',
                            background: 'transparent',
                            border: `2px solid ${GH.ink}`,
                            cursor: 'pointer',
                            textAlign: 'left',
                        }}
                    >
                        {selectedUser ? (
                            <>
                                <div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink }}>
                                        {selectedUser.name}
                                    </div>
                                    <div style={{ ...gharMono, color: GH.ink60, marginTop: 3 }}>
                                        {selectedUser.email}
                                    </div>
                                </div>
                                <span
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        letterSpacing: '0.14em',
                                        textTransform: 'uppercase',
                                        padding: '5px 9px',
                                        color: GH.paper,
                                        background: GH.ink,
                                    }}
                                >
                                    {roleLabel(selectedUser.role)}
                                </span>
                            </>
                        ) : (
                            <>
                                <div style={{ ...gharMono, color: GH.ink60 }}>
                                    → Не выбран
                                </div>
                                <div />
                            </>
                        )}
                        <ChevronDown size={16} style={{ color: GH.ink60, transition: 'transform 150ms', transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }} />
                    </button>

                    {dropdownOpen && (
                        <>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setDropdownOpen(false)} />
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 4px)',
                                    left: 0,
                                    right: 0,
                                    zIndex: 20,
                                    background: GH.paper,
                                    border: `2px solid ${GH.ink}`,
                                    overflow: 'hidden',
                                }}
                            >
                                <div style={{ padding: 16, borderBottom: gharHairline, position: 'relative' }}>
                                    <Search style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', width: 14, height: 14, color: GH.ink60 }} />
                                    <input
                                        autoFocus
                                        type="text"
                                        placeholder="Имя или email..."
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                        style={{
                                            width: '100%',
                                            paddingLeft: 24,
                                            paddingRight: 0,
                                            border: 'none',
                                            outline: 'none',
                                            background: 'transparent',
                                            fontFamily: GH_SANS,
                                            fontSize: 14,
                                            color: GH.ink,
                                        }}
                                    />
                                </div>
                                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                                    {filtered.length === 0 && (
                                        <div style={{ padding: '24px 16px', textAlign: 'center', ...gharMono }}>
                                            Ничего не найдено
                                        </div>
                                    )}
                                    {filtered.map((user, i) => (
                                        <GHARUserRow
                                            key={user.id}
                                            user={user}
                                            index={i}
                                            isSelected={selectedUser?.id === user.id}
                                            isLast={i === filtered.length - 1}
                                            onSelect={handleSelect}
                                        />
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* ── Permissions panel ── */}
            {selectedUser ? (
                <div style={{ border: gharHairline, padding: 28, background: GH.paper }}>
                    <div style={{ ...gharMono, marginBottom: 20 }}>→ Разрешения · {selectedUser.name}</div>
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
                <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: gharHairline, padding: '80px 24px', textAlign: 'center' }}>
                    <div style={{ ...gharMono, marginBottom: 14 }}>→ Ожидание выбора</div>
                    <h2
                        style={{
                            fontFamily: GH_SANS,
                            fontWeight: 800,
                            fontSize: 'clamp(28px, 3.5vw, 42px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        Выберите пользователя.
                    </h2>
                    <div style={{ ...gharMono, marginTop: 12, color: GH.ink30 }}>
                        Управление разрешениями откроется после выбора
                    </div>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 48, paddingTop: 16 }}>
                <p style={{ ...gharMono, color: GH.ink30, margin: 0 }}>UNBOX ADMIN · 2026</p>
            </div>
        </div>
    );
}

function GHARUserRow({
    user,
    index,
    isSelected,
    isLast,
    onSelect,
}: {
    user: User;
    index: number;
    isSelected: boolean;
    isLast: boolean;
    onSelect: (u: User) => void;
}) {
    return (
        <button
            onClick={() => onSelect(user)}
            style={{
                width: '100%',
                display: 'grid',
                gridTemplateColumns: '48px 1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: '14px 16px',
                background: isSelected ? GH.ink5 : 'transparent',
                border: 'none',
                borderBottom: isLast ? 'none' : gharHairline,
                cursor: 'pointer',
                textAlign: 'left',
            }}
        >
            <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.1em' }}>
                {String(index + 1).padStart(3, '0')}
            </div>
            <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: GH.ink, letterSpacing: '-0.005em' }}>
                    {user.name}
                </div>
                <div style={{ ...gharMono, color: GH.ink60, marginTop: 2 }}>
                    {user.email}
                </div>
            </div>
            <span
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 9,
                    fontWeight: 600,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '4px 7px',
                    color: GH.ink,
                    border: `1px solid ${GH.ink}`,
                }}
            >
                {roleLabel(user.role)}
            </span>
        </button>
    );
}
