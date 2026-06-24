import { useEffect, useRef, useState } from 'react';
import { api, API_URL } from '../../api/client';
import { toast } from 'sonner';
import { Loader2, Save, Plus, X, Upload } from 'lucide-react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { compressImage } from '../../utils/imageCompress';

const SPECIALIZATION_SUGGESTIONS = [
    'Тревога', 'Депрессия', 'Отношения', 'Самооценка', 'Стресс', 'Горе и утрата',
    'Травма и ПТСР', 'Панические атаки', 'ОКР', 'Расстройства пищевого поведения',
    'Зависимости', 'Кризисные состояния', 'Семейные конфликты', 'Детско-родительские отношения',
    'Личностный рост', 'Профессиональное выгорание', 'Сексуальность', 'Возрастные кризисы',
];

/** Single source of truth for format/location flags stored in
 *  Specialist.formats (JSON list of strings).
 *  - ONLINE                — works online.
 *  - OFFLINE_UNBOX_ONE     — works in Unbox One (Палиашвили 4).
 *  - OFFLINE_UNBOX_UNI     — works in Unbox Uni (Тбел Абусеридзе 38).
 *  - OFFLINE_NEO_SCHOOL    — works in Neo School (Сулаберидзе 80).
 *  Legacy values (OFFLINE, OFFLINE_ROOM, OFFLINE_CAPSULE) are treated as
 *  "OFFLINE without specific location" — interpreted at render time as
 *  "in any Unbox center" until the specialist edits and saves. */
const ONLINE_FLAG = 'ONLINE';
const OFFLINE_LEGACY = ['OFFLINE', 'OFFLINE_ROOM', 'OFFLINE_CAPSULE'];
const LOCATION_OPTIONS = [
    { value: 'OFFLINE_UNBOX_ONE',  id: 'unbox_one',  label: 'Unbox One',  address: 'Палиашвили 4' },
    { value: 'OFFLINE_UNBOX_UNI',  id: 'unbox_uni',  label: 'Unbox Uni',  address: 'Тбел Абусеридзе 38' },
    { value: 'OFFLINE_NEO_SCHOOL', id: 'neo_school', label: 'Neo School', address: 'Сулаберидзе 80' },
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
    sessionDurationMin: number;
}

export function CrmProfile() {
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
                sessionDurationMin: profile.sessionDurationMin,
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
                        <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Фото профиля</div>
                        <PhotoUpload
                            onUploaded={(url) => setProfile((p) => (p ? { ...p, photoUrl: url } : p))}
                        />
                        <div style={{ ...GHP_MONO_LABEL, color: GH.ink30, marginTop: 8 }}>
                            jpg, png · до 2 МБ
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

                    {/* Onlne checkbox */}
                    <FormatCheckbox
                        checked={profile.formats.includes(ONLINE_FLAG)}
                        onToggle={() => onToggleFormat(ONLINE_FLAG)}
                        label="Онлайн"
                        sub="Сессии через видеосвязь"
                    />

                    {/* Center checkboxes */}
                    <div style={{ ...GHP_MONO_LABEL, marginTop: 24, marginBottom: 10 }}>Очно — в каких центрах</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {LOCATION_OPTIONS.map((loc) => (
                            <FormatCheckbox
                                key={loc.value}
                                checked={profile.formats.includes(loc.value)}
                                onToggle={() => onToggleFormat(loc.value)}
                                label={loc.label}
                                sub={loc.address}
                            />
                        ))}
                    </div>

                    {/* Live preview — same text the public profile will show */}
                    <FormatPreview formats={profile.formats} />
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

                <div>
                    <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Длительность консультации · мин</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8, maxWidth: 240 }}>
                        <input
                            type="number"
                            value={profile.sessionDurationMin ?? 50}
                            onChange={(e) => setProfile((p) => (p ? { ...p, sessionDurationMin: Number(e.target.value) } : p))}
                            min={15}
                            max={240}
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
                            МИН
                        </span>
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 6 }}>
                        Показывается в шапке вашего профиля на сайте.
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

