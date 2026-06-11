import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Bell, X, MapPin, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { waitlistApi } from '../../api/waitlist';
import { Button } from './Button';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    resourceId: string;
    resourceName: string;
    locationName?: string | null;
    date: Date;
    startTime: string;     // "HH:mm"
    endTime: string;       // "HH:mm"
    /** Optional sub-line shown in italics under the body — caller can
     *  explain that we'll alert about ANY cabinet at this branch. */
    extraNote?: ReactNode;
    /** Fired after the POST resolves successfully. Useful for the parent
     *  to refresh the user's subscription list, etc. */
    onSubscribed?: () => void;
}

/** Mobile-first modal that replaces the legacy window.confirm() in the
 *  chessboards. The user taps a busy slot → this opens with the slot's
 *  metadata pre-filled, on Subscribe we POST /waitlist/. */
export function WaitlistSubscribeModal({
    isOpen, onClose,
    resourceId, resourceName, locationName,
    date, startTime, endTime,
    extraNote, onSubscribed,
}: Props) {
    const [submitting, setSubmitting] = useState(false);

    if (!isOpen) return null;

    const dayLabel = format(date, 'd MMMM, EEEE', { locale: ru });

    const submit = async () => {
        if (submitting) return;
        setSubmitting(true);
        try {
            await waitlistApi.addToWaitlist({
                resourceId,
                date: format(date, "yyyy-MM-dd'T'00:00:00"),
                startTime,
                endTime,
            });
            toast.success('Подписка оформлена. Сообщим, как только освободится.');
            onSubscribed?.();
            onClose();
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось подписаться');
        } finally {
            setSubmitting(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                onClick={submitting ? undefined : onClose}
            />
            {/* Layout: max-h:90vh + flex column. Заголовок + контент скроллятся
                внутри (overflow-y), кнопки прибиты к низу — без этого длинный
                текст на узком экране выпихивал кнопки «Нет / Да, уведомить»
                за нижний край и юзер не мог их нажать. */}
            <div
                className="
                    relative bg-white shadow-xl w-full sm:max-w-sm
                    rounded-t-3xl sm:rounded-2xl
                    flex flex-col
                    animate-in slide-in-from-bottom sm:zoom-in-95 duration-200
                "
                style={{ maxHeight: '90vh' }}
            >
                <button
                    onClick={onClose}
                    disabled={submitting}
                    className="absolute top-3 right-3 sm:top-4 sm:right-4 text-unbox-grey hover:text-unbox-dark transition-colors p-2 -m-2 z-10"
                    aria-label="Закрыть"
                >
                    <X size={22} />
                </button>

                {/* Scrollable body */}
                <div className="overflow-y-auto px-5 pt-5 sm:px-6 sm:pt-6">
                    {/* Mobile drag-handle hint */}
                    <div className="sm:hidden flex justify-center -mt-2 mb-3">
                        <div className="w-10 h-1.5 rounded-full bg-gray-200" />
                    </div>

                    <div className="flex items-start gap-3 mb-3 pr-8">
                        <div className="w-10 h-10 rounded-full bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                            <Bell size={20} />
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-base font-bold text-unbox-dark leading-snug">
                                Подписаться на уведомление?
                            </h3>
                            <p className="text-xs text-unbox-grey mt-1 leading-snug">
                                Пришлём в Telegram, как только этот или другой кабинет в этом центре освободится в это время.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2 mt-3 mb-3 px-1">
                        <div className="flex items-start gap-2 text-sm">
                            <MapPin size={16} className="text-unbox-grey shrink-0 mt-0.5" />
                            <div className="min-w-0">
                                <div className="font-semibold text-unbox-dark truncate">{resourceName}</div>
                                {locationName && <div className="text-xs text-unbox-grey">{locationName}</div>}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm">
                            <Clock size={16} className="text-unbox-grey shrink-0" />
                            <div className="text-unbox-dark">
                                <span className="font-semibold capitalize">{dayLabel}</span>
                                <span className="text-unbox-grey">, </span>
                                <span className="font-semibold tabular-nums">{startTime}–{endTime}</span>
                            </div>
                        </div>
                    </div>

                    {extraNote && (
                        <div className="text-xs text-unbox-grey bg-orange-50 border border-orange-100 rounded-lg px-3 py-2 mb-4 leading-snug">
                            {extraNote}
                        </div>
                    )}
                </div>

                {/* Sticky action bar */}
                <div
                    className="border-t border-gray-100 bg-white px-5 py-3 sm:px-6 sm:py-4 flex gap-2 shrink-0"
                    style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
                >
                    <Button variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>
                        Нет
                    </Button>
                    <Button
                        variant="primary"
                        className="flex-1"
                        onClick={submit}
                        disabled={submitting}
                    >
                        {submitting ? 'Подписываемся…' : 'Да, уведомить'}
                    </Button>
                </div>
            </div>
        </div>,
        document.body
    );
}
