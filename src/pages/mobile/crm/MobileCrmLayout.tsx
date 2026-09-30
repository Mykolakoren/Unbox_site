import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, CalendarDays, FileText, Users, UserCircle, Wallet } from 'lucide-react';
import { useUserStore } from '../../../store/userStore';
import { crmApi } from '../../../api/crm';
import type { MobileCrmOutletContext } from './crmDataVersion';
import { hasCompletedTour } from '../OnboardingTour';
import { MobileCrmTour, CRM_TOUR_PREFIX } from './MobileCrmTour';
import { NotificationsBell } from '../NotificationsBell';
import { loginPathWithRedirect } from '../../../utils/loginRedirect';
import { forceUnlockScroll } from '../useScrollLock';
// Wave 1: шрифт IBM Plex и общие токены, как в клиентской оболочке /m.
import { COLOR, FONT, TEXT, Z } from '../../../design/tokens';
import { useTouchDensity } from '../../../hooks/useTouchDensity';

/**
 * Mobile CRM shell — separate workspace from /m (cabinet).
 *
 * Tabs: Сегодня (today's therapy sessions) / Клиенты / Финансы / Заметки / Анкета.
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
    // Страховка, как в MobileLayout: при смене экрана снимаем лок прокрутки,
    // если шторка не сняла его сама (лок держит и html, и body).
    useEffect(() => {
        forceUnlockScroll();
    }, [location.pathname]);
    const [tourOpen, setTourOpen] = useState(false);
    useTouchDensity();

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
    const canUseCrm = !!currentUser && (
        currentUser.role === 'specialist'
        || currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || !!currentUser.isAdmin
    );
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
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: COLOR.card }}>
                <div role="status" aria-label="Загружаем" className="w-8 h-8 border-2 border-ink-20 border-t-ink rounded-full animate-spin" />
            </div>
        );
    }

    if (!canUseCrm) {
        // 2026-06-02: bounce to /m (mobile home) instead of /dashboard
        // (десктоп-в-мобиле) — последовательно с тем, что /m теперь основной
        // на телефоне для всех ролей.
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
                {/* Workspace header — tap to go back to cabinet.
                    В standalone-режиме iOS (сайт добавлен на экран «Домой»,
                    status-bar black-translucent) контент начинается ПОД
                    чёлкой — без safe-area-отступа шапка целиком пряталась
                    под неё (скрин владельца 31.08). Тёмный фон заливает
                    зону чёлки, текст начинается ниже — как в нативных
                    приложениях. В обычном Safari env() = 0, ничего не
                    меняется. */}
                <div style={{
                    background: 'var(--color-ink)',
                    color: 'var(--color-on-ink)',
                    padding: 'calc(6px + env(safe-area-inset-top, 0px)) 14px 6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                }}>
                    {/* Wave 1: голая стрелка 28×28 выглядела как «назад» и путалась
                        со стрелкой карточки клиента (аудит G6-12). Теперь это
                        подписанная кнопка 44 px — выход из CRM в личный кабинет. */}
                    <button
                        onClick={() => navigate('/m')}
                        aria-label="Мой кабинет"
                        style={{
                            background: 'rgba(250,250,247,0.12)',
                            border: 'none',
                            borderRadius: 8,
                            minHeight: 44, minWidth: 44,
                            padding: '0 10px',
                            display: 'flex', alignItems: 'center', gap: 6,
                            cursor: 'pointer',
                            color: 'var(--color-on-ink)',
                            fontFamily: 'inherit',
                            fontSize: TEXT.caption,
                            fontWeight: 600,
                        }}
                    >
                        <ArrowLeft size={16} aria-hidden="true" />
                        Кабинет
                    </button>
                    <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1 }}>
                        Psy-CRM · {currentUser.name?.split(' ')[0]}
                    </div>
                    <NotificationsBell color={COLOR.onInk} />
                    {/* Wave 1: кнопка «десктоп» убрана, как в админке 02.06 и в
                        /m/me. Она ставила sessionStorage.forceDesktop, который
                        App.tsx давно не читает, — /crm на телефоне сразу
                        возвращал в /m/crm (аудит G6-04, X2-03). */}
                </div>

                <main data-mobile-scroll style={{ flex: 1, overflow: 'auto' }}>
                    <div key={location.pathname} className="mobile-page">
                        <Outlet context={outletContext} />
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
                background: COLOR.card,
                borderTop: `1px solid ${COLOR.ink08}`,
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                zIndex: Z.nav,
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

const AUTO_COMPLETE_EVERY_MS = 10 * 60 * 1000;

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
