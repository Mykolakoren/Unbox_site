import { Outlet, useNavigate, Navigate, useLocation, Link } from 'react-router-dom';
import { useUserStore } from '../../store/userStore';
import { loginPathWithRedirect } from '../../utils/loginRedirect';
import { QuickActionsFab, type QuickAction } from '../../components/ui/QuickActionsFab';
import {
    Calendar,
    Loader2,
    UserPlus,
    Plus,
    ExternalLink,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { CrmApplyPage } from './CrmApplyPage';
import { NotificationsBell } from '../mobile/NotificationsBell';
import { crmApi, type CrmAccessStatus } from '../../api/crm';
import { useCrmStore } from '../../store/crmStore';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import type { User } from '../../store/types';

export function CrmLayout() {
    const { currentUser } = useUserStore();
    const { fetchPaymentAccounts } = useCrmStore();
    // «Просмотр как специалист» (админ смотрит чужой кабинет): кнопки
    // создания прячем — записывать за другого отсюда нельзя.
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    const navigate = useNavigate();
    const location = useLocation();
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

    // Быстрые действия сразу открывают формы (G5-13): «?new=1» — шторка
    // «Новая сессия» на странице сессий, а не просто список.
    const quickActions: QuickAction[] = [
        ...(viewingOther ? [] : [
            { label: 'Новый клиент', sub: 'Создать карточку', path: '/crm/clients?new=1', icon: UserPlus },
            { label: 'Новая сессия', sub: 'Записать встречу', path: '/crm/sessions?new=1', icon: Calendar },
        ]),
        { label: 'Забронировать кабинет', sub: 'Unbox One · Uni · Neo', path: '/crm/bookings', icon: Plus },
        {
            label: 'Открыть Google Календарь',
            sub: calendarId ? 'Ваш личный календарь' : 'Google Календарь',
            href: calendarId
                ? `https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(calendarId)}`
                : 'https://calendar.google.com/calendar/u/0/r',
            icon: ExternalLink,
        },
    ];

    useEffect(() => {
        if (!hasToken) navigate(loginPathWithRedirect(location.pathname + location.search));
    }, [hasToken, navigate, location.pathname, location.search]);

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

    if (!hasToken) return <Navigate to={loginPathWithRedirect(location.pathname + location.search)} replace />;
    if (!currentUser) return null;

    // Show loading while checking access
    if (accessLoading) {
        return (
            <div role="status" aria-busy="true" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: GH.paper }}>
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: GH.accent }} aria-hidden="true" />
                <span className="sr-only">Открываем кабинет…</span>
            </div>
        );
    }

    // Show apply page if no active access
    if (!accessStatus || accessStatus.accessStatus !== 'active') {
        return <CrmApplyPage />;
    }

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'senior_admin' || currentUser.role === 'owner';

    // Старая оболочка на SidebarLayout (вкладки CrmTopTabs) не рендерилась
    // с апреля — удалена в волне 3. Grid House — единственная оболочка.
    return <GridHouseCrmShell isAdmin={isAdmin} currentUser={currentUser} quickActions={quickActions} />;
}

// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE CRM shell.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Меню — четыре группы (решение владельца В4, 01.10): «Работа / Кабинеты /
 * Деньги / Я». Без номеров 01–11 (G5-18): номер ничего не говорит, а
 * пятнадцать плоских пунктов не читались. Личные ссылки (абонемент,
 * бонусы, личные данные) раньше висели отдельным рядом значков —
 * теперь в своих группах. «Шахматка» живёт только в «Бронированиях».
 */
interface NavItem { label: string; path: string; exact?: boolean }
interface NavGroup { title: string; items: NavItem[] }

