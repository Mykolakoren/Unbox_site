import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import {
    Wallet, Plus, TrendingUp, Calendar,
    ArrowDownCircle, CreditCard, RotateCcw, Pencil, Receipt, Clock,
    GripVertical, Settings2, RotateCw, Check, Gift,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DiscountProgress } from '../components/Dashboard/DiscountProgress';
import { RESOURCES } from '../utils/data';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { bonusesApi, type Bonus } from '../api/bonuses';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    TouchSensor,
    useSensor,
    useSensors,
    type DragEndEvent,
    DragOverlay,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    rectSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Block Definitions ────────────────────────────────────────────────────────

type BlockId = 'bonuses' | 'balance' | 'discount' | 'quickActions' | 'bookings' | 'payments';

interface BlockConfig {
    id: BlockId;
    label: string;
    icon: React.ElementType;
    fullWidth: boolean;
}

const ALL_BLOCKS: BlockConfig[] = [
    { id: 'bonuses', label: 'Бонусы', icon: Gift, fullWidth: false },
    { id: 'balance', label: 'Баланс', icon: Wallet, fullWidth: false },
    { id: 'discount', label: 'Прогресс скидки', icon: TrendingUp, fullWidth: false },
    { id: 'quickActions', label: 'Быстрые действия', icon: Plus, fullWidth: true },
    { id: 'bookings', label: 'История бронирований', icon: Calendar, fullWidth: true },
    { id: 'payments', label: 'История платежей', icon: Receipt, fullWidth: true },
];

const DEFAULT_ORDER: BlockId[] = ['bonuses', 'balance', 'discount', 'quickActions', 'bookings', 'payments'];
const STORAGE_KEY = 'dashboard_layout';
const HIDDEN_KEY = 'dashboard_hidden';

function loadLayout(): BlockId[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved) as BlockId[];
            const valid = parsed.filter(id => ALL_BLOCKS.some(b => b.id === id));
            ALL_BLOCKS.forEach(b => {
                if (!valid.includes(b.id)) valid.push(b.id);
            });
            return valid;
        }
    } catch { /* fallback */ }
    return [...DEFAULT_ORDER];
}

function loadHidden(): Set<BlockId> {
    try {
        const saved = localStorage.getItem(HIDDEN_KEY);
        if (saved) return new Set(JSON.parse(saved));
    } catch { /* fallback */ }
    return new Set();
}

function saveLayout(order: BlockId[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

function saveHidden(hidden: Set<BlockId>) {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
}

// ── Glass Card Style ─────────────────────────────────────────────────────────

const glassStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.45)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.65)',
    boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
};

// ── Wiggle animation ─────────────────────────────────────────────────────────

const wiggleCSS = `
@keyframes dash-wiggle {
    0%, 100% { transform: rotate(-0.4deg) scale(1); }
    25% { transform: rotate(0.4deg) scale(1.002); }
    75% { transform: rotate(-0.3deg) scale(0.998); }
}
`;

// ── Sortable Block ───────────────────────────────────────────────────────────

