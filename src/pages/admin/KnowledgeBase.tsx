import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Sun, Moon, Clock, BookOpen, AlertCircle, ChevronDown, Star } from 'lucide-react';
import clsx from 'clsx';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

type SectionId = 'morning' | 'evening' | 'day' | 'rules' | 'pricing' | 'subscriptions' | 'glossary';

export function AdminKnowledgeBase() {
        const [expandedIds, setExpandedIds] = useState<Set<SectionId>>(new Set(['morning']));

    return <GridHouseKnowledgeBase expandedIds={expandedIds} setExpandedIds={setExpandedIds} />;
}


// ============================================================================
// Grid House variant — Vignelli/Bierut manual
// ============================================================================

type GHKBProps = {
    expandedIds: Set<SectionId>;
    setExpandedIds: React.Dispatch<React.SetStateAction<Set<SectionId>>>;
};

function GridHouseKnowledgeBase({ expandedIds, setExpandedIds }: GHKBProps) {
    const toggle = (id: SectionId) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    type GHSection = {
        id: SectionId;
        num: string;
        title: string;
        subtitle: string;
        body: React.ReactNode;
    };

    const eyebrow: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 };
    const para: React.CSSProperties = { fontFamily: GH_SANS, fontSize: 14, lineHeight: 1.55, color: GH.ink, margin: '0 0 12px 0' };
    const li: React.CSSProperties = { fontFamily: GH_SANS, fontSize: 14, lineHeight: 1.55, color: GH.ink, paddingLeft: 28, position: 'relative', marginBottom: 8 };
    const bullet: React.CSSProperties = { position: 'absolute', left: 0, top: 0, fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', color: GH.ink60, fontVariantNumeric: 'tabular-nums' };
    const boxHair: React.CSSProperties = { border: `1px solid ${GH.ink10}`, padding: 20, marginBottom: 16 };
    const subhead: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 12, paddingBottom: 8, borderBottom: `1px solid ${GH.ink10}` };

    const MorningChecklist = () => {
        const items = [
            ['01', 'Открытие', 'Открытие филиала или контроль открытия к первой брони. Снятие с сигнализации.'],
            ['02', 'Кухня · старт', 'Включение электротермоса, пополнение водой, заварка свежего имбиря.'],
        ];
        const roomChecks = [
            'Диван, кресла и подушки расправлены.',
            'Окна открыты на проветривание.',
            'На полу нет явно видимой грязи. При необходимости — влажные салфетки.',
            'Салфетницы заправлены.',
            'На столах чистые кувшины со свежей водой, стаканы, розетки для чайных пакетиков.',
            'В мусорках есть пакеты (заменить, если много мусора).',
            'Доски чистые, есть маркеры. Вещи на местах.',
            'Кондиционеры/обогреватели включены по необходимости.',
        ];
        const hallChecks = [
            'Отсутствие видимой грязи на полу.',
            'Бумажные полотенца заряжены, туалетная бумага — полный рулон.',
            'Раковины, зеркала, унитазы чистые. Освежитель воздуха в наличии.',
            'Жидкое мыло и моющее средство заправлены.',
            'На столах администратора и кухне чисто. Посуда вымыта.',
            'В наличии: чёрный и зелёный чай, кофе, сахар, лимон, имбирь.',
            'Нет сильно пахнущих продуктов или мусора.',
        ];
        const other = [
            ['05', 'Растения', 'Опрыснуть водой все растения, кроме фиалок.'],
            ['06', 'Атмосфера', 'В офисе звучит негромкая спокойная музыка без слов.'],
            ['07', 'Касса', 'Если таблички и касса не совпадают — связаться со вчерашним администратором.'],
            ['08', 'Плюша · Степаша', 'Смена корма, воды. УФ-лампа включена.'],
            ['09', 'Таблица', 'Заполнена таблица посещений. Проверить интернет.'],
            ['10', 'Внештатные', 'Взяты под контроль.'],
        ];
        return (
            <div>
                {items.map(([n, title, body]) => (
                    <div key={n} style={li}>
                        <span style={bullet}>{n}</span>
                        <strong style={{ fontWeight: 700 }}>{title}.</strong> {body}
                    </div>
                ))}
                <div style={boxHair}>
                    <div style={subhead}>03 · Проверка кабинетов и холла</div>
                    {roomChecks.map((t, i) => (
                        <div key={i} style={li}>
                            <span style={bullet}>{String(i + 1).padStart(2, '0')}</span>
                            {t}
                        </div>
                    ))}
                </div>
                <div style={boxHair}>
                    <div style={subhead}>04 · Холл, кухня, туалеты</div>
                    {hallChecks.map((t, i) => (
                        <div key={i} style={li}>
                            <span style={bullet}>{String(i + 1).padStart(2, '0')}</span>
                            {t}
                        </div>
                    ))}
                </div>
                {other.map(([n, title, body]) => (
                    <div key={n} style={li}>
                        <span style={bullet}>{n}</span>
                        <strong style={{ fontWeight: 700 }}>{title}.</strong> {body}
                    </div>
                ))}
            </div>
        );
    };

    const DayChecklist = () => {
        const items = [
            'Поддержание общей чистоты и порядка перед каждым новым клиентом.',
            'Своевременное пополнение расходных материалов в туалетах и кухне.',
            'Пополнение водой электротермоса.',
            'Своевременная помывка посуды за гостями.',
            'Контроль кассы и аккуратное заполнение табличек.',
            'Ответы на сообщения в рабочих мессенджерах.',
        ];
        return (
            <div>
                {items.map((t, i) => (
                    <div key={i} style={li}>
                        <span style={bullet}>{String(i + 1).padStart(2, '0')}</span>
                        {t}
                    </div>
                ))}
            </div>
        );
    };

    const EveningChecklist = () => {
        const items = [
            'Выключить электротермос, кофеварки, кондиционеры, светильники, колонку.',
            'Закрыть окна и распахнуть шторы для утреннего солнца цветам.',
            'Укрыть клетку Плюши и Степаши.',
            'Помыть посуду, турку, доску, нож (без жирных пятен).',
            'Очистить контейнер от пустых капсул Меама.',
            'Заполнить зелёную табличку — касса должна сходиться. Переслать итог сменщику.',
            'Ключ от кассы убрать в тайник.',
            'Проверить расходники (докупить в Турсе или передать сменщику).',
            'Передать внештатные ситуации сменщику.',
        ];
        return (
            <div>
                {items.map((t, i) => (
                    <div key={i} style={li}>
                        <span style={bullet}>{String(i + 1).padStart(2, '0')}</span>
                        {t}
                    </div>
                ))}
                <div style={{ border: `2px solid ${GH.danger}`, padding: 20, marginTop: 16 }}>
                    <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.danger, marginBottom: 8 }}>
                        10 · Финальный контроль
                    </div>
                    <p style={{ ...para, margin: 0, color: GH.ink, fontWeight: 600 }}>
                        Выключить весь свет. Поставить сигнализацию. Закрыть дверь. Задёрнуть шторы на входе. Снаружи проверить окна.
                    </p>
                </div>
            </div>
        );
    };

    const Rules = () => (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            <div style={boxHair}>
                <div style={subhead}>Основные правила бронирования</div>
                <div style={li}><span style={bullet}>01</span><strong style={{ fontWeight: 700 }}>Минималка.</strong> 1 час (60 мин). Шаг тарификации: 30 мин.</div>
                <div style={li}><span style={bullet}>02</span><strong style={{ fontWeight: 700 }}>55+5.</strong> 55 мин работы + 5 мин буфер перед следующим специалистом.</div>
                <div style={li}><span style={bullet}>03</span><strong style={{ fontWeight: 700, color: GH.danger }}>Overstay.</strong> Задержка &gt;5 мин — +30 мин к счёту. Продление только если следом нет брони.</div>
            </div>
            <div style={boxHair}>
                <div style={subhead}>Отмена и горящие окна</div>
                <div style={li}><span style={bullet}>01</span><strong style={{ fontWeight: 700 }}>Бесплатная отмена.</strong> Строго более чем за 24 часа до начала.</div>
                <div style={li}><span style={bullet}>02</span><strong style={{ fontWeight: 700 }}>Hot Booking.</strong> Бронь менее чем за 12 часов — требует одобрения администратора.</div>
            </div>
        </div>
    );

    const Pricing = () => {
        const rates = [
            ['Индивидуальный · Кабинет', '20 GEL'],
            ['Индивидуальный · Капсула', '10 GEL'],
            ['Групповой · Кабинет', '35 GEL'],
        ];
        // 2026-05-26: weekly_progressive disabled in backend — KB block
        // repurposed for the peak-hour surcharge that actually applies.
        const peakWindows = [
            ['09:00 – 10:00', '+5 ₾/ч'],
            ['20:00 – 22:00', '+5 ₾/ч'],
        ];
        const durationTiers = [
            ['2 – 2:59 часа подряд', '10%'],
            ['3 – 4:59 часа подряд', '15%'],
            ['5+ часов подряд', '20%'],
        ];
        return (
            <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 20 }}>
                    <div style={boxHair}>
                        <div style={subhead}>Базовые тарифы · 1 час</div>
                        {rates.map(([label, price], i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < rates.length - 1 ? `1px solid ${GH.ink10}` : 'none' }}>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14 }}>{label}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 14, fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{price}</strong>
                            </div>
                        ))}
                    </div>
                    <div style={boxHair}>
                        <div style={subhead}>Вечерний тариф (пиковые часы)</div>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, marginTop: 0, marginBottom: 10 }}>
                            Часы повышенного спроса — небольшая надбавка к часу аренды:
                        </p>
                        {peakWindows.map(([label, disc], i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < peakWindows.length - 1 ? `1px solid ${GH.ink10}` : 'none' }}>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>{label}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, background: GH.ink, color: GH.paper, padding: '2px 10px' }}>{disc}</strong>
                            </div>
                        ))}
                        <p style={{ ...para, fontSize: 11, color: GH.ink60, margin: '12px 0 0', fontStyle: 'italic' }}>
                            Все остальные часы — по стандартному тарифу.
                        </p>
                    </div>
                </div>

                {/* Скидка за несколько часов подряд + приветственный "первый час бесплатно" */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginBottom: 20 }}>
                    <div style={boxHair}>
                        <div style={subhead}>Скидка за длительность · одна бронь</div>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, marginTop: 0, marginBottom: 10 }}>
                            Применяется только к <strong style={{ color: GH.ink, fontWeight: 700 }}>непрерывной</strong> брони в <strong style={{ color: GH.ink, fontWeight: 700 }}>одном кабинете</strong>. Чем длиннее блок, тем выше процент:
                        </p>
                        {durationTiers.map(([label, disc], i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < durationTiers.length - 1 ? `1px solid ${GH.ink10}` : 'none' }}>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>{label}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, background: GH.ink, color: GH.paper, padding: '2px 10px' }}>{disc}</strong>
                            </div>
                        ))}
                        <p style={{ ...para, fontSize: 11, color: GH.ink60, margin: '12px 0 0', fontStyle: 'italic' }}>
                            Разорванные или параллельные брони в разных кабинетах в эту скидку не складываются.
                        </p>
                    </div>
                    <div style={boxHair}>
                        <div style={subhead}>Приветственный бонус</div>
                        <p style={{ ...para, fontSize: 14, marginTop: 0, marginBottom: 10, lineHeight: 1.55 }}>
                            При регистрации на счёт клиента автоматически зачисляется{' '}
                            <strong style={{ fontWeight: 700 }}>20 ₾</strong> — эквивалент одного часа индивидуального
                            бронирования. Бонус ведёт себя как обычные деньги: может быть использован для оплаты
                            <strong style={{ fontWeight: 700 }}> любой</strong> брони (кабинет, капсула, групповой формат).
                            При оформлении брони бонус автоматически вычитается из суммы; если бронь дороже — клиент
                            доплачивает разницу с основного баланса.
                        </p>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>Номинал</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700 }}>20 GEL</div>
                            </div>
                            <div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>Срок действия</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700 }}>15 дней</div>
                            </div>
                        </div>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, margin: '10px 0 0' }}>
                            Начисляется на бонусный кошелёк. Списывается FIFO. Срок 15 дней — за это время
                            клиент должен попробовать пространство, иначе бонус сгорает.
                        </p>
                    </div>
                </div>

                <div style={{ border: `1px solid ${GH.ink10}`, padding: 16, marginBottom: 20 }}>
                    <p style={{ ...para, margin: 0, fontSize: 12, color: GH.ink60 }}>
                        <strong style={{ color: GH.ink, fontWeight: 700 }}>Примечание.</strong> Скидки не суммируются — применяется одна, наиболее выгодная для клиента. Бонусный баланс и приветственный час списываются отдельно, поверх итоговой цены.
                    </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
                    <div style={boxHair}>
                        <div style={subhead}>Приоритет расчётов · один чек</div>
                        <div style={li}><span style={bullet}>01</span>Базовая цена (тариф × длительность)</div>
                        <div style={li}><span style={bullet}>02</span>Одна скидка: ручная → абонемент → недельная → за длительность</div>
                        <div style={li}><span style={bullet}>03</span>Списание с баланса (бонусы, приветственный час)</div>
                    </div>
                    <div style={boxHair}>
                        <div style={subhead}>Еженедельный кэшбэк</div>
                        <p style={{ ...para, fontSize: 13 }}>
                            Если прогрессивный процент в конце недели даёт цену ниже фактически уплаченной — разница зачисляется на бонусный баланс.
                        </p>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, margin: 0 }}>Срок действия бонусов — 60 дней.</p>
                    </div>
                </div>
            </div>
        );
    };

    const Subscriptions = () => {
        const plans = [
            { name: 'Пробный', price: '70 GEL', period: '14 дней', hours: '4 часа инд. + 1 час капсула', discount: '—', fmt: 'Индивидуальный', perk: 'Для первого знакомства' },
            { name: 'Тёплый старт', price: '180 GEL', period: '30 дней', hours: '10 часов инд. + 4 часа капсула', discount: '10%', fmt: 'Индивидуальный', perk: null },
            { name: 'Регулярный практик', price: '350 GEL', period: '30 дней', hours: '20 часов инд. + 6 часов капсула', discount: '15%', fmt: 'Индивидуальный', perk: '1 бесплатный перенос' },
            { name: 'Профи+', price: '650 GEL', period: '45 дней', hours: '40 часов инд. + 10 часов капсула', discount: '20%', fmt: 'Инд. и Групповой', perk: 'Приоритет · внеурочный доступ · рекомендуемый специалист' },
            { name: 'Групповой мастер', price: '450 GEL', period: '45 дней', hours: '20 часов групп. + 4 часа инд.', discount: '25%', fmt: 'Групповой · Кабинет', perk: 'Анонс мероприятия по базе' },
        ];
        return (
            <div>
                <p style={{ ...para, color: GH.ink60, fontSize: 13, marginBottom: 20 }}>
                    Абонемент даёт гарантированную скидку и фиксированный пакет часов. Часы списываются при подтверждении брони.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
                    {plans.map((plan, i) => (
                        <div key={plan.name} style={{ border: `1px solid ${GH.ink10}`, padding: 24, position: 'relative' }}>
                            <div style={{ position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: GH.ink }} />
                            <div style={{ ...eyebrow, marginBottom: 8 }}>План · {String(i + 1).padStart(2, '0')}</div>
                            <h4 style={{ fontFamily: GH_SANS, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em', margin: '0 0 8px 0' }}>
                                {plan.name}
                            </h4>
                            <div style={{ fontFamily: GH_MONO, fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginBottom: 4 }}>
                                {plan.price}
                            </div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60, marginBottom: 16 }}>
                                / {plan.period}
                            </div>
                            <div style={{ borderTop: `1px solid ${GH.ink10}`, paddingTop: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontFamily: GH_SANS, fontSize: 13 }}>
                                    <span style={{ color: GH.ink60 }}>Часов</span>
                                    <strong style={{ fontFamily: GH_MONO, fontVariantNumeric: 'tabular-nums' }}>{plan.hours}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontFamily: GH_SANS, fontSize: 13 }}>
                                    <span style={{ color: GH.ink60 }}>Скидка</span>
                                    <strong style={{ fontFamily: GH_MONO, background: GH.ink, color: GH.paper, padding: '2px 8px' }}>{plan.discount}</strong>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontFamily: GH_SANS, fontSize: 13 }}>
                                    <span style={{ color: GH.ink60 }}>Формат</span>
                                    <strong>{plan.fmt}</strong>
                                </div>
                            </div>
                            {plan.perk && (
                                <div style={{ borderTop: `1px solid ${GH.ink10}`, marginTop: 12, paddingTop: 12, fontFamily: GH_SANS, fontSize: 12, color: GH.ink }}>
                                    {plan.perk}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    // Excel #65 — glossary explaining admin-specific terms that tripped up new
    // staff (сессия vs бронь was the one they hit most).
    const Glossary = () => (
        <div>
            <p style={para}>
                Короткий словарь терминов, которые встречаются в CRM и на сайте.
                Если путаешь понятия — сюда.
            </p>

            <div style={boxHair}>
                <div style={subhead}>Бронь vs сессия</div>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Бронь</strong> — это аренда кабинета на
                    конкретное время. Физический ресурс. Видна в шахматке
                    «/dashboard/bookings» и «/admin/bookings». Оплачивается по тарифу
                    кабинета.
                </p>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Сессия</strong> — это встреча
                    специалист⇄клиент в CRM. Запись о приёме. Видна в «/crm/sessions».
                    Оплачивается отдельно (клиент → специалисту, отдельно от аренды).
                </p>
                <p style={para}>
                    Одна бронь может содержать одну сессию (специалист арендовал кабинет
                    и принял клиента), несколько сессий (групповой приём), или ни одной
                    (клиент арендовал кабинет для своей работы без CRM-записи).
                </p>
            </div>

            <div style={boxHair}>
                <div style={subhead}>Статусы бронирования</div>
                <div style={li}><span style={bullet}>01</span><strong>Подтверждена</strong> — активная бронь, клиент придёт.</div>
                <div style={li}><span style={bullet}>02</span><strong>Пересдана</strong> (re-rented) — владелец выставил на переаренду, другой клиент подхватил. Первоначальная бронь отменена с 50% возвратом.</div>
                <div style={li}><span style={bullet}>03</span><strong>На переаренде</strong> — владелец выставил слот на переаренду, но никто пока не подхватил. Бронь ещё активна.</div>
                <div style={li}><span style={bullet}>04</span><strong>Отменена</strong> — бронь отменена (возврат зависит от политики — см. ценовую политику).</div>
                <div style={li}><span style={bullet}>05</span><strong>Завершена</strong> — бронь прошла, время вышло.</div>
                <div style={li}><span style={bullet}>06</span><strong>No-show</strong> — клиент не пришёл без отмены. Попадает в чек-лист закрытия смены.</div>
            </div>

            <div style={boxHair}>
                <div style={subhead}>Финансы: способы оплаты</div>
                <div style={li}><span style={bullet}>01</span><strong>Наличные</strong> — кэш в кассу, бумажные деньги на руках у админа.</div>
                <div style={li}><span style={bullet}>02</span><strong>Карта TBC / BOG</strong> — оплата картой на терминале TBC или BOG. Зачисляется на соответствующий банковский счёт.</div>
                <div style={li}><span style={bullet}>03</span><strong>Перевод</strong> — внутренний перевод между счетами (наличные → карта и наоборот). Создаёт две транзакции (расход с одного + приход на другой).</div>
                <div style={li}><span style={bullet}>04</span><strong>С баланса</strong> — списание с баланса клиента (внутренняя валюта).</div>
            </div>

            <div style={boxHair}>
                <div style={subhead}>Смена</div>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Открыть смену</strong> — админ утром
                    фиксирует начало рабочего дня, остаток кассы. Запись попадает в журнал.
                </p>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Закрыть смену</strong> — админ вечером
                    проходит чек-лист (брони, расчёты, состояние центра), пересчитывает кассу,
                    фиксирует расхождение (если есть). Всё пишется в ShiftReport.
                </p>
            </div>

            <div style={boxHair}>
                <div style={subhead}>Бонусы, абонементы, баланс</div>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Баланс</strong> — денежный счёт клиента.
                    Пополняется при оплате с галкой «Зачислить на баланс». Тратится на любые услуги.
                </p>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Абонемент</strong> — пакет часов с
                    включёнными форматами (кабинет, капсула). Действует определённый период.
                    Часы списываются перед балансом.
                </p>
                <p style={para}>
                    <strong style={{ fontWeight: 700 }}>Бонус</strong> — бесплатные часы
                    (приветственный, за приглашение друга, за лояльность). FIFO-очередь: сначала
                    тратятся бонусы, потом абонемент, потом баланс.
                </p>
            </div>
        </div>
    );

    const sections: GHSection[] = [
        { id: 'morning', num: '01', title: 'Утренний чек-лист.', subtitle: 'Открытие, подготовка филиала, чистота', body: <MorningChecklist /> },
        { id: 'day', num: '02', title: 'В течение дня.', subtitle: 'Поддержание порядка и координация гостей', body: <DayChecklist /> },
        { id: 'evening', num: '03', title: 'Вечерний чек-лист.', subtitle: 'Выключение, уборка, отчёт по кассе', body: <EveningChecklist /> },
        { id: 'rules', num: '04', title: 'Правила пространства.', subtitle: 'Бронирование, отмены, горящие окна', body: <Rules /> },
        { id: 'pricing', num: '05', title: 'Ценовая политика.', subtitle: 'Тарифы, скидки, приветственный час, кэшбэк', body: <Pricing /> },
        { id: 'subscriptions', num: '06', title: 'Абонементы.', subtitle: 'Пакеты часов для регулярной практики', body: <Subscriptions /> },
        { id: 'glossary', num: '07', title: 'Глоссарий.', subtitle: 'Термины: бронь vs сессия, статусы, способы оплаты', body: <Glossary /> },
    ];

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 1100, margin: '0 auto', padding: 'clamp(24px, 4vw, 48px)' }}>
                {/* HEAD */}
                <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 32, marginBottom: 40 }}>
                    <div style={{ ...eyebrow, marginBottom: 12 }}>Раздел · База знаний</div>
                    <h1 style={{ fontFamily: GH_SANS, fontSize: 'clamp(36px, 4.5vw, 56px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 0.95, margin: '0 0 16px 0' }}>
                        Справочник и чек-листы.
                    </h1>
                    <p style={{ fontFamily: GH_SANS, fontSize: 16, lineHeight: 1.5, color: GH.ink60, maxWidth: 640, margin: 0 }}>
                        Вся необходимая информация, правила и процедуры для работы администраторов — в одном индексе.
                    </p>
                </div>

                {/* SECTIONS */}
                <div>
                    {sections.map(section => {
                        const isExpanded = expandedIds.has(section.id);
                        return (
                            <div key={section.id} style={{ borderTop: `1px solid ${GH.ink10}` }}>
                                <button
                                    onClick={() => toggle(section.id)}
                                    style={{
                                        width: '100%',
                                        display: 'grid',
                                        gridTemplateColumns: '60px 1fr 40px',
                                        alignItems: 'center',
                                        gap: 20,
                                        padding: '24px 0',
                                        background: 'transparent',
                                        border: 'none',
                                        textAlign: 'left',
                                        cursor: 'pointer',
                                        color: GH.ink,
                                    }}
                                >
                                    <div style={{ fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.14em', color: GH.ink60 }}>{section.num}</div>
                                    <div>
                                        <div style={{ fontFamily: GH_SANS, fontSize: 'clamp(20px, 2.2vw, 28px)', fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                                            {section.title}
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, marginTop: 6 }}>
                                            {section.subtitle}
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40, border: `1px solid ${GH.ink10}` }}>
                                        <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                                            <ChevronDown size={16} />
                                        </motion.div>
                                    </div>
                                </button>
                                <AnimatePresence initial={false}>
                                    {isExpanded && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                                            style={{ overflow: 'hidden' }}
                                        >
                                            <div style={{ paddingLeft: 80, paddingBottom: 32, paddingRight: 40 }}>
                                                {section.body}
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                    <div style={{ borderTop: `2px solid ${GH.ink}`, paddingTop: 20, marginTop: 20, fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60, display: 'flex', justifyContent: 'space-between' }}>
                        <span>Unbox · Справочник · {new Date().getFullYear()}</span>
                        <span>{sections.length} разделов</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
