import { useEffect, useRef, useState } from 'react';
import { Outlet, Link, useLocation, Navigate, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Calendar, Users, Clock, Box,
    BookOpen, ClipboardList, Menu, ChevronDown, Shield, Wallet, UsersRound, Star, Wrench,
    CreditCard, Gift, UserCircle, Newspaper, BarChart3, CalendarDays, ExternalLink, Search, Filter,
    LogOut, ArrowLeft, Briefcase,
} from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { NotificationBell } from '../../components/admin/NotificationBell';
import { openCmdK } from '../../components/admin/CmdKSearch';
import { userCanAccessFinance, userCanAccessRights } from '../../utils/permissions';
import { loginPathWithRedirect } from '../../utils/loginRedirect';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { COLOR, Z } from '../../design/tokens';

/**
 * Оболочка компьютерной админки (Grid House) — волна 4, пакет D.
 *
 * Меню — четыре группы без номеров, по образцу CrmLayout (G7-16, G8-07, X2-20):
 * «Каждый день / Пространство / Люди и контент / Система». Номера 01–14
 * убраны: у разных сотрудников они означали разные пункты (G7-13).
 * Личные «Абонемент / Бонусы / Профиль» — в меню под именем, а не рядом
 * значков над разделами. Шапка и вкладка браузера берут название из карты
 * путь → название; неизвестный путь — «Админка», не «Дашборд» (G8-08, X4-18).
 */

type IconType = React.ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' }>;
export interface AdminNavItem { path: string; label: string; icon: IconType; exact?: boolean }
export interface AdminNavGroup { title: string; items: AdminNavItem[] }

const ADMIN_ROLES = ['admin', 'senior_admin', 'owner'];

/** Личные разделы под админской оболочкой — открываются из меню под именем. */
const PERSONAL_ITEMS: AdminNavItem[] = [
    { path: '/admin/subscription', label: 'Абонемент', icon: CreditCard },
    { path: '/admin/bonuses', label: 'Бонусы', icon: Gift },
    { path: '/admin/my-waitlist', label: 'Слежу за слотами', icon: Clock },
    { path: '/admin/account', label: 'Профиль', icon: UserCircle },
];

/**
 * Карта путь → название (шапка и вкладка браузера). Пункты меню попадают
 * сюда сами; здесь — то, чего в меню нет. Самый длинный совпавший путь главнее.
 */
const EXTRA_TITLES: Array<{ path: string; title: string; group: string }> = [
    { path: '/admin/users/', title: 'Карточка клиента', group: 'Каждый день' },
];

/** Название раздела по пути: точное совпадение → самый длинный префикс → «Админка». */
export function adminTitleFor(pathname: string, groups: AdminNavGroup[]): { title: string; group: string | null } {
    const entries: Array<{ path: string; title: string; group: string | null; exact?: boolean }> = [];
    for (const g of groups) for (const i of g.items) entries.push({ path: i.path, title: i.label, group: g.title, exact: i.exact });
    for (const i of PERSONAL_ITEMS) entries.push({ path: i.path, title: i.label, group: 'Личное' });
    for (const e of EXTRA_TITLES) entries.push(e);
    let best: (typeof entries)[number] | null = null;
    for (const e of entries) {
        const hit = e.exact
            ? pathname === e.path || pathname === e.path + '/'
            : pathname === e.path || pathname.startsWith(e.path.endsWith('/') ? e.path : e.path + '/');
        if (hit && (!best || e.path.length > best.path.length)) best = e;
    }
    return best ? { title: best.title, group: best.group } : { title: 'Админка', group: null };
}

