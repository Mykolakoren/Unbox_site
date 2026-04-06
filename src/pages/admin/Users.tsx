import React, { useState, useEffect } from 'react';
import { useUserStore, type User } from '../../store/userStore';
import { Search, Edit, Shield, User as UserIcon, Plus, X, Eye, EyeOff, Copy, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { TimelineList } from '../../components/Timeline/TimelineList';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

export function AdminUsers() {
    const gridHouse = useDesignFlag();
    const { users, updateUserById, fetchUsers } = useUserStore();
    const [search, setSearch] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [showAddUser, setShowAddUser] = useState(false);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const filteredUsers = users.filter(u =>
        (u.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.email || '').toLowerCase().includes(search.toLowerCase()) ||
        (u.phone || '').includes(search)
    );

    if (gridHouse) return (
        <GridHouseAdminUsers
            users={users}
            filteredUsers={filteredUsers}
            search={search}
            setSearch={setSearch}
            selectedUser={selectedUser}
            setSelectedUser={setSelectedUser}
            showAddUser={showAddUser}
            setShowAddUser={setShowAddUser}
            updateUserById={updateUserById}
            fetchUsers={fetchUsers}
        />
    );

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center gap-4">
                <h1 className="text-2xl font-bold">Клиенты</h1>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowAddUser(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-unbox-green text-white rounded-lg font-medium text-sm hover:bg-unbox-dark transition-colors shadow-sm cursor-pointer"
                    >
                        <Plus size={16} />
                        Новый клиент
                    </button>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                        <input
                            type="text"
                            placeholder="Поиск клиента..."
                            className="pl-10 pr-4 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green w-64"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>
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
                                    <button
                                        onClick={() => setSelectedUser(user)}
                                        title="Нажмите чтобы изменить роль"
                                        className={clsx(
                                            "px-2 py-1 rounded text-xs font-medium border transition-all hover:ring-2 hover:ring-offset-1",
                                            user.role === 'owner' ? "bg-purple-50 text-purple-700 border-purple-200 hover:ring-purple-300" :
                                                user.role === 'senior_admin' ? "bg-unbox-light text-unbox-dark border-blue-200 hover:ring-blue-300" :
                                                    user.role === 'admin' ? "bg-green-50 text-green-700 border-green-200 hover:ring-green-300" :
                                                        user.role === 'specialist' ? "bg-amber-50 text-amber-700 border-amber-200 hover:ring-amber-300" :
                                                            "bg-unbox-light/30 text-unbox-grey border-unbox-light hover:ring-gray-300"
                                        )}
                                    >
                                        {user.role === 'owner' ? 'Владелец' :
                                            user.role === 'senior_admin' ? 'Ст. Админ' :
                                                user.role === 'admin' ? 'Админ' :
                                                    user.role === 'specialist' ? 'Специалист' : 'Пользователь'}
                                    </button>
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

            {/* Add User Modal */}
            {showAddUser && (
                <AddUserModal
                    onClose={() => setShowAddUser(false)}
                    onCreated={() => { setShowAddUser(false); fetchUsers(); }}
                />
            )}
        </div>
    );
}

// ── Add User Modal ───────────────────────────────────────────────────────────

function generatePassword(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let result = '';
    for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
    return result;
}

function AddUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState(generatePassword());
    const [showPassword, setShowPassword] = useState(true);
    const [saving, setSaving] = useState(false);
    const [created, setCreated] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !email.trim()) {
            toast.error('Имя и email обязательны');
            return;
        }
        setSaving(true);
        try {
            await api.post('/auth/register', {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                phone: phone.trim() || undefined,
                password,
            });
            toast.success('Клиент создан');
            setCreated(true);
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            toast.error(typeof detail === 'string' ? detail : 'Ошибка создания');
        } finally {
            setSaving(false);
        }
    };

    const copyCredentials = () => {
        const text = `Логин: ${email}\nПароль: ${password}\n\nСайт: https://unbox.com.ge/login`;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            toast.success('Данные скопированы в буфер');
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5 animate-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold">{created ? 'Клиент создан' : 'Новый клиент'}</h3>
                    <button onClick={created ? onCreated : onClose} className="p-1 hover:bg-unbox-light rounded-lg">
                        <X size={20} className="text-unbox-grey" />
                    </button>
                </div>

                {!created ? (
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Имя *</label>
                            <input
                                type="text"
                                className="w-full px-4 py-2.5 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="Иван Иванов"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Email *</label>
                            <input
                                type="email"
                                className="w-full px-4 py-2.5 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="client@email.com"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Телефон</label>
                            <input
                                type="tel"
                                className="w-full px-4 py-2.5 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={phone}
                                onChange={e => setPhone(e.target.value)}
                                placeholder="+995..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Временный пароль</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="w-full px-4 py-2.5 pr-20 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green font-mono"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="p-1 text-unbox-grey hover:text-unbox-dark">
                                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                    <button type="button" onClick={() => setPassword(generatePassword())} className="p-1 text-unbox-grey hover:text-unbox-dark text-xs font-bold">
                                        ↻
                                    </button>
                                </div>
                            </div>
                        </div>
                        <button
                            type="submit"
                            disabled={saving}
                            className="w-full py-3 bg-unbox-green text-white font-bold rounded-xl hover:bg-unbox-dark transition-colors disabled:opacity-50 cursor-pointer"
                        >
                            {saving ? 'Создание...' : 'Создать клиента'}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-4">
                        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2">
                            <p className="text-sm text-green-800 font-medium">Передайте клиенту данные для входа:</p>
                            <div className="bg-white rounded-lg p-3 font-mono text-sm space-y-1">
                                <div><span className="text-unbox-grey">Логин:</span> {email}</div>
                                <div><span className="text-unbox-grey">Пароль:</span> {password}</div>
                                <div><span className="text-unbox-grey">Сайт:</span> unbox.com.ge/login</div>
                            </div>
                        </div>
                        <button
                            onClick={copyCredentials}
                            className="w-full py-3 bg-unbox-dark text-white font-bold rounded-xl hover:bg-unbox-green transition-colors flex items-center justify-center gap-2 cursor-pointer"
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
                            {copied ? 'Скопировано!' : 'Скопировать данные'}
                        </button>
                        <button
                            onClick={onCreated}
                            className="w-full py-2.5 border border-unbox-light text-unbox-dark font-medium rounded-xl hover:bg-unbox-light/50 transition-colors cursor-pointer"
                        >
                            Готово
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Edit User Modal ──────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID HOUSE — AdminUsers
// ═══════════════════════════════════════════════════════════════════════════════

const ghMono: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const,
};
const ghHairline = `1px solid ${GH.ink10}`;

interface GHAdminUsersProps {
    users: User[];
    filteredUsers: User[];
    search: string;
    setSearch: (v: string) => void;
    selectedUser: User | null;
    setSelectedUser: (u: User | null) => void;
    showAddUser: boolean;
    setShowAddUser: (v: boolean) => void;
    updateUserById: (id: string, data: Partial<User>) => Promise<void>;
    fetchUsers: () => Promise<void>;
}

function GridHouseAdminUsers(props: GHAdminUsersProps) {
    const {
        users, filteredUsers, search, setSearch,
        selectedUser, setSelectedUser,
        showAddUser, setShowAddUser,
        updateUserById, fetchUsers,
    } = props;

    const totalFmt = String(filteredUsers.length).padStart(3, '0');
    const allFmt = String(users.length).padStart(3, '0');

    const roleLabel = (role: string | undefined) =>
        role === 'owner' ? 'Владелец'
        : role === 'senior_admin' ? 'Ст. Админ'
        : role === 'admin' ? 'Админ'
        : role === 'specialist' ? 'Специалист'
        : 'Клиент';

    const monoLabel: React.CSSProperties = {
        ...ghMono,
        fontWeight: 500,
        color: GH.ink60,
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 28, marginBottom: 28 }}>
                <div style={{ ...monoLabel, color: GH.ink30, marginBottom: 14 }}>ADMIN · USERS</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                    <h1 style={{
                        fontFamily: GH_SANS,
                        fontWeight: 800,
                        fontSize: 'clamp(28px, 3.5vw, 42px)',
                        lineHeight: 1.1,
                        letterSpacing: '-0.02em',
                        margin: 0,
                    }}>
                        Реестр клиентов
                    </h1>
                    <button
                        onClick={() => setShowAddUser(true)}
                        style={{
                            background: GH.ink,
                            color: GH.paper,
                            fontFamily: GH_MONO,
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            padding: '14px 22px',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 10,
                        }}
                    >
                        <Plus size={14} /> Новый клиент
                    </button>
                </div>
            </div>

            {/* ── KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32, marginBottom: 32, alignItems: 'end' }}>
                <div>
                    <p style={{ ...ghMono, color: GH.ink30, marginBottom: 4, margin: 0 }}>ВСЕГО</p>
                    <span style={{ fontFamily: GH_MONO, fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {allFmt}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 28, paddingBottom: 6, flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ ...ghMono, color: GH.ink30, marginBottom: 2, margin: 0 }}>ПОКАЗАНО</p>
                        <span style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 600, color: GH.accent, fontVariantNumeric: 'tabular-nums' }}>
                            {totalFmt}
                        </span>
                    </div>
                </div>
            </div>

            {/* ── Search ── */}
            <div style={{ marginBottom: 28 }}>
                <div style={{ ...monoLabel, marginBottom: 8 }}>ПОИСК</div>
                <div style={{ position: 'relative', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8 }}>
                    <Search style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-80%)', width: 16, height: 16, color: GH.ink60 }} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Имя, email, телефон"
                        style={{
                            width: '100%',
                            paddingLeft: 28,
                            paddingRight: 28,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            fontFamily: GH_SANS,
                            fontSize: 16,
                            color: GH.ink,
                        }}
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-80%)', background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, padding: 4 }}
                            aria-label="Очистить поиск"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* ── Table ── */}
            {filteredUsers.length === 0 ? (
                <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghHairline, padding: '80px 24px', textAlign: 'center' }}>
                    <div style={{ ...monoLabel, marginBottom: 14 }}>ПУСТО</div>
                    <h2 style={{
                        fontFamily: GH_SANS,
                        fontWeight: 800,
                        fontSize: 'clamp(28px, 3.5vw, 44px)',
                        lineHeight: 0.95,
                        letterSpacing: '-0.02em',
                        margin: 0,
                    }}>
                        Никто не найден.
                    </h2>
                </div>
            ) : (
                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {/* Column headers */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '48px 1fr 140px 120px 80px 140px 60px',
                        gap: 16,
                        padding: '12px 0',
                        borderBottom: ghHairline,
                        ...monoLabel,
                    }}>
                        <div>#</div>
                        <div>КЛИЕНТ</div>
                        <div>РОЛЬ</div>
                        <div style={{ textAlign: 'right' }}>БАЛАНС</div>
                        <div style={{ textAlign: 'center' }}>СКИДКА</div>
                        <div>ТИП ЦЕН</div>
                        <div style={{ textAlign: 'right' }}></div>
                    </div>

                    {filteredUsers.map((user, idx) => (
                        <div
                            key={user.email}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '48px 1fr 140px 120px 80px 140px 60px',
                                gap: 16,
                                padding: '18px 0',
                                borderBottom: ghHairline,
                                alignItems: 'center',
                            }}
                        >
                            <div style={{
                                fontFamily: GH_MONO,
                                fontSize: 11,
                                letterSpacing: '0.1em',
                                color: GH.ink60,
                                fontVariantNumeric: 'tabular-nums',
                            }}>
                                {String(idx + 1).padStart(3, '0')}
                            </div>
                            <Link
                                to={`/admin/users/${encodeURIComponent(user.email)}`}
                                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                            >
                                <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                    {user.name}
                                    {user.isAdmin && <Shield size={13} color={GH.ink60} />}
                                </div>
                                <div style={{ ...monoLabel, color: GH.ink60, marginTop: 3 }}>
                                    {user.email}{user.phone ? ` · ${user.phone}` : ''}
                                </div>
                            </Link>
                            <button
                                onClick={() => setSelectedUser(user)}
                                title="Изменить роль"
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    padding: '5px 9px',
                                    background: user.role === 'owner' ? GH.ink : 'transparent',
                                    color: user.role === 'owner' ? GH.paper : GH.ink,
                                    border: `1px solid ${GH.ink}`,
                                    cursor: 'pointer',
                                    justifySelf: 'start',
                                }}
                            >
                                {roleLabel(user.role)}
                            </button>
                            <div style={{
                                fontFamily: GH_MONO,
                                fontSize: 14,
                                fontWeight: 600,
                                textAlign: 'right',
                                color: user.balance < 0 ? GH.danger : GH.ink,
                                fontVariantNumeric: 'tabular-nums',
                            }}>
                                {user.balance.toFixed(0)} GEL
                            </div>
                            <div style={{ textAlign: 'center' }}>
                                {user.personalDiscountPercent ? (
                                    <span style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 11,
                                        fontWeight: 700,
                                        padding: '3px 7px',
                                        color: GH.paper,
                                        background: GH.ink,
                                        letterSpacing: '0.05em',
                                    }}>
                                        {user.personalDiscountPercent}%
                                    </span>
                                ) : (
                                    <span style={{ ...monoLabel, color: GH.ink30 }}></span>
                                )}
                            </div>
                            <div style={{ ...monoLabel, color: GH.ink }}>
                                {user.pricingSystem === 'personal' ? 'ПЕРСОНАЛЬНЫЙ' : 'СТАНДАРТ'}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                                <Link
                                    to={`/admin/users/${encodeURIComponent(user.email)}`}
                                    title="Карточка"
                                    style={{
                                        width: 32,
                                        height: 32,
                                        background: 'transparent',
                                        border: ghHairline,
                                        cursor: 'pointer',
                                        color: GH.ink60,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <UserIcon size={13} />
                                </Link>
                                <button
                                    onClick={() => setSelectedUser(user)}
                                    title="Быстрые настройки"
                                    style={{
                                        width: 32,
                                        height: 32,
                                        background: 'transparent',
                                        border: ghHairline,
                                        cursor: 'pointer',
                                        color: GH.ink60,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Edit size={13} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 40, paddingTop: 16 }}>
                <p style={{ ...ghMono, color: GH.ink30, margin: 0 }}>UNBOX ADMIN · 2026</p>
            </div>

            {/* Modals (reuse legacy internals) */}
            {selectedUser && (
                <UserEditModal
                    user={selectedUser}
                    onClose={() => setSelectedUser(null)}
                    onUpdate={updateUserById}
                />
            )}
            {showAddUser && (
                <AddUserModal
                    onClose={() => setShowAddUser(false)}
                    onCreated={() => { setShowAddUser(false); fetchUsers(); }}
                />
            )}
        </div>
    );
}

