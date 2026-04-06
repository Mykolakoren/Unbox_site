import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { RESOURCES } from '../../utils/data';
import { format } from 'date-fns';
import { Search, LayoutGrid, List, Check, X, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { AdminChessboardView } from '../../components/admin/AdminChessboardView';
import { bookingsApi } from '../../api/bookings';
import { toast } from 'sonner';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { BookingHistoryItem } from '../../store/types';

type ViewMode = 'list' | 'grid';

export function AdminBookings() {
    const gridHouse = useDesignFlag();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { bookings, users, fetchUsers, cancelBooking, listForReRent, setManualPrice } = useUserStore();
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [viewMode, setViewMode] = useState<ViewMode>('list');

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const getUserName = (email: string) => {
        const u = users.find(u => u.email === email);
        return u ? u.name : email;
    };

    const filteredBookings = bookings
        .filter(b => {
            if (filterStatus !== 'all' && b.status !== filterStatus) return false;
            if (search) {
                const term = search.toLowerCase();
                const userName = (getUserName(b.userId) || '').toLowerCase();
                const userId = (b.userId || '').toLowerCase();
                const bookingId = (b.id || '').toLowerCase();
                return userName.includes(term) || userId.includes(term) || bookingId.includes(term);
            }
            return true;
        })
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const handleEditPrice = (bookingId: string, currentPrice: number) => {
        const newPriceString = prompt('Введите новую цену (GEL):', currentPrice.toString());
        if (newPriceString !== null) {
            const newPrice = parseFloat(newPriceString);
            if (!isNaN(newPrice)) setManualPrice(bookingId, newPrice);
        }
    };

    const handleCancel = (bookingId: string) => {
        if (confirm('Вы уверены, что хотите отменить это бронирование?')) {
            cancelBooking(bookingId);
        }
    };

    const handleReRent = (bookingId: string) => {
        if (confirm('Выставить этот слот на переаренду?')) {
            listForReRent(bookingId);
        }
    };

    const [approvingId, setApprovingId] = useState<string | null>(null);
    const [rejectingId, setRejectingId] = useState<string | null>(null);

    const handleApprove = async (bookingId: string) => {
        setApprovingId(bookingId);
        try {
            await bookingsApi.approveBooking(bookingId);
            toast.success('Бронь одобрена');
            // Refresh bookings
            useUserStore.getState().fetchAllBookings();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка при одобрении');
        }
        setApprovingId(null);
    };

    const handleReject = async (bookingId: string) => {
        if (!confirm('Отклонить горячую бронь?')) return;
        setRejectingId(bookingId);
        try {
            await bookingsApi.rejectBooking(bookingId);
            toast.success('Бронь отклонена');
            useUserStore.getState().fetchAllBookings();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка при отклонении');
        }
        setRejectingId(null);
    };

    if (gridHouse) return (
        <GridHouseAdminBookings
            bookings={bookings}
            filteredBookings={filteredBookings}
            viewMode={viewMode} setViewMode={setViewMode}
            filterStatus={filterStatus} setFilterStatus={setFilterStatus}
            search={search} setSearch={setSearch}
            navigate={navigate}
            getUserName={getUserName}
            handleEditPrice={handleEditPrice}
            handleCancel={handleCancel}
            handleReRent={handleReRent}
            handleApprove={handleApprove}
            handleReject={handleReject}
            approvingId={approvingId}
            rejectingId={rejectingId}
        />
    );

    return (
        <div className="space-y-6">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Бронирования</h1>
                    <p className="text-sm text-unbox-grey mt-0.5">
                        {bookings.length} всего · {bookings.filter(b => b.status === 'confirmed').length} активных
                        {bookings.filter(b => b.status === 'pending_approval').length > 0 && (
                            <span className="text-amber-600 font-medium"> · {bookings.filter(b => b.status === 'pending_approval').length} ожидают</span>
                        )}
                    </p>
                </div>

                <div className="flex gap-2 w-full sm:w-auto items-center">
                    {/* View toggle */}
                    <div className="flex rounded-lg border border-unbox-light overflow-hidden bg-white">
                        <button
                            onClick={() => setViewMode('list')}
                            className={clsx(
                                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                                viewMode === 'list'
                                    ? 'bg-unbox-green text-white'
                                    : 'text-unbox-grey hover:bg-unbox-light/50'
                            )}
                        >
                            <List size={15} /> Список
                        </button>
                        <button
                            onClick={() => setViewMode('grid')}
                            className={clsx(
                                'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
                                viewMode === 'grid'
                                    ? 'bg-unbox-green text-white'
                                    : 'text-unbox-grey hover:bg-unbox-light/50'
                            )}
                        >
                            <LayoutGrid size={15} /> Шахматка
                        </button>
                    </div>

                    {/* List-only controls */}
                    {viewMode === 'list' && (
                        <>
                            <div className="relative flex-1 sm:flex-none">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                                <input
                                    type="text"
                                    placeholder="Поиск..."
                                    className="pl-9 pr-4 py-2 rounded-lg border border-unbox-light focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm w-full sm:w-56"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                            <select
                                className="px-3 py-2 rounded-lg border border-unbox-light bg-white focus:outline-none focus:ring-2 focus:ring-unbox-green text-sm"
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                            >
                                <option value="all">Все статусы</option>
                                <option value="pending_approval">⏳ Ожидает одобрения</option>
                                <option value="confirmed">Подтверждено</option>
                                <option value="cancelled">Отменено</option>
                                <option value="re-rented">Пересдано</option>
                            </select>
                        </>
                    )}
                </div>
            </div>

            {/* ── Chessboard view ── */}
            {viewMode === 'grid' && <AdminChessboardView />}

            {/* ── List view ── */}
            {viewMode === 'list' && (
                <div className="bg-white rounded-xl border border-unbox-light overflow-hidden shadow-sm overflow-x-auto">
                    <table className="w-full text-left whitespace-nowrap">
                        <thead className="bg-unbox-light border-b border-unbox-light text-unbox-grey font-medium text-sm">
                            <tr>
                                <th className="p-4 pl-6">Создано</th>
                                <th className="p-4">Клиент</th>
                                <th className="p-4">Ресурс</th>
                                <th className="p-4">Дата и Время</th>
                                <th className="p-4 text-center">Статус</th>
                                <th className="p-4 text-right">Цена</th>
                                <th className="p-4 text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-unbox-light">
                            {filteredBookings.map(booking => {
                                const resourceName = RESOURCES.find(r => r.id === booking.resourceId)?.name || booking.resourceId;
                                return (
                                    <tr key={booking.id} className="hover:bg-unbox-light/30 transition-colors text-sm">
                                        <td className="p-4 pl-6 text-unbox-grey">
                                            {format(new Date(booking.createdAt), 'dd.MM HH:mm')}
                                        </td>
                                        <td className="p-4 font-medium text-unbox-dark">
                                            <div
                                                onClick={() => navigate(`/admin/users/${encodeURIComponent(booking.userId)}`)}
                                                className="cursor-pointer hover:text-unbox-green transition-colors group"
                                            >
                                                <div className="group-hover:underline">{getUserName(booking.userId)}</div>
                                                <div className="text-xs text-unbox-grey font-normal">{booking.userId}</div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-unbox-dark">
                                            {resourceName}
                                            <div className="text-xs text-unbox-grey">
                                                {booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'}
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="flex items-center gap-2 text-unbox-dark">
                                                <CalendarIcon size={14} className="text-unbox-grey" />
                                                {format(booking.date, 'dd.MM.yyyy')}
                                            </div>
                                            <div className="flex items-center gap-2 text-unbox-grey mt-1">
                                                <ClockIcon size={14} className="text-unbox-grey" />
                                                {booking.startTime} ({(booking.duration ?? 0) / 60}ч)
                                            </div>
                                        </td>
                                        <td className="p-4 text-center">
                                            <span className={clsx(
                                                'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
                                                {
                                                    'bg-unbox-light text-unbox-green': booking.status === 'confirmed',
                                                    'bg-unbox-light/50 text-unbox-grey': booking.status === 'cancelled',
                                                    'bg-white border border-unbox-green text-unbox-green': booking.status === 're-rented',
                                                    'bg-amber-50 text-amber-700 border border-amber-200': booking.status === 'pending_approval',
                                                }
                                            )}>
                                                {booking.status === 'confirmed' && 'Активно'}
                                                {booking.status === 'cancelled' && 'Отменено'}
                                                {booking.status === 're-rented' && 'Пересдано'}
                                                {booking.status === 'pending_approval' && '⏳ Ожидает'}
                                            </span>
                                            {booking.isReRentListed && booking.status === 'confirmed' && (
                                                <div className="mt-1 text-[10px] text-amber-600 font-medium bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                                    На переаренде
                                                </div>
                                            )}
                                        </td>
                                        <td className="p-4 text-right font-medium">
                                            {booking.paymentMethod === 'subscription' ? (
                                                <span className="text-unbox-green text-sm">Абонемент</span>
                                            ) : (
                                                <span className="text-unbox-dark">{booking.finalPrice} ₾</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                {booking.status === 'pending_approval' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleApprove(booking.id)}
                                                            disabled={approvingId === booking.id}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-unbox-green text-white text-xs font-medium hover:bg-unbox-dark transition-colors disabled:opacity-50"
                                                        >
                                                            {approvingId === booking.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                            Одобрить
                                                        </button>
                                                        <button
                                                            onClick={() => handleReject(booking.id)}
                                                            disabled={rejectingId === booking.id}
                                                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors disabled:opacity-50"
                                                        >
                                                            {rejectingId === booking.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                                                            Отклонить
                                                        </button>
                                                    </>
                                                )}
                                                {booking.status === 'confirmed' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                            className="text-unbox-grey hover:text-unbox-green text-xs underline"
                                                        >
                                                            Цена
                                                        </button>
                                                        {!booking.isReRentListed && (
                                                            <button
                                                                onClick={() => handleReRent(booking.id)}
                                                                className="text-unbox-grey hover:text-unbox-green text-xs underline"
                                                            >
                                                                Пересдать
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => handleCancel(booking.id)}
                                                            className="text-unbox-grey hover:text-red-600 text-xs underline"
                                                        >
                                                            Отмена
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {filteredBookings.length === 0 && (
                        <div className="p-12 text-center text-unbox-grey">
                            Бронирований не найдено
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─── Inline SVG icons (avoids Calendar name collision) ────────────────────────
const CalendarIcon = ({ size, className }: { size: number; className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
        <line x1="16" x2="16" y1="2" y2="6" />
        <line x1="8" x2="8" y1="2" y2="6" />
        <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
);

const ClockIcon = ({ size, className }: { size: number; className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
    </svg>
);

// ═══════════════════════════════════════════════════════════════════════════════
//  GRID HOUSE — AdminBookings
// ═══════════════════════════════════════════════════════════════════════════════

const ghabMono: React.CSSProperties = {
    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const,
};
const ghabHairline = `1px solid ${GH.ink10}`;

interface GHAdminBookingsProps {
    bookings: BookingHistoryItem[];
    filteredBookings: BookingHistoryItem[];
    viewMode: ViewMode;
    setViewMode: (m: ViewMode) => void;
    filterStatus: string;
    setFilterStatus: (s: string) => void;
    search: string;
    setSearch: (s: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    getUserName: (email: string) => string;
    handleEditPrice: (bookingId: string, currentPrice: number) => void;
    handleCancel: (bookingId: string) => void;
    handleReRent: (bookingId: string) => void;
    handleApprove: (bookingId: string) => Promise<void>;
    handleReject: (bookingId: string) => Promise<void>;
    approvingId: string | null;
    rejectingId: string | null;
}

function GridHouseAdminBookings(props: GHAdminBookingsProps) {
    const {
        bookings, filteredBookings, viewMode, setViewMode,
        filterStatus, setFilterStatus, search, setSearch,
        navigate, getUserName, handleEditPrice, handleCancel,
        handleReRent, handleApprove, handleReject,
        approvingId, rejectingId,
    } = props;

    const MONO_LABEL: React.CSSProperties = {
        ...ghabMono,
        fontWeight: 500,
        color: GH.ink60,
    };

    const totalFmt = String(bookings.length).padStart(3, '0');
    const activeCount = bookings.filter((b) => b.status === 'confirmed').length;
    const pendingCount = bookings.filter((b) => b.status === 'pending_approval').length;

    const statusOptions = [
        { value: 'all', label: 'Все' },
        { value: 'pending_approval', label: 'Ожидает' },
        { value: 'confirmed', label: 'Актив' },
        { value: 'cancelled', label: 'Отмена' },
        { value: 're-rented', label: 'Пересд.' },
    ];

    const statusText = (s: string) =>
        s === 'confirmed' ? 'Актив'
        : s === 'cancelled' ? 'Отмена'
        : s === 're-rented' ? 'Пересд.'
        : s === 'pending_approval' ? 'Ожидает'
        : s;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 20, marginBottom: 32 }}>
                <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 8 }}>ADMIN · BOOKINGS</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                    <h1
                        style={{
                            fontSize: 'clamp(28px, 3.5vw, 42px)',
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            lineHeight: 1.1,
                            margin: 0,
                        }}
                    >
                        Поток броней.
                    </h1>
                    {/* View toggle */}
                    <div style={{ display: 'flex' }}>
                        {(['list', 'grid'] as const).map((m, i) => (
                            <button key={m} onClick={() => setViewMode(m)}
                                style={{
                                    padding: '6px 16px', border: 'none', cursor: 'pointer',
                                    fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                    background: viewMode === m ? GH.ink : 'transparent',
                                    color: viewMode === m ? GH.paper : GH.ink60,
                                    borderTop: ghabHairline, borderBottom: ghabHairline,
                                    borderLeft: ghabHairline,
                                    borderRight: i === 1 ? ghabHairline : 'none',
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                }}>
                                {m === 'list' ? <><List size={10} /> СПИСОК</> : <><LayoutGrid size={10} /> ШАХМАТКА</>}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── KPI strip ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 32, marginBottom: 32, alignItems: 'end' }}>
                <div>
                    <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 4 }}>ВСЕГО</p>
                    <span style={{ fontFamily: GH_MONO, fontSize: 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {totalFmt}
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 28, paddingBottom: 6, flexWrap: 'wrap' }}>
                    <div>
                        <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 2 }}>АКТИВ</p>
                        <span style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 600, color: GH.accent }}>{String(activeCount).padStart(3, '0')}</span>
                    </div>
                    {pendingCount > 0 && (
                        <div>
                            <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 2 }}>ОЖИДАЕТ</p>
                            <span style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 600, color: GH.danger }}>{String(pendingCount).padStart(3, '0')}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Grid view = chessboard (legacy component) ── */}
            {viewMode === 'grid' && (
                <div style={{ border: ghabHairline, padding: 20, background: GH.paper }}>
                    <div style={{ ...ghabMono, color: GH.ink30, marginBottom: 16 }}>ШАХМАТКА · LEGACY VIEW</div>
                    <AdminChessboardView />
                </div>
            )}

            {/* ── List view ── */}
            {viewMode === 'list' && (
                <>
                    {/* Filters */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'end', marginBottom: 28 }}>
                        <div>
                            <div style={{ ...MONO_LABEL, marginBottom: 8 }}>ПОИСК</div>
                            <div style={{ position: 'relative', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8 }}>
                                <Search style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-80%)', width: 14, height: 14, color: GH.ink60 }} />
                                <input
                                    type="text"
                                    placeholder="Клиент, ID брони..."
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    style={{
                                        width: '100%',
                                        paddingLeft: 24,
                                        paddingRight: 28,
                                        background: 'transparent',
                                        border: 'none',
                                        outline: 'none',
                                        fontFamily: GH_SANS,
                                        fontSize: 15,
                                        color: GH.ink,
                                    }}
                                />
                                {search && (
                                    <button
                                        onClick={() => setSearch('')}
                                        style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-80%)', background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 0, border: `1px solid ${GH.ink}` }}>
                            {statusOptions.map((o) => {
                                const active = filterStatus === o.value;
                                return (
                                    <button
                                        key={o.value}
                                        onClick={() => setFilterStatus(o.value)}
                                        style={{
                                            fontFamily: GH_MONO,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            letterSpacing: '0.12em',
                                            textTransform: 'uppercase',
                                            padding: '10px 14px',
                                            background: active ? GH.ink : 'transparent',
                                            color: active ? GH.paper : GH.ink,
                                            border: 'none',
                                            borderRight: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                        }}
                                    >
                                        {o.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {filteredBookings.length === 0 ? (
                        <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghabHairline, padding: '80px 24px', textAlign: 'center' }}>
                            <div style={{ ...ghabMono, color: GH.ink30, marginBottom: 14 }}>EMPTY</div>
                            <h2
                                style={{
                                    fontSize: 'clamp(28px, 3.5vw, 42px)',
                                    fontWeight: 800,
                                    letterSpacing: '-0.02em',
                                    lineHeight: 1.1,
                                    margin: 0,
                                }}
                            >
                                Броней не найдено.
                            </h2>
                        </div>
                    ) : (
                        <div style={{ borderTop: `2px solid ${GH.ink}`, overflowX: 'auto' }}>
                            {/* ── Table head ── */}
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '56px 110px 1fr 1fr 120px 100px 110px 180px',
                                    gap: 14,
                                    padding: '8px 0',
                                    borderBottom: ghabHairline,
                                    minWidth: 1100,
                                }}
                            >
                                {['#', 'СОЗДАНО', 'КЛИЕНТ', 'РЕСУРС', 'ДАТА · ВРЕМЯ', 'СТАТУС', 'ЦЕНА', 'ДЕЙСТВИЯ'].map((h, i) => (
                                    <span
                                        key={i}
                                        style={{
                                            ...ghabMono,
                                            color: GH.ink30,
                                            textAlign: i === 5 ? 'center' : i >= 6 ? 'right' : undefined,
                                        }}
                                    >
                                        {h}
                                    </span>
                                ))}
                            </div>

                            {/* ── Table rows ── */}
                            {filteredBookings.map((booking, idx) => {
                                const resourceName = RESOURCES.find((r) => r.id === booking.resourceId)?.name || booking.resourceId;
                                const statusColor =
                                    booking.status === 'confirmed' ? GH.ink
                                    : booking.status === 'pending_approval' ? GH.danger
                                    : booking.status === 're-rented' ? GH.accent
                                    : GH.ink30;

                                return (
                                    <div
                                        key={booking.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '56px 110px 1fr 1fr 120px 100px 110px 180px',
                                            gap: 14,
                                            padding: '16px 0',
                                            borderBottom: ghabHairline,
                                            alignItems: 'center',
                                            minWidth: 1100,
                                        }}
                                    >
                                        <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.1em' }}>
                                            {String(idx + 1).padStart(3, '0')}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                            {format(new Date(booking.createdAt), 'dd.MM · HH:mm')}
                                        </div>
                                        <div
                                            onClick={() => navigate(`/admin/users/${encodeURIComponent(booking.userId)}`)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <div style={{ fontSize: 14, fontWeight: 700, color: GH.ink, letterSpacing: '-0.005em' }}>
                                                {getUserName(booking.userId)}
                                            </div>
                                            <div style={{ ...ghabMono, color: GH.ink30, marginTop: 2 }}>{booking.userId}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 13, color: GH.ink, letterSpacing: '-0.005em' }}>{resourceName}</div>
                                            <div style={{ ...ghabMono, color: GH.ink60, marginTop: 2 }}>
                                                {booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'}
                                            </div>
                                        </div>
                                        <div>
                                            <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                                {format(booking.date, 'dd.MM.yyyy')}
                                            </div>
                                            <div style={{ ...ghabMono, color: GH.ink60, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>
                                                {booking.startTime} · {(booking.duration ?? 0) / 60}ч
                                            </div>
                                        </div>
                                        <div style={{ textAlign: 'center' }}>
                                            <span
                                                style={{
                                                    fontFamily: GH_MONO,
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    letterSpacing: '0.14em',
                                                    textTransform: 'uppercase',
                                                    padding: '4px 8px',
                                                    color: statusColor,
                                                    border: `1px solid ${statusColor}`,
                                                }}
                                            >
                                                {statusText(booking.status)}
                                            </span>
                                            {booking.isReRentListed && booking.status === 'confirmed' && (
                                                <div style={{ ...ghabMono, color: GH.danger, marginTop: 4 }}>ПЕРЕАРЕНДА</div>
                                            )}
                                        </div>
                                        <div
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 14,
                                                fontWeight: 600,
                                                textAlign: 'right',
                                                color: GH.ink,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {booking.paymentMethod === 'subscription' ? 'Абон.' : `${booking.finalPrice} ₾`}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                                            {booking.status === 'pending_approval' && (
                                                <>
                                                    <button
                                                        onClick={() => handleApprove(booking.id)}
                                                        disabled={approvingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 10,
                                                            fontWeight: 600,
                                                            letterSpacing: '0.12em',
                                                            textTransform: 'uppercase',
                                                            padding: '5px 8px',
                                                            background: GH.ink,
                                                            color: GH.paper,
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 4,
                                                        }}
                                                    >
                                                        {approvingId === booking.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                                        OK
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(booking.id)}
                                                        disabled={rejectingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 10,
                                                            fontWeight: 600,
                                                            letterSpacing: '0.12em',
                                                            textTransform: 'uppercase',
                                                            padding: '5px 8px',
                                                            background: 'transparent',
                                                            color: GH.danger,
                                                            border: `1px solid ${GH.danger}`,
                                                            cursor: 'pointer',
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 4,
                                                        }}
                                                    >
                                                        {rejectingId === booking.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
                                                        Откл.
                                                    </button>
                                                </>
                                            )}
                                            {booking.status === 'confirmed' && (
                                                <>
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 10,
                                                            letterSpacing: '0.1em',
                                                            textTransform: 'uppercase',
                                                            background: 'transparent',
                                                            color: GH.ink60,
                                                            border: 'none',
                                                            borderBottom: `1px solid ${GH.ink10}`,
                                                            cursor: 'pointer',
                                                            padding: '2px 4px',
                                                        }}
                                                    >
                                                        Цена
                                                    </button>
                                                    {!booking.isReRentListed && (
                                                        <button
                                                            onClick={() => handleReRent(booking.id)}
                                                            style={{
                                                                fontFamily: GH_MONO,
                                                                fontSize: 10,
                                                                letterSpacing: '0.1em',
                                                                textTransform: 'uppercase',
                                                                background: 'transparent',
                                                                color: GH.ink60,
                                                                border: 'none',
                                                                borderBottom: `1px solid ${GH.ink10}`,
                                                                cursor: 'pointer',
                                                                padding: '2px 4px',
                                                            }}
                                                        >
                                                            Пересд.
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 10,
                                                            letterSpacing: '0.1em',
                                                            textTransform: 'uppercase',
                                                            background: 'transparent',
                                                            color: GH.danger,
                                                            border: 'none',
                                                            borderBottom: `1px solid ${GH.ink10}`,
                                                            cursor: 'pointer',
                                                            padding: '2px 4px',
                                                        }}
                                                    >
                                                        Отмена
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 48, paddingTop: 16 }}>
                <p style={{ ...ghabMono, color: GH.ink30 }}>UNBOX ADMIN · 2026</p>
            </div>
        </div>
    );
}
