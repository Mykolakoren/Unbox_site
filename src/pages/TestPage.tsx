import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, ChevronLeft, ExternalLink } from 'lucide-react';
import { getTest, calcScore } from '../data/tests';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

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
    const gridHouse = useDesignFlag();
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

    if (gridHouse) return (
        <GridHouseTestPage
            test={test}
            answers={answers}
            currentQ={currentQ}
            showResult={showResult}
            answered={answered}
            progress={progress}
            allAnswered={allAnswered}
            score={score}
            result={result}
            setCurrentQ={setCurrentQ}
            setShowResult={setShowResult}
            setAnswers={setAnswers}
            selectAnswer={selectAnswer}
            navigate={navigate}
        />
    );

    return (
        <div className="min-h-screen font-sans" style={{ background: 'rgb(246,248,247)' }}>
            {/* Background */}
            <div className="fixed inset-0 z-0" style={{ background: '#F0EDE6' }} />

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

/* ═══════════════════════════════════════════════════════════════
   Grid House — TestPage
   ═══════════════════════════════════════════════════════════════ */

const ghtpMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase' as const };
const ghtpHairline = `1px solid ${GH.ink10}`;

const GH_RESULT_MAP: Record<string, { fg: string; bg: string }> = {
    green:  { fg: GH.accent,  bg: 'rgba(71,109,107,0.08)' },
    yellow: { fg: '#9A7B1E',  bg: 'rgba(154,123,30,0.08)' },
    orange: { fg: '#B8652F',  bg: 'rgba(184,101,47,0.08)' },
    red:    { fg: GH.danger,  bg: 'rgba(184,74,47,0.08)' },
};

interface GridHouseTestPageProps {
    test: import('../data/tests').Test;
    answers: (number | null)[];
    currentQ: number;
    showResult: boolean;
    answered: number;
    progress: number;
    allAnswered: boolean;
    score: number;
    result: import('../data/tests').TestResult | null;
    setCurrentQ: (n: number | ((q: number) => number)) => void;
    setShowResult: (v: boolean) => void;
    setAnswers: (a: (number | null)[]) => void;
    selectAnswer: (qIdx: number, value: number) => void;
    navigate: ReturnType<typeof useNavigate>;
}

function GridHouseTestPage({
    test, answers, currentQ, showResult, answered, progress, allAnswered,
    score, result, setCurrentQ, setShowResult, setAnswers, selectAnswer, navigate,
}: GridHouseTestPageProps) {
    const rc = result ? (GH_RESULT_MAP[result.color] || GH_RESULT_MAP.green) : GH_RESULT_MAP.green;

    return (
        <div style={{ minHeight: '100vh', fontFamily: GH_SANS, background: GH.paper, color: GH.ink }}>
            {/* Header */}
            <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '20px 24px', borderBottom: `2px solid ${GH.ink}` }}>
                <button
                    onClick={() => navigate(-1)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: GH.ink60, background: 'none', border: 'none', cursor: 'pointer', fontFamily: GH_SANS }}
                >
                    <ArrowLeft size={14} /> Назад
                </button>
                <div style={{ width: 1, height: 16, background: GH.ink10 }} />
                <Link to="/" style={{ ...ghtpMono, color: GH.ink30, textDecoration: 'none', fontSize: 10 }}>
                    UNBOX
                </Link>
            </header>

            {/* Main content */}
            <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px 80px' }}>
                {/* Test info */}
                <div style={{ ...ghtpMono, color: GH.ink30, marginBottom: 8 }}>ТЕСТ</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
                    <span style={{ fontSize: 32 }}>{test.emoji}</span>
                    <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                        {test.name}
                    </h1>
                </div>
                <p style={{ fontSize: 14, color: GH.ink60, marginTop: 4, marginBottom: 0 }}>{test.description}</p>
                <div style={{ display: 'flex', gap: 12, marginTop: 12, marginBottom: 24 }}>
                    <span style={{ ...ghtpMono, color: GH.ink30, padding: '3px 8px', background: GH.ink5, borderRadius: 2 }}>
                        {test.questionCount} ВОПРОСОВ
                    </span>
                    <span style={{ ...ghtpMono, color: GH.ink30, padding: '3px 8px', background: GH.ink5, borderRadius: 2 }}>
                        {test.duration.toUpperCase()}
                    </span>
                </div>

                {/* Progress bar */}
                {!showResult && (
                    <div style={{ marginBottom: 32 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ ...ghtpMono, color: GH.ink30 }}>ПРОГРЕСС</span>
                            <span style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 600, color: GH.ink60, fontVariantNumeric: 'tabular-nums' }}>
                                {answered} / {test.questions.length}
                            </span>
                        </div>
                        <div style={{ height: 3, background: GH.ink5, borderRadius: 0 }}>
                            <motion.div
                                style={{ height: '100%', background: GH.ink, borderRadius: 0 }}
                                animate={{ width: `${progress * 100}%` }}
                                transition={{ duration: 0.3 }}
                            />
                        </div>
                    </div>
                )}

                <div style={{ borderTop: ghtpHairline }} />

                <AnimatePresence mode="wait">
                    {showResult && result ? (
                        <motion.div
                            key="result"
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            style={{ paddingTop: 32 }}
                        >
                            {/* Score card */}
                            <div style={{ padding: 32, border: `1px solid ${rc.fg}30`, background: rc.bg, textAlign: 'center', marginBottom: 24 }}>
                                <div style={{ fontFamily: GH_MONO, fontSize: 'clamp(48px, 6vw, 72px)', fontWeight: 700, color: rc.fg, lineHeight: 1 }}>
                                    {score}
                                </div>
                                <div style={{ fontWeight: 700, fontSize: 18, color: rc.fg, marginTop: 8, marginBottom: 12 }}>
                                    {result.label}
                                </div>
                                <p style={{ fontSize: 14, color: GH.ink60, lineHeight: 1.6, maxWidth: 480, margin: '0 auto' }}>
                                    {result.description}
                                </p>
                            </div>

                            {/* Recommendation */}
                            <div style={{ padding: 20, border: `1px solid ${GH.accent}30`, background: 'rgba(71,109,107,0.04)', marginBottom: 24 }}>
                                <p style={{ fontSize: 14, fontWeight: 600, color: GH.accent, margin: 0 }}>{result.cta}</p>
                            </div>

                            <p style={{ ...ghtpMono, color: GH.ink30, textAlign: 'center', fontSize: 9, marginBottom: 32 }}>
                                ЭТОТ ТЕСТ НОСИТ ИНФОРМАЦИОННЫЙ ХАРАКТЕР И НЕ ЯВЛЯЕТСЯ МЕДИЦИНСКИМ ДИАГНОЗОМ
                            </p>

                            {/* CTAs */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <Link
                                    to="/"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        padding: '14px 0', background: GH.ink, color: GH.paper, fontWeight: 700,
                                        fontSize: 14, fontFamily: GH_SANS, textDecoration: 'none', border: 'none',
                                    }}
                                >
                                    Найти специалиста <ArrowRight size={15} />
                                </Link>
                                <a
                                    href="https://t.me/UnboxCenter"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        padding: '12px 0', border: ghtpHairline, background: 'transparent',
                                        color: GH.ink60, fontSize: 13, fontFamily: GH_SANS, textDecoration: 'none',
                                    }}
                                >
                                    <ExternalLink size={14} /> Написать в Telegram
                                </a>
                                <button
                                    onClick={() => { setAnswers(Array(test.questions.length).fill(null)); setCurrentQ(0); setShowResult(false); }}
                                    style={{ background: 'none', border: 'none', fontSize: 13, color: GH.ink30, cursor: 'pointer', padding: '8px 0', fontFamily: GH_SANS }}
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
                            style={{ paddingTop: 24 }}
                        >
                            {/* Question navigator */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 24 }}>
                                {test.questions.map((_, i) => (
                                    <button
                                        key={i}
                                        onClick={() => setCurrentQ(i)}
                                        style={{
                                            width: 28, height: 28, fontSize: 11, fontWeight: 700, fontFamily: GH_MONO,
                                            border: answers[i] !== null
                                                ? `1px solid ${GH.accent}`
                                                : currentQ === i
                                                    ? `1px solid ${GH.ink}`
                                                    : ghtpHairline,
                                            background: answers[i] !== null
                                                ? 'rgba(71,109,107,0.12)'
                                                : currentQ === i ? GH.ink5 : 'transparent',
                                            color: answers[i] !== null ? GH.accent : currentQ === i ? GH.ink : GH.ink30,
                                            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}
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
                                    style={{ padding: 24, border: ghtpHairline }}
                                >
                                    <p style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.6, marginTop: 0, marginBottom: 20 }}>
                                        <span style={{ fontFamily: GH_MONO, color: GH.ink30, fontWeight: 700, marginRight: 8 }}>{currentQ + 1}.</span>
                                        {test.questions[currentQ].text}
                                    </p>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {test.questions[currentQ].options.map(opt => (
                                            <button
                                                key={opt.value}
                                                onClick={() => selectAnswer(currentQ, opt.value)}
                                                style={{
                                                    width: '100%', textAlign: 'left', padding: '12px 16px', fontSize: 14,
                                                    fontFamily: GH_SANS, cursor: 'pointer', transition: 'all 0.15s',
                                                    border: answers[currentQ] === opt.value
                                                        ? `2px solid ${GH.accent}`
                                                        : ghtpHairline,
                                                    background: answers[currentQ] === opt.value
                                                        ? 'rgba(71,109,107,0.06)' : 'transparent',
                                                    color: answers[currentQ] === opt.value ? GH.accent : GH.ink60,
                                                    fontWeight: answers[currentQ] === opt.value ? 600 : 400,
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Navigation */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, paddingTop: 16, borderTop: ghtpHairline }}>
                                        <button
                                            onClick={() => setCurrentQ(q => Math.max(0, (q as number) - 1))}
                                            disabled={currentQ === 0}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
                                                color: currentQ === 0 ? GH.ink10 : GH.ink60, background: 'none',
                                                border: 'none', cursor: currentQ === 0 ? 'default' : 'pointer', fontFamily: GH_SANS,
                                            }}
                                        >
                                            <ChevronLeft size={14} /> Назад
                                        </button>

                                        {currentQ < test.questions.length - 1 ? (
                                            <button
                                                onClick={() => setCurrentQ(q => (q as number) + 1)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 13,
                                                    fontWeight: 600, color: GH.accent, background: 'none',
                                                    border: 'none', cursor: 'pointer', fontFamily: GH_SANS,
                                                }}
                                            >
                                                Далее <ArrowRight size={14} />
                                            </button>
                                        ) : allAnswered ? (
                                            <button
                                                onClick={() => setShowResult(true)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px',
                                                    background: GH.ink, color: GH.paper, fontWeight: 700, fontSize: 13,
                                                    border: 'none', cursor: 'pointer', fontFamily: GH_SANS,
                                                }}
                                            >
                                                Получить результат <ArrowRight size={14} />
                                            </button>
                                        ) : (
                                            <span style={{ ...ghtpMono, color: GH.ink30, fontSize: 10 }}>ОТВЕТЬТЕ НА ВСЕ ВОПРОСЫ</span>
                                        )}
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ ...ghtpMono, color: GH.ink30, fontSize: 10 }}>UNBOX · 2026</span>
                <span style={{ ...ghtpMono, color: GH.ink10, fontSize: 10 }}>GRID HOUSE</span>
            </footer>
        </div>
    );
}
