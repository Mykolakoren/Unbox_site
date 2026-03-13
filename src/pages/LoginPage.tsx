import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { User, Lock, Phone, LogIn } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { TelegramLoginButton } from '../components/TelegramLoginButton';

// ─── iOS 26 Liquid Glass styles (same as ExplorePage) ────────────────────────
const glassHeader: React.CSSProperties = {
    background: 'rgba(255,255,255,0.10)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.22)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.40)',
};

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.70)',
    backdropFilter: 'blur(40px) saturate(160%)',
    WebkitBackdropFilter: 'blur(40px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.55)',
    boxShadow: '0 24px 64px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
};

const glassInput: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    border: '1px solid rgba(255,255,255,0.50)',
};
// ─────────────────────────────────────────────────────────────────────────────

export function LoginPage() {
    const navigate = useNavigate();
    const { login, register, googleLogin } = useUserStore();
    const [isRegistering, setIsRegistering] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    return (
        <div className="min-h-screen font-sans text-unbox-dark selection:bg-unbox-green selection:text-white overflow-hidden">

            {/* ── Full-page background ── */}
            <div className="fixed inset-0 z-0">
                <img
                    src="/hero-bg.jpg"
                    alt=""
                    className="w-full h-full object-cover object-[center_45%]"
                />
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.48)' }} />
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
                            className="flex items-center gap-2 px-4 py-2 rounded-full text-white text-sm font-semibold shadow-lg hover:-translate-y-0.5 transition-all brand-gradient"
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
                                    type="password"
                                    required
                                    style={glassInput}
                                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/30 transition-all"
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                />
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
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-semibold text-sm shadow-lg hover:-translate-y-0.5 active:scale-[0.98] transition-all disabled:opacity-60 disabled:translate-y-0 brand-gradient mt-2"
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
