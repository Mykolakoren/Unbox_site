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
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, TextArea } from '../../components/ui/Field';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { SkeletonList } from '../../components/ui/Skeleton';
import { STATUS } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { AdminCancelBookingModal, seriesTailOf, type CancelScope, type SeriesTail } from '../../components/admin/AdminCancelBookingModal';
import { BookingPriceModal } from '../../components/admin/BookingPriceModal';
import { ruCountWord } from '../../utils/plural';
import { ExtendBookingModal, AddExtrasModal } from '../../components/admin/BookingTodayEditModals';
import { subscriptionLifecycle } from '../../utils/subscription';
import { statusLabel } from '../../design/statuses';

type ViewMode = 'list' | 'grid';
type TimeFilter = 'all' | 'today' | 'upcoming' | 'completed';

// Момент начала брони в мс (Тбилиси-наивно, как хранится). Для хронологической
// сортировки и группировки список раньше сортировался по createdAt — «когда
// оформили», а не «когда бронь» — из-за чего порядок выглядел хаотично.
function bookingStartMs(b: BookingHistoryItem): number {
    try {
        const raw: any = b.date;
        const day = typeof raw === 'string'
            ? raw.split('T')[0].split(' ')[0]
            : new Date(raw).toISOString().split('T')[0];
        const t = (b as any).startTime || '00:00';
        const ms = new Date(`${day}T${t}`).getTime();
        return isNaN(ms) ? 0 : ms;
    } catch {
        return 0;
    }
}

// Куда бронь попадает относительно сегодняшнего дня (Тбилиси = локальное время
// админки). today | upcoming | past.
function bookingBucket(ms: number, now: Date = new Date()): 'today' | 'upcoming' | 'past' {
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const todayEnd = todayStart + 24 * 60 * 60 * 1000;
    if (ms >= todayStart && ms < todayEnd) return 'today';
    return ms >= todayEnd ? 'upcoming' : 'past';
}

// Grid House style primitives — survive the dual-UI cleanup. These were
// originally declared at the bottom of the file alongside the inlined GH
// component; consolidating up here so they're easier to find.
const ghabMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
};
const ghabHairline = `1px solid ${GH.ink10}`;

