import { useState, useEffect } from 'react';
import { Shield, Check, Loader2, Info, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { User } from '../../store/types';

// ── Permission definitions ────────────────────────────────────────────────────

export const PERMISSION_GROUPS = [
    {
        group: 'Psy-CRM (кабинет специалиста)',
        permissions: [
            { id: 'psy_crm.access',    label: 'Доступ к Psy-CRM',                         seniorAdmin: true },
            { id: 'psy_crm.clients',   label: 'Управление клиентами практики',             seniorAdmin: true },
            { id: 'psy_crm.sessions',  label: 'Управление сессиями',                       seniorAdmin: true },
            { id: 'psy_crm.finances',  label: 'Финансы практики',                          seniorAdmin: true },
        ],
    },
    {
        group: 'CRM Unbox (клиенты сервиса)',
        permissions: [
            { id: 'crm.view_clients',   label: 'Просмотр списка клиентов',                 seniorAdmin: true },
            { id: 'crm.create_client',  label: 'Создание карточки клиента',                seniorAdmin: true },
            { id: 'crm.edit_client',    label: 'Редактирование профиля клиента',            seniorAdmin: true },
            { id: 'crm.manage_status',  label: 'Управление статусом в воронке',             seniorAdmin: true },
        ],
    },
    {
        group: 'Бронирования',
        permissions: [
            { id: 'bookings.view_all',       label: 'Просмотр всех бронирований',           seniorAdmin: true },
            { id: 'bookings.cancel_any',     label: 'Отмена бронирований (в рамках 24ч)',   seniorAdmin: true },
            { id: 'bookings.reschedule_any', label: 'Перенос бронирований (в рамках 24ч)',  seniorAdmin: true },
            { id: 'bookings.override_24h',   label: 'Обход правила 24ч (с причиной)',       seniorAdmin: true },
            { id: 'bookings.manage_rerent',  label: 'Управление переарендой',               seniorAdmin: true },
        ],
    },
    {
        group: 'Абонементы и скидки',
        permissions: [
            { id: 'subscriptions.manage',           label: 'Назначение абонементов',                  seniorAdmin: true },
            { id: 'subscriptions.request_discount',  label: 'Запрос персональной скидки (через акцепт)', seniorAdmin: true },
            { id: 'subscriptions.set_discount',      label: 'Установка скидки напрямую',                seniorAdmin: true },
        ],
    },
    {
        group: 'Финансы',
        permissions: [
            { id: 'finance.topup_balance',   label: 'Пополнение баланса (с прикреплением файла)',  seniorAdmin: true },
            { id: 'finance.set_credit_limit', label: 'Установка кредитного лимита',                seniorAdmin: true },
            { id: 'finance.view_reports',     label: 'Просмотр финансовых отчётов',                seniorAdmin: true },
            { id: 'finance.manage_cashbox',   label: 'Управление кассой и финансовым учётом',      seniorAdmin: true },
        ],
    },
    {
        group: 'Контент',
        permissions: [
            { id: 'content.edit_locations',  label: 'Редактирование локаций',                      seniorAdmin: true },
            { id: 'content.edit_rooms',      label: 'Редактирование кабинетов',                    seniorAdmin: true },
            { id: 'content.add_locations',   label: 'Добавление локаций',                          seniorAdmin: true },
            { id: 'content.add_rooms',       label: 'Добавление кабинетов',                        seniorAdmin: true },
            { id: 'content.delete',          label: 'Удаление локаций и кабинетов',                seniorAdmin: false },
            { id: 'content.set_hours',       label: 'Назначение доступных часов для аренды',       seniorAdmin: true },
            { id: 'content.edit_pricing',    label: 'Редактирование цен и тарифов',                seniorAdmin: true },
        ],
    },
    {
        group: 'Специалисты',
        permissions: [
            { id: 'specialists.verify',  label: 'Верификация заявок специалистов',                 seniorAdmin: true },
        ],
    },
    {
        group: 'Система',
        permissions: [
            { id: 'admin.access',           label: 'Доступ к панели администратора',               seniorAdmin: true },
            { id: 'admin.dashboard',        label: 'Просмотр дашборда и аналитики',                seniorAdmin: true },
            { id: 'admin.assign_roles',     label: 'Назначение ролей',                             seniorAdmin: false },
            { id: 'admin.accept_requests',  label: 'Акцептование запросов админов',                seniorAdmin: true },
            { id: 'admin.assign_owner',     label: 'Назначение роли владельца',                    seniorAdmin: false },
        ],
    },
] as const;

// ── Role-inherited permissions ────────────────────────────────────────────────

const ROLE_INHERITED: Record<string, string[]> = {
    owner: [
        // Система
        'admin.access', 'admin.dashboard', 'admin.assign_roles', 'admin.accept_requests', 'admin.assign_owner',
        // CRM Unbox
        'crm.view_clients', 'crm.create_client', 'crm.edit_client', 'crm.manage_status',
        // Бронирования
        'bookings.view_all', 'bookings.cancel_any', 'bookings.reschedule_any', 'bookings.override_24h', 'bookings.manage_rerent',
        // Абонементы и скидки
        'subscriptions.manage', 'subscriptions.request_discount', 'subscriptions.set_discount',
        // Финансы
        'finance.topup_balance', 'finance.set_credit_limit', 'finance.view_reports', 'finance.manage_cashbox',
        // Контент
        'content.edit_locations', 'content.edit_rooms', 'content.add_locations', 'content.add_rooms',
        'content.delete', 'content.set_hours', 'content.edit_pricing',
        // Специалисты
        'specialists.verify',
    ],
    senior_admin: [
        // Система
        'admin.access', 'admin.dashboard', 'admin.assign_roles', 'admin.accept_requests',
        // CRM Unbox
        'crm.view_clients', 'crm.create_client', 'crm.edit_client', 'crm.manage_status',
        // Бронирования
        'bookings.view_all', 'bookings.cancel_any', 'bookings.reschedule_any', 'bookings.override_24h', 'bookings.manage_rerent',
        // Абонементы и скидки
        'subscriptions.manage', 'subscriptions.request_discount', 'subscriptions.set_discount',
        // Финансы
        'finance.topup_balance', 'finance.set_credit_limit', 'finance.view_reports', 'finance.manage_cashbox',
        // Контент
        'content.edit_locations', 'content.edit_rooms', 'content.add_locations', 'content.add_rooms',
        'content.set_hours', 'content.edit_pricing',
        // Специалисты
        'specialists.verify',
    ],
    admin: [
        // Система
        'admin.access', 'admin.dashboard',
        // CRM Unbox
        'crm.view_clients', 'crm.create_client', 'crm.edit_client', 'crm.manage_status',
        // Бронирования
        'bookings.view_all', 'bookings.cancel_any', 'bookings.reschedule_any', 'bookings.manage_rerent',
        // Абонементы и скидки
        'subscriptions.manage', 'subscriptions.request_discount',
        // Финансы
        'finance.topup_balance', 'finance.set_credit_limit', 'finance.view_reports',
        // Контент
        'content.edit_locations', 'content.edit_rooms', 'content.set_hours',
        // Специалисты
        'specialists.verify',
    ],
    specialist: [
        'psy_crm.access', 'psy_crm.clients', 'psy_crm.sessions', 'psy_crm.finances',
    ],
};

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
    const inheritedPerms = new Set(ROLE_INHERITED[user.role ?? ''] ?? []);

    // Reset when user changes
    useEffect(() => {
        setSelected(new Set(user.permissions ?? []));
    }, [user.id]);
    const isOwner = currentUserRole === 'owner';
    const isSeniorAdmin = currentUserRole === 'senior_admin';
    const canEdit = isOwner || isSeniorAdmin;

    const canToggle = (_permId: string, isSeniorAdminGrantable: boolean): boolean => {
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

    const SPECIALIST_PRESET = ['psy_crm.access', 'psy_crm.clients', 'psy_crm.sessions', 'psy_crm.finances'];

    const applySpecialistPreset = () => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const p of SPECIALIST_PRESET) next.add(p);
            return next;
        });
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
                {canEdit && (
                    <button
                        type="button"
                        onClick={applySpecialistPreset}
                        className="ml-auto flex items-center gap-1 text-[11px] text-unbox-green hover:text-unbox-green/80 transition-colors"
                    >
                        <Zap size={11} />
                        Пресет специалиста
                    </button>
                )}
                {!isOwner && isSeniorAdmin && (
                    <span className={`${canEdit ? '' : 'ml-auto'} flex items-center gap-1 text-[11px] text-unbox-grey`}>
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
                            const isInherited = inheritedPerms.has(perm.id);
                            const active = selected.has(perm.id) || isInherited;
                            const editable = canEdit && canToggle(perm.id, perm.seniorAdmin) && !isInherited;
                            const locked = !editable;

                            return (
                                <button
                                    key={perm.id}
                                    type="button"
                                    onClick={() => !isInherited && toggle(perm.id, perm.seniorAdmin)}
                                    disabled={locked}
                                    className={[
                                        'w-full flex items-center gap-3 px-4 py-3 text-left transition-colors',
                                        idx > 0 && 'border-t border-unbox-light',
                                        editable && active && 'bg-unbox-green/5',
                                        editable && !active && 'hover:bg-unbox-light/50',
                                        isInherited && 'bg-blue-50/60',
                                        locked && !isInherited && 'opacity-40 cursor-not-allowed',
                                    ].filter(Boolean).join(' ')}
                                >
                                    {/* Checkbox */}
                                    <div className={[
                                        'w-4.5 h-4.5 rounded flex-shrink-0 border flex items-center justify-center transition-all',
                                        active && isInherited ? 'bg-blue-400 border-blue-400' :
                                        active ? 'bg-unbox-green border-unbox-green' :
                                        'border-unbox-light bg-white',
                                    ].join(' ')}>
                                        {active && <Check size={10} strokeWidth={3} className="text-white" />}
                                    </div>

                                    <span className={`text-sm ${active ? 'text-unbox-dark font-medium' : 'text-unbox-grey'}`}>
                                        {perm.label}
                                    </span>

                                    {isInherited && (
                                        <span className="ml-auto text-[10px] text-blue-500 bg-blue-100 px-1.5 py-0.5 rounded flex-shrink-0">
                                            от роли
                                        </span>
                                    )}
                                    {locked && !isInherited && (
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
