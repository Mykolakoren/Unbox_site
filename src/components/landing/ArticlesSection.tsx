import { motion } from 'framer-motion';
import { BookOpen, ArrowRight } from 'lucide-react';

const ARTICLES = [
    {
        id: '1',
        tag: 'Тревога',
        title: 'Как отличить здоровую тревогу от тревожного расстройства',
        excerpt: 'Тревога — нормальная реакция на стресс. Но когда она начинает мешать жизни?',
        readMin: 5,
    },
    {
        id: '2',
        tag: 'Отношения',
        title: 'Почему мы выбираем похожих партнёров снова и снова',
        excerpt: 'Паттерны привязанности формируются в детстве и влияют на все наши отношения.',
        readMin: 7,
    },
    {
        id: '3',
        tag: 'Саморазвитие',
        title: 'Три признака того, что вам стоит поговорить с психологом',
        excerpt: 'Обращение за помощью — это сила, а не слабость.',
        readMin: 4,
    },
    {
        id: '4',
        tag: 'Инструменты',
        title: 'Дыхательные техники для быстрого снятия стресса',
        excerpt: 'Простые упражнения, которые работают здесь и сейчас.',
        readMin: 3,
    },
];

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(20px) saturate(150%)',
    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.65)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

export function ArticlesSection() {
    return (
        <section className="max-w-6xl mx-auto px-6 py-12">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="flex items-end justify-between mb-8"
            >
                <div>
                    <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Полезное</p>
                    <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Статьи и ресурсы</h2>
                    <p className="mt-1.5 text-unbox-dark/50 text-sm">Психология простым языком</p>
                </div>
                <button className="hidden sm:flex items-center gap-2 text-sm text-unbox-dark/50 hover:text-unbox-dark/80 transition-colors">
                    Все статьи <ArrowRight size={14} />
                </button>
            </motion.div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {ARTICLES.map((a, i) => (
                    <motion.div
                        key={a.id}
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.08 }}
                        className="flex flex-col gap-3 p-5 rounded-2xl cursor-pointer group hover:-translate-y-0.5 transition-all"
                        style={glassCard}
                    >
                        <div className="flex items-center gap-2">
                            <BookOpen size={13} className="text-unbox-green/70" />
                            <span className="text-[10px] font-semibold text-unbox-green uppercase tracking-wide">{a.tag}</span>
                        </div>
                        <div className="font-semibold text-unbox-dark text-sm leading-snug flex-1">
                            {a.title}
                        </div>
                        <div className="text-unbox-dark/50 text-xs leading-relaxed line-clamp-2">{a.excerpt}</div>
                        <div className="text-unbox-dark/30 text-xs mt-auto">{a.readMin} мин чтения</div>
                    </motion.div>
                ))}
            </div>
        </section>
    );
}
