import { useEffect, useState } from 'react';
import { Download, Share, X, ArrowDown } from 'lucide-react';

const DISMISS_KEY = 'unbox.mobile.installDismissedAt';
const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000; // remind a week later

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Encourage adding the mobile cabinet to the home screen.
 *
 * Three platforms, three flows:
 *   - Android Chrome / Edge / Samsung: catches `beforeinstallprompt`, shows
 *     "Установить" button that triggers the native dialog.
 *   - iOS Safari: there's no programmatic install — show a hint pointing
 *     at the share sheet ("Поделиться → На экран Домой").
 *   - Already installed (display-mode: standalone) or recently dismissed:
 *     render nothing.
 */
export function InstallBanner() {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [hidden, setHidden] = useState(true);
    const [hint, setHint] = useState<null | 'ios' | 'samsung'>(null);
    const [helpOpen, setHelpOpen] = useState(false);

    useEffect(() => {
        // Suppress if installed (running in standalone) or recently dismissed.
        const inStandalone = window.matchMedia('(display-mode: standalone)').matches
            || (window.navigator as any).standalone === true;
        if (inStandalone) return;

        const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
        if (dismissedAt && Date.now() - dismissedAt < DISMISS_TTL_MS) return;

        const onPrompt = (e: Event) => {
            e.preventDefault();
            setDeferred(e as BeforeInstallPromptEvent);
            setHidden(false);
        };
        window.addEventListener('beforeinstallprompt', onPrompt);

        // UA-based fallback for browsers that don't fire beforeinstallprompt
        // properly. Samsung Browser sometimes triggers Play Protect when its
        // WebAPK builder runs without a SW — safer to push users into the
        // browser's own "Add to home screen" menu where the SW path produces
        // a clean WebAPK.
        const ua = window.navigator.userAgent;
        const isIos = /iPad|iPhone|iPod/.test(ua) && !/Chrome|CriOS|FxiOS/.test(ua);
        const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
        const isSamsung = /SamsungBrowser/.test(ua);
        if (isIos && isSafari) {
            setHint('ios');
            setHidden(false);
        } else if (isSamsung) {
            setHint('samsung');
            setHidden(false);
        }

        return () => window.removeEventListener('beforeinstallprompt', onPrompt);
    }, []);

    const dismiss = () => {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setHidden(true);
    };

    const install = async () => {
        if (!deferred) return;
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        if (outcome === 'accepted') localStorage.removeItem(DISMISS_KEY);
        else localStorage.setItem(DISMISS_KEY, String(Date.now()));
        setHidden(true);
        setDeferred(null);
    };

    if (hidden) return null;

    const subText = hint === 'ios'
        ? 'Тапни сюда — покажу как (за 3 шага)'
        : hint === 'samsung'
            ? 'Тапни сюда — покажу как (за 3 шага)'
            : 'Откроется как приложение, без рамок браузера';

    const showInstallButton = !hint && deferred;

    return (
        <>
            <div
                onClick={hint ? () => setHelpOpen(true) : undefined}
                style={{
                    margin: '12px 16px 0',
                    background: '#0E0E0E',
                    color: '#fff',
                    borderRadius: 14,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    cursor: hint ? 'pointer' : 'default',
                }}
            >
                <div style={{
                    width: 38, height: 38,
                    borderRadius: 10,
                    background: 'rgba(255,255,255,0.12)',
                    display: 'grid', placeItems: 'center',
                    flexShrink: 0,
                }}>
                    {hint ? <Share size={18} /> : <Download size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.2 }}>
                        Поставь на главный экран
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75, marginTop: 2, lineHeight: 1.3 }}>
                        {subText}
                    </div>
                </div>
                {showInstallButton && (
                    <button
                        onClick={(e) => { e.stopPropagation(); install(); }}
                        style={{
                            background: '#fff',
                            color: '#0E0E0E',
                            border: 'none',
                            borderRadius: 10,
                            padding: '8px 14px',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                    >
                        Установить
                    </button>
                )}
                <button
                    onClick={(e) => { e.stopPropagation(); dismiss(); }}
                    aria-label="Закрыть"
                    style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'rgba(255,255,255,0.6)',
                        padding: 4,
                        flexShrink: 0,
                    }}
                >
                    <X size={16} />
                </button>
            </div>

            {helpOpen && hint && (
                <InstallHelpSheet hint={hint} onClose={() => setHelpOpen(false)} />
            )}
        </>
    );
}

