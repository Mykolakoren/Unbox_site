import { useLayoutEffect, useState } from 'react';
import { useScrollLock } from './useScrollLock';
import { ArrowRight, Calendar, CheckCircle2, Home, Search, User as UserIcon } from 'lucide-react';
import { useUserStore } from '../../store/userStore';
import { COLOR, FONT, Z } from '../../design/tokens';

/**
 * First-visit onboarding tour for /m.
 *
 * Why this exists: we've iterated on the mobile UI a lot during beta, and
 * specialists who haven't logged in for a while find new tabs, new
 * workspaces (CRM/Админка), new gestures (swipe, pull-to-refresh). The
 * 30-second walkthrough below puts everyone on the same map before they
 * start working.
 *
 * Mechanics:
 *   - Stored per-user in localStorage as `unbox.mobile.tour.<version>.<userId>`.
 *     Bumping `TOUR_VERSION` re-fires the tour for everyone — useful when
 *     a major UX change ships and we want users to see what's new.
 *   - On first /m visit (when no marker found) the tour auto-opens.
 *   - The /m/me profile has a "Show tour again" button to replay it.
 *   - The url query `?tour=1` also forces it (handy for admins previewing
 *     before opening to everyone).
 *   - Spotlight effect via `targetSelector` on each step — uses inverse
 *     box-shadow trick to dim everything except the highlighted element.
 *
 * No third-party tour libraries — minimalist, matches our design system.
 */

const TOUR_VERSION = 'v2';
const STORAGE_PREFIX = `unbox.mobile.tour.${TOUR_VERSION}.`;

function tourKey(userId: string | undefined, prefix = STORAGE_PREFIX) {
    return userId ? prefix + userId : null;
}

export function hasCompletedTour(userId: string | undefined, prefix?: string): boolean {
    const k = tourKey(userId, prefix);
    if (!k || typeof window === 'undefined') return true;
    return !!localStorage.getItem(k);
}

export function markTourCompleted(userId: string | undefined, prefix?: string) {
    const k = tourKey(userId, prefix);
    if (k && typeof window !== 'undefined') localStorage.setItem(k, String(Date.now()));
}

export function resetTour(userId: string | undefined, prefix?: string) {
    const k = tourKey(userId, prefix);
    if (k && typeof window !== 'undefined') localStorage.removeItem(k);
}

/** Steps. Each is a small screen the user reads + clicks "Дальше". */
export interface Step {
    icon: React.ElementType;
    title: string;
    body: React.ReactNode;
    /** Bottom badge — what they'll be doing on this step. */
    pill?: string;
    /** Optional CSS selector for the element to spotlight on this step. */
    targetSelector?: string;
}

// Волна 2 (G4-11): шаги по ролям. Раньше тур был один на всех, и обычный
// клиент читал про «CRM-клиентов», «незакрытые задачи» и «привязку клиента».
// Номер шага («2 из 3») тур считает сам — в подписях его нет.

/** Клиент: три шага — главное, как найти время и что делать с бронью. */
const CLIENT_STEPS: Step[] = [
    {
        icon: Home,
        title: 'Сегодня — ваша ближайшая встреча',
        pill: 'Главная',
        targetSelector: '[data-tour="tab-today"]',
        body: (
            <>
                Сверху — <b>ближайшая бронь</b>: когда, где и как оплачена. Там же «Маршрут»
                и «Детали». Ниже — кнопка «Забронировать кабинет» и следующие брони.
            </>
        ),
    },
    {
        icon: Search,
        title: 'Свободно — кабинет за три шага',
        pill: 'Поиск',
        targetSelector: '[data-tour="tab-find"]',
        body: (
            <>
                Выберите <i>когда → сколько → где</i> и нажмите на свободное окно.
                Оплату и время проверите на следующем экране.
            </>
        ),
    },
    {
        icon: Calendar,
        title: 'Мои брони',
        pill: 'Брони',
        targetSelector: '[data-tour="tab-bookings"]',
        body: (
            <>
                Все ваши брони по дням. <b>Нажмите</b> на бронь — перенести, пересдать или отменить.
                <b> Свайп влево</b> — то же быстрее.
            </>
        ),
    },
];

