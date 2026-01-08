import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Bell, X } from 'lucide-react';
import { useUserStore } from '../store/userStore';

interface WaitlistModalProps {
    isOpen: boolean;
    onClose: () => void;
    resourceId: string;
    startTime: string; // HH:mm
    date: Date;
}

export function WaitlistModal({ isOpen, onClose, resourceId, startTime, date }: WaitlistModalProps) {
    const { addToWaitlist, currentUser } = useUserStore();

    if (!isOpen) return null;

    const handleConfirm = () => {
        if (!currentUser) return; // Should be handled by logic to require login

        // Calculate endTime (assuming 1 hour slot for waitlist simplicity for now)
        // In reality we might want to capture the specific slot duration
        const [h, m] = startTime.split(':').map(Number);
        const endH = h + 1;
        const endTime = `${endH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

        addToWaitlist({
            userId: currentUser.email,
            resourceId,
            date: format(date, 'yyyy-MM-dd'),
            startTime,
            endTime
        });

        alert('Вы добавлены в лист ожидания! Мы сообщим, если слот освободится.');
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95">
                <div className="flex justify-between items-start">
                    <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-600">
                        <Bell size={20} />
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-black">
                        <X size={20} />
                    </button>
                </div>

                <div>
                    <h3 className="font-bold text-lg text-gray-900">Слот занят</h3>
                    <p className="text-gray-500 mt-1 text-sm">
                        Хотите получить уведомление, если время
                        <span className="font-bold text-black mx-1">{startTime}</span>
                        на <span className="font-bold text-black">{format(date, 'd MMMM', { locale: ru })}</span> освободится?
                    </p>
                </div>

                <div className="pt-2">
                    <button
                        onClick={handleConfirm}
                        className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors"
                    >
                        Сообщить мне
                    </button>
                    <button
                        onClick={onClose}
                        className="w-full mt-2 text-gray-500 font-medium py-2 hover:text-black"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}