// ── Format / location checkbox row (Vignelli-flat, full-width) ─────────
function FormatCheckbox({
    checked, onToggle, label, sub,
}: { checked: boolean; onToggle: () => void; label: string; sub?: string }) {
    return (
        <button
            type="button"
            onClick={onToggle}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                padding: '12px 16px',
                background: checked ? GH.ink5 : 'transparent',
                border: `1px solid ${checked ? GH.ink : GH.ink10}`,
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
                fontFamily: GH_SANS,
                color: GH.ink,
                transition: 'background 120ms, border-color 120ms',
            }}
            aria-pressed={checked}
        >
            <span
                aria-hidden
                style={{
                    width: 18, height: 18,
                    flex: '0 0 18px',
                    border: `1.5px solid ${checked ? GH.ink : GH.ink30}`,
                    background: checked ? GH.ink : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center',
                }}
            >
                {checked && (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                        stroke={GH.paper} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                )}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
                {sub && (
                    <span style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: GH.ink60 }}>
                        {sub}
                    </span>
                )}
            </span>
        </button>
    );
}

// ── Live preview "Ведёт приём…" — same text the public profile renders ──
function FormatPreview({ formats }: { formats: string[] }) {
    const has = (v: string) => formats.includes(v);
    const online = has(ONLINE_FLAG);
    const centers = LOCATION_OPTIONS.filter(loc => has(loc.value));
    const legacyOffline = !centers.length && OFFLINE_LEGACY.some(has);

    if (!online && !centers.length && !legacyOffline) {
        return (
            <div style={{
                marginTop: 16,
                padding: '12px 16px',
                background: GH.ink5,
                fontFamily: GH_SANS,
                fontSize: 13,
                color: GH.ink60,
                fontStyle: 'italic',
            }}>
                Отметь хотя бы один формат — клиенты увидят, как с тобой можно работать.
            </div>
        );
    }

    const parts: React.ReactNode[] = [];
    if (online) parts.push(<span key="on">онлайн</span>);
    if (centers.length) {
        parts.push(
            <span key="off">
                {online ? 'и ' : ''}очно в&nbsp;
                {centers.map((loc, i) => (
                    <span key={loc.id}>
                        <a
                            href={`/location/${loc.id}`}
                            target="_blank" rel="noopener noreferrer"
                            style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                            {loc.label}
                        </a>
                        {i < centers.length - 1 ? ', ' : ''}
                    </span>
                ))}
            </span>
        );
    } else if (legacyOffline) {
        parts.push(<span key="legacy">{online ? 'и ' : ''}очно <em style={{ color: GH.ink60 }}>(уточни конкретные центры выше)</em></span>);
    }

    return (
        <div style={{
            marginTop: 16,
            padding: '14px 16px',
            background: GH.ink5,
            border: `1px solid ${GH.ink10}`,
            fontFamily: GH_SANS,
            fontSize: 14,
            lineHeight: 1.5,
            color: GH.ink,
        }}>
            <div style={{ ...GHP_MONO_LABEL, marginBottom: 6 }}>Так клиенты увидят формат</div>
            Ведёт приём{' '}{parts.flatMap((p, i) => i === 0 ? [p] : [' ', p])}.
        </div>
    );
}


/** File-pick → POST /upload → return absolute URL.
 *
 * Backend response is a relative path (/uploads/<uuid>.jpg). We expand it to
 * an absolute URL so the saved photoUrl works regardless of where the asset
 * is later loaded from (admin marketplace lists the URL in <img src>).
 */
function PhotoUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);

    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            // Downscale + re-encode to JPEG so PNG phone photos don't blow
            // past the 2 MB cap. Server still guards 2 MB as a backstop.
            const upload = await compressImage(file);
            if (upload.size > 2 * 1024 * 1024) {
                toast.error('Фото слишком большое даже после сжатия — попробуйте другое.');
                return;
            }
            const data = new FormData();
            data.append('file', upload);
            const res = await api.post<{ url: string }>('/upload/', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            const fullUrl = `${baseUrl}${res.data.url}`;
            onUploaded(fullUrl);
            toast.success('Фото загружено — не забудьте сохранить профиль');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить фото');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };

    return (
        <>
            <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={handlePick}
                style={{ display: 'none' }}
            />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                style={{
                    width: '100%',
                    padding: '12px 14px',
                    background: GH.ink,
                    color: GH.paper,
                    border: 'none',
                    fontFamily: GH_SANS,
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: busy ? 'wait' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    opacity: busy ? 0.7 : 1,
                }}
            >
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {busy ? 'Загружаем…' : 'Загрузить с устройства'}
            </button>
        </>
    );
}
