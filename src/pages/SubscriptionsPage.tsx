import { motion } from 'framer-motion';
import { Clock, Snowflake, Percent, ArrowRight, Check, Star, Users, Zap, Gift, Shield, MessageCircle, Sparkles, TrendingUp, Timer, Flame, Award, ChevronRight, BarChart3 } from 'lucide-react';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

// ── Standard Prices ──────────────────────────────────────────────────────────
const STANDARD_PRICES = [
    { label: 'Индивидуальный кабинет', price: 20, unit: '₾/час', icon: 'cabinet', desc: 'Кабинеты 1–8' },
    { label: 'Групповой кабинет', price: 35, unit: '₾/час', icon: 'group', desc: 'До 20 человек' },
    { label: 'Капсула', price: 10, unit: '₾/час', icon: 'capsule', desc: 'Приватное пространство' },
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
    const gridHouse = useDesignFlag();

    if (gridHouse) return <GridHouseSubscriptions />;

    return (
        <div className="max-w-7xl mx-auto px-4 py-8 md:py-16 space-y-16">
            {/* Hero */}
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="text-center space-y-4"
            >
                <div className="inline-block px-8 py-5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' }}>
                    <h1 className="text-4xl md:text-5xl font-bold text-unbox-dark">
                        Тарифы и скидки <span className="text-unbox-green">Unbox</span>
                    </h1>
                    <p className="text-lg text-unbox-dark/60 max-w-2xl mx-auto mt-3">
                        Прозрачная система скидок — до 50%. Абонементы, кофе, массаж и другие бонусы — включены.
                    </p>
                </div>
            </motion.div>

            {/* Standard Prices */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.2, duration: 0.5 }}
                className="space-y-4"
            >
                <h2 className="text-center text-sm font-bold uppercase tracking-wider text-unbox-dark/70">
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
                            <div className="w-10 h-10 rounded-xl bg-unbox-green/10 flex items-center justify-center text-unbox-green flex-shrink-0">
                                {sp.icon === 'cabinet' ? <Users size={20} /> : sp.icon === 'group' ? <Users size={20} /> : <Zap size={20} />}
                            </div>
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

            {/* ═══ Pricing & Discounts Infographic ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.7, duration: 0.5 }}
                className="space-y-8"
            >
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-unbox-dark">Как работают скидки</h2>
                    <p className="text-sm text-unbox-grey max-w-xl mx-auto">
                        В Unbox действует прогрессивная система скидок. Чем больше вы бронируете — тем выгоднее каждый час. Скидки не суммируются: применяется одна — самая выгодная для вас.
                    </p>
                </div>

                {/* Discount types */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

                    {/* 1. Weekly Progressive */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                                <TrendingUp size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Прогрессивная скидка за объём</h3>
                                <p className="text-xs text-unbox-grey">Считается автоматически за неделю (Пн–Вс)</p>
                            </div>
                        </div>
                        <div className="space-y-2">
                            {[
                                { hours: '0–5 ч', percent: '0%', bar: 'w-0', color: 'bg-gray-200' },
                                { hours: '5–11 ч', percent: '10%', bar: 'w-1/4', color: 'bg-emerald-300' },
                                { hours: '11–16 ч', percent: '25%', bar: 'w-2/4', color: 'bg-emerald-400' },
                                { hours: '16+ ч', percent: '50%', bar: 'w-full', color: 'bg-emerald-500' },
                            ].map(tier => (
                                <div key={tier.hours} className="flex items-center gap-3">
                                    <span className="text-xs text-unbox-grey w-14 shrink-0">{tier.hours}</span>
                                    <div className="flex-1 h-5 bg-gray-100 rounded-full overflow-hidden relative">
                                        <div className={`h-full ${tier.color} rounded-full transition-all ${tier.bar}`} />
                                    </div>
                                    <span className="text-sm font-bold text-unbox-dark w-10 text-right">{tier.percent}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-unbox-grey italic">
                            Пример: при 12 часах за неделю каждый час стоит 15 ₾ вместо 20 ₾
                        </p>
                    </div>

                    {/* 2. Duration discount */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                <Timer size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Скидка за длительность сессии</h3>
                                <p className="text-xs text-unbox-grey">Бронируете больше — платите меньше за час</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {[
                                { label: '2 часа подряд', percent: '10%' },
                                { label: '3 часа подряд', percent: '15%' },
                                { label: '4+ часа подряд', percent: '20%' },
                            ].map(tier => (
                                <div key={tier.label} className="flex items-center gap-3 bg-blue-50/50 rounded-xl px-4 py-2.5">
                                    <Timer size={16} className="text-blue-500 flex-shrink-0" />
                                    <span className="text-sm text-unbox-dark flex-1">{tier.label}</span>
                                    <span className="text-sm font-bold text-blue-600 bg-blue-100 px-2.5 py-0.5 rounded-full">-{tier.percent}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* 3. Hot Booking */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
                                <Flame size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Горячая бронь</h3>
                                <p className="text-xs text-unbox-grey">Скидка 10% при бронировании менее чем за 12 часов</p>
                            </div>
                        </div>
                        <div className="bg-orange-50/60 rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2">
                                <Flame size={16} className="text-orange-500" />
                                <span className="text-sm text-unbox-dark font-medium">-10% на любой кабинет</span>
                            </div>
                            <p className="text-xs text-unbox-grey leading-relaxed">
                                Если до сессии осталось менее 12 часов, бронь стоит дешевле. Невозвратная и без переноса — но по лучшей цене.
                            </p>
                        </div>
                    </div>

                    {/* 4. Personal / Subscription */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
                                <Award size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Персональная скидка & Абонемент</h3>
                                <p className="text-xs text-unbox-grey">Фиксированная скидка или оплата часами</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            <div className="flex items-center gap-3 bg-violet-50/50 rounded-xl px-4 py-2.5">
                                <Star size={16} className="text-violet-500" />
                                <span className="text-sm text-unbox-dark flex-1">Абонемент — фиксированная цена за час</span>
                                <span className="text-xs font-bold text-violet-600">Приоритет 1</span>
                            </div>
                            <div className="flex items-center gap-3 bg-violet-50/50 rounded-xl px-4 py-2.5">
                                <Award size={16} className="text-violet-500" />
                                <span className="text-sm text-unbox-dark flex-1">Персональная скидка — индивидуально</span>
                                <span className="text-xs font-bold text-violet-600">до 50%</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Priority order */}
                <div className="rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-unbox-light text-unbox-green flex items-center justify-center">
                            <BarChart3 size={20} />
                        </div>
                        <div>
                            <h3 className="font-bold text-unbox-dark">Порядок применения скидок</h3>
                            <p className="text-xs text-unbox-grey">Применяется одна скидка — самая выгодная для вас</p>
                        </div>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-0">
                        {[
                            { label: 'Абонемент', desc: 'Фиксированная цена', color: 'bg-violet-100 text-violet-700 border-violet-200' },
                            { label: 'Персональная', desc: 'Индивидуальный %', color: 'bg-purple-100 text-purple-700 border-purple-200' },
                            { label: 'За объём', desc: 'Недельные часы', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
                            { label: 'За длительность', desc: '2+ часа подряд', color: 'bg-blue-100 text-blue-700 border-blue-200' },
                            { label: 'Горячая бронь', desc: 'Менее 12ч', color: 'bg-orange-100 text-orange-700 border-orange-200' },
                        ].map((step, i) => (
                            <div key={step.label} className="flex items-center gap-2 flex-1">
                                <div className={`flex-1 rounded-xl border px-3 py-2.5 text-center ${step.color}`}>
                                    <div className="text-xs font-bold">{step.label}</div>
                                    <div className="text-[10px] opacity-70">{step.desc}</div>
                                </div>
                                {i < 4 && (
                                    <ChevronRight size={14} className="text-unbox-grey shrink-0 hidden sm:block" />
                                )}
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-unbox-grey mt-3 text-center">
                        Система автоматически выбирает лучший вариант. Скидки не суммируются между собой.
                    </p>
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

/* ═══════════════════════════════════════════════════════════════
   Grid House — SubscriptionsPage
   ═══════════════════════════════════════════════════════════════ */

const ghsubMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghsubHairline = `1px solid ${GH.ink10}`;

function GridHouseSubscriptions() {
    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, maxWidth: 1100, margin: '0 auto', padding: '48px 24px 80px' }}>
            {/* Header */}
            <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 48, textAlign: 'center' }}>
                <div style={{ ...ghsubMono, color: GH.ink30, marginBottom: 8 }}>ТАРИФЫ</div>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                    Тарифы и скидки Unbox
                </h1>
                <p style={{ fontSize: 15, color: GH.ink60, maxWidth: 560, margin: '0 auto' }}>
                    Прозрачная система скидок — до 50%. Абонементы, кофе, массаж и другие бонусы — включены.
                </p>
            </div>

            {/* Standard prices */}
            <div style={{ marginBottom: 48 }}>
                <div style={{ ...ghsubMono, color: GH.ink30, marginBottom: 16 }}>СТАНДАРТНЫЕ ЦЕНЫ</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0, border: ghsubHairline }}>
                    {STANDARD_PRICES.map((p, i) => (
                        <div key={i} style={{ padding: '20px 16px', borderRight: i < STANDARD_PRICES.length - 1 ? ghsubHairline : 'none' }}>
                            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{p.label}</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 28, fontWeight: 700, color: GH.ink }}>
                                {p.price} <span style={{ fontSize: 14, color: GH.ink30 }}>{p.unit}</span>
                            </div>
                            <div style={{ fontSize: 12, color: GH.ink30, marginTop: 4 }}>{p.desc}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Subscription plans */}
            <div style={{ ...ghsubMono, color: GH.ink30, marginBottom: 16 }}>АБОНЕМЕНТЫ</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 48 }}>
                {SUBSCRIPTIONS.map(plan => (
                    <div key={plan.id} style={{ border: plan.popular ? `2px solid ${GH.ink}` : ghsubHairline, padding: 24, display: 'flex', flexDirection: 'column' }}>
                        {plan.badge && (
                            <span style={{ ...ghsubMono, color: plan.popular ? GH.accent : GH.ink30, fontSize: 9, marginBottom: 8 }}>
                                {plan.badge.toUpperCase()}
                            </span>
                        )}
                        <div style={{ fontWeight: 800, fontSize: 20, marginBottom: 4 }}>{plan.name}</div>
                        <div style={{ fontSize: 13, color: GH.ink60, marginBottom: 16 }}>{plan.tagline}</div>

                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                            <span style={{ fontFamily: GH_MONO, fontSize: 36, fontWeight: 700 }}>{plan.price}</span>
                            <span style={{ fontSize: 14, color: GH.ink30 }}>₾</span>
                            {plan.fullPrice > plan.price && (
                                <span style={{ fontFamily: GH_MONO, fontSize: 14, color: GH.ink30, textDecoration: 'line-through' }}>
                                    {plan.fullPrice} ₾
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                            <span style={{ ...ghsubMono, fontSize: 9, color: GH.accent, padding: '2px 8px', border: `1px solid ${GH.accent}30` }}>
                                −{plan.discount}%
                            </span>
                            <span style={{ ...ghsubMono, fontSize: 9, color: GH.ink30, padding: '2px 8px', border: ghsubHairline }}>
                                {plan.hours} ЧАСОВ
                            </span>
                            <span style={{ ...ghsubMono, fontSize: 9, color: GH.ink30, padding: '2px 8px', border: ghsubHairline }}>
                                {plan.duration.toUpperCase()}
                            </span>
                        </div>

                        <div style={{ flex: 1, borderTop: ghsubHairline, paddingTop: 12, marginBottom: 16 }}>
                            {plan.features.map((f, j) => (
                                <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                                    <Check size={12} style={{ color: GH.accent, marginTop: 3, flexShrink: 0 }} />
                                    <span style={{ fontSize: 13, color: GH.ink60 }}>{f}</span>
                                </div>
                            ))}
                            {plan.bonuses.length > 0 && (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{ ...ghsubMono, color: GH.ink30, fontSize: 9, marginBottom: 6 }}>БОНУСЫ</div>
                                    {plan.bonuses.map((b, j) => (
                                        <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                                            <Gift size={10} style={{ color: GH.accent, marginTop: 3, flexShrink: 0 }} />
                                            <span style={{ fontSize: 12, color: GH.ink30 }}>{b}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <a
                            href="https://t.me/UnboxCenter"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: 'block', textAlign: 'center', padding: '10px 0',
                                background: plan.popular ? GH.ink : 'transparent',
                                color: plan.popular ? GH.paper : GH.ink,
                                border: plan.popular ? 'none' : ghsubHairline,
                                fontWeight: 700, fontSize: 13, fontFamily: GH_SANS, textDecoration: 'none', cursor: 'pointer',
                            }}
                        >
                            Оформить →
                        </a>
                    </div>
                ))}
            </div>

            {/* Conditions */}
            <div style={{ marginBottom: 48 }}>
                <div style={{ ...ghsubMono, color: GH.ink30, marginBottom: 16 }}>УСЛОВИЯ</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 0, border: ghsubHairline }}>
                    {CONDITIONS.map((c, i) => (
                        <div key={i} style={{ padding: 20, borderRight: i < CONDITIONS.length - 1 ? ghsubHairline : 'none' }}>
                            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>{c.title}</div>
                            <p style={{ fontSize: 13, color: GH.ink60, lineHeight: 1.6 }}>{c.description}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* CTA */}
            <div style={{ textAlign: 'center', padding: '32px 0', borderTop: ghsubHairline }}>
                <p style={{ fontSize: 15, color: GH.ink60, marginBottom: 16 }}>
                    Нужно больше часов или особый формат? Мы подберём персональные условия для вашей практики.
                </p>
                <a
                    href="https://t.me/UnboxCenter"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '12px 28px', background: GH.ink, color: GH.paper,
                        fontWeight: 700, fontSize: 14, fontFamily: GH_SANS, textDecoration: 'none',
                    }}
                >
                    <MessageCircle size={16} /> Написать нам
                </a>
            </div>

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', marginTop: 48, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ ...ghsubMono, color: GH.ink30 }}>UNBOX · 2026</span>
                <span style={{ ...ghsubMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
