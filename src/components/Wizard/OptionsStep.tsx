import { useBookingStore } from '../../store/bookingStore';
import { EXTRAS } from '../../utils/data';
import { Card } from '../ui/Card';
import { Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import clsx from 'clsx';
import { motion } from 'framer-motion';

export function OptionsStep() {
    const { extras, toggleExtra, setStep } = useBookingStore();

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-8"
        >
            <div>
                <h2 className="text-2xl font-bold mb-2">Дополнительные опции</h2>
                <p className="text-unbox-grey">Что вам понадобится для работы?</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 auto-rows-fr">
                {EXTRAS.map((extra) => {
                    const isSelected = extras.includes(extra.id);
                    return (
                        <Card
                            key={extra.id}
                            className="p-5 flex items-center justify-between gap-4 min-h-[80px]"
                            selected={isSelected}
                            onClick={() => toggleExtra(extra.id)}
                        >
                            <div>
                                <h3 className="font-bold text-base leading-snug">{extra.name}</h3>
                                <p className="text-unbox-grey text-sm mt-0.5">{extra.price} ₾</p>
                            </div>

                            <div className={clsx(
                                "w-6 h-6 shrink-0 rounded-full border flex items-center justify-center transition-colors",
                                isSelected ? "bg-unbox-green border-unbox-green text-white" : "border-gray-300"
                            )}>
                                {isSelected && <Check size={14} />}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <div className="bg-white/40 backdrop-blur-md border-t border-white/40 p-4 -mx-8 -mb-8 flex justify-between rounded-b-[28px]">
                <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft size={16} className="mr-2" /> Назад
                </Button>
                <Button onClick={() => setStep(4)}>
                    Продолжить <ArrowRight size={16} className="ml-2" />
                </Button>
            </div>
        </motion.div>
    );
}