const CRM_NAV_GROUPS: NavGroup[] = [
    {
        title: 'Работа',
        items: [
            { label: 'Дашборд', path: '/crm', exact: true },
            { label: 'Клиенты', path: '/crm/clients' },
            { label: 'Сессии', path: '/crm/sessions' },
            { label: 'Заметки', path: '/crm/notes' },
        ],
    },
    {
        title: 'Кабинеты',
        items: [
            { label: 'Бронирования', path: '/crm/bookings' },
            { label: 'Слежу за слотами', path: '/crm/waitlist' },
            { label: 'Правила', path: '/booking-rules' },
        ],
    },
    {
        title: 'Деньги',
        items: [
            { label: 'Финансы', path: '/crm/finances' },
            { label: 'Абонемент', path: '/crm/subscription' },
            { label: 'Бонусы', path: '/crm/bonuses' },
        ],
    },
    {
        title: 'Я',
        items: [
            { label: 'Анкета', path: '/crm/profile' },
            { label: 'Часы приёма', path: '/crm/schedule' },
            { label: 'Настройки', path: '/crm/settings' },
            { label: 'Личные данные', path: '/crm/account' },
        ],
    },
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

    // Открытое меню на узком окне закрывается по Esc.
    useEffect(() => {
        if (!isMobileOpen) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsMobileOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isMobileOpen]);

    const isActive = (path: string, exact?: boolean) => {
        if (exact) return location.pathname === path;
        if (path === '/crm' && location.pathname !== '/crm') return false;
        return location.pathname.startsWith(path);
    };

    let activeGroup: NavGroup | null = null;
    let activeItem: NavItem | null = null;
    for (const g of CRM_NAV_GROUPS) {
        const hit = g.items.find(t => isActive(t.path, t.exact));
        if (hit) { activeGroup = g; activeItem = hit; break; }
    }

    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: '12px',
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: GH.ink60,
        fontWeight: 500,
    };

    const SIDEBAR_WIDTH = 260;
    const sidebarHidden = isNarrow && !isMobileOpen;

    const sidebar = (
        <aside
            aria-label="Меню CRM"
            // Спрятанное за край меню не должно ловить Tab.
            inert={sidebarHidden || undefined}
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
                transform: sidebarHidden ? 'translateX(-100%)' : 'translateX(0)',
                transition: 'transform 0.25s ease',
            }}
        >
            {/* Brand */}
            <div
                style={{
                    padding: '20px 24px 16px',
                    borderBottom: `1px solid ${GH.ink}`,
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                }}
            >
                <Link to="/" style={{ textDecoration: 'none', color: GH.ink }}>
                    <div style={{
                        fontFamily: GH_SANS,
                        fontSize: '20px',
                        fontWeight: 600,
                        letterSpacing: '-0.02em',
                        lineHeight: 1,
                    }}>
                        Unbox
                    </div>
                    <div style={{
                        ...monoLabel,
                        marginTop: '4px',
                    }}>
                        Кабинет специалиста
                    </div>
                </Link>
                {/* Уведомления (конфликты календаря, удержанные удаления, связи
                    с бронями). Раньше колокольчик был только в мобильной CRM —
                    с компьютера специалист их не видел вовсе (аудит 24.09). */}
                <NotificationsBell color={GH.ink} />
            </div>

            {/* Current user strip */}
            {currentUser && (
                <div
                    style={{
                        padding: '14px 24px',
                        borderBottom: `1px solid ${GH.ink10}`,
                    }}
                >
                    {/* Без слова «СЕССИЯ» — в CRM сессия значит встречу с клиентом (G5-18). */}
                    <div style={monoLabel}>{currentUser.role === 'specialist' ? 'Специалист' : currentUser.role === 'owner' || currentUser.role === 'senior_admin' ? 'Админ' : 'Оператор'}</div>
                    <div style={{
                        fontFamily: GH_SANS,
                        fontSize: '14px',
                        fontWeight: 600,
                        marginTop: '4px',
                        color: GH.ink,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {currentUser.name}
                    </div>
                    {/* Show email so a stale/misbound session is visible at
                        a glance — avoids the "зашёл под своим, а это чужой
                        аккаунт" trap where a cached name from localStorage
                        survives a token change. */}
                    <div style={{
                        fontFamily: GH_MONO,
                        fontSize: '12px',
                        marginTop: '2px',
                        color: GH.ink60,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {currentUser.email}
                    </div>
                </div>
            )}

            {/* Nav — четыре группы (В4) */}
            <nav aria-label="Разделы CRM" style={{ flex: 1, overflowY: 'auto', padding: '4px 0 12px' }}>
                {CRM_NAV_GROUPS.map(group => {
                    const headId = `crm-nav-${group.title}`;
                    return (
                        <div key={group.title} style={{ marginTop: 12 }}>
                            <div id={headId} style={{ ...monoLabel, padding: '4px 24px 6px' }}>
                                {group.title}
                            </div>
                            <ul aria-labelledby={headId} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                {group.items.map(tab => {
                                    const active = isActive(tab.path, tab.exact);
                                    return (
                                        <li key={tab.path}>
                                            <Link
                                                to={tab.path}
                                                aria-current={active ? 'page' : undefined}
                                                onClick={() => setIsMobileOpen(false)}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    minHeight: 40,
                                                    padding: '0 24px',
                                                    textDecoration: 'none',
                                                    fontFamily: GH_SANS,
                                                    fontSize: '14px',
                                                    fontWeight: active ? 600 : 500,
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
                                                {tab.label}
                                            </Link>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}
            </nav>

            {/* Footer actions */}
            <div style={{ borderTop: `1px solid ${GH.ink}`, padding: '12px 24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {isAdmin && (
                    <button
                        type="button"
                        onClick={() => navigate('/admin')}
                        style={{
                            fontFamily: GH_SANS,
                            fontSize: 14,
                            fontWeight: 500,
                            color: GH.ink,
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            minHeight: 36,
                            textAlign: 'left',
                            cursor: 'pointer',
                        }}
                    >
                        Админка →
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => { logout(); window.location.href = '/login'; }}
                    style={{
                        fontFamily: GH_SANS,
                        fontSize: 14,
                        fontWeight: 500,
                        color: GH.danger,
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        minHeight: 36,
                        textAlign: 'left',
                        cursor: 'pointer',
                    }}
                >
                    Выйти
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
                    aria-hidden="true"
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
                {/* Top bar: где я — группа и раздел, без номеров «01 /» и без
                    дублирующего «UNBOX · CRM» (G5-19). */}
                <div style={{
                    borderBottom: `1px solid ${GH.ink}`,
                    padding: isNarrow ? '12px 20px' : '14px 40px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    minHeight: 56,
                    background: GH.paper,
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                }}>
                    {isNarrow && (
                        <button
                            type="button"
                            onClick={() => setIsMobileOpen(true)}
                            aria-expanded={isMobileOpen}
                            style={{
                                background: GH.ink,
                                color: GH.paper,
                                border: 'none',
                                padding: '8px 12px',
                                minHeight: 44,
                                fontFamily: GH_SANS,
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer',
                            }}
                        >
                            Меню
                        </button>
                    )}
                    <div style={{
                        fontFamily: GH_SANS,
                        fontSize: '14px',
                        color: GH.ink60,
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                    }}>
                        {activeGroup && <span>{activeGroup.title}</span>}
                        {activeGroup && activeItem && <span aria-hidden="true">/</span>}
                        {activeItem && <span style={{ color: GH.ink, fontWeight: 500 }}>{activeItem.label}</span>}
                    </div>
                </div>

                <div style={{
                    padding: isNarrow ? '32px 20px 80px' : '40px 40px 96px',
                    maxWidth: '1360px',
                }}>
                    <Outlet />
                </div>
            </main>
            <QuickActionsFab actions={quickActions} />
        </div>
    );
}
