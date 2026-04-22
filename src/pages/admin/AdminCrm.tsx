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
import type { User, Transaction } from '../../store/types';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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

        // Доход = входящие деньги (не refund/expense). Только реальные платежи (не внутренние переводы с баланса).
        const incomeTypes: Transaction['type'][] = ['deposit', 'subscription_purchase', 'booking_payment', 'manual_correction'];
        const recentTransactions = transactions.filter(
            (t) => isAfter(new Date(t.date), thirtyDaysAgo)
                && ['cash', 'tbc', 'bog', 'card', 'transfer'].includes(t.paymentMethod)
                && incomeTypes.includes(t.type)
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

            <GridHouseAdminCrm
                analytics={analytics}
                pipeline={pipeline}
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                draggingEmail={draggingEmail}
                dragOverStage={dragOverStage} setDragOverStage={setDragOverStage}
                handleDragStart={handleDragStart}
                handleDragEnd={handleDragEnd}
                handleDragOver={handleDragOver}
                handleDrop={handleDrop}
                adminMap={adminMap}
                adminUsers={adminUsers}
                adminPicker={adminPicker} setAdminPicker={setAdminPicker}
                handleAssignAdmin={handleAssignAdmin}
                navigate={navigate}
            />
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
                        {user.name?.[0]?.toUpperCase() ?? '?'}
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
                                {responsible.name?.[0]?.toUpperCase() ?? '?'}
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
                                {attracted.name?.[0]?.toUpperCase() ?? '?'}
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

// ============================================================================
// Grid House variant — CRM pipeline index
// ============================================================================

type GHCrmProps = {
    analytics: any;
    pipeline: { stage: PipelineStage; clients: User[] }[];
    searchQuery: string; setSearchQuery: (v: string) => void;
    draggingEmail: string | null;
    dragOverStage: PipelineStage | null;
    setDragOverStage: (s: PipelineStage | null) => void;
    handleDragStart: (e: React.DragEvent, email: string) => void;
    handleDragEnd: () => void;
    handleDragOver: (e: React.DragEvent, stage: PipelineStage) => void;
    handleDrop: (e: React.DragEvent, stage: PipelineStage) => void;
    adminMap: Map<string, User>;
    adminUsers: User[];
    adminPicker: AdminPickerState | null;
    setAdminPicker: (p: AdminPickerState | null) => void;
    handleAssignAdmin: (id: string | null) => void;
    navigate: (path: string) => void;
};

const GH_STAGE_LABELS: Record<PipelineStage, string> = {
    new: 'Новые',
    active: 'Активные',
    vip: 'VIP',
    partner: 'Партнёры',
    sleeping: 'Спящие',
    bad_client: 'Проблемные',
};

function GridHouseAdminCrm(p: GHCrmProps) {
    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 };

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 1600, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px)' }}>
                {/* HEAD */}
                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 32, marginBottom: 40 }}>
                    <div style={{ ...eyebrow, marginBottom: 12 }}>Раздел · CRM · 30 дней</div>
                    <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: 0 }}>
                        Клиентский поток.
                    </h1>
                </div>

                {/* KPI strip — 6 tabular cells */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', borderTop: `1px solid ${GH.ink10}`, borderBottom: `1px solid ${GH.ink10}`, marginBottom: 40 }}>
                    {[
                        { label: 'Клиентов', value: p.analytics.totalClients, sub: null },
                        { label: 'Новых · 30д', value: p.analytics.newClients, sub: null },
                        { label: 'Доход · 30д', value: `${p.analytics.monthlyRevenue.toFixed(0)} ₾`, sub: null },
                        { label: 'Бронирований', value: p.analytics.totalBookings, sub: `${p.analytics.cancelledBookings} отмен` },
                        { label: 'Абонементов', value: p.analytics.activeSubscriptions, sub: null },
                        { label: 'Должников', value: p.analytics.debtors.length, sub: null },
                    ].map((k, i) => (
                        <div key={k.label} style={{ padding: '20px 16px', borderLeft: i > 0 ? `1px solid ${GH.ink10}` : 'none' }}>
                            <div style={{ ...eyebrow, marginBottom: 8 }}>{k.label}</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(28px, 3vw, 38px)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1, color: k.label === 'Должников' && p.analytics.debtors.length > 0 ? GH.danger : GH.ink }}>
                                {k.value}
                            </div>
                            {k.sub && <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', color: GH.ink60, marginTop: 6, textTransform: 'uppercase' }}>{k.sub}</div>}
                        </div>
                    ))}
                </div>

                {/* SEARCH */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 32, paddingBottom: 16, borderBottom: `1px solid ${GH.ink10}` }}>
                    <Search size={16} color={GH.ink60} />
                    <input
                        type="text"
                        value={p.searchQuery}
                        onChange={e => p.setSearchQuery(e.target.value)}
                        placeholder="Поиск клиента…"
                        style={{
                            flex: 1,
                            fontFamily: GH_SANS,
                            fontSize: 16,
                            background: 'transparent',
                            border: 'none',
                            outline: 'none',
                            padding: '8px 0',
                            color: GH.ink,
                            maxWidth: 480,
                        }}
                    />
                    <span style={{ marginLeft: 'auto', ...eyebrow }}>
                        Перетащите карточку — смените статус
                    </span>
                </div>

                {/* PIPELINE · 6 columns */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0, border: `1px solid ${GH.ink10}`, marginBottom: 40 }}>
                    {p.pipeline.map(({ stage, clients }, colIdx) => {
                        const isOver = p.dragOverStage === stage;
                        return (
                            <div
                                key={stage}
                                onDragOver={(e) => p.handleDragOver(e, stage)}
                                onDragLeave={(e) => {
                                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                        p.setDragOverStage(null);
                                    }
                                }}
                                onDrop={(e) => p.handleDrop(e, stage)}
                                style={{
                                    borderLeft: colIdx > 0 ? `1px solid ${GH.ink10}` : 'none',
                                    background: isOver ? GH.ink5 : 'transparent',
                                    transition: 'background 150ms',
                                    minHeight: 480,
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                {/* Column head */}
                                <div style={{ padding: '16px 12px', borderBottom: `2px solid ${GH.ink}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                                    <span style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: GH.ink }}>
                                        {String(colIdx + 1).padStart(2, '0')} · {GH_STAGE_LABELS[stage]}
                                    </span>
                                    <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.ink }}>
                                        {clients.length}
                                    </span>
                                </div>

                                {/* Cards */}
                                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 480, overflowY: 'auto', flex: 1 }}>
                                    {clients.length === 0 ? (
                                        <div style={{
                                            padding: '24px 12px',
                                            border: `1px dashed ${isOver ? GH.ink60 : GH.ink10}`,
                                            fontFamily: GH_MONO,
                                            fontSize: 10,
                                            letterSpacing: '0.16em',
                                            textTransform: 'uppercase',
                                            color: GH.ink60,
                                            textAlign: 'center',
                                        }}>
                                            {isOver ? 'Отпустите' : 'Пусто'}
                                        </div>
                                    ) : (
                                        clients.slice(0, 15).map((user, i) => (
                                            <GHClientCard
                                                key={user.email}
                                                user={user}
                                                index={i}
                                                isDragging={p.draggingEmail === user.email}
                                                adminMap={p.adminMap}
                                                onNavigate={() => p.navigate(`/admin/users/${encodeURIComponent(user.email)}`)}
                                                onDragStart={(e) => p.handleDragStart(e, user.email)}
                                                onDragEnd={p.handleDragEnd}
                                                onOpenAdminPicker={(type) => p.setAdminPicker({ user, type })}
                                            />
                                        ))
                                    )}
                                    {clients.length > 15 && (
                                        <div style={{ textAlign: 'center', padding: '8px 0', fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: GH.ink60 }}>
                                            +{clients.length - 15} ещё
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* DEBTORS */}
                {p.analytics.debtors.length > 0 && (
                    <section style={{ marginBottom: 40 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 12, marginBottom: 20 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
                                <span style={{ ...eyebrow, color: GH.danger }}>Раздел · Задолженность</span>
                                <h2 style={{ fontFamily: GH_SANS, fontSize: 'clamp(22px, 2.4vw, 30px)', fontWeight: 800, letterSpacing: '-0.01em', margin: 0 }}>
                                    Клиенты с минусом.
                                </h2>
                            </div>
                            <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                {p.analytics.debtors.length}
                            </span>
                        </div>
                        <div>
                            {p.analytics.debtors
                                .sort((a: User, b: User) => a.balance - b.balance)
                                .map((debtor: User, i: number) => (
                                    <div
                                        key={debtor.email}
                                        onClick={() => p.navigate(`/admin/users/${encodeURIComponent(debtor.email)}`)}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '60px 1fr 120px 40px',
                                            alignItems: 'center',
                                            gap: 16,
                                            padding: '16px 0',
                                            borderBottom: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        <span style={{ fontFamily: GH_MONO, fontSize: 12, fontVariantNumeric: 'tabular-nums', color: GH.ink60 }}>
                                            {String(i + 1).padStart(2, '0')}
                                        </span>
                                        <div>
                                            <div style={{ fontFamily: GH_SANS, fontSize: 15, fontWeight: 600, color: GH.ink }}>{debtor.name}</div>
                                            <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, marginTop: 2 }}>{debtor.email}</div>
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: GH.danger, textAlign: 'right' }}>
                                            {debtor.balance.toFixed(0)} ₾
                                        </div>
                                        <ChevronRight size={16} color={GH.ink60} />
                                    </div>
                                ))}
                        </div>
                    </section>
                )}

                {/* Footer */}
                <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 20, marginTop: 32, display: 'flex', justifyContent: 'space-between', ...eyebrow }}>
                    <span>Unbox · CRM · {new Date().getFullYear()}</span>
                    <span>{p.pipeline.reduce((acc, s) => acc + s.clients.length, 0)} клиентов</span>
                </div>
            </div>

            {/* ADMIN PICKER MODAL */}
            {p.adminPicker && (
                <div
                    style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,15,16,0.50)', padding: 24 }}
                    onClick={() => p.setAdminPicker(null)}
                >
                    <div
                        style={{ background: GH.paper, border: `2px solid ${GH.ink}`, width: 360, padding: 28 }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 16, marginBottom: 16 }}>
                            <div>
                                <div style={{ ...eyebrow, marginBottom: 6 }}>
                                    Назначить · {p.adminPicker.type === 'responsible' ? 'Ответственного' : 'Привлёк'}
                                </div>
                                <div style={{ fontFamily: GH_SANS, fontSize: 18, fontWeight: 700 }}>
                                    {p.adminPicker.user.name}
                                </div>
                            </div>
                            <button onClick={() => p.setAdminPicker(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}>
                                <X size={18} />
                            </button>
                        </div>

                        <div>
                            {/* Clear option */}
                            {(() => {
                                const current = p.adminPicker!.type === 'responsible'
                                    ? p.adminPicker!.user.responsibleAdminId
                                    : p.adminPicker!.user.attractedByAdminId;
                                const isSelected = !current;
                                return (
                                    <button
                                        onClick={() => p.handleAssignAdmin(null)}
                                        style={{
                                            width: '100%',
                                            display: 'grid',
                                            gridTemplateColumns: '40px 1fr 20px',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '12px 0',
                                            border: 'none',
                                            background: isSelected ? GH.ink : 'transparent',
                                            color: isSelected ? GH.paper : GH.ink,
                                            borderBottom: `1px solid ${isSelected ? GH.paper : GH.ink10}`,
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <span style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', color: isSelected ? GH.paper : GH.ink60, paddingLeft: 12 }}>—</span>
                                        <span style={{ fontFamily: GH_SANS, fontSize: 14 }}>Не назначен</span>
                                        <span />
                                    </button>
                                );
                            })()}
                            {p.adminUsers.map((admin, idx) => {
                                const current = p.adminPicker!.type === 'responsible'
                                    ? p.adminPicker!.user.responsibleAdminId
                                    : p.adminPicker!.user.attractedByAdminId;
                                const isSelected = current === admin.id;
                                return (
                                    <button
                                        key={admin.id}
                                        onClick={() => p.handleAssignAdmin(admin.id)}
                                        style={{
                                            width: '100%',
                                            display: 'grid',
                                            gridTemplateColumns: '40px 1fr 20px',
                                            alignItems: 'center',
                                            gap: 12,
                                            padding: '12px 0',
                                            border: 'none',
                                            background: isSelected ? GH.ink : 'transparent',
                                            color: isSelected ? GH.paper : GH.ink,
                                            borderBottom: `1px solid ${isSelected ? GH.paper : GH.ink10}`,
                                            cursor: 'pointer',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <span style={{ fontFamily: GH_MONO, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: isSelected ? GH.paper : GH.ink60, paddingLeft: 12 }}>
                                            {String(idx + 1).padStart(2, '0')}
                                        </span>
                                        <div>
                                            <div style={{ fontFamily: GH_SANS, fontSize: 14, fontWeight: 600 }}>{admin.name}</div>
                                            <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: isSelected ? GH.paper : GH.ink60, marginTop: 2 }}>
                                                {admin.role === 'owner' ? 'Владелец' : admin.role === 'senior_admin' ? 'Ст. Админ' : 'Админ'}
                                            </div>
                                        </div>
                                        {isSelected && <UserCheck size={14} />}
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

// ── Grid House Client Card ────────────────────────────────────────────────────

function GHClientCard({
    user, index, isDragging, adminMap, onNavigate, onDragStart, onDragEnd, onOpenAdminPicker,
}: {
    user: User;
    index: number;
    isDragging: boolean;
    adminMap: Map<string, User>;
    onNavigate: () => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onOpenAdminPicker: (type: 'responsible' | 'attracted') => void;
}) {
    const responsible = user.responsibleAdminId ? adminMap.get(user.responsibleAdminId) : null;
    const attracted = user.attractedByAdminId ? adminMap.get(user.attractedByAdminId) : null;

    return (
        <div
            draggable={true}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onNavigate}
            style={{
                background: GH.paper,
                border: `1px solid ${GH.ink10}`,
                padding: 10,
                cursor: 'pointer',
                opacity: isDragging ? 0.4 : 1,
                transform: isDragging ? 'scale(0.96)' : 'none',
                transition: 'transform 120ms, opacity 120ms',
                userSelect: 'none',
            }}
            onMouseEnter={(e) => { if (!isDragging) e.currentTarget.style.borderColor = GH.ink; }}
            onMouseLeave={(e) => { if (!isDragging) e.currentTarget.style.borderColor = GH.ink10; }}
        >
            <div style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, alignItems: 'flex-start' }}>
                <GripVertical size={12} color={GH.ink60} style={{ marginTop: 2, cursor: 'grab' }} />
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: GH_MONO, fontSize: 9, letterSpacing: '0.14em', color: GH.ink60, fontVariantNumeric: 'tabular-nums', marginBottom: 2 }}>
                        №{String(index + 1).padStart(3, '0')}
                    </div>
                    <div style={{ fontFamily: GH_SANS, fontSize: 12, fontWeight: 700, color: GH.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {user.name}
                    </div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 9, color: GH.ink60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                        {user.phone || user.email}
                    </div>
                    {user.balance !== 0 && (
                        <div style={{
                            fontFamily: GH_MONO,
                            fontSize: 10,
                            fontWeight: 700,
                            fontVariantNumeric: 'tabular-nums',
                            marginTop: 4,
                            color: user.balance < 0 ? GH.danger : GH.ink,
                        }}>
                            {user.balance.toFixed(0)} ₾
                        </div>
                    )}
                </div>
            </div>

            <div style={{ borderTop: `1px solid ${GH.ink10}`, marginTop: 8, paddingTop: 6 }} onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenAdminPicker('responsible'); }}
                    style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: '34px 1fr',
                        gap: 4,
                        padding: '3px 0',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <span style={{ fontFamily: GH_MONO, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: GH.ink60 }}>Отв.</span>
                    <span style={{ fontFamily: GH_SANS, fontSize: 10, color: responsible ? GH.ink : GH.ink60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: responsible ? 'normal' : 'italic' }}>
                        {responsible ? responsible.name : 'не назначен'}
                    </span>
                </button>
                <button
                    onClick={(e) => { e.stopPropagation(); onOpenAdminPicker('attracted'); }}
                    style={{
                        width: '100%',
                        display: 'grid',
                        gridTemplateColumns: '34px 1fr',
                        gap: 4,
                        padding: '3px 0',
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                    }}
                >
                    <span style={{ fontFamily: GH_MONO, fontSize: 8, letterSpacing: '0.12em', textTransform: 'uppercase', color: GH.ink60 }}>Прив.</span>
                    <span style={{ fontFamily: GH_SANS, fontSize: 10, color: attracted ? GH.ink : GH.ink60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: attracted ? 'normal' : 'italic' }}>
                        {attracted ? attracted.name : 'не указан'}
                    </span>
                </button>
            </div>
        </div>
    );
}
