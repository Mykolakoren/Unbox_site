import { motion } from 'framer-motion';
import { Clock, Snowflake, Percent, ArrowRight, Check, Star, Users, Zap, Gift, Shield, MessageCircle, Sparkles } from 'lucide-react';

// ── Standard Prices ──────────────────────────────────────────────────────────
const STANDARD_PRICES = [
    { label: 'Индивидуальный кабинет', price: 20, unit: '₾/час', icon: '🏠', desc: 'Кабинеты 1–8' },
    { label: 'Групповой кабинет', price: 35, unit: '₾/час', icon: '👥', desc: 'До 20 человек' },
    { label: 'Капсула', price: 10, unit: '₾/час', icon: '🧘', desc: 'Приватное пространство' },
];

// ── Subscription Plans ───────────────────────────────────────────────────────
const SUBSCRIPTIONS = [
    {
        id: 'trial',
        name: 'Пробный',
        tagline: 'Попробуйте формат Unbox',
        hours: 4,
        capsuleHours: 1,
        price: 70,
        fullPrice: 90,
        discount: 22,
        duration: '14 дней',
        features: [
            'Любой индивидуальный кабинет',
            '1 час в капсуле в любое время',
        ],
        bonuses: [],
        color: 'from-slate-50 to-gray-100',
        borderColor: 'border-gray-200',
        accentColor: 'text-gray-600',
        badge: null,
        popular: false,
    },
    {
        id: 'warm-start',
        name: 'Тёплый старт',
        tagline: 'Уверенный старт практики',
        hours: 10,
        capsuleHours: 4,
        price: 180,
        fullPrice: 240,
        discount: 25,
        duration: '30 дней',
        features: [
            'Любой индивидуальный кабинет',
            '4 часа в капсуле в любое время',
            'Бесплатный перенос бронирований',
        ],
        bonuses: [],
        color: 'from-sky-50 to-blue-50',
        borderColor: 'border-sky-200',
        accentColor: 'text-sky-600',
        badge: null,
        popular: false,
    },
    {
        id: 'regular',
        name: 'Регулярный практик',
        tagline: 'Для стабильной практики',
        hours: 20,
        capsuleHours: 6,
        price: 350,
        fullPrice: 555,
        discount: 37,
        duration: '30 дней',
        features: [
            'Любой индивидуальный кабинет',
            '6 часов в капсуле в любое время',
            'Бесплатный перенос бронирований',
            'Размещение в каталоге Unbox',
        ],
        bonuses: [
            'Заморозка абонемента — 7 дней',
            'Кофе Меама — 5 капсул',
            'Скидка на книги — 25%',
            'Массаж ШВЗ после сессий — 1 сеанс',
        ],
        color: 'from-emerald-50 to-teal-50',
        borderColor: 'border-emerald-300',
        accentColor: 'text-emerald-600',
        badge: 'Популярный',
        popular: true,
    },
    {
        id: 'pro',
        name: 'Профи+',
        tagline: 'Максимум для профессионалов',
        hours: 40,
        capsuleHours: 10,
        price: 650,
        fullPrice: 1135,
        discount: 43,
        duration: '45 дней',
        features: [
            'Любой индивидуальный кабинет',
            '10 часов в капсуле в любое время',
            'Бесплатный перенос бронирований',
            'Перерывы 30 мин между сессиями бесплатно',
            'Размещение в каталоге Unbox',
        ],
        bonuses: [
            'Заморозка абонемента — 30 дней',
            'Кофе Меама — 10 капсул',
            'Съёмка рилз — 1 час в любом филиале',
            'Скидка на книги — 50%',
            'Массаж ШВЗ — 2 сеанса или фототерапия — 1 сеанс',
        ],
        color: 'from-amber-50 to-orange-50',
        borderColor: 'border-amber-300',
        accentColor: 'text-amber-600',
        badge: 'Максимум',
        popular: false,
    },
    {
        id: 'group',
        name: 'Групповой мастер',
        tagline: 'Для тренингов и воркшопов',
        hours: 20,
        capsuleHours: 0,
        bonusIndividualHours: 4,
        price: 450,
        fullPrice: 863,
        discount: 48,
        duration: '45 дней',
        features: [
            'Групповые кабинеты (до 20 чел.)',
            '4 часа в любом индивидуальном кабинете',
        ],
        bonuses: [
            'Съёмка рилз — 1 час в любом филиале',
            'Кофе Меама — 6 капсул',
            'Скидка на книги — 33%',
        ],
        color: 'from-violet-50 to-purple-50',
        borderColor: 'border-violet-300',
        accentColor: 'text-violet-600',
        badge: 'Группы',
        popular: false,
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
        description: 'Заморозка абонемента доступна от тарифа "Регулярный практик": 7 дней, "Профи+": 30 дней.',
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
        transition: { delay: i * 0.08, duration: 0.5 },
    }),
};

