import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { TESTS, type Test } from '../../data/tests';
import { SelfTestModal } from '../SelfTestModal';

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.55)',
    backdropFilter: 'blur(20px) saturate(150%)',
    WebkitBackdropFilter: 'blur(20px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.65)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
};

interface Props {
    onScrollToSpecialists?: () => void;
}

export function SelfTestsSection({ onScrollToSpecialists }: Props) {
    const [activeTest, setActiveTest] = useState<Test | null>(null);
    const navigate = useNavigate();

    return (
        <>
            <section className="max-w-6xl mx-auto px-6 py-14">
                <div className="border-t border-black/10 pt-14">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        className="text-center mb-10"
                    >
                        <p className="text-unbox-green text-xs font-bold uppercase tracking-widest mb-2">Самопознание</p>
                        <h2 className="text-2xl sm:text-3xl font-bold text-unbox-dark">Психологические тесты</h2>
                        <p className="mt-2 text-unbox-dark/50 text-sm max-w-md mx-auto">
                            Пройдите проверенные тесты и получите расшифровку за несколько минут
                        </p>
                    </motion.div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {TESTS.map((test, i) => (
                            <motion.div
                                key={test.id}
                                initial={{ opacity: 0, y: 24 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.1 }}
                                className="flex flex-col gap-4 p-5 rounded-2xl"
                                style={glassCard}
                            >
                                {/* Emoji + name */}
                                <div>
                                    <div className="text-3xl mb-2">{test.emoji}</div>
                                    <div className="font-bold text-unbox-dark text-sm leading-snug">{test.name}</div>
                                    <div className="text-xs text-unbox-dark/45 mt-1">
                                        {test.questionCount} вопросов · {test.duration}
                                    </div>
                                </div>

                                <p className="text-xs text-unbox-dark/55 leading-relaxed flex-1">{test.description}</p>

                                {/* Actions */}
                                <div className="flex flex-col gap-2">
                                    <button
                                        onClick={() => setActiveTest(test)}
                                        className="flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl bg-unbox-green text-white text-xs font-bold hover:opacity-90 transition-opacity"
                                    >
                                        Пройти тест
                                        <ArrowRight size={12} />
                                    </button>
                                    <button
                                        onClick={() => navigate(`/tests/${test.id}`)}
                                        className="text-xs text-unbox-dark/40 hover:text-unbox-green transition-colors py-1"
                                    >
                                        Открыть полный тест →
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        className="text-center text-xs text-unbox-dark/30 mt-8"
                    >
                        Тесты носят информационный характер и не заменяют консультацию специалиста
                    </motion.p>
                </div>
            </section>

            <AnimatePresence>
                {activeTest && (
                    <SelfTestModal
                        test={activeTest}
                        onClose={() => setActiveTest(null)}
                        onScrollToSpecialists={onScrollToSpecialists}
                    />
                )}
            </AnimatePresence>
        </>
    );
}
