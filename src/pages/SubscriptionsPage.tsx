import { Clock, Snowflake, Percent, Check, Gift, MessageCircle, ChevronDown } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { Link } from 'react-router-dom';
import { SUBSCRIPTION_PLANS, RESOURCES } from '../utils/data';
import { formatGel } from '../utils/format';
import { useCatalogPath, useInMobileShell } from '../utils/catalogPath';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { PublicHeader } from '../components/public/PublicHeader';
import { MobilePageHeader } from '../components/ui/PageHeader';

/**
 * Тарифы — /subscriptions и /m/tariffs.
 *
 * Волна 2, пакет B (G2-16, G2-10, X4-accessibility-M3, G2-02, X2-19, X3-20)
 * и решения владельца 30.09:
 *  - выгода абонемента — только ЦЕНА ЧАСА («≈ 17,5 ₾/ч вместо 20 ₾»), без
 *    процентов и зачёркнутых «полных цен». Цена часа = цена / часы из
 *    SUBSCRIPTION_PLANS (data.ts — единый источник; цены там не меняем);
 *  - «Оформить абонемент» → Telegram @UnboxCenter с готовым текстом;
 *  - «Скидки и бонусы» — только работающее: приветственный час (15 дней) и
 *    скидка за длительность 10/15/20 %. Недельная скидка убрана со страницы;
 *  - в /m своей шапки нет (MobilePageHeader), на компьютере — PublicHeader;
 *  - короткий hero, абонементы на первом экране, «Правила бронирования» —
 *    текстовой ссылкой внизу.
 */

// ── Standard Prices ──────────────────────────────────────────────────────────
// Какие кабинеты индивидуальные — из тех же данных, что и шахматка: сдаваемые
// кабинеты вместимостью меньше 20 (сейчас 1, 2, 5, 6). Раньше было «Кабинеты 1–8»,
// но 7 и 8 — групповые (35 ₾/час), а 3 и 4 нет вовсе. Кабинет 9 закрыт
// (владелец, 30.09) — isActive: false в data.ts, в список не попадает.
const INDIVIDUAL_ROOMS = RESOURCES
    .filter(r => r.type === 'cabinet' && (r.capacity ?? 0) < 20 && r.isActive !== false)
    .map(r => r.name.replace(/^Кабинет\s*/, ''));
const INDIVIDUAL_DESC = INDIVIDUAL_ROOMS.length > 0
    ? `Кабинеты ${INDIVIDUAL_ROOMS.join(', ')}`
    : 'Индивидуальные кабинеты';
// Большие залы (X3-20: было «залы 7, 8, 9», а 9 закрыт).
const GROUP_ROOMS = RESOURCES
    .filter(r => r.type === 'cabinet' && (r.capacity ?? 0) >= 20 && r.isActive !== false)
    .map(r => r.name.replace(/^Кабинет\s*/, ''));
const GROUP_DESC = GROUP_ROOMS.length > 0
    ? `Залы ${GROUP_ROOMS.join(', ')} · до 20 человек`
    : 'До 20 человек';

const STANDARD_PRICES = [
    { label: 'Кабинет', price: 20, desc: INDIVIDUAL_DESC },
    { label: 'Группа', price: 35, desc: GROUP_DESC },
    { label: 'Капсула', price: 10, desc: 'Одно место' },
];

// ── Subscription Plans ───────────────────────────────────────────────────────
// Цена, часы и срок — из SUBSCRIPTION_PLANS; здесь только тексты карточек.
type PlanCopy = {
    dataId: string;
    tagline: string;
    capsuleHours: number;
    extraNote?: string;
    features: string[];
    bonuses: string[];
    badge: string | null;
    popular: boolean;
};

