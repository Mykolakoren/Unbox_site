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
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { BookingHistoryItem } from '../../store/types';
import { ConfirmationModal, PromptModal } from '../../components/ui/ConfirmationModal';
import { AdminCancelBookingModal } from '../../components/admin/AdminCancelBookingModal';

type ViewMode = 'list' | 'grid';

// Grid House style primitives — survive the dual-UI cleanup. These were
// originally declared at the bottom of the file alongside the inlined GH
// component; consolidating up here so they're easier to find.
const ghabMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase' as const,
};
const ghabHairline = `1px solid ${GH.ink10}`;

// Card-style action button used in list view (per-booking action row).
const ghActionBtn = (color: string, borderColor: string): React.CSSProperties => ({
    fontFamily: GH_MONO,
    fontSize: 9,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    background: 'transparent',
    color,
    border: `1px solid ${borderColor}`,
    cursor: 'pointer',
    padding: '5px 10px',
});

// Underlined-text style button used inside the dense table view.
const ghTableLinkBtn = (color: string): React.CSSProperties => ({
    fontFamily: GH_MONO,
    fontSize: 10,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    background: 'transparent',
    color,
    border: 'none',
    borderBottom: `1px solid ${GH.ink10}`,
    cursor: 'pointer',
    padding: '2px 4px',
});