/** Специалист и администратор: те же шаги + где CRM и профиль. */
const SPECIALIST_STEPS: Step[] = [
    CLIENT_STEPS[0],
    CLIENT_STEPS[1],
    {
        ...CLIENT_STEPS[2],
        body: (
            <>
                Все ваши брони по дням и серии. <b>Нажмите</b> на бронь — перенести, пересдать,
                отменить или привязать клиента из CRM. <b>Свайп влево</b> — быстрые действия.
            </>
        ),
    },
    {
        icon: UserIcon,
        title: 'Я',
        pill: 'Профиль',
        targetSelector: '[data-tour="tab-me"]',
        body: (
            <>
                Баланс, абонемент, бонусы, уведомления в Telegram. Отсюда же — вход в <b>CRM</b>
                {' '}и (для администраторов) в <b>Админку</b>. Этот обзор можно запустить заново.
            </>
        ),
    },
];

/** Шаги по умолчанию для /m: клиенту — короткие, специалисту — с CRM. */
function defaultSteps(role: string | undefined): Step[] {
    return role && role !== 'user' ? SPECIALIST_STEPS : CLIENT_STEPS;
}

/** «1 из 5 · Главная» в подписях старых туров (CRM, админка) → «Главная»:
 *  номер шага тур рисует сам, из числа шагов. */
function pillText(pill: string | undefined): string | undefined {
    if (!pill) return undefined;
    return pill.replace(/^\s*\d+\s+из\s+\d+\s*·?\s*/, '') || undefined;
}

