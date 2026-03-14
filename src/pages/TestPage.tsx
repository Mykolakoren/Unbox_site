import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, ChevronLeft, ExternalLink } from 'lucide-react';
import { getTest, calcScore } from '../data/tests';

const COLOR_MAP: Record<string, string> = {
    green: '#4a7c59',
    yellow: '#b5860f',
    orange: '#c2622d',
    red: '#b83232',
};

const BG_MAP: Record<string, string> = {
    green: 'rgba(71,122,89,0.10)',
    yellow: 'rgba(181,134,15,0.10)',
    orange: 'rgba(194,98,45,0.10)',
    red: 'rgba(184,50,50,0.10)',
};

export function TestPage() {
    const { testId } = useParams<{ testId: string }>();
    const navigate = useNavigate();
    const test = testId ? getTest(testId) : undefined;

    const [answers, setAnswers] = useState<(number | null)[]>(
        test ? Array(test.questions.length).fill(null) : []
    );
    const [currentQ, setCurrentQ] = useState(0);
    const [showResult, setShowResult] = useState(false);

    if (!test) {
        return (
            <div className="min-h-screen flex items-center justify-center flex-col gap-4">
                <p className="text-unbox-dark/50">Тест не найден</p>
                <Link to="/" className="text-unbox-green underline text-sm">На главную</Link>
            </div>
        );
    }

    const answered = answers.filter(a => a !== null).length;
    const progress = answered / test.questions.length;
    const allAnswered = answered === test.questions.length;
    const score = allAnswered ? calcScore(test.id, answers as number[]) : 0;
    const result = allAnswered ? test.interpret(score) : null;

    const selectAnswer = (qIdx: number, value: number) => {
        const next = [...answers];
        next[qIdx] = value;
        setAnswers(next);
        if (qIdx < test.questions.length - 1) {
            const nextUnanswered = next.findIndex((a, i) => i > qIdx && a === null);
            if (nextUnanswered !== -1) setCurrentQ(nextUnanswered);
        }
    };

    return (
        <div className="min-h-screen font-sans" style={{ background: 'rgb(246,248,247)' }}>
            {/* Fixed background */}
            <div className="fixed inset-0 z-0">
                <img src="/hero-bg.jpg" alt="" className="w-full h-full object-cover object-[center_45%]" />
                <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.62)' }} />
            </div>

            {/* Header */}
            <header className="relative z-10 flex items-center gap-4 px-6 py-5">
                <button
                    onClick={() => navigate(-1)}
                    className="flex items-center gap-1.5 text-sm text-unbox-dark/60 hover:text-unbox-dark transition-colors"
                >
                    <ArrowLeft size={15} /> Назад
                </button>
                <div className="h-4 w-px bg-black/15" />
                <Link to="/" className="text-xs text-unbox-dark/40 hover:text-unbox-green transition-colors">
                    Unbox
                </Link>
            </header>

            {/* Main */}
            <main className="relative z-10 max-w-2xl mx-auto px-4 pb-20">
                {/* Test header card */}
                <div
                    className="rounded-3xl p-6 mb-6"
                    style={{
                        background: 'rgba(255,255,255,0.70)',
                        backdropFilter: 'blur(24px)',
                        WebkitBackdropFilter: 'blur(24px)',
                        border: '1px solid rgba(255,255,255,0.80)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                    }}
                >
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">{test.emoji}</span>
                        <div>
                            <h1 className="font-bold text-xl text-unbox-dark">{test.name}</h1>
                            <p className="text-sm text-unbox-dark/50 mt-0.5">{test.description}</p>
                            <div className="flex items-center gap-3 mt-2">
                                <span className="text-xs text-unbox-dark/40 bg-black/5 px-2 py-0.5 rounded-full">
                                    {test.questionCount} вопросов
                                </span>
                                <span className="text-xs text-unbox-dark/40 bg-black/5 px-2 py-0.5 rounded-full">
                                    {test.duration}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Progress */}
                    {!showResult && (
                        <div className="mt-4">
                            <div className="flex justify-between text-xs text-unbox-dark/40 mb-1.5">
                                <span>Прогресс</span>
                                <span>{answered} / {test.questions.length}</span>
                            </div>
                            <div className="h-2 bg-black/8 rounded-full overflow-hidden">
                                <motion.div
                                    className="h-full bg-unbox-green rounded-full"
                                    animate={{ width: `${progress * 100}%` }}
                                    transition={{ duration: 0.3 }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                <AnimatePresence mode="wait">
                    {showResult && result ? (
                        <motion.div
                            key="result"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="space-y-4"
                        >
                            {/* Result card */}
                            <div
                                className="rounded-3xl p-6 text-center"
                                style={{
                                    background: BG_MAP[result.color],
                                    border: `1px solid ${COLOR_MAP[result.color]}30`,
                                    backdropFilter: 'blur(20px)',
                                    WebkitBackdropFilter: 'blur(20px)',
                                }}
                            >
                                <div className="text-6xl font-black mb-2" style={{ color: COLOR_MAP[result.color] }}>
                                    {score}
                                </div>
                                <div className="font-bold text-xl mb-3" style={{ color: COLOR_MAP[result.color] }}>
                                    {result.label}
                                </div>
                                <p className="text-unbox-dark/70 text-sm leading-relaxed">{result.description}</p>
                            </div>

                            {/* Recommendation */}
                            <div
                                className="rounded-2xl p-5"
                                style={{
                                    background: 'rgba(71,109,107,0.08)',
                                    border: '1px solid rgba(71,109,107,0.20)',
                                    backdropFilter: 'blur(20px)',
                                    WebkitBackdropFilter: 'blur(20px)',
                                }}
                            >
                                <p className="text-unbox-green font-semibold text-sm">{result.cta}</p>
                            </div>

                            <p className="text-[11px] text-unbox-dark/35 text-center px-4">
                                Этот тест носит информационный характер и не является медицинским диагнозом.
                                Для точной оценки обратитесь к специалисту.
                            </p>

                            {/* CTAs */}
                            <div className="flex flex-col gap-3">
                                <Link
                                    to="/"
                                    className="flex items-center justify-center gap-2 w-full py-3.5 rounded-2xl bg-unbox-green text-white font-bold hover:opacity-90 transition-opacity"
                                >
                                    Найти специалиста <ArrowRight size={16} />
                                </Link>
                                <a
                                    href="https://t.me/UnboxCenter"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-medium text-unbox-dark/70 hover:text-unbox-dark transition-colors"
                                    style={{
                                        background: 'rgba(255,255,255,0.65)',
                                        border: '1px solid rgba(0,0,0,0.10)',
                                        backdropFilter: 'blur(12px)',
                                    }}
                                >
                                    <ExternalLink size={14} /> Написать в Telegram
                                </a>
                                <button
                                    onClick={() => { setAnswers(Array(test.questions.length).fill(null)); setCurrentQ(0); setShowResult(false); }}
                                    className="text-sm text-unbox-dark/40 hover:text-unbox-dark transition-colors py-2"
                                >
                                    Пройти заново
                                </button>
                            </div>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="questions"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="space-y-4"
                        >
                            {/* Question navigator dots */}
                            <div className="flex items-center gap-1.5 flex-wrap px-1">
                                {test.questions.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setCurrentQ(i)}
                                        className="w-7 h-7 rounded-lg text-xs font-bold transition-all"
                                        style={
                                            answers[i] !== null
                                                ? { background: 'rgba(71,109,107,0.22)', color: 'rgb(44,80,78)', border: '1px solid rgba(71,109,107,0.38)' }
                                                : currentQ === i
                                                    ? { background: 'rgba(0,0,0,0.10)', color: 'rgb(44,50,64)', border: '1px solid rgba(0,0,0,0.18)' }
                                                    : { background: 'rgba(0,0,0,0.04)', color: 'rgba(44,50,64,0.35)', border: '1px solid rgba(0,0,0,0.06)' }
                                        }
                                    >
                                        {i + 1}
                                    </button>
                                ))}
                            </div>

                            {/* Current question */}
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={currentQ}
                                    initial={{ opacity: 0, x: 12 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -12 }}
                                    transition={{ duration: 0.18 }}
                                    className="rounded-3xl p-6 space-y-4"
                                    style={{
                                        background: 'rgba(255,255,255,0.70)',
                                        backdropFilter: 'blur(24px)',
                                        WebkitBackdropFilter: 'blur(24px)',
                                        border: '1px solid rgba(255,255,255,0.80)',
                                        boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                                    }}
                                >
                                    <p className="font-semibold text-unbox-dark leading-relaxed">
                                        <span className="text-unbox-dark/30 font-bold mr-2">{currentQ + 1}.</span>
                                        {test.questions[currentQ].text}
                                    </p>

                                    <div className="space-y-2">
                                        {test.questions[currentQ].options.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => selectAnswer(currentQ, opt.value)}
                                                className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all"
                                                style={
                                                    answers[currentQ] === opt.value
                                                        ? { background: 'rgba(71,109,107,0.15)', border: '1.5px solid rgba(71,109,107,0.45)', color: 'rgb(44,80,78)', fontWeight: 600 }
                                                        : { background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', color: 'rgba(44,50,64,0.75)' }
                                                }
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Navigation */}
                                    <div className="flex items-center justify-between pt-1">
                                        <button
                                            onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
                                            disabled={currentQ === 0}
                                            className="flex items-center gap-1 text-sm text-unbox-dark/40 hover:text-unbox-dark disabled:opacity-30 transition-colors"
                                        >
                                            <ChevronLeft size={15} /> Назад
                                        </button>

                                        {currentQ < test.questions.length - 1 ? (
                                            <button
                                                onClick={() => setCurrentQ(q => q + 1)}
                                                className="flex items-center gap-1 text-sm font-semibold text-unbox-green hover:opacity-70 transition-opacity"
                                            >
                                                Далее <ArrowRight size={15} />
                                            </button>
                                        ) : allAnswered ? (
                                            <button
                                                onClick={() => setShowResult(true)}
                                                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-bold hover:opacity-90 transition-opacity"
                                            >
                                                Получить результат <ArrowRight size={14} />
                                            </button>
                                        ) : (
                                            <span className="text-xs text-unbox-dark/35">Ответьте на все вопросы</span>
                                        )}
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>
        </div>
    );
}
