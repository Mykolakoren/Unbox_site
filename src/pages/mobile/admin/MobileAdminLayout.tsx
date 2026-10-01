import { NavLink, Outlet, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarClock, CalendarDays, Check, CheckSquare, ChevronDown, Inbox, Users, Wallet } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import { specialistsApi } from '../../../api/specialists';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileAdminTour, ADMIN_TOUR_PREFIX } from './MobileAdminTour';
import { NotificationsBell } from '../NotificationsBell';
import { Z_TABBAR } from './sheetLayers';
import { loginPathWithRedirect } from '../../../utils/loginRedirect';
import { forceUnlockScroll } from '../useScrollLock';
import { canUsePsyCrm } from '../crmAccess';
// Wave 1: шрифт IBM Plex и общие токены, как в клиентской оболочке /m.
import { COLOR, FONT, TEXT } from '../../../design/tokens';
import { useTouchDensity } from '../../../hooks/useTouchDensity';
import { Sheet } from '../../../components/ui/Sheet';

/**
 * Mobile admin shell — separate workspace at /m/admin.
 *
 * Tabs: Сегодня (лента дня, кто должен) / Брони / Задачи / Касса
 *     / Клиенты (search + quick actions)
 *     / Заявки (срочные брони + анкеты специалистов; счётчик на вкладке).
 *
 * Волна 4: шапка «Админка ▾» по образцу «Psy-CRM ▾» (X2-07) — шторка
 * «Мой кабинет · Админка · Psy-CRM · CRM клиентов · Права доступа» (по роли).
 * На вкладке «Заявки» — число того, что ждёт решения (G9-admin-mobile-M2).
 * При переходе на новый экран прокрутка сбрасывается наверх, при «назад» —
 * восстанавливается (X5-08).
 *
 * Gate: owner / senior_admin / admin only. Anyone else hits /m fallback.
 */
