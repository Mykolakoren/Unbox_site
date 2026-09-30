import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import {
    Wallet, Plus, TrendingUp, Calendar,
    ArrowDownCircle, CreditCard, RotateCcw, Pencil, Receipt, Clock,
    GripVertical, Settings2, RotateCw, Check, Gift,
    CalendarPlus, UserCheck,
} from 'lucide-react';
import { QuickActionsStrip } from '../components/ui/QuickActionsStrip';
import { LegacyButton as Button } from '../components/ui/LegacyButton';
import { DiscountProgress } from '../components/Dashboard/DiscountProgress';
import { RESOURCES } from '../utils/data';
import { bonusesApi, type Bonus } from '../api/bonuses';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { STATUS } from '../design/tokens';
import { StatusBadge } from '../components/ui/StatusBadge';
import { formatDayMonth, formatGel, formatMoney, formatTimeRange } from '../utils/format';
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
                    className="absolute -bottom-2 -right-2 z-30 w-8 h-8 rounded-xl bg-white text-ink-60 shadow-lg border border-gray-200 flex items-center justify-center hover:bg-unbox-green hover:text-white hover:border-unbox-green transition-all"
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
    // Division-by-zero guard — most users have no credit limit, in which case
    // dividing produces Infinity → Math.min/max passes it through → NaN width
    // on the progress bar that React renders silently as 0 (not crash, but
    // visually broken).
    const usagePercent = creditLimit > 0
        ? Math.min(100, Math.max(0, (Math.abs(currentUser.balance) / creditLimit) * 100))
        : 0;

    // Sort by SLOT TIME (booking.date + startTime), nearest upcoming first.
    // Used to sort by createdAt — admin feedback: "I open Обзор to see what's
    // next, not what I clicked last." Falls back to most-recent past when the
    // user has no upcoming bookings, so the block is never empty.
    const recentBookings = (() => {
        const mine = bookings.filter(b => b.userId === currentUser.email || b.userId === currentUser.id);
        const now = Date.now();
        const startMs = (b: any): number => {
            try {
                const d = new Date(b.date);
                if (isNaN(d.getTime())) return 0;
                if (b.startTime && /^\d{2}:\d{2}/.test(b.startTime)) {
                    const [h, m] = b.startTime.split(':').map(Number);
                    d.setHours(h, m, 0, 0);
                }
                return d.getTime();
            } catch { return 0; }
        };
        const active = mine.filter(b => b.status === 'confirmed' || b.status === 'pending_approval' || b.status === 'completed');
        const upcoming = active
            .filter(b => startMs(b) >= now - 60 * 60 * 1000) // include rows starting within last hour as "current"
            .sort((a, b) => startMs(a) - startMs(b));
        if (upcoming.length > 0) return upcoming.slice(0, 5);
        // No upcoming → show 5 most recent past bookings as historical context.
        return active.sort((a, b) => startMs(b) - startMs(a)).slice(0, 5);
    })();

    const recentTransactions = getTransactionsByUser(currentUser.id).slice(0, 5);

    // Статусы броней — из общего словаря (StatusBadge). Раньше здесь была своя
    // карта без pending_approval, и бронь «ждём подтверждения» показывалась
    // как «Активно» (X3-copy-tone-M2).

    const transactionTypeConfig: Record<string, { label: string; icon: typeof ArrowDownCircle }> = {
        deposit: { label: 'Пополнение', icon: ArrowDownCircle },
        booking_payment: { label: 'Оплата бронирования', icon: CreditCard },
        refund: { label: 'Возврат', icon: RotateCcw },
        manual_correction: { label: 'Корректировка', icon: Pencil },
        subscription_purchase: { label: 'Покупка абонемента', icon: Receipt },
        expense: { label: 'Расход', icon: CreditCard },
    };

    // «29 сентября» (год — только если не текущий), общий форматтер.
    const formatBookingDate = (dateValue: Date | string) =>
        formatDayMonth(dateValue, { withYear: 'auto', fallback: String(dateValue) });

    // ── Block Renderers ──────────────────────────────────────────────────────

    const activeBonuses = bonuses.filter(b => b.status === 'active');
    const totalBonusHours = activeBonuses.reduce((sum, b) => sum + (b.quantity || 0), 0);

    // Wave 1: старый renderBlock (стеклянные карточки, «Активно», гривна/эмодзи)
    // не рендерился с перехода на Grid House — удалён, чтобы не править мёртвый код.

    // ── Grid House design flag — rollback-safe variant ──
    return (

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
            transactionTypeConfig={transactionTypeConfig}
            formatBookingDate={formatBookingDate}
            navigate={navigate}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — DashboardOverview
   ═══════════════════════════════════════════════════════════════ */

const ghdoMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };
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
    transactionTypeConfig: Record<string, { label: string; icon: any }>;
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
    transactionTypeConfig, formatBookingDate, navigate,
}: GridHouseDashboardOverviewProps) {
    const narrow = useGHNarrow();

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Header */}
            <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 32 }}>
                <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 8 }}>МОЙ КАБИНЕТ</div>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                    Обзор
                </h1>
                <p style={{ fontSize: 14, color: GH.ink60, marginTop: 4 }}>
                    Привет, {currentUser.name?.split(' ')[0] || 'пользователь'}
                </p>
            </div>

            {/* KPI strip */}
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 0, borderTop: ghdoHairline, marginBottom: 32 }}>
                {/* Balance — в лари (₾). До 29.09 тут по ошибке стоял знак гривны (G3-04) */}
                <div style={{ padding: narrow ? '16px 0' : '20px 20px 20px 0', borderRight: narrow ? 'none' : ghdoHairline, borderBottom: narrow ? ghdoHairline : 'none' }}>
                    <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 8 }}>БАЛАНС</div>
                    <div style={{
                        fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700,
                        color: isNegative ? GH.danger : GH.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                    }}>
                        {/* Формат оставлен прежним: его проверяет сторож wave0_I
                            (test_dashboard_money_in_lari); toLocaleString('ru-RU') даёт те же «1 250 ₾». */}
                        {currentUser.balance?.toLocaleString('ru-RU') || '0'} ₾
                    </div>
                    {creditLimit > 0 && (
                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 6 }}>
                            Кредит: {availableCredit.toLocaleString('ru-RU')} ₾ из {creditLimit.toLocaleString('ru-RU')} ₾
                        </div>
                    )}
                </div>

                {/* Bonuses */}
                <div style={{ padding: narrow ? '16px 0' : '20px 20px 20px 20px', borderRight: narrow ? 'none' : ghdoHairline, borderBottom: narrow ? ghdoHairline : 'none' }}>
                    <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 8 }}>БОНУСЫ</div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1, color: activeBonuses.length > 0 ? GH.accent : GH.ink60 }}>
                        {totalBonusHours}
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 6 }}>
                        {activeBonuses.length > 0 ? 'часов бесплатной аренды' : 'нет активных бонусов'}
                    </div>
                </div>

                {/* Discount */}
                <div style={{ padding: narrow ? '16px 0' : '20px 0 20px 20px' }}>
                    <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 8 }}>СКИДКА</div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(32px, 4vw, 48px)', fontWeight: 700, lineHeight: 1 }}>
                        {currentUser.discountPercent || 0}%
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 6 }}>
                        текущий уровень
                    </div>
                </div>
            </div>

            {/* Specialist gate — booking is reserved for verified specialists.
                Until the user's role is `specialist` (or admin), the primary
                "+ Забронировать" CTA is replaced with a banner that links to
                /become-specialist. Saves a confused 403 round-trip. */}
            {(() => {
                const role = (currentUser.role || '').toLowerCase();
                const canBook = ['specialist', 'admin', 'senior_admin', 'owner'].includes(role);
                if (!canBook) {
                    return (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: 16, padding: '14px 18px', marginBottom: 20,
                            background: GH.ink, color: GH.paper, flexWrap: 'wrap',
                        }}>
                            <div style={{ fontSize: 13, lineHeight: 1.5, maxWidth: 520 }}>
                                Бронирование кабинетов доступно только верифицированным специалистам.
                                Заполните анкету — после одобрения админом сможете бронировать.
                            </div>
                            <button
                                onClick={() => navigate('/become-specialist')}
                                style={{
                                    padding: '8px 16px', background: GH.paper, color: GH.ink,
                                    border: 'none', cursor: 'pointer',
                                    fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase',
                                    fontWeight: 700,
                                }}
                            >
                                Заполнить анкету
                            </button>
                        </div>
                    );
                }
                return (
                    <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
                        <button
                            onClick={() => navigate('/dashboard/bookings')}
                            style={{
                                padding: '10px 20px', background: GH.ink, color: GH.paper, fontWeight: 700,
                                fontSize: 13, fontFamily: GH_SANS, border: 'none', cursor: 'pointer',
                            }}
                        >
                            + Забронировать кабинет
                        </button>
                    </div>
                );
            })()}
            <QuickActionsStrip
                actions={[
                    { label: 'Оформить абонемент', sub: 'Выгоднее почасовой аренды', path: '/subscriptions', icon: CalendarPlus },
                    { label: 'Получить бонусы', sub: 'Приведите друга — бонус обоим', path: '/dashboard/bonuses', icon: Gift },
                    { label: 'Стать специалистом', sub: 'Заявка в публичный каталог', path: '/become-specialist', icon: UserCheck },
                ]}
                heading="Что дальше"
            />

            {/* Two-column: bookings + payments */}
            <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1fr 1fr', gap: narrow ? 24 : 32 }}>
                {/* Recent bookings */}
                <div>
                    <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 12 }}>БЛИЖАЙШИЕ БРОНИРОВАНИЯ</div>
                    {recentBookings.length === 0 ? (
                        <div style={{ padding: 24, border: ghdoHairline, color: GH.ink60, fontSize: 13, textAlign: 'center' }}>
                            Нет бронирований
                        </div>
                    ) : (
                        <div style={{ border: ghdoHairline }}>
                            {recentBookings.map((b, i) => {
                                const resName = RESOURCES.find(r => r.id === b.resourceId)?.name || b.resourceId;
                                return (
                                    <div key={i} style={{ padding: '14px 16px', borderBottom: i < recentBookings.length - 1 ? ghdoHairline : 'none' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <div style={{ fontSize: 14, fontWeight: 600 }}>{resName}</div>
                                            <StatusBadge kind="booking" status={b.status} className="shrink-0" />
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60 }}>
                                            {formatBookingDate(b.date)} · {formatTimeRange(b.startTime, b.endTime)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Recent transactions */}
                <div>
                    <div style={{ ...ghdoMono, color: GH.ink60, marginBottom: 12 }}>ПОСЛЕДНИЕ ПЛАТЕЖИ</div>
                    {recentTransactions.length === 0 ? (
                        <div style={{ padding: 24, border: ghdoHairline, color: GH.ink60, fontSize: 13, textAlign: 'center' }}>
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
                                            <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, marginTop: 2 }}>
                                                {formatBookingDate(t.createdAt)}
                                            </div>
                                        </div>
                                        <span style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, color: t.amount >= 0 ? STATUS.ok.fg : GH.danger }}>
                                            {formatMoney(t.amount, { currency: t.currency || 'GEL', sign: true })}
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
                <span style={{ ...ghdoMono, color: GH.ink60 }}>UNBOX · 2026</span>
                <span style={{ ...ghdoMono, color: GH.ink60 }}>Батуми · Грузия</span>
            </footer>
        </div>
    );
}
