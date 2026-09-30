import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BriefcaseMedical, Clock, AlertCircle } from 'lucide-react';
import { crmApi, type CrmAccessStatus } from '../api/crm';
import { useUserStore } from '../store/userStore';
import { useCrmModeStore } from '../store/crmModeStore';
import { toast } from 'sonner';
import { ruPlural } from '../utils/plural';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import { useConfirmDialog } from './ui/ConfirmDialogProvider';

/**
 * Доступ к Psy-CRM из кабинета клиента.
 *
 * Волна 2, пакет D (G3-21): раньше это был безобидный на вид переключатель
 * «Режим CRM», который по клику молча отправлял заявку администраторам.
 * Теперь — карточка «Вести своих клиентов в Unbox» с объяснением одной
 * строкой и кнопкой «Запросить доступ» через подтверждение. Состояния:
 * заявка отправлена — ждём администратора / доступ есть — «Открыть CRM».
 */
export function CrmAccessToggle() {
    const navigate = useNavigate();
    const currentUser = useUserStore(s => s.currentUser);
    const crmEnabled = useCrmModeStore(s => s.enabled);
    const setCrmEnabled = useCrmModeStore(s => s.setEnabled);
    const { confirm } = useConfirmDialog();
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

    const handleToggle = async () => {
        if (!access || applying) return;

        // Has backend access — flip local enabled flag (doesn't revoke access)
        if (access.accessStatus === 'active') {
            setCrmEnabled(!crmEnabled);
            return;
        }

        // If pending — do nothing
        if (access.accessStatus === 'pending') return;

        // Заявка уходит администраторам — сначала спрашиваем (раньше — молча по клику).
        const ok = await confirm({
            title: 'Запросить доступ к CRM?',
            body: 'CRM — ваш рабочий кабинет специалиста: клиенты, сессии и оплаты в одном месте. Заявку рассмотрит администратор и ответит вам.',
            confirmLabel: 'Отправить заявку',
            cancelLabel: 'Не сейчас',
        });
        if (!ok) return;

        // Apply for access
        const isPrivileged = currentUser?.role === 'owner' || currentUser?.role === 'senior_admin';
        setApplying(true);
        try {
            const result = await crmApi.applyForAccess();
            if (isPrivileged || result.status === 'active') {
                setAccess(prev => prev ? { ...prev, accessStatus: 'active', permanent: true } : prev);
                setCrmEnabled(true);
                toast.success('Доступ к CRM открыт');
            } else {
                setAccess(prev => prev ? { ...prev, accessStatus: 'pending' } : prev);
                toast.success('Заявка отправлена — ждём администратора');
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
            <div role="status" aria-busy="true">
                <span className="sr-only">Проверяем доступ к CRM…</span>
                <Skeleton height={64} radius={0} />
            </div>
        );
    }

    if (!access) return null;

    const isPending = access.accessStatus === 'pending';
    const isExpired = access.accessStatus === 'expired';
    const isRejected = access.accessStatus === 'rejected';

    return (
        <div className="text-small text-ink">
            <div className="flex items-center gap-2 font-semibold">
                <BriefcaseMedical size={16} className="shrink-0 text-ink-60" aria-hidden="true" />
                {hasAccess ? 'Мой CRM' : 'Вести своих клиентов в Unbox'}
            </div>

            {hasAccess ? (
                <>
                    {!access.permanent && access.daysRemaining !== null && (
                        <div className="mt-1 flex items-center gap-1 text-ink-60">
                            <Clock size={14} aria-hidden="true" />
                            Доступ ещё {access.daysRemaining} {getDaysLabel(access.daysRemaining)}
                        </div>
                    )}
                    <div className="mt-2 flex flex-col gap-1">
                        {isOn && (
                            <Button size="touch" variant="secondary" block onClick={() => navigate('/crm')}>
                                Открыть CRM
                            </Button>
                        )}
                        <Button size="touch" variant="quiet" block onClick={handleToggle} aria-pressed={isOn}>
                            {isOn ? 'Скрыть CRM из кабинета' : 'Показать CRM в кабинете'}
                        </Button>
                    </div>
                </>
            ) : isPending ? (
                <div className="mt-1 flex items-start gap-1.5 text-[var(--status-pending-fg)]">
                    <Clock size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Заявка отправлена — ждём администратора
                </div>
            ) : (
                <>
                    <p className="mt-1 text-ink-60">
                        Клиенты, сессии и оплаты — в одном месте.
                    </p>
                    {(isExpired || isRejected) && (
                        <div className="mt-1 flex items-center gap-1 text-[var(--status-danger-fg)]">
                            <AlertCircle size={14} aria-hidden="true" />
                            {isExpired ? 'Доступ закончился' : 'Прошлую заявку отклонили'}
                        </div>
                    )}
                    <div className="mt-2">
                        <Button size="touch" variant="secondary" block loading={applying} onClick={handleToggle}>
                            Запросить доступ
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}

function getDaysLabel(days: number): string {
    // ruPlural: 21 день, 22 дня, 25 дней (раньше «21 дней»).
    return ruPlural(days, ['день', 'дня', 'дней']);
}
