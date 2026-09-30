import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { PhoneInput } from '../components/ui/PhoneInput';
import { User, Mail, Lock, Phone, LogIn, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { TelegramLoginButton } from '../components/TelegramLoginButton';
import { PublicHeader } from '../components/public/PublicHeader';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { safeRedirectPath } from '../utils/loginRedirect';
import { useDocumentTitle } from '../hooks/useDocumentTitle';

// Компьютерные кабинеты: на телефоне у них свой интерфейс /m, поэтому
// возврат туда после входа с телефона не делаем (как и раньше — в /m).
const DESKTOP_SHELL_RE = /^\/(?:dashboard|crm|admin|profile)(?:[/?#]|$)/;

function useGHNarrow(bp = 768) {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
    useEffect(() => { const h = () => setN(window.innerWidth < bp); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [bp]);
    return n;
}

export function LoginPage() {
    const navigate = useNavigate();
    const { login, register, googleLogin } = useUserStore();
    const [isRegistering, setIsRegistering] = useState(
        () => new URLSearchParams(window.location.search).get('register') === '1'
    );
    // ?redirect= — куда вернуть после входа (анкета специалиста, выбранный
    // кабинет, страница, где истекла сессия). Читаем один раз при открытии:
    // переключение «Вход ↔ Регистрация» его не теряет. Чужие адреса
    // (https://…, //host) отбрасываем.
    const [redirectTo] = useState(
        () => safeRedirectPath(new URLSearchParams(window.location.search).get('redirect'))
    );
    const [isLoading, setIsLoading] = useState(false);
    useDocumentTitle(isRegistering ? 'Создать аккаунт' : 'Вход');
    // Surface the reason the Telegram-callback page bounced us here, so the
    // user knows why they didn't land on /dashboard. Strip the param from
    // the URL once read so a refresh doesn't keep showing the message.
    const [error, setError] = useState<string | null>(() => {
        const sp = new URLSearchParams(window.location.search);
        const tgFailed = sp.get('tg_failed');
        const tgUnlinked = sp.get('tg_unlinked');
        if (!tgFailed && !tgUnlinked) return null;

        const url = new URL(window.location.href);
        url.searchParams.delete('tg_failed');
        url.searchParams.delete('tg_unlinked');
        window.history.replaceState({}, document.title, url.pathname + url.search);

        // Most explicit case first — owner asked 2026-05-25 to stop auto-
        // creating ghost accounts for unbound TG OAuth. The new server-side
        // 403 lands here, and we tell the user exactly how to proceed.
        if (tgUnlinked) {
            return 'Telegram не привязан ни к одному аккаунту. Войдите через Google или email — затем привяжите Telegram в профиле, и вход через TG заработает на этом же аккаунте.';
        }
        if (tgFailed === 'storage') {
            return 'Браузер заблокировал сохранение токена (приватный режим / отключённый localStorage). Откройте сайт в обычном окне.';
        }
        return 'Не удалось войти через Telegram. Попробуйте ещё раз.';
    });
    const [showPassword, setShowPassword] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        phone: ''
    });

    /** Post-login routing.
     *
     *  First: a safe local ?redirect= (see redirectTo above) — the page that
     *  sent the user here. On a phone, desktop shells (/dashboard, /crm,
     *  /admin) are skipped in favour of /m.
     *
     *  Mobile (phone-width / standalone PWA): otherwise → /m. The /m shell
     *  handles role gating internally (admin/owner sees /m/admin tab in
     *  bottom bar, specialists see /m/crm, etc.).
     *
     *  Desktop: routed по роли — устраняем «упрощённый /dashboard» как
     *  default для тех, для кого он не основной рабочий стол.
     *    - admin / owner / senior_admin → /admin (полная админка)
     *    - specialist                   → /crm (CRM-оператор)
     *    - user (или роль не указана)   → /dashboard (личный кабинет)
     *
     *  Specialist'ы и админы могут зайти в /dashboard вручную (там их
     *  личный профиль, абонемент, бонусы), но не получают его как первый
     *  экран после логина. */
    const postLoginPath = (): string => {
        try {
            sessionStorage.removeItem('forceDesktop');
            const isPhoneWidth = window.matchMedia?.('(max-width: 768px)').matches;
            const inStandalone = window.matchMedia?.('(display-mode: standalone)').matches
                || (window.navigator as any).standalone === true;
            const isMobileEntry = isPhoneWidth || inStandalone;
            if (redirectTo && !(isMobileEntry && DESKTOP_SHELL_RE.test(redirectTo))) return redirectTo;
            if (isMobileEntry) return '/m';

            // Desktop — роутим по роли
            const u = useUserStore.getState().currentUser;
            const role = u?.role;
            if (role === 'owner' || role === 'senior_admin' || role === 'admin' || u?.isAdmin) {
                return '/admin';
            }
            if (role === 'specialist') {
                return '/crm';
            }
            return '/dashboard';
        } catch {
            return redirectTo ?? '/dashboard';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsLoading(true);
        try {
            if (isRegistering) {
                await register({
                    email: formData.email,
                    password: formData.password,
                    name: formData.name,
                    phone: formData.phone
                });
            } else {
                await login(formData.email, formData.password);
            }
            navigate(postLoginPath());
        } catch (err: any) {
            console.error(err);
            // Бэкенд отдаёт понятные русские причины (нет пароля у Google/TG-
            // аккаунта, email занят, аккаунт в архиве) — показываем их как есть.
            const detail = err.response?.data?.detail;
            if (typeof detail === 'string' && /[а-яё]/i.test(detail)) {
                setError(detail);
            } else if (err.response?.status === 400 || err.response?.status === 401) {
                setError(isRegistering ? 'Не удалось создать аккаунт — проверьте данные' : 'Неверный email или пароль');
            } else if (err.response?.status === 422) {
                setError('Проверьте правильность введенных данных');
            } else {
                setError('Произошла ошибка. Попробуйте позже.');
            }
        } finally {
            setIsLoading(false);
        }
    };

    // ─── Grid House variant (behind feature flag) ────────────────────────
    return (

            <GridHouseLoginPage
                isRegistering={isRegistering}
                setIsRegistering={setIsRegistering}
                isLoading={isLoading}
                error={error}
                setError={setError}
                showPassword={showPassword}
                setShowPassword={setShowPassword}
                formData={formData}
                setFormData={setFormData}
                handleSubmit={handleSubmit}
                notice={redirectTo === '/become-specialist'
                    ? 'Войдите или создайте аккаунт — затем откроется анкета специалиста'
                    : null}
                onGoogleSuccess={async (credential: string) => {
                    try {
                        await googleLogin(credential);
                        navigate(postLoginPath());
                    } catch {
                        setError('Ошибка входа через Google');
                    }
                }}
                onGoogleError={() => setError('Ошибка входа через Google')}
            />
        );
}


// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE LOGIN — newspaper-front-desk variant
// Волна 2 (G1-14, G1-15, G1-16, G1-17, X4-14, G1-landing-entry-M2):
// подписи связаны с полями, автозаполнение браузера и менеджеров паролей,
// «глазок» 44 px с названием, h1, ошибка озвучивается; на регистрации нет
// Telegram (аккаунт через него не создаётся — был тупик с 403).
// ─────────────────────────────────────────────────────────────────────────

const GH_HAIRLINE = `1px solid ${GH.ink10}`;
const GH_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: GH.ink60,
};

interface GridHouseLoginPageProps {
    isRegistering: boolean;
    setIsRegistering: (v: boolean) => void;
    isLoading: boolean;
    error: string | null;
    setError: (v: string | null) => void;
    showPassword: boolean;
    setShowPassword: (v: boolean) => void;
    formData: { name: string; email: string; password: string; phone: string };
    setFormData: (v: { name: string; email: string; password: string; phone: string }) => void;
    handleSubmit: (e: React.FormEvent) => void;
    /** Одна строка над формой — зачем человека попросили войти. */
    notice?: string | null;
    onGoogleSuccess: (credential: string) => Promise<void>;
    onGoogleError: () => void;
}

/** Кнопка Google рисуется скриптом accounts.google.com. Если он не пришёл
 *  (блокировщик, сеть), вместо кнопки оставалась пустая рамка — прячем. */
function useGoogleButtonVisible(ref: React.RefObject<HTMLDivElement | null>): boolean {
    const [visible, setVisible] = useState(true);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const rendered = () => !!el.querySelector('iframe, div[role="button"]');
        const timer = window.setTimeout(() => { if (!rendered()) setVisible(false); }, 3000);
        const obs = new MutationObserver(() => { if (rendered()) setVisible(true); });
        obs.observe(el, { childList: true, subtree: true });
        return () => { window.clearTimeout(timer); obs.disconnect(); };
    }, [ref]);
    return visible;
}

