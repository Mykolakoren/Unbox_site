import { useState, useCallback, useEffect, useRef } from 'react';
import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { PhoneInput } from '../components/ui/PhoneInput';
import { Shield, User, Phone, Mail, Plus, Lock, Eye, EyeOff, Pencil, X, Loader2, Send, CheckCircle2 } from 'lucide-react';
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
                            <PhoneInput
                                className="w-full pl-10 pr-4 py-3 rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                value={currentUser.phone || ''}
                                onChange={(v) => updateUser({ phone: v })}
                            />
                        </div>
                    </div>

                    <TelegramIdField
                        value={currentUser.telegramId || ''}
                        onChange={(v) => updateUser({ telegramId: v })}
                    />

                    <div className="pt-4">
                        <Button>Сохранить изменения</Button>
                    </div>
                </div>
            </div>

            {/* Change Password */}
            <ChangePasswordSection />

            {/* Design Switcher */}
            <LegacyDesignSwitcher />

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

// ── Telegram Connect Hook ───────────────────────────────────────────────────
// Generates a one-time link, opens it, and polls /users/me until the backend
// reports telegram_id is set (meaning the bot received /start <token>).

function useTelegramConnect() {
    const { fetchCurrentUser } = useUserStore();
    const [isConnecting, setIsConnecting] = useState(false);
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const deadline = useRef<number>(0);

    const stopPolling = useCallback(() => {
        if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
        setIsConnecting(false);
    }, []);

    useEffect(() => () => stopPolling(), [stopPolling]);

    const connect = useCallback(async () => {
        try {
            setIsConnecting(true);
            const { data } = await api.post<{ url: string; expires_at: string }>('/telegram/link-token');
            // Open bot deep-link (Telegram app if installed, else web)
            window.open(data.url, '_blank', 'noopener,noreferrer');
            toast.info('Откройте Telegram и нажмите «Start». Ждём подтверждения…', { duration: 5000 });

            // Poll every 2s for up to 3 minutes
            deadline.current = Date.now() + 3 * 60 * 1000;
            pollTimer.current = setInterval(async () => {
                if (Date.now() > deadline.current) {
                    stopPolling();
                    toast.error('Не дождались подключения. Попробуйте ещё раз.');
                    return;
                }
                await fetchCurrentUser();
                const cu = useUserStore.getState().currentUser;
                if (cu?.telegramId && /^\d+$/.test(cu.telegramId)) {
                    stopPolling();
                    toast.success('✅ Telegram подключён!');
                }
            }, 2000);
        } catch (e) {
            stopPolling();
            toast.error('Не удалось создать ссылку. Попробуйте позже.');
            console.error(e);
        }
    }, [fetchCurrentUser, stopPolling]);

    return { connect, isConnecting, cancel: stopPolling };
}


// ── Telegram ID Field ───────────────────────────────────────────────────────

