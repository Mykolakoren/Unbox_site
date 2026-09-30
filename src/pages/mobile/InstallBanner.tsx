import { useEffect, useState } from 'react';
import { Download, Share, X, ArrowDown } from 'lucide-react';
import { COLOR } from '../../design/tokens';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';

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

    const subText = hint
        ? 'Нажмите — покажем как, за 3 шага'
        : 'Откроется как приложение, без рамок браузера';

    const showInstallButton = !hint && deferred;

    return (
        <>
            <div
                onClick={hint ? () => setHelpOpen(true) : undefined}
                role={hint ? 'button' : undefined}
                tabIndex={hint ? 0 : undefined}
                onKeyDown={hint ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setHelpOpen(true); } } : undefined}
                style={{
                    margin: '12px 16px 0',
                    background: COLOR.ink,
                    color: COLOR.onInk,
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
                    background: `${COLOR.onInk}1F`,
                    display: 'grid', placeItems: 'center',
                    flexShrink: 0,
                }}>
                    {hint ? <Share size={18} /> : <Download size={18} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>
                        Добавьте на главный экран
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2, lineHeight: 1.3 }}>
                        {subText}
                    </div>
                </div>
                {showInstallButton && (
                    <button
                        onClick={(e) => { e.stopPropagation(); install(); }}
                        style={{
                            background: COLOR.card,
                            color: COLOR.ink,
                            border: 'none',
                            borderRadius: 10,
                            minHeight: 44,
                            padding: '0 14px',
                            fontSize: 13,
                            fontWeight: 600,
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
                        color: `${COLOR.onInk}B3`,
                        // Цель касания 44×44; отрицательный отступ — плашка не растёт.
                        width: 44, height: 44,
                        margin: '-10px -10px -10px 0',
                        padding: 0,
                        display: 'grid', placeItems: 'center',
                        flexShrink: 0,
                    }}
                >
                    <X size={18} />
                </button>
            </div>

            {hint && (
                <InstallHelpSheet open={helpOpen} hint={hint} onClose={() => setHelpOpen(false)} />
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
function InstallHelpSheet({ open, hint, onClose }: { open: boolean; hint: 'ios' | 'samsung'; onClose: () => void }) {
    // Wave 1: общая шторка Sheet (Esc, свайп вниз, фокус, выше нижнего меню).
    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Добавьте Unbox на главный экран"
            description="Откроется как настоящее приложение, без рамок браузера."
            footer={<Button block onClick={onClose}>Понятно</Button>}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {hint === 'ios' ? (
                    <>
                        <Step
                            n={1}
                            title="Найдите кнопку «Поделиться» внизу Safari"
                            body={
                                <span>Это квадратик со стрелкой вверх (<Share size={14} aria-hidden="true" style={{ verticalAlign: '-2px' }} />) в нижней панели браузера.</span>
                            }
                        />
                        <Step
                            n={2}
                            title={'Прокрутите меню вниз и выберите «На экран „Домой"»'}
                            body="Если такого пункта не видно — пролистайте ниже, он внизу списка."
                        />
                        <Step
                            n={3}
                            title="Нажмите «Добавить» в правом верхнем углу"
                            body="На главном экране появится значок Unbox. Открывайте его — это ваш мобильный кабинет."
                        />
                        <ArrowHint label="Кнопка «Поделиться» — внизу экрана" />
                    </>
                ) : (
                    <>
                        <Step
                            n={1}
                            title="Откройте меню Samsung Internet"
                            body={'Это три полоски (≡) в правом нижнем углу.'}
                        />
                        <Step
                            n={2}
                            title="Выберите «Добавить страницу на»"
                            body="Появится подменю с вариантами."
                        />
                        <Step
                            n={3}
                            title="Нажмите «Главный экран»"
                            body="Если появится окно Play Защиты — выберите «Все равно установить» или откройте ту же ссылку в Chrome (там установка проще)."
                        />
                    </>
                )}
            </div>
        </Sheet>
    );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
    return (
        <div style={{
            background: COLOR.sunken,
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            gap: 12,
        }}>
            <div style={{
                flexShrink: 0,
                width: 28, height: 28,
                borderRadius: 999,
                background: COLOR.ink,
                color: COLOR.onInk,
                display: 'grid', placeItems: 'center',
                fontSize: 14, fontWeight: 600,
            }}>
                {n}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>
                    {title}
                </div>
                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 4, lineHeight: 1.45 }}>
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
            color: COLOR.ink,
        }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLOR.ink60, textAlign: 'center' }}>
                {label}
            </div>
            <ArrowDown size={28} strokeWidth={2.4} aria-hidden="true" />
        </div>
    );
}
