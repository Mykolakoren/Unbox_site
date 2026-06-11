import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, CheckSquare, Inbox, Users, Wallet, CalendarDays } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileAdminTour, ADMIN_TOUR_PREFIX } from './MobileAdminTour';
import { NotificationsBell } from '../NotificationsBell';

/**
 * Mobile admin shell — separate workspace at /m/admin.
 *
 * Tabs: Дашборд (cluster of today's numbers + hot-booking inbox)
 *     / Юзеры (search + quick actions)
 *     / Заявки (hot bookings + access requests).
 *
 * Gate: owner / senior_admin / admin only. Anyone else hits /m fallback.
 */
export function MobileAdminLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();
    const [tourOpen, setTourOpen] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) { navigate('/login'); return; }
        if (!currentUser) fetchCurrentUser().catch(() => navigate('/login'));
    }, [currentUser, fetchCurrentUser, navigate]);

    useEffect(() => {
        if (!currentUser) return;
        const forced = new URLSearchParams(location.search).get('tour') === '1';
        if (forced) { setTourOpen(true); return; }
        if (!hasCompletedTour(currentUser.id, ADMIN_TOUR_PREFIX)) {
            const t = setTimeout(() => setTourOpen(true), 350);
            return () => clearTimeout(t);
        }
    }, [currentUser, location.search]);

    if (!currentUser) {
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#fff' }}>
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
            </div>
        );
    }

    const isAdmin = currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin;
    if (!isAdmin) {
        navigate('/m', { replace: true });
        return null;
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: '#F4F4F2',
            display: 'flex',
            justifyContent: 'center',
        }}>
            <div style={{
                width: '100%',
                maxWidth: 480,
                minHeight: '100vh',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                color: '#0E0E0E',
                boxShadow: '0 0 0 1px rgba(0,0,0,0.04)',
            }}>
                <div style={{
                    background: '#0E0E0E',
                    color: '#fff',
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                }}>
                    <button
                        onClick={() => navigate('/m')}
                        aria-label="К кабинету"
                        style={{
                            background: 'rgba(255,255,255,0.12)',
                            border: 'none',
                            borderRadius: 8,
                            width: 28, height: 28,
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                            color: '#fff',
                        }}
                    >
                        <ArrowLeft size={14} />
                    </button>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Админка · {currentUser.name?.split(' ')[0]}
                    </div>
                    <NotificationsBell color="#fff" />
                    {/* 2026-06-02 owner: кнопка «десктоп» убрана. /m/admin
                        стал самостоятельным и cover'ит все основные
                        админ-функции. Для отладки админу остался URL-параметр
                        ?forceDesktop=1 на любой странице. */}
                </div>

                <main style={{ flex: 1, overflow: 'auto' }}>
                    <Outlet />
                </main>
            </div>

            <nav style={{
                position: 'fixed',
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                background: '#fff',
                borderTop: '1px solid rgba(0,0,0,0.08)',
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                zIndex: 100,
            }}>
                {/* 2026-06-02 owner: «Кабинеты» убраны из tab-bar (setup-задача,
                    не daily), вместо них «Брони» — центральная админская
                    функция. На кабинеты ссылка появилась на дашборде в
                    разделе УПРАВЛЕНИЕ. */}
                <TabLink to="/m/admin/dashboard" icon={BarChart3} label="Дашб." />
                <TabLink to="/m/admin/bookings" icon={CalendarDays} label="Брони" />
                <TabLink to="/m/admin/tasks" icon={CheckSquare} label="Задачи" />
                <TabLink to="/m/admin/finance" icon={Wallet} label="Финансы" />
                <TabLink to="/m/admin/users" icon={Users} label="Юзеры" />
                <TabLink to="/m/admin/inbox" icon={Inbox} label="Заявки" />
            </nav>

            {tourOpen && <MobileAdminTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

function TabLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    // 6 tabs at 480px container = 80px per cell. Icon 20 + label 10 fits.
    return (
        <NavLink
            to={to}
            style={({ isActive }) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '9px 0 11px',
                color: isActive ? '#0E0E0E' : '#999',
                textDecoration: 'none',
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
                lineHeight: 1,
                whiteSpace: 'nowrap',
            })}
        >
            <Icon size={20} strokeWidth={2} />
            <span>{label}</span>
        </NavLink>
    );
}
