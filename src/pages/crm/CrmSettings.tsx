/**
 * CRM Settings page — payment accounts, calendar sync, etc.
 */
import { useEffect, useState } from 'react';
import { Settings, Calendar, Link2 } from 'lucide-react';
import { PaymentAccountsManager } from '../../components/crm/PaymentAccountsManager';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { toast } from 'sonner';

export function CrmSettings() {
    const { fetchPaymentAccounts } = useCrmStore();
    const [calendarId, setCalendarId] = useState('');
    const [calendarSaved, setCalendarSaved] = useState(false);

    useEffect(() => {
        fetchPaymentAccounts();
        crmApi.getSettings().then((s) => {
            setCalendarId(s.calendarId || '');
        }).catch(() => {});
    }, []);

    const handleSaveCalendar = async () => {
        try {
            await crmApi.updateSettings(calendarId || null);
            setCalendarSaved(true);
            toast.success('Настройки сохранены');
            setTimeout(() => setCalendarSaved(false), 2000);
        } catch {
            toast.error('Ошибка при сохранении');
        }
    };

    return (
        <div className="space-y-8 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-unbox-dark flex items-center gap-3">
                    <Settings size={24} /> Настройки CRM
                </h1>
                <p className="text-unbox-grey mt-1">Управление счетами, интеграциями и параметрами</p>
            </div>

            {/* Payment Accounts */}
            <div className="rounded-2xl p-6"
                style={{
                    background: 'rgba(255,255,255,0.45)',
                    backdropFilter: 'blur(24px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                    border: '1px solid rgba(255,255,255,0.60)',
                    boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
                }}>
                <PaymentAccountsManager />
            </div>

            {/* Google Calendar Sync */}
            <div className="rounded-2xl p-6"
                style={{
                    background: 'rgba(255,255,255,0.45)',
                    backdropFilter: 'blur(24px) saturate(150%)',
                    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
                    border: '1px solid rgba(255,255,255,0.60)',
                    boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
                }}>
                <h3 className="font-bold text-unbox-dark flex items-center gap-2 mb-3">
                    <Calendar size={18} /> Синхронизация с Google Calendar
                </h3>
                <p className="text-xs text-unbox-grey mb-3">
                    Укажите ID календаря для автоматической синхронизации сессий.
                </p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={calendarId}
                        onChange={(e) => setCalendarId(e.target.value)}
                        placeholder="example@group.calendar.google.com"
                        className="flex-1 px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    />
                    <button
                        onClick={handleSaveCalendar}
                        className="px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors flex items-center gap-1.5"
                    >
                        <Link2 size={14} />
                        {calendarSaved ? 'Сохранено!' : 'Сохранить'}
                    </button>
                </div>
            </div>
        </div>
    );
}
