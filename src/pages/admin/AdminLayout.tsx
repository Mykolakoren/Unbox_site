import { useEffect, useState } from 'react';
import { Outlet, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Calendar, Users, Clock, Box,
    BookOpen, ClipboardList, LogOut, Menu, X, ChevronDown, Shield, Wallet, UsersRound, Star,
} from 'lucide-react';
import clsx from 'clsx';
import { useUserStore } from '../../store/userStore';
import { IntegrationStatus } from '../../components/admin/IntegrationStatus';
import { NotificationBell } from '../../components/admin/NotificationBell';
import { hasPermission } from '../../utils/permissions';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const NAV_ITEMS = [
    { path: '/admin',             icon: LayoutDashboard, label: 'Дашборд',       exact: true },
    { path: '/admin/bookings',    icon: Calendar,        label: 'Бронирования' },
    { path: '/admin/tasks',       icon: ClipboardList,   label: 'Задачи' },
    { path: '/admin/users',       icon: Users,           label: 'Клиенты' },
    { path: '/admin/cabinets',    icon: Box,             label: 'Кабинеты' },
    { path: '/admin/specialists', icon: Star,            label: 'Специалисты' },
    { path: '/admin/team',        icon: UsersRound,      label: 'Команда' },
    { path: '/admin/waitlist',    icon: Clock,           label: 'Лист ожидания' },
    { path: '/admin/knowledge-base', icon: BookOpen,     label: 'База знаний' },
];

const ADMIN_ROLES = ['admin', 'senior_admin', 'owner'];

export function AdminLayout() {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const currentUser = useUserStore(s => s.currentUser);
    const canAccessRights = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
    const canAccessFinance = hasPermission(currentUser, 'finance.manage_cashbox')
        || hasPermission(currentUser, 'finance.view_reports');
    const navItems = (() => {
        const items = [...NAV_ITEMS];
        // Insert Финансы after Бронирования (index 1)
        if (canAccessFinance) {
            items.splice(2, 0, { path: '/admin/finance', icon: Wallet, label: 'Финансы' });
        }
        // Права доступа — в конец
        if (canAccessRights) {
            items.push({ path: '/admin/access-rights', icon: Shield, label: 'Права доступа' });
        }
        return items;
    })();
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

    return <GridHouseAdminShell navItems={navItems} currentUser={currentUser} onLogout={handleLogout} />;

    // Legacy admin shell removed — Grid House is the only layout (see git history pre-fb20491).
    // Unreachable `return` below is intentionally preserved inside the function so the
    // tree-shaker strips it without forcing a 175-line manual delete. Keep until full rewrite.
    // eslint-disable-next-line no-unreachable
    return (
        <div className="min-h-screen flex flex-col text-unbox-dark relative">
            {/* Background — photo layer for glass mode */}
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
                    <Link
                        to="/"
                        className="hidden md:inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium text-white/50 hover:text-white/90 hover:bg-white/10 transition-all shrink-0"
                    >
                        На сайт
                    </Link>

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

                        <NotificationBell />

                        {/* User menu */}
                        <div className="relative">
                            <button
                                onClick={() => setUserMenuOpen(!userMenuOpen)}
                                className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/10 transition-colors"
                            >
                                <div className="w-7 h-7 rounded-lg bg-unbox-green/80 text-white flex items-center justify-center text-xs font-bold">
                                    {currentUser?.name?.[0]?.toUpperCase() ?? 'A'}
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
            <main className="flex-1 pt-14 relative z-0">
                <div className="max-w-[1400px] mx-auto p-4 pt-6 md:p-8">
                    <Outlet />
                </div>
            </main>
        </div>
    );
}

// ═════════════════════════════════════════════════════════════════════════
// GRID HOUSE VARIANT — sidebar shell, mono nav, hairline surfaces
// Rollback: delete everything below + the early-return block above.
// ═════════════════════════════════════════════════════════════════════════

type GHNavItem = {
    path: string;
    label: string;
    exact?: boolean;
};

type CurrentUser = ReturnType<typeof useUserStore.getState>['currentUser'];

