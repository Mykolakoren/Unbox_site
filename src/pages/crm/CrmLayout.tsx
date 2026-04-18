import { Outlet, useNavigate, Navigate, useLocation, Link } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { SidebarLayout } from '../../components/SidebarLayout';
import { QuickActionsFab, type QuickAction } from '../../components/ui/QuickActionsFab';
import {
    Settings,
    ArrowLeft,
    LayoutDashboard,
    Users,
    Calendar,
    Wallet,
    StickyNote,
    Loader2,
    BookOpen,
    Clock,
    UserCircle,
    Shield,
    UserPlus,
    Plus,
    ExternalLink,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmApplyPage } from './CrmApplyPage';
import { crmApi, type CrmAccessStatus } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { User } from '../../store/types';
import clsx from 'clsx';

const CRM_TABS = [
    { icon: LayoutDashboard, label: 'Дашборд',       path: '/crm',               exact: true },
    { icon: Users,           label: 'Клиенты',       path: '/crm/clients' },
    { icon: Calendar,        label: 'Сессии',        path: '/crm/sessions' },
    { icon: BookOpen,        label: 'Бронирования',  path: '/crm/bookings' },
    { icon: Wallet,          label: 'Финансы',       path: '/crm/finances' },
    { icon: StickyNote,      label: 'Заметки',       path: '/crm/notes' },
    { icon: Clock,           label: 'Расписание',    path: '/crm/schedule' },
    { icon: UserCircle,      label: 'Моя анкета',    path: '/crm/profile' },
    { icon: Settings,        label: 'Настройки',     path: '/crm/settings' },
];

function CrmTopTabs() {
    const location = useLocation();

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        return location.pathname.startsWith(path);
    };

    return (
        <div className="mb-6 -mt-2">
            <nav className="flex gap-1 bg-white/70 backdrop-blur rounded-2xl p-1.5 border border-white/80 shadow-sm overflow-x-auto scrollbar-hide md:w-fit">
                {CRM_TABS.map(tab => {
                    const active = isActive(tab.path, tab.exact);
                    return (
                        <Link
                            key={tab.path}
                            to={tab.path}
                            className={clsx(
                                'flex items-center gap-1.5 md:gap-2 px-2.5 md:px-4 py-2 rounded-xl text-sm font-medium transition-all shrink-0',
                                active
                                    ? 'bg-unbox-green text-white shadow-md shadow-unbox-green/25'
                                    : 'text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/60'
                            )}
                        >
                            <tab.icon size={15} />
                            <span className="hidden sm:inline">{tab.label}</span>
                        </Link>
                    );
                })}
            </nav>
        </div>
    );
}

