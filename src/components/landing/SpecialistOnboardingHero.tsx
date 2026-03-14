import { motion } from 'framer-motion';
import { ArrowRight, Building2, Users, UserCheck, MessageCircle } from 'lucide-react';

const glassPanel: React.CSSProperties = {
    background: 'rgba(255,255,255,0.52)',
    backdropFilter: 'blur(36px) saturate(160%)',
    WebkitBackdropFilter: 'blur(36px) saturate(160%)',
    border: '1px solid rgba(255,255,255,0.72)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,0.60)',
};

const glassStep: React.CSSProperties = {
    background: 'rgba(255,255,255,0.62)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: '1px solid rgba(255,255,255,0.78)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

const STEPS = [
    {
        num: '01',
        icon: UserCheck,
        title: 'Оставьте заявку',
        desc: 'Заполните форму — укажите специализацию и формат работы',
    },
    {
        num: '02',
        icon: MessageCircle,
        title: 'Мы с вами свяжемся',
        desc: 'Ответим в течение 2 рабочих дней и включим доступ к дополнительным опциям',
    },
    {
        num: '03',
        icon: Building2,
        title: 'Бронируйте кабинет',
        desc: 'Выбирайте удобное время почасово в любой из локаций Батуми',
    },
    {
        num: '04',
        icon: Users,
        title: 'Принимайте клиентов',
        desc: 'Офлайн в кабинете или онлайн — как вам удобно',
    },
];

const FACTS = [
    { value: '2', label: 'локации\nв Батуми' },
    { value: '6+', label: 'форматов\nпространств' },
    { value: '0₾', label: 'абонплата\nпочасово' },
    { value: '24/7', label: 'доступ\nдля резидентов' },
];

interface Props {
    onApply: () => void;
}

export function SpecialistOnboardingHero({ onApply }: Props) {
    return (
        <div className="w-full flex flex-col gap-5">
            {/* ── Header card ── */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.05 }}
                className="rounded-[28px] px-8 py-8"
                style={glassPanel}
            >
                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-3">Для специалистов</p>
                <h1 className="text-2xl sm:text-3xl font-black text-unbox-dark leading-tight mb-3">
                    Работайте в пространстве,<br className="hidden sm:block" /> созданном для вас
                </h1>
                <p className="text-unbox-dark/70 text-sm leading-relaxed mb-6 max-w-md">
                    Unbox — сервис почасовой аренды кабинетов для психологов, терапевтов,
                    коучей и педагогов в Батуми. Гибкое расписание, сообщество коллег.
                </p>

                {/* Facts row */}
                <div className="grid grid-cols-4 gap-3 mb-6">
                    {FACTS.map((f) => (
                        <div
                            key={f.label}
                            className="rounded-2xl px-3 py-3 text-center"
                            style={{ background: 'rgba(71,109,107,0.08)', border: '1px solid rgba(71,109,107,0.16)' }}
                        >
                            <div className="text-xl font-black text-unbox-dark leading-none mb-1">{f.value}</div>
                            <div className="text-unbox-dark/55 text-[10px] leading-tight whitespace-pre-line">{f.label}</div>
                        </div>
                    ))}
                </div>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-3">
                    <button
                        onClick={onApply}
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm text-white bg-unbox-green hover:bg-unbox-dark transition-all hover:-translate-y-0.5 shadow-lg shadow-unbox-green/20"
                    >
                        Оставить заявку
                        <ArrowRight size={15} />
                    </button>
                    <a
                        href="https://t.me/UnboxCenter"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 px-6 py-3 rounded-2xl font-semibold text-sm text-unbox-dark/80 hover:text-unbox-dark transition-all hover:-translate-y-0.5"
                        style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid rgba(0,0,0,0.08)' }}
                    >
                        Связаться с нами
                    </a>
                </div>
            </motion.div>

            {/* ── Steps infographic ── */}
            <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="rounded-[24px] px-6 py-5"
                style={glassStep}
            >
                <p className="text-unbox-dark/45 text-[10px] font-bold uppercase tracking-widest mb-4">Как стать резидентом</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {STEPS.map((step, i) => {
                        const Icon = step.icon;
                        return (
                            <motion.div
                                key={step.num}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.2 + i * 0.07 }}
                                className="relative flex flex-col gap-2"
                            >
                                {/* Connector line */}
                                {i < STEPS.length - 1 && (
                                    <div
                                        className="hidden sm:block absolute top-4 left-[calc(100%+6px)] w-[calc(100%-12px)] h-px"
                                        style={{ background: 'rgba(71,109,107,0.20)' }}
                                    />
                                )}

                                <div className="flex items-center gap-2 mb-1">
                                    <div
                                        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                                        style={{ background: 'rgba(71,109,107,0.12)', border: '1px solid rgba(71,109,107,0.22)' }}
                                    >
                                        <Icon size={15} className="text-unbox-green" />
                                    </div>
                                    <span className="text-unbox-green/50 text-xs font-black">{step.num}</span>
                                </div>
                                <div className="font-bold text-unbox-dark text-xs leading-tight">{step.title}</div>
                                <div className="text-unbox-dark/60 text-[11px] leading-relaxed">{step.desc}</div>
                            </motion.div>
                        );
                    })}
                </div>
            </motion.div>
        </div>
    );
}
