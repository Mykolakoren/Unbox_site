import { useUserStore } from '../../store/userStore';
import { useNavigate } from 'react-router-dom';
import {
    Users,
    AlertTriangle,
    UserPlus,
    ChevronRight,
    Zap,
    DollarSign,
    CalendarCheck,
    Search,
    GripVertical,
    UserCheck,
    UserCircle,
    X,
} from 'lucide-react';
import { subDays, isAfter } from 'date-fns';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { User } from '../../store/types';

type PipelineStage = 'new' | 'active' | 'sleeping' | 'vip' | 'partner' | 'bad_client';

const STAGE_CONFIG: Record<PipelineStage, { label: string; color: string; bg: string; border: string; dragOver: string }> = {
    new:       { label: 'Новые',      color: 'text-emerald-700', bg: 'bg-emerald-50',    border: 'border-emerald-200', dragOver: 'bg-emerald-100 ring-2 ring-emerald-400' },
    active:    { label: 'Активные',   color: 'text-blue-700',    bg: 'bg-blue-50',       border: 'border-blue-200',    dragOver: 'bg-blue-100 ring-2 ring-blue-400' },
    vip:       { label: 'VIP',        color: 'text-purple-700',  bg: 'bg-purple-50',     border: 'border-purple-200',  dragOver: 'bg-purple-100 ring-2 ring-purple-400' },
    partner:   { label: 'Партнёры',   color: 'text-amber-700',   bg: 'bg-amber-50',      border: 'border-amber-200',   dragOver: 'bg-amber-100 ring-2 ring-amber-400' },
    sleeping:  { label: 'Спящие',     color: 'text-unbox-grey',  bg: 'bg-unbox-light/30', border: 'border-unbox-light', dragOver: 'bg-gray-100 ring-2 ring-gray-400' },
    bad_client:{ label: 'Проблемные', color: 'text-red-700',     bg: 'bg-red-50',        border: 'border-red-200',     dragOver: 'bg-red-100 ring-2 ring-red-400' },
};

const ADMIN_ROLES = ['owner', 'senior_admin', 'admin'];

// Admin picker modal
interface AdminPickerState {
    user: User;
    type: 'responsible' | 'attracted';
}