function TelegramIdField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { connect, isConnecting, cancel } = useTelegramConnect();
    // A numeric telegramId means the user has been auto-bound via /start — bot
    // can now send messages. A @username means manual, no notifications yet.
    const isBound = !!value && /^\d+$/.test(value);
    return (
        <div>
            <label className="block text-sm font-medium mb-2">Telegram</label>

            {isBound ? (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-unbox-light bg-green-50">
                    <CheckCircle2 className="text-green-600" size={18} />
                    <span className="text-sm text-unbox-dark">Подключено — уведомления активны</span>
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        className="ml-auto text-xs text-unbox-grey hover:text-unbox-dark underline"
                    >
                        Отключить
                    </button>
                </div>
            ) : (
                <>
                    <button
                        type="button"
                        onClick={isConnecting ? cancel : connect}
                        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-medium transition ${
                            isConnecting
                                ? 'bg-unbox-light text-unbox-grey'
                                : 'bg-[#26A5E4] text-white hover:bg-[#1e90cf]'
                        }`}
                    >
                        {isConnecting ? (
                            <><Loader2 className="animate-spin" size={18} /> Ждём подтверждения… (отмена)</>
                        ) : (
                            <><Send size={18} /> Подключить Telegram</>
                        )}
                    </button>

                    <div className="mt-3">
                        <label className="block text-xs text-unbox-grey mb-1">Или укажите @username вручную:</label>
                        <div className="relative">
                            <Send className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                            <input
                                type="text"
                                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                placeholder="@username"
                                value={value}
                                onChange={(e) => onChange(e.target.value)}
                            />
                        </div>
                        <p className="text-[11px] text-unbox-grey mt-1.5">
                            При ручном вводе уведомления придут, только если вы уже писали боту{' '}
                            <a href="https://t.me/Unbox_Booking_G_Bot" target="_blank" rel="noopener noreferrer" className="text-unbox-green underline">
                                @Unbox_Booking_G_Bot
                            </a>.
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}

// ── Legacy Design Switcher ──────────────────────────────────────────────────

function LegacyDesignSwitcher() {
    const isGH = useDesignFlag();
    const switchTo = useCallback((mode: 'grid' | 'off') => {
        if (mode === 'off') {
            localStorage.setItem('unbox_design_flag', 'off');
        } else {
            localStorage.removeItem('unbox_design_flag');
        }
        window.location.reload();
    }, []);

    return (
        <div className="bg-white p-6 rounded-2xl border border-unbox-light">
            <h3 className="font-bold text-lg mb-4">Оформление</h3>
            <div className="grid grid-cols-2 gap-3 max-w-md">
                <button
                    onClick={() => !isGH && switchTo('grid')}
                    className={`p-4 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        isGH ? 'border-unbox-green bg-unbox-green/5' : 'border-unbox-light hover:border-unbox-green/30'
                    }`}
                >
                    <div className="font-bold text-sm mb-1">Grid House</div>
                    <div className="text-xs text-unbox-grey">Минимализм</div>
                    {isGH && <div className="text-xs text-unbox-green font-semibold mt-2">✓ Активен</div>}
                </button>
                <button
                    onClick={() => isGH && switchTo('off')}
                    className={`p-4 rounded-xl border-2 text-center transition-all cursor-pointer ${
                        !isGH ? 'border-unbox-green bg-unbox-green/5' : 'border-unbox-light hover:border-unbox-green/30'
                    }`}
                >
                    <div className="font-bold text-sm mb-1">Classic</div>
                    <div className="text-xs text-unbox-grey">Стекло, тени</div>
                    {!isGH && <div className="text-xs text-unbox-green font-semibold mt-2">✓ Активен</div>}
                </button>
            </div>
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

// ── Design Switcher ─────────────────────────────────────────────────────────

function DesignSwitcher() {
    const isGH = useDesignFlag();
    const [hover, setHover] = useState<string | null>(null);

    const switchTo = useCallback((mode: 'grid' | 'off') => {
        if (mode === 'off') {
            localStorage.setItem('unbox_design_flag', 'off');
        } else {
            localStorage.removeItem('unbox_design_flag');
        }
        window.location.reload();
    }, []);

    const optStyle = (active: boolean, id: string): React.CSSProperties => ({
        flex: 1,
        padding: '20px 16px',
        border: active ? `2px solid ${GH.ink}` : `1px solid ${GH.ink10}`,
        background: active ? GH.ink5 : hover === id ? GH.ink5 : 'transparent',
        cursor: active ? 'default' : 'pointer',
        textAlign: 'center',
        transition: 'all 0.15s ease',
    });

    return (
        <div style={{ borderTop: ghpHairline, paddingTop: 24, marginBottom: 32 }}>
            <div style={{ ...ghpMono, color: GH.ink30, marginBottom: 16 }}>ОФОРМЛЕНИЕ</div>
            <div style={{ display: 'flex', gap: 12, maxWidth: 480 }}>
                {/* Grid House option */}
                <div
                    style={optStyle(isGH, 'gh')}
                    onClick={() => !isGH && switchTo('grid')}
                    onMouseEnter={() => setHover('gh')}
                    onMouseLeave={() => setHover(null)}
                >
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink30, marginBottom: 8 }}>
                        АКТИВНО
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Grid House</div>
                    <div style={{ fontSize: 12, color: GH.ink60 }}>Минимализм, типографика</div>
                    {isGH && <div style={{ marginTop: 10, fontSize: 11, color: GH.accent, fontWeight: 600 }}>✓ Текущий</div>}
                </div>

                {/* Classic option */}
                <div
                    style={optStyle(!isGH, 'classic')}
                    onClick={() => isGH && switchTo('off')}
                    onMouseEnter={() => setHover('classic')}
                    onMouseLeave={() => setHover(null)}
                >
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink30, marginBottom: 8 }}>
                        АЛЬТЕРНАТИВА
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Classic</div>
                    <div style={{ fontSize: 12, color: GH.ink60 }}>Стекло, тени, скругления</div>
                    {!isGH && <div style={{ marginTop: 10, fontSize: 11, color: GH.accent, fontWeight: 600 }}>✓ Текущий</div>}
                </div>
            </div>
        </div>
    );
}

// ── Grid House — Telegram Connect ────────────────────────────────────────────

function GridHouseTelegramConnect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { connect, isConnecting, cancel } = useTelegramConnect();
    const isBound = !!value && /^\d+$/.test(value);

    if (isBound) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', border: `1px solid ${GH.ink10}`, background: '#F0FDF4',
            }}>
                <CheckCircle2 size={18} color="#16A34A" />
                <span style={{ fontSize: 13, color: GH.ink }}>Подключено — уведомления активны</span>
                <button
                    type="button"
                    onClick={() => onChange('')}
                    style={{
                        marginLeft: 'auto', fontSize: 11, fontFamily: GH_MONO,
                        color: GH.ink60, background: 'transparent', border: 'none',
                        textDecoration: 'underline', cursor: 'pointer',
                    }}
                >
                    Отключить
                </button>
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={isConnecting ? cancel : connect}
                style={{
                    width: '100%', padding: '12px 16px',
                    background: isConnecting ? GH.ink10 : '#26A5E4',
                    color: isConnecting ? GH.ink60 : '#fff',
                    fontWeight: 700, fontSize: 13, fontFamily: GH_SANS,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
            >
                {isConnecting ? (
                    <><Loader2 size={16} className="animate-spin" /> Ждём подтверждения… (отмена)</>
                ) : (
                    <><Send size={16} /> Подключить Telegram</>
                )}
            </button>
            <div style={{ marginTop: 12 }}>
                <label style={{ ...ghpMono, color: GH.ink30, display: 'block', marginBottom: 4, fontSize: 9 }}>
                    ИЛИ @USERNAME ВРУЧНУЮ
                </label>
                <input
                    type="text"
                    style={{ ...ghpInput, fontSize: 13 }}
                    placeholder="@username"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                <div style={{ fontSize: 11, color: GH.ink60, marginTop: 6, lineHeight: 1.5 }}>
                    При ручном вводе уведомления придут, только если вы уже писали боту{' '}
                    <a href="https://t.me/Unbox_Booking_G_Bot" target="_blank" rel="noopener noreferrer"
                       style={{ color: GH.ink, textDecoration: 'underline' }}>
                        @Unbox_Booking_G_Bot
                    </a>.
                </div>
            </div>
        </>
    );
}


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
                    <PhoneInput
                        style={ghpInput}
                        value={currentUser.phone || ''}
                        onChange={(v) => updateUser({ phone: v })}
                    />
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ ...ghpMono, color: GH.ink30, display: 'block', marginBottom: 6 }}>TELEGRAM</label>
                    <GridHouseTelegramConnect
                        value={currentUser.telegramId || ''}
                        onChange={(v) => updateUser({ telegramId: v })}
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

            {/* Design switcher */}
            <DesignSwitcher />

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', marginTop: 48, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghpMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghpMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
