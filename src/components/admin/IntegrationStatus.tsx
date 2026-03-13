import { useState, useEffect } from 'react';
import { healthApi } from '../../api/health';
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface IntegrationStatusProps {
    compact?: boolean; // just icon + short label, for topbar
}

export function IntegrationStatus({ compact = false }: IntegrationStatusProps) {
    const [connected, setConnected] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        healthApi.checkIntegrations()
            .then(data => {
                // Read from camelCased payload mapped by api client interceptor
                setConnected(data.googleCalendar?.connected ?? false);
                setLoading(false);
            })
            .catch(() => {
                setConnected(false);
                setLoading(false);
            });
    }, []);

    if (loading) {
        if (compact) return <Loader2 size={14} className="animate-spin text-white/40" />;
        return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-full text-xs text-unbox-grey border border-gray-100">
                <Loader2 size={12} className="animate-spin" />
                <span>Проверка системы...</span>
            </div>
        );
    }

    // Compact mode for topbar: dot + short text
    if (compact) {
        return (
            <div
                title={connected ? 'Google Calendar: подключён' : 'Google Calendar: отключён'}
                className={clsx(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-help border',
                    connected
                        ? 'bg-green-500/15 text-green-400 border-green-500/25'
                        : 'bg-amber-500/15 text-amber-400 border-amber-500/25'
                )}
            >
                <div className={clsx('w-1.5 h-1.5 rounded-full', connected ? 'bg-green-400' : 'bg-amber-400')} />
                GCal
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
