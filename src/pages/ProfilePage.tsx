import { useState } from 'react';
import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { Shield, User, Phone, Mail, Plus, Lock, Eye, EyeOff, Pencil, X, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { toast } from 'sonner';
import { api } from '../api/client';
import { hasPermission } from '../utils/permissions';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

export function ProfilePage() {
    const gridHouse = useDesignFlag();
    const { currentUser, updateUser } = useUserStore();

    if (!currentUser) return null;

    const isAdmin = currentUser.role && ['owner', 'senior_admin', 'admin'].includes(currentUser.role);

    if (gridHouse) return (
        <GridHouseProfilePage currentUser={currentUser} updateUser={updateUser} isAdmin={isAdmin} />
    );

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
                        <ChangeEmailInline currentEmail={currentUser.email} />
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

            {/* Change Password */}
            <ChangePasswordSection />

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

// ── Change Password Section ──────────────────────────────────────────────────

function ChangePasswordSection() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            toast.error('Пароль должен быть не менее 6 символов');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Пароли не совпадают');
            return;
        }
        setSaving(true);
        try {
            await api.post('/users/me/change-password', {
                current_password: currentPassword,
                new_password: newPassword,
            });
            toast.success('Пароль успешно изменён');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка смены пароля');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl border border-unbox-light">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
                <Lock className="text-unbox-green" size={20} />
                Смена пароля
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
                <div>
                    <label className="block text-sm font-medium mb-2">Текущий пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                        <input
                            type={showCurrent ? 'text' : 'password'}
                            className="w-full pl-10 pr-10 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                            placeholder="Введите текущий пароль"
                        />
                        <button type="button" onClick={() => setShowCurrent(!showCurrent)} className="absolute right-3 top-1/2 -translate-y-1/2 text-unbox-grey hover:text-unbox-dark">
                            {showCurrent ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-2">Новый пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                        <input
                            type={showNew ? 'text' : 'password'}
                            className="w-full pl-10 pr-10 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder="Минимум 6 символов"
                        />
                        <button type="button" onClick={() => setShowNew(!showNew)} className="absolute right-3 top-1/2 -translate-y-1/2 text-unbox-grey hover:text-unbox-dark">
                            {showNew ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium mb-2">Подтвердите пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                        <input
                            type="password"
                            className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            placeholder="Повторите новый пароль"
                        />
                    </div>
                    {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-xs text-red-500 mt-1">Пароли не совпадают</p>
                    )}
                </div>
                <div className="pt-2">
                    <Button type="submit" disabled={saving || !currentPassword || !newPassword || newPassword !== confirmPassword}>
                        {saving ? 'Сохранение...' : 'Изменить пароль'}
                    </Button>
                </div>
            </form>
        </div>
    );
}

// ── Change Email Inline ─────────────────────────────────────────────────────

function ChangeEmailInline({ currentEmail }: { currentEmail: string }) {
    const { fetchCurrentUser } = useUserStore();
    const [editing, setEditing] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);

    if (!editing) {
        return (
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                    <input
                        type="email"
                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light bg-gray-50 text-unbox-dark"
                        value={currentEmail}
                        readOnly
                    />
                </div>
                <button
                    onClick={() => { setNewEmail(currentEmail); setEditing(true); }}
                    className="shrink-0 p-3 rounded-xl border border-unbox-light hover:bg-unbox-light/50 transition-colors"
                    title="Изменить email"
                >
                    <Pencil size={16} className="text-unbox-grey" />
                </button>
            </div>
        );
    }

    const handleSave = async () => {
        if (!newEmail || newEmail === currentEmail) {
            toast.error('Введите новый email');
            return;
        }
        if (!password) {
            toast.error('Введите пароль для подтверждения');
            return;
        }
        setSaving(true);
        try {
            await api.post('/users/me/change-email', {
                new_email: newEmail,
                password,
            });
            toast.success('Email успешно изменён');
            await fetchCurrentUser();
            setEditing(false);
            setPassword('');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка смены email');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3 p-4 rounded-xl border-2 border-unbox-green/30 bg-unbox-light/20">
            <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-unbox-dark">Смена email</span>
                <button onClick={() => { setEditing(false); setPassword(''); }} className="p-1 hover:bg-gray-100 rounded-lg">
                    <X size={16} className="text-unbox-grey" />
                </button>
            </div>
            <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                <input
                    type="email"
                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Новый email"
                    autoFocus
                />
            </div>
            <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={18} />
                <input
                    type={showPw ? 'text' : 'password'}
                    className="w-full pl-10 pr-10 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Текущий пароль для подтверждения"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-unbox-grey hover:text-unbox-dark">
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
            </div>
            <div className="flex gap-2">
                <button
                    onClick={() => { setEditing(false); setPassword(''); }}
                    className="flex-1 py-2.5 rounded-xl border border-unbox-light text-sm font-medium hover:bg-gray-50 transition"
                >
                    Отмена
                </button>
                <button
                    onClick={handleSave}
                    disabled={saving || !newEmail || !password}
                    className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-bold hover:bg-unbox-dark disabled:opacity-50 transition flex items-center justify-center gap-2"
                >
                    {saving && <Loader2 size={14} className="animate-spin" />}
                    Сохранить
                </button>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — ProfilePage
   ═══════════════════════════════════════════════════════════════ */

const ghpMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghpHairline = `1px solid ${GH.ink10}`;
const ghpInput: React.CSSProperties = {
    width: '100%', padding: '12px 0', fontSize: 14, fontFamily: GH_SANS,
    border: 'none', borderBottom: ghpHairline, background: 'transparent',
    color: GH.ink, outline: 'none',
};

interface GridHouseProfilePageProps {
    currentUser: any;
    updateUser: (data: any) => void;
    isAdmin: boolean | "" | undefined;
}

function GridHouseProfilePage({ currentUser, updateUser, isAdmin }: GridHouseProfilePageProps) {
    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Header */}
            <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 8 }}>ПРОФИЛЬ</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div style={{
                        width: 56, height: 56, borderRadius: '50%', overflow: 'hidden',
                        background: GH.ink, color: GH.paper, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 22, fontWeight: 800,
                    }}>
                        {currentUser.avatarUrl ? (
                            <img src={currentUser.avatarUrl} alt={currentUser.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                            currentUser.name[0]?.toUpperCase()
                        )}
                    </div>
                    <div>
                        <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                            {currentUser.name}
                        </h1>
                        <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                            <span style={{ ...ghpMono, color: GH.ink30, fontSize: 10 }}>
                                {currentUser.email}
                            </span>
                            <span style={{ ...ghpMono, color: GH.ink30, fontSize: 10 }}>
                                БАЛАНС: {currentUser.balance?.toFixed(1)} ₾
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Subscription */}
            {currentUser.subscription ? (
                <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: ghpHairline }}>
                    <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 12 }}>АБОНЕМЕНТ</div>
                    <SubscriptionCard user={currentUser} />
                </div>
            ) : (
                <div style={{ marginBottom: 32, paddingBottom: 24, borderBottom: ghpHairline }}>
                    <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 12 }}>АБОНЕМЕНТ</div>
                    <div style={{ padding: 16, border: ghpHairline, color: GH.ink30, fontSize: 13, textAlign: 'center' }}>
                        Нет активного абонемента
                    </div>
                </div>
            )}

            {/* Edit fields */}
            <div style={{ maxWidth: 480, marginBottom: 32 }}>
                <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 20 }}>ЛИЧНЫЕ ДАННЫЕ</div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ ...ghpMono, color: GH.ink30, display: 'block', marginBottom: 6 }}>ИМЯ</label>
                    <input
                        type="text"
                        style={ghpInput}
                        value={currentUser.name}
                        onChange={(e) => updateUser({ name: e.target.value })}
                    />
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ ...ghpMono, color: GH.ink30, display: 'block', marginBottom: 6 }}>EMAIL</label>
                    <ChangeEmailInline currentEmail={currentUser.email} />
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ ...ghpMono, color: GH.ink30, display: 'block', marginBottom: 6 }}>ТЕЛЕФОН</label>
                    <input
                        type="tel"
                        style={ghpInput}
                        value={currentUser.phone}
                        onChange={(e) => updateUser({ phone: e.target.value })}
                    />
                </div>

                <button
                    style={{
                        padding: '10px 24px', background: GH.ink, color: GH.paper, fontWeight: 700,
                        fontSize: 13, fontFamily: GH_SANS, border: 'none', cursor: 'pointer', marginTop: 8,
                    }}
                >
                    Сохранить изменения
                </button>
            </div>

            {/* Password section */}
            <div style={{ borderTop: ghpHairline, paddingTop: 24, marginBottom: 32, maxWidth: 480 }}>
                <ChangePasswordSection />
            </div>

            {/* Admin access */}
            {(isAdmin || hasPermission(currentUser, 'admin.access')) && (
                <div style={{ borderTop: ghpHairline, paddingTop: 24, marginBottom: 32 }}>
                    <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 12 }}>АДМИНИСТРИРОВАНИЕ</div>
                    <p style={{ fontSize: 14, color: GH.ink60, marginBottom: 16 }}>
                        Вам доступна панель администратора для управления бронированиями и клиентами.
                    </p>
                    <Link
                        to="/admin"
                        style={{
                            display: 'inline-block', padding: '10px 24px', background: GH.ink, color: GH.paper,
                            fontWeight: 700, fontSize: 13, fontFamily: GH_SANS, textDecoration: 'none',
                        }}
                    >
                        Панель администратора →
                    </Link>
                </div>
            )}

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', marginTop: 48, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghpMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghpMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
