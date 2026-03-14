import { useState } from 'react';
import { X, ArrowRight, ChevronLeft, ExternalLink } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { type Test, calcScore } from '../data/tests';

interface Props {
    test: Test;
    onClose: () => void;
    onScrollToSpecialists?: () => void;
}

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
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(8px)' }}
            onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        >
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.25 }}
                className="w-full max-w-xl max-h-[90vh] overflow-hidden rounded-3xl flex flex-col"
                style={{
                    background: 'rgba(255,255,255,0.97)',
                    boxShadow: '0 32px 80px rgba(0,0,0,0.20)',
                }}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-black/8 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">{test.emoji}</span>
                        <div>
                            <div className="font-bold text-unbox-dark text-sm">{test.name}</div>
                            <div className="text-xs text-unbox-dark/40">{test.questionCount} вопросов · {test.duration}</div>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-black/5 text-unbox-dark/40 hover:text-unbox-dark transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Progress bar */}
                {!showResult && (
                    <div className="h-1 shrink-0 bg-black/6">
                        <motion.div
                            className="h-full bg-unbox-green rounded-full"
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
                                    style={{ background: BG_MAP[result.color], border: `1px solid ${COLOR_MAP[result.color]}30` }}
                                >
                                    <div className="text-4xl font-black mb-1" style={{ color: COLOR_MAP[result.color] }}>
                                        {score}
                                    </div>
                                    <div className="font-bold text-base" style={{ color: COLOR_MAP[result.color] }}>
                                        {result.label}
                                    </div>
                                </div>

                                <p className="text-unbox-dark/70 text-sm leading-relaxed">{result.description}</p>

                                <div className="rounded-xl p-4 text-sm" style={{ background: 'rgba(71,109,107,0.08)', border: '1px solid rgba(71,109,107,0.18)' }}>
                                    <span className="text-unbox-green font-semibold">💬 {result.cta}</span>
                                </div>

                                <p className="text-[11px] text-unbox-dark/35 text-center leading-relaxed">
                                    Этот тест носит информационный характер и не является медицинским диагнозом.
                                    Для точной оценки обратитесь к специалисту.
                                </p>

                                {/* CTAs */}
                                <div className="flex flex-col gap-2 pt-1">
                                    <button
                                        onClick={() => { onScrollToSpecialists?.(); onClose(); }}
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-unbox-green text-white font-bold text-sm hover:opacity-90 transition-opacity"
                                    >
                                        Найти специалиста
                                        <ArrowRight size={15} />
                                    </button>
                                    <a
                                        href="https://t.me/UnboxCenter"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm font-medium text-unbox-dark/70 hover:text-unbox-dark transition-colors"
                                        style={{ border: '1px solid rgba(0,0,0,0.10)' }}
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
                                            className="w-7 h-7 rounded-lg text-xs font-bold transition-all"
                                            style={
                                                answers[i] !== null
                                                    ? { background: 'rgba(71,109,107,0.20)', color: 'rgb(44,80,78)', border: '1px solid rgba(71,109,107,0.35)' }
                                                    : currentQ === i
                                                        ? { background: 'rgba(0,0,0,0.08)', color: 'rgb(44,50,64)', border: '1px solid rgba(0,0,0,0.15)' }
                                                        : { background: 'rgba(0,0,0,0.04)', color: 'rgba(44,50,64,0.40)', border: '1px solid rgba(0,0,0,0.07)' }
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
                                        <div className="font-semibold text-unbox-dark text-sm leading-relaxed mb-4">
                                            <span className="text-unbox-dark/30 font-bold mr-2">{currentQ + 1}.</span>
                                            {test.questions[currentQ].text}
                                        </div>

                                        <div className="space-y-2">
                                            {test.questions[currentQ].options.map(opt => (
                                                <button
                                                    key={opt.value}
                                                    onClick={() => selectAnswer(currentQ, opt.value)}
                                                    className="w-full text-left px-4 py-3 rounded-xl text-sm transition-all"
                                                    style={
                                                        answers[currentQ] === opt.value
                                                            ? { background: 'rgba(71,109,107,0.15)', border: '1.5px solid rgba(71,109,107,0.45)', color: 'rgb(44,80,78)', fontWeight: 600 }
                                                            : { background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.07)', color: 'rgba(44,50,64,0.75)' }
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
                                            onClick={handleFinish}
                                            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-unbox-green text-white text-sm font-bold hover:opacity-90 transition-opacity"
                                        >
                                            Получить результат <ArrowRight size={14} />
                                        </button>
                                    ) : (
                                        <span className="text-xs text-unbox-dark/35">
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
