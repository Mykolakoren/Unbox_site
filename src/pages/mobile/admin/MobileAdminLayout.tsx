import { Navigate, NavLink, Outlet, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarClock, CalendarDays, Check, CheckSquare, ChevronDown, Inbox, Users, Wallet } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { bookingsApi } from '../../../api/bookings';
import { specialistsApi } from '../../../api/specialists';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileAdminTour, ADMIN_TOUR_PREFIX } from './MobileAdminTour';
import { NotificationsBell } from '../NotificationsBell';
import { ADMIN_REQUESTS_CHANGED, Z_TABBAR } from './sheetLayers';
import { loginPathWithRedirect } from '../../../utils/loginRedirect';
import { forceUnlockScroll } from '../useScrollLock';
import { canUsePsyCrm } from '../crmAccess';
import { userCanAccessFinance, userCanAccessRights } from '../../../utils/permissions';
// Wave 1: шрифт IBM Plex и общие токены, как в клиентской оболочке /m.
import { COLOR, FONT, TEXT, themed } from '../../../design/tokens';
import { useTouchDensity } from '../../../hooks/useTouchDensity';
import { Sheet } from '../../../components/ui/Sheet';
import { Counter } from '../../../components/ui/Counter';

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
    const currentUser = useUserStore(s => s.currentUser);
    const fetchCurrentUser = useUserStore(s => s.fetchCurrentUser);
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
    const isAdmin = !!currentUser && (
        currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin
    );

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
        if (!currentUser || !isAdmin) return;
        const forced = new URLSearchParams(location.search).get('tour') === '1';
        if (forced) { setTourOpen(true); return; }
        if (!hasCompletedTour(currentUser.id, ADMIN_TOUR_PREFIX)) {
            const t = setTimeout(() => setTourOpen(true), 350);
            return () => clearTimeout(t);
        }
    }, [currentUser, isAdmin, location.search]);

    // Счётчик на вкладке «Заявки»: срочные брони + анкеты на проверке — то, что
    // ждёт РЕШЕНИЯ админа. Колокольчик в шапке считает другое: непрочитанные
    // уведомления (поэтому числа могут не совпадать — это разные вещи).
    // Обновляем при смене экрана, не чаще раза в минуту.
    // Ревью 09.11 (№5): раньше отметка времени ставилась ДО запроса, а первый
    // запрос отменялся повторным запуском эффекта (пришёл currentUser) — второй
    // блокировался «не чаще раза в минуту», и число не появлялось, пока не зайдёшь
    // в «Заявки». Теперь отметка — только после ответа, а поздний ответ старого
    // запроса отбрасывается по номеру, а не флагом «эффект перезапущен».
    const [requests, setRequests] = useState<number | null>(null);
    const requestsAt = useRef(0);
    const requestsSeq = useRef(0);
    const requestsInFlight = useRef(false);
    const [requestsTick, setRequestsTick] = useState(0);
    useEffect(() => {
        const onChanged = () => { requestsAt.current = 0; setRequestsTick(t => t + 1); };
        window.addEventListener(ADMIN_REQUESTS_CHANGED, onChanged);
        return () => window.removeEventListener(ADMIN_REQUESTS_CHANGED, onChanged);
    }, []);
    useEffect(() => {
        // Не админу эти запросы сервер отклоняет (403) — он и так уйдёт на /m.
        if (!currentUser || !isAdmin) return;
        const onInbox = location.pathname.startsWith('/m/admin/inbox');
        if (!onInbox && (requestsInFlight.current || Date.now() - requestsAt.current < 60_000)) return;
        const seq = ++requestsSeq.current;
        requestsInFlight.current = true;
        Promise.allSettled([
            bookingsApi.getPendingApprovals(),
            specialistsApi.adminList(),
        ]).then(([hot, specs]) => {
            if (seq === requestsSeq.current) requestsInFlight.current = false;
            if (seq !== requestsSeq.current) return;
            if (hot.status === 'rejected' && specs.status === 'rejected') return; // повторим при следующем экране
            const a = hot.status === 'fulfilled' ? hot.value.length : 0;
            const b = specs.status === 'fulfilled' ? specs.value.filter(s => s.applicationStatus === 'pending').length : 0;
            requestsAt.current = Date.now();
            setRequests(a + b);
        });
    }, [currentUser, isAdmin, location.pathname, requestsTick]);

    if (!currentUser) {
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: COLOR.paper }}>
                <div role="status" aria-label="Загружаем" className="w-8 h-8 border-2 border-ink-20 border-t-ink rounded-full animate-spin" />
            </div>
        );
    }

    // <Navigate>, а не navigate() во время отрисовки — React ругался
    // «Cannot update a component while rendering» (обход 10.10).
    if (!isAdmin) return <Navigate to="/m" replace />;
    // Вкладка «Касса» — только с правом на кассу (как «Финансы» на компьютере).
    const canCash = userCanAccessFinance(currentUser);

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
                // 09.11 фаза 3: фон страницы — тёплая бумага (как /m и /m/crm), карточки
                // и группы строк (card) лежат на ней; раньше всё было одного цвета card.
                background: COLOR.paper,
                display: 'flex',
                flexDirection: 'column',
                paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                fontFamily: FONT.sans,
                color: COLOR.ink,
                boxShadow: `0 0 0 1px ${COLOR.ink05}`,
            }}>
                {/* Safe-area сверху: в standalone-режиме iOS шапка пряталась
                    под чёлкой (см. MobileCrmLayout, тот же фикс 31.08). */}
                {/* 09.11 фаза 3: в тёмной теме шапка — цвет страницы с линией снизу:
                    бирюзовая плита #22302F на тёмной бумаге висела светлой полосой. */}
                <div style={{
                    background: themed('var(--color-panel)', 'var(--color-paper)'),
                    color: themed('var(--color-on-panel)', 'var(--color-ink)'),
                    borderBottom: themed('none', `1px solid ${COLOR.ink10}`),
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
                            color: 'inherit',
                            fontFamily: 'inherit',
                            fontSize: 16,
                            fontWeight: 600,
                        }}
                    >
                        Админка
                        <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    {/* Имя — в шторке «Куда перейти» («Вы вошли как …»), а не мелким
                        полупрозрачным текстом посреди шапки (admin-design №25). */}
                    <div style={{ flex: 1 }} />
                    <NotificationsBell color={themed(COLOR.onPanel, COLOR.ink)} />
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
                gridTemplateColumns: `repeat(${canCash ? 6 : 5}, 1fr)`,
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                // Шторки страниц — общий Sheet (слой выше), меню их не закрывает.
                zIndex: Z_TABBAR,
            }}>
                <TabLink to="/m/admin/dashboard" icon={CalendarClock} label="Сегодня" />
                <TabLink to="/m/admin/bookings" icon={CalendarDays} label="Брони" />
                <TabLink to="/m/admin/tasks" icon={CheckSquare} label="Задачи" />
                {canCash && <TabLink to="/m/admin/finance" icon={Wallet} label="Касса" />}
                <TabLink to="/m/admin/users" icon={Users} label="Клиенты" />
                <TabLink to="/m/admin/inbox" icon={Inbox} label="Заявки" badge={requests ?? 0} />
            </nav>

            <SectionSwitcher
                open={switcherOpen}
                onClose={() => setSwitcherOpen(false)}
                canCrm={canUsePsyCrm(currentUser)}
                canRights={userCanAccessRights(currentUser)}
                userName={currentUser.name || currentUser.email || ''}
                pathname={location.pathname}
                onGo={(to) => { setSwitcherOpen(false); navigate(to); }}
            />

            {tourOpen && <MobileAdminTour canCash={canCash} onClose={() => setTourOpen(false)} />}
        </div>
    );
}

/** «Админка ▾»: куда перейти. Текущий раздел — с галочкой; пункты — по роли. */
function SectionSwitcher({ open, onClose, canCrm, canRights, userName, pathname, onGo }: {
    open: boolean;
    onClose: () => void;
    canCrm: boolean;
    canRights: boolean;
    userName: string;
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
        <Sheet open={open} onClose={onClose} title="Куда перейти" description={userName ? `Вы вошли как ${userName}` : undefined}>
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
            title={badge > 0 ? `Ждут вашего решения: ${badge} (срочные брони и анкеты)` : undefined}
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
            {/* 09.11 фаза 3: один вид счётчика во всём приложении (components/ui/Counter):
                danger-solid + белая цифра + обводка цветом фона, не коричневое пятно. */}
            <Counter value={badge} style={{ position: 'absolute', top: 4, left: 'calc(50% + 6px)' }} />
        </NavLink>
    );
}