function GridHouseLoginPage({
    isRegistering,
    setIsRegistering,
    isLoading,
    error,
    setError,
    showPassword,
    setShowPassword,
    formData,
    setFormData,
    handleSubmit,
    notice,
    onGoogleSuccess,
    onGoogleError,
}: GridHouseLoginPageProps) {
    const narrow = useGHNarrow(768);
    const googleRef = useRef<HTMLDivElement>(null);
    const googleVisible = useGoogleButtonVisible(googleRef);
    const title = isRegistering ? 'Создать аккаунт.' : narrow ? 'Вход.' : 'Добро пожаловать.';
    const lead = isRegistering
        ? 'Аккаунт открывает личный кабинет: бронирования, сессии, расписание.'
        : 'Войдите, чтобы увидеть бронирования, сессии и расписание.';

    return (
        <div
            style={{
                minHeight: '100vh',
                background: GH.paper,
                color: GH.ink,
                fontFamily: GH_SANS,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            {/* G1-21: общая шапка сайта вместо своей «← На главную». */}
            <PublicHeader />

            {/* ── Main grid ── */}
            <div
                style={{
                    flex: 1,
                    display: narrow ? 'flex' : 'grid',
                    flexDirection: narrow ? 'column' : undefined,
                    gridTemplateColumns: narrow ? undefined : 'minmax(0, 1fr) minmax(0, 1fr)',
                    maxWidth: 1280,
                    width: '100%',
                    margin: '0 auto',
                }}
            >
                {/* LEFT — masthead column (hidden on mobile) */}
                {!narrow && (
                <aside
                    style={{
                        borderRight: GH_HAIRLINE,
                        padding: '64px 48px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        minHeight: 520,
                    }}
                >
                    <div style={GH_MONO_LABEL}>{isRegistering ? 'Регистрация' : 'Вход'}</div>
                    <div>
                        <h1
                            style={{
                                fontSize: 'clamp(48px, 6vw, 88px)',
                                fontWeight: 600,
                                lineHeight: 0.92,
                                letterSpacing: '-0.03em',
                                margin: '0 0 24px',
                            }}
                        >
                            {title}
                        </h1>
                        <p style={{ fontSize: 17, lineHeight: 1.55, color: GH.ink60, maxWidth: 420, margin: 0 }}>
                            {lead}
                        </p>
                    </div>
                    <div style={GH_MONO_LABEL}>Unbox · Батуми</div>
                </aside>
                )}

                {/* RIGHT — form column */}
                <main style={{ padding: narrow ? '32px 16px' : '64px 48px', display: 'flex', alignItems: narrow ? 'flex-start' : 'center', flex: 1 }}>
                    <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
                        {/* Mobile-only headline */}
                        {narrow && (
                            <div style={{ marginBottom: 28 }}>
                                <h1
                                    style={{
                                        fontSize: 36,
                                        fontWeight: 600,
                                        lineHeight: 0.95,
                                        letterSpacing: '-0.03em',
                                        margin: '0 0 12px',
                                    }}
                                >
                                    {title}
                                </h1>
                                <p style={{ fontSize: 16, lineHeight: 1.5, color: GH.ink60, margin: 0 }}>
                                    {lead}
                                </p>
                            </div>
                        )}

                        {error && (
                            <div
                                role="alert"
                                style={{
                                    border: `1px solid ${GH.danger}`,
                                    padding: '12px 16px',
                                    marginBottom: 24,
                                    fontSize: 14,
                                    color: GH.danger,
                                    fontFamily: GH_SANS,
                                }}
                            >
                                {error}
                            </div>
                        )}

                        {notice && (
                            <div
                                role="note"
                                style={{
                                    borderLeft: `2px solid ${GH.accent}`,
                                    padding: '4px 0 4px 12px',
                                    marginBottom: 24,
                                    fontSize: 14,
                                    lineHeight: 1.5,
                                    color: GH.ink,
                                }}
                            >
                                {notice}
                            </div>
                        )}

                        <form onSubmit={handleSubmit}>
                            {isRegistering && (
                                <GHField
                                    id="login-name"
                                    label="Имя"
                                    icon={<User size={16} />}
                                    type="text"
                                    autoComplete="name"
                                    value={formData.name}
                                    onChange={(v) => setFormData({ ...formData, name: v })}
                                    placeholder="Как к вам обращаться"
                                    required
                                />
                            )}

                            <GHField
                                id="login-email"
                                label="Email"
                                icon={<Mail size={16} />}
                                type="email"
                                autoComplete={isRegistering ? 'email' : 'username'}
                                value={formData.email}
                                onChange={(v) => setFormData({ ...formData, email: v })}
                                placeholder="name@example.com"
                                required
                            />

                            <GHField
                                id="login-password"
                                label="Пароль"
                                icon={<Lock size={16} />}
                                type={showPassword ? 'text' : 'password'}
                                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                                value={formData.password}
                                onChange={(v) => setFormData({ ...formData, password: v })}
                                required
                                trailing={
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                                        aria-pressed={showPassword}
                                        aria-controls="login-password"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: GH.ink60,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            width: 44,
                                            height: 44,
                                            margin: '-12px -10px -12px 0',
                                            padding: 0,
                                        }}
                                    >
                                        {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                                    </button>
                                }
                            />

                            {isRegistering && (
                                <GHField
                                    id="login-phone"
                                    label="Телефон · необязательно"
                                    icon={<Phone size={16} />}
                                    type="tel"
                                    autoComplete="tel"
                                    value={formData.phone}
                                    onChange={(v) => setFormData({ ...formData, phone: v })}
                                    placeholder="+995 555 00 00 00"
                                />
                            )}

                            <button
                                type="submit"
                                disabled={isLoading}
                                style={{
                                    width: '100%',
                                    minHeight: 48,
                                    padding: '0 24px',
                                    background: GH.ink,
                                    color: GH.paper,
                                    border: 'none',
                                    fontFamily: GH_SANS,
                                    fontSize: 16,
                                    fontWeight: 600,
                                    cursor: isLoading ? 'not-allowed' : 'pointer',
                                    opacity: isLoading ? 0.6 : 1,
                                    marginTop: 8,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    transition: 'opacity 0.15s ease',
                                }}
                            >
                                <span>{isLoading ? (isRegistering ? 'Создаём аккаунт…' : 'Входим…') : isRegistering ? 'Создать аккаунт' : 'Войти'}</span>
                                <LogIn size={18} aria-hidden="true" />
                            </button>

                            {/* G1-17: сброса пароля по почте пока нет. Не обещаем сроков —
                                только куда написать и что есть вход через Google. */}
                            {!isRegistering && (
                                <p style={{ margin: '16px 0 0', fontSize: 14, lineHeight: 1.5, color: GH.ink60 }}>
                                    Забыли пароль?{' '}
                                    <a
                                        href="https://t.me/UnboxCenter"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}
                                    >
                                        Напишите нам в Telegram
                                    </a>{' '}
                                    — поможем восстановить доступ. Или войдите через Google.
                                </p>
                            )}
                        </form>

                        {/* Divider */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 16,
                                margin: '32px 0 20px',
                            }}
                        >
                            <div style={{ flex: 1, borderTop: GH_HAIRLINE }} />
                            <div style={GH_MONO_LABEL}>Или через</div>
                            <div style={{ flex: 1, borderTop: GH_HAIRLINE }} />
                        </div>

                        {/* OAuth. G1-16: без рамок вокруг кнопок («рамка в рамке»). */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div
                                ref={googleRef}
                                style={{ display: googleVisible ? 'flex' : 'none', justifyContent: 'center', minHeight: 44 }}
                            >
                                <GoogleLogin
                                    onSuccess={async (credentialResponse) => {
                                        if (credentialResponse.credential) {
                                            await onGoogleSuccess(credentialResponse.credential);
                                        }
                                    }}
                                    onError={onGoogleError}
                                    theme="outline"
                                    size="large"
                                    shape="rectangular"
                                    text={isRegistering ? 'signup_with' : 'signin_with'}
                                    width={narrow ? 320 : 400}
                                    useOneTap
                                />
                            </div>
                            {/* G1-landing-entry-M2: Telegram аккаунт не создаёт (решение
                                владельца 25.05) — новичку эта кнопка давала 403-тупик.
                                На регистрации её нет, на входе — с пояснением. */}
                            {!isRegistering && (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                                    <TelegramLoginButton botName="8209648149" block />
                                    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: GH.ink60, textAlign: 'center' }}>
                                        Работает, если Telegram уже привязан в профиле.
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Toggle */}
                        <div
                            style={{
                                marginTop: 32,
                                paddingTop: 12,
                                borderTop: GH_HAIRLINE,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: 12,
                                fontSize: 14,
                                color: GH.ink60,
                            }}
                        >
                            <span>{isRegistering ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    setIsRegistering(!isRegistering);
                                    setError(null);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: GH.ink,
                                    fontFamily: GH_SANS,
                                    fontSize: 16,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    padding: '0 4px',
                                    minHeight: 44,
                                    textDecoration: 'underline',
                                    textUnderlineOffset: 4,
                                }}
                            >
                                {isRegistering ? 'Войти' : 'Создать аккаунт'}
                            </button>
                        </div>
                    </div>
                </main>
            </div>

            {/* ── Footer strip ── */}
            <footer
                style={{
                    borderTop: GH_HAIRLINE,
                    padding: narrow ? '16px' : '16px 32px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    ...GH_MONO_LABEL,
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <span>Unbox · Батуми</span>
            </footer>
        </div>
    );
}

