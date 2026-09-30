import { format } from 'date-fns';
import { formatDayMonth } from '../utils/format';
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
            toast.success('Готово — напишем в Telegram, когда время освободится.');
        } else {
            toast.success('Вы в листе ожидания. Уведомление появится в вашем аккаунте — подключите Telegram в профиле, чтобы не пропустить.');
        }
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-ink/45 z-50 flex items-center justify-center p-4">
            <div className="bg-card rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95">
                <div className="flex justify-between items-start">
                    <div className="w-10 h-10 rounded-full bg-accent-soft flex items-center justify-center text-accent-ink">
                        <Bell size={20} aria-hidden="true" />
                    </div>
                    <button onClick={onClose} aria-label="Закрыть" className="-m-3 w-11 h-11 flex items-center justify-center text-ink-60 hover:text-ink">
                        <X size={20} aria-hidden="true" />
                    </button>
                </div>

                <div>
                    <h3 className="font-semibold text-lg text-ink">Время занято</h3>
                    <p className="text-ink-60 mt-1 text-sm">
                        Хотите получить уведомление, если время
                        <span className="font-semibold text-ink mx-1">{startTime}</span>
                        на <span className="font-semibold text-ink">{formatDayMonth(date)}</span> освободится?
                    </p>
                    {(() => {
                        const hasTg = !!(currentUser?.telegramId && /^\d+$/.test(currentUser.telegramId));
                        return (
                            <div className={`mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${hasTg ? 'bg-[var(--status-ok-bg)] text-[var(--status-ok-fg)]' : 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)]'}`}>
                                <Send size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
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
                        className="w-full bg-accent text-on-accent font-semibold py-3 rounded-xl hover:bg-accent-hover transition-colors"
                    >
                        Сообщить мне
                    </button>
                    <button
                        onClick={onClose}
                        className="w-full mt-2 min-h-11 text-ink-60 font-medium py-2 hover:text-ink"
                    >
                        Не нужно
                    </button>
                </div>
            </div>
        </div>
    );
}
