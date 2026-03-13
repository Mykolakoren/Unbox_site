import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Sun, Moon, Clock, BookOpen, AlertCircle, ChevronDown, Star } from 'lucide-react';
import clsx from 'clsx';

type SectionId = 'morning' | 'evening' | 'day' | 'rules' | 'pricing' | 'subscriptions';

export function AdminKnowledgeBase() {
    const [expandedIds, setExpandedIds] = useState<Set<SectionId>>(new Set(['morning']));

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
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-300 mt-1.5 flex-shrink-0" /><strong>Overstay (задержка):</strong> Если задержка {'>'}10 мин, админ добавляет 30 мин к счету. Продление возможно ТОЛЬКО если после нет другой брони.</li>
                            </ul>
                        </div>
                        <div>
                            <h3 className="font-bold flex items-center gap-2 mb-3 text-unbox-dark border-b pb-2">
                                <AlertCircle size={16} className="text-orange-500" />
                                Отмена и "Горящие окна"
                            </h3>
                            <ul className="space-y-2.5">
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" /><strong>Бесплатная отмена:</strong> Возможна строго более чем за 24 часа до начала.</li>
                                <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-orange-300 mt-1.5 flex-shrink-0" /><strong>Горящие окна (Hot Booking):</strong> Бронь менее чем за 12 часов дает скидку 10%. Такие брони <strong>non-refundable</strong> (не подлежат возврату/переносу).</li>
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
                                    <li><strong>Применение правила скидки</strong> (Скидки не суммируются! Применяется только одна с наивысшим приоритетом: Ручная скидка админа → Абонемент → Еженедельная скидка → Горящее окно)</li>
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
                            {/* Тёплый старт */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-300"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Тёплый старт</h4>
                                <div className="text-purple-700 font-bold mb-3">180 GEL <span className="text-unbox-grey text-xs font-normal">/ 30 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Часов:</strong> 10 часов</li>
                                    <li><strong>Скидка:</strong> 10%</li>
                                    <li><strong>Формат:</strong> Индивидуальный</li>
                                </ul>
                            </div>

                            {/* Регулярный практик */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-400"></div>
                                <h4 className="font-bold text-unbox-dark mb-1">Регулярный практик</h4>
                                <div className="text-purple-700 font-bold mb-3">340 GEL <span className="text-unbox-grey text-xs font-normal">/ 30 дней</span></div>
                                <ul className="space-y-1 text-unbox-grey">
                                    <li><strong>Часов:</strong> 20 часов</li>
                                    <li><strong>Скидка:</strong> 15%</li>
                                    <li><strong>Формат:</strong> Индивидуальный</li>
                                    <li className="text-purple-600 mt-2 text-[12px]">✨ 1 бесплатный перенос</li>
                                </ul>
                            </div>

                            {/* Профи+ */}
                            <div className="bg-white p-4 rounded-xl border border-purple-200 shadow-sm relative overflow-hidden md:col-span-2 shadow-purple-900/5">
                                <div className="absolute top-0 left-0 w-1 h-full bg-purple-600"></div>
                                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                                    <div>
                                        <h4 className="font-bold text-unbox-dark mb-1">Профи+</h4>
                                        <div className="text-purple-700 font-bold mb-3">640 GEL <span className="text-unbox-grey text-xs font-normal">/ 45 дней</span></div>
                                        <ul className="space-y-1 text-unbox-grey">
                                            <li><strong>Часов:</strong> 40 часов <span className="text-purple-600 font-bold">(+2 бонусных)</span></li>
                                            <li><strong>Скидка:</strong> 20%</li>
                                            <li><strong>Формат:</strong> Инд. и Групповой</li>
                                        </ul>
                                    </div>
                                    <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 text-[12px] space-y-1.5 min-w-[200px]">
                                        <p className="font-bold text-purple-900 mb-1">Привилегии:</p>
                                        <p className="flex items-center gap-1.5"><span className="text-purple-500">✨</span> Приоритетное бронирование</p>
                                        <p className="flex items-center gap-1.5"><span className="text-purple-500">✨</span> Внеурочный доступ (капсула)</p>
                                        <p className="flex items-center gap-1.5"><span className="text-purple-500">✨</span> Рекомендуемый специалист</p>
                                    </div>
                                </div>
                            </div>

                            {/* Групповой мастер */}
                            <div className="bg-white p-4 rounded-xl border border-purple-100 shadow-sm relative overflow-hidden md:col-span-2">
                                <div className="absolute top-0 left-0 w-1 h-full bg-pink-400"></div>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <h4 className="font-bold text-unbox-dark mb-1">Групповой мастер</h4>
                                        <div className="text-pink-600 font-bold mb-3">420 GEL <span className="text-unbox-grey text-xs font-normal">/ 30 дней</span></div>
                                        <ul className="space-y-1 text-unbox-grey">
                                            <li><strong>Гостей:</strong> Групповой (только Кабинет)</li>
                                            <li><strong>Часов:</strong> 16 часов</li>
                                            <li><strong>Скидка:</strong> 25%</li>
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