export function AdminCrm() {
    const { users, bookings, transactions, updateUserById } = useUserStore();
    const navigate = useNavigate();
    const [searchQuery, setSearchQuery] = useState('');

    // DnD state
    const [draggingEmail, setDraggingEmail] = useState<string | null>(null);
    const [dragOverStage, setDragOverStage] = useState<PipelineStage | null>(null);

    // Optimistic stage overrides: email → staged PipelineStage (before API confirms)
    const [optimisticStages, setOptimisticStages] = useState<Map<string, PipelineStage>>(new Map());

    // Admin picker modal
    const [adminPicker, setAdminPicker] = useState<AdminPickerState | null>(null);

    // All admin users (for assignment)
    const adminUsers = useMemo(
        () => users.filter(u => u.role && ADMIN_ROLES.includes(u.role)),
        [users]
    );

    // Map admin id → user for quick lookup
    const adminMap = useMemo(() => {
        const m = new Map<string, User>();
        adminUsers.forEach(a => { m.set(a.id, a); });
        return m;
    }, [adminUsers]);

    // ── Analytics ─────────────────────────────────────────────────────────────
    const analytics = useMemo(() => {
        const now = new Date();
        const thirtyDaysAgo = subDays(now, 30);
        const fortyFiveDaysAgo = subDays(now, 45);

        const clientStages = new Map<string, PipelineStage>();
        users.forEach((user) => {
            if (user.role && ADMIN_ROLES.includes(user.role)) return;

            // Backend manual_status takes precedence
            if (user.manualStatus) {
                clientStages.set(user.email, user.manualStatus as PipelineStage);
                return;
            }

            const userBookings = bookings.filter((b) => b.userId === user.email);
            const completedBookings = userBookings.filter((b) => b.status === 'completed');
            const lastVisit = completedBookings.length > 0
                ? new Date(completedBookings.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date)
                : null;

            if (userBookings.length === 0) {
                const regDate = user.registrationDate ? new Date(user.registrationDate) : now;
                clientStages.set(user.email, isAfter(regDate, thirtyDaysAgo) ? 'new' : 'sleeping');
            } else if (lastVisit && isAfter(lastVisit, fortyFiveDaysAgo)) {
                clientStages.set(user.email, 'active');
            } else {
                clientStages.set(user.email, 'sleeping');
            }
        });

        const stageCounts: Record<PipelineStage, number> = {
            new: 0, active: 0, sleeping: 0, vip: 0, partner: 0, bad_client: 0,
        };
        clientStages.forEach((stage) => { stageCounts[stage]++; });

        const recentTransactions = transactions.filter(
            (t) => isAfter(new Date(t.date), thirtyDaysAgo) && ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod)
        );
        const monthlyRevenue = recentTransactions.reduce((sum, t) => sum + t.amount, 0);

        const recentBookings = bookings.filter((b) => isAfter(new Date(b.date), thirtyDaysAgo));

        return {
            clientStages,
            stageCounts,
            monthlyRevenue,
            totalBookings: recentBookings.length,
            cancelledBookings: recentBookings.filter((b) => b.status === 'cancelled').length,
            newClients: users.filter(
                (u) => u.registrationDate && isAfter(new Date(u.registrationDate), thirtyDaysAgo)
                    && !(u.role && ADMIN_ROLES.includes(u.role))
            ).length,
            activeSubscriptions: users.filter(
                (u) => u.subscription && !u.subscription.isFrozen && isAfter(new Date(u.subscription.expiryDate), now)
            ).length,
            debtors: users.filter((u) => u.balance < 0),
            totalClients: users.filter((u) => !(u.role && ADMIN_ROLES.includes(u.role))).length,
        };
    }, [users, bookings, transactions]);

    // Effective stages: optimistic overrides take priority over analytics
    const effectiveStages = useMemo(() => {
        const result = new Map<string, PipelineStage>(analytics.clientStages);
        optimisticStages.forEach((stage, email) => result.set(email, stage));
        return result;
    }, [analytics.clientStages, optimisticStages]);

    // Pipeline columns
    const pipeline = useMemo(() => {
        const stages: PipelineStage[] = ['new', 'active', 'vip', 'partner', 'sleeping', 'bad_client'];
        return stages.map((stage) => ({
            stage,
            clients: users.filter((u) => {
                if (u.role && ADMIN_ROLES.includes(u.role)) return false;
                if (effectiveStages.get(u.email) !== stage) return false;
                if (searchQuery) {
                    const q = searchQuery.toLowerCase();
                    return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.phone?.toLowerCase().includes(q) ?? false);
                }
                return true;
            }),
        }));
    }, [users, effectiveStages, searchQuery]);

    // ── Drag & Drop ───────────────────────────────────────────────────────────

    const handleDragStart = (e: React.DragEvent, userEmail: string) => {
        e.dataTransfer.setData('text/plain', userEmail);
        e.dataTransfer.effectAllowed = 'move';
        setDraggingEmail(userEmail);
    };

    const handleDragEnd = () => {
        setDraggingEmail(null);
        setDragOverStage(null);
    };

    const handleDragOver = (e: React.DragEvent, stage: PipelineStage) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverStage(stage);
    };

    const handleDrop = async (e: React.DragEvent, targetStage: PipelineStage) => {
        e.preventDefault();
        const email = e.dataTransfer.getData('text/plain');
        setDraggingEmail(null);
        setDragOverStage(null);
        if (!email) return;
        const user = users.find(u => u.email === email);
        if (!user) return;
        const currentStage = effectiveStages.get(email);
        if (currentStage === targetStage) return;

        // Optimistic update: move card immediately
        setOptimisticStages(prev => new Map(prev).set(email, targetStage));

        try {
            await updateUserById(user.id, { manualStatus: targetStage } as any);
        } catch {
            // Revert on error
            setOptimisticStages(prev => {
                const next = new Map(prev);
                next.delete(email);
                return next;
            });
        } finally {
            // Clean up optimistic override after store is updated
            setOptimisticStages(prev => {
                const next = new Map(prev);
                next.delete(email);
                return next;
            });
        }
    };

    // ── Admin assignment ──────────────────────────────────────────────────────

    const handleAssignAdmin = async (adminId: string | null) => {
        if (!adminPicker) return;
        const { user, type } = adminPicker;
        const update = type === 'responsible'
            ? { responsibleAdminId: adminId }
            : { attractedByAdminId: adminId };
        setAdminPicker(null);
        await updateUserById(user.id, update as any);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold">CRM Аналитика</h1>
                <p className="text-unbox-grey text-sm">Управление клиентами и статистика за 30 дней</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <KpiCard icon={Users}        label="Всего клиентов" value={analytics.totalClients}          color="blue" />
                <KpiCard icon={UserPlus}     label="Новых за месяц" value={analytics.newClients}            color="green" />
                <KpiCard icon={DollarSign}   label="Доход за месяц" value={`${analytics.monthlyRevenue.toFixed(0)} ₾`} color="emerald" />
                <KpiCard icon={CalendarCheck} label="Бронирований"  value={analytics.totalBookings}         color="indigo" subtitle={`${analytics.cancelledBookings} отмен`} />
                <KpiCard icon={Zap}          label="Абонементов"   value={analytics.activeSubscriptions}   color="purple" />
                <KpiCard icon={AlertTriangle} label="Должников"    value={analytics.debtors.length}         color={analytics.debtors.length > 0 ? 'red' : 'gray'} />
            </div>

            {/* Search */}
            <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-unbox-grey" />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Поиск клиента..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    />
                </div>
                <div className="text-sm text-unbox-grey hidden md:block">
                    Перетащите карточку чтобы сменить статус
                </div>
            </div>

            {/* Pipeline Kanban */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {pipeline.map(({ stage, clients: stageClients }) => {
                    const config = STAGE_CONFIG[stage];
                    const isOver = dragOverStage === stage;
                    return (
                        <div
                            key={stage}
                            onDragOver={(e) => handleDragOver(e, stage)}
                            onDragLeave={(e) => {
                                // Only clear when truly leaving the column (not entering a child)
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    setDragOverStage(null);
                                }
                            }}
                            onDrop={(e) => handleDrop(e, stage)}
                            className={clsx(
                                'rounded-2xl border overflow-hidden transition-all duration-150',
                                isOver ? config.dragOver : `${config.border} ${config.bg}`
                            )}
                        >
                            {/* Column header */}
                            <div className="p-3 border-b border-white/50">
                                <div className="flex items-center justify-between">
                                    <span className={`text-sm font-bold ${config.color}`}>{config.label}</span>
                                    <span className="text-xs font-mono text-unbox-grey bg-white/60 px-1.5 py-0.5 rounded">
                                        {stageClients.length}
                                    </span>
                                </div>
                            </div>

                            {/* Cards */}
                            <div className="p-2 space-y-1.5 max-h-[420px] overflow-y-auto custom-scrollbar">
                                {stageClients.length === 0 ? (
                                    <div className={clsx(
                                        'text-xs text-unbox-grey text-center py-6 rounded-xl border-2 border-dashed transition-colors',
                                        isOver ? 'border-current opacity-60' : 'border-transparent'
                                    )}>
                                        {isOver ? '↓ Отпустите' : 'Нет клиентов'}
                                    </div>
                                ) : (
                                    stageClients.slice(0, 15).map((user) => (
                                        <ClientCard
                                            key={user.email}
                                            user={user}
                                            isDragging={draggingEmail === user.email}
                                            adminMap={adminMap}
                                            onNavigate={() => navigate(`/admin/users/${encodeURIComponent(user.email)}`)}
                                            onDragStart={(e) => handleDragStart(e, user.email)}
                                            onDragEnd={handleDragEnd}
                                            onOpenAdminPicker={(type) => setAdminPicker({ user, type })}
                                        />
                                    ))
                                )}
                                {stageClients.length > 15 && (
                                    <div className="text-xs text-unbox-grey text-center py-2">
                                        +{stageClients.length - 15} ещё
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Debtors */}
            {analytics.debtors.length > 0 && (
                <div className="bg-white rounded-2xl border border-red-200 shadow-sm">
                    <div className="p-5 border-b border-red-100 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5 text-red-500" />
                        <h2 className="font-bold text-lg">Клиенты с задолженностью</h2>
                    </div>
                    <div className="divide-y divide-gray-50">
                        {analytics.debtors
                            .sort((a, b) => a.balance - b.balance)
                            .map((debtor) => (
                                <div
                                    key={debtor.email}
                                    className="flex items-center justify-between px-5 py-3.5 hover:bg-unbox-light/30 cursor-pointer transition-colors"
                                    onClick={() => navigate(`/admin/users/${encodeURIComponent(debtor.email)}`)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-red-50 text-red-600 flex items-center justify-center text-sm font-bold">
                                            {debtor.name[0]}
                                        </div>
                                        <div>
                                            <div className="font-medium text-unbox-dark text-sm">{debtor.name}</div>
                                            <div className="text-xs text-unbox-grey">{debtor.email}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-lg font-bold text-red-600">{debtor.balance.toFixed(0)} ₾</span>
                                        <ChevronRight className="w-4 h-4 text-gray-300" />
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}

            {/* Admin Picker Modal */}
            {adminPicker && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center"
                    onClick={() => setAdminPicker(null)}
                >
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
                    <div
                        className="relative bg-white rounded-2xl shadow-2xl w-72 p-5 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <div>
                                <h3 className="font-bold text-unbox-dark">
                                    {adminPicker.type === 'responsible' ? 'Ответственный менеджер' : 'Кто привлёк клиента'}
                                </h3>
                                <p className="text-xs text-unbox-grey mt-0.5">{adminPicker.user.name}</p>
                            </div>
                            <button onClick={() => setAdminPicker(null)} className="p-1 rounded-lg hover:bg-unbox-light text-unbox-grey">
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-1">
                            {/* Clear option */}
                            <button
                                onClick={() => handleAssignAdmin(null)}
                                className={clsx(
                                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                    (() => {
                                        const current = adminPicker.type === 'responsible'
                                            ? adminPicker.user.responsibleAdminId
                                            : adminPicker.user.attractedByAdminId;
                                        return !current
                                            ? 'bg-unbox-light text-unbox-dark font-medium'
                                            : 'text-unbox-grey hover:bg-unbox-light/50';
                                    })()
                                )}
                            >
                                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                                    <UserCircle size={16} className="text-gray-400" />
                                </div>
                                Не назначен
                            </button>

                            {/* Admin list */}
                            {adminUsers.map((admin) => {
                                const current = adminPicker.type === 'responsible'
                                    ? adminPicker.user.responsibleAdminId
                                    : adminPicker.user.attractedByAdminId;
                                const isSelected = current === admin.id;
                                return (
                                    <button
                                        key={admin.id}
                                        onClick={() => handleAssignAdmin(admin.id)}
                                        className={clsx(
                                            'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors text-left',
                                            isSelected
                                                ? 'bg-unbox-green text-white font-medium'
                                                : 'text-unbox-dark hover:bg-unbox-light/50'
                                        )}
                                    >
                                        <div className={clsx(
                                            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                                            isSelected ? 'bg-white/20 text-white' : 'bg-unbox-dark text-white'
                                        )}>
                                            {admin.name[0].toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
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
        </div>
    );
}

// ── Client Card ───────────────────────────────────────────────────────────────

interface ClientCardProps {
    user: User;
    isDragging: boolean;
    adminMap: Map<string, User>;
    onNavigate: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onOpenAdminPicker: (type: 'responsible' | 'attracted') => void;
}

function ClientCard({ user, isDragging, adminMap, onNavigate, onDragStart, onDragEnd, onOpenAdminPicker }: ClientCardProps) {
    const responsible = user.responsibleAdminId ? adminMap.get(user.responsibleAdminId) : null;
    const attracted   = user.attractedByAdminId  ? adminMap.get(user.attractedByAdminId)  : null;

    return (
        <div
            draggable={true}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onNavigate}
            className={clsx(
                'bg-white rounded-xl shadow-sm border border-unbox-light cursor-pointer hover:shadow-md hover:border-unbox-green/30 transition-all group select-none overflow-hidden',
                isDragging && 'opacity-40 ring-2 ring-unbox-green scale-95'
            )}
        >
            {/* Main body */}
            <div className="p-2.5">
                {/* Top row: drag handle + avatar + name */}
                <div className="flex items-center gap-1.5">
                    <GripVertical size={14} className="text-gray-300 group-hover:text-gray-400 shrink-0 cursor-grab active:cursor-grabbing" />
                    <div className="w-7 h-7 rounded-full bg-unbox-light/70 flex items-center justify-center text-xs font-bold text-unbox-grey shrink-0">
                        {user.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-unbox-dark truncate group-hover:text-unbox-green transition-colors">
                            {user.name}
                        </div>
                        <div className="text-[10px] text-unbox-grey truncate">
                            {user.phone || user.email}
                        </div>
                    </div>
                </div>

                {/* Balance */}
                {user.balance !== 0 && (
                    <div className={clsx('text-[10px] font-medium mt-1.5 pl-1', user.balance < 0 ? 'text-red-500' : 'text-green-600')}>
                        Баланс: {user.balance.toFixed(0)} ₾
                    </div>
                )}
            </div>

            {/* Admin rows — separated by a top border */}
            <div className="border-t border-unbox-light/60 divide-y divide-unbox-light/40" onClick={(e) => e.stopPropagation()}>
                {/* Responsible */}
                <button
                    title={responsible ? `Изменить ответственного` : 'Назначить ответственного'}
                    onClick={(e) => { e.stopPropagation(); onOpenAdminPicker('responsible'); }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-unbox-light/40 transition-colors text-left"
                >
                    <span className="text-[9px] text-unbox-grey shrink-0 w-7">Отв.</span>
                    {responsible ? (
                        <>
                            <div className="w-4 h-4 rounded-full bg-unbox-green flex items-center justify-center text-[8px] font-bold text-white shrink-0">
                                {responsible.name[0].toUpperCase()}
                            </div>
                            <span className="text-[10px] font-medium text-unbox-dark truncate flex-1">
                                {responsible.name}
                            </span>
                        </>
                    ) : (
                        <span className="text-[10px] text-gray-400 italic flex-1">не назначен</span>
                    )}
                    <span className="text-[9px] text-gray-300 shrink-0">✎</span>
                </button>

                {/* Attracted */}
                <button
                    title={attracted ? `Изменить кто привлёк` : 'Указать кто привлёк'}
                    onClick={(e) => { e.stopPropagation(); onOpenAdminPicker('attracted'); }}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-unbox-light/40 transition-colors text-left"
                >
                    <span className="text-[9px] text-unbox-grey shrink-0 w-7">Привл.</span>
                    {attracted ? (
                        <>
                            <div className="w-4 h-4 rounded-full bg-amber-400 flex items-center justify-center text-[8px] font-bold text-white shrink-0">
                                {attracted.name[0].toUpperCase()}
                            </div>
                            <span className="text-[10px] font-medium text-unbox-dark truncate flex-1">
                                {attracted.name}
                            </span>
                        </>
                    ) : (
                        <span className="text-[10px] text-gray-400 italic flex-1">не указан</span>
                    )}
                    <span className="text-[9px] text-gray-300 shrink-0">✎</span>
                </button>
            </div>
        </div>
    );
}

// ── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
    icon: Icon,
    label,
    value,
    color,
    subtitle,
}: {
    icon: React.ElementType;
    label: string;
    value: number | string;
    color: string;
    subtitle?: string;
}) {
    const colorClasses: Record<string, { bg: string; icon: string; text: string }> = {
        blue:    { bg: 'bg-unbox-light',    icon: 'text-unbox-green', text: 'text-unbox-dark' },
        green:   { bg: 'bg-unbox-light',    icon: 'text-unbox-green', text: 'text-unbox-green' },
        emerald: { bg: 'bg-unbox-light',    icon: 'text-unbox-green', text: 'text-unbox-dark' },
        indigo:  { bg: 'bg-unbox-light',    icon: 'text-unbox-dark',  text: 'text-unbox-dark' },
        purple:  { bg: 'bg-unbox-dark/10',  icon: 'text-unbox-dark',  text: 'text-unbox-dark' },
        red:     { bg: 'bg-red-50',         icon: 'text-red-500',     text: 'text-red-600' },
        gray:    { bg: 'bg-unbox-light/30', icon: 'text-unbox-grey',  text: 'text-unbox-grey' },
    };
    const c = colorClasses[color] || colorClasses.gray;

    return (
        <div className="bg-white rounded-xl border border-unbox-light shadow-sm p-4">
            <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center mb-2`}>
                <Icon className={`w-4 h-4 ${c.icon}`} />
            </div>
            <div className={`text-xl font-bold ${c.text}`}>{value}</div>
            <div className="text-xs text-unbox-grey">{label}</div>
            {subtitle && <div className="text-[10px] text-unbox-grey mt-0.5">{subtitle}</div>}
        </div>
    );
}
