import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bell, CheckCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import clsx from 'clsx';

interface JoinWaitlistModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function JoinWaitlistModal({ isOpen, onClose }: JoinWaitlistModalProps) {
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');

    const submitWaitlist = useMutation({
        mutationFn: async ({ name, email }: { name: string; email: string }) => {
            console.log(name, email); // to avoid unused vars if I just need to mock
            return new Promise(resolve => setTimeout(resolve, 1500)); // Simulate API delay
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email && name) {
            submitWaitlist.mutate({ name, email });
        }
    };

    const handleReset = () => {
        onClose();
        setTimeout(() => {
            setEmail('');
            setName('');
            submitWaitlist.reset();
        }, 300);
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="fixed inset-0 bg-ink/45 z-50 flex items-center justify-center p-4"
                        onClick={handleReset}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
                            className="bg-card border border-ink-10 rounded-3xl p-8 max-w-md w-full shadow-[var(--shadow-pop)] relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={handleReset}
                                aria-label="Закрыть"
                                className="absolute top-3 right-3 w-11 h-11 flex items-center justify-center text-ink-60 hover:text-ink hover:bg-ink-05 rounded-full transition-colors"
                            >
                                <X size={20} aria-hidden="true" />
                            </button>

                            {submitWaitlist.isSuccess ? (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center py-8"
                                >
                                    <div className="w-16 h-16 bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)] rounded-full flex items-center justify-center mx-auto mb-6">
                                        <CheckCircle size={32} />
                                    </div>
                                    <h3 className="text-2xl font-semibold text-ink mb-2">Вы в списке ожидания!</h3>
                                    <p className="text-ink-60 mb-8">
                                        Мы сообщим вам, как только появятся новые доступные пространства или специальные предложения.
                                    </p>
                                    <button
                                        onClick={handleReset}
                                        className="w-full py-3 border border-ink-20 bg-card hover:bg-ink-05 text-ink rounded-xl font-semibold transition-colors"
                                    >
                                        Понятно, спасибо
                                    </button>
                                </motion.div>
                            ) : (
                                <>
                                    <div className="mb-8 text-center pt-2">
                                        <div className="w-14 h-14 bg-accent-soft text-accent-ink rounded-2xl flex items-center justify-center mx-auto mb-4">
                                            <Bell size={28} />
                                        </div>
                                        <h3 className="text-2xl font-semibold text-ink mb-2">Не нашли нужное?</h3>
                                        <p className="text-ink-60 text-sm px-4">
                                            Оставьте контакты, и мы уведомим вас первыми при появлении новых локаций и свободных окон.
                                        </p>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-ink mb-1.5 ml-1">Ваше имя</label>
                                            <input
                                                type="text"
                                                required
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                className="w-full px-4 py-3 bg-card border border-ink-20 rounded-xl focus:ring-2 focus:ring-accent focus:border-accent transition-all outline-none"
                                                placeholder="Иван Иванов"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-ink mb-1.5 ml-1">Email</label>
                                            <input
                                                type="email"
                                                required
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full px-4 py-3 bg-card border border-ink-20 rounded-xl focus:ring-2 focus:ring-accent focus:border-accent transition-all outline-none"
                                                placeholder="ivan@example.com"
                                            />
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={submitWaitlist.isPending}
                                            className={clsx(
                                                "w-full mt-6 flex items-center justify-center gap-2 py-4 rounded-xl font-semibold text-on-accent transition-colors duration-200",
                                                submitWaitlist.isPending 
                                                    ? "bg-accent/70 cursor-not-allowed" 
                                                    : "bg-accent hover:bg-accent-hover"
                                            )}
                                        >
                                            {submitWaitlist.isPending ? (
                                                <>
                                                    <div className="w-5 h-5 border-2 border-on-accent/30 border-t-on-accent rounded-full animate-spin" aria-hidden="true" />
                                                    Отправляем…
                                                </>
                                            ) : (
                                                'Подписаться на обновления'
                                            )}
                                        </button>
                                    </form>
                                </>
                            )}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
