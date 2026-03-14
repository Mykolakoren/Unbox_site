import { motion } from 'framer-motion';
import { Search, CalendarCheck, MapPin, ArrowRight } from 'lucide-react';

const STEPS = [
    {
        icon: Search,
        num: '01',
        title: 'Выберите специалиста',
        desc: 'Найдите психолога или терапевта по категории, формату и цене.',
        color: 'rgba(71,109,107,0.14)',
        borderColor: 'rgba(71,109,107,0.28)',
    },
    {
        icon: CalendarCheck,
        num: '02',
        title: 'Запишитесь на сеанс',
        desc: 'Выберите удобное время в расписании. Онлайн или в кабинете Unbox.',
        color: 'rgba(71,109,107,0.10)',
        borderColor: 'rgba(71,109,107,0.22)',
    },
    {
        icon: MapPin,
        num: '03',
        title: 'Приходите в Unbox',
        desc: 'Уютная атмосфера, конфиденциальность и профессиональный специалист.',
        color: 'rgba(71,109,107,0.08)',
        borderColor: 'rgba(71,109,107,0.18)',
    },
];

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(20px) saturate(150%)',
    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.65)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

export function HowItWorksSection() {
    return (
        <section className="max-w-6xl mx-auto px-6 py-14">
            <div className="border-t border-black/10 pt-14">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="text-center mb-12"
                >
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Как это работает</p>
                    <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Три шага к первой сессии</h2>
                    <p className="mt-2 text-unbox-dark/50 text-sm">Просто, быстро и комфортно</p>
                </motion.div>

                {/* Infographic: 3 steps with arrows */}
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto_1fr] gap-4 items-center">
                    {STEPS.map((step, i) => {
                        const Icon = step.icon;
                        return (
                            <>
                                <motion.div
                                    key={step.num}
                                    initial={{ opacity: 0, y: 24 }}
                                    whileInView={{ opacity: 1, y: 0 }}
                                    viewport={{ once: true }}
                                    transition={{ delay: i * 0.15 }}
                                    className="relative flex flex-col gap-4 p-7 rounded-3xl overflow-hidden"
                                    style={glassCard}
                                >
                                    {/* Big background number */}
                                    <span
                                        className="absolute top-2 right-4 text-8xl font-black select-none pointer-events-none leading-none"
                                        style={{ color: 'rgba(71,109,107,0.08)' }}
                                    >
                                        {step.num}
                                    </span>

                                    {/* Icon */}
                                    <div
                                        className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                                        style={{ background: step.color, border: `1px solid ${step.borderColor}` }}
                                    >
                                        <Icon size={22} className="text-unbox-green" />
                                    </div>

                                    <div>
                                        <div className="font-bold text-unbox-dark text-base mb-1.5">{step.title}</div>
                                        <div className="text-unbox-dark/55 text-sm leading-relaxed">{step.desc}</div>
                                    </div>
                                </motion.div>

                                {/* Arrow between steps — hidden on mobile */}
                                {i < STEPS.length - 1 && (
                                    <motion.div
                                        key={`arrow-${i}`}
                                        initial={{ opacity: 0 }}
                                        whileInView={{ opacity: 1 }}
                                        viewport={{ once: true }}
                                        transition={{ delay: i * 0.15 + 0.2 }}
                                        className="hidden sm:flex items-center justify-center"
                                    >
                                        <ArrowRight size={20} className="text-unbox-green/40" />
                                    </motion.div>
                                )}
                            </>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}
