import { useState, type ReactNode } from 'react';
import { MapPin, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { waitlistApi } from '../../api/waitlist';
import { formatDateLabel, formatTimeRange } from '../../utils/format';
import { Sheet } from './Sheet';
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

/** Окно «Время занято — сообщить, когда освободится?» (шахматки мастера
 *  брони, /dashboard/bookings, CRM, админки). Тап по занятому слоту →
 *  окно с данными слота, «Уведомить меня» → POST /waitlist/.
 *
 *  Wave 1: на общей шторке Sheet (снизу на телефоне, по центру на
 *  компьютере, Esc, фокус внутри, кнопки всегда видны), токены вместо
 *  оранжевого/серого, обращение на «вы». Пока идёт запрос — окно не
 *  закрывается и кнопки заблокированы. */
export function WaitlistSubscribeModal({
    isOpen, onClose,
    resourceId, resourceName, locationName,
    date, startTime, endTime,
    extraNote, onSubscribed,
}: Props) {
    const [submitting, setSubmitting] = useState(false);

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
            toast.error(err?.response?.data?.detail || 'Не удалось подписаться. Попробуйте ещё раз.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Sheet
            open={isOpen}
            onClose={onClose}
            dismissible={!submitting}
            width={400}
            title="Сообщить, когда освободится?"
            description="Пришлём вам сообщение в Telegram, как только этот или другой кабинет в этом центре освободится в это время."
            footer={
                <>
                    <Button block loading={submitting} onClick={() => { void submit(); }}>
                        {submitting ? 'Подписываем…' : 'Уведомить меня'}
                    </Button>
                    <Button variant="secondary" block onClick={onClose} disabled={submitting}>
                        Не нужно
                    </Button>
                </>
            }
        >
            <div className="space-y-2 text-small">
                <div className="flex items-start gap-2">
                    <MapPin size={16} className="text-ink-60 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0">
                        <div className="font-semibold text-ink truncate">{resourceName}</div>
                        {locationName && <div className="text-caption text-ink-60">{locationName}</div>}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Clock size={16} className="text-ink-60 shrink-0" aria-hidden="true" />
                    <div className="text-ink">
                        <span className="font-semibold">{formatDateLabel(date, { capitalize: true })}</span>
                        <span className="text-ink-60">, </span>
                        <span className="num font-semibold">{formatTimeRange(startTime, endTime)}</span>
                    </div>
                </div>
            </div>

            {extraNote && (
                <div className="mt-3 text-caption text-ink-80 bg-sunken rounded-lg px-3 py-2 leading-snug">
                    {extraNote}
                </div>
            )}
        </Sheet>
    );
}