export function AdminLayout() {
    const location = useLocation();
    const logout = useUserStore(s => s.logout);
    const currentUser = useUserStore(s => s.currentUser);
    // Проверки общие с самими страницами (utils/permissions): меню прячет
    // пункт, а страница без права уводит на /admin.
    const canAccessRights = userCanAccessRights(currentUser);
    const canAccessFinance = userCanAccessFinance(currentUser);
    // Аналитика — строго персонально владельцу (не роль, конкретный аккаунт).
    const canSeeAnalytics = (currentUser?.email || '').toLowerCase() === 'koren.nikolas@gmail.com';

    const navGroups: AdminNavGroup[] = [
        {
            title: 'Каждый день',
            items: [
                { path: '/admin', icon: LayoutDashboard, label: 'Сегодня', exact: true },
                { path: '/admin/bookings', icon: Calendar, label: 'Бронирования' },
                { path: '/admin/tasks', icon: ClipboardList, label: 'Задачи' },
                { path: '/admin/users', icon: Users, label: 'Клиенты' },
                ...(canAccessFinance ? [{ path: '/admin/finance', icon: Wallet, label: 'Финансы' }] : []),
            ],
        },
        {
            title: 'Пространство',
            items: [
                { path: '/admin/cabinets', icon: Box, label: 'Кабинеты' },
                { path: '/admin/maintenance', icon: Wrench, label: 'Обслуживание' },
                { path: '/admin/waitlist', icon: Clock, label: 'Лист ожидания' },
            ],
        },
        {
            title: 'Люди и контент',
            items: [
                { path: '/admin/specialists', icon: Star, label: 'Специалисты' },
                { path: '/admin/team', icon: UsersRound, label: 'Команда' },
                { path: '/admin/posts', icon: Newspaper, label: 'Новости и статьи' },
                { path: '/admin/knowledge-base', icon: BookOpen, label: 'База знаний' },
                { path: '/admin/crm', icon: Filter, label: 'Воронка клиентов' },
            ],
        },
        {
            title: 'Система',
            items: [
                ...(canSeeAnalytics ? [{ path: '/admin/analytics', icon: BarChart3, label: 'Аналитика' }] : []),
                ...(canAccessRights ? [{ path: '/admin/access-rights', icon: Shield, label: 'Права доступа' }] : []),
            ],
        },
    ].filter(g => g.items.length > 0);

    const { title, group } = adminTitleFor(location.pathname, navGroups);
    useDocumentTitle(`${title} · Админка`);

    // ── Access Guard ──────────────────────────────────────────────────────────
    const hasToken = Boolean(localStorage.getItem('token'));

    // No token → redirect to login immediately (no flash), with a way back here
    if (!hasToken) return <Navigate to={loginPathWithRedirect(location.pathname + location.search)} replace />;

    // Token exists but user not yet loaded → show blank screen while fetching
    if (!currentUser) return null;

    // User loaded but not an admin → redirect to home
    if (!ADMIN_ROLES.includes(currentUser.role ?? '')) return <Navigate to="/" replace />;
    // ─────────────────────────────────────────────────────────────────────────

    const handleLogout = () => {
        logout();
        window.location.href = '/login';
    };

    // Старая тёмная «стеклянная» оболочка не рендерилась с весны — удалена
    // в волне 4 (история — git до fb20491). Grid House — единственная.
    return (
        <GridHouseAdminShell
            navGroups={navGroups}
            currentUser={currentUser}
            onLogout={handleLogout}
            title={title}
            group={group}
        />
    );
}

// ═════════════════════════════════════════════════════════════════════════
// GRID HOUSE — боковое меню группами, тонкие линии
// ═════════════════════════════════════════════════════════════════════════

type CurrentUser = ReturnType<typeof useUserStore.getState>['currentUser'];

const SIDEBAR_WIDTH = 260;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');

