import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, Home, Search, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { OnboardingTour, hasCompletedTour } from './OnboardingTour';
import { registerPtrScrollContainer } from './usePullToRefresh';
import { forceUnlockScroll } from './useScrollLock';
import { InstallBanner } from './InstallBanner';
import { loginPathWithRedirect } from '../../utils/loginRedirect';
// Wave 1: оболочка на общих токенах — шрифт IBM Plex (был system-ui),
// тёплая карточка вместо #fff, меню на слое Z.nav, подписи вкладок 12 px
// цветом ink-60 (было #999, 2.8:1), активная — бирюзой «выбрано».
import { COLOR, FONT, TEXT, Z } from '../../design/tokens';
import { useTouchDensity } from '../../hooks/useTouchDensity';

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
    useTouchDensity();

    // Register the real scroll container so usePullToRefresh gates on its
    // scrollTop (PTR was firing even when scrolled down inside lists).
    useEffect(() => {
        registerPtrScrollContainer(mainRef.current);
        return () => registerPtrScrollContainer(null);
    }, []);

    // Страховка: на каждой смене экрана гарантированно снимаем блокировку
    // прокрутки. Если шит/тур по какой-то причине не снял лок (race) — фон
    // не останется залоченным и лента продолжит скроллиться.
    useEffect(() => {
        forceUnlockScroll();
    }, [location.pathname]);

    // Без входа — на /login с возвратом сюда же (?redirect=): после входа
    // человек попадает туда, куда шёл (например, /m/find?cab=… с выбранным
    // кабинетом), а не на пустое «Сегодня».
    // Волна 2 (X2-10): каталог (анкета специалиста, кабинет, тарифы, правила)
    // открывается и без входа — гостя по такой ссылке ведём на публичную
    // версию страницы, а не на форму входа.
    useEffect(() => {
        const token = localStorage.getItem('token');
        const toLogin = () => {
            const pub = publicTwin(location.pathname);
            // Строка запроса — перед якорем (/#cabinets).
            if (pub) navigate(pub.includes('#') ? pub.replace('#', `${location.search}#`) : pub + location.search, { replace: true });
            else navigate(loginPathWithRedirect(location.pathname + location.search));
        };
        if (!token) { toLogin(); return; }
        if (!currentUser) fetchCurrentUser().catch(toLogin);
    }, [currentUser, fetchCurrentUser, navigate, location.pathname, location.search]);

    // X5-08: при переходе на другой экран — наверх (раньше «Свободно»
    // открывалось прокрученным до середины, фильтры уходили за край).
    // «Назад» (POP) возвращает туда, где человек был.
    const navType = useNavigationType();
    const scrollPositions = useRef(new Map<string, number>());
    const lastKey = useRef(location.key);
    useLayoutEffect(() => {
        const prevKey = lastKey.current;
        if (prevKey === location.key) return;
        scrollPositions.current.set(prevKey, window.scrollY || mainRef.current?.scrollTop || 0);
        lastKey.current = location.key;
        const y = navType === 'POP' ? (scrollPositions.current.get(location.key) ?? 0) : 0;
        window.scrollTo(0, y);
        if (mainRef.current) mainRef.current.scrollTop = y;
    }, [location.key, navType]);

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
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: COLOR.card }}>
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
                background: COLOR.sunken,
                display: 'flex',
                justifyContent: 'center',
            }}
        >
            <div
                style={{
                    width: '100%',
                    maxWidth: 480,
                    minHeight: '100vh',
                    background: COLOR.card,
                    display: 'flex',
                    flexDirection: 'column',
                    // Safe-area сверху: в standalone-режиме iOS контент
                    // начинался под чёлкой (фикс 31.08, как в CRM/админ
                    // оболочках). В обычном браузере env() = 0.
                    paddingTop: 'env(safe-area-inset-top, 0px)',
                    paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                    fontFamily: FONT.sans,
                    color: COLOR.ink,
                    boxShadow: `0 0 0 1px ${COLOR.ink05}`,
                }}
            >
                {/* 2026-06-02 owner: убран Beta-баннер и кнопка «десктоп».
                    /m теперь основной интерфейс на телефоне для всех
                    ролей. Переключиться на десктоп можно из /m/me →
                    «Открыть десктопную версию» (escape hatch для случая
                    когда мобильная страница не покрывает функционал). */}
                <main ref={mainRef} data-mobile-scroll style={{ flex: 1, overflow: 'auto' }}>
                    {/* G4-11: баннер «на главный экран» — не одновременно с туром,
                        а после него (тур первого входа ещё не пройден — молчим). */}
                    {!tourOpen && hasCompletedTour(currentUser.id) && <InstallBanner />}
                    {/* key=pathname → ремоунт + одноразовый enter-переход при
                        смене экрана. Тонко и быстро (нав частая, Emil: «reduce»). */}
                    <div key={location.pathname} className="mobile-page">
                        <Outlet />
                    </div>
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
                    background: COLOR.card,
                    borderTop: `1px solid ${COLOR.ink08}`,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                    zIndex: Z.nav,
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
            // X5-06: отклик на касание сразу, пока грузится экран вкладки.
            className="press"
            style={({ isActive }) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                padding: '10px 0 12px',
                minHeight: 56,
                color: isActive ? COLOR.accentInk : COLOR.ink60,
                textDecoration: 'none',
                fontSize: TEXT.caption,
                fontWeight: isActive ? 600 : 500,
                lineHeight: 1,
            })}
        >
            <Icon size={22} strokeWidth={2} />
            <span>{label}</span>
        </NavLink>
    );
}

/** Публичная версия каталожной страницы /m для гостя (X2-10) или null,
 *  если экран личный (сегодня, брони, оплата, «Я») — тогда нужен вход. */
function publicTwin(pathname: string): string | null {
    const p = pathname.replace(/\/+$/, '');
    const rules: Array<[RegExp, string]> = [
        [/^\/m\/specialists$/, '/specialists'],
        [/^\/m\/specialists\/([^/]+)$/, '/specialists/$1'],
        [/^\/m\/location\/([^/]+)$/, '/location/$1'],
        [/^\/m\/cabinet\/([^/]+)$/, '/cabinet/$1'],
        [/^\/m\/places$/, '/#cabinets'],
        [/^\/m\/tariffs$/, '/subscriptions'],
        [/^\/m\/booking-rules$/, '/booking-rules'],
        [/^\/m\/become-specialist$/, '/become-specialist'],
    ];
    for (const [re, target] of rules) {
        const m = re.exec(p);
        if (m) return target.replace(/\$(\d+)/g, (_, n) => m[Number(n)] ?? '');
    }
    return null;
}
