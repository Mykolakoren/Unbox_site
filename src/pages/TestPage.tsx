import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronLeft, ExternalLink } from 'lucide-react';
import { getTest, calcScore } from '../data/tests';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { STATUS } from '../design/tokens';
import { PublicHeader } from '../components/public/PublicHeader';
import { catalogPath } from '../utils/catalogPath';

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
                <p className="text-ink-60">Тест не найден</p>
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
}


/* ═══════════════════════════════════════════════════════════════
   Grid House — TestPage
   ═══════════════════════════════════════════════════════════════ */

const ghtpMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase' as const };
const ghtpHairline = `1px solid ${GH.ink10}`;

// Цвет результата — только статус-токены (зелёный «всё хорошо», янтарный
// «стоит обратить внимание», оранжевый warn «заметно», красный «нужна
// помощь»), без своих оттенков. У каждой пары свои fg и bg — не смешиваем.
// warn есть только в CSS (--status-warn-*), в tokens.ts его нет — берём var().
const GH_RESULT_MAP: Record<string, { fg: string; bg: string; border: string }> = {
    green:  { fg: STATUS.ok.fg,      bg: STATUS.ok.bg,      border: `${STATUS.ok.fg}30` },
    yellow: { fg: STATUS.pending.fg, bg: STATUS.pending.bg, border: `${STATUS.pending.fg}30` },
    orange: { fg: 'var(--status-warn-fg)', bg: 'var(--status-warn-bg)', border: 'color-mix(in srgb, var(--status-warn-fg) 19%, transparent)' },
    red:    { fg: STATUS.danger.fg,  bg: STATUS.danger.bg,  border: `${STATUS.danger.fg}30` },
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
            {/* G1-11 / G1-21: общая шапка сайта. Раньше «Назад» был navigate(-1) —
                пришедшего по прямой ссылке (Instagram) он уводил с сайта. */}
            <PublicHeader />

            {/* Main content */}
            <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px clamp(16px, 4vw, 20px) 80px' }}>
                {/* Test info */}
                <div style={{ ...ghtpMono, color: GH.ink60, marginBottom: 8 }}>ТЕСТ</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
                    <span style={{ fontSize: 32 }}>{test.emoji}</span>
                    <h1 style={{ fontSize: 'clamp(24px, 3vw, 36px)', fontWeight: 800, letterSpacing: '-0.02em', margin: 0 }}>
                        {test.name}
                    </h1>
                </div>
                <p style={{ fontSize: 14, color: GH.ink60, marginTop: 4, marginBottom: 0 }}>{test.description}</p>
                <div style={{ display: 'flex', gap: 12, marginTop: 12, marginBottom: 24 }}>
                    <span style={{ ...ghtpMono, color: GH.ink60, padding: '3px 8px', background: GH.ink5, borderRadius: 2 }}>
                        {test.questionCount} ВОПРОСОВ
                    </span>
                    <span style={{ ...ghtpMono, color: GH.ink60, padding: '3px 8px', background: GH.ink5, borderRadius: 2 }}>
                        {test.duration.toUpperCase()}
                    </span>
                </div>

                {/* Progress bar */}
                {!showResult && (
                    <div style={{ marginBottom: 32 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                            <span style={{ ...ghtpMono, color: GH.ink60 }}>ПРОГРЕСС</span>
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
                            <div style={{ padding: 32, border: `1px solid ${rc.border}`, background: rc.bg, textAlign: 'center', marginBottom: 24 }}>
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

                            {/* Оговорка важна для центра психологии: раньше она была
                                9 px моно-капсом с контрастом ~2:1 — теперь обычный текст. */}
                            <p style={{ fontFamily: GH_SANS, fontSize: 14, lineHeight: 1.5, color: GH.ink80, textAlign: 'center', maxWidth: 480, margin: '0 auto 32px' }}>
                                Этот тест носит информационный характер и&nbsp;не&nbsp;является медицинским диагнозом.
                            </p>

                            {/* CTAs */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                {/* G1-11: «Найти специалиста» ведёт в каталог, а не на «/»,
                                    где снова мог открыться экран выбора. */}
                                <Link
                                    to={catalogPath('/specialists')}
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
                                    style={{ background: 'none', border: 'none', fontSize: 13, color: GH.ink60, cursor: 'pointer', padding: '8px 0', minHeight: 44, fontFamily: GH_SANS }}
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
                                            width: 28, height: 28, fontSize: 12, fontWeight: 700, fontFamily: GH_MONO,
                                            border: answers[i] !== null
                                                ? `1px solid ${GH.accent}`
                                                : currentQ === i
                                                    ? `1px solid ${GH.ink}`
                                                    : ghtpHairline,
                                            background: answers[i] !== null
                                                ? 'rgba(71,109,107,0.12)'
                                                : currentQ === i ? GH.ink5 : 'transparent',
                                            color: answers[i] !== null ? GH.accent : currentQ === i ? GH.ink : GH.ink60,
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
                                        <span style={{ fontFamily: GH_MONO, color: GH.ink60, fontWeight: 700, marginRight: 8 }}>{currentQ + 1}.</span>
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
                                                display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, minHeight: 44,
                                                color: currentQ === 0 ? GH.ink30 : GH.ink60, background: 'none',
                                                border: 'none', cursor: currentQ === 0 ? 'default' : 'pointer', fontFamily: GH_SANS,
                                            }}
                                        >
                                            <ChevronLeft size={14} /> Назад
                                        </button>

                                        {currentQ < test.questions.length - 1 ? (
                                            <button
                                                onClick={() => setCurrentQ(q => (q as number) + 1)}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, minHeight: 44,
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
                                            <span style={{ ...ghtpMono, color: GH.ink60, fontSize: 12 }}>ОТВЕТЬТЕ НА ВСЕ ВОПРОСЫ</span>
                                        )}
                                    </div>
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* Footer */}
            <footer style={{ borderTop: `2px solid ${GH.ink}`, padding: '16px clamp(16px, 4vw, 24px)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ ...ghtpMono, color: GH.ink60, fontSize: 12 }}>UNBOX · 2026</span>
                <span style={{ ...ghtpMono, color: GH.ink60, fontSize: 12 }}>Батуми · Грузия</span>
            </footer>
        </div>
    );
}