const PLAN_COPY: PlanCopy[] = [
    {
        dataId: 'TRIAL',
        tagline: 'Попробуйте формат Unbox',
        capsuleHours: 1,
        features: [
            'Любой индивидуальный кабинет',
            '1 час в капсуле в любое время',
        ],
        bonuses: [],
        badge: null,
        popular: false,
    },
    {
        dataId: 'WARM_START',
        tagline: 'Уверенный старт практики',
        capsuleHours: 4,
        features: [
            'Любой индивидуальный кабинет',
            '4 часа в капсуле в любое время',
            'Бесплатный перенос бронирований',
        ],
        bonuses: [],
        badge: null,
        popular: false,
    },
    {
        dataId: 'REGULAR_PRACTITIONER',
        tagline: 'Для стабильной практики',
        capsuleHours: 6,
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
        badge: 'Популярный',
        popular: true,
    },
    {
        dataId: 'PRO_PLUS',
        tagline: 'Максимум для профессионалов',
        capsuleHours: 10,
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
        badge: 'Максимум',
        popular: false,
    },
    {
        dataId: 'GROUP_MASTER',
        tagline: 'Для тренингов и воркшопов',
        capsuleHours: 0,
        extraNote: '+ 4 ч в индивидуальном кабинете',
        features: [
            'Групповые кабинеты (до 20 чел.)',
            '4 часа в любом индивидуальном кабинете',
        ],
        bonuses: [
            'Съёмка рилз — 1 час в любом филиале',
            'Кофе Меама — 6 капсул',
            'Скидка на книги — 33%',
        ],
        badge: 'Группы',
        popular: false,
    },
];

type DataPlan = (typeof SUBSCRIPTION_PLANS)[number] & { bonusHours?: number };

/** Часы абонемента для расчёта цены часа: основные + бонусные (у «Профи+»
 *  40 + 2 — сервер их правда начисляет, subscription_sale.py). Часы в
 *  капсуле и 4 индивидуальных часа «Группового мастера» НЕ считаем: это
 *  другой вид часа, и честнее недосчитать выгоду, чем раздуть её. */
function planHours(p: DataPlan): number {
    return (p.hours ?? 0) + (p.bonusHours ?? 0);
}

/** Цена часа абонемента, округлённая до 0,1 ₾: 350 / 20 = 17,5. */
function planHourPrice(p: DataPlan): number {
    const h = planHours(p);
    return h > 0 ? Math.round((p.price / h) * 10) / 10 : p.price;
}

/** Базовая ставка без абонемента: групповой формат — 35 ₾/ч, остальные — 20. */
function planBaseRate(p: DataPlan): number {
    return p.formats?.[0] === 'group' ? 35 : 20;
}

const PLANS = PLAN_COPY.flatMap(copy => {
    const p = SUBSCRIPTION_PLANS.find(x => x.id === copy.dataId) as DataPlan | undefined;
    if (!p) return [];
    return [{
        ...copy,
        id: p.id,
        name: p.name,
        price: p.price,
        hours: p.hours,
        bonusHours: p.bonusHours ?? 0,
        durationDays: p.durationDays,
        hourPrice: planHourPrice(p),
        baseRate: planBaseRate(p),
    }];
});

/** Ссылка «Оформить» — чат администратора в Telegram с готовым текстом. */
function orderLink(planName: string): string {
    return `https://t.me/UnboxCenter?text=${encodeURIComponent(`Хочу оформить абонемент «${planName}»`)}`;
}

function daysLabel(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    const w = m10 === 1 && m100 !== 11 ? 'день' : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'дня' : 'дней');
    return `${n} ${w}`;
}

