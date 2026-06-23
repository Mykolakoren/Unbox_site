import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ArrowLeft, CalendarDays, FileText, Users, UserCircle, Wallet, Monitor } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileCrmTour, CRM_TOUR_PREFIX } from './MobileCrmTour';
import { NotificationsBell } from '../NotificationsBell';

/**
 * Mobile CRM shell — separate workspace from /m (cabinet).
 *
 * Tabs: Сегодня (today's therapy sessions) / Клиенты / Заметки.
 * Profile lives back in the main cabinet, this workspace is purely the
 * specialist's daily-CRM toolbox: list of today's clients, quick payment /
 * note actions, fast lookup.
 *
 * Access gate: any role with specialist powers (specialist / admin / owner).
 * Plain `client` users hit /dashboard.
 */
export function MobileCrmLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();
    const [tourOpen, setTourOpen] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) { navigate('/login'); return; }
        if (!currentUser) fetchCurrentUser().catch(() => navigate('/login'));
    }, [currentUser, fetchCurrentUser, navigate]);

    // Fire the CRM-specific tour on first visit. ?tour=1 forces it for admins
    // previewing the experience. Cabinet vs CRM tours track independently.
    useEffect(() => {
        if (!currentUser) return;
        const forced = new URLSearchParams(location.search).get('tour') === '1';
        if (forced) { setTourOpen(true); return; }
        if (!hasCompletedTour(currentUser.id, CRM_TOUR_PREFIX)) {
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

    const isSpecialist = currentUser.role === 'specialist'
        || currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin;
    if (!isSpecialist) {
        // 2026-06-02: bounce to /m (mobile home) instead of /dashboard
        // (десктоп-в-мобиле) — последовательно с тем, что /m теперь основной
        // на телефоне для всех ролей.
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
                {/* Workspace header — tap to go back to cabinet */}
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
                        Psy-CRM · {currentUser.name?.split(' ')[0]}
                    </div>
                    <NotificationsBell color="#fff" />
                    <button
                        onClick={() => {
                            sessionStorage.setItem('forceDesktop', '1');
                            window.location.href = '/crm';
                        }}
                        title="Переключиться на десктоп-версию CRM"
                        style={{
                            background: 'rgba(255,255,255,0.12)',
                            border: 'none',
                            borderRadius: 6,
                            padding: '4px 8px',
                            color: '#fff',
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                        aria-label="Десктоп"
                    >
                        <Monitor size={11} />
                        десктоп
                    </button>
                </div>

                <main data-mobile-scroll style={{ flex: 1, overflow: 'auto' }}>
                    <div key={location.pathname} className="mobile-page">
                        <Outlet />
                    </div>
                </main>
            </div>

            {/* CRM bottom tabs */}
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
                gridTemplateColumns: 'repeat(5, 1fr)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                zIndex: 100,
            }}>
                <TabLink to="/m/crm/today" icon={CalendarDays} label="Сегодня" />
                <TabLink to="/m/crm/clients" icon={Users} label="Клиенты" />
                <TabLink to="/m/crm/finance" icon={Wallet} label="Финансы" />
                <TabLink to="/m/crm/notes" icon={FileText} label="Заметки" />
                <TabLink to="/m/crm/profile" icon={UserCircle} label="Анкета" />
            </nav>

            {tourOpen && <MobileCrmTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

function TabLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
    return (
        <NavLink
            to={to}
            style={({ isActive }) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '10px 0 12px',
                color: isActive ? '#0E0E0E' : '#999',
                textDecoration: 'none',
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                lineHeight: 1,
            })}
        >
            <Icon size={22} strokeWidth={2} />
            <span>{label}</span>
        </NavLink>
    );
}