export function SubscriptionsPage() {
    return (
        <div className="max-w-7xl mx-auto px-4 py-8 md:py-16 space-y-16">
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
                    Экономьте до 48% на аренде кабинетов. Капсулы, кофе, массаж и другие бонусы — включены.
                </p>
            </motion.div>

            {/* Standard Prices */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="space-y-4"
            >
                <h2 className="text-center text-sm font-bold uppercase tracking-wider text-unbox-grey">
                    Стандартные цены без абонемента
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
                    {STANDARD_PRICES.map((sp) => (
                        <div
                            key={sp.label}
                            className="flex items-center gap-3 rounded-2xl px-5 py-4"
                            style={{
                                background: 'rgba(255,255,255,0.65)',
                                backdropFilter: 'blur(16px)',
                                WebkitBackdropFilter: 'blur(16px)',
                                border: '1px solid rgba(255,255,255,0.50)',
                                boxShadow: '0 2px 12px rgba(71,109,107,0.06)',
                            }}
                        >
                            <span className="text-2xl">{sp.icon}</span>
                            <div>
                                <div className="font-bold text-unbox-dark text-lg">{sp.price} {sp.unit}</div>
                                <div className="text-xs text-unbox-grey">{sp.label}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </motion.div>

            {/* Subscription Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {SUBSCRIPTIONS.map((sub, i) => (
                    <motion.div
                        key={sub.id}
                        custom={i}
                        initial="hidden"
                        animate="visible"
                        variants={cardAnim}
                        className={`relative rounded-2xl border-2 ${sub.borderColor} overflow-hidden transition-all hover:shadow-xl hover:-translate-y-1 flex flex-col ${
                            sub.popular ? 'ring-2 ring-unbox-green/40 shadow-lg md:-translate-y-2' : ''
                        }`}
                        style={{
                            background: 'rgba(255,255,255,0.80)',
                            backdropFilter: 'blur(20px) saturate(140%)',
                            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
                        }}
                    >
                        {/* Badge */}
                        {sub.badge && (
                            <div className={`absolute top-0 right-0 px-4 py-1.5 rounded-bl-xl text-xs font-bold text-white ${
                                sub.popular ? 'bg-unbox-green' : sub.id === 'group' ? 'bg-violet-500' : 'bg-amber-500'
                            }`}>
                                <Star size={12} className="inline mr-1 -mt-0.5" />
                                {sub.badge}
                            </div>
                        )}

                        {/* Header */}
                        <div className={`p-6 pb-4 bg-gradient-to-br ${sub.color}`}>
                            <h3 className="text-xl font-bold text-unbox-dark">{sub.name}</h3>
                            <p className="text-sm text-unbox-grey mt-0.5">{sub.tagline}</p>
                        </div>

                        {/* Body */}
                        <div className="p-6 pt-4 space-y-5 flex-1 flex flex-col">
                            {/* Price block */}
                            <div>
                                <div className="flex items-baseline gap-3">
                                    <span className="text-3xl font-bold text-unbox-dark">{sub.price} ₾</span>
                                    <span className="text-base text-gray-400 line-through">{sub.fullPrice} ₾</span>
                                    <span className="px-2.5 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                                        -{sub.discount}%
                                    </span>
                                </div>
                                <div className="text-xs text-unbox-grey mt-1">
                                    Экономия: {sub.fullPrice - sub.price} ₾
                                </div>
                            </div>

                            {/* Meta pills */}
                            <div className="flex flex-wrap gap-2">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-unbox-light/50 text-xs font-medium text-unbox-dark">
                                    <Clock size={13} className="text-unbox-green" />
                                    {sub.hours} ч {sub.id === 'group' ? 'груп.' : 'инд.'}
                                </div>
                                {sub.capsuleHours > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-violet-50 text-xs font-medium text-violet-700">
                                        <Sparkles size={13} />
                                        +{sub.capsuleHours} ч капсула
                                    </div>
                                )}
                                {(sub as any).bonusIndividualHours > 0 && (
                                    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-xs font-medium text-emerald-700">
                                        <Gift size={13} />
                                        +{(sub as any).bonusIndividualHours} ч инд.
                                    </div>
                                )}
                                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                                    <Shield size={13} />
                                    {sub.duration}
                                </div>
                            </div>

                            {/* Features */}
                            <div className="space-y-2">
                                <div className="text-[11px] font-bold text-unbox-dark/60 uppercase tracking-wider">Что включено</div>
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
                                    <div className="text-[11px] font-bold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                                        <Gift size={11} /> Подарки и бонусы
                                    </div>
                                    {sub.bonuses.map((b, j) => (
                                        <div key={j} className="flex items-start gap-2 text-sm text-gray-600">
                                            <Zap size={12} className="text-amber-500 mt-0.5 flex-shrink-0" />
                                            {b}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Spacer + CTA */}
                            <div className="flex-1" />
                            <a
                                href="https://t.me/UnboxCenter"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`block w-full text-center py-3.5 rounded-xl font-bold text-sm transition-all cursor-pointer ${
                                    sub.popular
                                        ? 'bg-unbox-green text-white hover:bg-unbox-dark shadow-md hover:shadow-lg'
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

            {/* Custom */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.8, duration: 0.5 }}
                className="rounded-2xl p-8 md:p-10 text-center space-y-4"
                style={{
                    background: 'rgba(255,255,255,0.75)',
                    backdropFilter: 'blur(20px)',
                    WebkitBackdropFilter: 'blur(20px)',
                    border: '1px solid rgba(71,109,107,0.20)',
                    boxShadow: '0 4px 20px rgba(71,109,107,0.08)',
                }}
            >
                <Users size={32} className="mx-auto text-unbox-green" />
                <h2 className="text-2xl font-bold text-unbox-dark">
                    Индивидуальные условия
                </h2>
                <p className="text-unbox-dark/60 max-w-lg mx-auto">
                    Нужно больше часов или особый формат? Мы подберём персональные условия для вашей практики.
                </p>
                <a
                    href="https://t.me/UnboxCenter"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-unbox-green text-white font-bold rounded-xl hover:bg-unbox-green/90 transition-colors shadow-md cursor-pointer"
                >
                    <MessageCircle size={18} />
                    Написать нам
                </a>
            </motion.div>
        </div>
    );
}