export function CrmLayout() {
    const { currentUser } = useUserStore();
    const { fetchPaymentAccounts } = useCrmStore();
    const navigate = useNavigate();
    const hasToken = Boolean(localStorage.getItem('token'));
    const [accessStatus, setAccessStatus] = useState<CrmAccessStatus | null>(null);
    const [accessLoading, setAccessLoading] = useState(true);
    const [calendarId, setCalendarId] = useState<string | null>(null);

    // Load GCal id for the Quick Actions FAB
    useEffect(() => {
        if (!currentUser) return;
        crmApi.getSettings()
            .then(s => setCalendarId(s.calendarId ?? null))
            .catch(() => setCalendarId(null));
    }, [currentUser]);

    const quickActions: QuickAction[] = [
        { label: 'Добавить клиента', sub: 'Создать карточку', path: '/crm/clients', icon: UserPlus },
        { label: 'Запланировать сессию', sub: 'Новая запись', path: '/crm/sessions', icon: Calendar },
        { label: 'Забронировать кабинет', sub: 'Unbox One · Uni · Neo', path: '/booking', icon: Plus },
        {
            label: 'Открыть Google Calendar',
            sub: calendarId ? 'Ваш личный календарь' : 'Google Calendar',
            href: calendarId
                ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`
                : 'https://calendar.google.com/calendar/u/0/r',
            icon: ExternalLink,
        },
    ];

    useEffect(() => {
        if (!hasToken) navigate('/login');
    }, [hasToken, navigate]);

    // Load specialist's payment accounts
    useEffect(() => {
        fetchPaymentAccounts();
    }, [fetchPaymentAccounts]);

    // Check CRM access via API
    useEffect(() => {
        if (!currentUser) return;

        // Quick check: specialist, owner, and senior_admin always have access
        const hasRoleAccess = currentUser.role === 'specialist' || currentUser.role === 'owner' || currentUser.role === 'senior_admin';
        if (hasRoleAccess) {
            setAccessStatus({ accessStatus: 'active', permanent: true, expiresAt: null, daysRemaining: null });
            setAccessLoading(false);
            return;
        }

        crmApi.getMyAccess()
            .then(setAccessStatus)
            .catch(() => setAccessStatus({ accessStatus: 'none', permanent: false, expiresAt: null, daysRemaining: null }))
            .finally(() => setAccessLoading(false));
    }, [currentUser]);

    if (!hasToken) return <Navigate to="/login" replace />;
    if (!currentUser) return null;

    // Show loading while checking access
    if (accessLoading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50/80">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
            </div>
        );
    }

    // Show apply page if no active access
    if (!accessStatus || accessStatus.accessStatus !== 'active') {
        return <CrmApplyPage />;
    }

    // Sidebar shows only general items — CRM sections are in the top tabs
    const sidebarNavItems = [
        { icon: Settings, label: 'Настройки', path: '/crm/settings' },
    ];

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner';

    const customBottomContent = (
        <div className="space-y-1">
            {isAdmin && (
                <button
                    onClick={() => navigate('/admin')}
                    className="flex items-center gap-2 text-sm text-unbox-green hover:bg-unbox-green/10 transition-colors w-full px-3 py-2 rounded-xl font-semibold"
                >
                    <Shield size={16} />
                    Админка
                </button>
            )}
            <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-700 transition-colors w-full px-3 py-2"
            >
                <ArrowLeft size={16} />
                К бронированиям
            </button>
        </div>
    );

    return <GridHouseCrmShell isAdmin={isAdmin} currentUser={currentUser} quickActions={quickActions} />;

    // Legacy SidebarLayout-based CRM shell removed; Grid House is the only layout.
    // eslint-disable-next-line no-unreachable
    return (
        <SidebarLayout navItems={sidebarNavItems} customBottomContent={customBottomContent}>
            <CrmTopTabs />
            <Outlet />
            <QuickActionsFab actions={quickActions} />
        </SidebarLayout>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE CRM shell — separate, isolated layout for the ?design=grid flag.
// No shared CSS with the default shell. All inline styles. Delete this whole
// block to revert.
// ─────────────────────────────────────────────────────────────────────────

const GH_NAV = [
    { label: 'Дашборд',       path: '/crm',               exact: true },
    { label: 'Клиенты',       path: '/crm/clients' },
    { label: 'Сессии',        path: '/crm/sessions' },
    { label: 'Бронирования',  path: '/crm/bookings' },
    { label: 'Финансы',       path: '/crm/finances' },
    { label: 'Заметки',       path: '/crm/notes' },
    { label: 'Расписание',    path: '/crm/schedule' },
    { label: 'Анкета',        path: '/crm/profile' },
    { label: 'Настройки',     path: '/crm/settings' },
];

function GridHouseCrmShell({ isAdmin, currentUser, quickActions }: { isAdmin: boolean; currentUser: User; quickActions: QuickAction[] }) {
    const location = useLocation();
    const navigate = useNavigate();
    const logout = useUserStore(s => s.logout);
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);

    useEffect(() => {
        const onResize = () => setIsNarrow(window.innerWidth < 960);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        if (path === '/crm' && location.pathname !== '/crm') return false;
        return location.pathname.startsWith(path);
    };

    const activeIndex = GH_NAV.findIndex(t => isActive(t.path, t.exact));
    const activeTab = activeIndex >= 0 ? GH_NAV[activeIndex] : GH_NAV[0];

    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: '10px',
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: GH.ink60,
        fontWeight: 500,
    };

    const SIDEBAR_WIDTH = 260;

    const sidebar = (
        <aside
            style={{
                width: `${SIDEBAR_WIDTH}px`,
                background: GH.paper,
                borderRight: `1px solid ${GH.ink}`,
                height: '100vh',
                position: 'fixed',
                top: 0,
                left: 0,
                display: 'flex',
                flexDirection: 'column',
                zIndex: 20,
                transform: isNarrow && !isMobileOpen ? 'translateX(-100%)' : 'translateX(0)',
                transition: 'transform 0.25s ease',
            }}
        >
            {/* Brand */}
            <div
                style={{
                    padding: '22px 24px 18px',
                    borderBottom: `1px solid ${GH.ink}`,
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                }}
            >
                <Link to="/" style={{ textDecoration: 'none', color: GH.ink }}>
                    <div style={{
                        fontFamily: GH_SANS,
                        fontSize: '22px',
                        fontWeight: 700,
                        letterSpacing: '-0.02em',
                        lineHeight: 1,
                    }}>
                        Unbox
                    </div>
                    <div style={{
                        ...monoLabel,
                        marginTop: '4px',
                    }}>
                        CRM · ОПЕРАТОР
                    </div>
                </Link>
            </div>

            {/* Current user strip */}
            {currentUser && (
                <div
                    style={{
                        padding: '16px 24px',
                        borderBottom: `1px solid ${GH.ink10}`,
                    }}
                >
                    <div style={monoLabel}>СЕССИЯ · {currentUser.role === 'specialist' ? 'СПЕЦИАЛИСТ' : currentUser.role === 'owner' || currentUser.role === 'senior_admin' ? 'АДМИН' : 'ОПЕРАТОР'}</div>
                    <div style={{
                        fontFamily: GH_SANS,
                        fontSize: '15px',
                        fontWeight: 600,
                        marginTop: '4px',
                        color: GH.ink,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {currentUser.name}
                    </div>
                </div>
            )}

            {/* Nav */}
            <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
                {GH_NAV.map((tab, idx) => {
                    const active = isActive(tab.path, tab.exact);
                    return (
                        <Link
                            key={tab.path}
                            to={tab.path}
                            onClick={() => setIsMobileOpen(false)}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '44px 1fr',
                                alignItems: 'center',
                                padding: '14px 24px',
                                borderBottom: `1px solid ${GH.ink10}`,
                                textDecoration: 'none',
                                background: active ? GH.ink : 'transparent',
                                color: active ? GH.paper : GH.ink,
                                transition: 'background 0.12s',
                            }}
                            onMouseEnter={e => {
                                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = GH.ink5;
                            }}
                            onMouseLeave={e => {
                                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                            }}
                        >
                            <span style={{
                                fontFamily: GH_MONO,
                                fontSize: '11px',
                                letterSpacing: '0.1em',
                                color: active ? 'rgba(250,250,247,0.5)' : GH.ink30,
                            }}>
                                {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span style={{
                                fontFamily: GH_SANS,
                                fontSize: '14px',
                                fontWeight: active ? 600 : 500,
                                letterSpacing: '-0.005em',
                            }}>
                                {tab.label}
                            </span>
                        </Link>
                    );
                })}
            </nav>

            {/* Footer actions */}
            <div style={{ borderTop: `1px solid ${GH.ink}`, padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {isAdmin && (
                    <button
                        onClick={() => navigate('/admin')}
                        style={{
                            ...monoLabel,
                            color: GH.accent,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            textAlign: 'left',
                            cursor: 'pointer',
                        }}
                    >
                        → АДМИНКА
                    </button>
                )}
                <button
                    onClick={() => navigate('/dashboard')}
                    style={{
                        ...monoLabel,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                    }}
                >
                    ← К БРОНИРОВАНИЯМ
                </button>
                <button
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    style={{
                        ...monoLabel,
                        color: GH.danger,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        textAlign: 'left',
                        cursor: 'pointer',
                    }}
                >
                    ↳ ВЫЙТИ
                </button>
            </div>
        </aside>
    );

    return (
        <div style={{
            minHeight: '100vh',
            background: GH.paper,
            color: GH.ink,
            fontFamily: GH_SANS,
        }}>
            {sidebar}

            {/* Mobile backdrop */}
            {isNarrow && isMobileOpen && (
                <div
                    onClick={() => setIsMobileOpen(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(15,15,16,0.5)',
                        zIndex: 15,
                    }}
                />
            )}

            <main style={{
                marginLeft: isNarrow ? 0 : `${SIDEBAR_WIDTH}px`,
                minHeight: '100vh',
                background: GH.paper,
            }}>
                {/* Top bar */}
                <div style={{
                    borderBottom: `1px solid ${GH.ink}`,
                    padding: isNarrow ? '14px 20px' : '18px 40px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    background: GH.paper,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                        {isNarrow && (
                            <button
                                onClick={() => setIsMobileOpen(true)}
                                style={{
                                    background: GH.ink,
                                    color: GH.paper,
                                    border: 'none',
                                    padding: '8px 12px',
                                    fontFamily: GH_MONO,
                                    fontSize: '10px',
                                    letterSpacing: '0.2em',
                                    textTransform: 'uppercase',
                                    cursor: 'pointer',
                                }}
                            >
                                МЕНЮ
                            </button>
                        )}
                        <div style={{
                            fontFamily: GH_MONO,
                            fontSize: '10px',
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                            color: GH.ink60,
                            display: 'flex',
                            gap: '10px',
                            flexWrap: 'wrap',
                        }}>
                            <span style={{ color: GH.ink30 }}>{String(activeIndex >= 0 ? activeIndex + 1 : 1).padStart(2, '0')}</span>
                            <span>/</span>
                            <span style={{ color: GH.ink }}>{activeTab.label.toUpperCase()}</span>
                        </div>
                    </div>
                    <div style={{
                        fontFamily: GH_MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink30,
                    }}>
                        UNBOX · CRM
                    </div>
                </div>

                <div style={{
                    padding: isNarrow ? '32px 20px 80px' : '48px 40px 96px',
                    maxWidth: '1360px',
                }}>
                    <Outlet />
                </div>
            </main>
            <QuickActionsFab actions={quickActions} />
        </div>
    );
}
