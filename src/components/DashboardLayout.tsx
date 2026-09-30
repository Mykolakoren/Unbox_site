import { Outlet, useNavigate, Link, useLocation, Navigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { QuickActionsFab, type QuickAction } from './ui/QuickActionsFab';
import { Calendar, Settings, LayoutDashboard, ShieldCheck, Loader2, Menu, X, LogOut, Plus, Search, FileText, Bell, Smartphone, Gift, CreditCard, ArrowUpRight, UserCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmAccessToggle } from './CrmAccessToggle';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { SHADOW } from '../design/tokens';
import { loginPathWithRedirect } from '../utils/loginRedirect';
import { canBookCabinets } from '../utils/permissions';

export function DashboardLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const token = localStorage.getItem('token');
        // На вход — с возвратом на эту же страницу кабинета (?redirect=).
        const loginPath = loginPathWithRedirect(location.pathname + location.search);
        if (!token) {
            navigate(loginPath);
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
                navigate(loginPath);
            });
    }, [currentUser, navigate, fetchCurrentUser, location.pathname, location.search]);

    if (isLoading || !currentUser) {
        return (
            <div className="flex items-center justify-center min-h-screen" style={{ background: GH.paper }}>
                <Loader2 className="w-8 h-8 animate-spin text-accent" aria-label="Загружаем кабинет" />
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
        // Флоу «Забронировать кабинет под сессию» из CRM навигирует на
        // /dashboard/bookings с crmMode в state — там MyBookingsPage
        // подсвечивает оранжевым время сессии и привязывает бронь к сессии.
        // Этого функционала нет в /crm/bookings, поэтому при наличии crmMode
        // НЕ редиректим специалиста НИ одним из редиректов ниже.
        const hasCrmMode = path === '/dashboard/bookings'
            && !!(location.state as { crmMode?: unknown } | null)?.crmMode;
        const map: Record<string, string> = {
            '/dashboard':         '/crm',
            '/dashboard/bookings':'/crm/bookings',
            '/dashboard/waitlist':'/crm/waitlist',
            '/dashboard/bonuses': '/crm/bonuses',
            '/dashboard/profile': '/crm/account',
        };
        const target = map[path];
        if (target && !hasCrmMode) {
            return <Navigate to={target + search + hash} replace />;
        }
        // Любой другой /dashboard/* — на CRM index (кроме crmMode-флоу).
        if (path.startsWith('/dashboard') && !hasCrmMode) {
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
    // Волна 2 (G3-20): «Абонементы» и «Правила» живут на публичном сайте —
    // они в отдельной группе «На сайте» со значком ↗, чтобы уход из кабинета
    // не был сюрпризом. Для роли user — пункт «Анкета специалиста».
    const navItems = [
        { icon: LayoutDashboard, label: 'Обзор',            path: '/dashboard',          exact: true },
        { icon: Calendar,        label: 'Мои брони',        path: '/dashboard/bookings' },
        { icon: Bell,            label: 'Слежу за слотами', path: '/dashboard/waitlist' },
        { icon: Gift,            label: 'Скидки и бонусы',  path: '/dashboard/bonuses' },
        { icon: Settings,        label: 'Профиль',          path: '/dashboard/profile' },
        ...(!canBookCabinets(currentUser) ? [{ icon: UserCheck, label: 'Анкета специалиста', path: '/become-specialist', external: true }] : []),
        { icon: CreditCard,      label: 'Абонементы',       path: '/subscriptions', external: true },
        ...(isAdmin ? [{ icon: ShieldCheck, label: 'Админ-панель', path: '/admin' }] : []),
        // С телефона — для тех у кого есть booking permission. MobileLayout
        // enforces access check внутри. App.tsx редирект автоматически
        // переводит phone-width на /m, поэтому desktop-ссылка нужна только
        // как «открыть руками» (например с iPad).
        ...(canBook ? [{ icon: Smartphone, label: 'С телефона', path: '/m' }] : []),
        // Legal — placed last so it sits right above the divider/"Выйти"
        // at the bottom of the sidebar; far enough from primary nav not
        // to compete for attention but always visible without scroll.
        { icon: FileText,        label: 'Правила бронирования', path: '/booking-rules', external: true },
    ];

    const quickActions: QuickAction[] = [
        // Excel #17: was '/booking' (wizard) but admins wanted the chessboard.
        // /dashboard/bookings is where users actually pick a slot and confirm.
        // Кому сервер бронь не даст (роль user) — сразу анкета, а не шахматка
        // с отказом на кнопке «Оплатить».
        canBookCabinets(currentUser)
            // ?view=grid — сразу сетка, а не список (X2-15: один адрес брони).
            ? { label: 'Забронировать кабинет', sub: 'Выбрать время в шахматке', path: '/dashboard/bookings?view=grid', icon: Plus }
            : { label: 'Заполнить анкету', sub: 'Бронь — после проверки анкеты', path: '/become-specialist', icon: Plus },
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

// Моно-подпись: 12 px и разрядка ≤ 0.06em (wave 1: меньше 12 — нельзя).
const ghMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
};

function GridHouseDashboardShell({
    navItems,
    currentUser,
    quickActions,
}: {
    navItems: Array<{ path: string; label: string; icon: React.ElementType; exact?: boolean; external?: boolean }>;
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
                    boxShadow: narrow && mobileOpen ? SHADOW.pop : 'none',
                }}
            >
                {/* Brand */}
                <div style={{ padding: '22px 24px 18px', borderBottom: hairline }}>
                    <Link to="/" style={{ fontSize: 24, fontWeight: 600, color: GH.ink, textDecoration: 'none', letterSpacing: '-0.01em' }}>
                        Unbox
                    </Link>
                    <div style={{ ...ghMono, color: GH.ink60, marginTop: 6 }}>
                        Кабинет
                    </div>
                </div>

                {/* User */}
                <div style={{ padding: '16px 24px', borderBottom: hairline }}>
                    <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.005em' }}>
                        {currentUser.name}
                    </div>
                    {currentUser.email && (
                        <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {currentUser.email}
                        </div>
                    )}
                    {/* Главное действие кабинета — всегда под рукой (G3-20). Тем, кому
                        сервер бронь не даст (роль user), — анкета, а не отказ на оплате. */}
                    {canBookCabinets(currentUser) && (
                        <Link
                            to="/dashboard/bookings?view=grid"
                            onClick={() => setMobileOpen(false)}
                            className="ui-btn ui-btn--secondary ui-btn--touch ui-btn--block"
                            style={{ marginTop: 14 }}
                        >
                            <Plus size={18} aria-hidden="true" />
                            Забронировать
                        </Link>
                    )}
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
                <nav aria-label="Кабинет" style={{ flex: 1, padding: '12px 0' }}>
                    {navItems.map((item, i) => {
                        const active = isActive(item);
                        const firstExternal = item.external && !navItems[i - 1]?.external;
                        return (
                            <div key={item.path}>
                            {firstExternal && (
                                <div style={{ ...ghMono, color: GH.ink60, padding: '16px 24px 6px', borderTop: hairline, marginTop: 8 }}>
                                    На сайте
                                </div>
                            )}
                            <Link
                                to={item.path}
                                onClick={() => setMobileOpen(false)}
                                aria-current={active ? 'page' : undefined}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    minHeight: 44,
                                    padding: '10px 24px',
                                    fontSize: 14,
                                    fontWeight: active ? 600 : 500,
                                    color: active ? GH.ink : GH.ink60,
                                    textDecoration: 'none',
                                    background: active ? GH.paper : 'transparent',
                                    borderLeft: active ? `3px solid ${GH.ink}` : '3px solid transparent',
                                    transition: 'all 0.12s ease',
                                }}
                            >
                                <item.icon size={18} aria-hidden="true" style={{ flexShrink: 0, color: active ? GH.ink : GH.ink60 }} />
                                <span style={{ flex: 1 }}>{item.label}</span>
                                {item.external && <><ArrowUpRight size={14} aria-hidden="true" style={{ color: GH.ink60 }} /><span className="sr-only">(откроется на сайте)</span></>}
                            </Link>
                            </div>
                        );
                    })}
                </nav>

                {/* Bottom */}
                <div style={{ padding: '16px 24px', borderTop: hairline }}>
                    <button
                        onClick={handleLogout}
                        type="button"
                        style={{
                            display: 'flex', alignItems: 'center', gap: 8, minHeight: 44,
                            background: 'none', border: 'none', color: GH.danger,
                            fontSize: 14, fontWeight: 600, cursor: 'pointer', padding: 0,
                        }}
                    >
                        <LogOut size={16} aria-hidden="true" />
                        Выйти
                    </button>
                    <Link
                        to="/"
                        style={{
                            display: 'flex', alignItems: 'center', minHeight: 44,
                            fontSize: 14, color: GH.ink80, textDecoration: 'none',
                        }}
                    >
                        ← На главную сайта
                    </Link>
                </div>
            </aside>

            {/* Mobile overlay */}
            {narrow && mobileOpen && (
                <div
                    style={{ position: 'fixed', inset: 0, background: GH.ink30, zIndex: 40 }}
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* ── MAIN ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* Верхняя полоса — только на узком экране: кнопка меню и раздел.
                    На широком её не было смысла держать: бледное «Unbox · Кабинет»
                    и второй раз имя (G3-20). */}
                {narrow && (
                    <header
                        style={{
                            padding: '6px 20px',
                            borderBottom: hairline,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            position: 'sticky',
                            top: 0,
                            background: GH.paper,
                            zIndex: 30,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setMobileOpen(!mobileOpen)}
                            aria-label={mobileOpen ? 'Закрыть меню' : 'Открыть меню'}
                            aria-expanded={mobileOpen}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: GH.ink, padding: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                        <span style={{ fontSize: 16, fontWeight: 600 }}>
                            {navItems.find(isActive)?.label ?? 'Кабинет'}
                        </span>
                    </header>
                )}

                {/* Content */}
                <main style={{ flex: 1, padding: narrow ? '24px 20px' : '32px 40px' }}>
                    <Outlet />
                </main>
            </div>
            <QuickActionsFab actions={quickActions} />
        </div>
    );
}