export function OnboardingTour({
    onClose,
    steps,
    storagePrefix,
}: {
    onClose: () => void;
    /** Override steps to repurpose the runner for a different workspace
     *  (e.g. /m/crm or /m/admin). Defaults to the cabinet (/m) steps by role. */
    steps?: Step[];
    /** Override localStorage key prefix so each workspace tracks its own
     *  "tour seen" flag. Defaults to the cabinet prefix. */
    storagePrefix?: string;
}) {
    const { currentUser } = useUserStore();
    const [step, setStep] = useState(0);
    const allSteps = steps && steps.length > 0 ? steps : defaultSteps(currentUser?.role);
    const total = allSteps.length;
    const current = allSteps[step];
    const Icon = current.icon;

    // Lock scroll while tour is open — ref-counted общий лок (раньше тут
    // был inline body.overflow с capture/restore, который на первом запуске
    // мог залипнуть и лента переставала скроллиться).
    useScrollLock();

    const finish = () => {
        markTourCompleted(currentUser?.id, storagePrefix);
        onClose();
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: Z.tour,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                fontFamily: FONT.sans,
                // No backdrop here — spotlight overlay below handles dimming
                // so the highlighted element punches through cleanly.
            }}
        >
            <Spotlight selector={current.targetSelector} onClickBackdrop={finish} />

            {/* Card */}
            <div
                style={{
                    position: 'relative',
                    background: COLOR.card,
                    color: COLOR.ink,
                    borderRadius: '24px 24px 0 0',
                    padding: '24px 22px',
                    paddingBottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
                    width: '100%',
                    maxWidth: 480,
                    margin: '0 auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 14,
                    animation: 'tourSlideUp 280ms ease-out',
                    zIndex: Z.tour + 2,
                    // Lift the card above the bottom-tab bar so spotlight on a
                    // tab is still visible above the card. The card sits at
                    // the very bottom of the viewport; with tabs ~72px tall,
                    // leaving extra bottom margin pushes the card up.
                    marginBottom: current.targetSelector?.startsWith('[data-tour="tab-')
                        ? 'calc(72px + env(safe-area-inset-bottom, 0px))'
                        : 0,
                }}
            >
                {/* Progress dots */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                    {allSteps.map((_, i) => (
                        <div
                            key={i}
                            style={{
                                flex: 1,
                                height: 4,
                                borderRadius: 2,
                                background: i <= step ? COLOR.ink : COLOR.ink10,
                                transition: 'background 200ms',
                            }}
                        />
                    ))}
                </div>

                {/* Icon + pill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{
                        width: 42, height: 42,
                        borderRadius: 12,
                        background: COLOR.accentSoft,
                        color: COLOR.accentInk,
                        display: 'grid', placeItems: 'center',
                    }}>
                        <Icon size={22} />
                    </div>
                    <div style={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        color: COLOR.ink60,
                    }}>
                        {step + 1} из {total}{pillText(current.pill) ? ` · ${pillText(current.pill)}` : ''}
                    </div>
                </div>

                {/* Title */}
                <h2 style={{
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: '-0.01em',
                    lineHeight: 1.2,
                    margin: 0,
                }}>
                    {current.title}
                </h2>

                {/* Body */}
                <p style={{
                    fontSize: 14,
                    lineHeight: 1.5,
                    color: COLOR.ink80,
                    margin: 0,
                }}>
                    {current.body}
                </p>

                {/* Footer */}
                <div style={{
                    display: 'flex',
                    gap: 8,
                    marginTop: 8,
                    alignItems: 'center',
                }}>
                    {/* «Пропустить» — внизу, рядом с «Дальше» (раньше висел сверху
                        и наезжал на баннер установки). */}
                    {step < total - 1 && (
                        <button
                            onClick={finish}
                            style={{
                                background: 'transparent',
                                color: COLOR.ink60,
                                border: 'none',
                                fontSize: 14,
                                fontWeight: 600,
                                minHeight: 44,
                                padding: '0 4px',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                            }}
                        >
                            Пропустить
                        </button>
                    )}
                    {step > 0 ? (
                        <button
                            onClick={() => setStep(s => s - 1)}
                            style={{
                                background: 'transparent',
                                color: COLOR.ink60,
                                border: 'none',
                                fontSize: 14,
                                fontWeight: 600,
                                minHeight: 44,
                                padding: '0 4px',
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                            }}
                        >
                            ← Назад
                        </button>
                    ) : (
                        <div />
                    )}
                    <div style={{ flex: 1 }} />
                    {step < total - 1 ? (
                        <button
                            onClick={() => setStep(s => s + 1)}
                            style={{
                                background: COLOR.ink,
                                color: COLOR.onInk,
                                border: 'none',
                                borderRadius: 12,
                                minHeight: 44,
                                padding: '0 22px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                        >
                            Дальше
                            <ArrowRight size={16} />
                        </button>
                    ) : (
                        <button
                            onClick={finish}
                            style={{
                                background: COLOR.ink,
                                color: COLOR.onInk,
                                border: 'none',
                                borderRadius: 12,
                                minHeight: 44,
                                padding: '0 22px',
                                fontSize: 14,
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                        >
                            <CheckCircle2 size={16} />
                            Готово
                        </button>
                    )}
                </div>
            </div>

            <style>{`
                @keyframes tourSlideUp {
                    from { transform: translateY(60px); opacity: 0; }
                    to   { transform: translateY(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
}

/**
 * Inverse-cutout dimming overlay.
 *
 * When `selector` is set we measure the element's bounding rect and render
 * a transparent "hole" of that size with a huge box-shadow that paints the
 * rest of the screen ~70% black. A glowing white border around the hole
 * directs the eye to the target.
 *
 * Without a target, falls back to a plain semi-transparent backdrop so the
 * card still stands out against the page underneath.
 */
function Spotlight({ selector, onClickBackdrop }: { selector?: string; onClickBackdrop: () => void }) {
    const [rect, setRect] = useState<DOMRect | null>(null);

    useLayoutEffect(() => {
        if (!selector) {
            setRect(null);
            return;
        }
        const measure = () => {
            const el = document.querySelector(selector) as HTMLElement | null;
            if (!el) {
                setRect(null);
                return;
            }
            setRect(el.getBoundingClientRect());
        };
        measure();
        // Re-measure on orientation change / virtual keyboard / scroll.
        const onResize = () => measure();
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        window.addEventListener('scroll', onResize, true);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
            window.removeEventListener('scroll', onResize, true);
        };
    }, [selector]);

    if (!selector || !rect) {
        // Plain backdrop, captures taps to dismiss only on the card edges
        // (the tour itself blocks the rest of the UI by being z-indexed
        // above the page).
        return (
            <div
                onClick={onClickBackdrop}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: `${COLOR.ink}BF`,
                    zIndex: Z.tour + 1,
                }}
            />
        );
    }

    // Pad the cutout a bit so the highlighted element gets some breathing
    // room — looks like a halo, not a tight crop.
    const pad = 6;
    return (
        <>
            <div
                onClick={onClickBackdrop}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'transparent',
                    zIndex: Z.tour + 1,
                }}
            />
            <div
                style={{
                    position: 'fixed',
                    top: rect.top - pad,
                    left: rect.left - pad,
                    width: rect.width + pad * 2,
                    height: rect.height + pad * 2,
                    borderRadius: 12,
                    pointerEvents: 'none',
                    // The inset shadow draws a glowing rim; the wide outset
                    // shadow paints the rest of the screen dim. The viewport
                    // size cap (200vmax) ensures coverage on any device.
                    boxShadow: `0 0 0 200vmax ${COLOR.ink}BF, 0 0 0 3px ${COLOR.onInk}E6`,
                    transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease',
                    zIndex: Z.tour + 1,
                }}
            />
        </>
    );
}
