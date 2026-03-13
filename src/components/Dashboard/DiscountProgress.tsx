import { useEffect, useState } from 'react';
import { usersApi } from '../../api/users';
import { Zap, TrendingUp, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';

export function DiscountProgress() {
    const [data, setData] = useState<{
        accumulatedHours: number;
        totalSaved: number;
        currentDiscount: number;
        nextTierHours: number;
        nextTierDiscount: number;
        progressPercent: number;
    } | null>(null);

    useEffect(() => {
        usersApi.getDiscountProgress().then((res) => {
            console.log("DEBUG Discount Data:", res);
            setData(res as any);
        }).catch(err => {
            console.error("DEBUG Discount Error:", err);
        });
    }, []);

    if (!data) return (
        <div className="h-48 rounded-2xl animate-pulse flex items-center justify-center text-unbox-grey text-sm font-medium"
            style={{
                background: 'rgba(255,255,255,0.35)',
                backdropFilter: 'blur(20px)',
                border: '1px solid rgba(255,255,255,0.55)',
            }}>
            Загрузка прогресса...
        </div>
    );

    // Robust calculation with defaults
    const currentDiscount = data.currentDiscount || 0;
    const totalSaved = data.totalSaved || 0;
    const accumulatedHours = data.accumulatedHours || 0;
    const nextTierHours = data.nextTierHours || 0;
    const nextTierDiscount = data.nextTierDiscount || 0;
    const progressPercent = data.progressPercent || 0;

    return (
        <div className="p-6 rounded-2xl relative overflow-hidden group"
            style={{
                background: 'rgba(255,255,255,0.45)',
                backdropFilter: 'blur(24px) saturate(150%)',
                WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                border: '1px solid rgba(255,255,255,0.65)',
                boxShadow: '0 8px 32px rgba(71,109,107,0.07), inset 0 1px 0 rgba(255,255,255,0.80)',
            }}>
            {/* Background Gradient Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-unbox-light rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110 duration-700" />

            <div className="flex justify-between items-start mb-6 relative z-10">
                <div>
                    <h3 className="text-sm font-medium text-unbox-grey mb-1 flex items-center">
                        <Zap size={14} className="mr-1 text-unbox-green fill-unbox-green" />
                        Ваш прогресс скидки
                    </h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-unbox-dark">{currentDiscount}%</span>
                        <span className="text-xs font-medium text-unbox-green bg-unbox-light px-2 py-0.5 rounded-full">
                            активная скидка
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-unbox-grey mb-1 font-medium italic">Всего сэкономлено</div>
                    <div className="text-xl font-bold text-unbox-green">
                        {totalSaved.toFixed(2)} ₾
                    </div>
                </div>
            </div>

            <div className="space-y-4 relative z-10">
                <div className="flex justify-between text-xs font-medium">
                    <span className="text-unbox-grey">
                        Накоплено: <span className="text-unbox-dark font-bold">{accumulatedHours}ч</span>
                    </span>
                    <span className="text-unbox-grey">
                        Цель: {nextTierHours}ч
                    </span>
                </div>

                <div className="relative h-3 w-full rounded-full overflow-hidden" style={{ background: 'rgba(212,226,225,0.60)' }}>
                    {/* Markers */}
                    <div className="absolute left-[31%] top-0 bottom-0 w-px bg-white/50 z-20" /> {/* 5h marker */}
                    <div className="absolute left-[69%] top-0 bottom-0 w-px bg-white/50 z-20" /> {/* 11h marker */}

                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-unbox-green to-unbox-dark rounded-full shadow-sm shadow-unbox-green/20"
                    />
                </div>

                <div className="flex justify-between items-center p-3 rounded-xl mt-2"
                    style={{
                        background: 'rgba(212,226,225,0.40)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        border: '1px solid rgba(255,255,255,0.60)',
                    }}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
                            style={{ background: 'rgba(255,255,255,0.70)', border: '1px solid rgba(255,255,255,0.80)' }}>
                            <TrendingUp size={16} className="text-unbox-dark" />
                        </div>
                        <div>
                            <div className="text-[10px] text-unbox-grey font-bold uppercase tracking-wider">Следующий уровень</div>
                            <div className="text-sm font-bold text-unbox-dark">Скидка {nextTierDiscount}%</div>
                        </div>
                    </div>
                    <div className="flex items-center text-[11px] font-bold text-unbox-green">
                        Нужно еще {Math.max(0, nextTierHours - accumulatedHours).toFixed(1)}ч
                        <ChevronRight size={14} className="ml-0.5" />
                    </div>
                </div>
            </div>
        </div>
    );
}
