import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, Home, Search, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { OnboardingTour, hasCompletedTour } from './OnboardingTour';
import { registerPtrScrollContainer } from './usePullToRefresh';
import { forceUnlockScroll } from './useScrollLock';
import { InstallBanner } from './InstallBanner';
import { loginPathWithRedirect } from '../../utils/loginRedirect';
// Wave 1: оболочка на общих токенах — шрифт IBM Plex (был system-ui),
// тёплая карточка вместо #fff, меню на слое Z.nav, подписи вкладок 12 px
// цветом ink-60 (было #999, 2.8:1), активная — бирюзой «выбрано».
import { COLOR, FONT, RADIUS, TEXT, Z } from '../../design/tokens';
import { Skeleton, SkeletonList } from '../../components/ui/Skeleton';
import { useTouchDensity } from '../../hooks/useTouchDensity';
import { isAdminFlowPath, useAdminFlow } from './adminFlow';
import { isBookingAdmin } from './crmAccess';
import { useBookingStore } from '../../store/bookingStore';

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
    const currentUser = useUserStore(s => s.currentUser);
    const fetchCurrentUser = useUserStore(s => s.fetchCurrentUser);
    const navigate = useNavigate();
    const location = useLocation();
    const [tourOpen, setTourOpen] = useState(false);
    const mainRef = useRef<HTMLElement>(null);
    useTouchDensity();

    // Админ-бронь / админ-перенос (ревью админки 09.11, №2б): оболочка открылась
    // сразу на «Свободно»/«Оформлении» — значит, пришли из админки (или по
    // ссылке), а не своими вкладками. Тогда вместо клиентского меню — полоска
    // «← Вернуться в админку · Бронь для: …». Ушли на другой клиентский экран —
    // режим снимается. «Привязать кабинет» из CRM (?linkSession) — не админ-бронь.
    const adminFlowActive = useAdminFlow(s => s.active);
    const adminFlowFor = useAdminFlow(s => s.forName);
    const setAdminFlow = useAdminFlow(s => s.setActive);
    const mountedOnce = useRef(false);
    useLayoutEffect(() => {
        const sp = new URLSearchParams(location.search);
        const flowPath = isAdminFlowPath(location.pathname) && !sp.has('linkSession');
        mountedOnce.current = true;
        // 09.11 (ревизия регрессий): режим включается ТОЛЬКО явным признаком из
        // админки (?admin=1), а не «оболочка открылась на Свободно» — иначе админ,
        // бронирующий себе с телефона (или после перезагрузки), попадал в него сам.
        if (flowPath && sp.get('admin') === '1') { setAdminFlow(true); return; }
        if (!flowPath && useAdminFlow.getState().active) setAdminFlow(false);
    }, [location.pathname, location.search, setAdminFlow]);
    const showAdminStrip = adminFlowActive && isBookingAdmin(currentUser) && isAdminFlowPath(location.pathname);

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
        // Посреди дела экскурсию не открываем: «Забронировать кабинет» из CRM
        // (?linkSession), перенос (?reschedule) и оформление — она закрывала
        // слоты рассказом про «Сегодня» (обход мобильной версии 10.10).
        // Покажется при следующем обычном входе.
        const sp = new URLSearchParams(location.search);
        const midTask = sp.has('linkSession') || sp.has('reschedule') || location.pathname.startsWith('/m/checkout');
        if (!midTask && !hasCompletedTour(currentUser.id)) {
            // Tiny delay so the page paints first — the tour landing on a
            // blank screen feels more abrupt than landing on the cabinet
            // with the tour gliding up from the bottom a moment later.
            const t = setTimeout(() => setTourOpen(true), 350);
            return () => clearTimeout(t);
        }
    }, [currentUser, location.search, location.pathname]);

    if (!currentUser) {
        return (
            // 09.11 фаза 3: вместо серо-синего спиннера Tailwind на весь экран —
            // каркас экрана (шапка + 3 строки) на тёплой бумаге.
            <div style={{ minHeight: '100vh', background: COLOR.paper, display: 'flex', justifyContent: 'center' }}>
                <div style={{ width: '100%', maxWidth: 480, padding: '24px 16px', display: 'grid', gap: 16, alignContent: 'start' }}>
                    <Skeleton width="45%" height={28} />
                    <SkeletonList count={3} label="Загружаем" />
                </div>
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
                    // 09.11 фаза 3: колонка — тёплая бумага, карточки (card) на ней видны
                    // сами, без рамок. Было COLOR.card — карточки сливались с фоном.
                    background: COLOR.paper,
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

            {showAdminStrip ? (
                <AdminFlowStrip
                    forName={adminFlowFor}
                    onBack={() => {
                        setAdminFlow(false);
                        useBookingStore.getState().setBookingForUser(null);
                        navigate('/m/admin/bookings');
                    }}
                />
            ) : (
            /* Bottom tab bar */
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
            )}

            {tourOpen && <OnboardingTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

/** Вместо клиентского меню во время админ-брони: дорога назад и для кого бронь. */
function AdminFlowStrip({ forName, onBack }: { forName: string | null; onBack: () => void }) {
    return (
        <nav
            aria-label="Админ-бронь"
            style={{
                position: 'fixed',
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                minHeight: 60,
                background: COLOR.card,
                borderTop: `1px solid ${COLOR.ink08}`,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px calc(6px + env(safe-area-inset-bottom, 0px))',
                zIndex: Z.nav,
            }}
        >
            <button
                type="button"
                onClick={onBack}
                className="press"
                style={{
                    minHeight: 44, display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '0 10px', borderRadius: RADIUS.control, border: `1px solid ${COLOR.ink20}`,
                    background: COLOR.card, color: COLOR.ink, fontFamily: 'inherit',
                    fontSize: TEXT.small, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                }}
            >
                <ArrowLeft size={16} aria-hidden="true" /> В админку
            </button>
            <div style={{ flex: 1, minWidth: 0, fontSize: TEXT.small, lineHeight: 1.3 }}>
                <span style={{ color: COLOR.ink60 }}>Бронь для: </span>
                <b style={{ overflowWrap: 'anywhere' }}>{forName || 'выберите на оформлении'}</b>
            </div>
        </nav>
    );
}

function TabLink({ to, icon: Icon, label, tourId }: { to: string; icon: React.ElementType; label: string; tourId?: string }) {
    return (
        <NavLink
            to={to}
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
            {/* 09.11 фаза 3 (общие файлы): цель подсветки тура — сам значок вкладки (кольцо
                вокруг него), а не вся вкладка: в тёмной теме не светлый прямоугольник. */}
            <span data-tour={tourId} style={{ display: 'grid', placeItems: 'center', width: 36, height: 28, borderRadius: RADIUS.control }}>
                <Icon size={22} strokeWidth={2} />
            </span>
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
