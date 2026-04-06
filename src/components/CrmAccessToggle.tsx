import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseMedical, Loader2, Clock, AlertCircle } from 'lucide-react';
import { crmApi, type CrmAccessStatus } from '../api/crm';
import { useUserStore } from '../store/userStore';
import { useCrmModeStore } from '../store/crmModeStore';

export function CrmAccessToggle() {
    const navigate = useNavigate();
    const currentUser = useUserStore(s => s.currentUser);
    const crmEnabled = useCrmModeStore(s => s.enabled);
    const setCrmEnabled = useCrmModeStore(s => s.setEnabled);
    const [access, setAccess] = useState<CrmAccessStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        crmApi.getMyAccess()
            .then(setAccess)
            .catch(() => setAccess({ accessStatus: 'none', permanent: false, expiresAt: null, daysRemaining: null }))
            .finally(() => setLoading(false));
    }, []);

    const hasAccess = access?.accessStatus === 'active';
    const isOn = hasAccess && crmEnabled;

    const handleNavigate = () => {
        if (!isOn) return;
        navigate('/crm');
    };

    const handleToggle = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!access || applying) return;

        // Has backend access — flip local enabled flag (doesn't revoke access)
        if (access.accessStatus === 'active') {
            setCrmEnabled(!crmEnabled);
            return;
        }

        // If pending — do nothing
        if (access.accessStatus === 'pending') return;

        // Apply for access
        const isPrivileged = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
        setApplying(true);
        try {
            const result = await crmApi.applyForAccess();
            if (isPrivileged || result.status === 'active') {
                setAccess(prev => prev ? { ...prev, accessStatus: 'active', permanent: true } : prev);
                setCrmEnabled(true);
            } else {
                setAccess(prev => prev ? { ...prev, accessStatus: 'pending' } : prev);
            }
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

    const isPending = access.accessStatus === 'pending';
    const isExpired = access.accessStatus === 'expired';
    const isRejected = access.accessStatus === 'rejected';

    return (
        <div className="flex items-center gap-2">
            {/* CRM button */}
            <button
                onClick={isOn ? handleNavigate : undefined}
                className={`
                    flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                    ${isOn
                        ? 'bg-unbox-green/10 text-unbox-green hover:bg-unbox-green/20 cursor-pointer'
                        : isPending
                            ? 'bg-amber-50 text-amber-600 cursor-default'
                            : 'bg-gray-50 text-unbox-grey cursor-default'
                    }
                `}
            >
                <BriefcaseMedical size={18} className="flex-shrink-0" />
                <div className="text-left min-w-0">
                    <div className="truncate leading-tight">
                        {hasAccess ? 'Мой CRM' : 'Режим CRM'}
                    </div>
                    {isOn && !access.permanent && access.daysRemaining !== null && (
                        <div className="text-[10px] opacity-70 flex items-center gap-1">
                            <Clock size={10} />
                            {access.daysRemaining} {getDaysLabel(access.daysRemaining)}
                        </div>
                    )}
                    {hasAccess && !crmEnabled && (
                        <div className="text-[10px] opacity-70">Отключён</div>
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
                            Истёк
                        </div>
                    )}
                    {isRejected && (
                        <div className="text-[10px] text-red-400 flex items-center gap-1">
                            <AlertCircle size={10} />
                            Отклонено
                        </div>
                    )}
                </div>
            </button>

            {/* Toggle switch — separate element */}
            <button
                onClick={handleToggle}
                disabled={isPending || applying}
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                    hasAccess
                        ? (crmEnabled ? 'Выключить CRM режим' : 'Включить CRM режим')
                        : isPending
                            ? 'Ожидает одобрения'
                            : 'Запросить доступ'
                }
            >
                <div className={`
                    w-10 h-[22px] rounded-full flex items-center transition-all px-0.5
                    ${isOn ? 'bg-unbox-green justify-end' : isPending ? 'bg-amber-300 justify-center' : 'bg-gray-300 justify-start'}
                `}>
                    {applying ? (
                        <Loader2 size={12} className="text-white animate-spin mx-auto" />
                    ) : isPending ? (
                        <Clock size={12} className="text-white mx-auto" />
                    ) : (
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-all
                            ${isOn ? 'scale-100' : 'scale-90'}
                        `} />
                    )}
                </div>
            </button>
        </div>
    );
}

function getDaysLabel(days: number): string {
    if (days === 1) return 'день';
    if (days >= 2 && days <= 4) return 'дня';
    return 'дней';
}
