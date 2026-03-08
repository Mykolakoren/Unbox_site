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
        <div className="h-48 bg-gray-50 rounded-2xl animate-pulse flex items-center justify-center text-gray-400 text-sm font-medium">
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
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden group">
            {/* Background Gradient Accent */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-teal-50 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110 duration-700" />

            <div className="flex justify-between items-start mb-6 relative z-10">
                <div>
                    <h3 className="text-sm font-medium text-gray-500 mb-1 flex items-center">
                        <Zap size={14} className="mr-1 text-teal-500 fill-teal-500" />
                        Ваш прогресс скидки
                    </h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-gray-900">{currentDiscount}%</span>
                        <span className="text-xs font-medium text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full">
                            активная скидка
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-gray-400 mb-1 font-medium italic">Всего сэкономлено</div>
                    <div className="text-xl font-bold text-teal-600">
                        {totalSaved.toFixed(2)} ₾
                    </div>
                </div>
            </div>

            <div className="space-y-4 relative z-10">
                <div className="flex justify-between text-xs font-medium">
                    <span className="text-gray-500">
                        Накоплено: <span className="text-gray-900 font-bold">{accumulatedHours}ч</span>
                    </span>
                    <span className="text-gray-400">
                        Цель: {nextTierHours}ч
                    </span>
                </div>

                <div className="relative h-3 w-full bg-gray-100 rounded-full overflow-hidden">
                    {/* Markers */}
                    <div className="absolute left-[31%] top-0 bottom-0 w-px bg-white/50 z-20" /> {/* 5h marker */}
                    <div className="absolute left-[69%] top-0 bottom-0 w-px bg-white/50 z-20" /> {/* 11h marker */}

                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-teal-400 to-indigo-500 rounded-full shadow-sm shadow-teal-500/20"
                    />
                </div>

                <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-100 mt-2">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shadow-sm">
                            <TrendingUp size={16} className="text-indigo-500" />
                        </div>
                        <div>
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Следующий уровень</div>
                            <div className="text-sm font-bold text-gray-900">Скидка {nextTierDiscount}%</div>
                        </div>
                    </div>
                    <div className="flex items-center text-[11px] font-bold text-indigo-600">
                        Нужно еще {Math.max(0, nextTierHours - accumulatedHours).toFixed(1)}ч
                        <ChevronRight size={14} className="ml-0.5" />
                    </div>
                </div>
            </div>
        </div>
    );
}
