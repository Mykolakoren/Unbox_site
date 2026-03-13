import { useUserStore } from '../store/userStore';
import { useBookingStore } from '../store/bookingStore';
import { useCrmStore } from '../store/crmStore';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { WaitlistModal } from '../components/WaitlistModal';
import {
    BadgeCheck, XCircle, Clock, Calendar as CalendarIcon, Key, Wifi, Repeat,
    LayoutList, LayoutGrid, ChevronLeft, ChevronRight, X, RefreshCw, GripVertical,
    User as UserIcon, Check, Pencil, Loader2
} from 'lucide-react';
import clsx from 'clsx';
import { format, addMinutes, setHours, setMinutes, startOfToday, isBefore,
    startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { RESOURCES, EXTRAS } from '../utils/data';
import { generateGoogleCalendarUrl } from '../utils/calendar';
import { bookingsApi } from '../api/bookings';
import { toast } from 'sonner';
import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ConfirmationModal } from '../components/ui/ConfirmationModal';
import type { BookingHistoryItem } from '../store/types';

// Parse backend UTC date string (no 'Z' suffix) correctly
const parseUTC = (d: string | Date) => {
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
};

const timeToMins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const minsToTime = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ─── Chess board sub-component ───────────────────────────────────────────────
function BookingsChessboard({
    userBookings,
    allBookings,
    publicBookings,
    onCancel,
    onReschedule,
    onReRent,
    onCancelReRent,
    onLinkClient,
    crmClients,
    refreshBookings,
    crmMode,
    onCrmBooked,
    usersMap,
}: {
    userBookings: BookingHistoryItem[];
    allBookings: BookingHistoryItem[];
    publicBookings: BookingHistoryItem[];
    onCancel: (id: string) => void;
    onReschedule: (booking: BookingHistoryItem) => void;
    onReRent: (id: string) => void;
    onCancelReRent: (id: string) => void;
    onLinkClient: (bookingId: string, clientId: string | null) => void;
    crmClients: Array<{ id: string; name: string; aliasCode?: string }>;
    refreshBookings: () => void;
    crmMode?: { sessionId: string; clientId: string; clientName: string; date: string; duration?: number } | null;
    onCrmBooked?: () => void;
    usersMap?: Map<string, string>;
}) {
    const { updateSession } = useCrmStore();
    const crmTargetDate = crmMode ? new Date(crmMode.date) : null;
    const navTargetDate = location.state?.targetDate ? new Date(location.state.targetDate) : null;
    const initialDate = crmTargetDate ?? navTargetDate ?? new Date();
    const [selectedDate, setSelectedDate] = useState(initialDate);
    const [weekStart, setWeekStart] = useState(() =>
        startOfWeek(initialDate, { weekStartsOn: 1 })
    );

    // Quick booking slot for CRM mode
    const [crmSlot, setCrmSlot] = useState<{ resId: string; time: string; date: Date } | null>(null);
    const [activeBooking, setActiveBooking] = useState<BookingHistoryItem | null>(null);
    const [popupPos, setPopupPos] = useState<{ top: number; left: number } | null>(null);
    const [waitlistOpen, setWaitlistOpen] = useState(false);
    const [waitlistSlot, setWaitlistSlot] = useState<string>('');
    const [waitlistRes, setWaitlistRes] = useState<string>('');
    const popupRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<HTMLDivElement>(null);

    // Drag state
    const [dragBooking, setDragBooking] = useState<BookingHistoryItem | null>(null);
    const [dragTarget, setDragTarget] = useState<{ resId: string; time: string } | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef<{ resId: string; time: string; offsetMins: number } | null>(null);

    // CRM session time hint (dashed overlay on chessboard)
    const crmHintDate = crmMode?.date ? format(parseISO(crmMode.date), 'yyyy-MM-dd') : null;
    const crmHintStartMins = crmMode?.date ? timeToMins(format(parseISO(crmMode.date), 'HH:mm')) : -1;
    const crmHintEndMins = crmHintStartMins >= 0 ? crmHintStartMins + (crmMode?.duration ?? 60) : -1;

    const weekDays = useMemo(() => eachDayOfInterval({
        start: weekStart,
        end: endOfWeek(weekStart, { weekStartsOn: 1 })
    }), [weekStart]);

    // Close popup on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
                setActiveBooking(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // 30-min time slots 09:00–21:00
    const timeSlots = useMemo(() => {
        const slots: string[] = [];
        let t = setMinutes(setHours(startOfToday(), 9), 0);
        const end = setMinutes(setHours(startOfToday(), 21), 0);
        while (isBefore(t, end)) {
            slots.push(format(t, 'HH:mm'));
            t = addMinutes(t, 30);
        }
        return slots;
    }, []);

    const resources = RESOURCES;

    // Build day's booking map — include completed bookings
    const dayUserBookings = useMemo(() =>
        userBookings.filter(b =>
            (b.status === 'confirmed' || b.status === 'completed') &&
            isSameDay(parseUTC(b.date), selectedDate)
        ), [userBookings, selectedDate]);

    // Public bookings for other users' occupancy
    const dayPublicBookings = useMemo(() =>
        publicBookings.filter(b =>
            (b.status === 'confirmed' || b.status === 'completed') &&
            isSameDay(parseUTC(b.date), selectedDate)
        ), [publicBookings, selectedDate]);

    // Find booking at a specific slot
    const findBookingAtSlot = (bookings: BookingHistoryItem[], resId: string, time: string) =>
        bookings.find(b => {
            if (b.resourceId !== resId || !b.startTime) return false;
            const bStart = timeToMins(b.startTime);
            const bEnd = bStart + b.duration;
            const s = timeToMins(time);
            return s >= bStart && s < bEnd;
        }) ?? null;

    // Can cancel/reschedule? confirmed + >24h before start
    const canModify = (b: BookingHistoryItem) => {
        if (b.status !== 'confirmed' || !b.startTime) return false;
        const [h, m] = b.startTime.split(':').map(Number);
        const start = parseUTC(b.date);
        start.setUTCHours(h, m, 0, 0);
        return (start.getTime() - Date.now()) > 24 * 60 * 60 * 1000;
    };

    // Is slot in the past?
    const isSlotPast = useCallback((time: string) => {
        if (!isToday(selectedDate)) return isBefore(selectedDate, startOfToday());
        const [h, m] = time.split(':').map(Number);
        const now = new Date();
        return h < now.getHours() || (h === now.getHours() && m <= now.getMinutes());
    }, [selectedDate]);

    // Days that have bookings (for dot indicators)
    const daysWithBookings = useMemo(() => {
        const set = new Set<string>();
        userBookings.filter(b => b.status === 'confirmed' || b.status === 'completed').forEach(b =>
            set.add(format(parseUTC(b.date), 'yyyy-MM-dd'))
        );
        return set;
    }, [userBookings]);

    // CRM client lookup
    const clientMap = useMemo(() => {
        const map = new Map<string, { name: string; aliasCode?: string }>();
        crmClients.forEach(c => map.set(c.id, c));
        return map;
    }, [crmClients]);

    // ─── Drag handlers ──────────────────────────────────────────
    const handleDragStart = (booking: BookingHistoryItem, resId: string, time: string, e: React.PointerEvent) => {
        if (!canModify(booking)) return;
        e.preventDefault();
        const offsetMins = timeToMins(time) - timeToMins(booking.startTime!);
        dragStartRef.current = { resId, time, offsetMins };
        setDragBooking(booking);
        setDragTarget({ resId, time: booking.startTime! });
        setIsDragging(true);
    };

    const handleDragOver = useCallback((resId: string, time: string) => {
        if (!isDragging || !dragBooking || !dragStartRef.current) return;
        const offset = dragStartRef.current.offsetMins;
        const targetMins = timeToMins(time) - offset;
        const snapped = Math.round(targetMins / 30) * 30;
        const clampedStart = Math.max(9 * 60, Math.min(snapped, 21 * 60 - dragBooking.duration));
        setDragTarget({ resId, time: minsToTime(clampedStart) });
    }, [isDragging, dragBooking]);

    const handleDragEnd = useCallback(async () => {
        if (!isDragging || !dragBooking || !dragTarget) {
            setIsDragging(false);
            setDragBooking(null);
            setDragTarget(null);
            return;
        }
        setIsDragging(false);

        const oldTime = dragBooking.startTime!;
        const oldRes = dragBooking.resourceId;
        const newTime = dragTarget.time;
        const newRes = dragTarget.resId;

        // No change
        if (oldTime === newTime && oldRes === newRes) {
            setDragBooking(null);
            setDragTarget(null);
            return;
        }

        // Confirm
        const resName = RESOURCES.find(r => r.id === newRes)?.name || newRes;
        const confirmed = window.confirm(
            `Перенести бронь?\n${oldTime} → ${newTime}${oldRes !== newRes ? `\n${RESOURCES.find(r => r.id === oldRes)?.name} → ${resName}` : ''}`
        );

        if (confirmed) {
            try {
                const newDate = format(selectedDate, 'yyyy-MM-dd');
                await bookingsApi.rescheduleBooking(dragBooking.id, {
                    newDate,
                    newStartTime: newTime,
                    newResourceId: oldRes !== newRes ? newRes : undefined,
                });
                // If dragging in CRM mode, sync new time back to the linked session
                if (crmMode?.sessionId) {
                    await updateSession(crmMode.sessionId, { date: `${newDate}T${newTime}:00` });
                }
                toast.success('Бронирование перенесено');
                refreshBookings();
            } catch (err: any) {
                toast.error(err.response?.data?.detail || 'Не удалось перенести');
            }
        }

        setDragBooking(null);
        setDragTarget(null);
    }, [isDragging, dragBooking, dragTarget, selectedDate, refreshBookings]);

    // Global pointer up listener for drag
    useEffect(() => {
        if (!isDragging) return;
        const handler = () => handleDragEnd();
        window.addEventListener('pointerup', handler);
        return () => window.removeEventListener('pointerup', handler);
    }, [isDragging, handleDragEnd]);

    const handleCellClick = (booking: BookingHistoryItem | null, e: React.MouseEvent, isOther: boolean) => {
        if (isDragging) return;
        if (!booking || isOther) return;
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        // fixed positioning — viewport coords only, no scrollY
        const top = rect.bottom + 6;
        const left = Math.min(rect.left, window.innerWidth - 336);
        setPopupPos({ top, left });
        setActiveBooking(booking);
    };

    return (
        <div className="space-y-4">
            {/* Week navigation */}
            <div className="flex items-center gap-2 p-1.5 rounded-2xl border border-unbox-light/60"
                style={{ background: 'rgba(212,226,225,0.35)' }}>
                <button
                    onClick={() => { const n = subWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark border border-transparent hover:border-unbox-light hover:shadow-sm"
                >
                    <ChevronLeft size={18} />
                </button>
                <div className="flex-1 grid grid-cols-7 gap-1.5">
                    {weekDays.map(day => {
                        const isSelected = isSameDay(day, selectedDate);
                        const hasBooking = daysWithBookings.has(format(day, 'yyyy-MM-dd'));
                        return (
                            <button
                                key={day.toISOString()}
                                onClick={() => setSelectedDate(day)}
                                className={clsx(
                                    "flex flex-col items-center justify-center py-2.5 rounded-xl transition-all duration-200 text-sm relative",
                                    isSelected
                                        ? "bg-unbox-green text-white shadow-lg shadow-unbox-green/30 scale-[1.04]"
                                        : "bg-white text-unbox-grey border border-unbox-light hover:border-unbox-green/40 hover:text-unbox-dark hover:shadow-sm"
                                )}
                            >
                                <span className={clsx("text-[10px] font-bold uppercase tracking-wider mb-1", isSelected ? "opacity-80" : "opacity-50")}>
                                    {format(day, 'EEE', { locale: ru })}
                                </span>
                                <span className="text-base font-bold leading-none">{format(day, 'd')}</span>
                                {hasBooking && (
                                    <span className={clsx(
                                        "absolute bottom-1 w-1.5 h-1.5 rounded-full",
                                        isSelected ? "bg-white/80" : "bg-unbox-green"
                                    )} />
                                )}
                            </button>
                        );
                    })}
                </div>
                <button
                    onClick={() => { const n = addWeeks(weekStart, 1); setWeekStart(n); setSelectedDate(n); }}
                    className="p-2 hover:bg-white rounded-xl transition-all text-unbox-grey hover:text-unbox-dark border border-transparent hover:border-unbox-light hover:shadow-sm"
                >
                    <ChevronRight size={18} />
                </button>
            </div>

            {/* Grid */}
            <div ref={tableRef} className="border border-white/30 rounded-2xl overflow-x-auto bg-white/40 backdrop-blur-sm shadow-sm select-none">
                <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="text-unbox-dark font-medium border-b border-unbox-light/60"
                        style={{ background: 'rgba(212,226,225,0.45)' }}>
                        <tr>
                            <th className="sticky left-0 backdrop-blur-sm p-4 border-r border-unbox-light/50 z-20 w-36 font-bold text-unbox-dark"
                                style={{ background: 'rgba(212,226,225,0.60)' }}>
                                Кабинет
                            </th>
                            {timeSlots.map(t => (
                                <th key={t} className="p-2 text-center min-w-[56px] border-r border-unbox-light/40 text-[10px] uppercase font-bold text-unbox-dark/60">
                                    {t}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {resources.map(r => {
                            const cells: React.ReactNode[] = [];
                            let skipUntilIdx = -1;

                            timeSlots.forEach((time, idx) => {
                                if (idx <= skipUntilIdx) return;

                                const myB = findBookingAtSlot(dayUserBookings, r.id, time);
                                const pubB = !myB ? findBookingAtSlot(dayPublicBookings, r.id, time) : null;
                                const isPast = isSlotPast(time);

                                // Drag ghost: is this slot the drag target?
                                const isDragGhost = isDragging && dragBooking && dragTarget &&
                                    dragTarget.resId === r.id &&
                                    timeToMins(time) >= timeToMins(dragTarget.time) &&
                                    timeToMins(time) < timeToMins(dragTarget.time) + dragBooking.duration;

                                // Is this slot the original position of the dragged booking?
                                const isDragSource = isDragging && dragBooking &&
                                    dragBooking.resourceId === r.id &&
                                    myB?.id === dragBooking.id;

                                if (myB && timeToMins(myB.startTime!) === timeToMins(time) && !isDragSource) {
                                    // START of user's booking — colSpan block
                                    const span = Math.max(1, Math.round(myB.duration / 30));
                                    skipUntilIdx = idx + span - 1;
                                    const isCompleted = myB.status === 'completed';
                                    const isReRent = myB.isReRentListed && !isCompleted;
                                    const canMod = canModify(myB);
                                    const clientInfo = myB.crmClientId ? clientMap.get(myB.crmClientId) : null;

                                    cells.push(
                                        <td
                                            key={`${r.id}-${time}`}
                                            colSpan={span}
                                            className="p-0 border-r border-unbox-light/30 h-14 relative"
                                        >
                                            <div
                                                onPointerDown={canMod ? (e) => handleDragStart(myB, r.id, time, e) : undefined}
                                                className={clsx(
                                                    "absolute inset-[2px] rounded-xl flex flex-col items-start justify-center px-2 gap-0.5 transition-all shadow-sm group touch-none select-none",
                                                    isCompleted
                                                        ? "bg-gray-200/80 text-gray-500"
                                                        : isReRent
                                                            ? "bg-amber-50 border-2 border-dashed border-amber-400 text-amber-700"
                                                            : canMod
                                                                ? "bg-unbox-green hover:bg-unbox-green/90 text-white cursor-grab active:cursor-grabbing"
                                                                : "bg-unbox-dark/80 hover:bg-unbox-dark text-white"
                                                )}
                                            >
                                                <span className="text-[10px] font-bold leading-none opacity-90">
                                                    {myB.startTime} · {myB.duration / 60}ч
                                                    {isCompleted && ' ✓'}
                                                </span>
                                                {clientInfo ? (
                                                    <span className="text-[9px] opacity-80 leading-none flex items-center gap-0.5 truncate max-w-full">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate">
                                                            {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                                                        </span>
                                                    </span>
                                                ) : (
                                                    <span className="text-[9px] opacity-70 leading-none flex items-center gap-0.5 truncate max-w-full">
                                                        <UserIcon size={8} className="shrink-0" />
                                                        <span className="truncate">{usersMap?.get(myB.userId) || myB.userId}</span>
                                                    </span>
                                                )}
                                                {isReRent && <span className="text-[8px] opacity-80 leading-none">♻️ переаренда</span>}
                                                {!isCompleted && !isReRent && !canMod && <span className="text-[8px] opacity-60 leading-none">≤24ч</span>}
                                                {canMod && <GripVertical size={10} className="absolute right-5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-30 transition-opacity" />}
                                                {/* Edit button */}
                                                <button
                                                    onPointerDown={(e) => e.stopPropagation()}
                                                    onClick={(e) => { if (!isDragging) handleCellClick(myB, e, false); }}
                                                    className={clsx(
                                                        "absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity",
                                                        isCompleted ? "hover:bg-gray-300/50" : "hover:bg-white/20"
                                                    )}
                                                    title="Редактировать"
                                                >
                                                    <Pencil size={10} />
                                                </button>
                                            </div>
                                        </td>
                                    );
                                } else if (isDragGhost) {
                                    // Drag ghost preview
                                    cells.push(
                                        <td key={`${r.id}-${time}`}
                                            className="p-0 border-r border-unbox-light/30 h-14 relative"
                                            onPointerEnter={() => handleDragOver(r.id, time)}
                                        >
                                            <div className="absolute inset-[2px] rounded-xl bg-unbox-green/30 border-2 border-dashed border-unbox-green animate-pulse" />
                                        </td>
                                    );
                                } else if (pubB && !isDragSource) {
                                    // Other user's booking
                                    const isReRentAvailable = pubB.isReRentListed;
                                    const isPubStart = timeToMins(pubB.startTime!) === timeToMins(time);
                                    if (isPubStart) {
                                        const pubSpan = Math.max(1, Math.round(pubB.duration / 30));
                                        skipUntilIdx = idx + pubSpan - 1;
                                        const pubUserName = usersMap?.get(pubB.userId) || '';
                                        cells.push(
                                            <td
                                                key={`${r.id}-${time}`}
                                                colSpan={pubSpan}
                                                className="p-0 border-r border-unbox-light/30 h-14 relative"
                                            >
                                                <div
                                                    className={clsx(
                                                        "absolute inset-[2px] rounded-xl flex flex-col items-start justify-center px-2 gap-0.5",
                                                        isReRentAvailable
                                                            ? "bg-amber-50/80 border border-dashed border-amber-400 text-amber-700 cursor-pointer hover:bg-amber-100/80"
                                                            : "bg-gray-200/70 text-gray-500"
                                                    )}
                                                    onClick={isReRentAvailable ? () => {
                                                        toast.info('Слот доступен для переаренды.');
                                                    } : undefined}
                                                >
                                                    <span className="text-[10px] font-bold leading-none opacity-80">
                                                        {pubB.startTime} · {pubB.duration / 60}ч
                                                    </span>
                                                    {pubUserName && (
                                                        <span className="text-[9px] opacity-70 leading-none flex items-center gap-0.5 truncate max-w-full">
                                                            <UserIcon size={8} className="shrink-0" />
                                                            <span className="truncate">{pubUserName}</span>
                                                        </span>
                                                    )}
                                                    {isReRentAvailable && <span className="text-[8px] opacity-80 leading-none">♻️ переаренда</span>}
                                                </div>
                                            </td>
                                        );
                                    } else {
                                        // Mid-slot of pub booking already covered by colSpan — skip
                                    }
                                } else {
                                    // Free or past slot
                                    const isCrmHint = !isPast && crmMode && crmHintDate === format(selectedDate, 'yyyy-MM-dd') &&
                                        timeToMins(time) >= crmHintStartMins &&
                                        timeToMins(time) < crmHintEndMins;
                                    cells.push(
                                        <td
                                            key={`${r.id}-${time}`}
                                            className={clsx(
                                                "p-0 border-r border-unbox-light/30 h-14 relative",
                                                isPast ? "bg-black/[0.03]" : "hover:bg-unbox-green/5 cursor-pointer"
                                            )}
                                            style={isCrmHint ? { background: 'repeating-linear-gradient(45deg, transparent, transparent 5px, rgba(249,115,22,0.12) 5px, rgba(249,115,22,0.12) 10px)', outline: '1.5px dashed rgba(249,115,22,0.5)', outlineOffset: '-1px' } : undefined}
                                            title={isCrmHint ? `Время сессии: ${format(parseISO(crmMode!.date), 'HH:mm')} (${crmMode!.duration ?? 60} мин)` : undefined}
                                            onPointerEnter={isDragging ? () => handleDragOver(r.id, time) : undefined}
                                            onClick={(!isPast && !isDragging) ? () => {
                                                if (crmMode) {
                                                    setCrmSlot({ resId: r.id, time, date: selectedDate });
                                                } else {
                                                    setWaitlistRes(r.id);
                                                    setWaitlistSlot(time);
                                                    setWaitlistOpen(true);
                                                }
                                            } : undefined}
                                        />
                                    );
                                }
                            });

                            return (
                                <tr key={r.id} className="hover:bg-unbox-light/10 group">
                                    <td className="sticky left-0 backdrop-blur-sm p-3 border-r border-unbox-light/40 z-10"
                                        style={{ background: 'rgba(212,226,225,0.50)' }}>
                                        <div className="font-bold text-unbox-dark text-xs">{r.name}</div>
                                        <div className="text-[10px] text-unbox-grey">{r.capacity} чел.</div>
                                    </td>
                                    {cells}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-unbox-grey px-1">
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-unbox-green" />
                    <span>Ваша бронь (перетаскивайте)</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-unbox-dark/80" />
                    <span>≤24ч — только переаренда</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded border-2 border-dashed border-amber-400 bg-amber-50" />
                    <span>На переаренде</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-gray-200/80" />
                    <span>Прошедшая</span>
                </div>
                <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded bg-striped border border-unbox-light/50" />
                    <span>Занято</span>
                </div>
            </div>

            {/* Booking action popup */}
            {activeBooking && popupPos && (
                <div
                    ref={popupRef}
                    className="fixed z-[200] w-80 rounded-2xl shadow-2xl border border-white/60 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150"
                    style={{
                        top: popupPos.top,
                        left: Math.min(popupPos.left, window.innerWidth - 330),
                        background: 'rgba(255,255,255,0.95)',
                        backdropFilter: 'blur(20px)',
                    }}
                >
                    <div className="flex items-start justify-between">
                        <div>
                            <div className="font-bold text-unbox-dark text-sm">
                                {RESOURCES.find(r => r.id === activeBooking.resourceId)?.name || 'Кабинет'}
                            </div>
                            <div className="text-xs text-unbox-grey mt-0.5">
                                {format(parseUTC(activeBooking.date), 'd MMMM', { locale: ru })} · {activeBooking.startTime} – {minsToTime(timeToMins(activeBooking.startTime!) + activeBooking.duration)} · {activeBooking.duration / 60}ч
                            </div>
                            <div className="text-xs font-semibold mt-1">
                                {activeBooking.paymentSource === 'credit' ? (
                                    <span className="text-amber-600">Долг: {activeBooking.finalPrice} ₾</span>
                                ) : (
                                    <span className="text-unbox-green">Оплачено: {activeBooking.finalPrice} ₾</span>
                                )}
                            </div>
                        </div>
                        <button onClick={() => setActiveBooking(null)} className="p-1 hover:bg-unbox-light rounded-lg transition-colors">
                            <X size={14} className="text-unbox-grey" />
                        </button>
                    </div>

                    {/* CRM Client selector */}
                    {activeBooking.status !== 'completed' && (
                        <div className="border-t border-unbox-light/50 pt-3">
                            <div className="text-[10px] text-unbox-grey uppercase tracking-wider mb-1.5 font-semibold">Клиент из CRM</div>
                            {crmClients.length > 0 ? (
                                <div className="flex items-center gap-2">
                                    <UserIcon size={12} className="text-unbox-grey flex-shrink-0" />
                                    <select
                                        value={activeBooking.crmClientId || ''}
                                        onChange={(e) => {
                                            const val = e.target.value || null;
                                            onLinkClient(activeBooking.id, val);
                                            setActiveBooking(prev => prev ? { ...prev, crmClientId: val || undefined } : null);
                                        }}
                                        className="flex-1 text-xs border border-unbox-light rounded-lg px-2 py-1.5 bg-white/80 text-unbox-dark focus:border-unbox-green focus:outline-none"
                                    >
                                        <option value="">— Без клиента —</option>
                                        {crmClients.map(c => (
                                            <option key={c.id} value={c.id}>
                                                {c.aliasCode ? `${c.aliasCode} · ${c.name}` : c.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <Link to="/crm/clients" className="flex items-center gap-1.5 text-xs text-unbox-grey hover:text-unbox-green transition-colors" onClick={() => setActiveBooking(null)}>
                                    <UserIcon size={12} />
                                    Добавьте клиентов в разделе «Мой CRM»
                                </Link>
                            )}
                        </div>
                    )}

                    {/* Actions */}
                    {activeBooking.status === 'completed' ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-gray-100 rounded-xl p-2.5 text-xs text-center text-gray-500 flex items-center justify-center gap-1.5">
                                <Check size={12} /> Бронирование завершено
                            </div>
                        </div>
                    ) : canModify(activeBooking) ? (
                        <div className="flex gap-2 pt-1">
                            <button
                                onClick={() => { setActiveBooking(null); onReschedule(activeBooking); }}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-unbox-light text-unbox-dark text-xs font-semibold hover:border-unbox-green hover:text-unbox-green transition-all"
                            >
                                <RefreshCw size={12} /> Перенести
                            </button>
                            <button
                                onClick={() => { setActiveBooking(null); onCancel(activeBooking.id); }}
                                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl border border-red-100 text-red-500 text-xs font-semibold hover:bg-red-50 transition-all"
                            >
                                <X size={12} /> Отменить
                            </button>
                        </div>
                    ) : activeBooking.isReRentListed ? (
                        <div className="space-y-2 pt-1">
                            <div className="bg-amber-50/80 rounded-xl p-2.5 text-xs text-center text-amber-700 border border-amber-200">
                                ♻️ Выставлено на переаренду
                            </div>
                            <button
                                onClick={() => { setActiveBooking(null); onCancelReRent(activeBooking.id); }}
                                className="w-full py-2 rounded-xl border border-unbox-light text-unbox-grey text-xs font-semibold hover:bg-unbox-light transition-all"
                            >
                                Убрать с переаренды
                            </button>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2 pt-1">
                            <div className="text-[11px] text-unbox-grey text-center italic">
                                Менее 24ч до начала — бесплатная отмена недоступна
                            </div>
                            <button
                                onClick={() => { setActiveBooking(null); onReRent(activeBooking.id); }}
                                className="w-full py-2 rounded-xl border border-dashed border-unbox-green text-unbox-green text-xs font-semibold hover:bg-unbox-light transition-all"
                            >
                                ♻️ Выставить на переаренду
                            </button>
                        </div>
                    )}
                </div>
            )}

            <WaitlistModal
                isOpen={waitlistOpen}
                onClose={() => setWaitlistOpen(false)}
                resourceId={waitlistRes}
                startTime={waitlistSlot}
                date={selectedDate}
            />

            {/* CRM Quick Booking Modal */}
            {crmMode && crmSlot && (
                <CrmQuickBookingModal
                    crmMode={crmMode}
                    slot={crmSlot}
                    onClose={() => setCrmSlot(null)}
                    onBooked={() => {
                        setCrmSlot(null);
                        refreshBookings();
                        onCrmBooked?.();
                    }}
                />
            )}
        </div>
    );
}
// ─────────────────────────────────────────────────────────────────────────────

export function MyBookingsPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const { currentUser, bookings, users, fetchUsers, cancelBooking, listForReRent, fetchBookings } = useUserStore();
    const startEditing = useBookingStore(s => s.startEditing);
    const { clients: crmClients, fetchClients } = useCrmStore();
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(location.state?.openGrid ? 'grid' : 'list');
    const [publicBookings, setPublicBookings] = useState<BookingHistoryItem[]>([]);

    // CRM booking mode: passed from CRM Dashboard "Без кабинета"
    const [crmMode, setCrmMode] = useState<{
        sessionId: string;
        clientId: string;
        clientName: string;
        date: string;
        duration?: number;
    } | null>(location.state?.crmMode ?? null);

    // Fetch public bookings + users for chessboard occupancy display
    useEffect(() => {
        bookingsApi.getPublicBookings().then(setPublicBookings).catch(() => {});
        if (currentUser?.isAdmin) fetchUsers();
    }, []);

    // Auto-switch to grid and jump to date when entering CRM mode
    useEffect(() => {
        if (crmMode) {
            setViewMode('grid');
        }
    }, [crmMode]);

    // Fetch CRM clients if user might be a specialist
    useEffect(() => {
        if (currentUser) {
            fetchClients(true).catch(() => {});
        }
    }, [currentUser, fetchClients]);

    const refreshBookings = useCallback(() => {
        fetchBookings?.();
        bookingsApi.getPublicBookings().then(setPublicBookings).catch(() => {});
    }, [fetchBookings]);

    const usersMap = useMemo(() => {
        const m = new Map<string, string>();
        users.forEach(u => { m.set(u.email, u.name); m.set(u.id, u.name); });
        return m;
    }, [users]);

    const [modalConfig, setModalConfig] = useState<{
        isOpen: boolean;
        title: string;
        message: React.ReactNode;
        onConfirm: () => void;
        isDestructive?: boolean;
        confirmLabel?: string;
    }>({ isOpen: false, title: '', message: null, onConfirm: () => {} });

    const userBookings = (currentUser?.isAdmin
        ? bookings
        : bookings.filter(b => b.userId === currentUser?.email)
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Split into upcoming and past
    const upcomingBookings = userBookings.filter(b => b.status === 'confirmed');
    const pastBookings = userBookings.filter(b => b.status === 'completed' || b.status === 'cancelled' || b.status === 're-rented' || b.status === 'rescheduled');

    const handleEdit = (booking: any) => {
        startEditing(booking, 'reschedule');
        navigate('/');
    };

    const handleCancel = (id: string) => {
        const booking = bookings.find(b => b.id === id);
        if (!booking) return;
        const refundText = booking.paymentMethod === 'subscription'
            ? `${booking.hoursDeducted || (booking.duration / 60)} ч. будут возвращены на ваш абонемент.`
            : `${booking.finalPrice} ₾ будут возвращены на ваш баланс.`;

        setModalConfig({
            isOpen: true,
            title: 'Отменить бронирование?',
            message: (
                <div className="space-y-2 text-sm text-unbox-grey">
                    <p>Это действие необратимо.</p>
                    <p className="font-medium text-unbox-dark bg-unbox-light/30 p-2 rounded-lg border border-unbox-light">{refundText}</p>
                </div>
            ),
            confirmLabel: 'Отменить бронь',
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await cancelBooking(id);
                    toast.success('Бронирование отменено');
                    refreshBookings();
                } catch (error: any) {
                    toast.error(error.response?.data?.detail || 'Не удалось отменить бронирование');
                }
            }
        });
    };

    const handleReRent = (id: string) => {
        setModalConfig({
            isOpen: true,
            title: 'Выставить на переаренду?',
            message: (
                <span>Если другой пользователь забронирует это время, вам вернется <b>50%</b> от стоимости бронирования на баланс.</span>
            ),
            confirmLabel: 'Выставить',
            isDestructive: false,
            onConfirm: async () => {
                try {
                    await bookingsApi.toggleReRent(id);
                    toast.success('Время выставлено на переаренду.');
                    refreshBookings();
                } catch (err: any) {
                    toast.error(err.response?.data?.detail || 'Ошибка');
                }
            }
        });
    };

    const handleCancelReRent = async (id: string) => {
        try {
            await bookingsApi.toggleReRent(id);
            toast.success('Убрано с переаренды');
            refreshBookings();
        } catch (err: any) {
            toast.error(err.response?.data?.detail || 'Ошибка');
        }
    };

    const handleLinkClient = async (bookingId: string, clientId: string | null) => {
        try {
            await bookingsApi.linkCrmClient(bookingId, clientId);
            toast.success(clientId ? 'Клиент привязан' : 'Клиент отвязан');
            refreshBookings();
        } catch (err: any) {
            toast.error(err.response?.data?.detail || 'Ошибка привязки');
        }
    };

    const handleBookAgain = (booking: any) => {
        const store = useBookingStore.getState();
        store.reset();
        store.setLocation(booking.locationId);
        store.setFormat(booking.format);
        store.setStep(2);
        navigate('/');
    };

    return (
        <div className="space-y-6 pb-20">
            {/* Header + view toggle */}
            <div className="flex items-center justify-between px-4 pt-6">
                <h1 className="text-2xl font-bold">Мои бронирования</h1>
                <div className="flex items-center gap-1 p-1 rounded-xl border border-unbox-light bg-white/60">
                    <button
                        onClick={() => setViewMode('list')}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                            viewMode === 'list'
                                ? "bg-unbox-green text-white shadow-sm"
                                : "text-unbox-grey hover:text-unbox-dark"
                        )}
                    >
                        <LayoutList size={14} /> Список
                    </button>
                    <button
                        onClick={() => setViewMode('grid')}
                        className={clsx(
                            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                            viewMode === 'grid'
                                ? "bg-unbox-green text-white shadow-sm"
                                : "text-unbox-grey hover:text-unbox-dark"
                        )}
                    >
                        <LayoutGrid size={14} /> Шахматка
                    </button>
                </div>
            </div>

            {currentUser?.subscription && (
                <div className="px-4">
                    <SubscriptionCard user={currentUser} />
                </div>
            )}

            {viewMode === 'grid' ? (
                <div className="px-4">
                    {crmMode && (
                        <div className="mb-3 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                            <CalendarIcon className="w-4 h-4 text-orange-500 shrink-0" />
                            <div className="flex-1 text-sm">
                                <span className="font-medium text-orange-800">Выберите слот для сессии с </span>
                                <span className="font-bold text-orange-900">{crmMode.clientName}</span>
                                <span className="text-orange-600 ml-1">
                                    · {format(new Date(crmMode.date), 'd MMM HH:mm', { locale: ru })}
                                </span>
                            </div>
                            <button
                                onClick={() => { setCrmMode(null); navigate('/crm', { replace: true }); }}
                                className="p-1 hover:bg-orange-100 rounded-lg text-orange-500 transition-colors"
                                title="Отмена"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                    <BookingsChessboard
                        userBookings={userBookings}
                        allBookings={bookings}
                        publicBookings={publicBookings}
                        onCancel={handleCancel}
                        onReschedule={handleEdit}
                        onReRent={handleReRent}
                        onCancelReRent={handleCancelReRent}
                        onLinkClient={handleLinkClient}
                        crmClients={crmClients.map(c => ({ id: c.id, name: c.name, aliasCode: c.aliasCode }))}
                        refreshBookings={refreshBookings}
                        crmMode={crmMode}
                        onCrmBooked={() => { setCrmMode(null); navigate('/crm'); }}
                        usersMap={usersMap}
                    />
                </div>
            ) : userBookings.length === 0 ? (
                <div className="text-center py-20 text-unbox-grey">
                    <div className="bg-unbox-light/50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Clock size={32} />
                    </div>
                    <h2 className="text-xl font-bold text-unbox-dark mb-2">У вас пока нет бронирований</h2>
                    <p className="mb-6">Самое время забронировать кабинет!</p>
                    <Link to="/"><Button onClick={() => useBookingStore.getState().reset()}>Забронировать</Button></Link>
                </div>
            ) : (
                <div className="px-4 space-y-6">
                    {/* Upcoming bookings */}
                    {upcomingBookings.length > 0 && (
                        <div className="space-y-4">
                            <h2 className="text-sm font-bold text-unbox-dark uppercase tracking-wider flex items-center gap-2">
                                <BadgeCheck size={14} className="text-unbox-green" /> Предстоящие
                            </h2>
                            {upcomingBookings.map(booking => (
                                <BookingCard
                                    key={booking.id}
                                    booking={booking}
                                    crmClients={crmClients}
                                    onCancel={handleCancel}
                                    onEdit={handleEdit}
                                    onReRent={handleReRent}
                                    onBookAgain={handleBookAgain}
                                    onLinkClient={handleLinkClient}
                                />
                            ))}
                        </div>
                    )}

                    {/* Past bookings */}
                    {pastBookings.length > 0 && (
                        <div className="space-y-4">
                            <h2 className="text-sm font-bold text-unbox-grey uppercase tracking-wider flex items-center gap-2">
                                <Clock size={14} /> Прошедшие
                            </h2>
                            {pastBookings.map(booking => (
                                <BookingCard
                                    key={booking.id}
                                    booking={booking}
                                    crmClients={crmClients}
                                    onCancel={handleCancel}
                                    onEdit={handleEdit}
                                    onReRent={handleReRent}
                                    onBookAgain={handleBookAgain}
                                    onLinkClient={handleLinkClient}
                                    isPast
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            <ConfirmationModal
                isOpen={modalConfig.isOpen}
                onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
                onConfirm={modalConfig.onConfirm}
                title={modalConfig.title}
                message={modalConfig.message}
                isDestructive={modalConfig.isDestructive}
                confirmLabel={modalConfig.confirmLabel}
            />
        </div>
    );
}


// ─── Booking Card (List view) ────────────────────────────────────────────────
function BookingCard({
    booking,
    crmClients,
    onCancel,
    onEdit,
    onReRent,
    onBookAgain,
    onLinkClient,
    isPast = false,
}: {
    booking: BookingHistoryItem;
    crmClients: Array<{ id: string; name: string; aliasCode?: string }>;
    onCancel: (id: string) => void;
    onEdit: (booking: BookingHistoryItem) => void;
    onReRent: (id: string) => void;
    onBookAgain: (booking: BookingHistoryItem) => void;
    onLinkClient: (bookingId: string, clientId: string | null) => void;
    isPast?: boolean;
}) {
    const canMod = (() => {
        if (booking.status !== 'confirmed' || !booking.startTime) return false;
        const [h, m] = booking.startTime.split(':').map(Number);
        const start = parseUTC(booking.date);
        start.setUTCHours(h, m, 0, 0);
        return (start.getTime() - Date.now()) > 24 * 60 * 60 * 1000;
    })();

    const clientInfo = booking.crmClientId ? crmClients.find(c => c.id === booking.crmClientId) : null;

    return (
        <Card className={clsx("p-6", isPast && "opacity-70")}>
            <div className="flex justify-between items-start mb-4">
                <div>
                    <div className="text-xs text-unbox-grey mb-1">
                        Забронировано: {format(new Date(booking.createdAt), 'd MMMM yyyy, HH:mm', { locale: ru })}
                    </div>
                    <h3 className="font-bold text-lg mb-1">
                        {RESOURCES.find(r => r.id === booking.resourceId)?.name || 'Кабинет'}
                    </h3>
                    <div className="text-sm text-unbox-grey mb-2">
                        {booking.locationId === 'unbox_one' ? 'Unbox One' : 'Unbox Uni'} · {booking.format === 'individual' ? 'Индивидуальный' : 'Групповой'}
                    </div>
                    <div className="text-unbox-dark mt-1 flex items-center gap-2 font-medium">
                        <Clock size={16} />
                        {format(parseUTC(booking.date), 'd MMMM', { locale: ru })}, {booking.startTime} ({booking.duration / 60}ч)
                    </div>
                    {clientInfo && (
                        <div className="text-xs text-unbox-green flex items-center gap-1 mt-1">
                            <UserIcon size={12} /> {clientInfo.aliasCode ? `${clientInfo.aliasCode} · ${clientInfo.name}` : clientInfo.name}
                        </div>
                    )}
                    {booking.status === 'confirmed' && !isPast && (
                        <button
                            onClick={() => {
                                if (!booking.startTime) return;
                                const [h, m] = booking.startTime.split(':').map(Number);
                                const start = parseUTC(booking.date);
                                start.setHours(h, m, 0, 0);
                                const end = new Date(start.getTime() + booking.duration * 60000);
                                window.open(generateGoogleCalendarUrl({ title: 'Бронирование Unbox', description: 'Бронирование кабинета', location: 'Unbox, Tbilisi', startTime: start, endTime: end }), '_blank');
                            }}
                            className="text-xs text-unbox-green hover:underline flex items-center gap-1 mt-1"
                        >
                            <CalendarIcon size={12} /> Добавить в календарь
                        </button>
                    )}
                    {booking.extras.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {booking.extras.map((extraId: string) => {
                                const extra = EXTRAS.find(e => e.id === extraId);
                                return extra ? (
                                    <span key={extraId} className="text-xs bg-unbox-light/50 px-2 py-1 rounded-md text-unbox-grey border border-unbox-light">
                                        + {extra.name}
                                    </span>
                                ) : null;
                            })}
                        </div>
                    )}
                </div>
                <div className={clsx(
                    "px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1",
                    {
                        'bg-unbox-light text-unbox-dark': booking.status === 'confirmed',
                        'bg-gray-100 text-gray-500': booking.status === 'completed',
                        'bg-red-50 text-red-400': booking.status === 'cancelled',
                        'bg-white border border-unbox-green text-unbox-green': booking.status === 're-rented',
                    }
                )}>
                    {booking.status === 'confirmed' && <><BadgeCheck size={12} /> Подтверждено</>}
                    {booking.status === 'cancelled' && <><XCircle size={12} /> Отменено</>}
                    {booking.status === 'completed' && <><Check size={12} /> Завершено</>}
                    {booking.status === 're-rented' && '♻️ Пересдано'}
                </div>
            </div>

            {/* Payment info */}
            <div className="flex flex-col gap-2 pt-4 border-t border-unbox-light">
                <div>
                    <div className="text-xs text-unbox-grey mb-0.5 uppercase font-medium">Оплата</div>
                    <div className="font-medium text-unbox-dark flex items-center gap-2">
                        {booking.paymentMethod === 'subscription' ? (
                            <><span className="w-2 h-2 rounded-full bg-unbox-dark" />Абонемент</>
                        ) : booking.paymentSource === 'credit' ? (
                            <><span className="w-2 h-2 rounded-full bg-unbox-grey" />Кредит</>
                        ) : (
                            <><span className="w-2 h-2 rounded-full bg-unbox-green" />Депозит</>
                        )}
                    </div>
                    <div className="text-sm text-unbox-grey mt-0.5">
                        {booking.paymentMethod === 'subscription' ? (
                            <span>Списано: <span className="font-bold text-unbox-dark">{booking.hoursDeducted || (booking.duration / 60)} ч</span></span>
                        ) : (
                            <span>
                                {booking.paymentSource === 'credit' ? 'Долг: ' : 'Оплачено: '}
                                <span className="font-bold text-unbox-dark">{booking.finalPrice} ₾</span>
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Actions for confirmed bookings */}
            {booking.status === 'confirmed' && !isPast && (
                <div className="mt-4 pt-4 border-t border-unbox-light">
                    {canMod ? (
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="flex-1" onClick={() => onEdit(booking)}>
                                Перенести
                            </Button>
                            <Button variant="ghost" size="sm" className="flex-1 text-unbox-grey hover:text-red-600 hover:bg-red-50" onClick={() => onCancel(booking.id)}>
                                Отменить
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <div className="bg-unbox-light border border-unbox-green/20 rounded-xl p-4 mb-2">
                                <h4 className="text-sm font-bold text-unbox-dark mb-3">Ваши доступы</h4>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="flex items-start gap-2">
                                        <Key className="w-4 h-4 text-unbox-green mt-0.5" />
                                        <div>
                                            <div className="text-[10px] uppercase font-bold text-unbox-green tracking-wider">Код от двери</div>
                                            <div className="text-sm font-mono font-bold text-unbox-dark bg-unbox-green/10 px-1.5 py-0.5 rounded inline-block mt-0.5">#{booking.id.slice(-4).toUpperCase()}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <Wifi className="w-4 h-4 text-unbox-green mt-0.5" />
                                        <div>
                                            <div className="text-[10px] uppercase font-bold text-unbox-green tracking-wider">Wi-Fi (Unbox_Guest)</div>
                                            <div className="text-sm font-mono font-bold text-unbox-dark bg-unbox-green/10 px-1.5 py-0.5 rounded inline-block mt-0.5">unbox2024</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs text-center text-unbox-grey italic bg-unbox-light/30 p-2 rounded-lg">
                                Менее 24ч до начала. Бесплатная отмена недоступна.
                            </div>
                            {booking.isReRentListed ? (
                                <div className="bg-unbox-light text-unbox-dark border border-unbox-green/30 p-3 rounded-lg text-sm text-center font-medium">
                                    ♻️ Выставлено на переаренду
                                </div>
                            ) : (
                                <Button variant="outline" size="sm" className="w-full border-dashed border-unbox-green text-unbox-green hover:bg-unbox-light" onClick={() => onReRent(booking.id)}>
                                    ♻️ Выставить на переаренду
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {booking.status === 're-rented' && (
                <div className="mt-4 pt-4 border-t border-unbox-light">
                    <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm text-center font-medium border border-green-100 flex flex-col items-center">
                        <span>Средства возвращены на баланс</span>
                        <span className="text-lg font-bold text-green-800">+{(booking.finalPrice * 0.5).toFixed(1)} ₾</span>
                    </div>
                </div>
            )}

            {(booking.status === 'completed' || booking.status === 'cancelled') && (
                <div className="mt-4 pt-4 border-t border-unbox-light">
                    <Button variant="outline" size="sm" className="w-full text-unbox-green border-unbox-green/30 hover:bg-unbox-light gap-2" onClick={() => onBookAgain(booking)}>
                        <Repeat size={16} /> Повторить бронирование
                    </Button>
                </div>
            )}
        </Card>
    );
}

// ── CRM Quick Booking Modal ───────────────────────────────────────────────────

function CrmQuickBookingModal({
    crmMode,
    slot,
    onClose,
    onBooked,
}: {
    crmMode: { sessionId: string; clientId: string; clientName: string; date: string; duration?: number };
    slot: { resId: string; time: string; date: Date };
    onClose: () => void;
    onBooked: () => void;
}) {
    const { updateSession } = useCrmStore();
    const resource = RESOURCES.find(r => r.id === slot.resId);
    const [duration, setDuration] = useState(crmMode.duration ?? 60);
    const [saving, setSaving] = useState(false);
    const dateStr = format(slot.date, 'yyyy-MM-dd');

    const endTime = (() => {
        const [h, m] = slot.time.split(':').map(Number);
        const end = addMinutes(setMinutes(setHours(slot.date, h), m), duration);
        return format(end, 'HH:mm');
    })();

    const handleBook = async () => {
        setSaving(true);
        try {
            const booking = await bookingsApi.createBooking({
                resourceId: slot.resId,
                date: dateStr,
                startTime: slot.time,
                duration,
                format: resource?.formats?.[0] || 'Стандарт',
                locationId: resource?.locationId,
            });
            await bookingsApi.linkCrmClient(booking.id, crmMode.clientId);
            // Sync booking time back to CRM session (non-blocking)
            try {
                const sessionDateStr = crmMode.date ? format(parseISO(crmMode.date), 'yyyy-MM-dd') : null;
                const sessionTime = crmMode.date ? format(parseISO(crmMode.date), 'HH:mm') : null;
                if (crmMode.sessionId && (dateStr !== sessionDateStr || slot.time !== sessionTime)) {
                    await updateSession(crmMode.sessionId, { date: `${dateStr}T${slot.time}:00` });
                }
            } catch {
                // Session sync is best-effort
            }
            toast.success(`Кабинет забронирован для ${crmMode.clientName}`);
            onBooked();
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            const msg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join(', ') : e.message || 'Ошибка бронирования';
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 animate-in slide-in-from-bottom-4 duration-200"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-start justify-between">
                    <div>
                        <h3 className="font-bold text-lg">Забронировать кабинет</h3>
                        <p className="text-sm text-unbox-grey mt-0.5">для сессии с <span className="font-medium text-unbox-dark">{crmMode.clientName}</span></p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-unbox-light rounded-lg">
                        <X className="w-5 h-5 text-unbox-grey" />
                    </button>
                </div>

                <div className="bg-unbox-light/50 rounded-xl p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Кабинет</span>
                        <span className="font-medium">{resource?.name || slot.resId}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Дата</span>
                        <span className="font-medium">{format(slot.date, 'd MMMM yyyy', { locale: ru })}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-unbox-grey">Время</span>
                        <span className="font-medium">{slot.time} — {endTime}</span>
                    </div>
                </div>

                <div>
                    <label className="text-xs font-medium text-unbox-grey mb-1.5 block">Длительность</label>
                    <div className="flex gap-2">
                        {[50, 60, 90, 120].map(d => (
                            <button
                                key={d}
                                onClick={() => setDuration(d)}
                                className={`flex-1 py-2 rounded-xl text-sm font-medium border transition-colors ${
                                    duration === d
                                        ? 'bg-unbox-green text-white border-unbox-green'
                                        : 'bg-white border-unbox-light text-unbox-grey hover:border-unbox-green/50'
                                }`}
                            >
                                {d === 120 ? '2ч' : `${d}м`}
                            </button>
                        ))}
                    </div>
                </div>

                <button
                    onClick={handleBook}
                    disabled={saving}
                    className="w-full py-3 bg-unbox-green text-white font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Забронировать
                </button>
            </div>
        </div>
    );
}
