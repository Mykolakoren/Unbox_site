import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Home, Search, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { OnboardingTour, hasCompletedTour } from './OnboardingTour';
import { registerPtrScrollContainer } from './usePullToRefresh';
import { InstallBanner } from './InstallBanner';

/**
 * Mobile beta shell.
 *
 * Gated to admins/owner for the beta — once we're happy with UX,
 * we'll open it to all specialists by removing the gate in App.tsx
 * and surfacing the link in the regular sidebar.
 *
 * Layout primitives:
 *   - body width capped at 480px (phone-frame on desktop testing)
 *   - bottom tab bar fixed, safe-area inset for iOS notched devices
 *   - main scroll area takes the remaining viewport height
 */
export function MobileLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();
    const [tourOpen, setTourOpen] = useState(false);
    const mainRef = useRef<HTMLElement>(null);

    // Register the real scroll container so usePullToRefresh gates on its
    // scrollTop (PTR was firing even when scrolled down inside lists).
    useEffect(() => {
        registerPtrScrollContainer(mainRef.current);
        return () => registerPtrScrollContainer(null);
    }, []);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) { navigate('/login'); return; }
        if (!currentUser) fetchCurrentUser().catch(() => navigate('/login'));
    }, [currentUser, fetchCurrentUser, navigate]);

    // First-visit tour trigger. Two entry points:
    //  1. `?tour=1` query — force open (used for previewing without resetting
    //     localStorage; admins can share that link too).
    //  2. Auto-open once per user when no completion marker is stored.
    // We wait for `currentUser` so the tour key is stable; running before
    // login would key by `undefined` and re-fire for every visitor.
    useEffect(() => {
        if (!currentUser) return;
        const forced = new URLSearchParams(location.search).get('tour') === '1';
        if (forced) {
            setTourOpen(true);
            return;
        }
        if (!hasCompletedTour(currentUser.id)) {
            // Tiny delay so the page paints first — the tour landing on a
            // blank screen feels more abrupt than landing on the cabinet
            // with the tour gliding up from the bottom a moment later.
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

    // 2026-06-02 owner: убран canBook-гейт. /m теперь основной интерфейс
    // на телефоне для ВСЕХ ролей включая обычных клиентов (role 'user' /
    // null). Раньше они автоматически отбрасывались на /dashboard и попадали
    // в десктопный UI на телефонной ширине — это было основной источник
    // путаницы «новая/старая мобилка». Mobile-страницы и так показывают
    // только то, что юзеру доступно: клиент видит свои брони/абонемент/
    // профиль, а кнопки «забронировать» в /m/find упрутся в backend
    // permission check, если роль не позволяет.

    return (
        <div
            // translate="no" + className "notranslate" — без этого Google/
            // Yandex Translate (включаются автоматически когда системный
            // язык не совпадает) перехватывает React-DOM и приводит к
            // ошибке "insertBefore: узел не дочерний" при rapid-rerender'ах
            // вроде submit() в MobileCheckout (Galina 2026-05-31).
            translate="no"
            className="notranslate"
            style={{
                minHeight: '100vh',
                background: '#F4F4F2',
                display: 'flex',
                justifyContent: 'center',
            }}
        >
            <div
                style={{
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
                }}
            >
                {/* 2026-06-02 owner: убран Beta-баннер и кнопка «десктоп».
                    /m теперь основной интерфейс на телефоне для всех
                    ролей. Переключиться на десктоп можно из /m/me →
                    «Открыть десктопную версию» (escape hatch для случая
                    когда мобильная страница не покрывает функционал). */}
                <main ref={mainRef} style={{ flex: 1, overflow: 'auto' }}>
                    <InstallBanner />
                    <Outlet />
                </main>
            </div>

            {/* Bottom tab bar */}
            <nav
                style={{
                    position: 'fixed',
                    bottom: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '100%',
                    maxWidth: 480,
                    background: '#fff',
                    borderTop: '1px solid rgba(0,0,0,0.08)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    zIndex: 100,
                }}
            >
                <TabLink to="/m/today" icon={Home} label="Сегодня" tourId="tab-today" />
                <TabLink to="/m/bookings" icon={CalendarDays} label="Мои брони" tourId="tab-bookings" />
                <TabLink to="/m/find" icon={Search} label="Свободно" tourId="tab-find" />
                <TabLink to="/m/me" icon={UserIcon} label="Я" tourId="tab-me" />
            </nav>

            {tourOpen && <OnboardingTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

function TabLink({ to, icon: Icon, label, tourId }: { to: string; icon: React.ElementType; label: string; tourId?: string }) {
    return (
        <NavLink
            to={to}
            data-tour={tourId}
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
