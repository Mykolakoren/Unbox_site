import { useState, useEffect } from 'react';
import { Shield, Check, Info, Lock } from 'lucide-react';
import { Button } from '../ui/Button';
import { toast } from 'sonner';
import { api } from '../../api/client';
import type { User } from '../../store/types';

// ── Permission definitions ────────────────────────────────────────────────────

export const PERMISSION_GROUPS = [
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
            { id: 'bookings.manage_rerent',  label: 'Управление пересдачей',               seniorAdmin: true },
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
        group: 'Бонусы',
        permissions: [
            { id: 'bonuses.grant',  label: 'Начисление бонусов клиентам (через одобрение)',  seniorAdmin: true },
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
        // Бонусы
        'bonuses.grant',
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
        // Бонусы
        'bonuses.grant',
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

    const hasChanges = () => {
        const orig = new Set(user.permissions ?? []);
        if (orig.size !== selected.size) return true;
        for (const p of selected) if (!orig.has(p)) return true;
        return false;
    };

    // Волна 4 (G8-13): права роли — замок и «входит в роль „…“», а не
    // активная галочка, которая не нажимается. Список и сохранение не менялись.
    const roleName = ROLE_NAMES[user.role ?? ''] ?? 'Пользователь';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 16px', fontSize: 14, color: 'var(--color-ink-60)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Lock size={14} aria-hidden="true" /> входит в роль «{roleName}» — выдаётся само
                </span>
                {canEdit && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Check size={14} aria-hidden="true" /> отмечено — выдано сверх роли
                    </span>
                )}
                {!isOwner && isSeniorAdmin && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Info size={14} aria-hidden="true" /> «Только владелец» — может выдать только владелец
                    </span>
                )}
            </div>

            {PERMISSION_GROUPS.map(group => (
                <fieldset key={group.group} style={{ border: 'none', margin: 0, padding: 0 }}>
                    <legend style={{
                        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 500, letterSpacing: '0.06em',
                        textTransform: 'uppercase', color: 'var(--color-ink-60)', padding: '0 0 6px',
                    }}>
                        {group.group}
                    </legend>
                    <div style={{ border: '1px solid var(--color-ink-10)', background: 'var(--color-card)' }}>
                        {group.permissions.map((perm, idx) => {
                            const isInherited = inheritedPerms.has(perm.id);
                            const active = selected.has(perm.id) || isInherited;
                            const editable = canEdit && canToggle(perm.id, perm.seniorAdmin) && !isInherited;
                            const locked = !editable;

                            return (
                                <button
                                    key={perm.id}
                                    type="button"
                                    role={isInherited ? undefined : 'checkbox'}
                                    aria-checked={isInherited ? undefined : active}
                                    onClick={() => !isInherited && toggle(perm.id, perm.seniorAdmin)}
                                    disabled={locked}
                                    className="perm-row"
                                    data-editable={editable || undefined}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                        minHeight: 44, padding: '8px 16px', textAlign: 'left',
                                        border: 'none', borderTop: idx > 0 ? '1px solid var(--color-ink-10)' : 'none',
                                        background: isInherited ? 'var(--color-sunken)'
                                            : editable && active ? 'var(--color-accent-soft)' : 'transparent',
                                        cursor: editable ? 'pointer' : 'default',
                                        font: 'inherit', color: 'var(--color-ink)',
                                    }}
                                >
                                    {isInherited ? (
                                        <Lock size={16} aria-hidden="true" style={{ flexShrink: 0, color: 'var(--color-ink-60)' }} />
                                    ) : (
                                        <span
                                            aria-hidden="true"
                                            style={{
                                                width: 18, height: 18, flexShrink: 0, borderRadius: 4,
                                                display: 'grid', placeItems: 'center',
                                                border: `1.5px solid ${active ? 'var(--color-accent)' : 'var(--color-ink-40)'}`,
                                                background: active ? 'var(--color-accent)' : 'var(--color-card)',
                                                color: 'var(--color-card)',
                                            }}
                                        >
                                            {active && <Check size={12} strokeWidth={3} />}
                                        </span>
                                    )}

                                    <span style={{ fontSize: 14, fontWeight: active ? 500 : 400, color: active ? 'var(--color-ink)' : 'var(--color-ink-60)' }}>
                                        {perm.label}
                                    </span>

                                    {isInherited && (
                                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-ink-60)', flexShrink: 0 }}>
                                            входит в роль «{roleName}»
                                        </span>
                                    )}
                                    {locked && !isInherited && canEdit && (
                                        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--color-ink-60)', flexShrink: 0 }}>
                                            Только владелец
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </fieldset>
            ))}

            {canEdit && hasChanges() && (
                <div style={{ position: 'sticky', bottom: 0, paddingTop: 8, background: 'var(--color-card)' }}>
                    <Button block loading={saving} onClick={save} icon={<Shield size={16} aria-hidden="true" />}>
                        Сохранить права
                    </Button>
                </div>
            )}
            <style>{`.perm-row[data-editable]:hover { background: var(--color-ink-05) !important; }`}</style>
        </div>
    );
}

const ROLE_NAMES: Record<string, string> = {
    owner: 'Владелец',
    senior_admin: 'Старший админ',
    admin: 'Администратор',
    specialist: 'Специалист',
};
