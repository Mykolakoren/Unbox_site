import { useBookingStore } from '../../store/bookingStore';
import { EXTRAS } from '../../utils/data';
import { Card } from '../ui/Card';
import { Check, ArrowRight, ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import clsx from 'clsx';

export function OptionsStep() {
    const { extras, toggleExtra, setStep } = useBookingStore();

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold mb-2">Дополнительные опции</h2>
                <p className="text-gray-500">Что вам понадобится для работы?</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {EXTRAS.map((extra) => {
                    const isSelected = extras.includes(extra.id);
                    return (
                        <Card
                            key={extra.id}
                            className="p-6 flex items-center justify-between gap-4"
                            selected={isSelected}
                            onClick={() => toggleExtra(extra.id)}
                        >
                            <div>
                                <h3 className="font-bold text-lg">{extra.name}</h3>
                                <p className="text-gray-500 text-sm">{extra.price} ₾</p>
                            </div>

                            <div className={clsx(
                                "w-6 h-6 rounded-full border flex items-center justify-center transition-colors",
                                isSelected ? "bg-black border-black text-white" : "border-gray-300"
                            )}>
                                {isSelected && <Check size={14} />}
                            </div>
                        </Card>
                    );
                })}
            </div>

            <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 p-4 -mx-6 -mb-6 mt-4 flex justify-between z-20 rounded-b-2xl">
                <Button variant="outline" onClick={() => setStep(2)}>
                    <ArrowLeft size={16} className="mr-2" /> Назад
                </Button>
                <Button onClick={() => setStep(4)}>
                    Продолжить <ArrowRight size={16} className="ml-2" />
                </Button>
            </div>
        </div>
    );
}
