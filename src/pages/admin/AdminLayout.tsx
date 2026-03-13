import { useState } from 'react';
import { Outlet, Link, useLocation, Navigate } from 'react-router-dom';
import {
    LayoutDashboard, Calendar, Users, Clock, Box,
    BookOpen, ClipboardList, LogOut, Menu, X, ChevronDown, Shield,
} from 'lucide-react';
import clsx from 'clsx';
import { useUserStore } from '../../store/userStore';
import { IntegrationStatus } from '../../components/admin/IntegrationStatus';

const NAV_ITEMS = [
    { path: '/admin',            icon: LayoutDashboard, label: 'Обзор',        exact: true },
    { path: '/admin/cabinets',   icon: Box,             label: 'Кабинеты' },
    { path: '/admin/bookings',   icon: Calendar,        label: 'Бронирования' },
    { path: '/admin/users',      icon: Users,           label: 'Клиенты' },
    { path: '/admin/waitlist',   icon: Clock,           label: 'Лист ожидания' },
    { path: '/admin/tasks',      icon: ClipboardList,   label: 'Задачи' },
    { path: '/admin/knowledge-base', icon: BookOpen,    label: 'База данных' },
];

const ADMIN_ROLES = ['admin', 'senior_admin', 'owner'];

export function AdminLayout() {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const currentUser = useUserStore(s => s.currentUser);
    const canAccessRights = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
    const navItems = canAccessRights
        ? [...NAV_ITEMS, { path: '/admin/access-rights', icon: Shield, label: 'Права доступа' }]
        : NAV_ITEMS;
    const [mobileOpen, setMobileOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);

    // ── Access Guard ──────────────────────────────────────────────────────────
    const hasToken = Boolean(localStorage.getItem('token'));

    // No token → redirect to login immediately (no flash)
    if (!hasToken) return <Navigate to="/login" replace />;

    // Token exists but user not yet loaded → show blank screen while fetching
    if (!currentUser) return null;

    // User loaded but not an admin → redirect to home
    if (!ADMIN_ROLES.includes(currentUser.role ?? '')) return <Navigate to="/" replace />;
    // ─────────────────────────────────────────────────────────────────────────

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    const handleLogout = () => {
        logout();
        window.location.href = '/login';
    };

    return (
        <div className="min-h-screen flex flex-col text-unbox-dark relative">
            {/* Full-page photo background */}
            <div className="fixed inset-0 z-0">
                <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover object-[center_45%]" />
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.58)' }} />
            </div>

            {/* ── Top Navigation Bar ── */}
            <header
                className="fixed top-0 left-0 right-0 z-20 h-14"
                style={{
                    background: 'rgba(22,34,31,0.92)',
                    backdropFilter: 'blur(24px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 2px 24px rgba(0,0,0,0.18)',
                }}
            >
                <div className="max-w-[1400px] mx-auto h-full flex items-center gap-4 px-4">
                    {/* Logo */}
                    <Link to="/" className="shrink-0 mr-2">
                        <img src="/unbox-logo.png" alt="Unbox" className="h-8 object-contain brightness-0 invert opacity-90 hover:opacity-100 transition-opacity" />
                    </Link>

                    {/* Admin badge */}
                    <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-unbox-green/20 text-unbox-green text-[10px] font-bold uppercase tracking-wider border border-unbox-green/30 shrink-0">
                        Admin
                    </span>

                    {/* Desktop Nav */}
                    <nav className="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto no-scrollbar">
                        {navItems.map(item => (
                            <Link
                                key={item.path}
                                to={item.path}
                                className={clsx(
                                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-150',
                                    isActive(item.path, item.exact)
                                        ? 'bg-white/15 text-white'
                                        : 'text-white/55 hover:text-white/85 hover:bg-white/8'
                                )}
                            >
                                <item.icon size={15} />
                                {item.label}
                            </Link>
                        ))}
                    </nav>

                    {/* Right side */}
                    <div className="ml-auto flex items-center gap-2 shrink-0">
                        {/* Integration status — compact */}
                        <div className="hidden lg:block">
                            <IntegrationStatus compact />
                        </div>

                        {/* User menu */}
                        <div className="relative">
                            <button
                                onClick={() => setUserMenuOpen(!userMenuOpen)}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/10 transition-colors"
                            >
                                <div className="w-7 h-7 rounded-lg bg-unbox-green/80 text-white flex items-center justify-center text-xs font-bold">
                                    {currentUser?.name[0].toUpperCase() ?? 'A'}
                                </div>
                                <span className="hidden md:block text-sm text-white/80 font-medium max-w-[100px] truncate">
                                    {currentUser?.name}
                                </span>
                                <ChevronDown size={14} className={clsx('text-white/50 transition-transform', userMenuOpen && 'rotate-180')} />
                            </button>

                            {userMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                                    <div
                                        className="absolute right-0 top-full mt-2 w-52 rounded-xl overflow-hidden z-20 animate-in fade-in zoom-in-95 duration-150"
                                        style={{
                                            background: 'rgba(22,34,31,0.97)',
                                            backdropFilter: 'blur(20px)',
                                            border: '1px solid rgba(255,255,255,0.10)',
                                            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
                                        }}
                                    >
                                        <div className="px-4 py-3 border-b border-white/10">
                                            <div className="text-sm font-semibold text-white">{currentUser?.name}</div>
                                            <div className="text-xs text-white/50 capitalize">
                                                {currentUser?.role === 'owner' ? 'Владелец' : currentUser?.role === 'senior_admin' ? 'Ст. Администратор' : 'Администратор'}
                                            </div>
                                        </div>
                                        <div className="p-2">
                                            <Link
                                                to="/dashboard"
                                                onClick={() => setUserMenuOpen(false)}
                                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors w-full"
                                            >
                                                <LayoutDashboard size={14} />
                                                Личный кабинет
                                            </Link>
                                            <button
                                                onClick={handleLogout}
                                                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors w-full text-left mt-0.5"
                                            >
                                                <LogOut size={14} />
                                                Выйти
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {/* Mobile menu button */}
                        <button
                            onClick={() => setMobileOpen(!mobileOpen)}
                            className="md:hidden p-2 text-white/70 hover:text-white rounded-lg hover:bg-white/10 transition-colors"
                        >
                            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile nav drawer */}
            {mobileOpen && (
                <>
                    <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
                    <div
                        className="fixed top-14 left-0 right-0 z-40 md:hidden animate-in slide-in-from-top-2 duration-200"
                        style={{
                            background: 'rgba(22,34,31,0.97)',
                            backdropFilter: 'blur(20px)',
                            borderBottom: '1px solid rgba(255,255,255,0.08)',
                        }}
                    >
                        <nav className="p-3 grid grid-cols-2 gap-1">
                            {navItems.map(item => (
                                <Link
                                    key={item.path}
                                    to={item.path}
                                    onClick={() => setMobileOpen(false)}
                                    className={clsx(
                                        'flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
                                        isActive(item.path, item.exact)
                                            ? 'bg-white/15 text-white'
                                            : 'text-white/55 hover:text-white hover:bg-white/10'
                                    )}
                                >
                                    <item.icon size={16} />
                                    {item.label}
                                </Link>
                            ))}
                        </nav>
                        <div className="px-3 pb-3">
                            <IntegrationStatus />
                        </div>
                    </div>
                </>
            )}

            {/* Main Content */}
            <main className="flex-1 pt-14 relative z-10">
                <div className="max-w-[1400px] mx-auto p-4 pt-6 md:p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}
