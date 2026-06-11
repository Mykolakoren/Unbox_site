import { useEffect, useMemo, useState } from 'react';
import { Loader2, Power, Users as UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember } from '../../../api/team';

const ROLE_LABEL: Record<string, string> = {
    founder: 'Основатель',
    senior_admin: 'Старший администратор',
    admin: 'Администратор',
    other: 'Другое',
};

const ROLE_COLOR: Record<string, { bg: string; fg: string }> = {
    founder:      { bg: 'rgba(76,138,107,0.15)', fg: '#1B7430' },
    senior_admin: { bg: 'rgba(76,138,255,0.12)', fg: '#3F6BD8' },
    admin:        { bg: 'rgba(0,0,0,0.06)',      fg: '#0E0E0E' },
    other:        { bg: 'rgba(0,0,0,0.04)',      fg: '#666' },
};

/**
 * Mobile admin: Команда — read-only list of staff with quick "active toggle".
 * Editing fields (name/role/photo) intentionally lives only on desktop; the
 * mobile screen is for at-a-glance lookups + temporarily disabling a member
 * (e.g. when someone is on leave).
 */
export function MobileAdminTeam() {
    const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const data = await teamApi.getAllAdmin();
            setMembers(data);
        } catch {
            toast.error('Не удалось загрузить команду');
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
            toast.success(m.isActive ? 'Отключён' : 'Включён');
        } catch {
            toast.error('Не удалось обновить');
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
                textTransform: 'uppercase', color: '#888',
                marginBottom: 10,
            }}>
                Команда · {members.length}
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
                    <Loader2 size={20} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : sorted.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>
                    Никого нет
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {sorted.map(m => {
                        const role = ROLE_COLOR[m.roleType] || ROLE_COLOR.other;
                        return (
                            <div key={m.id} style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                                borderRadius: 12,
                                padding: '11px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                opacity: m.isActive ? 1 : 0.5,
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
                                        background: 'rgba(0,0,0,0.06)',
                                        color: '#888',
                                        display: 'grid', placeItems: 'center',
                                        fontSize: 13, fontWeight: 700,
                                        flexShrink: 0,
                                    }}>
                                        {m.name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('')}
                                    </div>
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {m.name}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                        <span style={{
                                            background: role.bg, color: role.fg,
                                            padding: '2px 7px', borderRadius: 5,
                                            fontSize: 10, fontWeight: 700,
                                            letterSpacing: '0.04em', textTransform: 'uppercase',
                                        }}>
                                            {ROLE_LABEL[m.roleType] || 'Другое'}
                                        </span>
                                        <span style={{ fontSize: 11, color: '#888' }}>{m.role}</span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggle(m)}
                                    disabled={busyId === m.id}
                                    style={{
                                        background: m.isActive ? 'rgba(0,0,0,0.05)' : '#B3261E',
                                        color: m.isActive ? '#0E0E0E' : '#fff',
                                        border: 'none',
                                        borderRadius: 8,
                                        padding: '7px 10px',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    {busyId === m.id
                                        ? <Loader2 size={12} className="animate-spin" />
                                        : <Power size={12} />}
                                    {m.isActive ? 'Вкл' : 'Выкл'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={{
                marginTop: 16,
                padding: 12,
                background: 'rgba(76,138,107,0.06)',
                borderRadius: 10,
                fontSize: 12,
                color: '#444',
                lineHeight: 1.5,
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
            }}>
                <UsersIcon size={14} style={{ flexShrink: 0, marginTop: 2, color: '#1B7430' }} />
                <span>
                    Редактирование (фото, био, роль) и добавление новых — в десктоп-версии /admin/team.
                </span>
            </div>
        </div>
    );
}
