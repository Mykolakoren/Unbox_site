import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseMedical, Loader2, Clock, AlertCircle } from 'lucide-react';
import { crmApi, type CrmAccessStatus } from '../api/crm';
import { useUserStore } from '../store/userStore';
import { useCrmModeStore } from '../store/crmModeStore';
import { toast } from 'sonner';
import { ruPlural } from '../utils/plural';

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
            // Раньше ошибка глоталась молча (G3-21) — клиент не знал, ушла ли заявка.
            toast.error('Не удалось отправить заявку на CRM. Попробуйте ещё раз.');
        } finally {
            setApplying(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center gap-3 px-3 py-2.5 text-sm text-ink-60">
                <Loader2 size={18} className="animate-spin" aria-hidden="true" />
                <span>CRM…</span>
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
                        ? 'bg-accent/10 text-accent-ink hover:bg-accent/20 cursor-pointer'
                        : isPending
                            ? 'bg-[var(--status-pending-bg)] text-[var(--status-pending-fg)] cursor-default'
                            : 'bg-sunken text-ink-60 cursor-default'
                    }
                `}
            >
                <BriefcaseMedical size={18} className="flex-shrink-0" />
                <div className="text-left min-w-0">
                    <div className="truncate leading-tight">
                        {hasAccess ? 'Мой CRM' : 'Режим CRM'}
                    </div>
                    {isOn && !access.permanent && access.daysRemaining !== null && (
                        <div className="text-caption flex items-center gap-1">
                            <Clock size={12} aria-hidden="true" />
                            {access.daysRemaining} {getDaysLabel(access.daysRemaining)}
                        </div>
                    )}
                    {hasAccess && !crmEnabled && (
                        <div className="text-caption">Отключён</div>
                    )}
                    {isPending && (
                        <div className="text-caption flex items-center gap-1">
                            <AlertCircle size={12} aria-hidden="true" />
                            На рассмотрении
                        </div>
                    )}
                    {isExpired && (
                        <div className="text-caption text-[var(--status-danger-fg)] flex items-center gap-1">
                            <AlertCircle size={12} aria-hidden="true" />
                            Истёк
                        </div>
                    )}
                    {isRejected && (
                        <div className="text-caption text-[var(--status-danger-fg)] flex items-center gap-1">
                            <AlertCircle size={12} aria-hidden="true" />
                            Отклонено
                        </div>
                    )}
                </div>
            </button>

            {/* Toggle switch — separate element */}
            <button
                onClick={handleToggle}
                disabled={isPending || applying}
                role="switch"
                aria-checked={isOn}
                aria-label={
                    hasAccess
                        ? 'Режим CRM'
                        : isPending
                            ? 'Заявка на CRM ждёт одобрения'
                            : 'Запросить доступ к CRM'
                }
                className="flex-shrink-0 p-1.5 rounded-lg hover:bg-ink-05 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={
                    hasAccess
                        ? (crmEnabled ? 'Выключить CRM режим' : 'Включить CRM режим')
                        : isPending
                            ? 'Ждёт одобрения'
                            : 'Запросить доступ'
                }
            >
                <div className={`
                    w-10 h-[22px] rounded-full flex items-center transition-all px-0.5
                    ${isOn ? 'bg-accent justify-end' : isPending ? 'bg-[var(--status-pending-fg)] justify-center' : 'bg-ink-60 justify-start'}
                `}>
                    {applying ? (
                        <Loader2 size={12} className="text-card animate-spin mx-auto" aria-hidden="true" />
                    ) : isPending ? (
                        <Clock size={12} className="text-card mx-auto" aria-hidden="true" />
                    ) : (
                        <div className={`w-4 h-4 rounded-full bg-card shadow-sm transition-all
                            ${isOn ? 'scale-100' : 'scale-90'}
                        `} />
                    )}
                </div>
            </button>
        </div>
    );
}

function getDaysLabel(days: number): string {
    // ruPlural: 21 день, 22 дня, 25 дней (раньше «21 дней»).
    return ruPlural(days, ['день', 'дня', 'дней']);
}
