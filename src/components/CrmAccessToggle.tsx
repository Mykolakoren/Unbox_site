import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseMedical, Loader2, Clock, AlertCircle } from 'lucide-react';
import { crmApi, type CrmAccessStatus } from '../api/crm';

export function CrmAccessToggle() {
    const navigate = useNavigate();
    const [access, setAccess] = useState<CrmAccessStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        crmApi.getMyAccess()
            .then(setAccess)
            .catch(() => setAccess({ access_status: 'none', permanent: false, expires_at: null, days_remaining: null }))
            .finally(() => setLoading(false));
    }, []);

    const handleToggle = async () => {
        if (!access) return;

        // If active — navigate to CRM
        if (access.access_status === 'active') {
            navigate('/crm');
            return;
        }

        // If pending — do nothing
        if (access.access_status === 'pending') return;

        // If none/expired/rejected — apply
        setApplying(true);
        try {
            await crmApi.applyForAccess();
            setAccess(prev => prev ? { ...prev, access_status: 'pending' } : prev);
        } catch {
            // Error handled silently
        } finally {
            setApplying(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-unbox-grey">
                <Loader2 size={18} className="animate-spin" />
                <span>CRM...</span>
            </div>
        );
    }

    if (!access) return null;

    const isActive = access.access_status === 'active';
    const isPending = access.access_status === 'pending';
    const isExpired = access.access_status === 'expired';
    const isRejected = access.access_status === 'rejected';

    return (
        <button
            onClick={handleToggle}
            disabled={isPending || applying}
            className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                ${isActive
                    ? 'bg-unbox-green/10 text-unbox-green hover:bg-unbox-green/20'
                    : isPending
                        ? 'bg-amber-50 text-amber-600 cursor-not-allowed'
                        : 'bg-gray-50 text-unbox-grey hover:bg-gray-100 hover:text-unbox-dark'
                }
            `}
        >
            <BriefcaseMedical size={18} className="flex-shrink-0" />

            <div className="flex-1 text-left min-w-0">
                <div className="truncate">
                    {isActive ? 'Мой CRM' : 'Режим CRM'}
                </div>
                {isActive && !access.permanent && access.days_remaining !== null && (
                    <div className="text-[10px] opacity-70 flex items-center gap-1">
                        <Clock size={10} />
                        {access.days_remaining} {getDaysLabel(access.days_remaining)}
                    </div>
                )}
                {isPending && (
                    <div className="text-[10px] opacity-70 flex items-center gap-1">
                        <AlertCircle size={10} />
                        На рассмотрении
                    </div>
                )}
                {isExpired && (
                    <div className="text-[10px] text-red-400 flex items-center gap-1">
                        <AlertCircle size={10} />
                        Доступ истёк
                    </div>
                )}
                {isRejected && (
                    <div className="text-[10px] text-red-400 flex items-center gap-1">
                        <AlertCircle size={10} />
                        Отклонено
                    </div>
                )}
            </div>

            {/* Toggle switch visual */}
            <div className={`
                w-9 h-5 rounded-full flex items-center transition-all flex-shrink-0
                ${isActive ? 'bg-unbox-green justify-end' : isPending ? 'bg-amber-300 justify-center' : 'bg-gray-300 justify-start'}
            `}>
                {applying ? (
                    <Loader2 size={12} className="text-white animate-spin mx-auto" />
                ) : isPending ? (
                    <Clock size={12} className="text-white mx-auto" />
                ) : (
                    <div className={`w-3.5 h-3.5 rounded-full bg-white shadow-sm mx-0.5 transition-all
                        ${isActive ? 'scale-100' : 'scale-90'}
                    `} />
                )}
            </div>
        </button>
    );
}

function getDaysLabel(days: number): string {
    if (days === 1) return 'день';
    if (days >= 2 && days <= 4) return 'дня';
    return 'дней';
}