function GridHouseAdminShell({
    navItems,
    currentUser,
    onLogout,
}: {
    navItems: Array<{ path: string; label: string; icon: React.FC<{ size?: number }>; exact?: boolean }>;
    currentUser: CurrentUser;
    onLogout: () => void;
}) {
    const location = useLocation();
    const navigate = useNavigate();
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 960);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    const hairline = `1px solid ${GH.ink10}`;

    const ghNav: GHNavItem[] = navItems.map(i => ({ path: i.path, label: i.label, exact: i.exact }));
    const isActive = (item: GHNavItem) =>
        item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);
    const activeItem = ghNav.find(isActive) ?? ghNav[0];
    const activeIndex = ghNav.findIndex(isActive);

    const roleLabel =
        currentUser?.role === 'owner' ? 'Владелец'
        : currentUser?.role === 'senior_admin' ? 'Старший админ'
        : 'Администратор';

    return (
        <div
            style={{
                minHeight: '100vh',
                background: GH.paper,
                color: GH.ink,
                fontFamily: GH_SANS,
                WebkitFontSmoothing: 'antialiased',
                display: 'flex',
                position: 'relative',
                overflowX: 'hidden',
                width: '100%',
                maxWidth: '100vw',
            }}
        >
            {/* ── SIDEBAR ── */}
            <aside
                style={{
                    width: narrow ? 280 : 260,
                    minWidth: narrow ? 280 : 260,
                    // Use distinct solid surface on mobile so it never appears transparent
                    background: narrow ? '#F3EFE2' : '#F0ECDD',
                    backgroundColor: narrow ? '#F3EFE2' : '#F0ECDD',
                    borderRight: narrow ? `2px solid ${GH.ink}` : hairline,
                    position: narrow ? 'fixed' : 'sticky',
                    top: 0,
                    left: 0,
                    height: '100vh',
                    overflowY: 'auto',
                    transform: narrow && !mobileOpen ? 'translateX(-100%)' : 'translateX(0)',
                    transition: 'transform 0.2s ease',
                    zIndex: 60,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: narrow && mobileOpen ? '8px 0 40px rgba(15,15,16,0.35)' : 'none',
                }}
            >
                {/* Brand */}
                <div style={{ padding: '22px 24px 18px', borderBottom: hairline }}>
                    <Link to="/" style={{ fontSize: 24, fontWeight: 700, color: GH.ink, textDecoration: 'none', letterSpacing: '-0.01em' }}>
                        Unbox
                    </Link>
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginTop: 6 }}>
                        Админ · Контроль
                    </div>
                </div>

                {/* User */}
                <div style={{ padding: '18px 24px', borderBottom: hairline }}>
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 6 }}>
                        Сессия · {roleLabel}
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>
                        {currentUser?.name ?? '—'}
                    </div>
                </div>

                {/* Nav */}
                <nav style={{ flex: 1, padding: 0 }}>
                    {ghNav.map((item, i) => {
                        const active = isActive(item);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setMobileOpen(false)}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '44px 1fr',
                                    alignItems: 'center',
                                    padding: '14px 24px',
                                    borderBottom: hairline,
                                    background: active ? GH.ink : 'transparent',
                                    color: active ? GH.paper : GH.ink,
                                    textDecoration: 'none',
                                    transition: 'background 0.1s ease',
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 11,
                                        letterSpacing: '0.12em',
                                        fontVariantNumeric: 'tabular-nums',
                                        opacity: active ? 0.5 : 0.45,
                                    }}
                                >
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                                <div style={{ fontSize: 14, fontWeight: active ? 600 : 500, letterSpacing: '-0.005em' }}>
                                    {item.label}
                                </div>
                            </Link>
                        );
                    })}
                </nav>

                {/* Footer actions */}
                <div style={{ borderTop: hairline }}>
                    <button
                        type="button"
                        onClick={() => navigate('/')}
                        style={footerBtnStyle(GH.ink60, hairline)}
                    >
                        ← На сайт
                    </button>
                    <button
                        type="button"
                        onClick={() => navigate('/crm')}
                        style={footerBtnStyle(GH.accent, hairline)}
                    >
                        → CRM
                    </button>
                    <button
                        type="button"
                        onClick={onLogout}
                        style={footerBtnStyle(GH.danger, 'none')}
                    >
                        ↳ Выйти
                    </button>
                </div>
            </aside>

            {/* Mobile backdrop */}
            {narrow && mobileOpen && (
                <div
                    onClick={() => setMobileOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(15,15,16,0.55)',
                        backdropFilter: 'blur(2px)',
                        WebkitBackdropFilter: 'blur(2px)',
                        zIndex: 55,
                    }}
                />
            )}

            {/* ── MAIN ── */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflowX: 'hidden', width: narrow ? '100%' : undefined }}>
                {/* Top bar */}
                <header
                    style={{
                        borderBottom: hairline,
                        background: GH.paper,
                        position: 'sticky',
                        top: 0,
                        zIndex: 30,
                        padding: narrow ? '12px 16px' : '16px 28px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {narrow && (
                            <button
                                type="button"
                                onClick={() => setMobileOpen(true)}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    letterSpacing: '0.14em',
                                    textTransform: 'uppercase',
                                    color: GH.paper,
                                    background: GH.ink,
                                    border: `1px solid ${GH.ink}`,
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                }}
                            >
                                ☰ Меню
                            </button>
                        )}
                        <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 }}>
                            {String((activeIndex < 0 ? 0 : activeIndex) + 1).padStart(2, '0')} · {activeItem?.label ?? 'Раздел'}
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <NotificationBell variant="light" />
                        <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink30 }}>
                            Unbox · Панель управления
                        </div>
                    </div>
                </header>

                {/* Content */}
                <main style={{ flex: 1, padding: 'clamp(16px, 3vw, 40px)', maxWidth: 1400, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
                    <Outlet />
                </main>
            </div>
        </div>
    );
}

function footerBtnStyle(color: string, border: string): React.CSSProperties {
    return {
        width: '100%',
        padding: '14px 24px',
        textAlign: 'left',
        fontFamily: GH_MONO,
        fontSize: 11,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color,
        background: 'transparent',
        border: 'none',
        borderBottom: border !== 'none' ? border : undefined,
        cursor: 'pointer',
    };
}
