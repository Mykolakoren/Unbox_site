import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import {
    Wallet, Plus, AlertCircle, TrendingUp, Calendar,
    ArrowDownCircle, CreditCard, RotateCcw, Pencil, Receipt, Clock,
    GripVertical, Settings2, X, RotateCw, Check,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { DiscountProgress } from '../components/Dashboard/DiscountProgress';
import { RESOURCES } from '../utils/data';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
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
    verticalListSortingStrategy,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// ── Block Definitions ────────────────────────────────────────────────────────

type BlockId = 'balance' | 'discount' | 'quickActions' | 'bookings' | 'payments';

interface BlockConfig {
    id: BlockId;
    label: string;
    icon: React.ElementType;
    fullWidth: boolean;
}

const ALL_BLOCKS: BlockConfig[] = [
    { id: 'balance', label: 'Баланс', icon: Wallet, fullWidth: false },
    { id: 'discount', label: 'Прогресс скидки', icon: TrendingUp, fullWidth: false },
    { id: 'quickActions', label: 'Быстрые действия', icon: Plus, fullWidth: true },
    { id: 'bookings', label: 'История бронирований', icon: Calendar, fullWidth: true },
    { id: 'payments', label: 'История платежей', icon: Receipt, fullWidth: true },
];

const DEFAULT_ORDER: BlockId[] = ['balance', 'discount', 'quickActions', 'bookings', 'payments'];
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
    children,
}: {
    id: string;
    isEditing: boolean;
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
        transition: transition || 'transform 200ms ease',
        opacity: isDragging ? 0.5 : 1,
        zIndex: isDragging ? 50 : undefined,
        position: 'relative' as const,
        animation: isEditing && !isDragging ? `dash-wiggle 0.4s ease-in-out infinite` : undefined,
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes}>
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
            {children}
        </div>
    );
}

// ── Settings Panel (checkbox list) ───────────────────────────────────────────

