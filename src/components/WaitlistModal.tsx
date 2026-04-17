import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Bell, X, Send } from 'lucide-react';
import { toast } from 'sonner';
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
            endTime,
            createdAt: new Date().toISOString()
        });

        const hasTelegram = !!(currentUser?.telegramId && /^\d+$/.test(currentUser.telegramId));
        if (hasTelegram) {
            toast.success('Вы в листе ожидания. Пришлём уведомление в Telegram, когда слот освободится.');
        } else {
            toast.success('Вы в листе ожидания. Уведомление появится в вашем аккаунте — подключите Telegram в профиле, чтобы не пропустить.');
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95">
                <div className="flex justify-between items-start">
                    <div className="w-10 h-10 rounded-full bg-unbox-light flex items-center justify-center text-unbox-green">
                        <Bell size={20} />
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-unbox-dark">
                        <X size={20} />
                    </button>
                </div>

                <div>
                    <h3 className="font-bold text-lg text-gray-900">Слот занят</h3>
                    <p className="text-gray-500 mt-1 text-sm">
                        Хотите получить уведомление, если время
                        <span className="font-bold text-unbox-dark mx-1">{startTime}</span>
                        на <span className="font-bold text-unbox-dark">{format(date, 'd MMMM', { locale: ru })}</span> освободится?
                    </p>
                    {(() => {
                        const hasTg = !!(currentUser?.telegramId && /^\d+$/.test(currentUser.telegramId));
                        return (
                            <div className={`mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${hasTg ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                                <Send size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    {hasTg
                                        ? 'Telegram подключён — мгновенное уведомление в чат.'
                                        : 'Telegram не подключён — уведомление будет только в веб-кабинете. Подключите в профиле.'}
                                </span>
                            </div>
                        );
                    })()}
                </div>

                <div className="pt-2">
                    <button
                        onClick={handleConfirm}
                        className="w-full bg-unbox-green text-white font-bold py-3 rounded-xl hover:bg-unbox-dark transition-colors"
                    >
                        Сообщить мне
                    </button>
                    <button
                        onClick={onClose}
                        className="w-full mt-2 text-gray-500 font-medium py-2 hover:text-unbox-dark"
                    >
                        Отмена
                    </button>
                </div>
            </div>
        </div>
    );
}