// Card-style action button used in list view (per-booking action row).
const ghActionBtn = (color: string, borderColor: string): React.CSSProperties => ({
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
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
    fontSize: 12,
    letterSpacing: '0.06em',
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
    const { bookings, users, fetchUsers, fetchAllBookings, cancelBooking, listForReRent } = useUserStore();
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
    const [search, setSearch] = useState(searchParams.get('search') || '');
    // Default view = chessboard (admin team works in shahmatka day-to-day).
    // Honour ?view=list in the URL so deep-links/bookmarks still open in
    // list mode if explicitly requested.
    const [viewMode, setViewMode] = useState<ViewMode>(viewFromQuery === 'list' ? 'list' : 'grid');

    // Подтверждения — общее окно с кнопками-действиями (wave 1), вместо
    // своего ConfirmationModal с «Да, отменить».
    const { confirm } = useConfirmDialog();
    // Правка цены — своё окно (BookingPriceModal): принимает «22,5», показывает,
    // сколько вернётся или спишется с баланса клиента.
    const [priceBooking, setPriceBooking] = useState<BookingHistoryItem | null>(null);
    const [extendModalId, setExtendModalId] = useState<string | null>(null);
    const [extrasModalId, setExtrasModalId] = useState<string | null>(null);

    // Полный админский список броней. При прямом заходе на /admin/bookings
    // в сторе лежат только «мои + публичные» брони от стартового
    // fetchBookings (у публичных нет имён), и по ним «Броней не найдено»
    // было бы неправдой. Поэтому грузим всё на mount (как Dashboard) и
    // до ответа показываем силуэты, при сбое — полосу с «Повторить».
    const [allListStatus, setAllListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
    const loadAllBookings = async () => {
        setAllListStatus(s => (s === 'ready' ? 'ready' : 'loading'));
        const ok = await fetchAllBookings();
        setAllListStatus(prev => (ok ? 'ready' : prev === 'ready' ? 'ready' : 'error'));
    };
    // Только для списка: шахматка (AdminChessboardView) сама грузит полный
    // список на mount — иначе два одинаковых тяжёлых запроса (6000+ броней).
    useEffect(() => {
        if (viewMode !== 'list' || allListStatus === 'ready') return;
        void loadAllBookings();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewMode]);

    useEffect(() => {
        // На mount — один раз. Дополнительно дёргаем при возврате на вкладку,
        // т.к. имена клиентов в шахматке зависят от users[]; если фетч на
        // mount упал по таймауту (мобильная сеть, blip) — на следующем
        // фокусе подтянется и слоты перерисуются с именами вместо email'ов.
        fetchUsers();
        const onFocus = () => {
            if (document.visibilityState === 'visible') fetchUsers();
        };
        document.addEventListener('visibilitychange', onFocus);
        window.addEventListener('focus', onFocus);
        return () => {
            document.removeEventListener('visibilitychange', onFocus);
            window.removeEventListener('focus', onFocus);
        };
    }, [fetchUsers]);

    const getUserName = (email: string) => {
        const u = users.find(u => u.email === email || u.id === email);
        if (u?.name) return u.name;
        // Fallback: если userStore ещё не догрузил юзера (timing race на
        // мобильном) — показываем хотя бы префикс email, а не «полный
        // адрес как имя клиента». Также покрывает случай когда у юзера
        // в БД нет name (редко, но возможно для legacy-аккаунтов).
        if (typeof email === 'string' && email.includes('@')) return email.split('@')[0];
        return (email || '').slice(0, 12) || 'Гость';
    };

    const nowRef = new Date();
    const filteredBookings = bookings
        .filter(b => {
            if (filterStatus !== 'all' && b.status !== filterStatus) return false;
            if (timeFilter !== 'all') {
                const bk = bookingBucket(bookingStartMs(b), nowRef);
                if (timeFilter === 'today' && bk !== 'today') return false;
                if (timeFilter === 'upcoming' && bk !== 'upcoming') return false;
                if (timeFilter === 'completed' && bk !== 'past') return false;
            }
            if (search) {
                const term = search.toLowerCase();
                const userName = (getUserName(b.userId) || '').toLowerCase();
                const userId = (b.userId || '').toLowerCase();
                const bookingId = (b.id || '').toLowerCase();
                return userName.includes(term) || userId.includes(term) || bookingId.includes(term);
            }
            return true;
        })
        // Хронологически: сначала СЕГОДНЯШНИЕ (по времени), затем предстоящие
        // (по времени), затем прошлые (свежие сверху). Раньше сортировали по
        // createdAt — «когда оформили», из-за чего порядок не совпадал с днём.
        .sort((a, b) => {
            const ma = bookingStartMs(a);
            const mb = bookingStartMs(b);
            const rank = (ms: number) => {
                const bk = bookingBucket(ms, nowRef);
                return bk === 'today' ? 0 : bk === 'upcoming' ? 1 : 2;
            };
            const ra = rank(ma);
            const rb = rank(mb);
            if (ra !== rb) return ra - rb;
            // сегодня и предстоящие — раньше выше; прошлые — свежие выше
            return ra === 2 ? mb - ma : ma - mb;
        });

    const handleEditPrice = (bookingId: string, _currentPrice?: number) => {
        setPriceBooking(bookings.find(b => b.id === bookingId) || null);
    };

    // Excel #66 — instead of a yes/no confirm, open the admin cancel modal
    // so the admin picks refund policy (100% / 50% / 0%) and records a reason
    // for anything other than the default full refund.
    const [cancelModal, setCancelModal] = useState<{
        open: boolean; bookingId: string; label: string;
        // Excel #24 — бронь из серии: выбор «только эту / эту и следующие»
        // делается прямо в окне отмены.
        seriesGroupId?: string; series?: SeriesTail | null;
    }>({ open: false, bookingId: '', label: '' });

    const handleCancel = (bookingId: string) => {
        const b = bookings.find(x => x.id === bookingId);
        const userName = b ? getUserName(b.userId) : '';
        const label = b ? `${userName} · ${b.startTime} · ${b.finalPrice}₾` : '';

        // Аудит 29.09 (G7-admin-core-M1): раньше тут был системный confirm, где
        // «ОК» отменял ВСЮ серию, а выбранный потом штраф к серии не применялся.
        // Теперь выбор — в окне отмены, по умолчанию «только эта бронь».
        const series = b ? seriesTailOf(b, bookings) : null;
        setCancelModal({
            open: true, bookingId, label,
            seriesGroupId: series ? b?.recurringGroupId : undefined,
            series,
        });
    };

    const handleCancelConfirm = async (option: 'full' | 'half' | 'none', reason: string, scope: CancelScope) => {
        const refundPercent = option === 'full' ? 1.0 : option === 'half' ? 0.5 : 0.0;
        if (scope === 'series' && cancelModal.seriesGroupId) {
            // «Эта и все следующие»: якорь — эта бронь (более ранние брони серии
            // остаются), выбранный возврат применяется к каждой отменённой брони.
            try {
                const res = await bookingsApi.cancelRecurringSeries(
                    cancelModal.seriesGroupId, cancelModal.bookingId,
                    { refundPercent, reason: reason || undefined },
                );
                toast.success(
                    `Отменено ${ruCountWord(res?.cancelled ?? 0, ['бронь', 'брони', 'броней'])} серии, `
                    + `возврат ${Math.round(refundPercent * 100)}%`,
                );
            } catch (e: any) {
                const d = e?.response?.data?.detail;
                toast.error(typeof d === 'string' ? d : 'Не удалось отменить серию');
            }
            useUserStore.getState().fetchAllBookings();
            return;
        }
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
    // «выставить» and the toast always said «выставлен» — even when the user
    // was actually trying to remove the listing. Now we branch on current
    // state and await so the toast reflects what actually happened.
    // Wave 1: функция называется «Пересдать» (решение владельца).
    const handleReRent = async (bookingId: string) => {
        const booking = bookings.find(b => b.id === bookingId);
        const isCurrentlyListed = !!booking?.isReRentListed;
        const ok = await confirm(isCurrentlyListed
            ? {
                title: 'Снять с пересдачи?',
                body: 'Бронь останется за клиентом, другие её больше не увидят.',
                confirmLabel: 'Снять с пересдачи',
                cancelLabel: 'Оставить',
            }
            : {
                title: 'Пересдать бронь?',
                body: 'Время увидят другие. Если его займут, эту бронь отменим и вернём клиенту 50%.',
                confirmLabel: 'Пересдать',
                cancelLabel: 'Не пересдавать',
            });
        if (!ok) return;
        try {
            await listForReRent(bookingId);
            toast.success(isCurrentlyListed ? 'Бронь снята с пересдачи' : 'Бронь на пересдаче');
            // Make sure the chessboard view also picks up the new flag.
            useUserStore.getState().fetchAllBookings();
        } catch {
            // listForReRent already toasts the error
        }
    };

    // Excel #28 — restore the lost "Продлить" action for admins. Теперь с
    // выбором времени (30/60/90/120), а не жёстко +30.
    const [extendingId] = useState<string | null>(null);
    const handleExtend = (bookingId: string) => setExtendModalId(bookingId);
    const handleAddExtras = (bookingId: string) => setExtrasModalId(bookingId);

    // Перевод брони с баланса на абонемент (owner 2026-07-25). Показывается
    // только для сегодняшних броней, оплаченных с баланса, у клиента с
    // действующим абонементом. Деньги вернутся на баланс, часы спишутся.
    const [convertingId, setConvertingId] = useState<string | null>(null);
    // Можно ли предложить перевод: сегодня + не абонемент + у клиента активный абон.
    const canToSubscription = (b: BookingHistoryItem): boolean => {
        if (bookingBucket(bookingStartMs(b)) !== 'today') return false;
        if (b.paymentMethod === 'subscription') return false;
        // Бонусная бронь: бонус-час уже потрачен — перевод списал бы ещё и
        // часы абонемента за тот же слот (бэкенд тоже откажет).
        if (b.paymentMethod === 'bonus') return false;
        const client = users.find(u => u.email === b.userId || u.id === b.userId);
        return subscriptionLifecycle(client?.subscription as any) === 'active';
    };
    const handleToSubscription = async (bookingId: string) => {
        const ok = await confirm({
            title: 'Списать с абонемента?',
            body: 'Деньги за эту бронь вернутся на баланс клиента, а часы спишутся с его абонемента.',
            confirmLabel: 'Списать с абонемента',
            cancelLabel: 'Оставить как есть',
        });
        if (!ok) return;
        setConvertingId(bookingId);
        try {
            await bookingsApi.convertToSubscription(bookingId);
            toast.success('Бронь переведена на абонемент');
            useUserStore.getState().fetchAllBookings();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось перевести на абонемент');
        }
        setConvertingId(null);
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

    // Отклонение горячей брони. Причина — короткий текст для клиента (придёт
    // в TG/in-app). Раньше — window.prompt и затем ещё одно окно «Вы
    // уверены?»; теперь одна шторка с полем и кнопкой «Отклонить бронь».
    // Пустая причина → бэкенд сам подставит «Слот недоступен».
    const [rejectFor, setRejectFor] = useState<string | null>(null);
    const handleReject = (bookingId: string) => setRejectFor(bookingId);
    const submitReject = async (reason: string) => {
        const bookingId = rejectFor;
        if (!bookingId) return;
        setRejectingId(bookingId);
        try {
            await bookingsApi.rejectBooking(bookingId, reason.trim() || undefined);
            toast.success('Бронь отклонена, клиент уведомлён');
            setRejectFor(null);
            useUserStore.getState().fetchAllBookings();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось отклонить бронь');
        }
        setRejectingId(null);
    };

    // Shared modals rendered in both variants
    const modals = (
        <>
            <AdminCancelBookingModal
                isOpen={cancelModal.open}
                onClose={() => setCancelModal(p => ({ ...p, open: false }))}
                onConfirm={handleCancelConfirm}
                bookingLabel={cancelModal.label}
                series={cancelModal.series}
            />
            <RejectBookingSheet
                open={!!rejectFor}
                busy={!!rejectFor && rejectingId === rejectFor}
                onClose={() => setRejectFor(null)}
                onSubmit={submitReject}
            />
            <BookingPriceModal
                booking={priceBooking}
                onClose={() => setPriceBooking(null)}
                // fetchAllBookings, а не fetchBookings: тот грузит только «мои + публичные»
                // и после правки цены список админа терял чужие брони.
                onSaved={async () => { await useUserStore.getState().fetchAllBookings(); }}
            />
            <ExtendBookingModal
                bookingId={extendModalId}
                onClose={() => setExtendModalId(null)}
                onDone={() => useUserStore.getState().fetchAllBookings()}
            />
            <AddExtrasModal
                bookingId={extrasModalId}
                onClose={() => setExtrasModalId(null)}
                onDone={() => useUserStore.getState().fetchAllBookings()}
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
                timeFilter={timeFilter} setTimeFilter={setTimeFilter}
                search={search} setSearch={setSearch}
                navigate={navigate}
                getUserName={getUserName}
                handleEditPrice={handleEditPrice}
                handleCancel={handleCancel}
                handleReRent={handleReRent}
                handleExtend={handleExtend}
                handleAddExtras={handleAddExtras}
                handleToSubscription={handleToSubscription}
                canToSubscription={canToSubscription}
                convertingId={convertingId}
                handleMove={handleMove}
                handleApprove={handleApprove}
                handleReject={handleReject}
                approvingId={approvingId}
                rejectingId={rejectingId}
                extendingId={extendingId}
                allListStatus={allListStatus}
                onRetryAll={() => { void loadAllBookings(); }}
            />
        </>
    );
}

type GHAdminBookingsProps = {
    bookings: BookingHistoryItem[];
    filteredBookings: BookingHistoryItem[];
    viewMode: ViewMode; setViewMode: (m: ViewMode) => void;
    filterStatus: string; setFilterStatus: (s: string) => void;
    timeFilter: TimeFilter; setTimeFilter: (t: TimeFilter) => void;
    search: string; setSearch: (s: string) => void;
    navigate: ReturnType<typeof useNavigate>;
    getUserName: (email: string) => string;
    handleEditPrice: (id: string, currentPrice: number) => void;
    handleCancel: (id: string) => void;
    handleReRent: (id: string) => void;
    handleExtend: (id: string) => void;
    handleAddExtras: (id: string) => void;
    handleToSubscription: (id: string) => void;
    canToSubscription: (b: BookingHistoryItem) => boolean;
    convertingId: string | null;
    handleMove: (id: string) => void;
    handleApprove: (id: string) => Promise<void>;
    handleReject: (id: string) => void;
    approvingId: string | null;
    rejectingId: string | null;
    extendingId: string | null;
    /** Полный админский список: 'ready' — только тогда можно сказать «броней нет». */
    allListStatus: 'loading' | 'ready' | 'error';
    onRetryAll: () => void;
};

function GridHouseAdminBookings(props: GHAdminBookingsProps) {
    const {
        bookings, filteredBookings, viewMode, setViewMode,
        filterStatus, setFilterStatus, timeFilter, setTimeFilter, search, setSearch,
        navigate, getUserName, handleEditPrice, handleCancel,
        handleReRent, handleExtend, handleAddExtras, handleToSubscription, canToSubscription,
        convertingId, handleMove, handleApprove, handleReject,
        approvingId, rejectingId, extendingId,
        allListStatus, onRetryAll,
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
        ...(['pending_approval', 'confirmed', 'cancelled', 're-rented'] as const)
            .map(v => ({ value: v, label: statusLabel('booking', v, 'staff') })),
    ];

    // Статусы в строках — общий StatusBadge (слова из src/design/statuses.ts).

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Compact header — title + inline KPIs on one row, then
                action cluster on the right (+ Бронь · Список / Шахматка). */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 12 : 16, marginBottom: narrow ? 14 : 20 }}>
                <p style={{ ...ghabMono, color: GH.ink60, marginBottom: narrow ? 6 : 8 }}>Админка · брони</p>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: narrow ? 12 : 24, flexWrap: 'wrap' }}>
                    {/* LEFT: title + inline KPIs */}
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: narrow ? 16 : 28, flexWrap: 'wrap' }}>
                        <h1
                            style={{
                                fontSize: narrow ? 22 : 'clamp(26px, 3vw, 36px)',
                                fontWeight: 800,
                                letterSpacing: '-0.02em',
                                lineHeight: 1.1,
                                margin: 0,
                            }}
                        >
                            Поток броней.
                        </h1>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: narrow ? 12 : 20 }}>
                            <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 22 : 28, fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>
                                    {totalFmt}
                                </span>
                                <span style={{ ...ghabMono, color: GH.ink60 }}>ВСЕГО</span>
                            </div>
                            <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                                <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 16 : 18, fontWeight: 600, color: GH.accent }}>
                                    {String(activeCount).padStart(3, '0')}
                                </span>
                                <span style={{ ...ghabMono, color: GH.ink60 }}>АКТИВ</span>
                            </div>
                            {pendingCount > 0 && (
                                <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
                                    <span style={{ fontFamily: GH_MONO, fontSize: narrow ? 16 : 18, fontWeight: 600, color: STATUS.pending.fg }}>
                                        {String(pendingCount).padStart(3, '0')}
                                    </span>
                                    <span style={{ ...ghabMono, color: GH.ink60 }}>ЖДУТ ПОДТВЕРЖДЕНИЯ</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: + Бронь right next to view toggle */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: narrow ? 6 : 8 }}>
                        {/* Excel #70 — was /checkout (dead). Admin chessboard is the right entry. */}
                        <button onClick={() => navigate('/dashboard/bookings')}
                            style={{
                                padding: narrow ? '5px 10px' : '6px 16px',
                                border: ghabHairline,
                                cursor: 'pointer',
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                background: GH.ink,
                                color: GH.paper,
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                            }}>
                            + БРОНЬ
                        </button>
                        <div style={{ display: 'flex' }}>
                            {(['list', 'grid'] as const).map((m, i) => (
                                <button key={m} onClick={() => setViewMode(m)}
                                    style={{
                                        padding: narrow ? '5px 10px' : '6px 16px',
                                        border: 'none',
                                        cursor: 'pointer',
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        letterSpacing: '0.06em',
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
            </div>

            {/* ── Grid view = chessboard ──
                Wrapper padding cut 20 → 10 and the "ШАХМАТКА · LEGACY VIEW"
                tag stripped — admin doesn't need to be told what they're
                looking at, the grid is self-evident. Closes the dead-space
                gap the user flagged. */}
            {viewMode === 'grid' && (
                <div style={{ border: ghabHairline, padding: 10, background: GH.paper }}>
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
                                            fontSize: 12,
                                            fontWeight: 600,
                                            letterSpacing: '0.06em',
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
                        {/* Фильтр по времени: сегодня / предстоящие / завершённые */}
                        <div style={{ display: 'flex', gap: 0, border: `1px solid ${GH.ink}`, borderTop: 'none', flexWrap: 'wrap', overflowX: 'auto' }}>
                            {([
                                { value: 'all', label: 'Все дни' },
                                { value: 'today', label: 'Сегодня' },
                                { value: 'upcoming', label: 'Предстоящие' },
                                { value: 'completed', label: 'Завершённые' },
                            ] as { value: TimeFilter; label: string }[]).map((o) => {
                                const active = timeFilter === o.value;
                                return (
                                    <button
                                        key={o.value}
                                        onClick={() => setTimeFilter(o.value)}
                                        style={{
                                            fontFamily: GH_MONO,
                                            fontSize: 12,
                                            fontWeight: 600,
                                            letterSpacing: '0.06em',
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
                        // Загрузка ≠ ошибка ≠ пусто: пока полный админский список не
                        // пришёл — силуэты, упал — полоса с «Повторить», и только
                        // после ответа — «не нашли» (иначе это был бы вывод по
                        // неполным «мои + публичные» броням из стартовой загрузки).
                        <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghabHairline, padding: allListStatus !== 'ready' ? '16px 0' : '48px 24px' }}>
                            {allListStatus === 'error' ? (
                                <ErrorBar
                                    message="Не удалось загрузить брони"
                                    onRetry={onRetryAll}
                                />
                            ) : allListStatus !== 'ready' ? (
                                <SkeletonList count={4} label="Загружаем брони" />
                            ) : (
                                <EmptyState
                                    title="Броней не найдено"
                                    hint={search || filterStatus !== 'all' || timeFilter !== 'all'
                                        ? 'Измените поиск или фильтры.'
                                        : 'Новые брони появятся здесь.'}
                                />
                            )}
                        </div>
                    ) : narrow ? (
                        /* ── Mobile card list ── */
                        <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                            {filteredBookings.map((booking, idx) => {
                                const resourceName = RESOURCES.find((r) => r.id === booking.resourceId)?.name || booking.resourceId;
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
                                                <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                                    {String(idx + 1).padStart(3, '0')}
                                                </span>
                                                <span style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                                    {format(booking.date, 'dd.MM')} · {booking.startTime}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                                <StatusBadge kind="booking" status={booking.status} audience="staff" />
                                                <span style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 700, color: GH.ink, fontVariantNumeric: 'tabular-nums' }}>
                                                    {booking.paymentMethod === 'subscription' ? 'Абонемент' : formatGel(booking.finalPrice)}
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
                                                            fontFamily: GH_MONO, fontSize: 12, fontWeight: 600,
                                                            letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                                                            padding: '6px 12px', minHeight: 44, background: GH.ink, color: GH.paper,
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
                                                            fontFamily: GH_MONO, fontSize: 12, fontWeight: 600,
                                                            letterSpacing: '0.06em', textTransform: 'uppercase' as const,
                                                            padding: '6px 12px', minHeight: 44, background: 'transparent', color: GH.danger,
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
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                        title="Перенести бронь — откроется шахматка"
                                                    >
                                                        Перенести
                                                    </button>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                        title="Продлить бронь — выбрать время"
                                                    >
                                                        {extendingId === booking.id ? '...' : 'Продлить'}
                                                    </button>
                                                    {bookingBucket(bookingStartMs(booking)) === 'today' && (
                                                        <button
                                                            onClick={() => handleAddExtras(booking.id)}
                                                            style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                            title="Дозаказ — добавить кофе и т.п."
                                                        >
                                                            + Доп
                                                        </button>
                                                    )}
                                                    {canToSubscription(booking) && (
                                                        <button
                                                            onClick={() => handleToSubscription(booking.id)}
                                                            disabled={convertingId === booking.id}
                                                            style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                            title="Списать с абонемента вместо баланса — деньги вернутся, спишутся часы"
                                                        >
                                                            {convertingId === booking.id ? '...' : 'На абонемент'}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                    >
                                                        Цена
                                                    </button>
                                                    <button
                                                        onClick={() => handleReRent(booking.id)}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                        title={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать: отдать время другим, клиенту вернём 50%'}
                                                    >
                                                        {booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        style={{ ...ghActionBtn(GH.danger, `${GH.danger}30`), minHeight: 44 }}
                                                    >
                                                        Отменить
                                                    </button>
                                                </>
                                            )}
                                            {/* Завершившаяся СЕГОДНЯШНЯЯ бронь: админ всё ещё
                                                может добить время по факту, дозаказать допы и
                                                поправить цену. В базе статус ещё 'confirmed'
                                                (completed — только в ответе API), поэтому
                                                бэкенд эти правки принимает. */}
                                            {booking.status === 'completed' && bookingBucket(bookingStartMs(booking)) === 'today' && (
                                                <>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                        title="Добить время по факту — клиент занимался дольше"
                                                    >
                                                        {extendingId === booking.id ? '...' : 'Продлить'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleAddExtras(booking.id)}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                        title="Дозаказ — добавить кофе и т.п."
                                                    >
                                                        + Доп
                                                    </button>
                                                    {canToSubscription(booking) && (
                                                        <button
                                                            onClick={() => handleToSubscription(booking.id)}
                                                            disabled={convertingId === booking.id}
                                                            style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                            title="Списать с абонемента вместо баланса — деньги вернутся, спишутся часы"
                                                        >
                                                            {convertingId === booking.id ? '...' : 'На абонемент'}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={{ ...ghActionBtn(GH.ink60, GH.ink10), minHeight: 44 }}
                                                    >
                                                        Цена
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
                                            color: GH.ink60,
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
                                        <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.06em' }}>
                                            {String(idx + 1).padStart(3, '0')}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                            {format(new Date(booking.createdAt), 'dd.MM · HH:mm')}
                                        </div>
                                        <div
                                            onClick={() => navigate(`/admin/users/${encodeURIComponent(booking.userId)}`)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <div style={{ fontSize: 14, fontWeight: 700, color: GH.ink, letterSpacing: '-0.005em' }}>
                                                {getUserName(booking.userId)}
                                            </div>
                                            <div style={{ ...ghabMono, color: GH.ink60, marginTop: 2 }}>{booking.userId}</div>
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
                                            <StatusBadge kind="booking" status={booking.status} audience="staff" />
                                            {booking.isReRentListed && booking.status === 'confirmed' && (
                                                <div style={{ ...ghabMono, color: STATUS.pending.fg, marginTop: 4 }}>На пересдаче</div>
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
                                            {booking.paymentMethod === 'subscription' ? 'Абонемент' : formatGel(booking.finalPrice)}
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap' }}>
                                            {booking.status === 'pending_approval' && (
                                                <>
                                                    <button
                                                        onClick={() => handleApprove(booking.id)}
                                                        disabled={approvingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 12,
                                                            fontWeight: 600,
                                                            letterSpacing: '0.06em',
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
                                                        {approvingId === booking.id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                                        Принять
                                                    </button>
                                                    <button
                                                        onClick={() => handleReject(booking.id)}
                                                        disabled={rejectingId === booking.id}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 12,
                                                            fontWeight: 600,
                                                            letterSpacing: '0.06em',
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
                                                        {rejectingId === booking.id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                                                        Отклонить
                                                    </button>
                                                </>
                                            )}
                                            {booking.status === 'confirmed' && (
                                                <>
                                                    <button
                                                        onClick={() => handleMove(booking.id)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Перенести — откроется шахматка"
                                                    >
                                                        Перенести
                                                    </button>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Продлить бронь — выбрать время"
                                                    >
                                                        {extendingId === booking.id ? '...' : 'Продлить'}
                                                    </button>
                                                    {bookingBucket(bookingStartMs(booking)) === 'today' && (
                                                        <button
                                                            onClick={() => handleAddExtras(booking.id)}
                                                            style={ghTableLinkBtn(GH.ink60)}
                                                            title="Дозаказ — добавить кофе и т.п."
                                                        >
                                                            + Доп
                                                        </button>
                                                    )}
                                                    {canToSubscription(booking) && (
                                                        <button
                                                            onClick={() => handleToSubscription(booking.id)}
                                                            disabled={convertingId === booking.id}
                                                            style={ghActionBtn(GH.ink60, GH.ink10)}
                                                            title="Списать с абонемента вместо баланса — деньги вернутся, спишутся часы"
                                                        >
                                                            {convertingId === booking.id ? '...' : 'На абонемент'}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                    >
                                                        Цена
                                                    </button>
                                                    <button
                                                        onClick={() => handleReRent(booking.id)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title={booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать: отдать время другим, клиенту вернём 50%'}
                                                    >
                                                        {booking.isReRentListed ? 'Снять с пересдачи' : 'Пересдать'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleCancel(booking.id)}
                                                        style={ghTableLinkBtn(GH.danger)}
                                                    >
                                                        Отменить
                                                    </button>
                                                </>
                                            )}
                                            {/* Завершившаяся сегодняшняя бронь — правки по факту
                                                (в базе статус ещё confirmed, бэкенд принимает). */}
                                            {booking.status === 'completed' && bookingBucket(bookingStartMs(booking)) === 'today' && (
                                                <>
                                                    <button
                                                        onClick={() => handleExtend(booking.id)}
                                                        disabled={extendingId === booking.id}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Добить время по факту"
                                                    >
                                                        {extendingId === booking.id ? '...' : 'Продлить'}
                                                    </button>
                                                    <button
                                                        onClick={() => handleAddExtras(booking.id)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                        title="Дозаказ — добавить кофе и т.п."
                                                    >
                                                        + Доп
                                                    </button>
                                                    {canToSubscription(booking) && (
                                                        <button
                                                            onClick={() => handleToSubscription(booking.id)}
                                                            disabled={convertingId === booking.id}
                                                            style={ghActionBtn(GH.ink60, GH.ink10)}
                                                            title="Списать с абонемента вместо баланса — деньги вернутся, спишутся часы"
                                                        >
                                                            {convertingId === booking.id ? '...' : 'На абонемент'}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => handleEditPrice(booking.id, booking.finalPrice)}
                                                        style={ghTableLinkBtn(GH.ink60)}
                                                    >
                                                        Цена
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
                <p style={{ ...ghabMono, color: GH.ink60 }}>Unbox · админка · 2026</p>
            </div>
        </div>
    );
}

// Шторка «Отклонить бронь» — вместо window.prompt + второго окна «Вы уверены?».
// Причина необязательна: пустую бэкенд заменит на «Слот недоступен».
function RejectBookingSheet({ open, busy, onClose, onSubmit }: {
    open: boolean;
    busy: boolean;
    onClose: () => void;
    onSubmit: (reason: string) => void | Promise<void>;
}) {
    const [reason, setReason] = useState('');
    useEffect(() => { if (open) setReason(''); }, [open]);
    return (
        <Sheet
            open={open}
            onClose={onClose}
            // Пока запрос идёт — шторку не закрыть (Esc/фон/свайп), иначе
            // админ не узнает, отклонилась ли бронь.
            dismissible={!busy}
            title="Отклонить бронь?"
            description="Клиент получит уведомление, деньги не списываются."
            width={460}
            footer={
                <>
                    <Button variant="danger" block loading={busy} onClick={() => onSubmit(reason)}>
                        Отклонить бронь
                    </Button>
                    <Button variant="secondary" block onClick={onClose} disabled={busy}>
                        Оставить
                    </Button>
                </>
            }
        >
            <Field
                label="Причина для клиента"
                optional
                hint="Если оставить пустым, клиент увидит «Слот недоступен»."
            >
                <TextArea
                    rows={3}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Например: кабинет на уборке"
                />
            </Field>
        </Sheet>
    );
}
