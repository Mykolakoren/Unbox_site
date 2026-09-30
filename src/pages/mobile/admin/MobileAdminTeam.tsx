import { useEffect, useMemo, useState } from 'react';
import { Power, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember } from '../../../api/team';
import { Button } from '../../../components/ui/Button';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';

const ROLE_LABEL: Record<string, string> = {
    founder: 'Основатель',
    senior_admin: 'Старший администратор',
    admin: 'Администратор',
    other: 'Другое',
};

/**
 * Mobile admin: Команда — read-only list of staff with quick "active toggle".
 * Editing fields (name/role/photo) intentionally lives only on desktop; the
 * mobile screen is for at-a-glance lookups + temporarily disabling a member
 * (e.g. when someone is on leave).
 *
 * Wave 1: роль — нейтральной плашкой (раньше зелёная/синяя для красоты),
 * кнопка называет действие («Отключить» / «Включить»), а не состояние.
 */
export function MobileAdminTeam() {
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const data = await teamApi.getAllAdmin();
            setMembers(data);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const sorted = useMemo(() => {
        const roleOrder = ['founder', 'senior_admin', 'admin', 'other'];
        return [...members].sort((a, b) => {
            if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
            const ai = roleOrder.indexOf(a.roleType);
            const bi = roleOrder.indexOf(b.roleType);
            if (ai !== bi) return ai - bi;
            return (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
        });
    }, [members]);

    const handleToggle = async (m: TeamMember) => {
        setBusyId(m.id);
        try {
            await teamApi.update(m.id, { is_active: !m.isActive });
            await load();
            toast.success(m.isActive ? `${m.name}: отключён` : `${m.name}: включён`);
        } catch {
            toast.error('Не удалось обновить. Попробуйте ещё раз');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-ink-60)',
                marginBottom: 10,
            }}>
                Команда · {members.length}
            </div>

            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить команду" onRetry={load} className="mb-3" />
            )}
            {loading ? (
                <SkeletonList count={4} label="Загружаем команду" cardHeight={64} />
            ) : failed ? null : sorted.length === 0 ? (
                <EmptyState compact title="В команде пока никого" hint="Добавить сотрудника можно на компьютере." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sorted.map(m => {
                        return (
                            <div key={m.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 12,
                                padding: '8px 8px 8px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                            }}>
                                {m.photoUrl ? (
                                    <img
                                        src={m.photoUrl}
                                        alt={m.name}
                                        style={{
                                            width: 40, height: 40,
                                            borderRadius: 10,
                                            objectFit: 'cover',
                                            flexShrink: 0,
                                        }}
                                    />
                                ) : (
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 10,
                                        background: 'var(--color-ink-05)',
                                        color: 'var(--color-ink-60)',
                                        display: 'grid', placeItems: 'center',
                                        fontSize: 13, fontWeight: 600,
                                        flexShrink: 0,
                                    }}>
                                        {m.name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}
                                    </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0, opacity: m.isActive ? 1 : 0.7 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {m.name}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                        <span className="ui-badge ui-badge--muted">
                                            {ROLE_LABEL[m.roleType] || 'Другое'}
                                        </span>
                                        <span style={{ fontSize: 12, color: 'var(--color-ink-60)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {!m.isActive && 'Отключён · '}{m.role}
                                        </span>
                                    </div>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="touch"
                                    loading={busyId === m.id}
                                    icon={<Power size={16} aria-hidden="true" />}
                                    onClick={() => handleToggle(m)}
                                    aria-label={`${m.isActive ? 'Отключить' : 'Включить'}: ${m.name}`}
                                >
                                    {m.isActive ? 'Отключить' : 'Включить'}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'var(--color-sunken)',
                borderRadius: 10,
                fontSize: 12,
                color: 'var(--color-ink-80)',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <UsersIcon size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-ink-60)' }} />
                <span>
                    Фото, описание, роль и новых сотрудников удобнее менять на компьютере:
                    unbox.com.ge/admin/team
                </span>
            </div>
        </div>
    );
}
