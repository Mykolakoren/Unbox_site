import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, X, Eye, EyeOff, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember, type TeamMemberCreate } from '../../api/team';
import { createPortal } from 'react-dom';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

/* ── Grid House module-scope constants (prefix: ght) ── */
const ghtHairline = `1px solid ${GH.ink10}`;
const ghtMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};
const ghtH1: React.CSSProperties = {
    fontFamily: GH_SANS,
    fontWeight: 800,
    fontSize: 'clamp(28px, 3.5vw, 42px)',
    lineHeight: 0.95,
    letterSpacing: '-0.02em',
    margin: 0,
};

const ROLE_TYPES = [
    { value: 'founder', label: 'Основатель' },
    { value: 'senior_admin', label: 'Ст. администратор' },
    { value: 'admin', label: 'Администратор' },
    { value: 'other', label: 'Другое' },
];

interface FormData {
    name: string;
    role: string;
    role_type: string;
    photo_url: string;
    bio: string;
    sort_order: number;
    is_active: boolean;
}

const defaultForm = (): FormData => ({
    name: '',
    role: '',
    role_type: 'admin',
    photo_url: '',
    bio: '',
    sort_order: 0,
    is_active: true,
});

interface MemberModalProps {
    member: TeamMember | null;
    onClose: () => void;
    onSaved: () => void;
}

