import { motion } from 'framer-motion';
import { Building2, Clock, Users, Shield, Wifi, Globe } from 'lucide-react';
import { useState } from 'react';

const BENEFITS = [
    {
        icon: Building2,
        title: 'Готовая инфраструктура',
        desc: 'Оборудованные кабинеты, капсулы, переговорные. Ничего лишнего — только комфорт.',
        detail: 'Мебель, освещение, звукоизоляция — всё уже настроено под работу специалиста.',
        color: 'rgba(71,109,107,1)',
        bg: 'rgba(71,109,107,0.10)',
        bgHover: 'rgba(71,109,107,0.18)',
    },
    {
        icon: Clock,
        title: 'Гибкое расписание',
        desc: 'Бронируй почасово. Работай в удобное время без долгосрочных обязательств.',
        detail: 'Доступно 24/7. Отмена за 24 часа без штрафа.',
        color: 'rgba(99,102,241,1)',
        bg: 'rgba(99,102,241,0.08)',
        bgHover: 'rgba(99,102,241,0.15)',
    },
    {
        icon: Users,
        title: 'Сообщество коллег',
        desc: 'Контакт с другими специалистами, совместные проекты и профессиональный обмен.',
        detail: 'Закрытый чат, совместные мероприятия и групповые супервизии.',
        color: 'rgba(245,158,11,1)',
        bg: 'rgba(245,158,11,0.08)',
        bgHover: 'rgba(245,158,11,0.15)',
    },
    {
        icon: Globe,
        title: 'Онлайн и оффлайн',
        desc: 'Принимай клиентов лично в кабинете или проводи сессии онлайн — как тебе удобно.',
        detail: 'Стабильный интернет, веб-камера и профессиональный фон включены.',
        color: 'rgba(16,185,129,1)',
        bg: 'rgba(16,185,129,0.08)',
        bgHover: 'rgba(16,185,129,0.15)',
    },
    {
        icon: Shield,
        title: 'Безопасная среда',
        desc: 'Конфиденциальность, охрана, продуманная организация пространства.',
        detail: 'Отдельный вход, изолированные зоны ожидания, охрана 24/7.',
        color: 'rgba(239,68,68,1)',
        bg: 'rgba(239,68,68,0.07)',
        bgHover: 'rgba(239,68,68,0.13)',
    },
    {
        icon: Wifi,
        title: 'Всё включено',
        desc: 'Wi-Fi, чай, кофе, канцелярия. Ты просто приходишь и работаешь.',
        detail: 'Никаких скрытых доплат. Цена аренды — всё что ты платишь.',
        color: 'rgba(59,130,246,1)',
        bg: 'rgba(59,130,246,0.08)',
        bgHover: 'rgba(59,130,246,0.15)',
    },
];

const containerVariants = {
    hidden: {},
    visible: { transition: { staggerChildren: 0.07 } },
};

const cardVariants = {
    hidden: { opacity: 0, y: 24 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } },
};

function BenefitCard({ b, i }: { b: typeof BENEFITS[0]; i: number }) {
    const [hovered, setHovered] = useState(false);
    const Icon = b.icon;

    return (
        <motion.div
            variants={cardVariants}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onHoverStart={() => setHovered(true)}
            onHoverEnd={() => setHovered(false)}
            className="relative flex flex-col gap-4 p-6 rounded-3xl cursor-default overflow-hidden"
            style={{
                background: hovered
                    ? 'rgba(255,255,255,0.72)'
                    : 'rgba(255,255,255,0.52)',
                backdropFilter: 'blur(24px) saturate(160%)',
                WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                border: hovered
                    ? `1px solid ${b.color.replace('1)', '0.35)')}`
                    : '1px solid rgba(255,255,255,0.70)',
                boxShadow: hovered
                    ? `0 16px 48px rgba(0,0,0,0.10), 0 0 0 1px ${b.color.replace('1)', '0.12)')}`
                    : '0 4px 20px rgba(0,0,0,0.05)',
                transition: 'background 0.25s ease, border 0.25s ease, box-shadow 0.25s ease',
            }}
        >
            {/* Background number */}
            <span
                className="absolute right-4 bottom-2 text-7xl font-black select-none pointer-events-none leading-none"
                style={{ color: b.color.replace('1)', '0.05)') }}
            >
                {String(i + 1).padStart(2, '0')}
            </span>

            {/* Icon */}
            <motion.div
                animate={{
                    background: hovered ? b.bgHover : b.bg,
                    scale: hovered ? 1.12 : 1,
                }}
                transition={{ duration: 0.25 }}
                className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                style={{ border: `1px solid ${b.color.replace('1)', '0.20)')}` }}
            >
                <Icon size={20} style={{ color: b.color }} />
            </motion.div>

            {/* Text */}
            <div className="relative z-10">
                <div className="font-bold text-unbox-dark text-sm mb-1.5">{b.title}</div>
                <div className="text-unbox-dark/55 text-xs leading-relaxed">{b.desc}</div>

                {/* Detail — appears on hover */}
                <motion.div
                    initial={{ opacity: 0, height: 0, marginTop: 0 }}
                    animate={hovered
                        ? { opacity: 1, height: 'auto', marginTop: 10 }
                        : { opacity: 0, height: 0, marginTop: 0 }
                    }
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                >
                    <div
                        className="text-xs px-3 py-2 rounded-xl leading-relaxed font-medium"
                        style={{
                            background: b.bg,
                            color: b.color,
                            border: `1px solid ${b.color.replace('1)', '0.15)')}`,
                        }}
                    >
                        {b.detail}
                    </div>
                </motion.div>
            </div>
        </motion.div>
    );
}

export function WhyUnboxSection() {
    return (
        <section className="max-w-6xl mx-auto px-6 pt-14 pb-10">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-center mb-10"
            >
                <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Почему Unbox</p>
                <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark leading-tight">
                    Пространство, созданное для практики
                </h2>
                <p className="mt-2 text-unbox-dark/55 text-sm max-w-lg mx-auto">
                    Всё что нужно специалисту — в одном месте. Никакого лишнего шума.
                </p>
            </motion.div>

            <motion.div
                variants={containerVariants}
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, margin: '-60px' }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
            >
                {BENEFITS.map((b, i) => (
                    <BenefitCard key={b.title} b={b} i={i} />
                ))}
            </motion.div>
        </section>
    );
}