const CONDITIONS = [
    {
        icon: Clock,
        title: 'Перенос часов',
        description: 'Неиспользованные часы переносятся на следующий абонемент при продлении в течение 7 дней.',
    },
    {
        icon: Snowflake,
        title: 'Заморозка',
        description: 'Заморозка абонемента доступна от тарифа «Регулярный практик»: 7 дней, «Профи+»: 30 дней.',
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

const ghsubMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };
const ghsubHairline = `1px solid ${GH.ink10}`;
const sectionTitle: React.CSSProperties = { ...ghsubMono, fontWeight: 500, color: GH.label, margin: '0 0 16px' };

function GridHouseSubscriptions() {
    const inShell = useInMobileShell();
    const toCatalog = useCatalogPath();
    const wide = useMediaQuery('(min-width: 768px)');
    useDocumentTitle('Тарифы');

    return (
        <div style={{ minHeight: inShell ? undefined : '100vh', background: GH.paper, fontFamily: GH_SANS, color: GH.ink, overflowX: 'hidden' }}>
            <PublicHeader />
            {inShell && <MobilePageHeader title="Тарифы" fallbackTo="/m/me" />}

            <div style={{ maxWidth: 1200, margin: '0 auto', padding: wide ? '40px 24px 80px' : '16px 16px 48px' }}>
                {/* Короткий hero: заголовок и одна фраза — абонементы сразу под ним. */}
                <div style={{ marginBottom: wide ? 32 : 20 }}>
                    {!inShell && (
                        <h1 style={{ fontSize: 'clamp(28px, 3.5vw, 40px)', fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 8px' }}>
                            Тарифы
                        </h1>
                    )}
                    <p style={{ fontSize: 16, color: GH.ink80, maxWidth: 620, margin: 0, lineHeight: 1.5 }}>
                        Абонемент — пакет часов, с которым час выходит дешевле.
                        Без абонемента — оплата по часам: кабинет <span className="num">{formatGel(20)}</span>,
                        группа <span className="num">{formatGel(35)}</span>, капсула <span className="num">{formatGel(10)}</span>.
                    </p>
                </div>

                {/* Абонементы */}
                <section aria-labelledby="subs-plans" style={{ marginBottom: 48 }}>
                    <h2 id="subs-plans" style={sectionTitle}>Абонементы</h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: wide ? 'repeat(auto-fit, minmax(210px, 1fr))' : 'minmax(0, 1fr)',
                        gap: 12,
                    }}>
                        {PLANS.map(plan => (
                            <PlanCard key={plan.id} plan={plan} wide={wide} />
                        ))}
                    </div>
                    <p style={{ fontSize: 14, color: GH.ink60, margin: '12px 0 0', lineHeight: 1.5, maxWidth: 760 }}>
                        Цена часа — стоимость абонемента, делённая на его часы (у «Профи+» — 40 основных
                        и 2 бонусных). Часы в капсуле и 4 индивидуальных часа «Группового мастера» идут
                        сверху и в этот расчёт не входят.
                    </p>
                </section>

                {/* Стандартные цены — одной таблицей без обрывков линий */}
                <section aria-labelledby="subs-std" style={{ marginBottom: 48 }}>
                    <h2 id="subs-std" style={sectionTitle}>Без абонемента</h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                        gap: 1, background: GH.ink10, border: ghsubHairline,
                    }}>
                        {STANDARD_PRICES.map(p => (
                            <div key={p.label} style={{
                                background: GH.paper,
                                padding: wide ? '20px 16px' : '12px 16px',
                                display: wide ? 'block' : 'flex',
                                alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
                            }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: 16 }}>{p.label}</div>
                                    <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>{p.desc}</div>
                                </div>
                                <div className="num" style={{ fontSize: wide ? 28 : 20, fontWeight: 600, marginTop: wide ? 8 : 0, whiteSpace: 'nowrap' }}>
                                    {formatGel(p.price)}<span style={{ fontSize: 14, color: GH.ink60 }}>/ч</span>
                                </div>
                            </div>
                        ))}
                    </div>
                    <p style={{ fontSize: 14, color: GH.ink60, margin: '12px 0 0', lineHeight: 1.5 }}>
                        Пиковые часы <span className="num">09:00–10:00</span> и <span className="num">20:00–22:00</span> —
                        надбавка <span className="num">+5 ₾</span> за каждый час пика.
                    </p>
                </section>

                {/* Цена часа — наглядно */}
                <EffectivePriceChart />

                {/* Скидки и бонусы — только то, что правда работает (владелец, 30.09) */}
                <section aria-labelledby="subs-disc" style={{ marginBottom: 48 }}>
                    <h2 id="subs-disc" style={sectionTitle}>Скидки и бонусы</h2>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: wide ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                        gap: 1, background: GH.ink10, border: ghsubHairline, marginBottom: 16,
                    }}>
                        {/* Duration — one continuous booking in ONE cabin */}
                        <div style={{ padding: 20, background: GH.paper }}>
                            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Скидка за длительность</div>
                            <div style={{ fontSize: 14, color: GH.ink60, marginBottom: 12 }}>
                                Непрерывная бронь в <strong style={{ color: GH.ink, fontWeight: 600 }}>одном кабинете</strong> — чем длиннее, тем дешевле час:
                            </div>
                            {[
                                ['2 часа подряд',   '10%'],
                                ['3 часа подряд',   '15%'],
                                ['5+ часов подряд', '20%'],
                            ].map(([lbl, disc], i, arr) => (
                                <div key={lbl} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '8px 0',
                                    borderBottom: i < arr.length - 1 ? ghsubHairline : 'none',
                                }}>
                                    <span style={{ fontSize: 14, color: GH.ink80 }}>{lbl}</span>
                                    <strong className="num" style={{ fontSize: 14, fontWeight: 600 }}>−{disc}</strong>
                                </div>
                            ))}
                            <p style={{ fontSize: 14, color: GH.ink60, margin: '12px 0 0', lineHeight: 1.5 }}>
                                Разорванные или параллельные брони в разных кабинетах в эту скидку не складываются.
                            </p>
                        </div>

                        {/* Welcome bonus. X3-02 (аудит 29.09): это 1 бесплатный час
                            (Bonus type='free_hour', auth.py), а не 20 ₾ на счёт —
                            на денежный баланс он не попадает. Срок — 15 дней
                            (WELCOME_BONUS_EXPIRY_DAYS). */}
                        <div style={{ padding: 20, background: GH.paper }}>
                            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Приветственный бонус</div>
                            <div style={{ fontSize: 14, color: GH.ink60, marginBottom: 12, lineHeight: 1.55 }}>
                                При регистрации мы дарим <strong style={{ color: GH.ink, fontWeight: 600 }}>1 бесплатный час</strong> аренды.
                                Им можно оплатить <strong style={{ color: GH.ink, fontWeight: 600 }}>любую</strong> бронь — кабинет, капсулу
                                или групповой формат: один час брони будет бесплатным. Если бронь длиннее —
                                остальные часы оплачиваются как обычно.
                            </div>
                            <div style={{ display: 'flex', gap: 24, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                <div>
                                    <div style={{ fontSize: 14, color: GH.ink60 }}>Подарок</div>
                                    <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>1 час</div>
                                </div>
                                <div>
                                    <div style={{ fontSize: 14, color: GH.ink60 }}>Срок</div>
                                    <div className="num" style={{ fontSize: 20, fontWeight: 600 }}>15 дней</div>
                                </div>
                            </div>
                            <p style={{ fontSize: 14, color: GH.ink60, margin: '12px 0 0', lineHeight: 1.5 }}>
                                Успейте попробовать пространство в первые две недели.
                            </p>
                        </div>
                    </div>

                    {/* Priority of charges */}
                    <div style={{ border: ghsubHairline, padding: '14px 16px' }}>
                        <div style={{ ...ghsubMono, color: GH.label, marginBottom: 8 }}>ПРИОРИТЕТ СКИДОК</div>
                        <p style={{ fontSize: 14, color: GH.ink, margin: 0, lineHeight: 1.6 }}>
                            Скидки не суммируются — применяется одна, самая выгодная для вас:
                            {' '}<strong style={{ fontWeight: 600 }}>абонемент</strong> → <strong style={{ fontWeight: 600 }}>персональная</strong> → <strong style={{ fontWeight: 600 }}>за длительность</strong>.
                            Надбавка за пиковые часы (+5 ₾/ч) считается поверх итоговой цены.
                            Приветственный час списывается отдельно.
                        </p>
                    </div>

                    {/* Hot booking — approval, not a discount */}
                    <div style={{ border: ghsubHairline, padding: '14px 16px', marginTop: 12 }}>
                        <div style={{ ...ghsubMono, color: GH.label, marginBottom: 8 }}>ГОРЯЧАЯ БРОНЬ</div>
                        <p style={{ fontSize: 14, color: GH.ink, margin: 0, lineHeight: 1.6 }}>
                            Бронь менее чем за 12 часов до начала (или менее чем за 24 часа на субботу и воскресенье) подтверждает администратор. После одобрения — обычная цена, без скидки и без надбавки.
                        </p>
                    </div>
                </section>

                {/* Conditions */}
                <section aria-labelledby="subs-cond" style={{ marginBottom: 40 }}>
                    <h2 id="subs-cond" style={sectionTitle}>Условия абонементов</h2>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: wide ? 'repeat(3, minmax(0, 1fr))' : 'minmax(0, 1fr)',
                        gap: 1, background: GH.ink10, border: ghsubHairline,
                    }}>
                        {CONDITIONS.map(c => (
                            <div key={c.title} style={{ padding: 20, background: GH.paper }}>
                                <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <c.icon size={16} aria-hidden="true" style={{ color: GH.accent }} />
                                    {c.title}
                                </div>
                                <p style={{ fontSize: 14, color: GH.ink60, lineHeight: 1.6, margin: 0 }}>{c.description}</p>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CTA */}
                <div style={{ padding: '24px 0', borderTop: ghsubHairline, display: 'flex', flexDirection: 'column', alignItems: wide ? 'center' : 'stretch', gap: 12, textAlign: wide ? 'center' : 'left' }}>
                    <p style={{ fontSize: 16, color: GH.ink80, margin: 0 }}>
                        Нужно больше часов или особый формат? Подберём условия для вашей практики.
                    </p>
                    <a
                        href="https://t.me/UnboxCenter"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ui-btn ui-btn--secondary ui-btn--touch"
                    >
                        <MessageCircle size={16} aria-hidden="true" /> Написать в Telegram
                    </a>
                    <Link
                        to={toCatalog('/booking-rules')}
                        style={{ fontSize: 14, color: GH.ink, minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: wide ? 'center' : 'flex-start' }}
                    >
                        <span style={{ borderBottom: `1px solid ${GH.ink20}` }}>Правила бронирования</span>&nbsp;→
                    </Link>
                </div>

                {!inShell && (
                    <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 0', marginTop: 32, display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ ...ghsubMono, color: GH.label }}>UNBOX · 2026</span>
                        <span style={{ ...ghsubMono, color: GH.ink60 }}>Батуми · Грузия</span>
                    </footer>
                )}
            </div>
        </div>
    );
}

