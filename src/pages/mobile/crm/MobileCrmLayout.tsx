import { NavLink, Outlet, useNavigate, useLocation, useNavigationType } from 'react-router-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
    CalendarDays, Check, ChevronDown, ClipboardList, FileText, Users, Wallet,
} from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { crmApi } from '../../../api/crm';
import type { MobileCrmOutletContext } from './crmDataVersion';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileCrmTour, CRM_TOUR_PREFIX } from './MobileCrmTour';
import { NotificationsBell } from '../NotificationsBell';
import { loginPathWithRedirect } from '../../../utils/loginRedirect';
import { forceUnlockScroll } from '../useScrollLock';
import { canUsePsyCrm, isBookingAdmin } from '../crmAccess';
// Wave 1: шрифт IBM Plex и общие токены, как в клиентской оболочке /m.
import { COLOR, FONT, TEXT, Z } from '../../../design/tokens';
import { useTouchDensity } from '../../../hooks/useTouchDensity';
import { Sheet } from '../../../components/ui/Sheet';
import { Skeleton, SkeletonList } from '../../../components/ui/Skeleton';

/**
 * Mobile CRM shell — separate workspace from /m (cabinet).
 *
 * Волна 3 (решение В4): вкладки Сегодня · Клиенты · Сессии · Финансы ·
 * Заметки. «Анкета» и «Часы приёма» — в переключателе «Psy-CRM ▾» в шапке
 * (X2-07): он же уводит в «Мой кабинет» и, по роли, в «Админку». Стрелки
 * «←» в шапке больше нет — она путалась со стрелкой «назад» в карточке.
 * При переходе на новый экран прокрутка сбрасывается наверх, при «назад» —
 * восстанавливается (X5-08). Пока грузим пользователя — оболочка со
 * скелетоном, а не одинокий спиннер (X5-05).
 *
 * Access gate: как на сервере — specialist / owner / senior_admin или право
 * psy_crm.access (см. ../crmAccess.ts). Админ без CRM → /m/admin, остальные → /m.
 */
