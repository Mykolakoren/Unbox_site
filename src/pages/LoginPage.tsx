import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { PhoneInput } from '../components/ui/PhoneInput';
import { User, Lock, Phone, LogIn, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { TelegramLoginButton } from '../components/TelegramLoginButton';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

function useGHNarrow(bp = 768) {
    const [n, setN] = useState(() => typeof window !== 'undefined' && window.innerWidth < bp);
    useEffect(() => { const h = () => setN(window.innerWidth < bp); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h); }, [bp]);
    return n;
}

// ─── Clean styles (post-Liquid Glass) ────────────────────────────────────────
const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.94)',
    borderBottom: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 1px 8px rgba(0,0,0,0.03)',
};

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.92)',
    border: '1px solid rgba(0,0,0,0.06)',
    boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
};

const glassInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.70)',
    border: '1px solid rgba(0,0,0,0.08)',
};
// ─────────────────────────────────────────────────────────────────────────────

export function LoginPage() {
    const navigate = useNavigate();
    const { login, register, googleLogin } = useUserStore();
    const [isRegistering, setIsRegistering] = useState(
        () => new URLSearchParams(window.location.search).get('register') === '1'
    );
    const [isLoading, setIsLoading] = useState(false);
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
     *  Mobile (phone-width / standalone PWA): always → /m. The /m shell
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
            if (isPhoneWidth || inStandalone) return '/m';

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
            return '/dashboard';
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
            if (err.response?.status === 400 || err.response?.status === 401) {
                setError('Неверный email или пароль');
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
// Rollback: delete this component + its early-return above.
// ─────────────────────────────────────────────────────────────────────────

const GH_HAIRLINE = `1px solid ${GH.ink10}`;
const GH_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
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
    onGoogleSuccess: (credential: string) => Promise<void>;
    onGoogleError: () => void;
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
    onGoogleSuccess,
    onGoogleError,
}: GridHouseLoginPageProps) {
    const narrow = useGHNarrow(768);
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
            {/* ── Top bar ── */}
            <header
                style={{
                    borderBottom: GH_HAIRLINE,
                    padding: narrow ? '16px 20px' : '20px 32px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                }}
            >
                <Link
                    to="/"
                    style={{
                        fontSize: 22,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        color: GH.ink,
                        textDecoration: 'none',
                    }}
                >
                    Unbox
                </Link>
                <Link
                    to="/"
                    style={{
                        ...GH_MONO_LABEL,
                        color: GH.ink,
                        textDecoration: 'none',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: 2,
                    }}
                >
                    ← На главную
                </Link>
            </header>

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
                    <div>
                        <div style={GH_MONO_LABEL}>Раздел · Вход</div>
                        <div style={{ ...GH_MONO_LABEL, marginTop: 4 }}>Доступ · Резиденты и клиенты</div>
                    </div>
                    <div>
                        <div
                            style={{
                                fontSize: 'clamp(48px, 6vw, 88px)',
                                fontWeight: 800,
                                lineHeight: 0.92,
                                letterSpacing: '-0.03em',
                                marginBottom: 24,
                            }}
                        >
                            {isRegistering ? 'Новый специалист.' : 'Добро пожаловать.'}
                        </div>
                        <div
                            style={{
                                fontSize: 17,
                                lineHeight: 1.55,
                                color: GH.ink60,
                                maxWidth: 420,
                            }}
                        >
                            {isRegistering
                                ? 'Регистрация открывает личный кабинет: бронирования, сессии, расписание.'
                                : 'Войдите, чтобы увидеть бронирования, сессии и расписание.'}
                        </div>
                    </div>
                    <div style={GH_MONO_LABEL}>Unbox · Батуми</div>
                </aside>
                )}

                {/* RIGHT — form column */}
                <main style={{ padding: narrow ? '32px 20px' : '64px 48px', display: 'flex', alignItems: narrow ? 'flex-start' : 'center', flex: 1 }}>
                    <div style={{ width: '100%', maxWidth: 420, margin: '0 auto' }}>
                        {/* Mobile-only headline */}
                        {narrow && (
                            <div style={{ marginBottom: 28 }}>
                                <div
                                    style={{
                                        fontSize: 36,
                                        fontWeight: 800,
                                        lineHeight: 0.95,
                                        letterSpacing: '-0.03em',
                                        marginBottom: 12,
                                    }}
                                >
                                    {isRegistering ? 'Новый специалист.' : 'Вход.'}
                                </div>
                                <div style={{ fontSize: 15, lineHeight: 1.5, color: GH.ink60 }}>
                                    {isRegistering
                                        ? 'Регистрация открывает личный кабинет.'
                                        : 'Войдите, чтобы увидеть бронирования, сессии и расписание.'}
                                </div>
                            </div>
                        )}
                        {!narrow && (
                        <div style={{ ...GH_MONO_LABEL, marginBottom: 24 }}>
                            {isRegistering ? '→ Регистрация' : '→ Вход'}
                        </div>
                        )}

                        {error && (
                            <div
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

                        <form onSubmit={handleSubmit}>
                            {isRegistering && (
                                <GHField
                                    label="Имя"
                                    icon={<User size={14} />}
                                    type="text"
                                    value={formData.name}
                                    onChange={(v) => setFormData({ ...formData, name: v })}
                                    placeholder="Ваше имя"
                                    required
                                />
                            )}

                            <GHField
                                label="Email"
                                icon={<User size={14} />}
                                type="email"
                                value={formData.email}
                                onChange={(v) => setFormData({ ...formData, email: v })}
                                placeholder="name@example.com"
                                required
                            />

                            <GHField
                                label="Пароль"
                                icon={<Lock size={14} />}
                                type={showPassword ? 'text' : 'password'}
                                value={formData.password}
                                onChange={(v) => setFormData({ ...formData, password: v })}
                                placeholder="••••••••"
                                required
                                trailing={
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: GH.ink60,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: 0,
                                        }}
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                    </button>
                                }
                            />

                            {isRegistering && (
                                <GHField
                                    label="Телефон — опционально"
                                    icon={<Phone size={14} />}
                                    type="tel"
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
                                    padding: '16px 24px',
                                    background: GH.ink,
                                    color: GH.paper,
                                    border: 'none',
                                    fontFamily: GH_MONO,
                                    fontSize: 11,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.18em',
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
                                <span>{isLoading ? 'Отправка…' : isRegistering ? 'Создать аккаунт' : 'Войти'}</span>
                                <LogIn size={14} />
                            </button>
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

                        {/* OAuth */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    border: GH_HAIRLINE,
                                    padding: 8,
                                    background: GH.paper,
                                }}
                            >
                                <GoogleLogin
                                    onSuccess={async (credentialResponse) => {
                                        if (credentialResponse.credential) {
                                            await onGoogleSuccess(credentialResponse.credential);
                                        }
                                    }}
                                    onError={onGoogleError}
                                    useOneTap
                                />
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'center',
                                    border: GH_HAIRLINE,
                                    padding: 8,
                                    minHeight: 56,
                                    alignItems: 'center',
                                }}
                            >
                                <TelegramLoginButton botName="8209648149" />
                            </div>
                        </div>

                        {/* Toggle */}
                        <div
                            style={{
                                marginTop: 32,
                                paddingTop: 20,
                                borderTop: GH_HAIRLINE,
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
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
                                    fontFamily: GH_MONO,
                                    fontSize: 11,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.18em',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    padding: 0,
                                    borderBottom: `1px solid ${GH.ink}`,
                                    paddingBottom: 2,
                                }}
                            >
                                {isRegistering ? '→ Войти' : '→ Регистрация'}
                            </button>
                        </div>
                    </div>
                </main>
            </div>

            {/* ── Footer strip ── */}
            <footer
                style={{
                    borderTop: GH_HAIRLINE,
                    padding: narrow ? '16px 20px' : '16px 32px',
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
function GHField({
    label,
    icon,
    type,
    value,
    onChange,
    placeholder,
    required,
    trailing,
}: {
    label: string;
    icon: React.ReactNode;
    type: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    required?: boolean;
    trailing?: React.ReactNode;
}) {
    const [focused, setFocused] = useState(false);
    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ ...GH_MONO_LABEL, marginBottom: 8 }}>{label}</div>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    borderBottom: `1px solid ${focused ? GH.ink : GH.ink30}`,
                    paddingBottom: 10,
                    transition: 'border-color 0.15s ease',
                }}
            >
                <div style={{ color: GH.ink30, marginRight: 12, display: 'flex' }}>{icon}</div>
                {type === 'tel' ? (
                    <PhoneInput
                        value={value}
                        onChange={onChange}
                        required={required}
                        placeholder={placeholder}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        style={{
                            flex: 1,
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            fontFamily: GH_SANS,
                            fontSize: 16,
                            color: GH.ink,
                            padding: 0,
                        }}
                    />
                ) : (
                    <input
                        type={type}
                        value={value}
                        required={required}
                        placeholder={placeholder}
                        onChange={(e) => onChange(e.target.value)}
                        onFocus={() => setFocused(true)}
                        onBlur={() => setFocused(false)}
                        style={{
                            flex: 1,
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            fontFamily: GH_SANS,
                            fontSize: 16,
                            color: GH.ink,
                            padding: 0,
                        }}
                    />
                )}
                {trailing && <div style={{ marginLeft: 12 }}>{trailing}</div>}
            </div>
        </div>
    );
}
