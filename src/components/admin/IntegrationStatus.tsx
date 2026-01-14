import { useState, useEffect } from 'react';
import { healthApi } from '../../api/health';
import { CheckCircle2, AlertTriangle, Loader2, Calendar } from 'lucide-react';
import clsx from 'clsx';

export function IntegrationStatus() {
    const [connected, setConnected] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        healthApi.checkIntegrations()
            .then(data => {
                setConnected(data.google_calendar.connected);
                setLoading(false);
            })
            .catch(() => {
                setConnected(false);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full text-xs text-unbox-grey border border-gray-100">
                <Loader2 size={12} className="animate-spin" />
                <span>Проверка системы...</span>
            </div>
        );
    }

    return (
        <div className={clsx(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-help",
            connected
                ? "bg-green-50 text-green-700 border-green-200"
                : "bg-amber-50 text-amber-700 border-amber-200"
        )} title={connected ? "Синхронизация активна" : "Сервисный аккаунт Google не найден"}>
            {connected ? (
                <>
                    <CheckCircle2 size={14} />
                    <span>Google Calendar: OK</span>
                </>
            ) : (
                <>
                    <AlertTriangle size={14} />
                    <span>Google Calendar: Отключен</span>
                </>
            )}
        </div>
    );
}
