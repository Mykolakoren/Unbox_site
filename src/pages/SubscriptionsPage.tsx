import { motion } from 'framer-motion';
import { Clock, Snowflake, Percent, ArrowRight, Check, Star, Users, Zap, Gift, Shield, MessageCircle, Sparkles, TrendingUp, Timer, Flame, Award, ChevronRight, BarChart3 } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { MinimalLayout } from '../components/MinimalLayout';

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
    // Grid House is the only layout now. Keep a thin shim so existing imports
    // compile; the legacy JSX below is unreachable and stripped by Terser.
    return <GridHouseSubscriptions />;

    // eslint-disable-next-line no-unreachable
    return (
        <MinimalLayout glassMode>
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

            {/* ═══ Hourly price examples (no subscription) ═══ */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65, duration: 0.5 }}
                className="space-y-5"
            >
                <div className="text-center space-y-2">
                    <h2 className="text-2xl font-bold text-unbox-dark">Сколько стоит час без абонемента</h2>
                    <p className="text-sm text-unbox-grey max-w-xl mx-auto">
                        Базовые ставки за бронь по балансу. Чем длиннее непрерывная бронь — тем дешевле каждый час.
                    </p>
                </div>
                <div className="rounded-2xl overflow-hidden" style={{
                    background: 'rgba(255,255,255,0.80)',
                    backdropFilter: 'blur(16px)',
                    WebkitBackdropFilter: 'blur(16px)',
                    border: '1px solid rgba(255,255,255,0.60)',
                    boxShadow: '0 4px 16px rgba(71,109,107,0.06)',
                }}>
                    {[
                        { what: 'Кабинеты 1, 2, 5, 6, 9 — индивидуально',          price: '20 ₾/час' },
                        { what: 'Капсулы 1 и 2 — индивидуально, для онлайн-сессий', price: '10 ₾/час' },
                        { what: 'Кабинеты 7 и 8 — индивидуально',                  price: '20 ₾/час' },
                        { what: 'Кабинеты 7 и 8 — групповой формат (до 20 чел.)',   price: '35 ₾/час' },
                        { what: '2 часа подряд в одном кабинете',                   price: '−10% к часу' },
                        { what: '3 часа подряд в одном кабинете',                   price: '−15% к часу' },
                        { what: '4 часа и больше подряд в одном кабинете',          price: '−20% к часу' },
                    ].map((row, i, arr) => (
                        <div
                            key={row.what}
                            className="flex items-center justify-between px-5 py-3 text-sm"
                            style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(71,109,107,0.08)' }}
                        >
                            <span className="text-unbox-dark">{row.what}</span>
                            <span className="font-semibold text-unbox-dark whitespace-nowrap ml-3">{row.price}</span>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-unbox-grey/80 text-center max-w-xl mx-auto leading-relaxed">
                    Скидки за длительность не суммируются с прогрессивной скидкой за объём — применяется одна, самая выгодная для вас (см. ниже).
                </p>
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

                    {/* 1. Peak-hour surcharge (replaced legacy weekly_progressive
                        2026-05-26 — that mechanism is disabled in backend, so the
                        public page now shows the surcharge that actually applies). */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                                <Flame size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Вечерний тариф</h3>
                                <p className="text-xs text-unbox-grey">Часы повышенного спроса — небольшая надбавка к часу</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {[
                                { label: '09:00 – 10:00 (утренний пик)', delta: '+5 ₾/ч' },
                                { label: '20:00 – 22:00 (вечерний пик)', delta: '+5 ₾/ч' },
                            ].map(t => (
                                <div key={t.label} className="flex items-center gap-3 bg-amber-50/50 rounded-xl px-4 py-2.5">
                                    <Flame size={16} className="text-amber-500 flex-shrink-0" />
                                    <span className="text-sm text-unbox-dark flex-1">{t.label}</span>
                                    <span className="text-sm font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">{t.delta}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-unbox-grey/80 leading-relaxed pt-1">
                            Пример: бронь 20:00 – 21:00 в индивидуальном кабинете стоит 25 ₾ вместо 20 ₾.
                            Все остальные часы — по стандартному тарифу.
                        </p>
                    </div>

                    {/* 2. Duration discount — values match PricingService:
                        2-3h → 10%, 3-5h → 15%, 5+h → 20% (NOT 4+h). Owner asked
                        2026-05-26 to align this with the real rule. */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                <Timer size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Скидка за длительность сессии</h3>
                                <p className="text-xs text-unbox-grey">Непрерывная бронь в одном кабинете — чем длиннее, тем дешевле час</p>
                            </div>
                        </div>
                        <div className="space-y-2.5">
                            {[
                                { label: '2 часа подряд в одном кабинете', percent: '10%' },
                                { label: '3 часа подряд в одном кабинете', percent: '15%' },
                                { label: '5+ часов подряд в одном кабинете', percent: '20%' },
                            ].map(tier => (
                                <div key={tier.label} className="flex items-center gap-3 bg-blue-50/50 rounded-xl px-4 py-2.5">
                                    <Timer size={16} className="text-blue-500 flex-shrink-0" />
                                    <span className="text-sm text-unbox-dark flex-1">{tier.label}</span>
                                    <span className="text-sm font-bold text-blue-600 bg-blue-100 px-2.5 py-0.5 rounded-full">-{tier.percent}</span>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-unbox-grey/80 leading-relaxed pt-1">
                            Разорванные или параллельные брони в разных кабинетах в эту скидку не складываются.
                        </p>
                    </div>

                    {/* 3. Hot Booking */}
                    <div className="rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.75)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.60)', boxShadow: '0 4px 16px rgba(71,109,107,0.06)' }}>
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
                                <Flame size={20} />
                            </div>
                            <div>
                                <h3 className="font-bold text-unbox-dark">Горячая бронь</h3>
                                <p className="text-xs text-unbox-grey">Будни — менее 12ч, выходные — менее 24ч до старта требует одобрения</p>
                            </div>
                        </div>
                        <div className="bg-orange-50/60 rounded-xl p-4 space-y-2">
                            <div className="flex items-center gap-2">
                                <Flame size={16} className="text-orange-500" />
                                <span className="text-sm text-unbox-dark font-medium">Одобрение администратора</span>
                            </div>
                            <p className="text-xs text-unbox-grey leading-relaxed">
                                Если до сессии в будний день осталось менее 12 часов (или менее 24 часов на сб/вс), бронь требует подтверждения администратора. После одобрения — обычная цена без скидки и без надбавки.
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
                        {(() => {
                            const steps = [
                                { label: 'Абонемент', desc: 'Фиксированная цена', color: 'bg-violet-100 text-violet-700 border-violet-200' },
                                { label: 'Персональная', desc: 'Индивидуальный %', color: 'bg-purple-100 text-purple-700 border-purple-200' },
                                { label: 'За длительность', desc: '2+ часа подряд в одном кабинете', color: 'bg-blue-100 text-blue-700 border-blue-200' },
                                { label: 'Вечерний тариф', desc: '+5 ₾/ч на пиковые часы', color: 'bg-amber-100 text-amber-700 border-amber-200' },
                            ];
                            return steps.map((step, i) => (
                                <div key={step.label} className="flex items-center gap-2 flex-1">
                                    <div className={`flex-1 rounded-xl border px-3 py-2.5 text-center ${step.color}`}>
                                        <div className="text-xs font-bold">{step.label}</div>
                                        <div className="text-[10px] opacity-70">{step.desc}</div>
                                    </div>
                                    {i < steps.length - 1 && (
                                        <ChevronRight size={14} className="text-unbox-grey shrink-0 hidden sm:block" />
                                    )}
                                </div>
                            ));
                        })()}
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
        </MinimalLayout>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — SubscriptionsPage
   ═══════════════════════════════════════════════════════════════ */

const ghsubMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghsubHairline = `1px solid ${GH.ink10}`;

function GridHouseSubscriptions() {
    const navigate = useNavigate();
    const { currentUser } = useUserStore();

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, fontFamily: GH_SANS, color: GH.ink, overflowX: 'hidden' }}>
            {/* GH Masthead */}
            <header style={{ borderBottom: `1px solid ${GH.ink10}`, background: GH.paper, position: 'sticky', top: 0, zIndex: 40 }}>
                <div style={{ maxWidth: 1100, margin: '0 auto', padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                        <Link to="/" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, textDecoration: 'none' }}>Unbox</Link>
                        <span style={{ ...ghsubMono, color: GH.label, fontSize: 9 }}>ТАРИФЫ</span>
                    </div>
                    <nav style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={() => navigate(-1)} style={{ ...ghsubMono, color: GH.label, background: 'transparent', border: 'none', cursor: 'pointer', padding: '4px 0' }}>← Назад</button>
                        {currentUser && (
                            <Link to="/dashboard" style={{ ...ghsubMono, color: GH.ink, textDecoration: 'none', padding: '4px 0' }}>{currentUser.name}</Link>
                        )}
                    </nav>
                </div>
            </header>

            <div style={{ maxWidth: 1100, margin: '0 auto', padding: '48px clamp(16px, 4vw, 24px) 80px' }}>
            {/* Header */}
            <div style={{ paddingBottom: 24, borderBottom: `2px solid ${GH.ink}`, marginBottom: 48, textAlign: 'center' }}>
                <div style={{ ...ghsubMono, color: GH.label, marginBottom: 8 }}>ТАРИФЫ</div>
                <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 42px)', fontWeight: 800, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                    Тарифы и скидки Unbox
                </h1>
                <p style={{ fontSize: 15, color: GH.ink60, maxWidth: 560, margin: '0 auto' }}>
                    Прозрачная система скидок — до 50%. Абонементы, кофе, массаж и другие бонусы — включены.
                </p>
                {/* CTA to the public-offer page — admins repeatedly asked for
                    a visible link from where users compare tariffs to where
                    the legal terms live, so the choice doesn't happen blind. */}
                <Link
                    to="/booking-rules"
                    style={{
                        display: 'inline-block',
                        marginTop: 16,
                        padding: '10px 20px',
                        border: `1px solid ${GH.ink}`,
                        borderRadius: 999,
                        textDecoration: 'none',
                        color: GH.ink,
                        fontFamily: GH_MONO,
                        fontSize: 11,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                    }}
                >
                    Правила бронирования →
                </Link>
            </div>

            {/* Standard prices */}
            <div style={{ marginBottom: 48 }}>
                <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>СТАНДАРТНЫЕ ЦЕНЫ</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 0, border: ghsubHairline }}>
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
            <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>АБОНЕМЕНТЫ</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', gap: 16, marginBottom: 48 }}>
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
                        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
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
                                    <div style={{ ...ghsubMono, color: GH.label, fontSize: 9, marginBottom: 6 }}>БОНУСЫ</div>
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

            {/* ═══ Эффективная цена часа — pricing infographic ═══════════════
                2026-06-06 owner (CLAUDE.md content task #5): абоны показывают
                свою скидку в %, но пользователь не сразу видит «во сколько
                мне реально обходится час». Визуализируем — горизонтальные
                полосы пропорциональные эффективной цене за час. Reference
                line — стандарт 20 ₾ (для group мастера — 35 ₾, отдельно
                выделено). */}
            <EffectivePriceChart />

            {/* Discounts — matches the Admin Knowledge Base copy exactly.
                Four blocks: weekly-progressive, duration (one continuous room),
                welcome hour, priority-of-charges note. Keep numbers in sync
                with backend PRICING_CONFIG. */}
            <div style={{ marginBottom: 48 }}>
                <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>СКИДКИ</div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 0, border: ghsubHairline, marginBottom: 16 }}>
                    {/* Peak-hour surcharge (replaced legacy weekly_progressive
                        2026-05-26 — that mechanism is disabled in backend; this
                        block now reflects the surcharge that actually applies). */}
                    <div style={{ padding: 20, borderRight: ghsubHairline }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Вечерний тариф</div>
                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 12 }}>
                            Часы повышенного спроса — небольшая надбавка к часу аренды:
                        </div>
                        {[
                            ['09:00 – 10:00',  '+5 ₾/ч'],
                            ['20:00 – 22:00',  '+5 ₾/ч'],
                        ].map(([lbl, disc], i, arr) => (
                            <div key={i} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px 0',
                                borderBottom: i < arr.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                            }}>
                                <span style={{ fontSize: 13, color: GH.ink60 }}>{lbl}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 700, background: GH.ink, color: GH.paper, padding: '2px 10px' }}>
                                    {disc}
                                </strong>
                            </div>
                        ))}
                        <p style={{ fontSize: 11, color: GH.ink30, margin: '12px 0 0', fontStyle: 'italic', lineHeight: 1.5 }}>
                            Все остальные часы — по стандартному тарифу.
                        </p>
                    </div>

                    {/* Duration — one continuous booking in ONE cabin */}
                    <div style={{ padding: 20, borderRight: ghsubHairline }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Скидка за длительность</div>
                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 12 }}>
                            Непрерывная бронь в <strong style={{ color: GH.ink }}>одном кабинете</strong> — чем длиннее, тем дешевле час:
                        </div>
                        {[
                            ['2 часа подряд',   '10%'],
                            ['3 часа подряд',   '15%'],
                            ['5+ часов подряд', '20%'],
                        ].map(([lbl, disc], i, arr) => (
                            <div key={i} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                padding: '8px 0',
                                borderBottom: i < arr.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                            }}>
                                <span style={{ fontSize: 13, color: GH.ink60 }}>{lbl}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 700, background: GH.ink, color: GH.paper, padding: '2px 10px' }}>
                                    {disc}
                                </strong>
                            </div>
                        ))}
                        <p style={{ fontSize: 11, color: GH.ink30, margin: '12px 0 0', fontStyle: 'italic', lineHeight: 1.5 }}>
                            Разорванные или параллельные брони в разных кабинетах в эту скидку не складываются.
                        </p>
                    </div>

                    {/* Welcome bonus */}
                    <div style={{ padding: 20 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Приветственный бонус</div>
                        <div style={{ fontSize: 12, color: GH.ink60, marginBottom: 12, lineHeight: 1.55 }}>
                            При регистрации мы зачисляем на ваш счёт <strong style={{ color: GH.ink }}>20 ₾</strong> —
                            эквивалент одного часа индивидуального бронирования. Бонус работает как обычные деньги:
                            можно оплатить им <strong style={{ color: GH.ink }}>любую</strong> бронь — кабинет, капсулу
                            или групповой формат. При оплате брони бонус автоматически вычитается из суммы; если
                            бронь дороже — доплачиваете разницу с основного баланса.
                        </div>
                        <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ ...ghsubMono, color: GH.label }}>Номинал</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 700 }}>20 ₾</div>
                            </div>
                            <div>
                                <div style={{ ...ghsubMono, color: GH.label }}>Срок</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 22, fontWeight: 700 }}>15 дней</div>
                            </div>
                        </div>
                        <p style={{ fontSize: 11, color: GH.ink30, margin: '12px 0 0', lineHeight: 1.5 }}>
                            Срок ограничен — успейте попробовать пространство в первые две недели.
                            Списание FIFO (в первую очередь сгорает то, что начислено раньше).
                        </p>
                    </div>
                </div>

                {/* Priority of charges */}
                <div style={{ border: ghsubHairline, padding: '14px 16px' }}>
                    <div style={{ ...ghsubMono, color: GH.label, marginBottom: 8 }}>ПРИОРИТЕТ ПРИМЕНЕНИЯ СКИДОК</div>
                    <p style={{ fontSize: 13, color: GH.ink, margin: 0, lineHeight: 1.6 }}>
                        Скидки не суммируются — применяется одна, наиболее выгодная для вас:
                        {' '}<strong>Абонемент</strong> → <strong>Персональная</strong> → <strong>За длительность</strong>.
                        Вечерний тариф (+5 ₾/ч) и горячая бронь применяются поверх итоговой цены.
                        Бонусный баланс (включая приветственный час) списывается отдельно.
                    </p>
                </div>

                {/* Hot booking — approval, not a discount */}
                <div style={{ border: ghsubHairline, padding: '14px 16px', marginTop: 12 }}>
                    <div style={{ ...ghsubMono, color: GH.label, marginBottom: 8 }}>ГОРЯЧАЯ БРОНЬ</div>
                    <p style={{ fontSize: 13, color: GH.ink, margin: 0, lineHeight: 1.6 }}>
                        Бронь менее чем за 12 часов до начала (или менее чем за 24 часа на субботу/воскресенье) требует подтверждения администратора. После одобрения — обычная цена, без скидки и без надбавки.
                    </p>
                </div>
            </div>

            {/* Conditions */}
            <div style={{ marginBottom: 48 }}>
                <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>УСЛОВИЯ</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(260px, 100%), 1fr))', gap: 0, border: ghsubHairline }}>
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
                <span style={{ ...ghsubMono, color: GH.label }}>UNBOX · 2026</span>
                <span style={{ ...ghsubMono, color: GH.ink10 }}>GRID HOUSE</span>
            </footer>
            </div>
        </div>
    );
}