function PlanCard({ plan, wide }: { plan: (typeof PLANS)[number]; wide: boolean }) {
    const hasList = plan.features.length > 0 || plan.bonuses.length > 0;
    return (
        <article
            aria-labelledby={`plan-${plan.id}`}
            style={{
                border: plan.popular ? `2px solid ${GH.ink}` : ghsubHairline,
                background: GH.paper,
                padding: wide ? 20 : 16,
                display: 'flex', flexDirection: 'column',
            }}
        >
            {plan.badge && (
                <span style={{ ...ghsubMono, color: plan.popular ? GH.label : GH.ink60, marginBottom: 6 }}>
                    {plan.badge}
                </span>
            )}
            <h3 id={`plan-${plan.id}`} style={{ fontWeight: 600, fontSize: 20, margin: 0 }}>{plan.name}</h3>
            <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>{plan.tagline}</div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span className="num" style={{ fontSize: 28, fontWeight: 600 }}>{formatGel(plan.price)}</span>
                <span style={{ fontSize: 14, color: GH.ink60 }}>на {daysLabel(plan.durationDays)}</span>
            </div>
            {/* Решение владельца 30.09: выгода — только цена часа, без процентов. */}
            <div className="num" style={{ fontSize: 14, fontWeight: 600, color: GH.label, marginTop: 4 }}>
                ≈ {formatGel(plan.hourPrice)}/ч вместо {formatGel(plan.baseRate)}
            </div>

            <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <span style={tag}>
                    {plan.hours} ч{plan.bonusHours > 0 ? ` + ${plan.bonusHours} ч бонус` : ''}
                </span>
                {plan.capsuleHours > 0 && <span style={tag}>+ {plan.capsuleHours} ч в капсуле</span>}
                {plan.extraNote && <span style={tag}>{plan.extraNote}</span>}
            </div>

            {hasList && (
                <details key={String(wide)} open={wide} className="subs-details" style={{ marginTop: 12, borderTop: ghsubHairline, flex: 1 }}>
                    <summary style={{
                        listStyle: 'none', cursor: 'pointer',
                        minHeight: 44, display: wide ? 'none' : 'flex', alignItems: 'center', justifyContent: 'space-between',
                        fontSize: 14, fontWeight: 500, color: GH.ink,
                    }}>
                        Что входит
                        <ChevronDown size={16} aria-hidden="true" className="subs-chev" />
                    </summary>
                    <div style={{ paddingTop: wide ? 12 : 0, paddingBottom: 4 }}>
                        {plan.features.map(f => (
                            <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                                <Check size={14} aria-hidden="true" style={{ color: GH.accent, marginTop: 3, flexShrink: 0 }} />
                                <span style={{ fontSize: 14, color: GH.ink80 }}>{f}</span>
                            </div>
                        ))}
                        {plan.bonuses.length > 0 && (
                            <div style={{ marginTop: 10 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Бонусы</div>
                                {plan.bonuses.map(b => (
                                    <div key={b} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                                        <Gift size={14} aria-hidden="true" style={{ color: GH.accent, marginTop: 3, flexShrink: 0 }} />
                                        <span style={{ fontSize: 14, color: GH.ink80 }}>{b}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </details>
            )}

            {/* Решение владельца 30.09: оформление — через администратора
                в Telegram @UnboxCenter, с готовым текстом. Сервер не трогаем. */}
            <a
                href={orderLink(plan.name)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Оформить абонемент «${plan.name}» — откроется Telegram`}
                className={`ui-btn ui-btn--touch ui-btn--block ${plan.popular ? 'ui-btn--primary' : 'ui-btn--secondary'}`}
                style={{ marginTop: 16 }}
            >
                Оформить абонемент
            </a>
            <style>{`
                .subs-details > summary::-webkit-details-marker { display: none; }
                .subs-details[open] .subs-chev { transform: rotate(180deg); }
            `}</style>
        </article>
    );
}

const tag: React.CSSProperties = {
    fontSize: 12, color: GH.ink80, padding: '4px 8px', border: ghsubHairline,
};


/* ═══════════════════════════════════════════════════════════════
   Effective price chart — pricing infographic
   ═══════════════════════════════════════════════════════════════ */

/** Инфографика «цена часа» БЕРЁТ цены и часы из SUBSCRIPTION_PLANS (data.ts) —
 *  единого источника, тем же planHourPrice, что и карточки.
 *  Решение владельца 30.09: только цена часа, без процентов; недельная
 *  скидка со страницы убрана.
 *  G2-10 / X4-accessibility-M3: строка — два уровня (сверху название и цена,
 *  снизу полоса на всю ширину), чтобы на 320–390 px полосы не сжимались в
 *  квадратики и цена не обрезалась. */
const _plan = (id: string) => SUBSCRIPTION_PLANS.find(p => p.id === id) as DataPlan | undefined;
const scaleRow = (id: string, accent = false) => {
    const p = _plan(id);
    return p ? [{ name: p.name, perHour: planHourPrice(p), subtitle: `${planHours(p)} ч за ${formatGel(p.price)}`, accent }] : [];
};

const INDIVIDUAL_SCALE = [
    { name: 'Без абонемента', perHour: 20, subtitle: 'обычная ставка', accent: false },
    ...scaleRow('TRIAL'),
    ...scaleRow('WARM_START'),
    ...scaleRow('REGULAR_PRACTITIONER'),
    ...scaleRow('PRO_PLUS', true),
];

const GROUP_SCALE = [
    { name: 'Без абонемента', perHour: 35, subtitle: 'обычная ставка', accent: false },
    ...scaleRow('GROUP_MASTER', true),
];

function EffectivePriceChart() {
    return (
        <section aria-labelledby="subs-chart" style={{ marginBottom: 48 }}>
            <h2 id="subs-chart" style={sectionTitle}>Сколько стоит час</h2>
            <p style={{ fontSize: 14, color: GH.ink60, margin: '0 0 20px', maxWidth: 560, lineHeight: 1.5 }}>
                Полная полоса — обычная ставка. Чем короче полоса, тем дешевле вам обходится час.
            </p>
            <PriceScale title="Индивидуальный кабинет" baseRate={20} rows={INDIVIDUAL_SCALE} />
            <div style={{ height: 24 }} />
            <PriceScale title="Групповой формат" baseRate={35} rows={GROUP_SCALE} />
        </section>
    );
}

function PriceScale({ title, baseRate, rows }: {
    title: string;
    baseRate: number;
    rows: Array<{ name: string; perHour: number; subtitle: string; accent: boolean }>;
}) {
    return (
        <div>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap',
                marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${GH.ink}`,
            }}>
                <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
                <div style={{ fontSize: 14, color: GH.ink60 }}>
                    обычно <span className="num">{formatGel(baseRate)}/ч</span>
                </div>
            </div>
            <div style={{ border: ghsubHairline }}>
                {rows.map((r, i) => {
                    const fillPct = Math.min(100, (r.perHour / baseRate) * 100);
                    return (
                        <div key={r.name} style={{
                            padding: '12px 16px',
                            borderTop: i === 0 ? 'none' : ghsubHairline,
                            background: r.accent ? `${GH.accent}0A` : 'transparent',
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>{r.subtitle}</div>
                                </div>
                                <div className="num" style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap' }}>
                                    {r.perHour < baseRate ? '≈ ' : ''}{formatGel(r.perHour)}<span style={{ fontSize: 12, color: GH.ink60 }}>/ч</span>
                                </div>
                            </div>
                            <div
                                aria-hidden="true"
                                style={{ position: 'relative', height: 8, background: GH.ink10, marginTop: 8 }}
                            >
                                <div style={{
                                    position: 'absolute', left: 0, top: 0, bottom: 0,
                                    width: `${fillPct}%`,
                                    background: r.accent ? GH.accent : (fillPct >= 100 ? GH.ink30 : GH.ink),
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
