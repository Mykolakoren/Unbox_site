import { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Check } from 'lucide-react';
import { api } from '../../api/client';
import { toast } from 'sonner';

const FORMATS = ['Оффлайн', 'Онлайн', 'Оба варианта'];

export function SpecialistApplySection() {
    const [form, setForm] = useState({ name: '', contact: '', specialization: '', format: '' });
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name || !form.contact) {
            toast.error('Укажите имя и контакт');
            return;
        }
        setLoading(true);
        try {
            await api.post('/waitlist', {
                name: form.name,
                contact: form.contact,
                notes: `Специалист. Направление: ${form.specialization || '—'}. Формат: ${form.format || '—'}`,
            });
            setSent(true);
        } catch {
            toast.error('Ошибка отправки. Напишите нам в Telegram.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <section id="apply" className="max-w-6xl mx-auto px-6 py-14">
            <div className="border-t border-black/10 pt-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="max-w-xl mx-auto"
                >
                    <div className="text-center mb-8">
                        <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Заявка</p>
                        <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Начни работать в Unbox</h2>
                        <p className="mt-2 text-unbox-dark/50 text-sm">
                            Оставь заявку — мы свяжемся и расскажем об условиях
                        </p>
                    </div>

                    {sent ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="flex flex-col items-center gap-4 py-12 text-center"
                        >
                            <div className="w-14 h-14 rounded-full flex items-center justify-center"
                                style={{ background: 'rgba(71,109,107,0.20)', border: '1px solid rgba(71,109,107,0.40)' }}>
                                <Check size={26} className="text-unbox-green" />
                            </div>
                            <div className="font-bold text-unbox-dark text-lg">Заявка отправлена!</div>
                            <div className="text-unbox-dark/50 text-sm max-w-xs">
                                Мы свяжемся с вами в ближайшее время. Если хотите ускорить — напишите в Telegram.
                            </div>
                        </motion.div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-unbox-dark/55 mb-1.5">Имя *</label>
                                    <input
                                        type="text"
                                        value={form.name}
                                        onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                                        placeholder="Как вас зовут"
                                        className="w-full px-4 py-2.5 rounded-xl text-sm text-unbox-dark placeholder-unbox-dark/25 outline-none focus:ring-1 focus:ring-unbox-green/50"
                                        style={{ background: 'rgba(255,255,255,0.60)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.70)' }}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs text-unbox-dark/55 mb-1.5">Telegram или телефон *</label>
                                    <input
                                        type="text"
                                        value={form.contact}
                                        onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
                                        placeholder="@username или +995..."
                                        className="w-full px-4 py-2.5 rounded-xl text-sm text-unbox-dark placeholder-unbox-dark/25 outline-none focus:ring-1 focus:ring-unbox-green/50"
                                        style={{ background: 'rgba(255,255,255,0.60)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.70)' }}
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs text-unbox-dark/55 mb-1.5">Направление / специализация</label>
                                <input
                                    type="text"
                                    value={form.specialization}
                                    onChange={e => setForm(f => ({ ...f, specialization: e.target.value }))}
                                    placeholder="Гештальт, КПТ, EMDR..."
                                    className="w-full px-4 py-2.5 rounded-xl text-sm text-unbox-dark placeholder-unbox-dark/25 outline-none focus:ring-1 focus:ring-unbox-green/50"
                                    style={{ background: 'rgba(255,255,255,0.60)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.70)' }}
                                />
                            </div>

                            <div>
                                <label className="block text-xs text-unbox-dark/55 mb-2">Предпочтительный формат работы</label>
                                <div className="flex flex-wrap gap-2">
                                    {FORMATS.map(fmt => (
                                        <button
                                            key={fmt}
                                            type="button"
                                            onClick={() => setForm(f => ({ ...f, format: fmt }))}
                                            className="px-4 py-1.5 rounded-full text-xs font-medium transition-all"
                                            style={form.format === fmt
                                                ? { background: 'rgba(71,109,107,0.20)', border: '1px solid rgba(71,109,107,0.50)', color: 'var(--color-unbox-green)' }
                                                : { background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)', border: '1px solid rgba(255,255,255,0.65)', color: 'rgba(0,0,0,0.45)' }
                                            }
                                        >
                                            {fmt}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold text-sm text-white transition-all hover:opacity-90 disabled:opacity-50 mt-2 bg-unbox-green"
                            >
                                <Send size={15} />
                                {loading ? 'Отправляем...' : 'Отправить заявку'}
                            </button>
                        </form>
                    )}
                </motion.div>
            </div>
        </section>
    );
}
