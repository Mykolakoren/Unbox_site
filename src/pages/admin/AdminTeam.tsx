import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { teamApi, type TeamMember, type TeamMemberCreate } from '../../api/team';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select, TextArea } from '../../components/ui/Field';
import { ruCountWord } from '../../utils/plural';

/* ── Grid House module-scope constants (prefix: ght) ── */
const ghtHairline = `1px solid ${GH.ink10}`;
const ghtMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
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
    const [initial] = useState(() => JSON.stringify(form));
    const dirty = JSON.stringify(form) !== initial;
    const { confirm: askClose } = useConfirmDialog();

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

    // Окно на общем Sheet (G8-17): Esc, фокус внутри, «Сохранить» в подвале.
    // Клик мимо с несохранёнными правками — сначала вопрос.
    const requestClose = async () => {
        if (saving) return;
        if (!dirty) { onClose(); return; }
        const ok = await askClose({
            title: 'Закрыть без сохранения?',
            body: 'Изменения в карточке пропадут.',
            confirmLabel: 'Закрыть без сохранения',
            cancelLabel: 'Вернуться к карточке',
        });
        if (ok) onClose();
    };

    return (
        <Sheet
            open
            onClose={requestClose}
            title={member ? 'Карточка в команде' : 'Новый участник команды'}
            description="Карточки показываются на странице «Команда» на сайте."
            width={520}
            footer={
                <>
                    <Button block type="submit" form="team-member-form" loading={saving}>
                        {member ? 'Сохранить карточку' : 'Добавить в команду'}
                    </Button>
                    <Button block variant="secondary" onClick={requestClose} disabled={saving}>Отмена</Button>
                </>
            }
        >
            <form id="team-member-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                    <div style={{ width: 64, height: 64, overflow: 'hidden', background: GH.sunken, flexShrink: 0, display: 'grid', placeItems: 'center', fontSize: 24, fontWeight: 600, color: GH.ink60 }}>
                        {form.photo_url
                            ? <img src={form.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : (form.name[0]?.toUpperCase() || '?')}
                    </div>
                    <div style={{ flex: 1 }}>
                        <Field label="Ссылка на фото" optional>
                            <Input type="url" value={form.photo_url} onChange={e => set('photo_url', e.target.value)} placeholder="https://..." />
                        </Field>
                    </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Имя" required>
                        <Input kind="name" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Николай" />
                    </Field>
                    <Field label="Тип роли">
                        <Select value={form.role_type} onChange={e => set('role_type', e.target.value)}>
                            {ROLE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </Select>
                    </Field>
                </div>
                <Field label="Должность на сайте" required>
                    <Input value={form.role} onChange={e => set('role', e.target.value)} placeholder="Основатель, администратор…" />
                </Field>
                <Field label="О себе" optional>
                    <TextArea value={form.bio} onChange={e => set('bio', e.target.value)} rows={3} placeholder="Пара предложений о человеке" />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'end' }}>
                    <Field label="Порядок на сайте" hint="Меньше — выше">
                        <Input kind="integer" value={String(form.sort_order)} onChange={e => set('sort_order', parseInt(e.target.value.replace(/\D/g, '')) || 0)} />
                    </Field>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, cursor: 'pointer', fontSize: 14 }}>
                        <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--color-accent)' }} />
                        Показывать на сайте
                    </label>
                </div>
            </form>
        </Sheet>
    );
}

