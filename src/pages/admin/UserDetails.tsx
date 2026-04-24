import { useParams, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Mail, Phone, CreditCard, Shield, ArrowLeft, Plus, History, RotateCcw, ChevronDown, UserCheck, UserCircle, X, Loader2, PackagePlus, KeyRound, CalendarClock, CheckCircle2, XCircle, Clock, Pencil, Check } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { safeFormat } from '../../utils/dateUtils';
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { RESOURCES, SUBSCRIPTION_PLANS } from '../../utils/data';
import { UserTags } from '../../components/admin/UserTags';
import { UserTasks } from '../../components/admin/UserTasks';
import { UserContacts } from '../../components/admin/UserContacts';
import { UserTransactions } from '../../components/admin/UserTransactions';
import { ProfessionEditor } from '../../components/admin/ProfessionEditor';
import { TargetAudienceEditor } from '../../components/admin/TargetAudienceEditor';
import { UserBookingsTab } from '../../components/admin/UserBookingsTab';
import { UserLoyaltyCard } from '../../components/admin/UserLoyaltyCard';
import { UserComments } from '../../components/admin/UserComments';
import { ClientTimeline } from '../../components/admin/ClientTimeline';
import { UserBonuses } from '../../components/admin/UserBonuses';

import { AddFundsModal } from '../../components/admin/modals/AddFundsModal';
import { AssignSubscriptionModal } from '../../components/admin/modals/AssignSubscriptionModal';
import { EditCreditLimitModal } from '../../components/admin/modals/EditCreditLimitModal';
import { api } from '../../api/client';
import { crmApi, type CrmAccessStatus } from '../../api/crm';

const ghudMono: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const,
};