export function AdminBookings() {
    const [searchParams] = useSearchParams();
    // Excel #59 — ?view=grid deep-link from "Перенести" action flips to the
    // chessboard right away so the highlighted booking is visible.
    const viewFromQuery = searchParams.get('view');
    const navigate = useNavigate();
    const { bookings, users, fetchUsers, cancelBooking, listForReRent, setManualPrice } = useUserStore();
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [search, setSearch] = useState(searchParams.get('search') || '');
    const [viewMode, setViewMode] = useState<ViewMode>(viewFromQuery === 'grid' ? 'grid' : 'list');

    // Modal state for replacing native confirm/prompt
    const [confirmModal, setConfirmModal] = useState<{ open: boolean; title: string; message: string; onConfirm: () => void; destructive?: boolean }>({ open: false, title: '', message: '', onConfirm: () => {} });
    const [priceModal, setPriceModal] = useState<{ open: boolean; bookingId: string; currentPrice: number }>({ open: false, bookingId: '', currentPrice: 0 });

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
        setPriceModal({ open: true, bookingId, currentPrice });
    };

    // Excel #66 — instead of a yes/no confirm, open the admin cancel modal
    // so the admin picks refund policy (100% / 50% / 0%) and records a reason
    // for anything other than the default full refund.
    const [cancelModal, setCancelModal] = useState<{ open: boolean; bookingId: string; label: string }>({ open: false, bookingId: '', label: '' });
    const handleCancel = (bookingId: string) => {
        const b = bookings.find(x => x.id === bookingId);
        const userName = b ? getUserName(b.userId) : '';
        const label = b ? `${userName} · ${b.startTime} · ${b.finalPrice}₾` : '';
        setCancelModal({ open: true, bookingId, label });
    };
    const handleCancelConfirm = async (option: 'full' | 'half' | 'none', reason: string) => {
        const refundPercent = option === 'full' ? 1.0 : option === 'half' ? 0.5 : 0.0;
        try {
            await cancelBooking(cancelModal.bookingId, undefined, undefined, undefined, {
                refundPercent,
                reason: reason || undefined,
            });
            const msg = option === 'full'
                ? 'Бронь отменена, возврат 100%'
                : option === 'half'
                ? 'Бронь отменена, возврат 50%'
                : 'Бронь отменена, возврат 0% (штраф)';
            toast.success(msg);
        } catch {
            // cancelBooking slice already shows an error toast
        }
    };

    // Excel #67: same button toggles. Previously the modal always said
    // "выставить на переаренду" and the toast always said "выставлен" — even
    // when the user was actually trying to remove a re-rent listing. Now we
    // branch on current state and await so the toast reflects what actually
    // happened (or what failed).
    const handleReRent = (bookingId: string) => {
        const booking = bookings.find(b => b.id === bookingId);
        const isCurrentlyListed = !!booking?.isReRentListed;
        setConfirmModal({
            open: true,
            title: isCurrentlyListed ? 'Снять с переаренды' : 'Переаренда',
            message: isCurrentlyListed
                ? 'Снять этот слот с переаренды? Бронь снова будет видна только владельцу.'
                : 'Выставить этот слот на переаренду? Если другой пользователь забронирует, текущая бронь будет отменена с 50% возвратом.',
            onConfirm: async () => {
                try {
                    await listForReRent(bookingId);
                    toast.success(isCurrentlyListed ? 'Слот снят с переаренды' : 'Слот выставлен на переаренду');
                    // Make sure the chessboard view also picks up the new flag.
                    useUserStore.getState().fetchAllBookings();
                } catch {
                    // listForReRent already toasts the error
                }
            },
        });
    };

    // Excel #28 — restore the lost "Продлить +30 мин" action for admins.
    const [extendingId, setExtendingId] = useState<string | null>(null);
    const handleExtend = (bookingId: string) => {
        setConfirmModal({
            open: true,
            title: 'Продлить бронь на 30 минут',
            message: 'Увеличит длительность текущей брони на 30 минут. Проверит, что следующий слот свободен.',
            onConfirm: async () => {
                setExtendingId(bookingId);
                try {
                    await bookingsApi.extendBooking(bookingId, 30);
                    toast.success('Бронь продлена на 30 минут');
                    useUserStore.getState().fetchAllBookings();
                } catch (e: any) {
                    toast.error(e?.response?.data?.detail || 'Не удалось продлить — возможно, следующий слот занят');
                } finally {
                    setExtendingId(null);
                }
            },
        });
    };

    // Excel #59 — "Перенести" navigates to the grid view with this booking
    // highlighted and scrolled into view. The admin then drags it to the new
    // slot using the existing drag-to-move handler in AdminChessboardView.
    const handleMove = (bookingId: string) => {
        navigate(`/admin/bookings?view=grid&highlight=${bookingId}`);
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
        setConfirmModal({
            open: true,
            title: 'Отклонить бронь',
            message: 'Отклонить горячую бронь? Средства будут возвращены клиенту.',
            destructive: true,
            onConfirm: async () => {
                setRejectingId(bookingId);
                try {
                    await bookingsApi.rejectBooking(bookingId);
                    toast.success('Бронь отклонена');
                    useUserStore.getState().fetchAllBookings();
                } catch (e: any) {
                    toast.error(e?.response?.data?.detail || 'Ошибка при отклонении');
                }
                setRejectingId(null);
            },
        });
    };

    // Shared modals rendered in both variants
    const modals = (
        <>
            <AdminCancelBookingModal
                isOpen={cancelModal.open}
                onClose={() => setCancelModal(p => ({ ...p, open: false }))}
                onConfirm={handleCancelConfirm}
                bookingLabel={cancelModal.label}
            />
            <ConfirmationModal
                isOpen={confirmModal.open}
                onClose={() => setConfirmModal(p => ({ ...p, open: false }))}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                isDestructive={confirmModal.destructive}
                confirmLabel={confirmModal.destructive ? 'Да, отменить' : 'Подтвердить'}
            />
            <PromptModal
                isOpen={priceModal.open}
                onClose={() => setPriceModal(p => ({ ...p, open: false }))}
                onSubmit={(val) => {
                    const newPrice = parseFloat(val);
                    if (!isNaN(newPrice) && newPrice >= 0) {
                        setManualPrice(priceModal.bookingId, newPrice);
                        toast.success(`Цена обновлена: ${newPrice} ₾`);
                    } else {
                        toast.error('Некорректная цена');
                    }
                }}
                title="Изменить цену"
                inputLabel="Новая цена (GEL)"
                inputType="number"
                defaultValue={priceModal.currentPrice.toString()}
                placeholder="0.00"
                submitLabel="Сохранить"
                validate={(v) => {
                    const n = parseFloat(v);
                    if (isNaN(n)) return 'Введите число';
                    if (n < 0) return 'Цена не может быть отрицательной';
                    return null;
                }}
            />
        </>
    );

    return (

        <>
            {modals}
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
                handleExtend={handleExtend}
                handleMove={handleMove}
                handleApprove={handleApprove}
                handleReject={handleReject}
                approvingId={approvingId}
                rejectingId={rejectingId}
                extendingId={extendingId}
            />
        </>
    );
}

