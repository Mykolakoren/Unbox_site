import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import {
    CalendarDays, Plus, Clock, CheckCircle2,
    Users, BriefcaseMedical, Wallet, CalendarPlus,
} from 'lucide-react';
import { format, isToday, isTomorrow, isBefore } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useUserStore } from '../../store/userStore';
import { getMyBookingsPath } from '../../utils/userPaths';
import { useCrmModeStore } from '../../store/crmModeStore';
import { RESOURCES } from '../../utils/data';
import { crmApi } from '../../api/crm';
import type { User } from '../../store/types';
import type { BookingHistoryItem } from '../../store/types';

// ── Panel styles (post-Liquid Glass) ─────────────────────────────────────────
const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

const glassTile: React.CSSProperties = {
    background: 'rgba(255,255,255,0.80)',
    border: '1px solid rgba(0,0,0,0.05)',
    boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const parseUTC = (d: string | Date) => {
    const s = String(d);
    return new Date(s.endsWith('Z') || s.includes('+') ? s : s + 'Z');
};

function getResourceName(resourceId: string | null): string {
    if (!resourceId) return 'Кабинет';
    const res = RESOURCES.find(r => r.id === resourceId);
    return res?.name ?? resourceId;
}

function formatBookingDate(dateStr: string): string {
    const d = parseUTC(dateStr);
    if (isToday(d)) return 'Сегодня';
    if (isTomorrow(d)) return 'Завтра';
    return format(d, 'd MMMM', { locale: ru });
}

function formatTimeRange(startTime: string | null, duration: number): string {
    if (!startTime) return '';
    const [h, m] = startTime.split(':').map(Number);
    const start = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const endMins = h * 60 + m + duration;
    const end = `${String(Math.floor(endMins / 60)).padStart(2, '0')}:${String(endMins % 60).padStart(2, '0')}`;
    return `${start} – ${end}`;
}

// ── Booking card ─────────────────────────────────────────────────────────────
function BookingCard({ booking }: { booking: BookingHistoryItem }) {
    const navigate = useNavigate();
    const currentUser = useUserStore(s => s.currentUser);
    const isPast = (() => {
        const d = parseUTC(booking.date);
        if (!booking.startTime) return isBefore(d, new Date());
        const [h, m] = booking.startTime.split(':').map(Number);
        const bookingEnd = new Date(d);
        bookingEnd.setHours(h, m + booking.duration, 0, 0);
        return isBefore(bookingEnd, new Date());
    })();

    const statusColors: Record<string, { bg: string; text: string; label: string }> = {
        confirmed: { bg: 'rgba(71,109,107,0.12)', text: 'rgb(71,109,107)', label: 'Подтверждена' },
        completed: { bg: 'rgba(107,114,128,0.10)', text: 'rgb(107,114,128)', label: 'Завершена' },
        cancelled: { bg: 'rgba(239,68,68,0.10)', text: 'rgb(239,68,68)', label: 'Отменена' },
        'no_show': { bg: 'rgba(245,158,11,0.10)', text: 'rgb(245,158,11)', label: 'Не пришёл' },
        rescheduled: { bg: 'rgba(99,102,241,0.10)', text: 'rgb(99,102,241)', label: 'Перенесена' },
        're-rented': { bg: 'rgba(168,85,247,0.10)', text: 'rgb(168,85,247)', label: 'Пересдана' },
    };

    const st = statusColors[booking.status] ?? statusColors.confirmed;

    return (
        <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2, scale: 1.01 }}
            whileTap={{ scale: 0.98 }}
            className="rounded-2xl p-4 cursor-pointer group transition-shadow hover:shadow-lg"
            style={glassTile}
            onClick={() => navigate(getMyBookingsPath(currentUser))}
        >
            <div className="flex items-start gap-3">
                {/* Date badge */}
                <div className="w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0"
                    style={{ background: isPast ? 'rgba(107,114,128,0.08)' : 'rgba(71,109,107,0.10)', border: `1px solid ${isPast ? 'rgba(107,114,128,0.15)' : 'rgba(71,109,107,0.20)'}` }}
                >
                    <span className="text-[10px] font-bold uppercase leading-none" style={{ color: isPast ? 'rgb(107,114,128)' : 'rgb(71,109,107)' }}>
                        {format(parseUTC(booking.date), 'EEE', { locale: ru })}
                    </span>
                    <span className="text-lg font-black leading-none" style={{ color: isPast ? 'rgb(107,114,128)' : 'rgb(71,109,107)' }}>
                        {format(parseUTC(booking.date), 'd')}
                    </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-sm text-unbox-dark truncate">
                            {getResourceName(booking.resourceId)}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                            style={{ background: st.bg, color: st.text }}
                        >
                            {st.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-unbox-dark/55">
                        <span className="flex items-center gap-1">
                            <Clock size={11} />
                            {formatTimeRange(booking.startTime, booking.duration)}
                        </span>
                        <span className="flex items-center gap-1">
                            <CalendarDays size={11} />
                            {formatBookingDate(String(booking.date))}
                        </span>
                    </div>
                </div>

                {/* Price */}
                <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-unbox-dark">
                        {booking.finalPrice?.toFixed(0)} ₾
                    </div>
                    <div className="text-[10px] text-unbox-dark/40">
                        {(booking.duration / 60).toFixed(1)}ч
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

// ── Main portal ──────────────────────────────────────────────────────────────
interface Props {
    user: User;
}

export function SpecialistPortalHero({ user }: Props) {
    const { bookings, fetchBookings } = useUserStore();
    const navigate = useNavigate();
    // Alias for clarity — helpers ниже принимают user-like объект.
    const currentUser = user;
    const firstName = user.name?.split(' ')[0] ?? 'Специалист';
    const isAdmin = user.role === 'admin' || user.role === 'senior_admin' || user.role === 'owner';

    // Check CRM access to show quick-action shortcuts only if CRM mode is active
    const hasRoleCrmAccess = user.role === 'specialist' || user.role === 'owner' || user.role === 'senior_admin';
    const [hasCrmAccess, setHasCrmAccess] = useState<boolean>(hasRoleCrmAccess);
    const crmModeEnabled = useCrmModeStore(s => s.enabled);
    const showCrmShortcuts = hasCrmAccess && crmModeEnabled;

    useEffect(() => {
        fetchBookings();
    }, [fetchBookings]);

    useEffect(() => {
        if (hasRoleCrmAccess) {
            setHasCrmAccess(true);
            return;
        }
        crmApi.getMyAccess()
            .then(s => setHasCrmAccess(s.accessStatus === 'active'))
            .catch(() => setHasCrmAccess(false));
    }, [hasRoleCrmAccess, user.id]);

    // ── Filter user's bookings ──────────────────────────────────────
    const myBookings = useMemo(() => {
        return bookings
            .filter(b => b.userId === user.id || b.userId === user.email)
            .sort((a, b) => {
                const da = parseUTC(a.date).getTime();
                const db = parseUTC(b.date).getTime();
                return da - db;
            });
    }, [bookings, user.id, user.email]);

    const upcomingBookings = useMemo(() => {
        const now = new Date();
        return myBookings.filter(b => {
            if (b.status === 'cancelled' || b.status === 'rescheduled') return false;
            const d = parseUTC(b.date);
            if (!b.startTime) return !isBefore(d, now);
            const [h, m] = b.startTime.split(':').map(Number);
            const end = new Date(d);
            end.setHours(h, m + b.duration, 0, 0);
            return !isBefore(end, now);
        });
    }, [myBookings]);

    const pastBookings = useMemo(() => {
        const now = new Date();
        return myBookings
            .filter(b => {
                const d = parseUTC(b.date);
                if (!b.startTime) return isBefore(d, now);
                const [h, m] = b.startTime.split(':').map(Number);
                const end = new Date(d);
                end.setHours(h, m + b.duration, 0, 0);
                return isBefore(end, now);
            })
            .slice(-3)
            .reverse();
    }, [myBookings]);

    // ── Stats ───────────────────────────────────────────────────────
    const totalBookings = myBookings.length;
    // const totalSpent = myBookings.reduce((sum, b) => sum + (b.finalPrice || 0), 0);

    return (
        <div className="w-full flex flex-col gap-4">
            {/* ── Welcome header ── */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="rounded-[20px] sm:rounded-[28px] px-4 py-4 sm:px-8 sm:py-6"
                style={glassPanel}
            >
                <div className="flex items-center gap-3 sm:gap-4">
                    {/* Avatar */}
                    <div
                        className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 text-base sm:text-xl font-black text-white select-none"
                        style={{ background: 'rgba(71,109,107,0.70)', border: '2px solid rgba(255,255,255,0.50)' }}
                    >
                        {firstName[0]}
                    </div>

                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                            <h1 className="text-base sm:text-xl font-black text-unbox-dark leading-tight">
                                {firstName}, добро пожаловать!
                            </h1>
                            {isAdmin && (
                                <span className="flex items-center gap-0.5 text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                    style={{ background: 'rgba(71,109,107,0.15)', color: 'rgb(71,109,107)', border: '1px solid rgba(71,109,107,0.25)' }}
                                >
                                    <CheckCircle2 size={9} />
                                    {user.role === 'owner' ? 'Owner' : user.role === 'senior_admin' ? 'Senior Admin' : 'Admin'}
                                </span>
                            )}
                        </div>
                        <p className="text-unbox-dark/50 text-xs sm:text-sm truncate">{user.email}</p>
                    </div>

                    {/* Quick stats */}
                    <div className="flex gap-2 shrink-0">
                        {[
                            { icon: CalendarDays, label: 'Брони', value: totalBookings },
                            { icon: Wallet, label: 'Баланс', value: `${user.balance?.toFixed(0) ?? 0} ₾` },
                        ].map(s => (
                            <div key={s.label} className="flex flex-col items-center gap-0.5 rounded-xl sm:rounded-2xl px-2.5 sm:px-4 py-2 sm:py-2.5"
                                style={{ background: 'rgba(71,109,107,0.06)', border: '1px solid rgba(71,109,107,0.12)' }}
                            >
                                <s.icon size={12} className="text-unbox-dark/40 sm:hidden" />
                                <s.icon size={14} className="text-unbox-dark/40 hidden sm:block mb-0.5" />
                                <span className="text-unbox-dark font-black text-sm sm:text-base leading-none">{s.value}</span>
                                <span className="text-unbox-dark/35 text-[9px] sm:text-[10px]">{s.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </motion.div>

            {/* ── Upcoming bookings ── */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.08 }}
                className="rounded-[28px] px-6 py-5 sm:px-8"
                style={glassPanel}
            >
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-bold text-unbox-dark text-base flex items-center gap-2">
                        <CalendarDays size={18} className="text-unbox-green" />
                        Ближайшие брони
                    </h2>
                    <div className="flex gap-2">
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => navigate(getMyBookingsPath(currentUser))}
                            className="text-xs font-semibold px-3 py-1.5 rounded-xl text-unbox-dark/60 hover:text-unbox-dark transition-colors"
                            style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(255,255,255,0.80)' }}
                        >
                            Все брони
                        </motion.button>
                        <motion.button
                            whileHover={{ scale: 1.05 }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => navigate(getMyBookingsPath(currentUser))}
                            className="text-xs font-semibold px-3 py-1.5 rounded-xl text-white transition-colors flex items-center gap-1"
                            style={{ background: 'rgba(71,109,107,0.85)' }}
                        >
                            <Plus size={13} />
                            Новая бронь
                        </motion.button>
                    </div>
                </div>

                {upcomingBookings.length === 0 ? (
                    <div className="text-center py-8">
                        <CalendarPlus size={36} className="mx-auto text-unbox-dark/20 mb-3" />
                        <p className="text-unbox-dark/40 text-sm mb-3">Нет предстоящих бронирований</p>
                        <motion.button
                            whileHover={{ scale: 1.03 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => navigate(getMyBookingsPath(currentUser))}
                            className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white"
                            style={{ background: 'rgba(71,109,107,0.85)' }}
                        >
                            Забронировать кабинет
                        </motion.button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {upcomingBookings.slice(0, 4).map(b => (
                            <BookingCard key={b.id} booking={b} />
                        ))}
                        {upcomingBookings.length > 4 && (
                            <button
                                onClick={() => navigate(getMyBookingsPath(currentUser))}
                                className="text-xs text-unbox-green font-semibold text-center py-2 hover:underline"
                            >
                                Ещё {upcomingBookings.length - 4} бронирований →
                            </button>
                        )}
                    </div>
                )}
            </motion.div>

            {/* ── Quick actions row (only if CRM mode is active) ── */}
            {showCrmShortcuts && (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.16 }}
                className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
            >
                {[
                    { icon: CalendarDays, label: 'Мои брони', href: getMyBookingsPath(currentUser), color: 'rgba(99,102,241,1)', bg: 'rgba(99,102,241,0.08)' },
                    { icon: Users, label: 'Мои клиенты', href: '/crm', color: 'rgba(71,109,107,1)', bg: 'rgba(71,109,107,0.08)' },
                    { icon: BriefcaseMedical, label: 'Сессии', href: '/crm/sessions', color: 'rgba(168,85,247,1)', bg: 'rgba(168,85,247,0.08)' },
                    { icon: Wallet, label: 'Финансы', href: '/crm/finances', color: 'rgba(245,158,11,1)', bg: 'rgba(245,158,11,0.08)' },
                ].map((item, i) => {
                    const Icon = item.icon;
                    return (
                        <motion.div
                            key={item.label}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 + i * 0.05 }}
                            whileHover={{ y: -3, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                        >
                            <Link
                                to={item.href}
                                className="flex items-center gap-3 p-3.5 rounded-2xl group"
                                style={glassTile}
                            >
                                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform"
                                    style={{ background: item.bg }}
                                >
                                    <Icon size={17} style={{ color: item.color }} />
                                </div>
                                <span className="font-semibold text-sm text-unbox-dark/80 group-hover:text-unbox-dark transition-colors">
                                    {item.label}
                                </span>
                            </Link>
                        </motion.div>
                    );
                })}
            </motion.div>
            )}

            {/* ── Past bookings (collapsed) ── */}
            {pastBookings.length > 0 && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.3 }}
                    className="rounded-[28px] px-6 py-4 sm:px-8"
                    style={{ ...glassPanel, background: 'rgba(255,255,255,0.65)' }}
                >
                    <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-unbox-dark/50 flex items-center gap-2">
                            <Clock size={14} />
                            Последние визиты
                        </h3>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        {pastBookings.map(b => (
                            <div key={b.id} className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-white/40 transition-colors">
                                <div className="flex items-center gap-3">
                                    <span className="text-xs text-unbox-dark/40 w-16">
                                        {format(parseUTC(b.date), 'd MMM', { locale: ru })}
                                    </span>
                                    <span className="text-sm text-unbox-dark/70 font-medium">
                                        {getResourceName(b.resourceId)}
                                    </span>
                                </div>
                                <span className="text-sm text-unbox-dark/50 font-semibold">
                                    {b.finalPrice?.toFixed(0)} ₾
                                </span>
                            </div>
                        ))}
                    </div>
                </motion.div>
            )}
        </div>
    );
}
