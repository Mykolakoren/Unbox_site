import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
    Users, CalendarDays, LayoutDashboard, UserCircle,
    ChevronRight, Star, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import type { User } from '../../store/types';

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.14)',
    backdropFilter: 'blur(36px) saturate(160%)',
    WebkitBackdropFilter: 'blur(36px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.28)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.45)',
};

const glassTile: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

const MENU_TILES = [
    {
        icon: Users,
        label: 'Мои клиенты',
        sublabel: 'CRM и записи',
        href: '/crm',
        color: 'rgba(71,109,107,1)',
        bg: 'rgba(71,109,107,0.10)',
        bgHover: 'rgba(71,109,107,0.18)',
        border: 'rgba(71,109,107,0.22)',
    },
    {
        icon: CalendarDays,
        label: 'Бронирования',
        sublabel: 'Мои кабинеты',
        href: '/dashboard',
        color: 'rgba(99,102,241,1)',
        bg: 'rgba(99,102,241,0.08)',
        bgHover: 'rgba(99,102,241,0.16)',
        border: 'rgba(99,102,241,0.20)',
    },
    {
        icon: LayoutDashboard,
        label: 'Дашборд',
        sublabel: 'Личный кабинет',
        href: '/dashboard',
        color: 'rgba(245,158,11,1)',
        bg: 'rgba(245,158,11,0.08)',
        bgHover: 'rgba(245,158,11,0.16)',
        border: 'rgba(245,158,11,0.20)',
    },
    {
        icon: UserCircle,
        label: 'Профиль',
        sublabel: 'Настройки',
        href: '/dashboard',
        color: 'rgba(16,185,129,1)',
        bg: 'rgba(16,185,129,0.08)',
        bgHover: 'rgba(16,185,129,0.16)',
        border: 'rgba(16,185,129,0.20)',
    },
];

interface Props {
    user: User;
}

export function SpecialistPortalHero({ user }: Props) {
    const firstName = user.name?.split(' ')[0] ?? 'Специалист';
    const isVerified = user.role === 'specialist'; // has specialist role = verified

    return (
        <div className="w-full flex flex-col gap-4">
            {/* ── Welcome header ── */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="rounded-[28px] px-8 py-7 flex flex-col sm:flex-row sm:items-center gap-5"
                style={glassPanel}
            >
                {/* Avatar */}
                <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center shrink-0 text-2xl font-black text-white select-none"
                    style={{ background: 'rgba(71,109,107,0.60)', border: '2px solid rgba(255,255,255,0.40)' }}
                >
                    {firstName[0]}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h1 className="text-xl font-black text-white leading-none">
                            Добро пожаловать, {firstName}
                        </h1>
                        {isVerified ? (
                            <span
                                className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(71,109,107,0.30)', color: 'rgba(200,240,230,1)', border: '1px solid rgba(71,109,107,0.45)' }}
                            >
                                <CheckCircle2 size={10} />
                                Верифицирован
                            </span>
                        ) : (
                            <span
                                className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                                style={{ background: 'rgba(245,158,11,0.25)', color: 'rgba(255,210,100,1)', border: '1px solid rgba(245,158,11,0.40)' }}
                            >
                                <AlertCircle size={10} />
                                На проверке
                            </span>
                        )}
                    </div>
                    <p className="text-white/55 text-sm">
                        {user.email}
                    </p>
                </div>

                {/* Quick stats */}
                <div className="flex gap-4 shrink-0">
                    {[
                        { icon: Clock, label: 'Бронирований', value: '—' },
                        { icon: Star, label: 'Клиентов', value: '—' },
                    ].map(s => (
                        <div
                            key={s.label}
                            className="flex flex-col items-center gap-0.5 rounded-2xl px-4 py-2.5"
                            style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.20)' }}
                        >
                            <s.icon size={14} className="text-white/50 mb-0.5" />
                            <span className="text-white font-black text-base leading-none">{s.value}</span>
                            <span className="text-white/40 text-[10px]">{s.label}</span>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* ── Menu tiles ── */}
            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 }}
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
            >
                {MENU_TILES.map((tile, i) => {
                    const Icon = tile.icon;
                    return (
                        <motion.div
                            key={tile.label}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 + i * 0.06 }}
                            whileHover={{ y: -4, scale: 1.02 }}
                            whileTap={{ scale: 0.97 }}
                        >
                            <Link
                                to={tile.href}
                                className="flex flex-col gap-3 p-5 rounded-3xl group block"
                                style={glassTile}
                            >
                                <div
                                    className="w-11 h-11 rounded-2xl flex items-center justify-center transition-all duration-200 group-hover:scale-110"
                                    style={{ background: tile.bg, border: `1px solid ${tile.border}` }}
                                >
                                    <Icon size={20} style={{ color: tile.color }} />
                                </div>
                                <div>
                                    <div className="font-bold text-unbox-dark text-sm leading-tight">{tile.label}</div>
                                    <div className="text-unbox-dark/45 text-xs mt-0.5">{tile.sublabel}</div>
                                </div>
                                <div
                                    className="flex items-center gap-1 text-xs font-semibold mt-auto opacity-0 group-hover:opacity-100 transition-opacity"
                                    style={{ color: tile.color }}
                                >
                                    Открыть <ChevronRight size={12} />
                                </div>
                            </Link>
                        </motion.div>
                    );
                })}
            </motion.div>

            {/* ── Quick links row ── */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="flex flex-wrap gap-2"
            >
                {[
                    { label: '📅 Забронировать кабинет', href: '/dashboard' },
                    { label: '➕ Добавить клиента', href: '/crm' },
                    { label: '💬 Поддержка', href: 'https://t.me/UnboxCenter', external: true },
                ].map(link => (
                    link.external ? (
                        <a
                            key={link.label}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 rounded-xl text-xs font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-all hover:-translate-y-0.5"
                            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.72)' }}
                        >
                            {link.label}
                        </a>
                    ) : (
                        <Link
                            key={link.label}
                            to={link.href}
                            className="px-4 py-2 rounded-xl text-xs font-semibold text-unbox-dark/70 hover:text-unbox-dark transition-all hover:-translate-y-0.5"
                            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,255,255,0.72)' }}
                        >
                            {link.label}
                        </Link>
                    )
                ))}
            </motion.div>
        </div>
    );
}
