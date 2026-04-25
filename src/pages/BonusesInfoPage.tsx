import { Link } from 'react-router-dom';
import { Gift, Clock, TrendingUp, Trophy, Users } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { PRICING_CONFIG } from '../utils/pricingConfig';

/**
 * Excel #20 — клиенту нужно где-то увидеть, какие скидки и бонусы у нас есть.
 * Кнопка «Получить бонусы» из dashboard'а раньше вела сюда в 404.
 *
 * Источник правды по числам — `src/utils/pricingConfig.ts`. Если поменяют
 * проценты в pricing config, эта страница автоматически обновится.
 */
export function BonusesInfoPage() {
    const duration = PRICING_CONFIG.discounts.duration;
    const weekly = PRICING_CONFIG.discounts.weekly_progressive;

    const sectionStyle: React.CSSProperties = {
        borderTop: `2px solid ${GH.ink}`,
        paddingTop: 24,
        marginBottom: 36,
    };
    const monoLabel: React.CSSProperties = {
        fontFamily: GH_MONO,
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: GH.ink60,
        marginBottom: 12,
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, maxWidth: 920, margin: '0 auto', padding: '32px 24px 80px' }}>
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 24, marginBottom: 32 }}>
                <p style={{ ...monoLabel, marginBottom: 8 }}>BONUS · DISCOUNTS</p>
                <h1 style={{ fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, margin: 0 }}>
                    Скидки и&nbsp;бонусы.
                </h1>
                <p style={{ marginTop: 12, fontSize: 16, color: GH.ink60, maxWidth: 640 }}>
                    Чем больше и&nbsp;стабильнее вы&nbsp;арендуете кабинет — тем меньше платите.
                    Скидки считаются автоматически при бронировании.
                </p>
            </div>

            {/* Первый час бесплатно */}
            <section style={sectionStyle}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <Gift size={28} style={{ color: GH.accent, marginTop: 4 }} />
                    <div>
                        <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 28px)', fontWeight: 800, margin: 0, marginBottom: 8 }}>
                            Первый час — бесплатно
                        </h2>
                        <p style={{ fontSize: 15, color: GH.ink60, margin: 0, marginBottom: 8 }}>
                            Если вы&nbsp;ещё не&nbsp;арендовали у&nbsp;нас кабинет — первая
                            бронь часа включена в&nbsp;«пробу». Платите только за&nbsp;последующее время.
                        </p>
                        <p style={{ fontSize: 13, color: GH.ink30, margin: 0 }}>
                            Применяется один раз, к&nbsp;первому бронированию через сайт.
                        </p>
                    </div>
                </div>
            </section>

            {/* Скидка за продолжительность */}
            <section style={sectionStyle}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <Clock size={28} style={{ color: GH.accent, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 28px)', fontWeight: 800, margin: 0, marginBottom: 8 }}>
                            Скидка за&nbsp;часы подряд
                        </h2>
                        <p style={{ fontSize: 15, color: GH.ink60, margin: 0, marginBottom: 16 }}>
                            Бронируете несколько часов в&nbsp;один заход — получаете скидку
                            на&nbsp;всё бронирование.
                        </p>
                        <div style={{ border: `1px solid ${GH.ink10}` }}>
                            {duration.map((d, i) => (
                                <div
                                    key={i}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between',
                                        padding: '12px 16px',
                                        borderBottom: i < duration.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                                    }}
                                >
                                    <span style={{ fontSize: 14, color: GH.ink }}>
                                        {d.max >= 9999 ? `от ${d.min} часов` : `${d.min}–${d.max} часа`}
                                    </span>
                                    <span style={{ fontFamily: GH_MONO, fontWeight: 700, fontSize: 14, color: GH.accent }}>
                                        −{d.percent}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* Прогрессивная еженедельная */}
            <section style={sectionStyle}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <TrendingUp size={28} style={{ color: GH.accent, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 28px)', fontWeight: 800, margin: 0, marginBottom: 8 }}>
                            Прогрессивная скидка по&nbsp;неделе
                        </h2>
                        <p style={{ fontSize: 15, color: GH.ink60, margin: 0, marginBottom: 16 }}>
                            Чем больше часов в&nbsp;неделю — тем выше скидка ретроспективно.
                            В&nbsp;воскресенье вечером мы&nbsp;считаем сумму часов и&nbsp;возвращаем разницу
                            бонусным балансом (можно тратить на&nbsp;следующие брони).
                        </p>
                        <div style={{ border: `1px solid ${GH.ink10}` }}>
                            {weekly
                                .filter(w => w.percent > 0)
                                .map((w, i, arr) => (
                                    <div
                                        key={i}
                                        style={{
                                            display: 'flex', justifyContent: 'space-between',
                                            padding: '12px 16px',
                                            borderBottom: i < arr.length - 1 ? `1px solid ${GH.ink10}` : 'none',
                                        }}
                                    >
                                        <span style={{ fontSize: 14, color: GH.ink }}>
                                            {w.max >= 9999 ? `от ${w.min} часов в неделю` : `${w.min}–${Math.floor(w.max)} часов в неделю`}
                                        </span>
                                        <span style={{ fontFamily: GH_MONO, fontWeight: 700, fontSize: 14, color: GH.accent }}>
                                            −{w.percent}%
                                        </span>
                                    </div>
                                ))}
                        </div>
                        <p style={{ fontSize: 12, color: GH.ink30, marginTop: 8 }}>
                            Бонусы действуют 60&nbsp;дней с&nbsp;момента начисления.
                        </p>
                    </div>
                </div>
            </section>

            {/* Абонементы */}
            <section style={sectionStyle}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <Trophy size={28} style={{ color: GH.accent, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 28px)', fontWeight: 800, margin: 0, marginBottom: 8 }}>
                            Абонементы — самая выгодная цена
                        </h2>
                        <p style={{ fontSize: 15, color: GH.ink60, margin: 0, marginBottom: 16 }}>
                            Покупаете пакет часов разом со&nbsp;скидкой 25–35%, тратите
                            в&nbsp;течение 60&nbsp;дней. Подходит, если у&nbsp;вас регулярная практика.
                        </p>
                        <Link
                            to="/subscriptions"
                            style={{
                                display: 'inline-block',
                                padding: '12px 24px',
                                background: GH.ink,
                                color: GH.paper,
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                fontWeight: 600,
                                letterSpacing: '0.16em',
                                textTransform: 'uppercase',
                                textDecoration: 'none',
                            }}
                        >
                            Посмотреть абонементы →
                        </Link>
                    </div>
                </div>
            </section>

            {/* Приведи друга */}
            <section style={sectionStyle}>
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                    <Users size={28} style={{ color: GH.accent, marginTop: 4 }} />
                    <div style={{ flex: 1 }}>
                        <h2 style={{ fontSize: 'clamp(20px, 2.4vw, 28px)', fontWeight: 800, margin: 0, marginBottom: 8 }}>
                            Приведи коллегу
                        </h2>
                        <p style={{ fontSize: 15, color: GH.ink60, margin: 0 }}>
                            Если по&nbsp;вашей рекомендации у&nbsp;нас начнёт работать другой специалист
                            — оба получите бонус 50&nbsp;₾ на&nbsp;баланс после его первого
                            бронирования. Напишите администратору в&nbsp;Telegram{' '}
                            <a href="https://t.me/UnboxCenter" target="_blank" rel="noreferrer" style={{ color: GH.ink, textDecoration: 'underline' }}>
                                @UnboxCenter
                            </a>{' '}
                            для оформления.
                        </p>
                    </div>
                </div>
            </section>

            <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 16, fontFamily: GH_MONO, fontSize: 11, color: GH.ink30 }}>
                Все скидки складываются по&nbsp;приоритету: подписка&nbsp;→ ручная корректировка →
                прогрессивная неделя&nbsp;→ часы подряд. Применяется самая выгодная.
            </div>
        </div>
    );
}