function SettingsPanel({
    hiddenBlocks,
    onToggle,
    onReset,
    onClose,
}: {
    hiddenBlocks: Set<BlockId>;
    onToggle: (id: BlockId) => void;
    onReset: () => void;
    onClose: () => void;
}) {
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                onClose();
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [onClose]);

    return (
        <div
            ref={panelRef}
            className="absolute right-0 top-full mt-2 z-50 w-64 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
        >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <span className="text-sm font-bold text-unbox-dark">Виджеты</span>
                <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition-colors">
                    <X size={14} className="text-unbox-grey" />
                </button>
            </div>
            <div className="py-1">
                {ALL_BLOCKS.map(block => {
                    const Icon = block.icon;
                    const isVisible = !hiddenBlocks.has(block.id);
                    return (
                        <button
                            key={block.id}
                            onClick={() => onToggle(block.id)}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors text-left"
                        >
                            <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                                isVisible
                                    ? 'bg-unbox-green border-unbox-green'
                                    : 'border-gray-300 bg-white'
                            }`}>
                                {isVisible && <Check size={12} className="text-white" />}
                            </div>
                            <Icon size={16} className={isVisible ? 'text-unbox-green' : 'text-gray-400'} />
                            <span className={`text-sm ${isVisible ? 'text-unbox-dark font-medium' : 'text-gray-400'}`}>
                                {block.label}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-100">
                <button
                    onClick={onReset}
                    className="flex items-center gap-2 text-xs text-unbox-grey hover:text-unbox-dark transition-colors w-full"
                >
                    <RotateCw size={12} />
                    Сбросить к настройкам по умолчанию
                </button>
            </div>
        </div>
    );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DashboardOverview() {
    const { currentUser, bookings, getTransactionsByUser } = useUserStore();
    const navigate = useNavigate();
    const [blockOrder, setBlockOrder] = useState<BlockId[]>(loadLayout);
    const [hiddenBlocks, setHiddenBlocks] = useState<Set<BlockId>>(loadHidden);
    const [isEditing, setIsEditing] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [activeId, setActiveId] = useState<string | null>(null);

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

    const resetLayout = useCallback(() => {
        setBlockOrder([...DEFAULT_ORDER]);
        setHiddenBlocks(new Set());
        saveLayout([...DEFAULT_ORDER]);
        saveHidden(new Set());
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

    const renderBlock = (blockId: BlockId) => {
        switch (blockId) {
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
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Button onClick={() => navigate('/dashboard/bookings')} className="w-full justify-start py-6" size="lg">
                                <Plus className="mr-2" />
                                Новое бронирование
                            </Button>
                            <Button onClick={() => navigate('/dashboard/bookings')} variant="outline" className="w-full justify-start py-6" size="lg">
                                <AlertCircle className="mr-2" />
                                Мои бронирования
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

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {isEditing && <style>{wiggleCSS}</style>}

            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold mb-1">Обзор</h1>
                    <p className="text-unbox-grey text-sm">Сводка вашего аккаунта и быстрые действия</p>
                </div>
                <div className="relative flex items-center gap-2">
                    {isEditing && (
                        <button
                            onClick={resetLayout}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-unbox-grey hover:text-unbox-dark bg-white/60 hover:bg-white/80 rounded-xl border border-white/60 transition-colors"
                        >
                            <RotateCw size={13} />
                            Сбросить
                        </button>
                    )}
                    {/* Settings gear — opens checkbox panel */}
                    <button
                        onClick={() => {
                            if (isEditing) {
                                setIsEditing(false);
                                setShowSettings(false);
                            } else {
                                setShowSettings(!showSettings);
                            }
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border transition-all ${
                            isEditing
                                ? 'bg-unbox-green text-white border-unbox-green shadow-md'
                                : showSettings
                                    ? 'bg-unbox-dark text-white border-unbox-dark'
                                    : 'text-unbox-grey hover:text-unbox-dark bg-white/60 hover:bg-white/80 border-white/60'
                        }`}
                    >
                        {isEditing ? <Check size={13} /> : <Settings2 size={13} />}
                        {isEditing ? 'Готово' : 'Настроить'}
                    </button>

                    {/* Settings dropdown */}
                    {showSettings && !isEditing && (
                        <SettingsPanel
                            hiddenBlocks={hiddenBlocks}
                            onToggle={toggleVisibility}
                            onReset={() => {
                                resetLayout();
                                setShowSettings(false);
                            }}
                            onClose={() => setShowSettings(false)}
                        />
                    )}
                </div>
            </div>

            {/* Edit mode hint */}
            {showSettings && !isEditing && (
                <button
                    onClick={() => {
                        setIsEditing(true);
                        setShowSettings(false);
                    }}
                    className="w-full px-4 py-3 rounded-xl bg-unbox-green/5 border border-unbox-green/20 text-sm text-unbox-dark flex items-center justify-center gap-2 hover:bg-unbox-green/10 transition-colors"
                >
                    <GripVertical size={16} className="text-unbox-green" />
                    <span>Перетащить и изменить порядок блоков</span>
                </button>
            )}

            {isEditing && (
                <div className="px-4 py-2.5 rounded-xl bg-unbox-green/10 border border-unbox-green/20 text-xs text-unbox-dark flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <GripVertical size={14} className="text-unbox-green shrink-0" />
                    Перетаскивай блоки за зелёную ручку
                    <span className="inline-flex w-5 h-5 bg-unbox-green rounded-lg items-center justify-center ml-0.5">
                        <GripVertical size={10} className="text-white" />
                    </span>
                </div>
            )}

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={e => setActiveId(String(e.active.id))}
                onDragEnd={handleDragEnd}
                onDragCancel={() => setActiveId(null)}
            >
                <SortableContext items={visibleOrder} strategy={verticalListSortingStrategy}>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {visibleOrder.map(blockId => {
                            const config = ALL_BLOCKS.find(b => b.id === blockId)!;
                            return (
                                <div
                                    key={blockId}
                                    className={config.fullWidth ? 'lg:col-span-2' : ''}
                                >
                                    <SortableBlock id={blockId} isEditing={isEditing}>
                                        {renderBlock(blockId)}
                                    </SortableBlock>
                                </div>
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
        </div>
    );
}
