import { motion } from 'framer-motion';
import { Clock, Snowflake, Percent, ArrowRight, Check, Star, Users, Zap, Gift, Shield, MessageCircle } from 'lucide-react';

const SUBSCRIPTIONS = [
    {
        id: 'trial',
        name: 'Пробный',
        hours: 3,
        rate: 20,
        discount: 10,
        price: 54,
        fullPrice: 60,
        duration: '14 дней',
        audience: 'Для тех, кто хочет попробовать',
        description: 'Идеальный старт — протестируйте формат работы в Unbox без обязательств.',
        features: ['Любой кабинет или капсула', '14 дней на использование'],
        bonuses: [],
        color: 'from-gray-50 to-gray-100',
        borderColor: 'border-gray-200',
        badge: null,
    },
    {
        id: 'warm-start',
        name: 'Тёплый старт',
        hours: 10,
        rate: 20,
        discount: 10,
        price: 180,
        fullPrice: 200,
        duration: '30 дней',
        audience: 'Для начинающих специалистов',
        description: 'Начните практику с комфортом — 10 часов по выгодной цене.',
        features: ['Любой кабинет или капсула', '30 дней на использование'],
        bonuses: [],
        color: 'from-blue-50 to-indigo-50',
        borderColor: 'border-blue-200',
        badge: null,
    },
    {
        id: 'regular',
        name: 'Регулярный практик',
        hours: 20,
        rate: 20,
        discount: 15,
        price: 340,
        fullPrice: 400,
        duration: '30 дней',
        audience: 'Для специалистов с клиентской базой',
        description: 'Устойчивая практика — фиксированное или гибкое расписание.',
        features: ['Фиксированное или гибкое расписание', '30 дней на использование'],
        bonuses: ['Бесплатная перепланировка 1 раз', 'Размещение в списке специалистов Unbox'],
        color: 'from-emerald-50 to-teal-50',
        borderColor: 'border-emerald-200',
        badge: null,
    },
    {
        id: 'pro',
        name: 'Профи+',
        hours: 40,
        rate: 20,
        discount: 20,
        price: 640,
        fullPrice: 800,
        duration: '45 дней',
        audience: 'Для активно практикующих',
        description: 'Максимум возможностей для интенсивной практики.',
        features: ['Любые кабинеты, включая групповые', '45 дней на использование'],
        bonuses: [
            'Приоритетное бронирование',
            '2 бесплатных часа в подарок',
            'Доступ в капсулу вне графика',
            'Размещение в списке специалистов Unbox',
        ],
        color: 'from-amber-50 to-orange-50',
        borderColor: 'border-amber-300',
        badge: 'Популярный',
    },
    {
        id: 'group',
        name: 'Групповой мастер',
        hours: 16,
        rate: 35,
        discount: 25,
        price: 420,
        fullPrice: 560,
        duration: '30 дней',
        audience: 'Для тренеров и коучей',
        description: 'Специально для групповой работы — тренинги, воркшопы, мастермайнды.',
        features: ['Групповые кабинеты (до 20 чел.)', '30 дней на использование'],
        bonuses: ['Рассылка мероприятия по базе Unbox'],
        color: 'from-purple-50 to-pink-50',
        borderColor: 'border-purple-200',
        badge: 'Группы',
    },
];

const CONDITIONS = [
    {
        icon: Clock,
        title: 'Перенос часов',
        description: 'Неиспользованные часы переносятся на следующий абонемент при продлении в течение 7 дней.',
    },
    {
        icon: Snowflake,
        title: 'Заморозка',
        description: 'Возможна заморозка на 7 дней в течение действия абонемента.',
    },
    {
        icon: Percent,
        title: 'Доп. часы со скидкой',
        description: 'При превышении лимита действует ваша текущая скидка на дополнительные часы.',
    },
];

const cardAnim = {
    hidden: { opacity: 0, y: 30 },
    visible: (i: number) => ({
        opacity: 1,
        y: 0,
        transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] },
    }),
};