type GHAdminBookingsProps = {
    bookings: BookingHistoryItem[];
    filteredBookings: BookingHistoryItem[];
    viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
    filterStatus: string; setFilterStatus: (s: string) => void;
    search: string; setSearch: (s: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    getUserName: (email: string) => string;
    handleEditPrice: (id: string, currentPrice: number) => void;
    handleCancel: (id: string) => void;
    handleReRent: (id: string) => void;
    handleExtend: (id: string) => void;
    handleMove: (id: string) => void;
    handleApprove: (id: string) => Promise<void>;
    handleReject: (id: string) => void;
    approvingId: string | null;
    rejectingId: string | null;
    extendingId: string | null;
};

function GridHouseAdminBookings(props: GHAdminBookingsProps) {
    const {
        bookings, filteredBookings, viewMode, setViewMode,
        filterStatus, setFilterStatus, search, setSearch,
        navigate, getUserName, handleEditPrice, handleCancel,
        handleReRent, handleExtend, handleMove, handleApprove, handleReject,
        approvingId, rejectingId, extendingId,
    } = props;

    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

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
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 14 : 20, marginBottom: narrow ? 16 : 32 }}>
                <p style={{ ...ghabMono, color: GH.ink30, marginBottom: narrow ? 6 : 8 }}>ADMIN · BOOKINGS</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: narrow ? 12 : 24, flexWrap: 'wrap' }}>
                    <h1
                        style={{
                            fontSize: narrow ? 24 : 'clamp(28px, 3.5vw, 42px)',
                            fontWeight: 800,
                            letterSpacing: '-0.02em',
                            lineHeight: 1.1,
                            margin: 0,
                        }}
                    >
                        Поток броней.
                    </h1>
                    {/* Add booking — Excel #70: was navigating to /checkout (dead route)
                        which silently fell through to '/'. Send admins straight to the
                        chessboard where they can create a booking by selecting a slot. */}
                    <button onClick={() => navigate('/dashboard/bookings')}
                        style={{
                            padding: narrow ? '5px 10px' : '6px 16px',
                            border: ghabHairline,
                            cursor: 'pointer',
                            fontFamily: GH_MONO,
                            fontSize: narrow ? 9 : 10,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            background: GH.ink,
                            color: GH.paper,
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            marginRight: narrow ? 4 : 8,
                        }}>
                        + БРОНЬ
                    </button>
                    {/* View toggle */}
                    <div style={{ display: 'flex' }}>
                        {(['list', 'grid'] as const).map((m, i) => (
                            <button key={m} onClick={() => setViewMode(m)}
                                style={{
                                    padding: narrow ? '5px 10px' : '6px 16px',
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontFamily: GH_MONO,
                                    fontSize: narrow ? 9 : 10,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    background: viewMode === m ? GH.ink : 'transparent',
                                    color: viewMode === m ? GH.paper : GH.ink60,
                                    borderTop: ghabHairline, borderBottom: ghabHairline,
                                    borderLeft: ghabHairline,
                                    borderRight: i === 1 ? ghabHairline : 'none',
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                }}>
                                {m === 'list' ? <><List size={10} /> {narrow ? 'СПИСОК' : 'СПИСОК'}</> : <><LayoutGrid size={10} /> {narrow ? 'ШАХ.' : 'ШАХМАТКА'}</>}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── KPI strip ── */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: narrow ? 18 : 32, marginBottom: narrow ? 18 : 32, flexWrap: 'wrap' }}>
                <div>
                    <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 4 }}>ВСЕГО</p>
                    <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 36 : 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>
                        {totalFmt}
                    </span>
                </div>
                <div>
                    <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 2 }}>АКТИВ</p>
                    <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 18 : 22, fontWeight: 600, color: GH.accent }}>{String(activeCount).padStart(3, '0')}</span>
                </div>
                {pendingCount > 0 && (
                    <div>
                        <p style={{ ...ghabMono, color: GH.ink30, marginBottom: 2 }}>ОЖИДАЕТ</p>
                        <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 18 : 22, fontWeight: 600, color: GH.danger }}>{String(pendingCount).padStart(3, '0')}</span>
                    </div>
                )}
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: narrow ? 12 : 18, marginBottom: narrow ? 16 : 28 }}>
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
                        <div style={{ display: 'flex', gap: 0, border: `1px solid ${GH.ink}`, flexWrap: 'wrap', overflowX: 'auto' }}>
                            {statusOptions.map((o) => {
                                const active = filterStatus === o.value;
                                return (
                                    <button
                                        key={o.value}
                                        onClick={() => setFilterStatus(o.value)}
                                        style={{
                                            fontFamily: GH_MONO,
                                            fontSize: narrow ? 9 : 10,
                                            fontWeight: 600,
                                            letterSpacing: '0.12em',
                                            textTransform: 'uppercase',
                                            padding: narrow ? '8px 10px' : '10px 14px',
                                            background: active ? GH.ink : 'transparent',
                                            color: active ? GH.paper : GH.ink,
                                            border: 'none',
                                            borderRight: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                            flex: narrow ? 1 : undefined,
                                            whiteSpace: 'nowrap',
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
                    ) : narrow ? (
                        /* ── Mobile card list ── */
                        <div style={{ borderTop: `2px solid ${GH.ink}` }}>
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
                                            padding: '14px 0',
                                            borderBottom: ghabHairline,
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 8,
                                        }}
                                    >
                                        {/* Top row: index, date, status, price */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                                <span style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink30, fontVariantNumeric: 'tabular-nums' }}>
                                                    {String(idx + 1).padStart(3, '0')}
                                                </span>
                                                <span style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                                    {format(booking.date, 'dd.MM')} · {booking.startTime}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <span
                                                    style={{
                                                        fontFamily: GH_MONO, fontSize: 9, fontWeight: 600,
                                                        letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                                                        padding: '3px 6px', color: statusColor,
                                                        border: `1px solid ${statusColor}`,
                                                    }}
                                                >
                                                    {statusText(booking.status)}
                                                </span>
                                                <span style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 700, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                                    {booking.paymentMethod === 'subscription' ? 'Абон.' : `${booking.finalPrice}₾`}
                                                </span>
                                            </div>
                                        </div>
                                        {/* Client */}
                                        <div
                                            onClick={() => navigate(`/admin/users/${encodeURIComponent(booking.userId)}`)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <div style={{ fontSize: 14, fontWeight: 700, color: GH.ink, letterSpacing: '-0.005em' }}>
                                                {getUserName(booking.userId)}
                                            </div>
                                            <div style={{ ...ghabMono, color: GH.ink60, marginTop: 2 }}>
                                                {resourceName} · {booking.locationId === 'unbox_one' ? 'One' : 'Uni'} · {(booking.duration ?? 0) / 60}ч
                                            </div>
                                        </div>
                                        {/* Actions */}
                                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            {booking.status === 'pending_approval' && (
                                                <>
                                                    <button
                                                        onClick={() => handleApprove(booking.id)}
                                                        disabled={approvingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO, fontSize: 9, fontWeight: 600,
                                                            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                                            padding: '6px 12px', background: GH.ink, color: GH.paper,
                                                            border: 'none', cursor: 'pointer',
                                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        }}
                                                    >
                                                        {approvingId === booking.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                                                        Принять
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(booking.id)}
                                                        disabled={rejectingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO, fontSize: 9, fontWeight: 600,
                                                            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
                                                            padding: '6px 12px', background: 'transparent', color: GH.danger,
                                                            border: `1px solid ${GH.danger}`, cursor: 'pointer',
                                                            display: 'inline-flex', alignItems: 'center', gap: 4,
                                                        }}
                                                    >
                                                        <X size={10} /> Отклонить
                                                    </button>
                                                </>
                                            )}
                                            {booking.status === 'confirmed' && (
                                                <>
                                                    <button
                                                        onClick={() => handleMove(booking.id)}
                                                        style={ghActionBtn(GH.ink60, GH.ink10)}
                                                        title="Перенести бронь — откроется шахматка"
                                                    >
                                                        Перенести
                                                    </button>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={ghActionBtn(GH.ink60, GH.ink10)}
                                                        title="Продлить бронь на 30 минут"
                                                    >
                                                        {extendingId === booking.id ? '...' : '+30 мин'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={ghActionBtn(GH.ink60, GH.ink10)}
                                                    >
                                                        Цена
                                                    </button>
                                                    <button
                                                        onClick={() => handleReRent(booking.id)}
                                                        style={ghActionBtn(GH.ink60, GH.ink10)}
                                                        title={booking.isReRentListed ? 'Снять с переаренды' : 'Поставить на переаренду'}
                                                    >
                                                        {booking.isReRentListed ? 'Снять с переаренды' : 'Пересдать'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        style={ghActionBtn(GH.danger, `${GH.danger}30`)}
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
                                                        onClick={() => handleMove(booking.id)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Перенести"
                                                    >
                                                        Перен.
                                                    </button>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Продлить +30 мин"
                                                    >
                                                        +30
                                                    </button>
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                    >
                                                        Цена
                                                    </button>
                                                    <button
                                                        onClick={() => handleReRent(booking.id)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title={booking.isReRentListed ? 'Снять с переаренды' : 'Поставить на переаренду'}
                                                    >
                                                        {booking.isReRentListed ? 'Снять' : 'Пересд.'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        style={ghTableLinkBtn(GH.danger)}
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
