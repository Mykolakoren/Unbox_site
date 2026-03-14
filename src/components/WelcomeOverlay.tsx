import { motion } from 'framer-motion';
import { User, Briefcase, ArrowRight } from 'lucide-react';

interface Props {
    onSelect: (mode: 'client' | 'specialist') => void;
}

export function WelcomeOverlay({ onSelect }: Props) {
    return (
        <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.04 }}
            transition={{ duration: 0.5 }}
            className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-6"
        >
            {/* Background */}
            <div className="absolute inset-0">
                <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover object-[center_45%]" />
                <div className="absolute inset-0" style={{ background: 'rgba(8,18,12,0.78)' }} />
            </div>

            {/* Content */}
            <div className="relative z-10 flex flex-col items-center w-full max-w-2xl">
                {/* Logo */}
                <motion.div
                    initial={{ opacity: 0, y: -20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.5 }}
                    className="mb-8"
                >
                    <img src="/unbox-logo.png" alt="Unbox" className="h-20 object-contain drop-shadow-xl" />
                </motion.div>

                {/* Headline */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, duration: 0.5 }}
                    className="text-center mb-10"
                >
                    <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                        Добро пожаловать
                    </h1>
                    <p className="text-white/50 text-sm sm:text-base">
                        Расскажите нам немного о себе, чтобы мы показали нужное
                    </p>
                </motion.div>

                {/* Choice cards */}
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5, duration: 0.45 }}
                    className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full"
                >
                    {/* Client card */}
                    <button
                        onClick={() => onSelect('client')}
                        className="group flex flex-col items-start gap-4 p-6 rounded-3xl text-left transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1"
                        style={{
                            background: 'rgba(255,255,255,0.08)',
                            backdropFilter: 'blur(24px)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
                        }}
                    >
                        <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center"
                            style={{ background: 'rgba(71,109,107,0.30)', border: '1px solid rgba(71,109,107,0.5)' }}
                        >
                            <User size={22} className="text-unbox-green" />
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-white text-lg leading-tight mb-1">
                                Я клиент
                            </div>
                            <div className="text-white/45 text-sm leading-relaxed">
                                Ищу специалиста или хочу арендовать кабинет для работы
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-unbox-green text-sm font-semibold group-hover:gap-3 transition-all">
                            Продолжить <ArrowRight size={15} />
                        </div>
                    </button>

                    {/* Specialist card */}
                    <button
                        onClick={() => onSelect('specialist')}
                        className="group flex flex-col items-start gap-4 p-6 rounded-3xl text-left transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1"
                        style={{
                            background: 'rgba(255,255,255,0.08)',
                            backdropFilter: 'blur(24px)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.20)',
                        }}
                    >
                        <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center"
                            style={{ background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.18)' }}
                        >
                            <Briefcase size={22} className="text-white/70" />
                        </div>
                        <div className="flex-1">
                            <div className="font-bold text-white text-lg leading-tight mb-1">
                                Я специалист
                            </div>
                            <div className="text-white/45 text-sm leading-relaxed">
                                Психолог, терапевт или коуч — ищу пространство для практики
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-white/50 text-sm font-semibold group-hover:gap-3 group-hover:text-white/70 transition-all">
                            Продолжить <ArrowRight size={15} />
                        </div>
                    </button>
                </motion.div>

                {/* Skip */}
                <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                    className="mt-8 text-white/25 text-xs"
                >
                    Выбор сохранится для следующих визитов
                </motion.p>
            </div>
        </motion.div>
    );
}
