import { useBookingStore } from '../../store/bookingStore';
import { EXTRAS } from '../../utils/data';
import { Card } from '../ui/Card';
import { Check, ArrowRight, ArrowLeft, User as UserIcon, Users as UsersIcon, MessageSquare } from 'lucide-react';
import { Button } from '../ui/Button';
import clsx from 'clsx';
import { motion } from 'framer-motion';

// Format options shown to the user. Сервер пересчитывает цену по формату
// (PricingService → BASE_RATES per (space_type × format)). Кабинеты 7/8
// имеют отдельный «групповой» рейт; для остальных все три формата
// технически работают и обычно идут по индивидуальному тарифу.
const FORMAT_CARDS: Array<{ id: 'individual' | 'group' | 'intervision'; label: string; sub: string; Icon: any }> = [
    { id: 'individual', label: 'Индивидуальный', sub: '1 на 1 · сессия / семья', Icon: UserIcon },
    { id: 'group',      label: 'Групповой',      sub: 'от 5 человек (с терапевтом) · группа / семинар', Icon: UsersIcon },
    { id: 'intervision', label: 'Интервизия',     sub: 'Профессиональная встреча коллег', Icon: MessageSquare },
];

export function OptionsStep() {
    const { extras, toggleExtra, setStep, format, setFormat } = useBookingStore();

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col gap-8"
        >
            <div>
                <h2 className="text-2xl font-bold mb-2">Параметры брони</h2>
                <p className="text-unbox-grey">Уточните формат и при необходимости выберите допуслуги.</p>
            </div>

            {/* Формат сессии — раньше зашит в 'individual' по умолчанию, юзер
                не имел способа поменять. Для Кабинетов 7/8 цена групп vs.
                индивид отличается, поэтому это важно показать здесь. */}
            <div>
                <h3 className="text-base font-bold mb-3">Формат</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {FORMAT_CARDS.map(opt => {
                        const isSelected = format === opt.id;
                        const Icon = opt.Icon;
                        return (
                            <Card
                                key={opt.id}
                                className="p-4 flex items-start gap-3 cursor-pointer"
                                selected={isSelected}
                                onClick={() => setFormat(opt.id)}
                            >
                                <div className={clsx(
                                    "w-9 h-9 shrink-0 rounded-full flex items-center justify-center transition-colors",
                                    isSelected ? "bg-unbox-green text-white" : "bg-unbox-light text-unbox-grey"
                                )}>
                                    <Icon size={16} />
                                </div>
                                <div className="min-w-0">
                                    <div className="font-bold text-sm leading-tight">{opt.label}</div>
                                    <div className="text-unbox-grey text-xs mt-0.5 leading-snug">{opt.sub}</div>
                                </div>
                                <div className={clsx(
                                    "w-5 h-5 shrink-0 ml-auto rounded-full border flex items-center justify-center transition-colors",
                                    isSelected ? "bg-unbox-green border-unbox-green text-white" : "border-gray-300"
                                )}>
                                    {isSelected && <Check size={12} />}
                                </div>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Допуслуги */}
            <div>
                <h3 className="text-base font-bold mb-3">Дополнительные услуги</h3>
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
