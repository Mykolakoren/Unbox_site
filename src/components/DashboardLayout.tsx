import { Outlet, useNavigate, Link, useLocation, Navigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { QuickActionsFab, type QuickAction } from './ui/QuickActionsFab';
import { Calendar, Settings, LayoutDashboard, ShieldCheck, Loader2, Menu, X, LogOut, Plus, Search, FileText, Bell, Smartphone, Gift, CreditCard } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmAccessToggle } from './CrmAccessToggle';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

export function DashboardLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }
        if (currentUser) {
            setIsLoading(false);
            return;
        }
        fetchCurrentUser()
            .then(() => setIsLoading(false))
            .catch(() => {
                localStorage.removeItem('token');
                navigate('/login');
            });
    }, [currentUser, navigate, fetchCurrentUser]);

    if (isLoading || !currentUser) {
        return (
            <div className="flex items-center justify-center min-h-screen" style={{ background: GH.paper }}>
                <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
            </div>
        );
    }

    // 2026-06-05 owner: специалисты больше не «висят» в /dashboard —
    // их основной шелл /crm, со всеми личными функциями уже встроенными.
    // Прямой URL /dashboard/* (старая закладка, ручной набор) → молча
    // перенаправляем на эквивалент в /crm. Чистые юзеры (role='user' или
    // role не указан) и админы продолжают видеть /dashboard как было —
    // у первых это основной шелл, у вторых — fallback для личного.
    if (currentUser.role === 'specialist') {
        const path = window.location.pathname;
        const search = window.location.search;
        const hash = window.location.hash;
        const map: Record<string, string> = {
            '/dashboard':         '/crm',
            '/dashboard/bookings':'/crm/bookings',
            '/dashboard/waitlist':'/crm/waitlist',
            '/dashboard/bonuses': '/crm/bonuses',
            '/dashboard/profile': '/crm/account',
        };
        const target = map[path];
        if (target) {
            return <Navigate to={target + search + hash} replace />;
        }
        // Любой другой /dashboard/* — на CRM index.
        if (path.startsWith('/dashboard')) {
            return <Navigate to="/crm" replace />;
        }
    }

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner';
    // Anyone who can book — specialists included — should see the Mobile link
    // and get into /m. Earlier the sidebar entry was admin-only because the
    // beta was admin-only; that gate is now lifted on MobileLayout itself,
    // so we widen the link visibility too.
    const canBook = isAdmin || currentUser.role === 'specialist' || currentUser.isAdmin;

    // 2026-06-05 owner: для клиентов sidebar теперь самодостаточный —
    // вместо общих «Настроек» отдельные пункты Абонементы / Бонусы
    // (раньше были только из кнопок в /dashboard и теряли видимость).
    // «Mobile (beta)» переименовано в «С телефона» — слово beta устарело
    // (мобильный давно основной интерфейс на phone-width).
    const navItems = [
        { icon: LayoutDashboard, label: 'Обзор',            path: '/dashboard',          exact: true },
        { icon: Calendar,        label: 'Мои бронирования', path: '/dashboard/bookings' },
        { icon: Bell,            label: 'Слежу за слотами', path: '/dashboard/waitlist' },
        { icon: CreditCard,      label: 'Абонементы',       path: '/subscriptions' },
        { icon: Gift,            label: 'Бонусы',           path: '/dashboard/bonuses' },
        { icon: Settings,        label: 'Профиль',          path: '/dashboard/profile' },
        ...(isAdmin ? [{ icon: ShieldCheck, label: 'Админ-панель', path: '/admin' }] : []),
        // С телефона — для тех у кого есть booking permission. MobileLayout
        // enforces access check внутри. App.tsx редирект автоматически
        // переводит phone-width на /m, поэтому desktop-ссылка нужна только
        // как «открыть руками» (например с iPad).
        ...(canBook ? [{ icon: Smartphone, label: 'С телефона', path: '/m' }] : []),
        // Legal — placed last so it sits right above the divider/"Выйти"
        // at the bottom of the sidebar; far enough from primary nav not
        // to compete for attention but always visible without scroll.
        { icon: FileText,        label: 'Правила бронирования', path: '/booking-rules' },
    ];

    const quickActions: QuickAction[] = [
        // Excel #17: was '/booking' (wizard) but admins wanted the chessboard.
        // /dashboard/bookings is where users actually pick a slot and confirm.
        { label: 'Забронировать кабинет', sub: 'Выбрать слот в шахматке', path: '/dashboard/bookings', icon: Plus },
        { label: 'Мои бронирования', sub: 'Ближайшие и история', path: '/dashboard/bookings', icon: Calendar },
        { label: 'Найти специалиста', sub: 'Каталог и запись', path: '/specialists', icon: Search },
    ];

    return (
        <GridHouseDashboardShell
            navItems={navItems}
            currentUser={currentUser}
            quickActions={quickActions}
        />
    );
}

// ═══════════════════════════════════════════════════════════════
// Grid House — Dashboard Shell
// ═══════════════════════════════════════════════════════════════

const ghMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
};