export function AdminTeam() {
        const [members, setMembers] = useState<TeamMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [editMember, setEditMember] = useState<TeamMember | null | undefined>(undefined); // undefined = closed, null = new
    const { confirm } = useConfirmDialog();

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
        const ok = await confirm({
            title: `Удалить ${m.name} из команды?`,
            body: 'Карточка пропадёт со страницы «Команда». Если нужно только спрятать — выключите её.',
            confirmLabel: 'Удалить из команды',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await teamApi.delete(m.id);
            toast.success('Участник удалён');
            load();
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    const handleToggleActive = async (m: TeamMember) => {
        // Скрыть с сайта — с вопросом; показать обратно — сразу.
        if (m.isActive) {
            const ok = await confirm({
                title: `Скрыть ${m.name} с сайта?`,
                body: 'Карточка пропадёт со страницы «Команда». Вернуть можно в любой момент.',
                confirmLabel: 'Скрыть с сайта',
                cancelLabel: 'Оставить',
            });
            if (!ok) return;
        }
        try {
            await teamApi.update(m.id, { is_active: !m.isActive });
            load();
        } catch {
            toast.error('Не удалось изменить видимость карточки');
        }
    };

    const ROLE_LABEL: Record<string, string> = {
        founder: 'Основатель',
        senior_admin: 'Ст. администратор',
        admin: 'Администратор',
        other: 'Другое',
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
    const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    useEffect(() => {
        const h = () => setNarrow(window.innerWidth < 768);
        window.addEventListener('resize', h);
        return () => window.removeEventListener('resize', h);
    }, []);
    const hidden = members.filter(m => !m.isActive).length;

    const actionBtn: React.CSSProperties = {
        flex: 1,
        minHeight: 36,
        background: 'transparent',
        border: `1px solid ${GH.ink10}`,
        cursor: 'pointer',
        color: GH.ink,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontFamily: GH_SANS,
        fontSize: 12,
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* ── Header: H1 = пункт меню, без «004» и «Команда на витрине.» (G8-11) ── */}
            <PageHeader
                title="Команда"
                description={loading ? 'Карточки команды на странице «Команда» сайта.'
                    : `${ruCountWord(members.length, ['карточка', 'карточки', 'карточек'])} на сайте${hidden > 0 ? ` · скрыто ${hidden}` : ''}. Порядок задаётся полем «Порядок на сайте».`}
                actions={
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditMember(null)}>
                        Добавить в команду
                    </Button>
                }
            />

            {/* ── Content ── */}
            {loading ? (
                <SkeletonList count={4} label="Загружаем команду" />
            ) : members.length === 0 ? (
                <div style={{ border: ghtHairline, background: GH.card }}>
                    <EmptyState
                        title="Команда пока не собрана"
                        hint="Добавьте первого участника — он появится на странице «Команда»."
                        action={{ label: 'Добавить участника', onClick: () => setEditMember(null) }}
                    />
                </div>
            ) : (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: narrow ? '1fr 1fr' : 'repeat(auto-fill, minmax(min(220px, 100%), 1fr))',
                        gap: 0,
                        borderTop: ghtHairline,
                        borderLeft: ghtHairline,
                    }}
                >
                    {members.map(m => (
                        <div
                            key={m.id}
                            style={{
                                borderRight: ghtHairline,
                                borderBottom: ghtHairline,
                                background: GH.card,
                                display: 'flex',
                                flexDirection: 'column',
                            }}
                        >
                            {/* Photo / initial */}
                            <div style={{ borderBottom: ghtHairline, aspectRatio: '3 / 4', position: 'relative', background: GH.sunken, overflow: 'hidden' }}>
                                {m.photoUrl ? (
                                    <img src={m.photoUrl} alt={m.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: m.isActive ? 1 : 0.5 }} />
                                ) : (
                                    <div
                                        aria-hidden="true"
                                        style={{
                                            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontFamily: GH_SANS, fontWeight: 600, fontSize: 64, color: GH.ink60, userSelect: 'none',
                                        }}
                                    >
                                        {m.name[0]}
                                    </div>
                                )}
                                {!m.isActive && (
                                    <div style={{ position: 'absolute', bottom: 10, left: 12, fontSize: 12, fontWeight: 500, background: GH.ink, color: GH.paper, padding: '3px 8px' }}>
                                        Скрыт с сайта
                                    </div>
                                )}
                            </div>

                            {/* Body */}
                            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                                <div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 16, fontWeight: 600, color: GH.ink, lineHeight: 1.2 }}>
                                        {m.name}
                                    </div>
                                    <div style={{ fontFamily: GH_SANS, fontSize: 14, color: GH.ink60, marginTop: 3 }}>
                                        {m.role}
                                    </div>
                                </div>
                                <div style={{ ...ghtMono, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <span>{ROLE_LABEL[m.roleType] ?? m.roleType}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>порядок {m.sortOrder}</span>
                                </div>
                                {m.bio && (
                                    <div
                                        style={{
                                            fontSize: 12, lineHeight: 1.45, color: GH.ink60,
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                        }}
                                    >
                                        {m.bio}
                                    </div>
                                )}
                                {/* Действия подписаны: значок + слово, корзина отделена и краснеет только при наведении (G8-19). */}
                                <div style={{ marginTop: 'auto', paddingTop: 12, borderTop: ghtHairline, display: 'flex', gap: 4 }}>
                                    <button type="button" onClick={() => setEditMember(m)} aria-label={`Править карточку: ${m.name}`} style={actionBtn}>
                                        <Pencil size={14} aria-hidden="true" /> Править
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleToggleActive(m)}
                                        aria-label={m.isActive ? `Скрыть с сайта: ${m.name}` : `Показать на сайте: ${m.name}`}
                                        style={actionBtn}
                                    >
                                        {m.isActive ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                                        {m.isActive ? 'Скрыть' : 'Показать'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(m)}
                                        title="Удалить из команды"
                                        aria-label={`Удалить из команды: ${m.name}`}
                                        className="team-trash"
                                        style={{ ...actionBtn, flex: '0 0 36px', marginLeft: 4, color: GH.ink60 }}
                                    >
                                        <Trash2 size={14} aria-hidden="true" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            <style>{`.team-trash:hover { color: var(--status-danger-fg) !important; border-color: var(--status-danger-fg) !important; }`}</style>

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
