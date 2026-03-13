import { useState } from 'react';
import { Shield, Check, Loader2, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { User } from '../../store/types';

// ── Permission definitions ────────────────────────────────────────────────────

export const PERMISSION_GROUPS = [
    {
        group: 'Бронирования',
        permissions: [
            { id: 'bookings.override_24h',   label: 'Отмена/перенос позже 24ч до брони',        seniorAdmin: true },
            { id: 'bookings.cancel_any',     label: 'Отмена бронирований любых клиентов',        seniorAdmin: true },
            { id: 'bookings.reschedule_any', label: 'Перенос бронирований любых клиентов',       seniorAdmin: true },
        ],
    },
    {
        group: 'Клиенты',
        permissions: [
            { id: 'users.set_personal_discount', label: 'Установка персональных скидок',         seniorAdmin: true },
            { id: 'users.manage_subscription',   label: 'Управление абонементами клиентов',       seniorAdmin: true },
            { id: 'users.assign_admin',          label: 'Назначение роли администратора',         seniorAdmin: false },
        ],
    },
    {
        group: 'Финансы',
        permissions: [
            { id: 'finance.topup',          label: 'Пополнение баланса клиентов',                seniorAdmin: true },
            { id: 'finance.view_reports',   label: 'Просмотр финансовых отчётов',                seniorAdmin: true },
        ],
    },
    {
        group: 'Контент',
        permissions: [
            { id: 'content.edit_locations', label: 'Редактирование локаций и кабинетов',         seniorAdmin: false },
            { id: 'content.edit_pricing',   label: 'Редактирование цен и тарифов',               seniorAdmin: false },
        ],
    },
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
    user: User;
    currentUserRole: string;
    onUpdate: (updated: User) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PermissionsEditor({ user, currentUserRole, onUpdate }: Props) {
    const [selected, setSelected] = useState<Set<string>>(
        new Set(user.permissions ?? [])
    );
    const [saving, setSaving] = useState(false);
    const isOwner = currentUserRole === 'owner';
    const isSeniorAdmin = currentUserRole === 'senior_admin';
    const canEdit = isOwner || isSeniorAdmin;

    const canToggle = (permId: string, isSeniorAdminGrantable: boolean): boolean => {
        if (isOwner) return true;
        if (isSeniorAdmin && isSeniorAdminGrantable) return true;
        return false;
    };

    const toggle = (permId: string, isSeniorAdminGrantable: boolean) => {
        if (!canToggle(permId, isSeniorAdminGrantable)) return;
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(permId)) next.delete(permId);
            else next.add(permId);
            return next;
        });
    };

    const save = async () => {
        setSaving(true);
        try {
            const { data } = await api.patch(`/users/${user.id}/permissions`, {
                permissions: Array.from(selected),
            });
            onUpdate(data);
            toast.success('Права доступа сохранены');
        } catch {
            toast.error('Ошибка сохранения прав');
        } finally {
            setSaving(false);
        }
    };

    const hasChanges = () => {
        const orig = new Set(user.permissions ?? []);
        if (orig.size !== selected.size) return true;
        for (const p of selected) if (!orig.has(p)) return true;
        return false;
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
                <Shield size={16} className="text-unbox-green" />
                <span className="text-sm font-semibold text-unbox-dark">Гранулярные права доступа</span>
                {!isOwner && isSeniorAdmin && (
                    <span className="ml-auto flex items-center gap-1 text-[11px] text-unbox-grey">
                        <Info size={11} />
                        Серые пункты — только для владельца
                    </span>
                )}
            </div>

            {PERMISSION_GROUPS.map(group => (
                <div key={group.group} className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-unbox-grey px-1">
                        {group.group}
                    </div>
                    <div className="bg-white rounded-xl border border-unbox-light overflow-hidden">
                        {group.permissions.map((perm, idx) => {
                            const active = selected.has(perm.id);
                            const editable = canEdit && canToggle(perm.id, perm.seniorAdmin);
                            const locked = !editable;

                            return (
                                <button
                                    key={perm.id}
                                    type="button"
                                    onClick={() => toggle(perm.id, perm.seniorAdmin)}
                                    disabled={locked}
                                    className={[
                                        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                                        idx > 0 && 'border-t border-unbox-light',
                                        editable && active && 'bg-unbox-green/5',
                                        editable && !active && 'hover:bg-unbox-light/50',
                                        locked && 'opacity-40 cursor-not-allowed',
                                    ].filter(Boolean).join(' ')}
                                >
                                    {/* Checkbox */}
                                    <div className={[
                                        'w-4.5 h-4.5 rounded flex-shrink-0 border flex items-center justify-center transition-all',
                                        active
                                            ? 'bg-unbox-green border-unbox-green'
                                            : 'border-unbox-light bg-white',
                                    ].join(' ')}>
                                        {active && <Check size={10} strokeWidth={3} className="text-white" />}
                                    </div>

                                    <span className={`text-sm ${active ? 'text-unbox-dark font-medium' : 'text-unbox-grey'}`}>
                                        {perm.label}
                                    </span>

                                    {locked && (
                                        <span className="ml-auto text-[10px] text-unbox-grey/60 flex-shrink-0">
                                            Только владелец
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}

            {canEdit && hasChanges() && (
                <button
                    onClick={save}
                    disabled={saving}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors disabled:opacity-60"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                    Сохранить права
                </button>
            )}
        </div>
    );
}