function GridHouseAdminShell({
    navGroups,
    currentUser,
    onLogout,
    title,
    group,
}: {
    navGroups: AdminNavGroup[];
    currentUser: CurrentUser;
    onLogout: () => void;
    title: string;
    group: string | null;
}) {
    const location = useLocation();
    const navigate = useNavigate();
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 960);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const userMenuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 960);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    // Меню на узком окне и меню под именем закрываются по Esc.
    useEffect(() => {
        if (!mobileOpen && !userMenuOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            setUserMenuOpen(false);
            setMobileOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [mobileOpen, userMenuOpen]);

    // Клик мимо меню под именем — закрыть.
    useEffect(() => {
        if (!userMenuOpen) return;
        const onDown = (e: MouseEvent) => {
            if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [userMenuOpen]);

    // Переход — меню закрываются.
    useEffect(() => {
        setUserMenuOpen(false);
        setMobileOpen(false);
    }, [location.pathname]);

    const hairline = `1px solid ${GH.ink10}`;
    const sidebarBg = narrow ? COLOR.sidebarNarrow : COLOR.sidebar;
    const sidebarHidden = narrow && !mobileOpen;

    const isActive = (item: AdminNavItem) =>
        item.exact
            ? location.pathname === item.path || location.pathname === item.path + '/'
            : location.pathname === item.path || location.pathname.startsWith(item.path + '/');

    const roleLabel =
        currentUser?.role === 'owner' ? 'Владелец'
        : currentUser?.role === 'senior_admin' ? 'Старший админ'
        : 'Администратор';

    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 12,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: GH.ink60,
        fontWeight: 500,
    };

    const menuLink: React.CSSProperties = {
        display: 'flex', alignItems: 'center', gap: 10,
        minHeight: 40, padding: '0 16px',
        fontSize: 14, color: GH.ink, textDecoration: 'none',
        background: 'none', border: 'none', width: '100%', textAlign: 'left',
        fontFamily: GH_SANS, cursor: 'pointer',
    };

    const sidebar = (
        <aside
            aria-label="Меню админки"
            // Спрятанное за край меню не должно ловить Tab.
            inert={sidebarHidden || undefined}
            style={{
                width: SIDEBAR_WIDTH,
                minWidth: SIDEBAR_WIDTH,
                background: sidebarBg,
                borderRight: narrow ? `1px solid ${GH.ink}` : hairline,
                position: narrow ? 'fixed' : 'sticky',
                top: 0,
                left: 0,
                height: '100vh',
                transform: sidebarHidden ? 'translateX(-100%)' : 'translateX(0)',
                transition: 'transform 0.2s ease',
                zIndex: 60,
                display: 'flex',
                flexDirection: 'column',
                boxShadow: narrow && mobileOpen ? 'var(--shadow-pop)' : 'none',
            }}
        >
            {/* Brand */}
            <div style={{ padding: '20px 24px 16px', borderBottom: hairline }}>
                <Link to="/" style={{ textDecoration: 'none', color: GH.ink }}>
                    <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1 }}>Unbox</div>
                    <div style={{ ...monoLabel, marginTop: 4 }}>Админка</div>
                </Link>
            </div>

            {/* Кто вошёл + личное меню под именем */}
            <div ref={userMenuRef} style={{ position: 'relative', borderBottom: hairline }}>
                <button
                    type="button"
                    onClick={() => setUserMenuOpen(o => !o)}
                    aria-expanded={userMenuOpen}
                    aria-haspopup="menu"
                    aria-controls="admin-user-menu"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                        padding: '12px 24px', background: 'none', border: 'none',
                        cursor: 'pointer', textAlign: 'left', fontFamily: GH_SANS, color: GH.ink,
                    }}
                >
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ ...monoLabel, display: 'block' }}>{roleLabel}</span>
                        <span style={{
                            display: 'block', fontSize: 14, fontWeight: 600, marginTop: 2,
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                            {currentUser?.name ?? '—'}
                        </span>
                    </span>
                    <ChevronDown
                        size={16}
                        aria-hidden="true"
                        style={{ color: GH.ink60, transform: userMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
                    />
                </button>
                {userMenuOpen && (
                    <div
                        id="admin-user-menu"
                        role="menu"
                        aria-label="Личное"
                        style={{
                            position: 'absolute', left: 12, right: 12, top: '100%', marginTop: 4,
                            background: COLOR.card, border: `1px solid ${GH.ink}`,
                            boxShadow: 'var(--shadow-pop)', zIndex: Z.dropdown,
                            padding: '4px 0',
                        }}
                    >
                        <div style={{ padding: '6px 16px 8px', fontSize: 12, color: GH.ink60, fontFamily: GH_MONO, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {currentUser?.email}
                        </div>
                        {PERSONAL_ITEMS.map(({ path, label, icon: Icon }) => (
                            <Link key={path} to={path} role="menuitem" style={menuLink} className="admin-menu-link">
                                <Icon size={16} aria-hidden="true" />
                                {label}
                            </Link>
                        ))}
                        <div style={{ borderTop: hairline, margin: '4px 0' }} />
                        <button type="button" role="menuitem" onClick={onLogout} style={{ ...menuLink, color: GH.danger }} className="admin-menu-link">
                            <LogOut size={16} aria-hidden="true" />
                            Выйти
                        </button>
                    </div>
                )}
            </div>

            {/* Разделы — четыре группы, прокручиваются отдельно от шапки и подвала. */}
            <nav aria-label="Разделы админки" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '4px 0 12px' }}>
                {navGroups.map(g => {
                    const headId = `admin-nav-${g.title}`;
                    return (
                        <div key={g.title} style={{ marginTop: 12 }}>
                            <div id={headId} style={{ ...monoLabel, padding: '4px 24px 6px' }}>
                                {g.title}
                            </div>
                            <ul aria-labelledby={headId} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {g.items.map(item => {
                                    const active = isActive(item);
                                    const Icon = item.icon;
                                    return (
                                        <li key={item.path}>
                                            <Link
                                                to={item.path}
                                                aria-current={active ? 'page' : undefined}
                                                className={active ? undefined : 'admin-nav-link'}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 12,
                                                    minHeight: 40,
                                                    padding: '0 24px',
                                                    textDecoration: 'none',
                                                    fontSize: 14,
                                                    fontWeight: active ? 600 : 500,
                                                    background: active ? GH.ink : undefined,
                                                    color: active ? GH.paper : GH.ink,
                                                }}
                                            >
                                                <Icon size={16} aria-hidden="true" />
                                                {item.label}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </nav>

            {/* Подвал: на сайт и в свой кабинет специалиста */}
            <div style={{ borderTop: hairline, padding: '8px 0' }}>
                <button type="button" onClick={() => navigate('/crm')} style={{ ...menuLink, padding: '0 24px' }} className="admin-menu-link">
                    <Briefcase size={16} aria-hidden="true" />
                    Кабинет специалиста
                </button>
                <button type="button" onClick={() => navigate('/')} style={{ ...menuLink, padding: '0 24px', color: GH.ink60 }} className="admin-menu-link">
                    <ArrowLeft size={16} aria-hidden="true" />
                    На сайт
                </button>
            </div>
        </aside>
    );

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
                overflowX: 'clip',
                width: '100%',
                maxWidth: '100vw',
            }}
        >
            {/* Наведение на пункт меню — тонкая подложка (раньше hover не было). */}
            <style>{`
                .admin-nav-link:hover, .admin-menu-link:hover { background: ${GH.ink5}; }
                .admin-nav-link:focus-visible, .admin-menu-link:focus-visible { outline: 2px solid var(--color-accent); outline-offset: -2px; }
            `}</style>

            {sidebar}

            {/* Фон под выдвинутым меню на узком окне */}
            {narrow && mobileOpen && (
                <div
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true"
                    style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,16,0.5)', zIndex: 55 }}
                />
            )}

            {/* ── MAIN ── */}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', width: narrow ? '100%' : undefined }}>
                {/* Шапка: где я (группа / раздел), поиск, календарь, уведомления. */}
                <header
                    style={{
                        borderBottom: hairline,
                        background: GH.paper,
                        position: 'sticky',
                        top: 0,
                        zIndex: 30,
                        padding: narrow ? '8px 16px' : '10px 28px',
                        minHeight: 56,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                    }}
                >
                    {narrow && (
                        <button
                            type="button"
                            onClick={() => setMobileOpen(true)}
                            aria-expanded={mobileOpen}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                fontFamily: GH_SANS, fontSize: 14, fontWeight: 500,
                                color: GH.paper, background: GH.ink, border: 'none',
                                padding: '0 12px', minHeight: 40, cursor: 'pointer',
                            }}
                        >
                            <Menu size={16} aria-hidden="true" />
                            Меню
                        </button>
                    )}
                    <div style={{ fontSize: 14, color: GH.ink60, display: 'flex', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
                        {group && !narrow && <span>{group}</span>}
                        {group && !narrow && <span aria-hidden="true">/</span>}
                        <span style={{ color: GH.ink, fontWeight: 500 }}>{title}</span>
                    </div>

                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                            type="button"
                            onClick={openCmdK}
                            aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 8,
                                minHeight: 36, padding: '0 10px',
                                minWidth: narrow ? undefined : 260,
                                fontFamily: GH_SANS, fontSize: 14, color: GH.ink60,
                                background: COLOR.card, border: `1px solid ${GH.ink20}`, borderRadius: 8,
                                cursor: 'pointer', textAlign: 'left',
                            }}
                        >
                            <Search size={16} aria-hidden="true" />
                            <span style={{ flex: 1 }}>{narrow ? 'Найти' : 'Найти клиента или бронь'}</span>
                            {!narrow && (
                                <kbd style={{
                                    fontFamily: GH_MONO, fontSize: 12, color: GH.ink60,
                                    border: `1px solid ${GH.ink10}`, borderRadius: 4, padding: '1px 6px',
                                }}>
                                    {isMac ? '⌘K' : 'Ctrl K'}
                                </kbd>
                            )}
                        </button>
                        {/* Excel #38 — Google Календарь в один клик. */}
                        <a
                            href="https://calendar.google.com/calendar/u/0/r"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Открыть Google Календарь в новой вкладке"
                            aria-label="Google Календарь (откроется в новой вкладке)"
                            className="admin-menu-link"
                            style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                minHeight: 36, padding: '0 10px',
                                fontSize: 14, color: GH.ink60, textDecoration: 'none',
                                border: `1px solid ${GH.ink10}`, borderRadius: 8,
                            }}
                        >
                            <CalendarDays size={16} aria-hidden="true" />
                            {!narrow && 'Календарь'}
                            <ExternalLink size={12} aria-hidden="true" />
                        </a>
                        <NotificationBell variant="light" />
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