// ── Edit User Modal ──────────────────────────────────────────────────────────

function UserEditModal({ user, onClose, onUpdate }: { user: User; onClose: () => void; onUpdate: (id: string, data: Partial<User>) => Promise<void> }) {
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
        if (isOwner) return ['user', 'specialist', 'admin', 'senior_admin', 'owner'];
        if (isSeniorAdmin) return ['user', 'specialist', 'admin'];
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
                    <button onClick={onClose} className="text-unbox-grey hover:text-black">
                        <span className="text-2xl">×</span>
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="text-sm text-unbox-grey pb-2 border-b border-unbox-light">
                        {user.name} ({user.email})
                    </div>

                    {/* Role Management - Hierarchical Access */}
                    {canEditRole && (
                        <div className="p-3 bg-unbox-light/30 rounded-lg border border-unbox-light space-y-2">
                            <label className="block text-sm font-medium text-unbox-dark">Роль в системе</label>
                            <select
                                className="w-full p-2 border border-unbox-light rounded-lg focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={localRole}
                                onChange={(e) => setLocalRole(e.target.value as "user" | "specialist" | "admin" | "senior_admin" | "owner")}
                            >
                                {availableRoles.map(role => (
                                    <option key={role} value={role}>
                                        {role === 'user' ? 'Пользователь' :
                                            role === 'specialist' ? 'Специалист' :
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
                            <div className="text-xs text-unbox-grey">
                                {isSeniorAdmin
                                    ? "Вы можете назначать только Пользователей и Администраторов."
                                    : "Внимание: изменение роли влияет на доступ к функционалу."
                                }
                            </div>
                        </div>
                    )}

                    {/* Pricing System Toggle */}
                    <div className="flex items-center justify-between p-3 bg-unbox-light/30 rounded-lg border border-unbox-light">
                        <div>
                            <div className="font-medium text-sm text-unbox-dark">Персональное ценообразование</div>
                            <div className="text-xs text-unbox-grey">Отключает стандартные скидки</div>
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
                            <div className="w-11 h-6 bg-unbox-light peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-unbox-light after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {/* Personal Discount Input */}
                    {localPricingSystem === 'personal' && (
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">
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
                                className="w-full p-2 border border-unbox-light rounded-lg focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                        </div>
                    )}

                    <div className="pt-4 border-t border-unbox-light flex justify-end gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-unbox-grey hover:bg-unbox-light/50 rounded-lg"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-4 py-2 bg-unbox-green text-white rounded-lg hover:bg-unbox-dark"
                        >
                            Сохранить
                        </button>
                    </div>

                    {/* Timeline Section */}
                    <div className="pt-4 border-t border-unbox-light">
                        <h3 className="text-sm font-bold text-unbox-dark mb-3">История изменений</h3>
                        <TimelineList targetId={user.id} limit={5} className="max-h-48 overflow-y-auto" />
                    </div>
                </div>
            </div>
        </div>
    );
}

