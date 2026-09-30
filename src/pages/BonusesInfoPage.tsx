import { Link } from 'react-router-dom';
import { Gift, Clock, ArrowRight } from 'lucide-react';
import { PRICING_CONFIG } from '../utils/pricingConfig';

/**
 * «Скидки и бонусы» — что клиент реально получит.
 *
 * Решение владельца 30.09: на странице только то, что работает —
 * приветственный час (15 дней) и скидка за длительность брони 10/15/20 %.
 * Недельная скидка отключена (weekly_progressive = 0 %), «бонусы на 60 дней»
 * и «приведите коллегу» — не действуют; их здесь больше нет. Сервер не менялся.
 *
 * Проценты берутся из src/utils/pricingConfig.ts — поменяют там, обновится и тут.
 */

/** «от 2 ч» — длительность брони для строки скидки. */
function fromHours(h: number): string {
    return `от ${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(h)} ч`;
}

export function BonusesInfoPage() {
    const duration = PRICING_CONFIG.discounts.duration;

    return (
        <div className="mx-auto max-w-3xl text-ink">
            <header className="mb-8 border-b border-ink-10 pb-4">
                <h1 className="m-0 text-heading font-semibold">Скидки и бонусы</h1>
                <p className="mt-2 max-w-xl text-body text-ink-60">
                    Скидки считаются сами при бронировании — ничего вводить не нужно.
                </p>
            </header>

            {/* Приветственный час */}
            <section aria-labelledby="welcome-title" className="mb-6 border border-ink-10 bg-card p-6">
                <div className="flex items-start gap-4">
                    <Gift size={24} className="mt-1 shrink-0 text-ink-60" aria-hidden="true" />
                    <div>
                        <h2 id="welcome-title" className="m-0 mb-2 text-title font-semibold">
                            Первый час — бесплатно
                        </h2>
                        <p className="m-0 mb-2 text-body text-ink-80">
                            После регистрации на вашем счету появляется один бесплатный час аренды.
                            Он спишется сам при первой брони. Если бронь длиннее — остальное оплачивается
                            как обычно. При действующем абонементе приветственный час тратится на бронь до 1 часа.
                        </p>
                        {/* X3-02: срок приветственного часа — 15 дней
                            (auth.py WELCOME_BONUS_EXPIRY_DAYS), потом он сгорает. */}
                        <p className="m-0 text-small text-ink-60">
                            Действует 15&nbsp;дней после регистрации, один раз.
                        </p>
                    </div>
                </div>
            </section>

            {/* Скидка за длительность */}
            <section aria-labelledby="duration-title" className="mb-6 border border-ink-10 bg-card p-6">
                <div className="flex items-start gap-4">
                    <Clock size={24} className="mt-1 shrink-0 text-ink-60" aria-hidden="true" />
                    <div className="flex-1">
                        <h2 id="duration-title" className="m-0 mb-2 text-title font-semibold">
                            Скидка за&nbsp;длительность
                        </h2>
                        <p className="m-0 mb-4 text-body text-ink-80">
                            Бронируете несколько часов подряд — скидка на&nbsp;всю бронь.
                        </p>
                        <table className="w-full border-collapse text-body">
                            <caption className="sr-only">Скидка в зависимости от длительности брони</caption>
                            <thead>
                                <tr className="border-b border-ink-10 text-left text-small text-ink-60">
                                    <th scope="col" className="py-2 font-medium">Длительность брони</th>
                                    <th scope="col" className="py-2 text-right font-medium">Скидка</th>
                                </tr>
                            </thead>
                            <tbody>
                                {duration.map(d => (
                                    <tr key={d.min} className="border-b border-ink-10 last:border-b-0">
                                        <td className="py-3">{fromHours(d.min)}</td>
                                        <td className="num py-3 text-right font-semibold">−{d.percent}&nbsp;%</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="m-0 mt-3 text-small text-ink-60">
                            Скидка не действует на&nbsp;пиковые часы (9:00–10:00 и&nbsp;20:00–22:00).
                        </p>
                    </div>
                </div>
            </section>

            {/* Абонементы — только ссылка, без процентов (решение владельца: выгода — цена часа на тарифах). */}
            <Link
                to="/subscriptions"
                className="flex min-h-11 items-center justify-between gap-3 border border-ink-10 bg-card px-6 py-4 text-body font-medium text-ink no-underline hover:bg-ink-05"
            >
                <span>
                    Бронируете регулярно? Посмотрите абонементы — час в&nbsp;них дешевле.
                </span>
                <ArrowRight size={18} aria-hidden="true" className="shrink-0" />
            </Link>
        </div>
    );
}