export function SubscriptionsPage() {
    return (
        <div className="max-w-6xl mx-auto px-4 py-8 md:py-16 space-y-16">
            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="text-center space-y-4"
            >
                <h1 className="text-4xl md:text-5xl font-bold text-unbox-dark">
                    Абонементы <span className="text-unbox-green">Unbox</span>
                </h1>
                <p className="text-lg text-unbox-grey max-w-2xl mx-auto">
                    Выберите подходящий абонемент для вашей практики. Экономьте до 25% на аренде кабинетов.
                </p>
            </motion.div>

            {/* Subscription Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {SUBSCRIPTIONS.map((sub, i) => (
                    <motion.div
                        key={sub.id}
                        custom={i}
                        initial="hidden"
                        animate="visible"
                        variants={cardAnim}
                        className={`relative rounded-2xl border-2 ${sub.borderColor} overflow-hidden transition-all hover:shadow-xl hover:-translate-y-1 ${
                            sub.badge === 'Популярный' ? 'ring-2 ring-unbox-green/40 shadow-lg' : ''
                        }`}
                        style={{
                            background: 'rgba(255,255,255,0.75)',
                            backdropFilter: 'blur(20px) saturate(140%)',
                            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
                        }}
                    >
                        {sub.badge && (
                            <div className={`absolute top-0 right-0 px-4 py-1.5 rounded-bl-xl text-xs font-bold text-white ${
                                sub.badge === 'Популярный' ? 'bg-unbox-green' : 'bg-purple-500'
                            }`}>
                                <Star size={12} className="inline mr-1 -mt-0.5" />
                                {sub.badge}
                            </div>
                        )}

                        <div className={`p-6 bg-gradient-to-br ${sub.color}`}>
                            <h3 className="text-xl font-bold text-unbox-dark">{sub.name}</h3>
                            <p className="text-sm text-unbox-grey mt-1">{sub.audience}</p>
                        </div>

                        <div className="p-6 space-y-5">
                            {/* Price */}
                            <div className="flex items-baseline gap-3">
                                <span className="text-3xl font-bold text-unbox-dark">{sub.price} ₾</span>
                                <span className="text-lg text-gray-400 line-through">{sub.fullPrice} ₾</span>
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                                    -{sub.discount}%
                                </span>
                            </div>

                            {/* Meta */}
                            <div className="flex items-center gap-4 text-sm text-unbox-grey">
                                <div className="flex items-center gap-1.5">
                                    <Clock size={14} className="text-unbox-green" />
                                    {sub.hours} часов
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <Shield size={14} className="text-unbox-green" />
                                    {sub.duration}
                                </div>
                            </div>

                            {/* Description */}
                            <p className="text-sm text-gray-600 leading-relaxed">{sub.description}</p>

                            {/* Features */}
                            <div className="space-y-2">
                                {sub.features.map((f, j) => (
                                    <div key={j} className="flex items-start gap-2 text-sm text-gray-700">
                                        <Check size={14} className="text-unbox-green mt-0.5 flex-shrink-0" />
                                        {f}
                                    </div>
                                ))}
                            </div>

                            {/* Bonuses */}
                            {sub.bonuses.length > 0 && (
                                <div className="pt-3 border-t border-gray-100 space-y-2">
                                    <div className="text-xs font-bold text-unbox-green uppercase tracking-wider flex items-center gap-1">
                                        <Gift size={12} /> Бонусы
                                    </div>
                                    {sub.bonuses.map((b, j) => (
                                        <div key={j} className="flex items-start gap-2 text-sm text-gray-600">
                                            <Zap size={12} className="text-amber-500 mt-0.5 flex-shrink-0" />
                                            {b}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* CTA */}
                            <a
                                href="https://t.me/UnboxCenter"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`block w-full text-center py-3 rounded-xl font-bold text-sm transition-all ${
                                    sub.badge === 'Популярный'
                                        ? 'bg-unbox-green text-white hover:bg-unbox-green/90 shadow-md'
                                        : 'bg-unbox-light text-unbox-dark hover:bg-unbox-green hover:text-white'
                                }`}
                            >
                                Оформить
                                <ArrowRight size={14} className="inline ml-1.5 -mt-0.5" />
                            </a>
                        </div>
                    </motion.div>
                ))}
            </div>

            {/* Flexible Conditions */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6, duration: 0.5 }}
                className="space-y-6"
            >
                <h2 className="text-2xl font-bold text-unbox-dark text-center">
                    Гибкие условия
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    {CONDITIONS.map((cond, i) => (
                        <div
                            key={i}
                            className="rounded-2xl p-6 space-y-3"
                            style={{
                                background: 'rgba(255,255,255,0.65)',
                                backdropFilter: 'blur(16px) saturate(130%)',
                                WebkitBackdropFilter: 'blur(16px) saturate(130%)',
                                border: '1px solid rgba(255,255,255,0.50)',
                                boxShadow: '0 4px 16px rgba(71,109,107,0.06)',
                            }}
                        >
                            <div className="w-10 h-10 rounded-xl bg-unbox-light/70 flex items-center justify-center text-unbox-green">
                                <cond.icon size={20} />
                            </div>
                            <h3 className="font-bold text-unbox-dark">{cond.title}</h3>
                            <p className="text-sm text-unbox-grey leading-relaxed">{cond.description}</p>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* For Groups */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.5 }}
                className="rounded-2xl p-8 md:p-10 text-center space-y-4"
                style={{
                    background: 'rgba(71,109,107,0.08)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(71,109,107,0.15)',
                }}
            >
                <Users size={32} className="mx-auto text-unbox-green" />
                <h2 className="text-2xl font-bold text-unbox-dark">
                    Индивидуальные условия
                </h2>
                <p className="text-unbox-grey max-w-lg mx-auto">
                    Нужно больше часов или особый формат? Мы подберём персональные условия для вашей практики.
                </p>
                <a
                    href="https://t.me/UnboxCenter"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-unbox-green text-white font-bold rounded-xl hover:bg-unbox-green/90 transition-colors shadow-md"
                >
                    <MessageCircle size={18} />
                    Написать нам
                </a>
            </motion.div>
        </div>
    );
}
