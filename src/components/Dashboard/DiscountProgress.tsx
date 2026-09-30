import { useEffect, useState } from 'react';
import { useUserStore } from '../../store/userStore';
import { usersApi } from '../../api/users';
import { Zap, TrendingUp, ChevronRight, UserCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { COLOR } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { Skeleton } from '../ui/Skeleton';
import { ErrorBar } from '../ui/ErrorBar';

export function DiscountProgress() {
    const { currentUser } = useUserStore();
    const [data, setData] = useState<{
        accumulatedHours: number;
        totalSaved: number;
        currentDiscount: number;
        nextTierHours: number;
        nextTierDiscount: number;
        progressPercent: number;
    } | null>(null);
    // Wave 1: ошибка загрузки ≠ вечная «Загрузка…». Раньше при сбое карточка
    // навсегда оставалась в состоянии загрузки.
    const [failed, setFailed] = useState(false);
    const [retrying, setRetrying] = useState(false);

    const load = () => {
        setRetrying(true);
        usersApi.getDiscountProgress().then((res) => {
            setData(res as any);
            setFailed(false);
        }).catch(() => setFailed(true))
            .finally(() => setRetrying(false));
    };

    useEffect(() => {
        load();
    }, []);

    if (!data && failed) return (
        <ErrorBar message="Не удалось загрузить скидку" onRetry={load} retrying={retrying} />
    );

    if (!data) return (
        <div role="status" aria-busy="true">
            <span className="sr-only">Загружаем скидку…</span>
            <Skeleton height={192} radius={16} />
        </div>
    );

    const progressiveDiscount = data.currentDiscount || 0;
    const totalSaved = data.totalSaved || 0;
    const accumulatedHours = data.accumulatedHours || 0;
    const nextTierHours = data.nextTierHours || 0;
    const nextTierDiscount = data.nextTierDiscount || 0;
    const progressPercent = data.progressPercent || 0;

    const personalDiscount = (currentUser?.pricingSystem === 'personal' && currentUser?.personalDiscountPercent)
        ? currentUser.personalDiscountPercent : 0;

    // Which discount is active (the bigger one wins)
    const activeDiscount = Math.max(progressiveDiscount, personalDiscount);
    const isPersonalWinning = personalDiscount > 0 && personalDiscount >= progressiveDiscount;

    return (
        <div className="p-6 rounded-2xl relative overflow-hidden"
            style={{ background: COLOR.card, border: `1px solid ${COLOR.ink10}` }}>

            <div className="flex justify-between items-start mb-4 relative z-10">
                <div>
                    <h3 className="text-sm font-medium text-ink-60 mb-1 flex items-center">
                        <Zap size={14} className="mr-1 text-ink-60" aria-hidden="true" />
                        Ваша скидка
                    </h3>
                    <div className="flex items-baseline gap-2">
                        <span className="text-3xl font-semibold text-ink">{activeDiscount}%</span>
                        <span className="text-xs font-medium text-ink-80 bg-sunken px-2 py-0.5 rounded-full">
                            {isPersonalWinning ? 'персональная' : 'за объём'}
                        </span>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-xs text-ink-60 mb-1 font-medium">Всего сэкономлено</div>
                    <div className="num text-xl font-semibold text-[var(--status-ok-fg)]">
                        {formatGel(totalSaved)}
                    </div>
                </div>
            </div>

            {/* Personal discount info */}
            {personalDiscount > 0 && (
                <div className={`flex items-center gap-2 mb-4 p-2.5 rounded-xl relative z-10 ${
                    isPersonalWinning
                        ? 'bg-accent-soft border border-accent/30'
                        : 'bg-sunken border border-ink-10'
                }`}>
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isPersonalWinning ? 'bg-card' : 'bg-sunken'
                    }`}>
                        <UserCheck size={14} className={isPersonalWinning ? 'text-accent-ink' : 'text-ink-60'} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className={`font-semibold ${
                            isPersonalWinning ? 'text-sm text-accent-ink' : 'text-xs text-ink-60'
                        }`}>
                            Персональная скидка: {personalDiscount}%
                        </div>
                        {!isPersonalWinning && (
                            <div className="text-caption text-ink-60">
                                Прогрессивная скидка выгоднее
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Progressive discount section */}
            <div className="space-y-3 relative z-10">
                {personalDiscount > 0 && (
                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink-60">
                        <TrendingUp size={12} aria-hidden="true" />
                        Прогрессивная скидка: {progressiveDiscount}%
                        {isPersonalWinning && <span className="text-ink-60 ml-1">(не активна)</span>}
                    </div>
                )}

                <div className="flex justify-between text-xs font-medium">
                    <span className="text-ink-60">
                        Накоплено: <span className="num text-ink font-semibold">{accumulatedHours} ч</span>
                    </span>
                    <span className="text-ink-60">
                        Цель: <span className="num">{nextTierHours} ч</span>
                    </span>
                </div>

                <div className="relative h-3 w-full rounded-full overflow-hidden bg-ink-10">
                    <div className="absolute left-[31%] top-0 bottom-0 w-px bg-card z-20" />
                    <div className="absolute left-[69%] top-0 bottom-0 w-px bg-card z-20" />

                    <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${progressPercent}%` }}
                        transition={{ duration: 1, ease: "easeOut" }}
                        className="h-full bg-accent rounded-full"
                    />
                </div>

                {(!personalDiscount || !isPersonalWinning) && (
                    <div className="flex justify-between items-center p-3 rounded-xl mt-1 bg-sunken">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-card border border-ink-10">
                                <TrendingUp size={16} className="text-ink" aria-hidden="true" />
                            </div>
                            <div>
                                <div className="text-caption text-ink-60 font-semibold uppercase tracking-[0.06em]">Следующий уровень</div>
                                <div className="text-sm font-semibold text-ink">Скидка {nextTierDiscount}%</div>
                            </div>
                        </div>
                        <div className="flex items-center text-caption font-semibold text-ink">
                            Нужно ещё {Math.max(0, nextTierHours - accumulatedHours).toFixed(1)} ч
                            <ChevronRight size={14} className="ml-0.5" aria-hidden="true" />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
