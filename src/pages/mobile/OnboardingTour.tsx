import { useEffect, useLayoutEffect, useState } from 'react';
import { ArrowRight, Calendar, CheckCircle2, Compass, Home, Search, Smartphone, User as UserIcon, X } from 'lucide-react';
import { useUserStore } from '../../store/userStore';

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

const STEPS: Step[] = [
    {
        icon: Compass,
        title: 'Добро пожаловать в мобильный кабинет Unbox',
        pill: 'Знакомство',
        body: (
            <>
                Это Ваш основной инструмент с телефона: <b>бронь кабинетов, Ваши сессии,
                CRM-клиенты</b>. Покажем за полминуты, как тут всё устроено — тапайте «Дальше».
            </>
        ),
    },
    {
        icon: Home,
        title: 'Сегодня',
        pill: '1 из 5 · Главная',
        targetSelector: '[data-tour="tab-today"]',
        body: (
            <>
                Здесь Вы попадаете по умолчанию. На главной — <b>ближайшие сессии</b>, кнопка
                «Забронировать», шорткаты «Повторить из последних» по Вашим последним кейсам.
                Если есть незакрытые задачи или предупреждение по балансу — увидите их сверху.
            </>
        ),
    },
    {
        icon: Calendar,
        title: 'Мои брони',
        pill: '2 из 5 · История',
        targetSelector: '[data-tour="tab-bookings"]',
        body: (
            <>
                Все Ваши брони — будущие, серии и прошедшие. <b>Свайп влево</b> на карточке —
                быстрые действия (отмена / пересдача). <b>Тап</b> — детальное окно с переносом,
                продлением, привязкой клиента из CRM.
            </>
        ),
    },
    {
        icon: Search,
        title: 'Свободно',
        pill: '3 из 5 · Поиск',
        targetSelector: '[data-tour="tab-find"]',
        body: (
            <>
                Найти свободный кабинет в <b>три тапа</b>: <i>когда → сколько → где</i>.
                Поддерживается <b>любимый кабинет</b> (выставляется в профиле), кастомные даты
                и разные типы помещений. Внизу — переход в полный календарь.
            </>
        ),
    },
    {
        icon: UserIcon,
        title: 'Я',
        pill: '4 из 5 · Профиль',
        targetSelector: '[data-tour="tab-me"]',
        body: (
            <>
                Баланс, абонемент, бонусы. Привязка Telegram-бота. Любимый кабинет. Контакты
                и связь с админом. Отсюда же — быстрый переход в <b>CRM</b> и (для админов)
                в <b>Админку</b>. И эту экскурсию можно запустить заново.
            </>
        ),
    },
    {
        icon: Smartphone,
        title: 'Поставьте на главный экран',
        pill: '5 из 5 · PWA',
        body: (
            <>
                На «Сегодня» сверху Вы видите чёрный баннер «Поставь на главный экран» — тапните,
                там пошаговая инструкция. Откроется как настоящее приложение: <b>без рамок
                браузера, иконкой на хоумскрине</b>. Так удобнее всего.
            </>
        ),
    },
];

export function OnboardingTour({
    onClose,
    steps,
    storagePrefix,
}: {
    onClose: () => void;
    /** Override steps to repurpose the runner for a different workspace
     *  (e.g. /m/crm or /m/admin). Defaults to the cabinet (/m) STEPS. */
    steps?: Step[];
    /** Override localStorage key prefix so each workspace tracks its own
     *  "tour seen" flag. Defaults to the cabinet prefix. */
    storagePrefix?: string;
}) {
    const { currentUser } = useUserStore();
    const [step, setStep] = useState(0);
    const allSteps = steps && steps.length > 0 ? steps : STEPS;
    const total = allSteps.length;
    const current = allSteps[step];
    const Icon = current.icon;

    // Lock body scroll while tour is open so the page underneath doesn't
    // wander when the user taps "Дальше" on a long step.
    useEffect(() => {
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, []);

    const finish = () => {
        markTourCompleted(currentUser?.id, storagePrefix);
        onClose();
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 300,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
                // No backdrop here — spotlight overlay below handles dimming
                // so the highlighted element punches through cleanly.
            }}
        >
            <Spotlight selector={current.targetSelector} onClickBackdrop={finish} />

            {/* Skip — small unobtrusive top-right button */}
            <button
                onClick={finish}
                aria-label="Пропустить"
                style={{
                    position: 'absolute',
                    top: 'calc(16px + env(safe-area-inset-top, 0px))',
                    right: 16,
                    background: 'rgba(255,255,255,0.15)',
                    border: 'none',
                    borderRadius: 999,
                    color: '#fff',
                    fontFamily: 'inherit',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '8px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    backdropFilter: 'blur(4px)',
                    zIndex: 302,
                }}
            >
                <X size={14} /> Пропустить
            </button>

            {/* Card */}
            <div
                style={{
                    position: 'relative',
                    background: '#fff',
                    color: '#0E0E0E',
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
                    zIndex: 302,
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
                                background: i <= step ? '#0E0E0E' : 'rgba(0,0,0,0.10)',
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
                        background: '#E8F0EF',
                        color: '#1C3835',
                        display: 'grid', placeItems: 'center',
                    }}>
                        <Icon size={22} />
                    </div>
                    {current.pill && (
                        <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.10em',
                            textTransform: 'uppercase',
                            color: '#666',
                        }}>
                            {current.pill}
                        </div>
                    )}
                </div>

                {/* Title */}
                <h2 style={{
                    fontSize: 22,
                    fontWeight: 700,
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
                    color: '#444',
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
                    {step > 0 ? (
                        <button
                            onClick={() => setStep(s => s - 1)}
                            style={{
                                background: 'transparent',
                                color: '#666',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                padding: '12px 4px',
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
                                background: '#0E0E0E',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 12,
                                padding: '12px 22px',
                                fontSize: 14,
                                fontWeight: 700,
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
                                background: '#0E0E0E',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 12,
                                padding: '12px 22px',
                                fontSize: 14,
                                fontWeight: 700,
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
                    background: 'rgba(0,0,0,0.75)',
                    zIndex: 301,
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
                    zIndex: 301,
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
                    boxShadow: '0 0 0 200vmax rgba(0,0,0,0.75), 0 0 0 3px rgba(255,255,255,0.9)',
                    transition: 'top 200ms ease, left 200ms ease, width 200ms ease, height 200ms ease',
                    zIndex: 301,
                }}
            />
        </>
    );
}