function SortableBlock({
    id,
    isEditing,
    blockSize,
    onToggleSize,
    children,
}: {
    id: string;
    isEditing: boolean;
    blockSize: BlockSize;
    onToggleSize: () => void;
    children: React.ReactNode;
}) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, disabled: !isEditing });

    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition: transition || 'transform 250ms cubic-bezier(0.25, 1, 0.5, 1)',
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 50 : undefined,
        position: 'relative' as const,
        animation: isEditing && !isDragging ? `dash-wiggle 0.4s ease-in-out infinite` : undefined,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={blockSize === 'full' ? 'lg:col-span-2' : ''}
            {...attributes}
        >
            {/* Drag handle — top-right corner */}
            {isEditing && (
                <div
                    {...listeners}
                    className="absolute -top-2.5 -right-2.5 z-30 w-10 h-10 rounded-2xl bg-unbox-green text-white shadow-lg flex items-center justify-center cursor-grab active:cursor-grabbing active:scale-110 transition-all touch-none hover:bg-unbox-dark hover:shadow-xl"
                    title="Перетащить"
                >
                    <GripVertical size={18} />
                </div>
            )}
            {/* Resize toggle — bottom-right corner */}
            {isEditing && (
                <button
                    onClick={(e) => { e.stopPropagation(); onToggleSize(); }}
                    className="absolute -bottom-2 -right-2 z-30 w-8 h-8 rounded-xl bg-white text-unbox-grey shadow-lg border border-gray-200 flex items-center justify-center hover:bg-unbox-green hover:text-white hover:border-unbox-green transition-all"
                    title={blockSize === 'full' ? 'Сделать половину' : 'На всю ширину'}
                >
                    {blockSize === 'full' ? (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="1" y="1" width="5" height="12" rx="1" />
                            <rect x="8" y="1" width="5" height="12" rx="1" strokeDasharray="2 2" opacity="0.4" />
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="1" y="1" width="12" height="12" rx="1" />
                        </svg>
                    )}
                </button>
            )}
            {children}
        </div>
    );
}

// ── Size storage ─────────────────────────────────────────────────────────────

const SIZE_KEY = 'dashboard_sizes';
type BlockSize = 'half' | 'full';

function loadSizes(): Record<BlockId, BlockSize> {
    try {
        const saved = localStorage.getItem(SIZE_KEY);
        if (saved) return JSON.parse(saved);
    } catch { /* fallback */ }
    return Object.fromEntries(ALL_BLOCKS.map(b => [b.id, b.fullWidth ? 'full' : 'half'])) as Record<BlockId, BlockSize>;
}