// ── Grid House form field ──
// Подпись — настоящий <label htmlFor>, у поля id и autoComplete: браузер и
// менеджеры паролей подставляют почту и пароль, диктор читает подпись.
function GHField({
    id,
    label,
    icon,
    type,
    autoComplete,
    value,
    onChange,
    placeholder,
    required,
    trailing,
}: {
    id: string;
    label: string;
    icon: React.ReactNode;
    type: string;
    autoComplete: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    required?: boolean;
    trailing?: React.ReactNode;
}) {
    const [focused, setFocused] = useState(false);
    const inputStyle: React.CSSProperties = {
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontFamily: GH_SANS,
        fontSize: 16,
        color: GH.ink,
        padding: 0,
        minHeight: 32,
    };
    return (
        <div style={{ marginBottom: 20 }}>
            <label htmlFor={id} style={{ ...GH_MONO_LABEL, display: 'block', marginBottom: 8 }}>{label}</label>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    // Нижняя линия поля — не бледнее 3:1 (было ink30, 2:1); фокус — ink.
                    borderBottom: `${focused ? 2 : 1}px solid ${focused ? GH.ink : GH.ink60}`,
                    paddingBottom: focused ? 7 : 8,
                    transition: 'border-color 0.15s ease',
                }}
            >
                <div aria-hidden="true" style={{ color: GH.ink60, marginRight: 12, display: 'flex' }}>{icon}</div>
                {type === 'tel' ? (
                    <PhoneInput
                        id={id}
                        value={value}
                        onChange={onChange}
                        required={required}
                        placeholder={placeholder}
                        autoComplete={autoComplete}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        style={inputStyle}
                    />
                ) : (
                    <input
                        id={id}
                        name={id.replace(/^login-/, '')}
                        type={type}
                        value={value}
                        required={required}
                        placeholder={placeholder}
                        autoComplete={autoComplete}
                        autoCapitalize={type === 'email' ? 'none' : undefined}
                        spellCheck={type === 'email' ? false : undefined}
                        onChange={(e) => onChange(e.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        style={inputStyle}
                    />
                )}
                {trailing && <div style={{ marginLeft: 12, display: 'flex' }}>{trailing}</div>}
            </div>
        </div>
    );
}
