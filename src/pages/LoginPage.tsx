import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { Layout } from '../components/Layout';
import { User, Lock, Phone } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import { TelegramLoginButton } from '../components/TelegramLoginButton';

export function LoginPage() {
    const navigate = useNavigate();
    const { login, register, googleLogin, telegramLogin } = useUserStore();
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
                setError("Неверный email или пароль");
            } else if (err.response?.status === 422) {
                setError("Проверьте правильность введенных данных");
            } else {
                setError("Произошла ошибка. Попробуйте позже.");
            }
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Layout>
            <div className="max-w-md mx-auto mt-20 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold mb-2">{isRegistering ? 'Регистрация' : 'Вход в Unbox'}</h1>
                    <p className="text-gray-500">
                        {isRegistering ? 'Создайте аккаунт для управления бронированиями' : 'Войдите, чтобы управлять бронированиями'}
                    </p>
                </div>

                <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm text-center">
                            {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {isRegistering && (
                            <div>
                                <label className="block text-sm font-medium mb-2">Имя</label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="text"
                                        required
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                        placeholder="Ваше имя"
                                        value={formData.name}
                                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium mb-2">Email</label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="email"
                                    required
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                    placeholder="name@example.com"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2">Пароль</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                <input
                                    type="password"
                                    required
                                    className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                    placeholder="••••••••"
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Additional field for Registration */}
                        {isRegistering && (
                            <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                <label className="block text-sm font-medium mb-2">Телефон (опционально)</label>
                                <div className="relative">
                                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                                    <input
                                        type="tel"
                                        className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-black"
                                        placeholder="+995 555 00 00 00"
                                        value={formData.phone}
                                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                    />
                                </div>
                            </div>
                        )}

                        <Button type="submit" size="lg" className="w-full" disabled={isLoading}>
                            {isLoading ? 'Загрузка...' : (isRegistering ? 'Зарегистрироваться' : 'Войти')}
                        </Button>

                        <div className="relative my-6">
                            <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t border-gray-200" />
                            </div>
                            <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-white px-2 text-gray-500">или войдите через</span>
                            </div>
                        </div>

                        <div className="flex flex-col gap-3">
                            <div className="flex justify-center">
                                <GoogleLogin
                                    onSuccess={async (credentialResponse) => {
                                        try {
                                            if (credentialResponse.credential) {
                                                await googleLogin(credentialResponse.credential);
                                                navigate('/dashboard');
                                            }
                                        } catch (error) {
                                            console.error("Google Login Error", error);
                                            setError("Ошибка входа через Google");
                                        }
                                    }}
                                    onError={() => {
                                        console.error('Google Login Failed');
                                        setError("Ошибка входа через Google");
                                    }}
                                    useOneTap
                                />
                            </div>

                            <div className="flex justify-center h-[40px]">
                                <TelegramLoginButton
                                    botName="UnboxBookingBot"
                                    buttonSize="medium"
                                    cornerRadius={8}
                                    onAuth={async (user) => {
                                        try {
                                            await telegramLogin(user);
                                            navigate('/dashboard');
                                        } catch (error) {
                                            console.error("Telegram Login Error", error);
                                            setError("Ошибка входа через Telegram");
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </form>

                    <div className="mt-6 text-center text-sm text-gray-500">
                        {isRegistering ? 'Уже есть аккаунт?' : 'Нет аккаунта?'}{' '}
                        <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="font-bold text-black hover:underline">
                            {isRegistering ? 'Войти' : 'Регистрация'}
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
}