export function AdminUserDetails() {
    const { email } = useParams<{ email: string }>();
    const navigate = useNavigate();
    const { users, updateUserById, bookings, addTransaction, currentUser, cancelBooking } = useUserStore();

    // Find User
    const user = users.find(u => u.email === decodeURIComponent(email || ''));

    const [isAddFundsOpen, setIsAddFundsOpen] = useState(false);
    const [isAssignSubOpen, setIsAssignSubOpen] = useState(false);
    const [isEditLimitOpen, setIsEditLimitOpen] = useState(false);
    const [isStatusDropdownOpen, setIsStatusDropdownOpen] = useState(false);
    const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
    const [adminPickerType, setAdminPickerType] = useState<'responsible' | 'attracted' | null>(null);
    const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'finance' | 'timeline'>('overview');

    // Subscription topup form state
    const [isTopupOpen, setIsTopupOpen] = useState(false);
    const [isEditingExpiry, setIsEditingExpiry] = useState(false);
    const [editExpiryDate, setEditExpiryDate] = useState('');
    // Excel #84 — inline display-name editing. Used when the backend-derived
    // name ("Галина") is too short to tell clients apart in schedules, and
    // admins want to extend it ("Галина Иващенко").
    const [isEditingName, setIsEditingName] = useState(false);
    const [editName, setEditName] = useState('');
    const [savingName, setSavingName] = useState(false);
    const [topupForm, setTopupForm] = useState({ hours: '', amount: '', payment_method: 'cash', note: '' });
    const [topupSaving, setTopupSaving] = useState(false);

    // CRM Access state
    const [crmAccess, setCrmAccess] = useState<(CrmAccessStatus & { profession?: string; message?: string; submittedAt?: string }) | null>(null);
    const [crmActionLoading, setCrmActionLoading] = useState(false);

    const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];
    const adminUsers = users.filter(u => u.role && ADMIN_ROLES.includes(u.role));
    const adminMap = new Map(adminUsers.map(a => [a.id, a]));
    const responsibleAdmin = user?.responsibleAdminId ? adminMap.get(user.responsibleAdminId) : null;
    const attractedAdmin   = user?.attractedByAdminId  ? adminMap.get(user.attractedByAdminId)  : null;
    // Let's keep 'overview' default but I will change it in the replacement to 'timeline' to show it off immediately, or maybe 'overview' is safer. Let's use 'overview' but add 'timeline' to type.

    // Fetch CRM access status
    const fetchCrmAccess = useCallback(async () => {
        if (!user?.id) return;
        try {
            const data = await crmApi.getUserAccess(user.id);
            setCrmAccess(data);
        } catch {
            setCrmAccess(null);
        }
    }, [user?.id]);

    useEffect(() => {
        fetchCrmAccess();
    }, [fetchCrmAccess]);

    if (!user) {
        return <div className="p-8 text-center">Клиент не найден</div>;
    }

    const handleCrmApprove = async (days: number) => {
        setCrmActionLoading(true);
        try {
            await crmApi.approveAccessRequest(user.id, days);
            toast.success(`CRM доступ одобрен на ${days} дней`);
            fetchCrmAccess();
        } catch {
            toast.error('Ошибка при одобрении доступа');
        } finally {
            setCrmActionLoading(false);
        }
    };

    const handleCrmReject = async () => {
        setCrmActionLoading(true);
        try {
            await crmApi.rejectAccessRequest(user.id);
            toast.success('Запрос отклонён');
            fetchCrmAccess();
        } catch {
            toast.error('Ошибка при отклонении запроса');
        } finally {
            setCrmActionLoading(false);
        }
    };

    // derived data
    const sortedBookings = bookings
        .filter(b => b.userId === user.email)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());



    const handleAddFunds = async (amount: number, method: 'cash' | 'tbc' | 'bog', branch?: string) => {
        updateUserById(user.email, { balance: user.balance + amount });

        addTransaction({
            userId: user.email,
            type: 'deposit',
            amount: amount,
            paymentMethod: method,
            adminId: currentUser?.email,
            adminName: currentUser?.name || 'Admin',
            description: 'Пополнение баланса'
        });

        // Auto-create cashbox income with proper category
        const methodMap: Record<string, string> = { cash: 'cash', tbc: 'card_tbc', bog: 'card_bog' };
        try {
            await api.post('/cashbox/transactions', {
                type: 'income',
                amount,
                payment_method: methodMap[method] || 'cash',
                category_id: 'cat-topup',
                description: `Пополнение баланса: ${user.name}`,
                branch: branch || undefined,
            });
        } catch { /* cashbox may not be accessible for this admin */ }

        toast.success(`Баланс пополнен на ${amount} ₾ (${method})`);
    };

    const handleUpdateCreditLimit = (limit: number) => {
        updateUserById(user.email, { creditLimit: limit });
        toast.success(`Кредитный лимит установлен: ${limit} ₾`);
    }



    const toggleFreeze = () => {
        if (!user.subscription) return;
        useUserStore.getState().toggleSubscriptionFreeze(user.email);
        toast.success(user.subscription.isFrozen ? 'Абонемент разморожен' : 'Абонемент заморожен');
    };

    const handleAssignSubscription = (planIndex: number, method: 'cash' | 'tbc' | 'bog' | 'balance') => {
        const plan = SUBSCRIPTION_PLANS[planIndex];
        if (!plan) return;

        // Balance Check
        if (method === 'balance') {
            if (user.balance < plan.price) {
                toast.error(`Недостаточно средств. Баланс: ${user.balance} ₾`);
                return;
            }
            // Deduct balance
            updateUserById(user.email, { balance: user.balance - plan.price });
        }

        const totalWithBonus = plan.hours + (plan.bonusHours || 0);

        const newSubscription = {
            id: crypto.randomUUID(),
            planId: plan.id,
            name: plan.name,
            totalHours: plan.hours,
            bonusHours: plan.bonusHours || 0,
            remainingHours: totalWithBonus,
            freeReschedules: plan.perks?.includes('1 бесплатный перенос') ? 1 : 0,
            expiryDate: new Date(Date.now() + plan.durationDays * 24 * 60 * 60 * 1000).toISOString(),
            isFrozen: false,
            freezeCount: 0,
            discountPercent: plan.discountPercent,
            includedFormats: plan.formats as any
        };

        updateUserById(user.email, { subscription: newSubscription });

        // Record Transaction
        addTransaction({
            userId: user.email,
            type: 'subscription_purchase',
            amount: plan.price,
            paymentMethod: method,
            adminId: currentUser?.email,
            adminName: currentUser?.name || 'Admin',
            description: `Абонемент ${plan.name}`,
            relatedEntityId: newSubscription.id
        });

        toast.success(`Абонемент "${plan.name}" назначен`);
    };

    const handleCancelBooking = (id: string) => {
        if (confirm('Вы уверены, что хотите отменить это бронирование?')) {
            cancelBooking(id);
            toast.success('Бронирование отменено');
        }
    };

    // Excel #59 — jump to the chessboard with this booking pre-selected
    // and scrolled into view, so the admin can drag it to the new time.
    const handleRescheduleBooking = (id: string) => {
        navigate(`/admin/bookings?view=grid&highlight=${id}`);
    };

    const handleTopup = async () => {
        if (!topupForm.hours || !topupForm.amount) return;
        setTopupSaving(true);
        try {
            await api.post(`/users/${user.id}/subscription/topup`, {
                hours: Number(topupForm.hours),
                amount: Number(topupForm.amount),
                payment_method: topupForm.payment_method,
                ...(topupForm.note ? { note: topupForm.note } : {}),
            });
            await useUserStore.getState().fetchUsers();
            toast.success(`Абонемент пополнен на ${topupForm.hours} ч`);
            setIsTopupOpen(false);
            setTopupForm({ hours: '', amount: '', payment_method: 'cash', note: '' });
        } catch {
            toast.error('Ошибка пополнения абонемента');
        } finally {
            setTopupSaving(false);
        }
    };

    // Analytics
    const completedBookings = sortedBookings.filter(b => b.status === 'completed');
    const firstBookingDate = sortedBookings.length > 0 ? sortedBookings[sortedBookings.length - 1].date : null;
    const lastVisitDate = completedBookings.length > 0 ? completedBookings[0].date : null;

    // Status Logic
    const getClientStatus = () => {
        if (user.manualStatus) return user.manualStatus;

        if (sortedBookings.length === 0 && (!user.registrationDate || new Date(user.registrationDate).getTime() > Date.now() - 30 * 24 * 60 * 60 * 1000)) {
            return 'new';
        }
        if (lastVisitDate && new Date(lastVisitDate).getTime() > Date.now() - 45 * 24 * 60 * 60 * 1000) {
            return 'active';
        }
        if (sortedBookings.length > 0) {
            return 'sleeping';
        }
        return 'new';
    };

    const clientStatus = getClientStatus();

    const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
        new: { label: 'Новый', color: 'text-unbox-green', bg: 'bg-unbox-light' },
        active: { label: 'Активный', color: 'text-unbox-green', bg: 'bg-white border border-unbox-green' },
        sleeping: { label: 'Спящий', color: 'text-unbox-grey', bg: 'bg-unbox-light/30' },
        vip: { label: 'VIP', color: 'text-white', bg: 'bg-unbox-dark' }, // Special status
        partner: { label: 'Партнёр', color: 'text-unbox-dark', bg: 'bg-unbox-light' },
        bad_client: { label: 'Проблемный', color: 'text-unbox-dark', bg: 'bg-unbox-light' },
    };

    const currentStatusConfig = STATUS_CONFIG[clientStatus] || STATUS_CONFIG.new;

    return (
        <div className=''
             style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* ... Modals ... */}
            <AddFundsModal
                isOpen={isAddFundsOpen}
                onClose={() => setIsAddFundsOpen(false)}
                onConfirm={handleAddFunds}
                userName={user.name}
            />
            <AssignSubscriptionModal
                isOpen={isAssignSubOpen}
                onClose={() => setIsAssignSubOpen(false)}
                onConfirm={handleAssignSubscription}
                currentSubscriptionName={user.subscription?.name}
            />
            <EditCreditLimitModal
                isOpen={isEditLimitOpen}
                onClose={() => setIsEditLimitOpen(false)}
                currentLimit={user.creditLimit || 0}
                onConfirm={handleUpdateCreditLimit}
            />

            {/* Header */}
            {
                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                        <button onClick={() => navigate('/admin/users')}
                            style={{ padding: 6, background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink30, marginTop: 4 }}>
                            <ArrowLeft size={18} />
                        </button>
                        <div style={{ flex: 1 }}>
                            <p style={{ ...ghudMono, color: GH.ink30, marginBottom: 6 }}>CLIENT PROFILE</p>
                            {isEditingName ? (
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                                    <input
                                        autoFocus
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onKeyDown={async (e) => {
                                            if (e.key === 'Escape') { setIsEditingName(false); return; }
                                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                                        }}
                                        placeholder="Имя для расписания (например: Галина Иващенко)"
                                        style={{
                                            flex: 1,
                                            fontSize: 'clamp(20px, 2.6vw, 30px)',
                                            fontWeight: 700,
                                            letterSpacing: '-0.02em',
                                            padding: '4px 8px',
                                            border: `1px solid ${GH.ink}`,
                                            background: GH.paper,
                                            fontFamily: GH_SANS,
                                            outline: 'none',
                                        }}
                                    />
                                    <button
                                        onClick={async () => {
                                            const trimmed = editName.trim();
                                            if (!trimmed || trimmed === user.name || savingName) {
                                                setIsEditingName(false);
                                                return;
                                            }
                                            setSavingName(true);
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.updateUser(user.id, { name: trimmed });
                                                toast.success('Имя обновлено');
                                                await useUserStore.getState().fetchUsers();
                                                setIsEditingName(false);
                                            } catch (err: any) {
                                                toast.error(err?.response?.data?.detail || 'Не удалось сохранить');
                                            } finally {
                                                setSavingName(false);
                                            }
                                        }}
                                        disabled={savingName}
                                        title="Сохранить"
                                        style={{ padding: 8, background: GH.ink, color: GH.paper, border: 'none', cursor: savingName ? 'wait' : 'pointer' }}
                                    >
                                        {savingName ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                                    </button>
                                    <button
                                        onClick={() => setIsEditingName(false)}
                                        title="Отмена"
                                        style={{ padding: 8, background: 'transparent', color: GH.ink60, border: `1px solid ${GH.ink10}`, cursor: 'pointer' }}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.1, margin: 0, marginBottom: 8, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                                    <span>{user.name || '(без имени)'}</span>
                                    <button
                                        onClick={() => { setEditName(user.name || ''); setIsEditingName(true); }}
                                        title="Изменить отображаемое имя (для расписания)"
                                        style={{ padding: 4, background: 'transparent', border: 'none', color: GH.ink30, cursor: 'pointer', display: 'inline-flex' }}
                                    >
                                        <Pencil size={14} />
                                    </button>
                                </h1>
                            )}
                            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span style={{ ...ghudMono, fontSize: 9, padding: '3px 8px', background: GH.ink5, color: GH.ink60 }}>
                                    {(user.role || 'user').toUpperCase()}
                                </span>
                                <span style={{ ...ghudMono, fontSize: 9, padding: '3px 8px',
                                    background: clientStatus === 'active' ? 'rgba(71,109,107,0.12)' : clientStatus === 'vip' ? 'rgba(147,51,234,0.12)' : GH.ink5,
                                    color: clientStatus === 'active' ? GH.accent : clientStatus === 'vip' ? '#9333ea' : GH.ink30,
                                }}>
                                    {currentStatusConfig.label.toUpperCase()}
                                </span>
                                {user.email && <span style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink30 }}>{user.email}</span>}
                                {user.registrationDate && (() => {
                                    // Defensive: after /users/merge the target user may
                                    // carry over a malformed registrationDate from the
                                    // absorbed account — don't let it crash the page.
                                    const formatted = safeFormat(user.registrationDate, 'd.MM.yyyy');
                                    if (!formatted) return null;
                                    return (
                                        <span style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink30 }}>
                                            с {formatted}
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            }

            {/* Tabs */}
            {
                <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${GH.ink10}`, marginBottom: 24 }}>
                    {([
                        ['overview', 'ОБЗОР'],
                        ['bookings', 'БРОНИРОВАНИЯ'],
                        ['finance', 'ФИНАНСЫ'],
                        ['timeline', 'ИСТОРИЯ'],
                    ] as const).map(([key, label]) => (
                        <button key={key} onClick={() => setActiveTab(key as any)}
                            style={{
                                padding: '10px 18px', border: 'none', cursor: 'pointer',
                                fontFamily: GH_SANS, fontSize: 12, fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === key ? GH.ink : GH.ink30,
                                borderBottom: activeTab === key ? `2px solid ${GH.ink}` : '2px solid transparent',
                                marginBottom: -1, letterSpacing: '0.04em',
                            }}>
                            {label}
                        </button>
                    ))}
                </div>
            }

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Profile & Info */}
                <div className="space-y-6">
                    {/* Main Info Card */}
                    <Card className="p-6">
                        <div className="flex flex-col items-center text-center mb-6">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full overflow-hidden bg-unbox-light/50 flex items-center justify-center text-3xl font-bold text-unbox-grey mb-4 border-2 border-transparent group-hover:border-unbox-light transition-all">
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                                    ) : (
                                        (user.name || '?').charAt(0).toUpperCase()
                                    )}
                                </div>
                                <label className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 group-hover:opacity-100 rounded-full cursor-pointer transition-opacity">
                                    <span className="text-xs font-medium">Изменить</span>
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept="image/*"
                                        onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) {
                                                const reader = new FileReader();
                                                reader.onloadend = () => {
                                                    updateUserById(user.email, { avatarUrl: reader.result as string });
                                                    toast.success('Фото обновлено');
                                                };
                                                reader.readAsDataURL(file);
                                            }
                                        }}
                                    />
                                </label>
                            </div>
                            <div className="font-bold text-lg">{user.name}</div>
                            <div className={clsx("text-sm px-2 py-0.5 rounded-full mt-1",
                                user.level === 'vip' ? 'bg-purple-100 text-purple-700' :
                                    user.level === 'loyal' ? 'bg-unbox-light text-unbox-dark' :
                                        'bg-gray-100 text-gray-600'
                            )}>
                                {user.level === 'vip' ? 'VIP Client' : user.level === 'loyal' ? 'Loyal Client' : 'Basic Client'}
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center gap-3 text-sm">
                                <Mail size={16} className="text-unbox-grey" />
                                <a href={`mailto:${user.email}`} className="text-unbox-green hover:underline">{user.email}</a>
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                                <Phone size={16} className="text-unbox-grey" />
                                <span>{user.phone || 'Не указан'}</span>
                            </div>

                            {/* Telegram ID Field */}
                            <div className="flex items-center gap-3 text-sm group/tg cursor-pointer" onClick={() => {
                                const tgId = prompt('Введите Telegram ID:', user.telegramId || '');
                                if (tgId !== null) updateUserById(user.email, { telegramId: tgId });
                            }}>
                                <div className="text-unbox-grey"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-send"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg></div>
                                <span className={user.telegramId ? 'text-unbox-dark' : 'text-unbox-grey dashed underline'}>
                                    {user.telegramId || 'Telegram ID не указан'}
                                </span>
                                <span className="opacity-0 group-hover/tg:opacity-100 text-xs text-blue-500">Изменить</span>
                            </div>

                            {/* Profession Field */}
                            <div className="pt-2 border-t border-gray-100">
                                <div className="text-xs text-gray-500 mb-1">Профессия</div>
                                <ProfessionEditor
                                    value={user.profession}
                                    onChange={(val) => updateUserById(user.email, { profession: val })}
                                />
                            </div>

                            {/* Target Audience Field */}
                            <div className="pt-2 border-t border-gray-100">
                                <div className="text-xs text-gray-500 mb-1">Работает с</div>
                                <TargetAudienceEditor
                                    value={user.targetAudience}
                                    onChange={(val) => updateUserById(user.email, { targetAudience: val })}
                                />
                            </div>
                        </div>

                        <div className="border-t border-unbox-light my-4 pt-4 space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-unbox-grey">Первый визит</span>
                                <span className="font-medium text-unbox-dark">
                                    {safeFormat(firstBookingDate, 'd MMM yyyy', ru, '—')}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-unbox-grey">Последний визит</span>
                                <span className="font-medium text-unbox-dark">
                                    {safeFormat(lastVisitDate, 'd MMM yyyy', ru, '—')}
                                </span>
                            </div>
                        </div>

                        {/* ── Admin Assignment ── */}
                        <div className="border-t border-unbox-light pt-4 space-y-1">
                            <div className="text-xs font-semibold text-unbox-grey uppercase tracking-wider mb-3">Назначения</div>

                            {/* Responsible row */}
                            <button
                                onClick={() => setAdminPickerType('responsible')}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-unbox-light/50 transition-colors text-left"
                            >
                                <div className={clsx(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                                    responsibleAdmin ? 'bg-unbox-green text-white' : 'bg-unbox-light text-unbox-grey'
                                )}>
                                    {responsibleAdmin ? (responsibleAdmin.name?.[0]?.toUpperCase() ?? '?') : <UserCircle size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-unbox-grey">Ответственный</div>
                                    <div className={clsx('text-sm font-medium truncate', responsibleAdmin ? 'text-unbox-dark' : 'text-gray-500 italic')}>
                                        {responsibleAdmin ? responsibleAdmin.name : 'не назначен'}
                                    </div>
                                </div>
                                <span className="text-xs text-unbox-grey shrink-0">✎</span>
                            </button>

                            {/* Attracted row */}
                            <button
                                onClick={() => setAdminPickerType('attracted')}
                                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-unbox-light/50 transition-colors text-left"
                            >
                                <div className={clsx(
                                    'w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold',
                                    attractedAdmin ? 'bg-amber-400 text-white' : 'bg-unbox-light text-unbox-grey'
                                )}>
                                    {attractedAdmin ? (attractedAdmin.name?.[0]?.toUpperCase() ?? '?') : <UserCircle size={14} />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="text-[10px] text-unbox-grey">Привлёк клиента</div>
                                    <div className={clsx('text-sm font-medium truncate', attractedAdmin ? 'text-unbox-dark' : 'text-gray-500 italic')}>
                                        {attractedAdmin ? attractedAdmin.name : 'не указан'}
                                    </div>
                                </div>
                                <span className="text-xs text-unbox-grey shrink-0">✎</span>
                            </button>
                        </div>

                        {/* ── Password Change ── */}
                        {(currentUser?.role === 'owner' || currentUser?.role === 'senior_admin') && (
                            <div className="border-t border-unbox-light pt-4">
                                <div className="text-xs font-semibold text-unbox-grey uppercase tracking-wider mb-3">Безопасность</div>
                                <button
                                    onClick={async () => {
                                        // Excel #46 — renamed to "Сбросить пароль" to distinguish
                                        // this admin action from a user's self-change (which requires
                                        // the old password). Added a confirm step so admin knows
                                        // they're overriding someone else's credentials.
                                        const ok = window.confirm(
                                            `Сбросить пароль пользователя ${user.email}?\n\n` +
                                            'Вы устанавливаете новый пароль ОТ ЕГО ИМЕНИ, без подтверждения старого.\n' +
                                            'Действие будет записано в журнал аудита.\n\n' +
                                            'Продолжить?',
                                        );
                                        if (!ok) return;
                                        const newPassword = prompt('Новый пароль (мин. 6 символов):');
                                        if (!newPassword) return;
                                        if (newPassword.length < 6) {
                                            toast.error('Пароль должен быть не менее 6 символов');
                                            return;
                                        }
                                        const confirmPassword = prompt('Подтвердите новый пароль:');
                                        if (newPassword !== confirmPassword) {
                                            toast.error('Пароли не совпадают');
                                            return;
                                        }
                                        try {
                                            await api.post(`/users/${user.id}/change-password`, { new_password: newPassword });
                                            toast.success('Пароль сброшен · запись в журнале аудита');
                                        } catch (err: any) {
                                            toast.error(err.response?.data?.detail || 'Ошибка сброса пароля');
                                        }
                                    }}
                                    className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-amber-50 border border-dashed border-amber-200 transition-colors text-left"
                                >
                                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                                        <Shield size={14} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-unbox-dark">Сбросить пароль</div>
                                        <div className="text-[10px] text-unbox-grey">Админ-override без старого пароля. Записывается в журнал.</div>
                                    </div>
                                </button>

                                {/* Change email (Excel #47) — senior_admin/owner only */}
                                {(currentUser?.role === 'senior_admin' || currentUser?.role === 'owner') && (
                                    <button
                                        onClick={async () => {
                                            const next = prompt(
                                                `Текущий email: ${user.email}\n\nВведите новый email:`,
                                                user.email || '',
                                            );
                                            if (!next) return;
                                            const trimmed = next.trim().toLowerCase();
                                            if (trimmed === (user.email || '').toLowerCase()) {
                                                toast.error('Этот email уже установлен');
                                                return;
                                            }
                                            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
                                                toast.error('Неверный формат email');
                                                return;
                                            }
                                            const ok = window.confirm(
                                                `Изменить email пользователя?\n\n${user.email} → ${trimmed}\n\n` +
                                                'Все связанные записи (брони, waitlist, транзакции) будут обновлены автоматически.\n\n' +
                                                'Продолжить?',
                                            );
                                            if (!ok) return;
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.changeEmail(user.id, trimmed);
                                                toast.success(`Email изменён на ${trimmed}. Обновите страницу для актуализации.`);
                                                // Navigate to the new canonical URL
                                                navigate(`/admin/users/${encodeURIComponent(trimmed)}`, { replace: true });
                                            } catch (err: any) {
                                                toast.error(err.response?.data?.detail || 'Ошибка смены email');
                                            }
                                        }}
                                        className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-purple-50 border border-dashed border-purple-200 transition-colors text-left"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                                            <Shield size={14} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-unbox-dark">Изменить email</div>
                                            <div className="text-[10px] text-unbox-grey">Каскадно обновляет брони, waitlist и транзакции</div>
                                        </div>
                                    </button>
                                )}

                                {/* Archive / Unarchive — Excel #11 soft delete.
                                    Available to any admin role; the backend
                                    enforces hierarchy (admins can't archive
                                    each other, nobody can archive owner). */}
                                <button
                                    onClick={async () => {
                                        const isArchived = !!user.archivedAt;
                                        if (isArchived) {
                                            const ok = window.confirm(
                                                `Восстановить пользователя ${user.email} из архива?\n\n` +
                                                'Сможет снова входить на сайт и будет видим в обычных списках.',
                                            );
                                            if (!ok) return;
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.unarchiveUser(user.id);
                                                toast.success('Пользователь восстановлен');
                                                await useUserStore.getState().fetchUsers();
                                            } catch (err: any) {
                                                toast.error(err.response?.data?.detail || 'Не удалось восстановить');
                                            }
                                        } else {
                                            const reason = prompt(
                                                `Архивировать пользователя ${user.email}?\n\n` +
                                                'Не сможет входить на сайт. Вся история (брони, оплаты, бонусы) сохраняется.\n' +
                                                'Можно восстановить в любой момент.\n\n' +
                                                'Опционально: укажите причину (для аудита):',
                                                '',
                                            );
                                            if (reason === null) return; // cancelled
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.archiveUser(user.id, reason.trim() || undefined);
                                                toast.success('Пользователь отправлен в архив');
                                                await useUserStore.getState().fetchUsers();
                                            } catch (err: any) {
                                                toast.error(err.response?.data?.detail || 'Не удалось архивировать');
                                            }
                                        }
                                    }}
                                    className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-amber-50 border border-dashed border-amber-200 transition-colors text-left"
                                >
                                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                                        <Shield size={14} />
                                    </div>
                                    <div className="flex-1">
                                        <div className="text-sm font-medium text-unbox-dark">
                                            {user.archivedAt ? 'Восстановить из архива' : 'Архивировать пользователя'}
                                        </div>
                                        <div className="text-[10px] text-unbox-grey">
                                            {user.archivedAt
                                                ? `В архиве с ${safeFormat(user.archivedAt, 'd.MM.yyyy', undefined, '—')}`
                                                : 'Заблокирует вход, сохранит всю историю. Обратимо.'}
                                        </div>
                                    </div>
                                </button>

                                {/* Merge two accounts — senior_admin/owner only */}
                                {(currentUser?.role === 'senior_admin' || currentUser?.role === 'owner') && (
                                    <button
                                        onClick={async () => {
                                            const source = prompt(
                                                `Слить другой аккаунт В этот (${user.email})?\n\n` +
                                                'Введите email или UUID поглощаемого аккаунта.\n' +
                                                'Его брони, waitlist, транзакции и баланс перейдут сюда.\n' +
                                                'Поглощённый аккаунт будет удалён.',
                                            );
                                            if (!source) return;
                                            const trimmed = source.trim();
                                            if (!trimmed) return;
                                            const ok = window.confirm(
                                                `Слить аккаунт?\n\n` +
                                                `Поглощаемый: ${trimmed}\n` +
                                                `Оставить:    ${user.email}\n\n` +
                                                'Действие необратимо. Продолжить?',
                                            );
                                            if (!ok) return;
                                            try {
                                                const { usersApi } = await import('../../api/users');
                                                await usersApi.mergeUsers(trimmed, user.id);
                                                toast.success(`Аккаунт ${trimmed} слит в текущий. Обновите страницу.`);
                                            } catch (err: any) {
                                                toast.error(err.response?.data?.detail || 'Ошибка слияния');
                                            }
                                        }}
                                        className="mt-2 w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-indigo-50 border border-dashed border-indigo-200 transition-colors text-left"
                                    >
                                        <div className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                                            <Shield size={14} />
                                        </div>
                                        <div className="flex-1">
                                            <div className="text-sm font-medium text-unbox-dark">Слить с аккаунтом</div>
                                            <div className="text-[10px] text-unbox-grey">Объединить дубликаты (TG-placeholder + сайт)</div>
                                        </div>
                                    </button>
                                )}
                            </div>
                        )}
                    </Card>

                    {/* ── Admin Picker Modal (fixed, escapes overflow:hidden) ── */}
                    {adminPickerType && (
                        <div
                            className="fixed inset-0 z-50 flex items-center justify-center"
                            onClick={() => setAdminPickerType(null)}
                        >
                            <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                            <div
                                className="relative bg-white rounded-2xl shadow-2xl w-72 p-5 animate-in zoom-in-95 duration-200"
                                onClick={e => e.stopPropagation()}
                            >
                                {/* Modal header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div>
                                        <h3 className="font-bold text-unbox-dark">
                                            {adminPickerType === 'responsible' ? 'Ответственный менеджер' : 'Кто привлёк клиента'}
                                        </h3>
                                        <p className="text-xs text-unbox-grey mt-0.5">{user.name}</p>
                                    </div>
                                    <button onClick={() => setAdminPickerType(null)} className="p-1 rounded-lg hover:bg-unbox-light text-unbox-grey">
                                        <X size={16} />
                                    </button>
                                </div>

                                <div className="space-y-1">
                                    {/* Clear option */}
                                    <button
                                        onClick={() => {
                                            const field = adminPickerType === 'responsible' ? { responsibleAdminId: null } : { attractedByAdminId: null };
                                            updateUserById(user.email, field as any);
                                            setAdminPickerType(null);
                                        }}
                                        className={clsx(
                                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                            (adminPickerType === 'responsible' ? !user.responsibleAdminId : !user.attractedByAdminId)
                                                ? 'bg-unbox-light text-unbox-dark font-medium'
                                                : 'text-unbox-grey hover:bg-unbox-light/50'
                                        )}
                                    >
                                        <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                                            <UserCircle size={16} className="text-gray-400" />
                                        </div>
                                        {adminPickerType === 'responsible' ? 'Не назначен' : 'Не указан'}
                                    </button>

                                    {/* Admin list */}
                                    {adminUsers.map(admin => {
                                        const currentId = adminPickerType === 'responsible' ? user.responsibleAdminId : user.attractedByAdminId;
                                        const isSelected = currentId === admin.id;
                                        const avatarBg = adminPickerType === 'responsible' ? 'bg-unbox-green' : 'bg-amber-400';
                                        return (
                                            <button
                                                key={admin.id}
                                                onClick={() => {
                                                    const field = adminPickerType === 'responsible'
                                                        ? { responsibleAdminId: admin.id }
                                                        : { attractedByAdminId: admin.id };
                                                    updateUserById(user.email, field as any);
                                                    toast.success(adminPickerType === 'responsible' ? `Ответственный: ${admin.name}` : `Привлёк: ${admin.name}`);
                                                    setAdminPickerType(null);
                                                }}
                                                className={clsx(
                                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                                    isSelected ? 'bg-unbox-green text-white font-medium' : 'text-unbox-dark hover:bg-unbox-light/50'
                                                )}
                                            >
                                                <div className={clsx(
                                                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                                    isSelected ? 'bg-white/20 text-white' : `${avatarBg} text-white`
                                                )}>
                                                    {admin.name?.[0]?.toUpperCase() ?? '?'}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="truncate">{admin.name}</div>
                                                    <div className={clsx('text-[10px] truncate', isSelected ? 'text-white/70' : 'text-unbox-grey')}>
                                                        {admin.role === 'owner' ? 'Владелец' : admin.role === 'senior_admin' ? 'Ст. Администратор' : 'Администратор'}
                                                    </div>
                                                </div>
                                                {isSelected && <UserCheck size={14} className="ml-auto shrink-0" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Contacts */}
                    <UserContacts email={user.email} contacts={user.additionalContacts || []} />



                    {/* Tags */}
                    <UserTags email={user.email} tags={user.tags || []} />

                    {/* Comments & Notes */}
                    <UserComments email={user.email} />
                    <UserBonuses user={user} currentUser={currentUser!} />
                </div>

                {/* Middle Column: Finances & Subscription & Tabs */}
                <div className="space-y-6 lg:col-span-2">
                    {/* Overview Tab Content */}
                    {activeTab === 'overview' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            {/* CRM Access — показываем ВВЕРХУ если есть запрос требующий действия */}
                            {crmAccess && ['pending', 'expired', 'rejected'].includes(crmAccess.accessStatus) && (
                                <Card className={clsx("p-5 border-2", crmAccess.accessStatus === 'pending' ? 'border-amber-300 bg-amber-50/30' : 'border-red-200 bg-red-50/20')}>
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-bold text-base flex items-center gap-2">
                                            <KeyRound size={18} className={crmAccess.accessStatus === 'pending' ? 'text-amber-600' : 'text-red-500'} />
                                            Запрос на Psy-CRM
                                        </h3>
                                        {crmAccess.accessStatus === 'pending' && (
                                            <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 text-[11px] font-bold uppercase flex items-center gap-1 animate-pulse">
                                                <Clock size={12} />
                                                Ожидает решения
                                            </span>
                                        )}
                                        {crmAccess.accessStatus === 'expired' && (
                                            <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-600 text-[11px] font-bold uppercase">
                                                Истёк
                                            </span>
                                        )}
                                        {crmAccess.accessStatus === 'rejected' && (
                                            <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-600 text-[11px] font-bold uppercase">
                                                Отклонён
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {crmAccess.profession && (
                                            <div className="text-sm">
                                                <span className="text-unbox-grey">Профессия:</span>{' '}
                                                <span className="font-medium">{crmAccess.profession}</span>
                                            </div>
                                        )}
                                        {crmAccess.message && (
                                            <div className="text-sm">
                                                <span className="text-unbox-grey">Сообщение:</span>{' '}
                                                <span className="text-gray-700">{crmAccess.message}</span>
                                            </div>
                                        )}
                                        {crmAccess.submittedAt && (
                                            <div className="text-xs text-unbox-grey">
                                                Подано: {safeFormat(crmAccess.submittedAt, 'd MMMM yyyy, HH:mm', ru, '—')}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-2 pt-2">
                                            {crmAccess.accessStatus === 'pending' && (
                                                <>
                                                    <button
                                                        onClick={() => handleCrmApprove(30)}
                                                        disabled={crmActionLoading}
                                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                                                    >
                                                        {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                                        Одобрить на 30 дней
                                                    </button>
                                                    <button
                                                        onClick={() => handleCrmReject()}
                                                        disabled={crmActionLoading}
                                                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-50 text-red-600 text-sm font-semibold hover:bg-red-100 disabled:opacity-50 transition-colors"
                                                    >
                                                        <XCircle size={14} />
                                                        Отклонить
                                                    </button>
                                                </>
                                            )}
                                            {(crmAccess.accessStatus === 'expired' || crmAccess.accessStatus === 'rejected') && (
                                                <button
                                                    onClick={() => handleCrmApprove(30)}
                                                    disabled={crmActionLoading}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                                                >
                                                    {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                                                    Активировать на 30 дней
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </Card>
                            )}

                            <Card className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-lg flex items-center gap-2">
                                        <CreditCard size={20} className="text-unbox-grey" />
                                        Финансы и Статистика
                                    </h3>
                                    <div className="flex gap-2">
                                        <Button size="sm" variant="outline" onClick={() => setIsAddFundsOpen(true)}>
                                            <Plus size={16} className="mr-2" />
                                            Пополнить
                                        </Button>
                                        <Button size="sm" variant="outline" onClick={() => setIsAssignSubOpen(true)}>
                                            <RotateCcw size={16} className="mr-2" />
                                            Абонемент
                                        </Button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {/* 1. Общая сумма оплат (Real Money In) */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-unbox-grey mb-1">Общая сумма оплат</div>
                                        <div className="text-2xl font-bold">
                                            {(() => {
                                                const userTransactions = useUserStore.getState().getTransactionsByUser(user.email);
                                                const realMoneyTransactions = userTransactions
                                                    .filter(t => ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod))
                                                    .reduce((sum, t) => sum + t.amount, 0);
                                                return realMoneyTransactions;
                                            })()} ₾
                                        </div>
                                        <div className="text-xs text-unbox-grey mt-1">Баланс: {user.balance} ₾</div>
                                        {/* Credit Limit UI */}
                                        <div
                                            className="text-xs text-unbox-grey mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                            onClick={() => setIsEditLimitOpen(true)}
                                        >
                                            Кредитный лимит:
                                            <span className="font-semibold text-unbox-grey border-b border-dashed border-unbox-light group-hover/limit:border-blue-400 group-hover/limit:text-unbox-green transition-colors">
                                                {user.creditLimit || 0} ₾
                                            </span>
                                            <div className="bg-unbox-light/50 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Всего забронировано часов */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-unbox-grey mb-1">Всего часов</div>
                                        <div className="text-2xl font-bold">
                                            {bookings
                                                .filter(b => b.userId === user.email && (b.status === 'completed' || b.status === 'confirmed'))
                                                .reduce((sum, b) => sum + (b.duration / 60), 0)
                                                .toFixed(1)} ч
                                        </div>
                                        <div className="text-xs text-unbox-grey mt-1">
                                            {sortedBookings.length} бронирований
                                        </div>
                                    </div>

                                    {/* 3. Средний чек */}
                                    <div className="bg-unbox-light/30 rounded-xl p-4 border border-unbox-light">
                                        <div className="text-sm text-unbox-grey mb-1">Средний чек</div>
                                        <div className="text-2xl font-bold">
                                            {(() => {
                                                const completed = bookings.filter(b => b.userId === user.email && b.status === 'completed');
                                                if (completed.length === 0) return '0';
                                                const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                                return (totalValue / completed.length).toFixed(0);
                                            })()} ₾
                                        </div>
                                        <div className="text-xs text-unbox-grey mt-1">за посещение</div>
                                    </div>

                                    {/* 5. Активный абонемент */}
                                    <div className={clsx("rounded-xl p-4 border relative overflow-hidden col-span-1 md:col-span-2 lg:col-span-3", user.subscription ? "bg-purple-50 border-purple-100" : "bg-unbox-light/30 border-unbox-light")}>
                                        <div className="relative z-10 flex justify-between items-start">
                                            <div>
                                                <div className="text-sm text-unbox-grey mb-1">Активный абонемент</div>
                                                {user.subscription ? (
                                                    <>
                                                        <div className="text-xl font-bold text-purple-900 mb-1">{user.subscription.name}</div>
                                                        <div className="text-sm text-purple-700 font-mono">
                                                            Остаток: <b>{user.subscription.remainingHours}</b> / {user.subscription.totalHours + (user.subscription.bonusHours || 0)} ч
                                                        </div>
                                                        <button
                                                            onClick={() => setIsTopupOpen(o => !o)}
                                                            className="mt-2 flex items-center gap-1 text-xs text-purple-600 hover:text-purple-900 underline"
                                                        >
                                                            <PackagePlus size={11} />
                                                            Пополнить часы
                                                        </button>
                                                    </>
                                                ) : (
                                                    <div className="text-unbox-grey italic">Отсутствует</div>
                                                )}
                                            </div>
                                            {user.subscription && (
                                                <div className="text-right">
                                                    <div className={clsx("px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2 inline-block", user.subscription.isFrozen ? "bg-blue-200 text-blue-800" : "bg-green-200 text-green-800")}>
                                                        {user.subscription.isFrozen ? 'Заморожен' : 'Активен'}
                                                    </div>
                                                    <div className="text-xs text-purple-600">
                                                        {isEditingExpiry ? (
                                                            <div className="flex items-center gap-1.5 mt-1">
                                                                <input
                                                                    type="date"
                                                                    value={editExpiryDate}
                                                                    onChange={e => setEditExpiryDate(e.target.value)}
                                                                    className="rounded border border-purple-300 px-1.5 py-0.5 text-xs focus:outline-none focus:border-purple-500"
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        if (!editExpiryDate) return;
                                                                        const updated = { ...user.subscription!, expiryDate: new Date(editExpiryDate).toISOString() };
                                                                        updateUserById(user.email, { subscription: updated as any });
                                                                        toast.success('Дата абонемента обновлена');
                                                                        setIsEditingExpiry(false);
                                                                    }}
                                                                    className="text-green-700 hover:text-green-900 font-bold text-xs"
                                                                >
                                                                    ✓
                                                                </button>
                                                                <button
                                                                    onClick={() => setIsEditingExpiry(false)}
                                                                    className="text-gray-400 hover:text-gray-600 text-xs"
                                                                >
                                                                    ✕
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => {
                                                                    const iso = safeFormat(user.subscription!.expiryDate, 'yyyy-MM-dd');
                                                                    if (iso) setEditExpiryDate(iso);
                                                                    setIsEditingExpiry(true);
                                                                }}
                                                                className="hover:text-purple-900 underline decoration-dotted"
                                                            >
                                                                до {safeFormat(user.subscription.expiryDate, 'd.MM.yyyy', undefined, '—')}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <button
                                                        onClick={toggleFreeze}
                                                        className="mt-2 text-xs underline text-purple-800 hover:text-purple-900"
                                                    >
                                                        {user.subscription.isFrozen ? 'Разморозить' : 'Заморозить'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* ── Topup inline form ─────────────────────────── */}
                                        {isTopupOpen && (
                                            <div className="relative z-10 mt-4 border-t border-purple-100 pt-4">
                                                <div className="text-xs font-semibold text-purple-800 mb-3">Пополнение абонемента</div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="text-[11px] text-unbox-grey block mb-1">Часов</label>
                                                        <input
                                                            type="number"
                                                            value={topupForm.hours}
                                                            onChange={e => setTopupForm(f => ({ ...f, hours: e.target.value }))}
                                                            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400"
                                                            min="1"
                                                            placeholder="10"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-unbox-grey block mb-1">Сумма (₾)</label>
                                                        <input
                                                            type="number"
                                                            value={topupForm.amount}
                                                            onChange={e => setTopupForm(f => ({ ...f, amount: e.target.value }))}
                                                            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400"
                                                            min="0"
                                                            placeholder="150"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-3 mt-2">
                                                    <div>
                                                        <label className="text-[11px] text-unbox-grey block mb-1">Способ оплаты</label>
                                                        <select
                                                            value={topupForm.payment_method}
                                                            onChange={e => setTopupForm(f => ({ ...f, payment_method: e.target.value }))}
                                                            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400"
                                                        >
                                                            <option value="cash">Наличные</option>
                                                            <option value="card">Карта</option>
                                                            <option value="transfer">Перевод</option>
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="text-[11px] text-unbox-grey block mb-1">Заметка</label>
                                                        <input
                                                            type="text"
                                                            value={topupForm.note}
                                                            onChange={e => setTopupForm(f => ({ ...f, note: e.target.value }))}
                                                            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm focus:outline-none focus:border-purple-400"
                                                            placeholder="необязательно"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 mt-3">
                                                    <button
                                                        onClick={() => setIsTopupOpen(false)}
                                                        className="flex-1 py-2 text-sm rounded-xl border border-purple-200 text-purple-700 hover:bg-purple-50 transition-colors"
                                                    >
                                                        Отмена
                                                    </button>
                                                    <button
                                                        onClick={handleTopup}
                                                        disabled={topupSaving || !topupForm.hours || !topupForm.amount}
                                                        className="flex-1 py-2 text-sm rounded-xl bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                                                    >
                                                        {topupSaving && <Loader2 size={14} className="animate-spin" />}
                                                        Подтвердить
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </Card>

                            {/* Loyalty System (New) */}
                            <UserLoyaltyCard email={user.email} />

                            {/* CRM Access — показываем внизу только для active (pending/expired/rejected — вверху) */}
                            {crmAccess && crmAccess.accessStatus === 'active' && (
                                <Card className="p-5">
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="font-bold text-base flex items-center gap-2">
                                            <KeyRound size={18} className="text-unbox-grey" />
                                            Доступ к Psy-CRM
                                        </h3>
                                        {crmAccess.permanent ? (
                                            <span className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 text-[11px] font-bold uppercase">
                                                Постоянный
                                            </span>
                                        ) : (
                                            <span className="px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-[11px] font-bold uppercase flex items-center gap-1">
                                                <CheckCircle2 size={12} />
                                                Активен
                                            </span>
                                        )}
                                    </div>
                                    <div className="space-y-3">
                                        {crmAccess.profession && (
                                            <div className="text-sm">
                                                <span className="text-gray-500">Профессия:</span>{' '}
                                                <span className="font-medium text-gray-900">{crmAccess.profession}</span>
                                            </div>
                                        )}
                                        {!crmAccess.permanent && crmAccess.expiresAt && (
                                            <div className="flex items-center gap-2 text-sm bg-green-50 rounded-lg px-3 py-2">
                                                <CalendarClock size={14} className="text-green-600" />
                                                <span className="text-green-800">
                                                    Действует до{' '}
                                                    <b>{safeFormat(crmAccess.expiresAt, 'd MMMM yyyy', ru, '—')}</b>
                                                    {crmAccess.daysRemaining !== null && (
                                                        <span className="text-green-600 ml-1">({crmAccess.daysRemaining} дн.)</span>
                                                    )}
                                                </span>
                                            </div>
                                        )}
                                        {!crmAccess.permanent && (
                                            <div className="flex flex-wrap gap-2 pt-2">
                                                <button
                                                    onClick={() => handleCrmApprove(30)}
                                                    disabled={crmActionLoading}
                                                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 text-sm font-semibold hover:bg-blue-100 disabled:opacity-50 transition-colors"
                                                >
                                                    {crmActionLoading ? <Loader2 size={14} className="animate-spin" /> : <CalendarClock size={14} />}
                                                    Продлить на 30 дней
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </Card>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                <div className="space-y-6">
                                    <UserTransactions email={user.email} />
                                    <UserTasks email={user.email} tasks={user.adminTasks || []} />
                                </div>

                                <Card className="overflow-hidden h-full flex flex-col">
                                    <div className="p-4 border-b border-unbox-light bg-unbox-light/30 flex items-center gap-2 font-medium">
                                        <History size={16} />
                                        История операций
                                    </div>
                                    <div className="flex-1 overflow-y-auto max-h-[400px]">
                                        {sortedBookings.length === 0 && (
                                            <div className="p-8 text-center text-unbox-grey text-sm">История пуста</div>
                                        )}
                                        {sortedBookings.map(item => (
                                            <div
                                                key={item.id}
                                                onClick={() => navigate(`/admin/bookings?search=${item.id}`)}
                                                className="p-4 border-b border-gray-50 hover:bg-unbox-light/30/50 flex items-center justify-between cursor-pointer group"
                                            >
                                                <div>
                                                    <div className="font-medium text-sm group-hover:text-unbox-green transition-colors">
                                                        {RESOURCES.find(r => r.id === item.resourceId)?.name || 'Кабинет'}
                                                    </div>
                                                    <div className="text-xs text-unbox-grey">
                                                        {safeFormat(item.date, 'd MMM yyyy', ru, '—')} · {item.startTime}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={clsx("font-bold text-sm", item.status === 'cancelled' ? 'text-unbox-grey line-through' : '')}>
                                                        -{item.finalPrice} ₾
                                                    </div>
                                                    <div className="text-[10px] text-unbox-grey uppercase">{item.status}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </Card>
                            </div>
                        </div>
                    )}

                    {/* Bookings Tab Content */}
                    {activeTab === 'bookings' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="flex items-center justify-between">
                                <h2 className="text-xl font-bold">История бронирований</h2>
                                <Button size="sm" onClick={() => {
                                    useBookingStore.getState().reset();
                                    useBookingStore.getState().setBookingForUser(user.email);
                                    useBookingStore.getState().setStep(2);
                                    navigate('/checkout');
                                }}>
                                    <Plus size={16} className="mr-2" />
                                    Создать бронь
                                </Button>
                            </div>
                            <UserBookingsTab
                                bookings={sortedBookings}
                                onCancel={handleCancelBooking}
                                onReschedule={handleRescheduleBooking}
                            />
                        </div>
                    )}

                    {/* Finance Tab Content (Extended) */}
                    {activeTab === 'finance' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <div className="flex justify-between items-center">
                                <h2 className="text-xl font-bold">Финансы и Статистика</h2>
                                <div className="flex gap-2">
                                    <Button size="sm" variant="outline" onClick={() => setIsAddFundsOpen(true)}>
                                        <Plus size={16} className="mr-2" />
                                        Пополнить
                                    </Button>
                                    <Button size="sm" variant="outline" onClick={() => setIsAssignSubOpen(true)}>
                                        <RotateCcw size={16} className="mr-2" />
                                        Абонемент
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {/* 1. Общая сумма оплат (Real Money In) */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-unbox-grey mb-1">Общая сумма оплат</div>
                                    <div className="text-2xl font-bold">
                                        {(() => {
                                            const userTransactions = useUserStore.getState().getTransactionsByUser(user.email);
                                            const realMoneyTransactions = userTransactions
                                                .filter(t => ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod))
                                                .reduce((sum, t) => sum + t.amount, 0);
                                            return realMoneyTransactions;
                                        })()} ₾
                                    </div>
                                    <div className="text-xs text-unbox-grey mt-1">Баланс: {user.balance} ₾</div>
                                    {/* Credit Limit UI */}
                                    <div
                                        className="text-xs text-unbox-grey mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                        onClick={() => setIsEditLimitOpen(true)}
                                    >
                                        Кредитный лимит:
                                        <span className="font-semibold text-unbox-grey border-b border-dashed border-unbox-light group-hover/limit:border-blue-400 group-hover/limit:text-unbox-green transition-colors">
                                            {user.creditLimit || 0} ₾
                                        </span>
                                        <div className="bg-unbox-light/50 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Всего забронировано часов */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-unbox-grey mb-1">Всего часов</div>
                                    <div className="text-2xl font-bold">
                                        {bookings
                                            .filter(b => b.userId === user.email && (b.status === 'completed' || b.status === 'confirmed'))
                                            .reduce((sum, b) => sum + (b.duration / 60), 0)
                                            .toFixed(1)} ч
                                    </div>
                                    <div className="text-xs text-unbox-grey mt-1">
                                        {sortedBookings.length} бронирований
                                    </div>
                                </div>

                                {/* 3. Средний чек */}
                                <div className="bg-white rounded-xl p-4 border border-unbox-light shadow-sm">
                                    <div className="text-sm text-unbox-grey mb-1">Средний чек</div>
                                    <div className="text-2xl font-bold">
                                        {(() => {
                                            const completed = bookings.filter(b => b.userId === user.email && b.status === 'completed');
                                            if (completed.length === 0) return '0';
                                            const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                            return (totalValue / completed.length).toFixed(0);
                                        })()} ₾
                                    </div>
                                    <div className="text-xs text-unbox-grey mt-1">за посещение</div>
                                </div>
                            </div>

                            <Card className="overflow-hidden">
                                <div className="p-4 border-b border-unbox-light bg-unbox-light/30 font-medium">
                                    История транзакций
                                </div>
                                <div className="p-4">
                                    <UserTransactions email={user.email} />
                                </div>
                            </Card>
                        </div>
                    )}

                    {/* Timeline Tab Content */}
                    {activeTab === 'timeline' && (
                        <ClientTimeline
                            user={user}
                            transactions={useUserStore.getState().getTransactionsByUser(user.email)}
                            bookings={bookings.filter(b => b.userId === user.email)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
