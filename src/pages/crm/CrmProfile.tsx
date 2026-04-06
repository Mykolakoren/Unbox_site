import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { Loader2, Save, Plus, X } from 'lucide-react';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const SPECIALIZATION_SUGGESTIONS = [
    'Тревога', 'Депрессия', 'Отношения', 'Самооценка', 'Стресс', 'Горе и утрата',
    'Травма и ПТСР', 'Панические атаки', 'ОКР', 'Расстройства пищевого поведения',
    'Зависимости', 'Кризисные состояния', 'Семейные конфликты', 'Детско-родительские отношения',
    'Личностный рост', 'Профессиональное выгорание', 'Сексуальность', 'Возрастные кризисы',
];

const FORMAT_OPTIONS = [
    { value: 'ONLINE', label: 'Онлайн' },
    { value: 'OFFLINE', label: 'Оффлайн (в кабинете)' },
];

interface ProfileData {
    firstName: string;
    lastName: string;
    photoUrl: string;
    tagline: string;
    bio: string;
    specializations: string[];
    formats: string[];
    basePriceGel: number;
}

export function CrmProfile() {
    const gridHouse = useDesignFlag();
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [newSpec, setNewSpec] = useState('');

    useEffect(() => {
        api.get('/specialists/me')
            .then(r => setProfile(r.data))
            .catch(() => toast.error('Не удалось загрузить анкету'))
            .finally(() => setLoading(false));
    }, []);

    const handleSave = async () => {
        if (!profile) return;
        setSaving(true);
        try {
            const r = await api.patch('/specialists/me', {
                firstName: profile.firstName,
                lastName: profile.lastName,
                photoUrl: profile.photoUrl || null,
                tagline: profile.tagline,
                bio: profile.bio,
                specializations: profile.specializations,
                formats: profile.formats,
                basePriceGel: profile.basePriceGel,
            });
            setProfile(r.data);
            toast.success('Анкета сохранена');
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    const addSpec = (val: string) => {
        const trimmed = val.trim();
        if (!trimmed || profile?.specializations.includes(trimmed)) return;
        setProfile(p => p ? { ...p, specializations: [...p.specializations, trimmed] } : p);
        setNewSpec('');
    };

    const removeSpec = (spec: string) =>
        setProfile(p => p ? { ...p, specializations: p.specializations.filter(s => s !== spec) } : p);

    const toggleFormat = (fmt: string) =>
        setProfile(p => {
            if (!p) return p;
            const fmts = p.formats.includes(fmt)
                ? p.formats.filter(f => f !== fmt)
                : [...p.formats, fmt];
            return { ...p, formats: fmts };
        });

    if (gridHouse) {
        return (
            <GridHouseCrmProfile
                profile={profile}
                loading={loading}
                saving={saving}
                setProfile={setProfile}
                newSpec={newSpec}
                setNewSpec={setNewSpec}
                onSave={handleSave}
                onAddSpec={addSpec}
                onRemoveSpec={removeSpec}
                onToggleFormat={toggleFormat}
            />
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-green" />
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="text-center py-24 text-unbox-grey">
                <p className="text-lg font-medium mb-2">Анкета не найдена</p>
                <p className="text-sm">Обратитесь к администратору для создания анкеты специалиста.</p>
            </div>
        );
    }

    return (
        <div className="max-w-2xl space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Моя анкета</h1>
                    <p className="text-sm text-unbox-grey mt-1">Информация, которую видят клиенты в каталоге</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-unbox-green text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    {saving ? 'Сохраняю...' : 'Сохранить'}
                </button>
            </div>

            {/* Photo + Name */}
            <div className="bg-white rounded-2xl border border-unbox-light p-6 space-y-4">
                <h2 className="font-semibold text-unbox-dark">Основное</h2>

                <div className="flex items-start gap-4">
                    <div className="shrink-0">
                        {profile.photoUrl ? (
                            <img src={profile.photoUrl} alt="" className="w-20 h-20 rounded-2xl object-cover border border-unbox-light" />
                        ) : (
                            <div className="w-20 h-20 rounded-2xl bg-unbox-green/15 flex items-center justify-center text-unbox-green font-bold text-2xl border border-unbox-light">
                                {profile.firstName?.[0]}{profile.lastName?.[0]}
                            </div>
                        )}
                    </div>
                    <div className="flex-1">
                        <label className="block text-xs font-medium text-unbox-grey mb-1">URL фото</label>
                        <input
                            type="url"
                            value={profile.photoUrl ?? ''}
                            onChange={e => setProfile(p => p ? { ...p, photoUrl: e.target.value } : p)}
                            placeholder="https://..."
                            className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                        />
                        <p className="text-[11px] text-unbox-grey mt-1">Вставьте прямую ссылку на фото (jpg, png)</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-unbox-grey mb-1">Имя</label>
                        <input
                            type="text"
                            value={profile.firstName}
                            onChange={e => setProfile(p => p ? { ...p, firstName: e.target.value } : p)}
                            className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-unbox-grey mb-1">Фамилия</label>
                        <input
                            type="text"
                            value={profile.lastName}
                            onChange={e => setProfile(p => p ? { ...p, lastName: e.target.value } : p)}
                            className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                        />
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-unbox-grey mb-1">Короткое описание (tagline)</label>
                    <input
                        type="text"
                        value={profile.tagline}
                        onChange={e => setProfile(p => p ? { ...p, tagline: e.target.value } : p)}
                        maxLength={150}
                        placeholder="Психолог, КПТ, 5 лет практики"
                        className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                    />
                    <p className="text-[11px] text-unbox-grey mt-1">{profile.tagline.length}/150 символов</p>
                </div>
            </div>

            {/* Bio */}
            <div className="bg-white rounded-2xl border border-unbox-light p-6 space-y-3">
                <h2 className="font-semibold text-unbox-dark">О себе</h2>
                <textarea
                    value={profile.bio}
                    onChange={e => setProfile(p => p ? { ...p, bio: e.target.value } : p)}
                    rows={6}
                    placeholder="Расскажите о своём подходе, образовании, опыте работы..."
                    className="w-full px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green resize-none"
                />
            </div>

            {/* Specializations */}
            <div className="bg-white rounded-2xl border border-unbox-light p-6 space-y-3">
                <h2 className="font-semibold text-unbox-dark">Специализации</h2>
                <div className="flex flex-wrap gap-2">
                    {profile.specializations.map(spec => (
                        <span key={spec} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-full bg-unbox-green/10 text-unbox-green font-medium">
                            {spec}
                            <button onClick={() => removeSpec(spec)} className="ml-1 hover:text-red-500 transition-colors">
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={newSpec}
                        onChange={e => setNewSpec(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(newSpec); } }}
                        placeholder="Добавить специализацию..."
                        className="flex-1 px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                    />
                    <button
                        onClick={() => addSpec(newSpec)}
                        disabled={!newSpec.trim()}
                        className="px-3 py-2 rounded-lg bg-unbox-green/10 text-unbox-green hover:bg-unbox-green/20 disabled:opacity-40 transition-colors"
                    >
                        <Plus size={16} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-1">
                    <p className="text-[11px] text-unbox-grey w-full mb-1">Быстрое добавление:</p>
                    {SPECIALIZATION_SUGGESTIONS.filter(s => !profile.specializations.includes(s)).map(s => (
                        <button
                            key={s}
                            onClick={() => addSpec(s)}
                            className="text-[11px] px-2 py-1 rounded-full border border-unbox-light text-unbox-grey hover:border-unbox-green hover:text-unbox-green transition-colors"
                        >
                            + {s}
                        </button>
                    ))}
                </div>
            </div>

            {/* Formats + Price */}
            <div className="bg-white rounded-2xl border border-unbox-light p-6 space-y-4">
                <h2 className="font-semibold text-unbox-dark">Формат и стоимость</h2>

                <div>
                    <label className="block text-xs font-medium text-unbox-grey mb-2">Формат работы</label>
                    <div className="flex gap-3">
                        {FORMAT_OPTIONS.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={profile.formats.includes(opt.value)}
                                    onChange={() => toggleFormat(opt.value)}
                                    className="w-4 h-4 rounded accent-unbox-green"
                                />
                                <span className="text-sm text-unbox-dark/80">{opt.label}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <label className="block text-xs font-medium text-unbox-grey mb-1">Базовая стоимость сессии (₾)</label>
                    <input
                        type="number"
                        value={profile.basePriceGel}
                        onChange={e => setProfile(p => p ? { ...p, basePriceGel: Number(e.target.value) } : p)}
                        min={0}
                        step={5}
                        className="w-32 px-3 py-2 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green"
                    />
                </div>
            </div>

            {/* Bottom save */}
            <div className="flex justify-end pb-6">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-6 py-3 bg-unbox-green text-white rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                    {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                    {saving ? 'Сохраняю...' : 'Сохранить изменения'}
                </button>
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Grid House variant — Vignelli × Bierut
// ═══════════════════════════════════════════════════════════════════════════

const GHP_HAIRLINE = `1px solid ${GH.ink10}`;
const GHP_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

function GridHouseCrmProfile({
    profile,
    loading,
    saving,
    setProfile,
    newSpec,
    setNewSpec,
    onSave,
    onAddSpec,
    onRemoveSpec,
    onToggleFormat,
}: {
    profile: ProfileData | null;
    loading: boolean;
    saving: boolean;
    setProfile: React.Dispatch<React.SetStateAction<ProfileData | null>>;
    newSpec: string;
    setNewSpec: (v: string) => void;
    onSave: () => Promise<void>;
    onAddSpec: (v: string) => void;
    onRemoveSpec: (s: string) => void;
    onToggleFormat: (f: string) => void;
}) {
    if (loading) {
        return (
            <div style={{ fontFamily: GH_SANS, color: GH.ink, padding: '120px 0', textAlign: 'center', ...GHP_MONO_LABEL }}>
                Загрузка анкеты…
            </div>
        );
    }

    if (!profile) {
        return (
            <div style={{ fontFamily: GH_SANS, color: GH.ink, padding: '120px 24px', textAlign: 'center', borderTop: `2px solid ${GH.ink}`, borderBottom: GHP_HAIRLINE }}>
                <div style={{ ...GHP_MONO_LABEL, marginBottom: 14 }}>→ Ошибка</div>
                <h2
                    style={{
                        fontFamily: GH_SANS,
                        fontWeight: 800,
                        fontSize: 'clamp(28px, 3.5vw, 44px)',
                        lineHeight: 0.95,
                        letterSpacing: '-0.02em',
                        margin: 0,
                        marginBottom: 10,
                    }}
                >
                    Анкета не найдена.
                </h2>
                <div style={{ ...GHP_MONO_LABEL, color: GH.ink60 }}>
                    Обратитесь к администратору для создания анкеты
                </div>
            </div>
        );
    }

    const saveBtnStyle: React.CSSProperties = {
        background: GH.ink,
        color: GH.paper,
        fontFamily: GH_MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '14px 22px',
        border: 'none',
        cursor: saving ? 'default' : 'pointer',
        opacity: saving ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '10px 0',
        border: 'none',
        borderBottom: `2px solid ${GH.ink}`,
        outline: 'none',
        background: 'transparent',
        fontFamily: GH_SANS,
        fontSize: 16,
        color: GH.ink,
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, maxWidth: 760 }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: GHP_HAIRLINE, paddingBottom: 28, marginBottom: 36 }}>
                <div style={{ ...GHP_MONO_LABEL, marginBottom: 14 }}>Раздел · Моя анкета</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
                    <h1
                        style={{
                            fontFamily: GH_SANS,
                            fontWeight: 800,
                            fontSize: 'clamp(36px, 4.5vw, 56px)',
                            lineHeight: 0.95,
                            letterSpacing: '-0.02em',
                            margin: 0,
                        }}
                    >
                        {profile.firstName} {profile.lastName}.
                    </h1>
                    <button onClick={onSave} disabled={saving} style={saveBtnStyle}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        {saving ? 'Сохраняю' : 'Сохранить'}
                    </button>
                </div>
                <div style={{ ...GHP_MONO_LABEL, marginTop: 10 }}>
                    Публичный профиль в каталоге
                </div>
            </div>

            {/* ── Section 01 · Основное ── */}
            <GHPSection num={1} title="Основное">
                <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 24, marginBottom: 24 }}>
                    {/* Photo square */}
                    <div style={{ width: 120, height: 120, border: `2px solid ${GH.ink}`, background: GH.paper, position: 'relative', overflow: 'hidden' }}>
                        {profile.photoUrl ? (
                            <img src={profile.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
                                    fontSize: 60,
                                    lineHeight: 1,
                                    letterSpacing: '-0.04em',
                                    color: GH.ink,
                                }}
                            >
                                {profile.firstName?.[0]}{profile.lastName?.[0]}
                            </div>
                        )}
                    </div>

                    <div>
                        <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>URL фото</div>
                        <input
                            type="url"
                            value={profile.photoUrl ?? ''}
                            onChange={(e) => setProfile((p) => (p ? { ...p, photoUrl: e.target.value } : p))}
                            placeholder="https://..."
                            style={inputStyle}
                        />
                        <div style={{ ...GHP_MONO_LABEL, color: GH.ink30, marginTop: 8 }}>
                            Прямая ссылка на изображение · jpg, png
                        </div>
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                    <div>
                        <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Имя</div>
                        <input
                            type="text"
                            value={profile.firstName}
                            onChange={(e) => setProfile((p) => (p ? { ...p, firstName: e.target.value } : p))}
                            style={inputStyle}
                        />
                    </div>
                    <div>
                        <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Фамилия</div>
                        <input
                            type="text"
                            value={profile.lastName}
                            onChange={(e) => setProfile((p) => (p ? { ...p, lastName: e.target.value } : p))}
                            style={inputStyle}
                        />
                    </div>
                </div>

                <div>
                    <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Короткое описание · tagline</div>
                    <input
                        type="text"
                        value={profile.tagline}
                        onChange={(e) => setProfile((p) => (p ? { ...p, tagline: e.target.value } : p))}
                        maxLength={150}
                        placeholder="Психолог · КПТ · 5 лет практики"
                        style={inputStyle}
                    />
                    <div style={{ ...GHP_MONO_LABEL, color: GH.ink30, marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                        {String(profile.tagline.length).padStart(3, '0')} / 150
                    </div>
                </div>
            </GHPSection>

            {/* ── Section 02 · О себе ── */}
            <GHPSection num={2} title="О себе">
                <textarea
                    value={profile.bio}
                    onChange={(e) => setProfile((p) => (p ? { ...p, bio: e.target.value } : p))}
                    rows={7}
                    placeholder="Ваш подход, образование, опыт работы…"
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: GH_SANS, lineHeight: 1.55 }}
                />
            </GHPSection>

            {/* ── Section 03 · Специализации ── */}
            <GHPSection num={3} title="Специализации">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20, minHeight: 32 }}>
                    {profile.specializations.map((spec) => (
                        <span
                            key={spec}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 8,
                                fontFamily: GH_MONO,
                                fontSize: 11,
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                color: GH.paper,
                                background: GH.ink,
                                padding: '6px 10px',
                            }}
                        >
                            {spec}
                            <button
                                onClick={() => onRemoveSpec(spec)}
                                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.paper, padding: 0, display: 'flex' }}
                                aria-label={`Убрать ${spec}`}
                            >
                                <X size={11} />
                            </button>
                        </span>
                    ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 20 }}>
                    <input
                        type="text"
                        value={newSpec}
                        onChange={(e) => setNewSpec(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                onAddSpec(newSpec);
                            }
                        }}
                        placeholder="Добавить…"
                        style={inputStyle}
                    />
                    <button
                        onClick={() => onAddSpec(newSpec)}
                        disabled={!newSpec.trim()}
                        style={{
                            fontFamily: GH_MONO,
                            fontSize: 11,
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            padding: '10px 18px',
                            background: 'transparent',
                            color: GH.ink,
                            border: `1px solid ${GH.ink}`,
                            cursor: newSpec.trim() ? 'pointer' : 'default',
                            opacity: newSpec.trim() ? 1 : 0.3,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <Plus size={14} /> Добавить
                    </button>
                </div>

                <div style={{ borderTop: GHP_HAIRLINE, paddingTop: 16 }}>
                    <div style={{ ...GHP_MONO_LABEL, marginBottom: 10 }}>→ Быстрый выбор</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {SPECIALIZATION_SUGGESTIONS.filter((s) => !profile.specializations.includes(s)).map((s) => (
                            <button
                                key={s}
                                onClick={() => onAddSpec(s)}
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 10,
                                    letterSpacing: '0.08em',
                                    textTransform: 'uppercase',
                                    color: GH.ink60,
                                    background: 'transparent',
                                    border: `1px solid ${GH.ink10}`,
                                    padding: '5px 9px',
                                    cursor: 'pointer',
                                    transition: 'all 120ms',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = GH.ink;
                                    e.currentTarget.style.color = GH.ink;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = GH.ink10;
                                    e.currentTarget.style.color = GH.ink60;
                                }}
                            >
                                + {s}
                            </button>
                        ))}
                    </div>
                </div>
            </GHPSection>

            {/* ── Section 04 · Формат и стоимость ── */}
            <GHPSection num={4} title="Формат и стоимость">
                <div style={{ marginBottom: 28 }}>
                    <div style={{ ...GHP_MONO_LABEL, marginBottom: 12 }}>Формат работы</div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        {FORMAT_OPTIONS.map((opt) => {
                            const active = profile.formats.includes(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    onClick={() => onToggleFormat(opt.value)}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 11,
                                        letterSpacing: '0.12em',
                                        textTransform: 'uppercase',
                                        padding: '12px 20px',
                                        background: active ? GH.ink : 'transparent',
                                        color: active ? GH.paper : GH.ink,
                                        border: `1px solid ${GH.ink}`,
                                        cursor: 'pointer',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 10,
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 10,
                                            height: 10,
                                            border: `1px solid ${active ? GH.paper : GH.ink}`,
                                            background: active ? GH.paper : 'transparent',
                                        }}
                                    />
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div>
                    <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Базовая стоимость · ₾</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8, maxWidth: 240 }}>
                        <input
                            type="number"
                            value={profile.basePriceGel}
                            onChange={(e) => setProfile((p) => (p ? { ...p, basePriceGel: Number(e.target.value) } : p))}
                            min={0}
                            step={5}
                            style={{
                                flex: 1,
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontFamily: GH_SANS,
                                fontWeight: 700,
                                fontSize: 32,
                                letterSpacing: '-0.02em',
                                color: GH.ink,
                                fontVariantNumeric: 'tabular-nums',
                                padding: 0,
                            }}
                        />
                        <span style={{ fontFamily: GH_MONO, fontSize: 14, color: GH.ink60, letterSpacing: '0.1em' }}>
                            GEL
                        </span>
                    </div>
                </div>
            </GHPSection>

            {/* ── Bottom save ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 24, paddingBottom: 40, borderTop: GHP_HAIRLINE, marginTop: 36 }}>
                <button onClick={onSave} disabled={saving} style={saveBtnStyle}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {saving ? 'Сохраняю' : 'Сохранить изменения'}
                </button>
            </div>
        </div>
    );
}

function GHPSection({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 40, paddingBottom: 40, borderBottom: GHP_HAIRLINE }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20, marginBottom: 24 }}>
                <div style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.1em', color: GH.ink60, fontVariantNumeric: 'tabular-nums', paddingTop: 6 }}>
                    {String(num).padStart(2, '0')}
                </div>
                <h2
                    style={{
                        fontFamily: GH_SANS,
                        fontWeight: 700,
                        fontSize: 22,
                        letterSpacing: '-0.01em',
                        color: GH.ink,
                        margin: 0,
                    }}
                >
                    {title}
                </h2>
            </div>
            <div style={{ paddingLeft: 80 }}>{children}</div>
        </section>
    );
}