function saveSizes(sizes: Record<BlockId, BlockSize>) {
    localStorage.setItem(SIZE_KEY, JSON.stringify(sizes));
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DashboardOverview() {
    const gridHouse = useDesignFlag();
    const { currentUser, bookings, getTransactionsByUser } = useUserStore();
    const navigate = useNavigate();
    const [blockOrder, setBlockOrder] = useState<BlockId[]>(loadLayout);
    const [hiddenBlocks, setHiddenBlocks] = useState<Set<BlockId>>(loadHidden);
    const [blockSizes, setBlockSizes] = useState<Record<BlockId, BlockSize>>(loadSizes);
    const [isEditing, setIsEditing] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [bonuses, setBonuses] = useState<Bonus[]>([]);

    const [showWelcome, setShowWelcome] = useState(false);

    useEffect(() => {
        bonusesApi.getMyBonuses().then(b => {
            setBonuses(b);
            // Show welcome popup for new users with active bonuses
            const hasActiveBonuses = b.some(bonus => bonus.status === 'active');
            const alreadyShown = localStorage.getItem('unbox_welcome_shown');
            if (hasActiveBonuses && !alreadyShown && currentUser) {
                // Check if user was created within last 7 days
                const createdAt = new Date((currentUser as any).createdAt || 0);
                const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                if (createdAt > sevenDaysAgo) {
                    setShowWelcome(true);
                }
            }
        }).catch(() => {});
    }, [currentUser]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = useCallback((event: DragEndEvent) => {
        setActiveId(null);
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setBlockOrder(prev => {
                const oldIndex = prev.indexOf(active.id as BlockId);
                const newIndex = prev.indexOf(over.id as BlockId);
                const newOrder = arrayMove(prev, oldIndex, newIndex);
                saveLayout(newOrder);
                return newOrder;
            });
        }
    }, []);

    const toggleVisibility = useCallback((id: BlockId) => {
        setHiddenBlocks(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            saveHidden(next);
            return next;
        });
    }, []);

    const toggleBlockSize = useCallback((id: BlockId) => {
        setBlockSizes(prev => {
            const next = { ...prev, [id]: prev[id] === 'full' ? 'half' as BlockSize : 'full' as BlockSize };
            saveSizes(next);
            return next;
        });
    }, []);

    const resetLayout = useCallback(() => {
        const defaultSizes = Object.fromEntries(ALL_BLOCKS.map(b => [b.id, b.fullWidth ? 'full' : 'half'])) as Record<BlockId, BlockSize>;
        setBlockOrder([...DEFAULT_ORDER]);
        setHiddenBlocks(new Set());
        setBlockSizes(defaultSizes);
        saveLayout([...DEFAULT_ORDER]);
        saveHidden(new Set());
        saveSizes(defaultSizes);
    }, []);

    if (!currentUser) return null;

    const isNegative = currentUser.balance < 0;
    const creditLimit = currentUser.creditLimit || 0;
    const availableCredit = creditLimit + currentUser.balance;
    const usagePercent = Math.min(100, Math.max(0, (Math.abs(currentUser.balance) / creditLimit) * 100));

    const recentBookings = bookings
        .filter(b => b.userId === currentUser.email || b.userId === currentUser.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 5);

    const recentTransactions = getTransactionsByUser(currentUser.id).slice(0, 5);

    const statusConfig: Record<string, { label: string; color: string }> = {
        confirmed: { label: 'Активно', color: 'bg-emerald-50 text-emerald-700' },
        completed: { label: 'Завершено', color: 'bg-blue-50 text-blue-700' },
        cancelled: { label: 'Отменено', color: 'bg-red-50 text-red-600' },
        no_show: { label: 'Неявка', color: 'bg-amber-50 text-amber-700' },
        're-rented': { label: 'Пересдано', color: 'bg-purple-50 text-purple-700' },
        rescheduled: { label: 'Перенесено', color: 'bg-sky-50 text-sky-700' },
    };

    const transactionTypeConfig: Record<string, { label: string; icon: typeof ArrowDownCircle; color: string }> = {
        deposit: { label: 'Пополнение', icon: ArrowDownCircle, color: 'text-green-600' },
        booking_payment: { label: 'Оплата бронирования', icon: CreditCard, color: 'text-blue-600' },
        refund: { label: 'Возврат', icon: RotateCcw, color: 'text-amber-600' },
        manual_correction: { label: 'Корректировка', icon: Pencil, color: 'text-purple-600' },
        subscription_purchase: { label: 'Покупка абонемента', icon: Receipt, color: 'text-indigo-600' },
        expense: { label: 'Расход', icon: CreditCard, color: 'text-red-600' },
    };

    const formatBookingDate = (dateValue: Date | string) => {
        try {
            const d = typeof dateValue === 'string' ? new Date(dateValue) : dateValue;
            return format(d, 'd MMM yyyy', { locale: ru });
        } catch {
            return String(dateValue);
        }
    };

    // ── Block Renderers ──────────────────────────────────────────────────────

    const activeBonuses = bonuses.filter(b => b.status === 'active');
    const totalBonusHours = activeBonuses.reduce((sum, b) => sum + (b.quantity || 0), 0);

    const renderBlock = (blockId: BlockId) => {
        switch (blockId) {
            case 'bonuses':
                if (activeBonuses.length === 0) {
                    return (
                        <div className="p-6 rounded-2xl relative overflow-hidden" style={glassStyle}>
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">
                                    <Gift size={20} className="text-gray-300" />
                                </div>
                                <div>
                                    <div className="text-sm font-medium text-unbox-grey">Бонусы</div>
                                    <div className="text-xs text-gray-400">Нет активных бонусов</div>
                                </div>
                            </div>
                        </div>
                    );
                }
                return (
                    <div className="p-6 rounded-2xl relative overflow-hidden" style={glassStyle}>
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-100/40 to-transparent rounded-bl-full" />
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <div className="text-sm text-unbox-grey font-medium mb-1 flex items-center gap-1.5">
                                    <Gift size={14} className="text-amber-500" />
                                    Ваши бонусы
                                </div>
                                <div className="text-3xl font-bold text-amber-600">
                                    {totalBonusHours} {totalBonusHours === 1 ? 'час' : totalBonusHours < 5 ? 'часа' : 'часов'}
                                </div>
                                <div className="text-xs text-unbox-grey mt-0.5">
                                    бесплатной аренды
                                </div>
                            </div>
                            <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                                <Gift size={24} className="text-amber-500" />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            {activeBonuses.map(b => (
                                <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-amber-50/60">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium text-amber-800 truncate">
                                            {b.description || 'Бонусный час'}
                                        </div>
                                        {b.expiresAt && (
                                            <div className="text-[11px] text-amber-600/70">
                                                до {format(new Date(b.expiresAt), 'd MMM yyyy', { locale: ru })}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-sm font-bold text-amber-600 flex-shrink-0 ml-2">
                                        {b.quantity}ч
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'balance':
                return (
                    <div className="p-6 rounded-2xl relative overflow-hidden" style={glassStyle}>
                        <div className="flex justify-between items-start mb-6">
                            <div>
                                <div className="text-sm text-unbox-grey font-medium mb-1">
                                    {isNegative ? 'Текущая задолженность' : 'Текущий баланс'}
                                </div>
                                <div className={`text-4xl font-bold ${isNegative ? 'text-red-500' : 'text-green-600'}`}>
                                    {currentUser.balance.toFixed(2)} {'\u20BE'}
                                </div>
                                {isNegative && (
                                    <div className="text-xs text-red-400 mt-1 font-medium">
                                        Кредитный лимит: {currentUser.creditLimit} {'\u20BE'}
                                    </div>
                                )}
                            </div>
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isNegative ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                                <Wallet size={24} />
                            </div>
                        </div>
                        {isNegative && (
                            <div className="space-y-2">
                                <div className="flex justify-between text-xs font-medium">
                                    <span className="text-unbox-grey">Использовано кредита</span>
                                    <span className={availableCredit < 50 ? 'text-red-500' : 'text-unbox-dark'}>
                                        Доступно: {availableCredit.toFixed(2)} {'\u20BE'}
                                    </span>
                                </div>
                                <div className="w-full bg-unbox-light/50 rounded-full h-2 overflow-hidden">
                                    <div
                                        className={`h-full rounded-full ${availableCredit < 50 ? 'bg-red-500' : 'bg-unbox-green'}`}
                                        style={{ width: `${usagePercent}%` }}
                                    />
                                </div>
                            </div>
                        )}
                        {!isNegative && (
                            <div className="flex items-center gap-2 text-sm text-green-600 font-medium bg-green-50 px-3 py-1.5 rounded-lg w-fit">
                                <TrendingUp size={16} />
                                <span>Активный депозит</span>
                            </div>
                        )}
                    </div>
                );

            case 'discount':
                return <DiscountProgress />;

            case 'quickActions':
                return (
                    <div className="p-6 rounded-2xl flex flex-col justify-center gap-4" style={glassStyle}>
                        <h3 className="font-bold text-lg">Быстрые действия</h3>
                        <div>
                            <Button onClick={() => navigate('/booking')} className="w-full justify-start py-6" size="lg">
                                <Plus className="mr-2" />
                                Новое бронирование
                            </Button>
                        </div>
                    </div>
                );

            case 'bookings':
                return (
                    <div className="p-6 rounded-2xl" style={glassStyle}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Calendar size={20} className="text-unbox-green" />
                                История бронирований
                            </h3>
                            {recentBookings.length > 0 && (
                                <button
                                    onClick={() => navigate('/dashboard/bookings')}
                                    className="text-sm text-unbox-green hover:underline font-medium"
                                >
                                    Все &rarr;
                                </button>
                            )}
                        </div>
                        {recentBookings.length === 0 ? (
                            <p className="text-unbox-grey text-sm py-4 text-center">У вас пока нет бронирований</p>
                        ) : (
                            <div className="space-y-2">
                                {recentBookings.map(b => {
                                    const resource = RESOURCES.find(r => r.id === b.resourceId);
                                    const status = statusConfig[b.status] || { label: b.status, color: 'bg-gray-100 text-gray-600' };
                                    return (
                                        <div key={b.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/40 hover:bg-white/60 transition-colors">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-lg bg-unbox-green/10 flex items-center justify-center flex-shrink-0">
                                                    <Calendar size={18} className="text-unbox-green" />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-medium text-sm truncate">
                                                        {resource?.name || 'Кабинет'} &middot; {formatBookingDate(b.date)}
                                                    </div>
                                                    <div className="text-xs text-unbox-grey flex items-center gap-1">
                                                        <Clock size={12} />
                                                        {b.startTime || '\u2014'} &middot; {b.duration ? `${b.duration / 60}ч` : '\u2014'}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                                                    {status.label}
                                                </span>
                                                <span className="font-semibold text-sm w-16 text-right">
                                                    {b.finalPrice?.toFixed(0) ?? '\u2014'} {'\u20BE'}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );

            case 'payments':
                return (
                    <div className="p-6 rounded-2xl" style={glassStyle}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Wallet size={20} className="text-unbox-green" />
                                История платежей
                            </h3>
                        </div>
                        {recentTransactions.length === 0 ? (
                            <p className="text-unbox-grey text-sm py-4 text-center">Платежей пока нет</p>
                        ) : (
                            <div className="space-y-2">
                                {recentTransactions.map(t => {
                                    const config = transactionTypeConfig[t.type] || { label: t.type, icon: CreditCard, color: 'text-gray-600' };
                                    const TxIcon = config.icon;
                                    const isPositive = t.type === 'deposit' || t.type === 'refund';
                                    return (
                                        <div key={t.id} className="flex items-center justify-between py-3 px-4 rounded-xl bg-white/40 hover:bg-white/60 transition-colors">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-gray-50">
                                                    <TxIcon size={18} className={config.color} />
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="font-medium text-sm truncate">{config.label}</div>
                                                    <div className="text-xs text-unbox-grey">
                                                        {t.description || format(new Date(t.date), 'd MMM yyyy, HH:mm', { locale: ru })}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 flex-shrink-0">
                                                <span className="text-xs text-unbox-grey capitalize">
                                                    {t.paymentMethod === 'cash' ? 'Наличные' :
                                                     t.paymentMethod === 'tbc' ? 'TBC' :
                                                     t.paymentMethod === 'bog' ? 'BOG' :
                                                     t.paymentMethod === 'balance' ? 'Баланс' :
                                                     t.paymentMethod === 'card' ? 'Карта' :
                                                     t.paymentMethod === 'transfer' ? 'Перевод' :
                                                     t.paymentMethod === 'admin_adjustment' ? 'Админ' :
                                                     t.paymentMethod}
                                                </span>
                                                <span className={`font-semibold text-sm w-20 text-right ${isPositive ? 'text-green-600' : 'text-red-500'}`}>
                                                    {isPositive ? '+' : '\u2212'}{Math.abs(t.amount).toFixed(0)} {t.currency === 'GEL' ? '\u20BE' : t.currency}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                );

            default:
                return null;
        }
    };

    // Visible block order for rendering
    const visibleOrder = isEditing ? blockOrder : blockOrder.filter(id => !hiddenBlocks.has(id));

    // ── Grid House design flag — rollback-safe variant ──
    if (gridHouse) return (
        <GridHouseDashboardOverview
            currentUser={currentUser}
            isNegative={isNegative}
            creditLimit={creditLimit}
            availableCredit={availableCredit}
            usagePercent={usagePercent}
            activeBonuses={activeBonuses}
            totalBonusHours={totalBonusHours}
            recentBookings={recentBookings}
            recentTransactions={recentTransactions}
            statusConfig={statusConfig}
            transactionTypeConfig={transactionTypeConfig}
            formatBookingDate={formatBookingDate}
            navigate={navigate}
        />
    );

    // Legacy path below
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {isEditing && <style>{wiggleCSS}</style>}

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Обзор</h1>
                    <p className="text-unbox-grey text-sm">Сводка вашего аккаунта и быстрые действия</p>
                </div>
                <button
                    onClick={() => setIsEditing(!isEditing)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                        isEditing
                            ? 'bg-unbox-green text-white border-unbox-green shadow-md'
                            : 'text-unbox-grey hover:text-unbox-dark bg-white/60 hover:bg-white/80 border-white/60'
                    }`}
                >
                    {isEditing ? <Check size={13} /> : <Settings2 size={13} />}
                    {isEditing ? 'Готово' : 'Настроить'}
                </button>
            </div>

            {/* Inline settings toolbar — widget visibility + reset */}
            {isEditing && (
                <div className="flex flex-wrap items-center gap-2 px-4 py-3 rounded-2xl bg-white/60 border border-white/80 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200"
                     style={{ backdropFilter: 'blur(12px)' }}
                >
                    <span className="text-xs font-semibold text-unbox-dark mr-1">Виджеты:</span>
                    {ALL_BLOCKS.map(block => {
                        const Icon = block.icon;
                        const isVisible = !hiddenBlocks.has(block.id);
                        return (
                            <button
                                key={block.id}
                                onClick={() => toggleVisibility(block.id)}
                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                                    isVisible
                                        ? 'bg-unbox-green/10 text-unbox-green border border-unbox-green/30'
                                        : 'bg-gray-100 text-gray-400 border border-gray-200 line-through'
                                }`}
                            >
                                <div className={`w-4 h-4 rounded flex items-center justify-center transition-all ${
                                    isVisible ? 'bg-unbox-green' : 'bg-gray-300'
                                }`}>
                                    {isVisible && <Check size={10} className="text-white" />}
                                </div>
                                <Icon size={13} />
                                <span className="hidden sm:inline">{block.label}</span>
                            </button>
                        );
                    })}
                    <div className="flex-1" />
                    <button
                        onClick={resetLayout}
                        className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-unbox-grey hover:text-unbox-dark bg-white/80 hover:bg-white rounded-lg border border-gray-200 transition-colors"
                    >
                        <RotateCw size={11} />
                        Сброс
                    </button>
                    <div className="w-full mt-1 flex items-center gap-1.5 text-[11px] text-unbox-grey">
                        <GripVertical size={12} className="text-unbox-green shrink-0" />
                        Перетаскивай за зелёную ручку
                        <span className="inline-flex w-4 h-4 bg-unbox-green rounded items-center justify-center">
                            <GripVertical size={8} className="text-white" />
                        </span>
                        · Меняй размер кнопкой в правом нижнем углу
                    </div>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={e => setActiveId(String(e.active.id))}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveId(null)}
            >
                <SortableContext items={visibleOrder} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {visibleOrder.map(blockId => {
                            const size = blockSizes[blockId] || 'half';
                            return (
                                <SortableBlock
                                    key={blockId}
                                    id={blockId}
                                    isEditing={isEditing}
                                    blockSize={size}
                                    onToggleSize={() => toggleBlockSize(blockId)}
                                >
                                    {renderBlock(blockId)}
                                </SortableBlock>
                            );
                        })}
                    </div>
                </SortableContext>

                <DragOverlay>
                    {activeId ? (
                        <div className="opacity-90 scale-105 rotate-2 shadow-2xl rounded-2xl">
                            {renderBlock(activeId as BlockId)}
                        </div>
                    ) : null}
                </DragOverlay>
            </DndContext>

            {/* Welcome Bonus Popup */}
            {showWelcome && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8 text-center space-y-5 animate-in zoom-in-95 duration-300">
                        <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto">
                            <Gift size={32} className="text-amber-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-unbox-dark">Добро пожаловать!</h2>
                        <p className="text-unbox-grey">
                            Мы дарим вам <span className="font-bold text-amber-600">1 час бесплатной аренды</span> любого кабинета.
                            Используйте бонус при бронировании!
                        </p>
                        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                            <div className="text-sm text-amber-700 font-medium">Ваш бонус</div>
                            <div className="text-3xl font-bold text-amber-600 mt-1">1 час</div>
                            <div className="text-xs text-amber-500 mt-1">Действителен 90 дней</div>
                        </div>
                        <button
                            onClick={() => {
                                setShowWelcome(false);
                                localStorage.setItem('unbox_welcome_shown', '1');
                            }}
                            className="w-full py-3 bg-unbox-green text-white font-bold rounded-xl hover:bg-unbox-dark transition-colors cursor-pointer"
                        >
                            Отлично, спасибо!
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — DashboardOverview
   ═══════════════════════════════════════════════════════════════ */

const ghdoMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghdoHairline = `1px solid ${GH.ink10}`;

interface GridHouseDashboardOverviewProps {
    currentUser: any;
    isNegative: boolean;
    creditLimit: number;
    availableCredit: number;
    usagePercent: number;
    activeBonuses: Bonus[];
    totalBonusHours: number;
    recentBookings: any[];
    recentTransactions: any[];
    statusConfig: Record<string, { label: string; color: string }>;
    transactionTypeConfig: Record<string, { label: string; icon: any; color: string }>;
    formatBookingDate: (d: Date | string) => string;
    navigate: ReturnType<typeof useNavigate>;
}

function useGHNarrow(bp = 768) {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
    useEffect(() => { const h = () => setN(window.innerWidth < bp); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [bp]);
    return n;
}

function GridHouseDashboardOverview({
    currentUser, isNegative, creditLimit, availableCredit, usagePercent: _usagePercent,
    activeBonuses, totalBonusHours, recentBookings, recentTransactions,
    statusConfig, transactionTypeConfig, formatBookingDate, navigate,
}: GridHouseDashboardOverviewProps) {
    const narrow = useGHNarrow();
    const ghStatusColor = (status: string) => {
        const map: Record<string, string> = {
            confirmed: GH.accent, completed: GH.ink60, cancelled: GH.danger,
            no_show: '#B8862F', 're-rented': GH.ink30, rescheduled: GH.ink60,
        };
        return map[status] || GH.ink30;
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Header */}
            <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 8 }}>МОЙ КАБИНЕТ</div>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                    Обзор
                </h1>
                <p style={{ fontSize: 14, color: GH.ink60, marginTop: 4 }}>
                    Привет, {currentUser.name?.split(' ')[0] || 'пользователь'}
                </p>
            </div>

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 0, borderTop: ghdoHairline, marginBottom: 32 }}>
                {/* Balance */}
                <div style={{ padding: narrow ? '16px 0' : '20px 20px 20px 0', borderRight: narrow ? 'none' : ghdoHairline, borderBottom: narrow ? ghdoHairline : 'none' }}>
                    <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 8 }}>БАЛАНС</div>
                    <div style={{
                        fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700,
                        color: isNegative ? GH.danger : GH.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                    }}>
                        {currentUser.balance?.toLocaleString('ru-RU') || '0'} ₴
                    </div>
                    {creditLimit > 0 && (
                        <div style={{ fontSize: 12, color: GH.ink30, marginTop: 6 }}>
                            Кредит: {availableCredit.toLocaleString('ru-RU')} ₴ из {creditLimit.toLocaleString('ru-RU')} ₴
                        </div>
                    )}
                </div>

                {/* Bonuses */}
                <div style={{ padding: narrow ? '16px 0' : '20px 20px 20px 20px', borderRight: narrow ? 'none' : ghdoHairline, borderBottom: narrow ? ghdoHairline : 'none' }}>
                    <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 8 }}>БОНУСЫ</div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1, color: activeBonuses.length > 0 ? GH.accent : GH.ink30 }}>
                        {totalBonusHours}
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink30, marginTop: 6 }}>
                        {activeBonuses.length > 0 ? 'часов бесплатной аренды' : 'нет активных бонусов'}
                    </div>
                </div>

                {/* Discount */}
                <div style={{ padding: narrow ? '16px 0' : '20px 0 20px 20px' }}>
                    <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 8 }}>СКИДКА</div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1 }}>
                        {currentUser.discountPercent || 0}%
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink30, marginTop: 6 }}>
                        текущий уровень
                    </div>
                </div>
            </div>

            {/* Quick actions */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 32, flexWrap: 'wrap' }}>
                <button
                    onClick={() => navigate('/booking')}
                    style={{
                        padding: '10px 20px', background: GH.ink, color: GH.paper, fontWeight: 700,
                        fontSize: 13, fontFamily: GH_SANS, border: 'none', cursor: 'pointer',
                    }}
                >
                    + Забронировать кабинет
                </button>
            </div>

            {/* Two-column: bookings + payments */}
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: narrow ? 24 : 32 }}>
                {/* Recent bookings */}
                <div>
                    <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 12 }}>ПОСЛЕДНИЕ БРОНИРОВАНИЯ</div>
                    {recentBookings.length === 0 ? (
                        <div style={{ padding: 24, border: ghdoHairline, color: GH.ink30, fontSize: 13, textAlign: 'center' }}>
                            Нет бронирований
                        </div>
                    ) : (
                        <div style={{ border: ghdoHairline }}>
                            {recentBookings.map((b, i) => {
                                const sc = statusConfig[b.status] || statusConfig.confirmed;
                                const resName = RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId;
                                return (
                                    <div key={i} style={{ padding: '14px 16px', borderBottom: i < recentBookings.length - 1 ? ghdoHairline : 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <div style={{ fontSize: 14, fontWeight: 600 }}>{resName}</div>
                                            <span style={{ ...ghdoMono, fontSize: 9, color: ghStatusColor(b.status), padding: '2px 8px', border: `1px solid ${ghStatusColor(b.status)}30`, flexShrink: 0 }}>
                                                {sc.label.toUpperCase()}
                                            </span>
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink30 }}>
                                            {formatBookingDate(b.date)} · {b.startTime}–{b.endTime}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Recent transactions */}
                <div>
                    <div style={{ ...ghdoMono, color: GH.ink30, marginBottom: 12 }}>ПОСЛЕДНИЕ ПЛАТЕЖИ</div>
                    {recentTransactions.length === 0 ? (
                        <div style={{ padding: 24, border: ghdoHairline, color: GH.ink30, fontSize: 13, textAlign: 'center' }}>
                            Нет транзакций
                        </div>
                    ) : (
                        <div style={{ border: ghdoHairline }}>
                            {recentTransactions.map((t: any, i: number) => {
                                const tc = transactionTypeConfig[t.type] || transactionTypeConfig.deposit;
                                return (
                                    <div key={i} style={{ padding: '12px 16px', borderBottom: i < recentTransactions.length - 1 ? ghdoHairline : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600 }}>{tc.label}</div>
                                            <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink30, marginTop: 2 }}>
                                                {formatBookingDate(t.createdAt)}
                                            </div>
                                        </div>
                                        <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, color: t.amount >= 0 ? GH.accent : GH.danger }}>
                                            {t.amount >= 0 ? '+' : ''}{t.amount?.toLocaleString('ru-RU')} ₴
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', marginTop: 48, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghdoMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghdoMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
