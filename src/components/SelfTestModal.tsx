import { useState } from 'react';
import { X, ArrowRight, ChevronLeft, ExternalLink, MessageCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Test, calcScore } from '../data/tests';
import { COLOR, SHADOW, STATUS } from '../design/tokens';

interface Props {
    test: Test;
    onClose: () => void;
    onScrollToSpecialists?: () => void;
}

// Цвет результата — только статусные токены (wave 1): свои оттенки
// зелёного/жёлтого/красного были ниже AA на своём фоне.
const COLOR_MAP: Record<string, string> = {
    green: STATUS.ok.fg,
    yellow: STATUS.pending.fg,
    orange: 'var(--status-warn-fg)',
    red: STATUS.danger.fg,
};

const BG_MAP: Record<string, string> = {
    green: STATUS.ok.bg,
    yellow: STATUS.pending.bg,
    orange: 'var(--status-warn-bg)',
    red: STATUS.danger.bg,
};

export function SelfTestModal({ test, onClose, onScrollToSpecialists }: Props) {
    const [answers, setAnswers] = useState<(number | null)[]>(
        Array(test.questions.length).fill(null)
    );
    const [currentQ, setCurrentQ] = useState(0);
    const [showResult, setShowResult] = useState(false);

    const answered = answers.filter(a => a !== null).length;
    const progress = answered / test.questions.length;
    const allAnswered = answered === test.questions.length;

    const score = allAnswered ? calcScore(test.id, answers as number[]) : 0;
    const result = allAnswered ? test.interpret(score) : null;

    const selectAnswer = (qIdx: number, value: number) => {
        const next = [...answers];
        next[qIdx] = value;
        setAnswers(next);
        // Auto-advance to next unanswered
        if (qIdx < test.questions.length - 1) {
            const nextUnanswered = next.findIndex((a, i) => i > qIdx && a === null);
            if (nextUnanswered !== -1) setCurrentQ(nextUnanswered);
            else setCurrentQ(test.questions.length - 1);
        }
    };

    const handleFinish = () => setShowResult(true);

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            style={{ background: `${COLOR.ink}73` }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.25 }}
                className="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-3xl flex flex-col"
                style={{
                    background: COLOR.card,
                    boxShadow: SHADOW.pop,
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-ink-08 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl" aria-hidden="true">{test.emoji}</span>
                        <div>
                            <div className="font-semibold text-ink text-sm">{test.name}</div>
                            <div className="text-xs text-ink-60">{test.questionCount} вопросов · {test.duration}</div>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Закрыть" className="-m-2 w-11 h-11 flex items-center justify-center rounded-xl hover:bg-ink-05 text-ink-60 hover:text-ink transition-colors">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>

                {/* Progress bar */}
                {!showResult && (
                    <div className="h-1 shrink-0 bg-ink-05">
                        <motion.div
                            className="h-full bg-accent rounded-full"
                            animate={{ width: `${progress * 100}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>
                )}

                {/* Content */}
                <div className="overflow-y-auto flex-1">
                    <AnimatePresence mode="wait">
                        {showResult && result ? (
                            <motion.div
                                key="result"
                                initial={{ opacity: 0, y: 12 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="p-6 space-y-5"
                            >
                                {/* Score card */}
                                <div
                                    className="rounded-2xl p-5 text-center"
                                    style={{ background: BG_MAP[result.color] }}
                                >
                                    <div className="text-4xl font-semibold mb-1" style={{ color: COLOR_MAP[result.color] }}>
                                        {score}
                                    </div>
                                    <div className="font-semibold text-base" style={{ color: COLOR_MAP[result.color] }}>
                                        {result.label}
                                    </div>
                                </div>

                                <p className="text-ink-80 text-sm leading-relaxed">{result.description}</p>

                                <div className="rounded-xl p-4 text-sm bg-accent-soft">
                                    <span className="text-accent-ink font-semibold inline-flex items-start gap-2">
                                        <MessageCircle size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                                        {result.cta}
                                    </span>
                                </div>

                                <p className="text-caption text-ink-60 text-center leading-relaxed">
                                    Этот тест носит информационный характер и не является медицинским диагнозом.
                                    Для точной оценки обратитесь к специалисту.
                                </p>

                                {/* CTAs */}
                                <div className="flex flex-col gap-2 pt-1">
                                    <button
                                        onClick={() => { onScrollToSpecialists?.(); onClose(); }}
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-accent text-on-accent font-semibold text-sm hover:bg-accent-hover transition-colors"
                                    >
                                        Найти специалиста
                                        <ArrowRight size={15} />
                                    </button>
                                    <a
                                        href="https://t.me/UnboxCenter"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-medium text-ink-80 hover:text-ink transition-colors border border-ink-10"
                                    >
                                        <ExternalLink size={13} />
                                        Написать в Telegram
                                    </a>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.div
                                key="questions"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                className="p-6 space-y-6"
                            >
                                {/* Question navigator */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    {test.questions.map((_, i) => (
                                        <button
                                            key={i}
                                            onClick={() => setCurrentQ(i)}
                                            aria-label={`Вопрос ${i + 1}`}
                                            aria-current={currentQ === i ? 'step' : undefined}
                                            className="w-11 h-11 sm:w-8 sm:h-8 rounded-lg text-xs font-semibold transition-all"
                                            style={
                                                answers[i] !== null
                                                    ? { background: COLOR.accentSoft, color: COLOR.accentInk, border: `1px solid ${COLOR.accent}59` }
                                                    : currentQ === i
                                                        ? { background: COLOR.ink08, color: COLOR.ink, border: `1px solid ${COLOR.ink20}` }
                                                        : { background: COLOR.ink05, color: COLOR.ink60, border: `1px solid ${COLOR.ink08}` }
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
                                        initial={{ opacity: 0, x: 10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        exit={{ opacity: 0, x: -10 }}
                                        transition={{ duration: 0.18 }}
                                    >
                                        <div className="font-semibold text-ink text-sm leading-relaxed mb-4">
                                            <span className="text-ink-60 font-semibold mr-2">{currentQ + 1}.</span>
                                            {test.questions[currentQ].text}
                                        </div>

                                        <div className="space-y-2">
                                            {test.questions[currentQ].options.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => selectAnswer(currentQ, opt.value)}
                                                    className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all"
                                                    aria-pressed={answers[currentQ] === opt.value}
                                                    style={
                                                        answers[currentQ] === opt.value
                                                            ? { background: COLOR.accentSoft, border: `1.5px solid ${COLOR.accent}`, color: COLOR.accentInk, fontWeight: 600 }
                                                            : { background: COLOR.ink05, border: `1px solid ${COLOR.ink08}`, color: COLOR.ink80 }
                                                    }
                                                >
                                                    {opt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </motion.div>
                                </AnimatePresence>

                                {/* Navigation */}
                                <div className="flex items-center justify-between pt-2">
                                    <button
                                        onClick={() => setCurrentQ(q => Math.max(0, q - 1))}
                                        disabled={currentQ === 0}
                                        className="flex items-center gap-1 text-sm text-ink-60 hover:text-ink disabled:opacity-30 transition-colors"
                                    >
                                        <ChevronLeft size={15} /> Назад
                                    </button>

                                    {currentQ < test.questions.length - 1 ? (
                                        <button
                                            onClick={() => setCurrentQ(q => q + 1)}
                                            className="flex items-center gap-1 text-sm font-semibold text-accent-ink hover:opacity-70 transition-opacity"
                                        >
                                            Далее <ArrowRight size={15} />
                                        </button>
                                    ) : allAnswered ? (
                                        <button
                                            onClick={handleFinish}
                                            className="flex items-center gap-2 px-5 py-2 min-h-11 rounded-xl bg-accent text-on-accent text-sm font-semibold hover:bg-accent-hover transition-colors"
                                        >
                                            Получить результат <ArrowRight size={14} />
                                        </button>
                                    ) : (
                                        <span className="text-xs text-ink-60">
                                            Ответьте на все вопросы
                                        </span>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.div>
        </div>
    );
}
