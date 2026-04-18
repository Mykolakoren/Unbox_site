import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Sun, Moon, Clock, BookOpen, AlertCircle, ChevronDown, Star } from 'lucide-react';
import clsx from 'clsx';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

type SectionId = 'morning' | 'evening' | 'day' | 'rules' | 'pricing' | 'subscriptions';

export function AdminKnowledgeBase() {
    const gridHouse = useDesignFlag();
    const [expandedIds, setExpandedIds] = useState<Set<SectionId>>(new Set(['morning']));

    if (gridHouse) return <GridHouseKnowledgeBase expandedIds={expandedIds} setExpandedIds={setExpandedIds} />;

    const toggleExpanded = (id: SectionId) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    };

    const sections: {
        id: SectionId;
        title: string;
        subtitle: string;
        icon: React.ElementType;
        theme: {
            bg: string;
            border: string;
            text: string;
            iconBg: string;
            iconText: string;
        };
        content: React.ReactNode;
    }[] = [
            {
                id: 'morning',
                title: 'Утренний чек-лист',
                subtitle: 'Открытие, подготовка филиала, проверка чистоты',
                icon: Sun,
                theme: {
                    bg: 'bg-gradient-to-br from-[#FEFCE8] to-white',
                    border: 'border-yellow-200',
                    text: 'text-yellow-800',
                    iconBg: 'bg-yellow-100',
                    iconText: 'text-yellow-600'
                },
                content: (
                    <div className="space-y-4 text-[13px] md:text-sm text-unbox-dark">
                        <p><strong>1. Открытие:</strong> Открытие филиала или контроль открытия к первой брони. Снятие с сигнализации.</p>
                        <p><strong>2. Кухня старт:</strong> Включение электротермоса, пополнение водой, заварка свежего имбиря.</p>

                        <div className="bg-white/80 p-4 rounded-xl border border-yellow-100/60 shadow-sm">
                            <p className="font-semibold mb-2">3. Проверка кабинетов и холла (Первый вдох должен быть чистым и свежим!):</p>
                            <ul className="list-disc pl-5 space-y-1.5 marker:text-yellow-400">
                                <li>Диван, кресла и подушки расправлены.</li>
                                <li>Окна открыты на проветривание.</li>
                                <li>На полу нет явно видимой грязи. При необходимости протереть влажными салфетками.</li>
                                <li>Салфетницы заправлены салфетками.</li>
                                <li>На столах чистые кувшины со свежей водой, стаканы, розетки для чайных пакетиков.</li>
                                <li>В мусорках есть пакеты (заменить, если много мусора).</li>
                                <li>Доски чистые, есть маркеры. Остальные вещи на своих местах.</li>
                                <li>Включаем кондиционеры/обогреватели по необходимости.</li>
                            </ul>
                        </div>

                        <div className="bg-white/80 p-4 rounded-xl border border-yellow-100/60 shadow-sm">
                            <p className="font-semibold mb-2">4. Холл, кухня, туалеты:</p>
                            <ul className="list-disc pl-5 space-y-1.5 marker:text-yellow-400">
                                <li>Отсутствие видимой грязи на полу.</li>
                                <li>Бумажные полотенца заряжены, туалетная бумага — полный рулон (текущий или запасной).</li>
                                <li>Раковины, зеркала, унитазы чистые. Освежитель воздуха в наличии.</li>
                                <li>Жидкое мыло и моющее средство заправлены.</li>
                                <li>На столах администратора и кухне чисто. Нет пятен. Посуда вымыта.</li>
                                <li>В наличии: черный и зеленый чай, кофе, сахар, лимон, имбирь.</li>
                                <li>Нет сильно пахнущих продуктов или мусора.</li>
                            </ul>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                            <p><strong>5. Растения:</strong> Опрыснуть водой все растения, кроме фиалок.</p>
                            <p><strong>6. Атмосфера:</strong> В офисе звучит негромкая спокойная музыка без слов.</p>
                            <p><strong>7. Касса:</strong> Если таблички и касса не совпадают — связываемся со вчерашним администратором.</p>
                            <p><strong>8. Плюша и Степаша:</strong> Смена корма, воды. УФ-лампа включена.</p>
                            <p><strong>9. Таблица:</strong> Заполнена таблица посещений. Проверить интернет.</p>
                            <p><strong>10. Внештатные:</strong> Взяты под контроль.</p>
                        </div>
                    </div>
                )
            },
            {
                id: 'day',
                title: 'В течение дня',
                subtitle: 'Поддержание порядка и координация гостей',
                icon: Clock,
                theme: {
                    bg: 'bg-gradient-to-br from-green-50/50 to-white',
                    border: 'border-green-100',
                    text: 'text-green-800',
                    iconBg: 'bg-green-100',
                    iconText: 'text-green-600'
                },
                content: (
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-unbox-dark">
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Поддержание общей чистоты и порядка перед каждым новым клиентом.</li>
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Своевременное пополнение расходных материалов в туалетах и кухне.</li>
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Пополнение водой электротермоса.</li>
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Своевременная помывка посуды за гостями.</li>
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Контроль кассы и аккуратное заполнение табличек.</li>
                        <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-400 mt-1.5 flex-shrink-0" />Ответы на сообщения в рабочих мессенджерах.</li>
                    </ul>
                )
            },
            {
                id: 'evening',
                title: 'Вечерний чек-лист (Закрытие)',
                subtitle: 'Выключение техники, уборка, отчет по кассе',
                icon: Moon,
                theme: {
                    bg: 'bg-gradient-to-br from-unbox-light/50 to-white',
                    border: 'border-unbox-green/20',
                    text: 'text-unbox-dark',
                    iconBg: 'bg-unbox-light',
                    iconText: 'text-unbox-green'
                },
                content: (
                    <ul className="space-y-3 text-sm text-unbox-dark list-decimal pl-5 marker:font-bold marker:text-unbox-green">
                        <li>Выключить электротермос, кофеварки, кондиционеры, светильники, колонку.</li>
                        <li>Закрыть окна и распахнуть шторы для утреннего солнца цветам.</li>
                        <li>Укрыть клетку Плюши и Степаши.</li>
                        <li>Помыть посуду, турку, доску, нож (без жирных пятен).</li>
                        <li>Очистить контейнер от пустых капсул Меама.</li>
                        <li>Заполнить зелёную табличку (оплаты и расходы) - <strong>касса должна сходиться!</strong> Переслать итоговую сумму сменщику.</li>
                        <li>Ключ от кассы убрать в тайник. :)</li>
                        <li>Проверить расходники (докупить в Турсе или передать сменщику).</li>
                        <li>Передать внештатные ситуации сменщику.</li>
                        <li className="text-red-600 font-bold bg-red-50 p-2 rounded-lg -ml-5 pl-7 border border-red-100 mt-2">Выключить весь свет, поставить сигнализацию, закрыть дверь, задернуть шторы на входе. Снаружи проверить окна.</li>
                    </ul>
                )
            },
            {
                id: 'rules',
                title: 'Справочная информация и правила',
                subtitle: 'Основные правила пространства Unbox, отмены и переносы',
                icon: BookOpen,
                theme: {
                    bg: 'bg-white',
                    border: 'border-unbox-light',
                    text: 'text-unbox-dark',
                    iconBg: 'bg-unbox-light/50',
                    iconText: 'text-unbox-grey'
                },
                content: (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-unbox-dark">
                        <div>
                            <h3 className="font-bold flex items-center gap-2 mb-3 text-unbox-dark border-b pb-2">
                                <FileText size={16} className="text-unbox-green" />
                                Основные правила бронирования
                            </h3>
                            <ul className="space-y-2.5">
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" /><strong>Минималка:</strong> 1 час (60 мин). Шаг тарификации: 30 мин.</li>
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" /><strong>Правило "55+5":</strong> 55 мин работы + 5 мин буфер для проветривания перед следующим специалистом.</li>
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-300 mt-1.5 flex-shrink-0" /><strong>Overstay (задержка):</strong> Если задержка {'>'}5 мин, админ добавляет 30 мин к счету. Продление возможно ТОЛЬКО если после нет другой брони.</li>
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-bold flex items-center gap-2 mb-3 text-unbox-dark border-b pb-2">
                                <AlertCircle size={16} className="text-orange-500" />
                                Отмена и "Горящие окна"
                            </h3>
                            <ul className="space-y-2.5">
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" /><strong>Бесплатная отмена:</strong> Возможна строго более чем за 24 часа до начала.</li>
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-orange-300 mt-1.5 flex-shrink-0" /><strong>Горящие окна (Hot Booking):</strong> Бронь менее чем за 12 часов требует одобрения администратора.</li>
                            </ul>
                        </div>
                    </div>
                )
            },
            {
                id: 'pricing',
                title: 'Ценовая и скидочная политика',
                subtitle: 'Тарифы, абонементы и прогрессивная система скидок',
                icon: () => <span className="font-bold font-mono text-lg leading-none mt-1">₾</span>,
                theme: {
                    bg: 'bg-gradient-to-br from-unbox-light/30 to-white',
                    border: 'border-blue-100',
                    text: 'text-blue-900',
                    iconBg: 'bg-unbox-light',
                    iconText: 'text-unbox-green'
                },
                content: (
                    <div className="space-y-6 text-sm text-unbox-dark">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <p className="font-bold text-unbox-dark mb-3 border-b pb-2">Базовые тарифы (за 1 час):</p>
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-unbox-light shadow-sm">
                                        <span>Индивидуальный формат (Кабинет)</span>
                                        <strong className="text-unbox-dark">20 GEL</strong>
                                    </div>
                                    <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-unbox-light shadow-sm">
                                        <span>Индивидуальный формат (Капсула)</span>
                                        <strong className="text-unbox-dark">10 GEL</strong>
                                    </div>
                                    <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-unbox-light shadow-sm">
                                        <span>Групповой формат (Кабинет)</span>
                                        <strong className="text-unbox-dark">35 GEL</strong>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/80 p-4 rounded-xl border border-blue-100/60 shadow-sm">
                                <p className="font-bold text-unbox-dark mb-1">Прогрессивная еженедельная скидка (ПН-ВС)</p>
                                <p className="text-[11px] text-unbox-grey mb-3 leading-tight">Применяется к базовой стоимости автоматически, исходя из накопленных часов за текущую календарную неделю.</p>
                                <ul className="space-y-2">
                                    <li className="flex justify-between items-center"><span className="text-unbox-grey">до 5 часов</span> <strong className="bg-unbox-light/50 px-2 rounded">0%</strong></li>
                                    <li className="flex justify-between items-center"><span className="text-unbox-grey">5 - 11 часов</span> <strong className="bg-unbox-light text-unbox-dark px-2 rounded">10%</strong></li>
                                    <li className="flex justify-between items-center"><span className="text-unbox-grey">11 - 16 часов</span> <strong className="bg-unbox-light text-blue-800 px-2 rounded">25%</strong></li>
                                    <li className="flex justify-between items-center"><span className="text-unbox-grey">16+ часов</span> <strong className="bg-unbox-light text-unbox-dark px-2 rounded">50%</strong></li>
                                </ul>
                            </div>
                        </div>

                        <div className="flex items-start gap-2 text-[12px] text-unbox-grey bg-unbox-light/30 p-3 rounded-lg border border-unbox-light">
                            <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-unbox-grey" />
                            <p><strong>Примечание:</strong> Скидки не суммируются. Всегда применяется наиболее выгодный для пользователя вариант. Например, скидка по купленному абонементу перекрывает прогрессивную скидку "на лету".</p>
                        </div>

                        <div className="flex flex-col md:flex-row gap-6 mt-6">
                            <div className="flex-1 bg-white/80 p-4 rounded-xl border border-blue-100/60 shadow-sm">
                                <p className="font-bold text-unbox-dark mb-2">Приоритет расчетов (Один чек)</p>
                                <ul className="space-y-2 text-sm text-unbox-dark list-decimal pl-4 marker:text-unbox-green marker:font-bold">
                                    <li><strong>Базовая цена</strong> (Тариф × Длительность)</li>
                                    <li><strong>Применение правила скидки</strong> (Скидки не суммируются! Применяется только одна с наивысшим приоритетом: Ручная скидка админа → Абонемент → Еженедельная скидка → Скидка за длительность)</li>
                                    <li><strong>Списание с баланса</strong> (Бонусный кошелек)</li>
                                </ul>
                            </div>

                            <div className="flex-1 bg-unbox-light/50 p-4 rounded-xl border border-unbox-green/10 shadow-sm">
                                <p className="font-bold text-unbox-dark mb-2">Еженедельный бонус (Кэшбэк)</p>
                                <p className="text-[12px] text-unbox-grey mb-2">Система автоматически проверяет отхоженные часы в конце недели.</p>
                                <p className="text-[12px] text-unbox-dark">Если суммарный прогрессивный процент скидки в конце недели дает цену <strong>ниже</strong>, чем клиент фактически заплатил при бронировании (без абонемента), то разница автоматически зачисляется ему на <strong>бонусный баланс</strong>. <br /><em>Срок действия бонусов — 60 дней.</em></p>
                            </div>
                        </div>
                    </div>
                )
            },
            {
                id: 'subscriptions',
                title: 'Абонементы (Подписки)',
                subtitle: 'Условия пакетов часов для регулярной практики',
                icon: Star,
                theme: {
                    bg: 'bg-gradient-to-br from-purple-50/50 to-white',
                    border: 'border-purple-100',
                    text: 'text-purple-900',
                    iconBg: 'bg-purple-100',
                    iconText: 'text-purple-600'
                },
                content: (
                    <div className="space-y-5 text-sm text-unbox-dark">
                        <p className="text-[13px] text-unbox-grey mb-2">Абонемент дает гарантированную скидку и фиксированный пакет часов. При покупке абонемента часы списываются в момент подтверждения брони.</p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
                            {/* Пробный */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-200"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Пробный</h4>
                                <div className="text-purple-700 font-bold mb-3">70 GEL <span className="text-unbox-grey text-xs font-normal">/ 14 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Кабинет:</strong> 4 часа</li>
                                    <li><strong>Капсула:</strong> 1 час</li>
                                    <li><strong>Формат:</strong> Индивидуальный</li>
                                </ul>
                            </div>

                            {/* Тёплый старт */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-300"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Тёплый старт</h4>
                                <div className="text-purple-700 font-bold mb-3">180 GEL <span className="text-unbox-grey text-xs font-normal">/ 30 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Кабинет:</strong> 10 часов</li>
                                    <li><strong>Капсула:</strong> 4 часа</li>
                                    <li><strong>Формат:</strong> Индивидуальный</li>
                                </ul>
                            </div>

                            {/* Регулярный практик */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-400"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Регулярный практик</h4>
                                <div className="text-purple-700 font-bold mb-3">350 GEL <span className="text-unbox-grey text-xs font-normal">/ 30 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Кабинет:</strong> 20 часов</li>
                                    <li><strong>Капсула:</strong> 6 часов</li>
                                    <li><strong>Формат:</strong> Индивидуальный</li>
                                </ul>
                            </div>

                            {/* Профи+ */}
                            <div className="bg-white p-4 rounded-xl border border-purple-200 shadow-sm relative overflow-hidden shadow-purple-900/5">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-600"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Профи+</h4>
                                <div className="text-purple-700 font-bold mb-3">650 GEL <span className="text-unbox-grey text-xs font-normal">/ 45 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Кабинет:</strong> 40 часов</li>
                                    <li><strong>Капсула:</strong> 10 часов</li>
                                    <li><strong>Формат:</strong> Инд. и Групповой</li>
                                    <li className="text-purple-600 mt-2 text-[12px]">✨ Приоритетное бронирование</li>
                                </ul>
                            </div>

                            {/* Групповой мастер */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden md:col-span-2">
                                <div className="absolute top-0 left-0 w-1 h-full bg-pink-400"></div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-bold text-unbox-dark mb-1">Групповой мастер</h4>
                                        <div className="text-pink-600 font-bold mb-3">450 GEL <span className="text-unbox-grey text-xs font-normal">/ 45 дней</span></div>
                                        <ul className="space-y-1 text-unbox-grey">
                                            <li><strong>Групповой:</strong> 20 часов</li>
                                            <li><strong>Индивидуальный:</strong> 4 часа</li>
                                        </ul>
                                    </div>
                                    <div className="bg-pink-50 text-pink-700 px-3 py-1.5 rounded-lg text-[11px] font-bold border border-pink-100">
                                        Анонс мероприятия по базе
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }
        ];

    return (
        <div className="max-w-4xl mx-auto space-y-6 pb-12">
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-unbox-dark">База знаний</h1>
                <p className="text-unbox-grey mt-2">
                    Вся необходимая информация, правила и чек-листы для работы администраторов в компактном виде.
                </p>
            </div>

            <div className="space-y-3">
                {sections.map(section => {
                    const isExpanded = expandedIds.has(section.id);
                    const Icon = section.icon;

                    return (
                        <div
                            key={section.id}
                            className={clsx(
                                "rounded-2xl border transition-all duration-300 overflow-hidden",
                                section.theme.bg,
                                section.theme.border,
                                isExpanded ? "shadow-md" : "shadow-sm hover:shadow-md hover:border-unbox-light"
                            )}
                        >
                            {/* Header (Clickable) */}
                            <button
                                onClick={() => toggleExpanded(section.id)}
                                className="w-full flex items-center justify-between p-4 md:p-5 text-left outline-none"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={clsx(
                                        "w-12 h-12 flex items-center justify-center rounded-xl transition-colors",
                                        section.theme.iconBg,
                                        section.theme.iconText
                                    )}>
                                        <Icon size={24} />
                                    </div>
                                    <div>
                                        <h2 className={clsx("text-lg font-bold transition-colors", section.theme.text)}>
                                            {section.title}
                                        </h2>
                                        <p className="text-sm text-unbox-grey mt-0.5 hidden sm:block">
                                            {section.subtitle}
                                        </p>
                                    </div>
                                </div>

                                <motion.div
                                    animate={{ rotate: isExpanded ? 180 : 0 }}
                                    transition={{ duration: 0.2 }}
                                    className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-black/5 text-unbox-grey shrink-0"
                                >
                                    <ChevronDown size={20} />
                                </motion.div>
                            </button>

                            {/* Content (Animated expanding) */}
                            <AnimatePresence initial={false}>
                                {isExpanded && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
                                    >
                                        <div className="px-4 md:px-5 pb-5 pt-2 border-t border-black/5 mx-2 md:mx-4">
                                            {section.content}
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    );
                })}
            </div>
        </div>
    );
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
        const weeklyTiers = [
            ['до 5 часов', '0%'],
            ['5 – 11 часов', '10%'],
            ['11 – 16 часов', '25%'],
            ['16+ часов', '50%'],
        ];
        const durationTiers = [
            ['2 – 2:59 часа подряд', '10%'],
            ['3 – 3:59 часа подряд', '15%'],
            ['4+ часа подряд', '20%'],
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
                        <div style={subhead}>Еженедельная прогрессивная скидка</div>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, marginTop: 0, marginBottom: 10 }}>
                            Чем больше часов за неделю, тем выше процент:
                        </p>
                        {weeklyTiers.map(([label, disc], i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: i < weeklyTiers.length - 1 ? `1px solid ${GH.ink10}` : 'none' }}>
                                <span style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60 }}>{label}</span>
                                <strong style={{ fontFamily: GH_MONO, fontSize: 14, fontWeight: 700, background: GH.ink, color: GH.paper, padding: '2px 10px' }}>{disc}</strong>
                            </div>
                        ))}
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
                        <p style={{ ...para, fontSize: 14, marginTop: 0, marginBottom: 10 }}>
                            <strong style={{ fontWeight: 700 }}>Первый час — бесплатно.</strong>{' '}
                            Все новые клиенты получают 1 час индивидуального бронирования в подарок сразу после регистрации.
                        </p>
                        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
                            <div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>Номинал</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700 }}>20 GEL</div>
                            </div>
                            <div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>Срок действия</div>
                                <div style={{ fontFamily: GH_MONO, fontSize: 18, fontWeight: 700 }}>90 дней</div>
                            </div>
                        </div>
                        <p style={{ ...para, fontSize: 12, color: GH.ink60, margin: '10px 0 0' }}>
                            Начисляется автоматически на бонусный баланс. Списывается FIFO при оплате любой брони.
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

    const sections: GHSection[] = [
        { id: 'morning', num: '01', title: 'Утренний чек-лист.', subtitle: 'Открытие, подготовка филиала, чистота', body: <MorningChecklist /> },
        { id: 'day', num: '02', title: 'В течение дня.', subtitle: 'Поддержание порядка и координация гостей', body: <DayChecklist /> },
        { id: 'evening', num: '03', title: 'Вечерний чек-лист.', subtitle: 'Выключение, уборка, отчёт по кассе', body: <EveningChecklist /> },
        { id: 'rules', num: '04', title: 'Правила пространства.', subtitle: 'Бронирование, отмены, горящие окна', body: <Rules /> },
        { id: 'pricing', num: '05', title: 'Ценовая политика.', subtitle: 'Тарифы, скидки, приветственный час, кэшбэк', body: <Pricing /> },
        { id: 'subscriptions', num: '06', title: 'Абонементы.', subtitle: 'Пакеты часов для регулярной практики', body: <Subscriptions /> },
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
