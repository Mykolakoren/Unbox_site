import { useParams, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Mail, Phone, CreditCard, Shield, ArrowLeft, Plus, History, RotateCcw, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useState } from 'react';
import { toast } from 'sonner';
import clsx from 'clsx';
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

import { AddFundsModal } from '../../components/admin/modals/AddFundsModal';
import { AssignSubscriptionModal } from '../../components/admin/modals/AssignSubscriptionModal';
import { EditCreditLimitModal } from '../../components/admin/modals/EditCreditLimitModal';

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
    const [activeTab, setActiveTab] = useState<'overview' | 'bookings' | 'finance' | 'timeline'>('overview');
    // Let's keep 'overview' default but I will change it in the replacement to 'timeline' to show it off immediately, or maybe 'overview' is safer. Let's use 'overview' but add 'timeline' to type.

    if (!user) {
        return <div className="p-8 text-center">Клиент не найден</div>;
    }

    // derived data
    const sortedBookings = bookings
        .filter(b => b.userId === user.email)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());



    const handleAddFunds = (amount: number, method: 'cash' | 'tbc' | 'bog') => {
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

        const newSubscription = {
            id: crypto.randomUUID(),
            name: plan.name,
            totalHours: plan.hours,
            remainingHours: plan.hours,
            freeReschedules: 2, // default
            expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // +30 days
            isFrozen: false
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

    const handleRescheduleBooking = (id: string) => {
        navigate(`/admin/bookings?reschedule=${id}`);
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
        sleeping: { label: 'Спящий', color: 'text-unbox-grey', bg: 'bg-gray-50' },
        vip: { label: 'VIP', color: 'text-white', bg: 'bg-unbox-dark' }, // Special status
        partner: { label: 'Партнёр', color: 'text-unbox-dark', bg: 'bg-unbox-light' },
        bad_client: { label: 'Проблемный', color: 'text-unbox-dark', bg: 'bg-gray-200' },
    };

    const currentStatusConfig = STATUS_CONFIG[clientStatus] || STATUS_CONFIG.new;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
            {/* ... Modals ... */}
            <AddFundsModal
                isOpen={isAddFundsOpen}
                onClose={() => setIsAddFundsOpen(false)}
                onConfirm={handleAddFunds}
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
            <div className="flex items-center gap-4">
                <button
                    onClick={() => navigate('/admin/users')}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            {user.name}

                            {/* Role Badge / Selector */}
                            <div className="relative group/role">
                                <div
                                    className={clsx(
                                        "flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold uppercase cursor-pointer transition-colors",
                                        (user.role === 'owner' || user.isAdmin) ? "bg-blue-100 text-blue-700 hover:bg-blue-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                                    )}
                                    title="Нажмите чтобы изменить роль"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // Simple prompt for now - ideally a dropdown
                                        if (currentUser?.role === 'owner' || true) { // Allow for demo/MVP
                                            const newRole = prompt(`Текущая роль: ${user.role || (user.isAdmin ? 'admin' : 'user')}\nВведите новую роль (owner, senior_admin, admin) или пусто для сброса:`);
                                            if (newRole !== null) {
                                                const validRoles = ['owner', 'senior_admin', 'admin'];
                                                if (newRole === '' || validRoles.includes(newRole)) {
                                                    updateUserById(user.email, {
                                                        role: newRole as any,
                                                        isAdmin: !!newRole // Sync isAdmin for legacy
                                                    });
                                                    toast.success('Роль обновлена');
                                                } else {
                                                    toast.error('Некорректная роль');
                                                }
                                            }
                                        }
                                    }}
                                >
                                    <Shield size={14} />
                                    {user.role === 'owner' ? 'OWNER' :
                                        user.role === 'senior_admin' ? 'SENIOR' :
                                            (user.role === 'admin' || user.isAdmin) ? 'ADMIN' : 'USER'}
                                </div>
                            </div>
                        </h1>
                        <div className="relative">
                            <button
                                onClick={() => setIsStatusDropdownOpen(!isStatusDropdownOpen)}
                                className={clsx("px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider cursor-pointer border border-transparent hover:border-black/10 transition-colors focus:outline-none flex items-center gap-1", currentStatusConfig.bg, currentStatusConfig.color)}
                            >
                                {currentStatusConfig.label}
                                <ChevronDown size={12} className={clsx("transition-transform", isStatusDropdownOpen ? "rotate-180" : "")} />
                            </button>

                            {/* Status Dropdown */}
                            {isStatusDropdownOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIsStatusDropdownOpen(false)} />
                                    <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-200">
                                        <div className="p-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Изменить статус</div>
                                        <button
                                            onClick={() => {
                                                updateUserById(user.email, { manualStatus: undefined });
                                                setIsStatusDropdownOpen(false);
                                            }}
                                            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center justify-between group/item"
                                        >
                                            <span>Автоматически</span>
                                            {!user.manualStatus && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                                        </button>
                                        <div className="h-px bg-gray-100 my-1" />
                                        {['vip', 'partner', 'bad_client'].map(status => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    updateUserById(user.email, { manualStatus: status as any });
                                                    setIsStatusDropdownOpen(false);
                                                }}
                                                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center justify-between"
                                            >
                                                <span className={STATUS_CONFIG[status].color}>{STATUS_CONFIG[status].label}</span>
                                                {user.manualStatus === status && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                    <div className="text-sm text-gray-500">
                        Участник с {user.registrationDate ? format(new Date(user.registrationDate), 'd MMMM yyyy', { locale: ru }) : 'неизвестной даты'}
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={clsx("px-4 py-2 text-sm font-medium border-b-2 transition-colors", activeTab === 'overview' ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black")}
                >
                    Обзор
                </button>
                <button
                    onClick={() => setActiveTab('bookings')}
                    className={clsx("px-4 py-2 text-sm font-medium border-b-2 transition-colors", activeTab === 'bookings' ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black")}
                >
                    Бронирования
                </button>
                <button
                    onClick={() => setActiveTab('finance')}
                    className={clsx("px-4 py-2 text-sm font-medium border-b-2 transition-colors", activeTab === 'finance' ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black")}
                >
                    Финансы
                </button>
                <button
                    onClick={() => setActiveTab('timeline')}
                    className={clsx("px-4 py-2 text-sm font-medium border-b-2 transition-colors", activeTab === 'timeline' ? "border-black text-black" : "border-transparent text-gray-500 hover:text-black")}
                >
                    История событий
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Profile & Info */}
                <div className="space-y-6">
                    {/* Main Info Card */}
                    <Card className="p-6">
                        <div className="flex flex-col items-center text-center mb-6">
                            <div className="relative group">
                                <div className="w-24 h-24 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center text-3xl font-bold text-gray-600 mb-4 border-2 border-transparent group-hover:border-gray-200 transition-all">
                                    {user.avatarUrl ? (
                                        <img src={user.avatarUrl} alt={user.name} className="w-full h-full object-cover" />
                                    ) : (
                                        user.name.charAt(0).toUpperCase()
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
                                    user.level === 'loyal' ? 'bg-blue-100 text-blue-700' :
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
                                <div className="text-gray-400"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-send"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg></div>
                                <span className={user.telegramId ? 'text-gray-900' : 'text-gray-400 dashed underline'}>
                                    {user.telegramId || 'Telegram ID не указан'}
                                </span>
                                <span className="opacity-0 group-hover/tg:opacity-100 text-xs text-blue-500">Изменить</span>
                            </div>

                            {/* Profession Field */}
                            <div className="pt-2 border-t border-gray-50">
                                <div className="text-xs text-gray-400 mb-1">Профессия</div>
                                <ProfessionEditor
                                    value={user.profession}
                                    onChange={(val) => updateUserById(user.email, { profession: val })}
                                />
                            </div>

                            {/* Target Audience Field */}
                            <div className="pt-2 border-t border-gray-50">
                                <div className="text-xs text-gray-400 mb-1">Работает с</div>
                                <TargetAudienceEditor
                                    value={user.targetAudience}
                                    onChange={(val) => updateUserById(user.email, { targetAudience: val })}
                                />
                            </div>
                        </div>

                        <div className="border-t border-gray-100 my-4 pt-4 space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-500">Первый визит</span>
                                <span className="font-medium text-gray-900">
                                    {firstBookingDate ? format(new Date(firstBookingDate), 'd MMM yyyy', { locale: ru }) : '—'}
                                </span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-500">Последний визит</span>
                                <span className="font-medium text-gray-900">
                                    {lastVisitDate ? format(new Date(lastVisitDate), 'd MMM yyyy', { locale: ru }) : '—'}
                                </span>
                            </div>
                        </div>
                    </Card>

                    {/* Contacts */}
                    <UserContacts email={user.email} contacts={user.additionalContacts || []} />



                    {/* Tags */}
                    <UserTags email={user.email} tags={user.tags || []} />

                    {/* Comments & Notes */}
                    <UserComments email={user.email} />
                </div>

                {/* Middle Column: Finances & Subscription & Tabs */}
                <div className="space-y-6 lg:col-span-2">
                    {/* Overview Tab Content */}
                    {activeTab === 'overview' && (
                        <div className="space-y-6 animate-in fade-in duration-300">
                            <Card className="p-6">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="font-bold text-lg flex items-center gap-2">
                                        <CreditCard size={20} className="text-gray-400" />
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
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-sm text-gray-500 mb-1">Общая сумма оплат</div>
                                        <div className="text-2xl font-bold">
                                            {(() => {
                                                const userTransactions = useUserStore.getState().getTransactionsByUser(user.email);
                                                const realMoneyTransactions = userTransactions
                                                    .filter(t => ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod))
                                                    .reduce((sum, t) => sum + t.amount, 0);
                                                return realMoneyTransactions;
                                            })()} ₾
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">Баланс: {user.balance} ₾</div>
                                        {/* Credit Limit UI */}
                                        <div
                                            className="text-xs text-gray-400 mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                            onClick={() => setIsEditLimitOpen(true)}
                                        >
                                            Кредитный лимит:
                                            <span className="font-semibold text-gray-600 border-b border-dashed border-gray-300 group-hover/limit:border-blue-400 group-hover/limit:text-blue-600 transition-colors">
                                                {user.creditLimit || 0} ₾
                                            </span>
                                            <div className="bg-gray-100 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 2. Всего забронировано часов */}
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-sm text-gray-500 mb-1">Всего часов</div>
                                        <div className="text-2xl font-bold">
                                            {bookings
                                                .filter(b => b.userId === user.email && (b.status === 'completed' || b.status === 'confirmed'))
                                                .reduce((sum, b) => sum + (b.duration / 60), 0)
                                                .toFixed(1)} ч
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">
                                            {sortedBookings.length} бронирований
                                        </div>
                                    </div>

                                    {/* 3. Средний чек */}
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-sm text-gray-500 mb-1">Средний чек</div>
                                        <div className="text-2xl font-bold">
                                            {(() => {
                                                const completed = bookings.filter(b => b.userId === user.email && b.status === 'completed');
                                                if (completed.length === 0) return '0';
                                                const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                                return (totalValue / completed.length).toFixed(0);
                                            })()} ₾
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">за посещение</div>
                                    </div>

                                    {/* 5. Активный абонемент */}
                                    <div className={clsx("rounded-xl p-4 border relative overflow-hidden col-span-1 md:col-span-2 lg:col-span-3", user.subscription ? "bg-purple-50 border-purple-100" : "bg-gray-50 border-gray-100")}>
                                        <div className="relative z-10 flex justify-between items-start">
                                            <div>
                                                <div className="text-sm text-gray-500 mb-1">Активный абонемент</div>
                                                {user.subscription ? (
                                                    <>
                                                        <div className="text-xl font-bold text-purple-900 mb-1">{user.subscription.name}</div>
                                                        <div className="text-sm text-purple-700 font-mono">
                                                            Остаток: <b>{user.subscription.remainingHours}</b> / {user.subscription.totalHours} ч
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-gray-400 italic">Отсутствует</div>
                                                )}
                                            </div>
                                            {user.subscription && (
                                                <div className="text-right">
                                                    <div className={clsx("px-2 py-0.5 rounded text-[10px] font-bold uppercase mb-2 inline-block", user.subscription.isFrozen ? "bg-blue-200 text-blue-800" : "bg-green-200 text-green-800")}>
                                                        {user.subscription.isFrozen ? 'Заморожен' : 'Активен'}
                                                    </div>
                                                    <div className="text-xs text-purple-600">
                                                        до {format(new Date(user.subscription.expiryDate), 'd.MM.yyyy')}
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
                                    </div>
                                </div>
                            </Card>

                            {/* Loyalty System (New) */}
                            <UserLoyaltyCard email={user.email} />

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                                <div className="space-y-6">
                                    <UserTransactions email={user.email} />
                                    <UserTasks email={user.email} tasks={user.adminTasks || []} />
                                </div>

                                <Card className="overflow-hidden h-full flex flex-col">
                                    <div className="p-4 border-b border-gray-100 bg-gray-50 flex items-center gap-2 font-medium">
                                        <History size={16} />
                                        История операций
                                    </div>
                                    <div className="flex-1 overflow-y-auto max-h-[400px]">
                                        {sortedBookings.length === 0 && (
                                            <div className="p-8 text-center text-gray-400 text-sm">История пуста</div>
                                        )}
                                        {sortedBookings.map(item => (
                                            <div
                                                key={item.id}
                                                onClick={() => navigate(`/admin/bookings?search=${item.id}`)}
                                                className="p-4 border-b border-gray-50 hover:bg-gray-50/50 flex items-center justify-between cursor-pointer group"
                                            >
                                                <div>
                                                    <div className="font-medium text-sm group-hover:text-blue-600 transition-colors">
                                                        {RESOURCES.find(r => r.id === item.resourceId)?.name || 'Кабинет'}
                                                    </div>
                                                    <div className="text-xs text-gray-500">
                                                        {format(new Date(item.date), 'd MMM yyyy', { locale: ru })} · {item.startTime}
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <div className={clsx("font-bold text-sm", item.status === 'cancelled' ? 'text-gray-400 line-through' : '')}>
                                                        -{item.finalPrice} ₾
                                                    </div>
                                                    <div className="text-[10px] text-gray-400 uppercase">{item.status}</div>
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
                                    useBookingStore.getState().setBookingForUser(user.email); // Setting target user
                                    navigate('/');
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
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                                    <div className="text-sm text-gray-500 mb-1">Общая сумма оплат</div>
                                    <div className="text-2xl font-bold">
                                        {(() => {
                                            const userTransactions = useUserStore.getState().getTransactionsByUser(user.email);
                                            const realMoneyTransactions = userTransactions
                                                .filter(t => ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod))
                                                .reduce((sum, t) => sum + t.amount, 0);
                                            return realMoneyTransactions;
                                        })()} ₾
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1">Баланс: {user.balance} ₾</div>
                                    {/* Credit Limit UI */}
                                    <div
                                        className="text-xs text-gray-400 mt-1 flex items-center gap-1 group/limit cursor-pointer"
                                        onClick={() => setIsEditLimitOpen(true)}
                                    >
                                        Кредитный лимит:
                                        <span className="font-semibold text-gray-600 border-b border-dashed border-gray-300 group-hover/limit:border-blue-400 group-hover/limit:text-blue-600 transition-colors">
                                            {user.creditLimit || 0} ₾
                                        </span>
                                        <div className="bg-gray-100 p-0.5 rounded opacity-0 group-hover/limit:opacity-100 transition-opacity">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* 2. Всего забронировано часов */}
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                                    <div className="text-sm text-gray-500 mb-1">Всего часов</div>
                                    <div className="text-2xl font-bold">
                                        {bookings
                                            .filter(b => b.userId === user.email && (b.status === 'completed' || b.status === 'confirmed'))
                                            .reduce((sum, b) => sum + (b.duration / 60), 0)
                                            .toFixed(1)} ч
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1">
                                        {sortedBookings.length} бронирований
                                    </div>
                                </div>

                                {/* 3. Средний чек */}
                                <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
                                    <div className="text-sm text-gray-500 mb-1">Средний чек</div>
                                    <div className="text-2xl font-bold">
                                        {(() => {
                                            const completed = bookings.filter(b => b.userId === user.email && b.status === 'completed');
                                            if (completed.length === 0) return '0';
                                            const totalValue = completed.reduce((sum, b) => sum + b.finalPrice, 0);
                                            return (totalValue / completed.length).toFixed(0);
                                        })()} ₾
                                    </div>
                                    <div className="text-xs text-gray-400 mt-1">за посещение</div>
                                </div>
                            </div>

                            <Card className="overflow-hidden">
                                <div className="p-4 border-b border-gray-100 bg-gray-50 font-medium">
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