export function MobileCrmLayout() {
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

    // X5-08: прокручивается документ. Новый экран — сверху, «назад» —
    // туда, где был. Позиции помним по ключу записи истории.
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
        // Только смена экрана: ?date= на «Сегодня» прокрутку не трогает.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname]);

    useEffect(() => {
        const token = localStorage.getItem('token');
        // На вход — с возвратом на этот же экран CRM.
        const toLogin = () => navigate(loginPathWithRedirect(location.pathname + location.search));
        if (!token) { toLogin(); return; }
        if (!currentUser) fetchCurrentUser().catch(toLogin);
    }, [currentUser, fetchCurrentUser, navigate, location.pathname, location.search]);

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

    // Автозавершение прошедших сессий — как делает десктопный дашборд
    // (CrmDashboard.tsx). Без него у тех, кто ведёт CRM только с телефона
    // и не жмёт «Прошла», прошедшие сессии висели «запланированными», и в
    // «Финансах» / карточке клиента долг был меньше реального (долг
    // считается только по завершённым). Запускаем при входе и когда
    // приложение снова открыли (PWA живёт днями), не чаще раза в 10 минут.
    // Если что-то закрылось — поднимаем crmDataVersion, экраны перечитают данные.
    const [crmDataVersion, setCrmDataVersion] = useState(0);
    const lastAutoCompleteAt = useRef(0);
    // Волна 2 (X2-ia-navigation-M3): вход в CRM — по тому же правилу, что на
    // сервере (require_specialist). Раньше пускали любого админа, а сервер
    // отвечал ему 403: пустая «Сегодня» без клиентов и сессий.
    const canUseCrm = canUsePsyCrm(currentUser);
    useEffect(() => {
        if (!canUseCrm) return;
        const run = () => {
            if (Date.now() - lastAutoCompleteAt.current < AUTO_COMPLETE_EVERY_MS) return;
            lastAutoCompleteAt.current = Date.now();
            crmApi.autoCompleteSessions()
                .then(r => { if ((r?.autoCompleted ?? 0) > 0) setCrmDataVersion(v => v + 1); })
                .catch(() => { lastAutoCompleteAt.current = 0; });
        };
        run();
        const onVisible = () => { if (document.visibilityState === 'visible') run(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, [canUseCrm]);
    const outletContext = useMemo<MobileCrmOutletContext>(() => ({ crmDataVersion }), [crmDataVersion]);

    if (!currentUser) {
        // X5-05: сразу оболочка с вкладками и скелетоном — экран не прыгает.
        return (
            <div style={{ minHeight: '100vh', background: COLOR.sunken, display: 'flex', justifyContent: 'center' }}>
                <div style={{
                    width: '100%', maxWidth: 480, minHeight: '100vh', background: COLOR.card,
                    fontFamily: FONT.sans, color: COLOR.ink,
                }}>
                    <div style={headerStyle}>
                        <span style={{ ...switcherStyle, cursor: 'default' }}>Psy-CRM</span>
                    </div>
                    <div role="status" aria-busy="true" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <span className="sr-only">Загружаем CRM…</span>
                        <Skeleton height={32} width="45%" />
                        <Skeleton height={56} />
                        <SkeletonList count={3} label="Загружаем сессии" cardHeight={72} />
                    </div>
                </div>
                <TabBar />
            </div>
        );
    }

    if (!canUseCrm) {
        // 2026-06-02: bounce to /m (mobile home) instead of /dashboard
        // (десктоп-в-мобиле) — последовательно с тем, что /m теперь основной
        // на телефоне для всех ролей.
        // Админ без Psy-CRM — в свою мобильную админку, остальные — на /m.
        navigate(isBookingAdmin(currentUser) ? '/m/admin' : '/m', { replace: true });
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
                {/* Шапка рабочего места: «Psy-CRM ▾» и уведомления.
                    В standalone-режиме iOS (сайт добавлен на экран «Домой»,
                    status-bar black-translucent) контент начинается ПОД
                    чёлкой — без safe-area-отступа шапка целиком пряталась
                    под неё (скрин владельца 31.08). Тёмный фон заливает
                    зону чёлки, текст начинается ниже — как в нативных
                    приложениях. В обычном Safari env() = 0, ничего не
                    меняется. */}
                <div style={headerStyle}>
                    {/* X2-07: подписанный переключатель разделов 44 px вместо
                        стрелки «←», которая выглядела как «назад». */}
                    <button
                        type="button"
                        onClick={() => setSwitcherOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={switcherOpen}
                        style={switcherStyle}
                    >
                        Psy-CRM
                        <ChevronDown size={16} aria-hidden="true" />
                    </button>
                    <div style={{ flex: 1 }} />
                    <NotificationsBell color={COLOR.onInk} />
                    {/* Wave 1: кнопка «десктоп» убрана, как в админке 02.06 и в
                        /m/me (аудит G6-04, X2-03). */}
                </div>

                <main data-mobile-scroll style={{ flex: 1, overflow: 'auto' }}>
                    <div key={location.pathname} className="mobile-page">
                        <Outlet context={outletContext} />
                    </div>
                </main>
            </div>

            <TabBar />

            <SectionSwitcher
                open={switcherOpen}
                onClose={() => setSwitcherOpen(false)}
                isAdmin={isBookingAdmin(currentUser)}
                pathname={location.pathname}
                onGo={(to) => { setSwitcherOpen(false); navigate(to); }}
            />

            {tourOpen && <MobileCrmTour onClose={() => setTourOpen(false)} />}
        </div>
    );
}

const AUTO_COMPLETE_EVERY_MS = 10 * 60 * 1000;

const headerStyle: React.CSSProperties = {
    // В standalone-режиме iOS контент начинается под чёлкой — тёмный фон
    // заливает её, кнопки начинаются ниже (скрин владельца 31.08).
    background: 'var(--color-ink)',
    color: 'var(--color-on-ink)',
    padding: 'calc(6px + env(safe-area-inset-top, 0px)) 12px 6px',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
};

const switcherStyle: React.CSSProperties = {
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
};

/** Нижние вкладки (В4): Сегодня · Клиенты · Сессии · Финансы · Заметки. */
function TabBar() {
    return (
        <nav aria-label="Разделы CRM" style={{
            position: 'fixed',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: '100%',
            maxWidth: 480,
            background: COLOR.card,
            borderTop: `1px solid ${COLOR.ink08}`,
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            zIndex: Z.nav,
        }}>
            <TabLink to="/m/crm/today" icon={CalendarDays} label="Сегодня" />
            <TabLink to="/m/crm/clients" icon={Users} label="Клиенты" />
            <TabLink to="/m/crm/sessions" icon={ClipboardList} label="Сессии" />
            <TabLink to="/m/crm/finance" icon={Wallet} label="Финансы" />
            <TabLink to="/m/crm/notes" icon={FileText} label="Заметки" />
        </nav>
    );
}

/**
 * «Psy-CRM ▾» (X2-07): куда перейти. Мой кабинет · CRM · Админка (только
 * по роли — как на сервере, isBookingAdmin) · Анкета · Часы приёма.
 * Текущий раздел отмечен галочкой.
 */
function SectionSwitcher({ open, onClose, isAdmin, pathname, onGo }: {
    open: boolean;
    onClose: () => void;
    isAdmin: boolean;
    pathname: string;
    onGo: (to: string) => void;
}) {
    const inProfile = pathname.startsWith('/m/crm/profile');
    const inSchedule = pathname.startsWith('/m/crm/schedule');
    const items: { to: string; label: string; hint: string; current: boolean }[] = [
        { to: '/m/crm/today', label: 'CRM', hint: 'Сессии, клиенты, оплаты', current: !inProfile && !inSchedule },
        ...(isAdmin ? [{ to: '/m/admin', label: 'Админка', hint: 'Брони, касса, пользователи', current: false }] : []),
        { to: '/m/crm/profile', label: 'Анкета', hint: 'Как вас видят клиенты в каталоге', current: inProfile },
        { to: '/m/crm/schedule', label: 'Часы приёма', hint: 'Когда к вам можно записаться на сайте', current: inSchedule },
    ];
    return (
        <Sheet open={open} onClose={onClose} title="Куда перейти">
            <nav aria-label="Разделы" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Выход из CRM в личный кабинет — первым, как раньше кнопка в шапке. */}
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