/* ═══════════════════════════════════════════════════════════════
   Effective price chart — pricing infographic
   ═══════════════════════════════════════════════════════════════ */

/** Числа в синке с SUBSCRIPTION_PLANS в data.ts.
 *  Профи+: 40 базовых часов + 2 бонусных = 42 ч; делим 640 на 42.
 *  Групповой мастер: 16 групповых часов, reference = 35 ₾/час (групповая
 *  стандартная), а не 20 (индивидуальная). */
const PRICE_PLANS = [
    { name: 'Без абонемента',     price: 20,  hours: 1,  ref: 20, format: 'индивид.' },
    { name: 'Тёплый старт',       price: 180, hours: 10, ref: 20, format: 'индивид.' },
    { name: 'Регулярный практик', price: 340, hours: 20, ref: 20, format: 'индивид.' },
    { name: 'Профи+',             price: 640, hours: 42, ref: 20, format: 'индивид.', accent: true },
    { name: 'Групповой мастер',   price: 420, hours: 16, ref: 35, format: 'групповой' },
];

function EffectivePriceChart() {
    return (
        <div style={{ marginBottom: 48 }}>
            <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>
                ЭФФЕКТИВНАЯ ЦЕНА ЧАСА
            </div>
            <p style={{ fontSize: 13, color: GH.ink60, marginBottom: 20, maxWidth: 560 }}>
                Полная шкала — базовая ставка без скидки (20 ₾/ч индивидуально,
                35 ₾/ч группа). Чем короче заполненная часть — тем приятнее
                реальная цена часа с абонементом.
            </p>

            <div style={{ border: ghsubHairline }}>
                {PRICE_PLANS.map((p, i) => {
                    const perHour = p.price / p.hours;
                    const savingPct = Math.round((1 - perHour / p.ref) * 100);
                    // 2026-06-07 owner: каждый план относительно своей базовой
                    // ставки. «Без абонемента» = 100% (точка отсчёта). Платные
                    // планы — заполнение пропорционально perHour/ref, остаток
                    // справа визуально = скидка. Раньше делили на max(refs)
                    // = 35, и 20-полоса была 57% — диссонанс.
                    const fillPct = Math.min(100, (perHour / p.ref) * 100);
                    const isStandard = savingPct === 0;
                    const barColor = p.accent
                        ? GH.accent
                        : isStandard
                            ? GH.ink30
                            : GH.ink;

                    return (
                        <div
                            key={p.name}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(140px, 1.5fr) 3fr minmax(140px, 1fr)',
                                gap: 12,
                                alignItems: 'center',
                                padding: '14px 16px',
                                borderTop: i === 0 ? 'none' : ghsubHairline,
                                background: p.accent ? `${GH.accent}08` : 'transparent',
                            }}
                        >
                            {/* Plan name + format */}
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: GH.ink }}>
                                    {p.name}
                                </div>
                                <div style={{ fontSize: 11, color: GH.ink30, marginTop: 2 }}>
                                    {p.format}
                                    {p.hours > 1 && ` · ${p.hours} ч · ${p.price} ₾`}
                                </div>
                            </div>

                            {/* Bar: фон = базовая ставка (полная шкала),
                                заливка = эффективная цена. Пустая правая
                                часть визуально = экономия. */}
                            <div style={{
                                position: 'relative',
                                height: 18,
                                background: `${GH.ink10}`,
                                overflow: 'hidden',
                            }} title={`База: ${p.ref} ₾/ч · реально: ${perHour.toFixed(2)} ₾/ч`}>
                                <div style={{
                                    position: 'absolute',
                                    left: 0, top: 0, bottom: 0,
                                    width: `${fillPct}%`,
                                    background: barColor,
                                    transition: 'width .3s',
                                }} />
                                {/* Subtle reference tick: вертикальная
                                    риска на 100% помогает читать «вот
                                    тут была бы база» при сильной скидке. */}
                                {!isStandard && (
                                    <div style={{
                                        position: 'absolute',
                                        right: 0, top: 0, bottom: 0,
                                        width: 2,
                                        background: GH.ink30,
                                    }} />
                                )}
                            </div>

                            {/* Effective rate + saving */}
                            <div style={{ textAlign: 'right' }}>
                                <div style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 18,
                                    fontWeight: 700,
                                    color: GH.ink,
                                    letterSpacing: '-0.01em',
                                }}>
                                    {perHour.toFixed(perHour % 1 === 0 ? 0 : 1)}
                                    <span style={{ fontSize: 11, color: GH.ink30, marginLeft: 4 }}>
                                        ₾/час
                                    </span>
                                </div>
                                {savingPct > 0 && (
                                    <div style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 10,
                                        letterSpacing: '0.08em',
                                        color: GH.accent,
                                        marginTop: 2,
                                    }}>
                                        −{savingPct}% к ставке
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <p style={{ fontSize: 11, color: GH.ink30, marginTop: 10, lineHeight: 1.5 }}>
                Базовая ставка для индивидуального кабинета — 20 ₾/час, для
                группового — 35 ₾/час. Профи+ включает 2 бонусных часа сверх
                основных 40. «Групповой мастер» считается по групповой ставке.
            </p>
        </div>
    );
}