function GridHouseDashboardShell({
    navItems,
    currentUser,
    quickActions,
}: {
    navItems: Array<{ path: string; label: string; icon: React.ElementType; exact?: boolean }>;
    currentUser: any;
    quickActions: QuickAction[];
}) {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 960);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    const hairline = `1px solid ${GH.ink10}`;

    const isActive = (item: { path: string; exact?: boolean }) =>
        item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path);

    const handleLogout = () => {
        logout();
        window.location.href = '/login';
    };

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
            }}
        >
            {/* ── SIDEBAR ── */}
            <aside
                style={{
                    width: 240,
                    minWidth: 240,
                    // Opaque base (GH.paper) + subtle ink5 tint via layered gradient —
                    // prevents content bleed-through when sidebar slides over main on mobile.
                    background: `linear-gradient(${GH.ink5}, ${GH.ink5}), ${GH.paper}`,
                    borderRight: hairline,
                    position: narrow ? 'fixed' : 'sticky',
                    top: 0,
                    left: 0,
                    height: '100vh',
                    overflowY: 'auto',
                    transform: narrow && !mobileOpen ? 'translateX(-100%)' : 'translateX(0)',
                    transition: 'transform 0.2s ease',
                    zIndex: 50,
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: narrow && mobileOpen ? '2px 0 24px rgba(0,0,0,0.12)' : 'none',
                }}
            >
                {/* Brand */}
                <div style={{ padding: '22px 24px 18px', borderBottom: hairline }}>
                    <Link to="/" style={{ fontSize: 24, fontWeight: 700, color: GH.ink, textDecoration: 'none', letterSpacing: '-0.01em' }}>
                        Unbox
                    </Link>
                    <div style={{ ...ghMono, color: GH.ink60, marginTop: 6 }}>
                        Кабинет
                    </div>
                </div>

                {/* User */}
                <div style={{ padding: '18px 24px', borderBottom: hairline }}>
                    <div style={{ ...ghMono, color: GH.ink60, marginBottom: 6 }}>
                        Пользователь
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.005em' }}>
                        {currentUser.name}
                    </div>
                </div>

                {/* CRM toggle — owner 2026-06-05: показываем только тем кому
                    он реально нужен (запросить доступ). Для специалистов/
                    админов /crm стал основной рабочей зоной (login redirect),
                    toggle тут только мусорит — у них есть прямые пути. */}
                {currentUser.role !== 'specialist'
                  && currentUser.role !== 'admin'
                  && currentUser.role !== 'senior_admin'
                  && currentUser.role !== 'owner' && (
                    <div style={{ padding: '12px 24px', borderBottom: hairline }}>
                        <CrmAccessToggle />
                    </div>
                )}

                {/* Nav */}
                <nav style={{ flex: 1, padding: '12px 0' }}>
                    {navItems.map((item, i) => {
                        const active = isActive(item);
                        return (
                            <Link
                                key={item.path}
                                to={item.path}
                                onClick={() => setMobileOpen(false)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '12px 24px',
                                    fontSize: 14,
                                    fontWeight: active ? 700 : 500,
                                    color: active ? GH.ink : GH.ink60,
                                    textDecoration: 'none',
                                    background: active ? GH.paper : 'transparent',
                                    borderLeft: active ? `3px solid ${GH.ink}` : '3px solid transparent',
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <span style={{ ...ghMono, width: 20, textAlign: 'center', color: active ? GH.ink : GH.ink30 }}>
                                    {String(i + 1).padStart(2, '0')}
                                </span>
                                {item.label}
                            </Link>
                        );
                    })}
                </nav>

                {/* Bottom */}
                <div style={{ padding: '16px 24px', borderTop: hairline }}>
                    <button
                        onClick={handleLogout}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'none', border: 'none', color: GH.danger,
                            fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0,
                        }}
                    >
                        <LogOut size={14} />
                        Выйти
                    </button>
                    <Link
                        to="/"
                        style={{
                            display: 'block', marginTop: 12,
                            ...ghMono, color: GH.ink30, textDecoration: 'none', fontSize: 10,
                        }}
                    >
                        ← На сайт
                    </Link>
                </div>
            </aside>

            {/* Mobile overlay */}
            {narrow && mobileOpen && (
                <div
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 40 }}
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* ── MAIN ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Top bar */}
                <header
                    style={{
                        padding: narrow ? '14px 20px' : '14px 32px',
                        borderBottom: hairline,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        position: 'sticky',
                        top: 0,
                        background: GH.paper,
                        zIndex: 30,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {narrow && (
                            <button
                                onClick={() => setMobileOpen(!mobileOpen)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: GH.ink, padding: 0 }}
                            >
                                {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                            </button>
                        )}
                        <span style={{ ...ghMono, color: GH.ink30 }}>
                            Unbox · Кабинет
                        </span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>
                        {currentUser.name}
                    </span>
                </header>

                {/* Content */}
                <main style={{ flex: 1, padding: narrow ? '24px 20px' : '32px 40px' }}>
                    <Outlet />
                </main>
            </div>
            <QuickActionsFab actions={quickActions} />
        </div>
    );
}
