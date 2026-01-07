import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { Button } from '../components/ui/Button';
import { Layout } from '../components/Layout';
import { User, Lock, Phone } from 'lucide-react';

export function LoginPage() {
    const navigate = useNavigate();
    const login = useUserStore((s) => s.login);
    const [isRegistering, setIsRegistering] = useState(false);

    const [formData, setFormData] = useState({
        name: '',
        email: '',
        phone: ''
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name || !formData.email) return;

        // Mock login/register logic
        // Mock login/register logic
        login(formData.email, formData.name);

        navigate('/dashboard');
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
                    <form onSubmit={handleSubmit} className="space-y-6">
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

                        <div>
                            <label className="block text-sm font-medium mb-2">Email</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
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

                        <Button type="submit" size="lg" className="w-full">
                            {isRegistering ? 'Зарегистрироваться' : 'Войти'}
                        </Button>
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

