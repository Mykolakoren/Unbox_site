import { Clock, Snowflake, Percent, Check, Gift, MessageCircle } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { Link, useNavigate } from 'react-router-dom';
import { useUserStore } from '../store/userStore';
import { SUBSCRIPTION_PLANS } from '../utils/data';

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

export function SubscriptionsPage() {
    return <GridHouseSubscriptions />;
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
                {SUBSCRIPTIONS.map(plan => {
                    // Эффективная цена за час — то, что делает выгоду понятной
                    // прямо в карточке (раньше была только в инфографике ниже).
                    // Групповой мастер считается от 35 ₾/час, остальные — от 20.
                    const perHour = Math.round((plan.price / Math.max(plan.hours, 1)) * 10) / 10;
                    const stdBase = plan.id === 'group' ? 35 : 20;
                    return (
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
                        {/* Эффективная цена за час — ключевой аргумент выгоды */}
                        <div style={{ fontFamily: GH_MONO, fontSize: 13, color: GH.ink60, marginBottom: 16 }}>
                            ≈ {perHour} ₾/час <span style={{ color: GH.ink30 }}>· стандарт {stdBase}</span>
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
                            Оформить «{plan.name}» →
                        </a>
                    </div>
                    );
                })}
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

/** Инфографика «выгоды» БЕРЁТ цены и часы из SUBSCRIPTION_PLANS (data.ts) —
 *  единого источника. Раньше числа были прописаны тут отдельно (340/640/420)
 *  и разъехались с карточками (350/650/450). Теперь разъехаться нечему:
 *  меняешь цену в data.ts — меняется и здесь.
 *  Профи+: 40 базовых + 2 бонусных = 42 ч (по ним и считаем эффективную цену).
 *  «Без абонемента» — точка отсчёта 100% для своего формата.
 *  2026-06-07 owner: две шкалы по формату, чтобы групповая полоса визуально
 *  не казалась длиннее индивидуальной. */
const _plan = (id: string) => SUBSCRIPTION_PLANS.find(p => p.id === id);
const _hours = (id: string) => {
    const p = _plan(id);
    return (p?.hours ?? 0) + ((p as any)?.bonusHours ?? 0);
};

const INDIVIDUAL_PLANS = [
    { name: 'Без абонемента',     price: 20,  hours: 1,  ref: 20 },
    { name: 'Тёплый старт',       price: _plan('WARM_START')!.price,           hours: _hours('WARM_START'),           ref: 20 },
    { name: 'Регулярный практик', price: _plan('REGULAR_PRACTITIONER')!.price, hours: _hours('REGULAR_PRACTITIONER'), ref: 20 },
    { name: 'Профи+',             price: _plan('PRO_PLUS')!.price,             hours: _hours('PRO_PLUS'),             ref: 20, accent: true },
];

const GROUP_PLANS = [
    { name: 'Без абонемента',     price: 35,  hours: 1,  ref: 35 },
    { name: 'Групповой мастер',   price: _plan('GROUP_MASTER')!.price, hours: _hours('GROUP_MASTER'), ref: 35, accent: true },
];

/** Скидка за длительность непрерывной брони в ОДНОМ кабинете.
 *  Проценты должны совпадать с backend PricingService:
 *  2h → 10%, 3h → 15%, 5+h → 20%. Считаем total cost = base*hours*(1-disc),
 *  чтобы PriceScale корректно вычислил perHour=total/hours = effective rate. */
const DURATION_INDIVIDUAL = [
    { name: '1 час',          price: 20,  hours: 1, ref: 20 },
    { name: '2 часа подряд',  price: 36,  hours: 2, ref: 20 },
    { name: '3 часа подряд',  price: 51,  hours: 3, ref: 20 },
    { name: '5+ часов подряд', price: 80, hours: 5, ref: 20, accent: true },
];

/** Недельная скидка — накопительная по календарной неделе (пн-вс).
 *  Тиры идентичны backend PRICING_CONFIG.weekly_progressive (2026-06-07
 *  восстановлены). subtitle вместо "ч · ₾" — поскольку «5 ч × 18 ₾ = 90»
 *  для тира 5-10 ч бессмысленно (тир, не фикс-цена). */
const WEEKLY_TIERS = [
    { name: '1–4 ч / неделю',  price: 20,  hours: 1,  ref: 20, subtitle: 'базовая ставка' },
    { name: '5–10 ч / неделю', price: 90,  hours: 5,  ref: 20, subtitle: 'все часы недели' },
    { name: '11–15 ч / неделю', price: 165, hours: 11, ref: 20, subtitle: 'все часы недели' },
    { name: '16+ ч / неделю',  price: 160, hours: 16, ref: 20, subtitle: 'все часы недели', accent: true },
];

function EffectivePriceChart() {
    return (
        <div style={{ marginBottom: 48 }}>
            <div style={{ ...ghsubMono, color: GH.label, marginBottom: 16 }}>
                ЭФФЕКТИВНАЯ ЦЕНА ЧАСА
            </div>
            <p style={{ fontSize: 13, color: GH.ink60, marginBottom: 24, maxWidth: 560 }}>
                Полная шкала — базовая ставка без скидки. Чем короче
                заполненная полоса, тем приятнее реальная цена часа
                с абонементом.
            </p>

            <PriceScale
                title="Индивидуальный кабинет"
                baseRate={20}
                plans={INDIVIDUAL_PLANS}
            />

            <div style={{ height: 24 }} />

            <PriceScale
                title="Групповой формат"
                baseRate={35}
                plans={GROUP_PLANS}
            />

            {/* 2026-06-07 owner: длительность — альтернативный способ
                сэкономить без покупки абонемента. Шкала индивид. 20 ₾/ч,
                те же проценты что и в backend PricingService. */}
            <div style={{ height: 24 }} />

            <PriceScale
                title="Скидка за длительность (без абонемента)"
                baseRate={20}
                plans={DURATION_INDIVIDUAL}
            />

            {/* 2026-06-07 owner: недельная скидка восстановлена в backend
                — нужен маркетинг-аргумент «чем больше практикуешь, тем
                дешевле час». Тиры синхронизированы с
                PRICING_CONFIG.weekly_progressive. */}
            <div style={{ height: 24 }} />

            <PriceScale
                title="Недельная скидка — кредитом в конце недели"
                baseRate={20}
                plans={WEEKLY_TIERS}
            />

            <div style={{
                marginTop: 12, padding: '10px 14px', background: `${GH.accent}0F`,
                border: `1px solid ${GH.accent}30`, fontSize: 12, color: GH.ink, lineHeight: 1.5,
            }}>
                <b>Как приходит недельная скидка:</b> в течение недели вы платите
                обычную цену, а в <b>понедельник</b> система начисляет скидку
                <b> кредитом на баланс</b> — сразу на ВСЕ часы прошлой недели по
                итоговому тарифу. Чем больше часов за неделю (пн–вс), тем выше
                тариф. Кредит тратится на любые будущие брони.
            </div>

            <p style={{ fontSize: 11, color: GH.ink30, marginTop: 12, lineHeight: 1.5 }}>
                Профи+ включает 2 бонусных часа сверх основных 40 — эффективная
                скидка ~24%, не «голые» 20% из карточки. «Групповой мастер»
                считается по групповой ставке (35 ₾/ч). Скидки за длительность
                применяются к непрерывной брони в ОДНОМ кабинете; разорванные
                или параллельные брони не складываются. Скидки не суммируются —
                применяется самая выгодная.
            </p>
        </div>
    );
}

function PriceScale({
    title, baseRate, plans,
}: {
    title: string;
    baseRate: number;
    plans: Array<{
        name: string;
        price: number;
        hours: number;
        ref: number;
        accent?: boolean;
        /** Override дефолтного «${hours} ч · ${price} ₾» подзаголовка.
         *  Нужно для weekly-тиров где price = total cost для нижней
         *  границы тира — отдельно отображать его бессмысленно. */
        subtitle?: string;
    }>;
}) {
    return (
        <div>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 8,
                paddingBottom: 6,
                borderBottom: `1px solid ${GH.ink}`,
            }}>
                <div style={{ ...ghsubMono, color: GH.ink, fontSize: 11, letterSpacing: '0.14em' }}>
                    {title}
                </div>
                <div style={{ ...ghsubMono, color: GH.ink60, fontSize: 10 }}>
                    база {baseRate} ₾/час
                </div>
            </div>

            <div style={{ border: ghsubHairline }}>
                {plans.map((p, i) => {
                    const perHour = p.price / p.hours;
                    const savingPct = Math.round((1 - perHour / p.ref) * 100);
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
                            <div>
                                <div style={{ fontWeight: 700, fontSize: 14, color: GH.ink }}>
                                    {p.name}
                                </div>
                                {(p.subtitle !== undefined
                                    ? p.subtitle
                                    : (p.hours > 1 ? `${p.hours} ч · ${p.price} ₾` : null)) && (
                                    <div style={{ fontSize: 11, color: GH.ink30, marginTop: 2 }}>
                                        {p.subtitle !== undefined
                                            ? p.subtitle
                                            : `${p.hours} ч · ${p.price} ₾`}
                                    </div>
                                )}
                            </div>

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
                                {!isStandard && (
                                    <div style={{
                                        position: 'absolute',
                                        right: 0, top: 0, bottom: 0,
                                        width: 2,
                                        background: GH.ink30,
                                    }} />
                                )}
                            </div>

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
        </div>
    );
}