export function MobileAdminLayout() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const navigate = useNavigate();
    const location = useLocation();
    // Страховка, как в MobileLayout: при смене экрана снимаем лок прокрутки,
    // если шторка не сняла его сама (лок держит и html, и body).
    useEffect(() => {
        forceUnlockScroll();
    }, [location.pathname]);
    const [tourOpen, setTourOpen] = useState(false);
    const [switcherOpen, setSwitcherOpen] = useState(false);
    useTouchDensity();

    // X5-08: прокручивается документ. Новый экран — сверху, «назад» — туда, где был.
    const navType = useNavigationType();
    const scrollPositions = useRef(new Map<string, number>());
    const currentKey = useRef(location.key);
    useEffect(() => {
        const onScroll = () => { scrollPositions.current.set(currentKey.current, window.scrollY); };
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    useLayoutEffect(() => {
        currentKey.current = location.key;
        const saved = navType === 'POP' ? scrollPositions.current.get(location.key) : undefined;
        window.scrollTo(0, saved ?? 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        // На вход — с возвратом на этот же экран админки.
        const toLogin = () => navigate(loginPathWithRedirect(location.pathname + location.search));
        if (!token) { toLogin(); return; }
        if (!currentUser) fetchCurrentUser().catch(toLogin);
    }, [currentUser, fetchCurrentUser, navigate, location.pathname, location.search]);

    useEffect(() => {
        if (!currentUser) return;
        const forced = new URLSearchParams(location.search).get('tour') === '1';
        if (forced) { setTourOpen(true); return; }
        if (!hasCompletedTour(currentUser.id, ADMIN_TOUR_PREFIX)) {
            const t = setTimeout(() => setTourOpen(true), 350);
            return () => clearTimeout(t);
        }
    }, [currentUser, location.search]);

    // Счётчик на вкладке «Заявки»: срочные брони + анкеты на проверке.
    // Обновляем при смене экрана, не чаще раза в минуту.
    const [requests, setRequests] = useState<number | null>(null);
    const requestsAt = useRef(0);
    useEffect(() => {
        if (!currentUser) return;
        if (Date.now() - requestsAt.current < 60_000 && !location.pathname.startsWith('/m/admin/inbox')) return;
        requestsAt.current = Date.now();
        let alive = true;
        Promise.allSettled([
            bookingsApi.getPendingApprovals(),
            specialistsApi.adminList(),
        ]).then(([hot, specs]) => {
            if (!alive) return;
            const a = hot.status === 'fulfilled' ? hot.value.length : 0;
            const b = specs.status === 'fulfilled' ? specs.value.filter(s => s.applicationStatus === 'pending').length : 0;
            setRequests(a + b);
        });
        return () => { alive = false; };
    }, [currentUser, location.pathname]);

    if (!currentUser) {
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: COLOR.card }}>
                <div role="status" aria-label="Загружаем" className="w-8 h-8 border-2 border-ink-20 border-t-ink rounded-full animate-spin" />
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
            background: COLOR.sunken,
            display: 'flex',
            justifyContent: 'center',
        }}>
            <div style={{
                width: '100%',
                maxWidth: 480,
                minHeight: '100vh',
                background: COLOR.card,
                display: 'flex',
                flexDirection: 'column',
                paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                fontFamily: FONT.sans,
                color: COLOR.ink,
                boxShadow: `0 0 0 1px ${COLOR.ink05}`,
            }}>
                {/* Safe-area сверху: в standalone-режиме iOS шапка пряталась
                    под чёлкой (см. MobileCrmLayout, тот же фикс 31.08). */}
                <div style={{
                    background: 'var(--color-ink)',
                    color: 'var(--color-on-ink)',
                    padding: 'calc(6px + env(safe-area-inset-top, 0px)) 12px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                }}>
                    {/* Волна 4 (X2-07): подписанный переключатель разделов 44 px
                        «Админка ▾» вместо кнопки «Кабинет» со стрелкой. */}
                    <button
                        type="button"
                        onClick={() => setSwitcherOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={switcherOpen}
                        style={{
                            background: 'none',
                            border: 'none',
                            borderRadius: 8,
                            minHeight: 44, minWidth: 44,
                            padding: '0 8px',
                            display: 'flex', alignItems: 'center', gap: 6,
                            cursor: 'pointer',
                            color: 'var(--color-on-ink)',
                            fontFamily: 'inherit',
                            fontSize: 16,
                            fontWeight: 600,
                        }}
                    >
                        Админка
                        <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <div style={{ flex: 1, fontSize: TEXT.caption, color: 'var(--color-on-ink)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {currentUser.name?.split(' ')[0]}
                    </div>
                    <NotificationsBell color={COLOR.onInk} />
                </div>

                <main data-mobile-scroll style={{ flex: 1, overflow: 'auto' }}>
                    <div key={location.pathname} className="mobile-page">
                        <Outlet />
                    </div>
                </main>
            </div>

            <nav aria-label="Разделы админки" style={{
                position: 'fixed',
                bottom: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                background: COLOR.card,
                borderTop: `1px solid ${COLOR.ink08}`,
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                // Шторки страниц — общий Sheet (слой выше), меню их не закрывает.
                zIndex: Z_TABBAR,
            }}>
                <TabLink to="/m/admin/dashboard" icon={CalendarClock} label="Сегодня" />
                <TabLink to="/m/admin/bookings" icon={CalendarDays} label="Брони" />
                <TabLink to="/m/admin/tasks" icon={CheckSquare} label="Задачи" />
                <TabLink to="/m/admin/finance" icon={Wallet} label="Касса" />
                <TabLink to="/m/admin/users" icon={Users} label="Клиенты" />
                <TabLink to="/m/admin/inbox" icon={Inbox} label="Заявки" badge={requests ?? 0} />
            </nav>

            <SectionSwitcher
                open={switcherOpen}
                onClose={() => setSwitcherOpen(false)}
                canCrm={canUsePsyCrm(currentUser)}
                canRights={currentUser.role === 'owner' || currentUser.role === 'senior_admin'}
                pathname={location.pathname}
                onGo={(to) => { setSwitcherOpen(false); navigate(to); }}
            />

            {tourOpen && <MobileAdminTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

/** «Админка ▾»: куда перейти. Текущий раздел — с галочкой; пункты — по роли. */
function SectionSwitcher({ open, onClose, canCrm, canRights, pathname, onGo }: {
    open: boolean;
    onClose: () => void;
    canCrm: boolean;
    canRights: boolean;
    pathname: string;
    onGo: (to: string) => void;
}) {
    const inCrm = pathname.startsWith('/m/admin/crm');
    const inRights = pathname.startsWith('/m/admin/access-rights');
    const items: { to: string; label: string; hint: string; current: boolean }[] = [
        { to: '/m/admin/dashboard', label: 'Админка', hint: 'Сегодня, брони, касса, клиенты', current: !inCrm && !inRights },
        { to: '/m/admin/crm', label: 'CRM клиентов', hint: 'Спящие клиенты и воронка', current: inCrm },
        ...(canRights ? [{ to: '/m/admin/access-rights', label: 'Права доступа', hint: 'Что может каждый сотрудник', current: inRights }] : []),
        ...(canCrm ? [{ to: '/m/crm/today', label: 'Psy-CRM', hint: 'Ваши клиенты и сессии', current: false }] : []),
    ];
    return (
        <Sheet open={open} onClose={onClose} title="Куда перейти">
            <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Выход в личный кабинет — первым, как раньше кнопка в шапке. */}
                <button
                    type="button"
                    onClick={() => onGo('/m')}
                    aria-label="Мой кабинет"
                    className="press"
                    style={{ ...switcherItem, minHeight: 44, minWidth: 44 }}
                >
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>Мой кабинет</span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-ink-60)' }}>Брони кабинетов, баланс, абонемент</span>
                    </span>
                </button>
                {items.map(it => (
                    <button
                        key={it.to}
                        type="button"
                        onClick={() => onGo(it.to)}
                        aria-current={it.current ? 'page' : undefined}
                        className="press"
                        style={{ ...switcherItem, borderTop: `1px solid ${COLOR.ink08}` }}
                    >
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>{it.label}</span>
                            <span style={{ display: 'block', fontSize: 14, color: 'var(--color-ink-60)' }}>{it.hint}</span>
                        </span>
                        {it.current && <Check size={18} aria-hidden="true" style={{ color: 'var(--color-accent)', flexShrink: 0 }} />}
                    </button>
                ))}
            </nav>
        </Sheet>
    );
}

const switcherItem: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, minHeight: 56,
    padding: '8px 4px', background: 'none', border: 'none',
    textAlign: 'left', fontFamily: 'inherit', color: 'var(--color-ink)', cursor: 'pointer',
};

function TabLink({ to, icon: Icon, label, badge = 0 }: { to: string; icon: React.ElementType; label: string; badge?: number }) {
    // 6 вкладок: на 360 px это 60 px на ячейку — «Клиенты» 12 px Plex
    // помещается. Подпись 12 px — минимум шкалы.
    return (
        <NavLink
            to={to}
            aria-label={badge > 0 ? `${label}: ждут решения ${badge}` : undefined}
            style={({ isActive }) => ({
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '9px 0 11px',
                color: isActive ? COLOR.accentInk : COLOR.ink60,
                textDecoration: 'none',
                fontSize: TEXT.caption,
                fontWeight: isActive ? 600 : 500,
                lineHeight: 1,
                whiteSpace: 'nowrap',
            })}
        >
            <Icon size={20} strokeWidth={2} />
            <span>{label}</span>
            {badge > 0 && (
                <span aria-hidden="true" className="num" style={{
                    position: 'absolute', top: 4, left: 'calc(50% + 6px)',
                    minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                    background: 'var(--status-pending-fg)', color: 'var(--color-on-ink)',
                    fontSize: 12, fontWeight: 600, lineHeight: '18px', textAlign: 'center',
                }}>
                    {badge > 99 ? '99+' : badge}
                </span>
            )}
        </NavLink>
    );
}