/**
 * Step-by-step bottom sheet for browsers that can't programmatically install
 * (iOS Safari) or where the WebAPK path needs the user to use the browser
 * menu (Samsung Internet). Plain text-only instructions are too easy to miss
 * — admins kept tapping the icon on the banner expecting it to be the
 * install button. Here each step is a numbered card with a visual cue
 * pointing at the actual control they need to use.
 */
function InstallHelpSheet({ hint, onClose }: { hint: 'ios' | 'samsung'; onClose: () => void }) {
    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.6)',
                zIndex: 220,
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%',
                    maxWidth: 480,
                    background: '#fff',
                    borderRadius: '20px 20px 0 0',
                    padding: 22,
                    paddingBottom: 'calc(22px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    maxHeight: '85vh',
                    overflow: 'auto',
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h3 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
                            Поставь Unbox на главный экран
                        </h3>
                        <p style={{ fontSize: 13, color: '#666', margin: '6px 0 0' }}>
                            Откроется как настоящее приложение, без рамок браузера.
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Закрыть"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#666', padding: 4 }}
                    >
                        <X size={22} />
                    </button>
                </div>

                {hint === 'ios' ? (
                    <>
                        <Step
                            n={1}
                            title="Найди кнопку «Поделиться» внизу Safari"
                            body={
                                <span>Это квадратик со стрелкой вверх (<span style={{ display: 'inline-flex', verticalAlign: 'middle', width: 22, height: 22, borderRadius: 4, background: '#F4F4F2', alignItems: 'center', justifyContent: 'center' }}>􀈂</span>) в нижней панели браузера.</span>
                            }
                        />
                        <Step
                            n={2}
                            title={'Прокрути меню вниз и выбери «На экран „Домой"»'}
                            body="Если такого пункта нет — листай ниже, он внизу списка."
                        />
                        <Step
                            n={3}
                            title="Тапни «Добавить» в правом верхнем углу"
                            body="На главном экране появится иконка Unbox. Открывай её — это твой мобильный кабинет."
                        />
                        <ArrowHint label="Кнопка «Поделиться» — внизу экрана, тыкаем туда" />
                    </>
                ) : (
                    <>
                        <Step
                            n={1}
                            title="Открой меню Samsung Internet"
                            body={'Это три полоски (≡) в правом нижнем углу.'}
                        />
                        <Step
                            n={2}
                            title="Выбери «Добавить страницу на»"
                            body="Появится подменю с вариантами."
                        />
                        <Step
                            n={3}
                            title="Тапни «Главный экран»"
                            body="Если будет диалог Play Защиты — выбери «Все равно установить» или открой ту же ссылку в Chrome (там процесс чище)."
                        />
                    </>
                )}

                <button
                    onClick={onClose}
                    style={{
                        background: '#0E0E0E',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 12,
                        padding: '14px 18px',
                        fontSize: 14, fontWeight: 700,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                        marginTop: 6,
                    }}
                >
                    Понятно
                </button>
            </div>
        </div>
    );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
    return (
        <div style={{
            background: '#F4F4F2',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            gap: 12,
        }}>
            <div style={{
                flexShrink: 0,
                width: 28, height: 28,
                borderRadius: 999,
                background: '#0E0E0E',
                color: '#fff',
                display: 'grid', placeItems: 'center',
                fontSize: 14, fontWeight: 700,
            }}>
                {n}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
                    {title}
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.45 }}>
                    {body}
                </div>
            </div>
        </div>
    );
}

/**
 * Big arrow pointing down toward Safari's bottom toolbar so the user's
 * eye lands on the actual share button. Stickier than text alone.
 */
function ArrowHint({ label }: { label: string }) {
    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 6,
            padding: '8px 0',
            color: '#0E0E0E',
        }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#666', textAlign: 'center' }}>
                {label}
            </div>
            <ArrowDown size={28} strokeWidth={2.4} />
            <div style={{ fontSize: 11, color: '#999' }}>↓ ↓ ↓</div>
        </div>
    );
}
