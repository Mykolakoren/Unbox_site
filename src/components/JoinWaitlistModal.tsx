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
                        className="fixed inset-0 bg-unbox-dark/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                        onClick={handleReset}
                    >
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95, y: 20 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: 20 }}
                            transition={{ type: "spring", duration: 0.5, bounce: 0.3 }}
                            className="bg-white/95 backdrop-blur-xl border border-white/50 rounded-3xl p-8 max-w-md w-full shadow-premium relative"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={handleReset}
                                className="absolute top-4 right-4 p-2 text-unbox-grey hover:text-unbox-dark hover:bg-unbox-light/50 rounded-full transition-colors"
                            >
                                <X size={20} />
                            </button>

                            {submitWaitlist.isSuccess ? (
                                <motion.div 
                                    initial={{ opacity: 0, scale: 0.9 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    className="text-center py-8"
                                >
                                    <div className="w-16 h-16 bg-unbox-light text-unbox-green rounded-full flex items-center justify-center mx-auto mb-6 shadow-inner">
                                        <CheckCircle size={32} />
                                    </div>
                                    <h3 className="text-2xl font-bold text-unbox-dark mb-2">Вы в списке ожидания!</h3>
                                    <p className="text-unbox-grey mb-8">
                                        Мы сообщим вам, как только появятся новые доступные пространства или специальные предложения.
                                    </p>
                                    <button
                                        onClick={handleReset}
                                        className="w-full py-3 bg-unbox-light hover:bg-unbox-light/70 text-unbox-dark rounded-xl font-bold transition-colors"
                                    >
                                        Понятно, спасибо
                                    </button>
                                </motion.div>
                            ) : (
                                <>
                                    <div className="mb-8 text-center pt-2">
                                        <div className="w-14 h-14 bg-unbox-light text-unbox-green rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm transform -rotate-6">
                                            <Bell size={28} />
                                        </div>
                                        <h3 className="text-2xl font-bold text-unbox-dark mb-2">Не нашли нужное?</h3>
                                        <p className="text-unbox-grey text-sm px-4">
                                            Оставьте контакты, и мы уведомим вас первыми при появлении новых локаций и свободных окон.
                                        </p>
                                    </div>

                                    <form onSubmit={handleSubmit} className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-medium text-unbox-dark mb-1.5 ml-1">Ваше имя</label>
                                            <input
                                                type="text"
                                                required
                                                value={name}
                                                onChange={(e) => setName(e.target.value)}
                                                className="w-full px-4 py-3 bg-unbox-light/30 border border-unbox-light rounded-xl focus:ring-2 focus:ring-unbox-green focus:border-unbox-green transition-all outline-none"
                                                placeholder="Иван Иванов"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-unbox-dark mb-1.5 ml-1">Email</label>
                                            <input
                                                type="email"
                                                required
                                                value={email}
                                                onChange={(e) => setEmail(e.target.value)}
                                                className="w-full px-4 py-3 bg-unbox-light/30 border border-unbox-light rounded-xl focus:ring-2 focus:ring-unbox-green focus:border-unbox-green transition-all outline-none"
                                                placeholder="ivan@example.com"
                                            />
                                        </div>

                                        <button
                                            type="submit"
                                            disabled={submitWaitlist.isPending}
                                            className={clsx(
                                                "w-full mt-6 flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-white transition-all duration-300",
                                                submitWaitlist.isPending 
                                                    ? "bg-unbox-green/70 cursor-not-allowed" 
                                                    : "bg-unbox-green hover:bg-unbox-dark shadow-lg shadow-unbox-green/20 hover:shadow-unbox-green/40 hover:-translate-y-0.5"
                                            )}
                                        >
                                            {submitWaitlist.isPending ? (
                                                <>
                                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    Отправка...
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
