import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { User, Lock, Phone, LogIn, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { TelegramLoginButton } from '../components/TelegramLoginButton';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

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
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        phone: ''
    });

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
            navigate('/dashboard');
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
    if (useDesignFlag()) {
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
                        navigate('/dashboard');
                    } catch {
                        setError('Ошибка входа через Google');
                    }
                }}
                onGoogleError={() => setError('Ошибка входа через Google')}
            />
        );
    }

    return (
        <div className="min-h-screen font-sans text-unbox-dark selection:bg-unbox-green selection:text-white overflow-hidden">

            {/* ── Background ── */}
            <div className="fixed inset-0 z-0">
                <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover object-[center_45%]" />
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.58)' }} />
            </div>

            {/* ── Glass header (same as ExplorePage) ── */}
            <header className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 pt-4">
                <div
                    className="flex items-center justify-between px-5 py-3 rounded-[22px] max-w-[1920px] mx-auto"
                    style={glassHeader}
                >
                    <div className="flex-1" />
                    <Link to="/" className="flex items-center group">
                        <img
                            src="/unbox-logo.png"
                            alt="Unbox"
                            className="h-[81px] object-contain drop-shadow-md group-hover:scale-[1.15] transition-transform duration-200"
                        />
                    </Link>
                    <div className="flex-1 flex justify-end">
                        <Link
                            to="/"
                            className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-semibold shadow-lg hover:-translate-y-0.5 transition-all bg-[#476D6B]"
                        >
                            Забронировать
                        </Link>
                    </div>
                </div>
            </header>

            {/* ── Centered glass form ── */}
            <div className="relative z-10 flex items-center justify-center min-h-screen px-4 pt-24 pb-8">
                <div
                    className="w-full max-w-md rounded-3xl p-8 animate-in fade-in slide-in-from-bottom-8 duration-700"
                    style={glassPanel}
                >
                    {/* Title */}
                    <div className="text-center mb-7">
                        <h1 className="text-2xl font-bold text-unbox-dark">
                            {isRegistering ? 'Регистрация' : 'Вход в Unbox'}
                        </h1>
                        <p className="text-unbox-grey text-sm mt-1">
                            {isRegistering
                                ? 'Создайте аккаунт для управления бронированиями'
                                : 'Войдите, чтобы управлять бронированиями'}
                        </p>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="mb-4 p-3 bg-red-50/80 text-red-600 rounded-xl text-sm text-center border border-red-100">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4">
                        {/* Name (register only) */}
                        {isRegistering && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="block text-xs font-semibold text-unbox-grey uppercase tracking-wide mb-1.5">Имя</label>
                                <div className="relative">
                                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                                    <input
                                        type="text"
                                        required
                                        style={glassInput}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 transition-all"
                                        placeholder="Ваше имя"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Email */}
                        <div>
                            <label className="block text-xs font-semibold text-unbox-grey uppercase tracking-wide mb-1.5">Email</label>
                            <div className="relative">
                                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                                <input
                                    type="email"
                                    required
                                    style={glassInput}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 transition-all"
                                    placeholder="name@example.com"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div>
                            <label className="block text-xs font-semibold text-unbox-grey uppercase tracking-wide mb-1.5">Пароль</label>
                            <div className="relative">
                                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    required
                                    style={glassInput}
                                    className="w-full pl-10 pr-10 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 transition-all"
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-unbox-grey hover:text-unbox-dark transition-colors"
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                        </div>

                        {/* Phone (register only) */}
                        {isRegistering && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="block text-xs font-semibold text-unbox-grey uppercase tracking-wide mb-1.5">
                                    Телефон <span className="normal-case font-normal">(опционально)</span>
                                </label>
                                <div className="relative">
                                    <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 text-unbox-grey" size={16} />
                                    <input
                                        type="tel"
                                        style={glassInput}
                                        className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 transition-all"
                                        placeholder="+995 555 00 00 00"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        {/* Submit */}
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold text-sm shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-60 disabled:translate-y-0 bg-[#476D6B] mt-2"
                        >
                            {isLoading ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                                    </svg>
                                    Загрузка...
                                </span>
                            ) : (
                                <>
                                    <LogIn size={16} />
                                    {isRegistering ? 'Зарегистрироваться' : 'Войти'}
                                </>
                            )}
                        </button>

                        {/* Divider */}
                        <div className="relative my-1">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-black/10" />
                            </div>
                            <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
                                <span className="px-3 bg-transparent text-unbox-grey">или войдите через</span>
                            </div>
                        </div>

                        {/* OAuth */}
                        <div className="flex flex-col gap-2.5">
                            <div className="flex justify-center">
                                <GoogleLogin
                                    onSuccess={async (credentialResponse) => {
                                        try {
                                            if (credentialResponse.credential) {
                                                await googleLogin(credentialResponse.credential);
                                                navigate('/dashboard');
                                            }
                                        } catch {
                                            setError('Ошибка входа через Google');
                                        }
                                    }}
                                    onError={() => setError('Ошибка входа через Google')}
                                    useOneTap
                                />
                            </div>
                            <div className="flex justify-center h-[40px]">
                                <TelegramLoginButton botName="8209648149" />
                            </div>
                        </div>
                    </form>

                    {/* Toggle login/register */}
                    <div className="mt-6 text-center text-sm text-unbox-grey">
                        {isRegistering ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
                        <button
                            type="button"
                            onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
                            className="font-bold text-unbox-green hover:underline"
                        >
                            {isRegistering ? 'Войти' : 'Регистрация'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
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
                    <div style={GH_MONO_LABEL}>Unbox · Батуми · MMXXVI</div>
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
                <span>Unbox · Батуми · MMXXVI</span>
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
                {trailing && <div style={{ marginLeft: 12 }}>{trailing}</div>}
            </div>
        </div>
    );
}