function MemberModal({ member, onClose, onSaved }: MemberModalProps) {
    const [form, setForm] = useState<FormData>(
        member
            ? {
                name: member.name,
                role: member.role,
                role_type: member.roleType,
                photo_url: member.photoUrl ?? '',
                bio: member.bio ?? '',
                sort_order: member.sortOrder,
                is_active: member.isActive,
            }
            : defaultForm()
    );
    const [saving, setSaving] = useState(false);

    const set = (k: keyof FormData, v: string | number | boolean) =>
        setForm(f => ({ ...f, [k]: v }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name.trim() || !form.role.trim()) {
            toast.error('Заполните имя и должность');
            return;
        }
        setSaving(true);
        try {
            const payload: TeamMemberCreate = {
                ...form,
                photo_url: form.photo_url || undefined,
                bio: form.bio || undefined,
            };
            if (member) {
                await teamApi.update(member.id, payload);
                toast.success('Карточка обновлена');
            } else {
                await teamApi.create(payload);
                toast.success('Участник добавлен');
            }
            onSaved();
            onClose();
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                    <X size={20} />
                </button>
                <h3 className="text-lg font-bold text-unbox-dark mb-5">
                    {member ? 'Редактировать участника' : 'Новый участник'}
                </h3>
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Photo preview */}
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                            {form.photo_url ? (
                                <img src={form.photo_url} alt="" className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl font-bold">
                                    {form.name[0]?.toUpperCase() || '?'}
                                </div>
                            )}
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">URL фото</label>
                            <input
                                type="url"
                                value={form.photo_url}
                                onChange={e => set('photo_url', e.target.value)}
                                placeholder="https://..."
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Имя *</label>
                            <input
                                type="text"
                                value={form.name}
                                onChange={e => set('name', e.target.value)}
                                placeholder="Николай"
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Тип роли</label>
                            <select
                                value={form.role_type}
                                onChange={e => set('role_type', e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            >
                                {ROLE_TYPES.map(r => (
                                    <option key={r.value} value={r.value}>{r.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Должность (отображаемая) *</label>
                        <input
                            type="text"
                            value={form.role}
                            onChange={e => set('role', e.target.value)}
                            placeholder="Основатель, Администратор..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            required
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Bio (необязательно)</label>
                        <textarea
                            value={form.bio}
                            onChange={e => set('bio', e.target.value)}
                            rows={3}
                            placeholder="Краткое описание..."
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green resize-none"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Порядок</label>
                            <input
                                type="number"
                                value={form.sort_order}
                                onChange={e => set('sort_order', parseInt(e.target.value) || 0)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                            />
                        </div>
                        <div className="flex items-end pb-0.5">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={form.is_active}
                                    onChange={e => set('is_active', e.target.checked)}
                                    className="w-4 h-4 accent-unbox-green"
                                />
                                <span className="text-sm text-gray-700">Активен</span>
                            </label>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose}
                            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50">
                            Отмена
                        </button>
                        <button type="submit" disabled={saving}
                            className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 disabled:opacity-60">
                            {saving ? 'Сохранение...' : member ? 'Сохранить' : 'Добавить'}
                        </button>
                    </div>
                </form>
            </div>
        </div>,
        document.body
    );
}

export function AdminTeam() {
        const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [editMember, setEditMember] = useState<TeamMember | null | undefined>(undefined); // undefined = closed, null = new

    const load = async () => {
        try {
            const data = await teamApi.getAllAdmin();
            setMembers(data);
        } catch {
            toast.error('Ошибка загрузки команды');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (m: TeamMember) => {
        if (!confirm(`Удалить ${m.name}?`)) return;
        try {
            await teamApi.delete(m.id);
            toast.success('Участник удалён');
            load();
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    const handleToggleActive = async (m: TeamMember) => {
        try {
            await teamApi.update(m.id, { is_active: !m.isActive });
            load();
        } catch {
            toast.error('Ошибка');
        }
    };

    const ROLE_LABEL: Record<string, string> = {
        founder: 'Основатель',
        senior_admin: 'Ст. администратор',
        admin: 'Администратор',
        other: 'Другое',
    };
    const ROLE_COLORS: Record<string, string> = {
        founder: 'bg-unbox-green/15 text-unbox-green',
        senior_admin: 'bg-blue-50 text-blue-700',
        admin: 'bg-gray-100 text-gray-600',
        other: 'bg-gray-50 text-gray-500',
    };

    return (

        <GridHouseTeam
            members={members}
            loading={loading}
            ROLE_LABEL={ROLE_LABEL}
            setEditMember={setEditMember}
            handleToggleActive={handleToggleActive}
            handleDelete={handleDelete}
            editMember={editMember}
            load={load}
        />
    );
}


/* ═══════════════════════════════════════════════════════════════
   Grid House variant — Team
   ═══════════════════════════════════════════════════════════════ */

interface GridHouseTeamProps {
    members: TeamMember[];
    loading: boolean;
    ROLE_LABEL: Record<string, string>;
    setEditMember: (m: TeamMember | null | undefined) => void;
    handleToggleActive: (m: TeamMember) => void;
    handleDelete: (m: TeamMember) => void;
    editMember: TeamMember | null | undefined;
    load: () => void;
}

function GridHouseTeam({
    members,
    loading,
    ROLE_LABEL,
    setEditMember,
    handleToggleActive,
    handleDelete,
    editMember,
    load,
}: GridHouseTeamProps) {
    const total = String(members.length).padStart(3, '0');
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: narrow ? 16 : 28, marginBottom: narrow ? 16 : 28 }}>
                <div style={{ ...ghtMono, marginBottom: narrow ? 8 : 14 }}>Раздел · Команда</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: narrow ? 12 : 24, flexWrap: 'wrap' }}>
                    <h1 style={{ ...ghtH1, fontSize: narrow ? 24 : ghtH1.fontSize }}>Команда на витрине.</h1>
                    <div style={{ fontFamily: GH_MONO, fontSize: narrow ? 36 : 'clamp(40px, 5vw, 64px)', fontWeight: 700, lineHeight: 0.9, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                        {total}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ ...ghtMono, color: GH.ink30, fontSize: narrow ? 9 : 10 }}>
                        {narrow ? 'Показаны на сайте' : 'Карточки показываются на главной странице сайта'}
                    </div>
                    <button
                        onClick={() => setEditMember(null)}
                        style={{
                            background: GH.ink,
                            color: GH.paper,
                            fontFamily: GH_MONO,
                            fontSize: narrow ? 9 : 11,
                            fontWeight: 600,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase' as const,
                            padding: narrow ? '10px 14px' : '14px 22px',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            whiteSpace: 'nowrap' as const,
                        }}
                    >
                        <Plus size={narrow ? 12 : 14} /> Добавить
                    </button>
                </div>
            </div>

            {/* ── Content ── */}
            {loading ? (
                <div style={{ padding: '120px 0', textAlign: 'center', ...ghtMono }}>
                    Загрузка команды...
                </div>
            ) : members.length === 0 ? (
                <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: ghtHairline, padding: '80px 24px', textAlign: 'center' }}>
                    <div style={{ ...ghtMono, marginBottom: 14 }}>→ Пусто</div>
                    <h2 style={{ ...ghtH1, fontSize: 'clamp(28px, 3.5vw, 44px)' }}>Команда пока не собрана.</h2>
                </div>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
                        gap: 0,
                        borderTop: `2px solid ${GH.ink}`,
                        borderLeft: narrow ? undefined : ghtHairline,
                    }}
                >
                    {members.map((m, idx) => (
                        <div
                            key={m.id}
                            style={{
                                borderRight: ghtHairline,
                                borderBottom: ghtHairline,
                                background: GH.paper,
                                opacity: m.isActive ? 1 : 0.5,
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* Photo / initial */}
                            <div style={{ borderBottom: ghtHairline, aspectRatio: '3 / 4', position: 'relative', background: GH.paper, overflow: 'hidden' }}>
                                {m.photoUrl ? (
                                    <img src={m.photoUrl} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                ) : (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            inset: 0,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontFamily: GH_SANS,
                                            fontWeight: 800,
                                            fontSize: 'clamp(80px, 12vw, 140px)',
                                            lineHeight: 0.8,
                                            letterSpacing: '-0.04em',
                                            color: GH.ink,
                                            userSelect: 'none',
                                        }}
                                    >
                                        {m.name[0]}
                                    </div>
                                )}
                                <div style={{ position: 'absolute', top: 10, left: 12, ...ghtMono, color: GH.ink60, background: GH.paper, padding: '2px 6px', fontVariantNumeric: 'tabular-nums' }}>
                                    {String(idx + 1).padStart(2, '0')}
                                </div>
                                <div style={{ position: 'absolute', top: 10, right: 12, ...ghtMono, color: GH.ink30, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <GripVertical size={11} /> {m.sortOrder}
                                </div>
                                {!m.isActive && (
                                    <div style={{ position: 'absolute', bottom: 10, left: 12, ...ghtMono, background: GH.ink, color: GH.paper, padding: '3px 7px' }}>
                                        Скрыт
                                    </div>
                                )}
                            </div>

                            {/* Body */}
                            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                                <div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', color: GH.ink, lineHeight: 1.15 }}>
                                        {m.name}
                                    </div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 13, color: GH.ink60, marginTop: 3, letterSpacing: '-0.005em' }}>
                                        {m.role}
                                    </div>
                                </div>
                                <div>
                                    <span
                                        style={{
                                            fontFamily: GH_MONO,
                                            fontSize: 10,
                                            fontWeight: 600,
                                            letterSpacing: '0.14em',
                                            textTransform: 'uppercase',
                                            padding: '4px 8px',
                                            color: m.roleType === 'founder' ? GH.paper : GH.ink,
                                            background: m.roleType === 'founder' ? GH.ink : 'transparent',
                                            border: `1px solid ${GH.ink}`,
                                        }}
                                    >
                                        {ROLE_LABEL[m.roleType] ?? m.roleType}
                                    </span>
                                </div>
                                {m.bio && (
                                    <div
                                        style={{
                                            fontSize: 12,
                                            lineHeight: 1.45,
                                            color: GH.ink60,
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {m.bio}
                                    </div>
                                )}
                                <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: ghtHairline, display: 'flex', gap: 4 }}>
                                    <button
                                        onClick={() => setEditMember(m)}
                                        title="Править"
                                        style={{
                                            flex: 1,
                                            height: 30,
                                            background: 'transparent',
                                            border: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                            color: GH.ink60,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Pencil size={12} />
                                    </button>
                                    <button
                                        onClick={() => handleToggleActive(m)}
                                        title={m.isActive ? 'Скрыть' : 'Показать'}
                                        style={{
                                            flex: 1,
                                            height: 30,
                                            background: 'transparent',
                                            border: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                            color: GH.ink60,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        {m.isActive ? <EyeOff size={12} /> : <Eye size={12} />}
                                    </button>
                                    <button
                                        onClick={() => handleDelete(m)}
                                        title="Удалить"
                                        style={{
                                            flex: 1,
                                            height: 30,
                                            background: 'transparent',
                                            border: `1px solid ${GH.ink10}`,
                                            cursor: 'pointer',
                                            color: GH.ink60,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = GH.danger; e.currentTarget.style.color = GH.danger; }}
                                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = GH.ink10; e.currentTarget.style.color = GH.ink60; }}
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Add slot */}
                    <button
                        onClick={() => setEditMember(null)}
                        style={{
                            borderRight: ghtHairline,
                            borderBottom: ghtHairline,
                            background: GH.ink5,
                            minHeight: 260,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 14,
                            cursor: 'pointer',
                            color: GH.ink60,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = GH.paper; e.currentTarget.style.color = GH.ink; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = GH.ink5; e.currentTarget.style.color = GH.ink60; }}
                    >
                        <div style={{ width: 44, height: 44, border: '2px dashed currentColor', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Plus size={20} />
                        </div>
                        <div style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
                            → Добавить
                        </div>
                    </button>
                </div>
            )}

            {/* ── Footer ── */}
            <div style={{ borderTop: `2px solid ${GH.ink}`, marginTop: 40, padding: '18px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ ...ghtMono, color: GH.ink30 }}>UNBOX ADMIN · 2026</div>
                <div style={{ ...ghtMono, color: GH.ink30, fontVariantNumeric: 'tabular-nums' }}>
                    {total} участников
                </div>
            </div>

            {editMember !== undefined && (
                <MemberModal
                    member={editMember}
                    onClose={() => setEditMember(undefined)}
                    onSaved={load}
                />
            )}
        </div>
    );
}
