import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Save, X, Plane } from 'lucide-react';
import { toast } from 'sonner';
import { api, API_URL } from '../../../api/client';
import { compressImage } from '../../../utils/imageCompress';
import { useUserStore } from '../../../store/userStore';
import { usersApi } from '../../../api/users';

/**
 * Mobile CRM — specialist's own public profile editor.
 *
 * Mirrors the desktop /crm/profile (GET/PATCH /specialists/me) but in the
 * mobile workspace's visual language. Built 2026-05-22 so specialists can
 * upload a photo / edit their card from a phone — previously the only
 * editor was the desktop page.
 */
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

const FORMAT_OPTIONS = [
    { id: 'ONLINE', label: 'Онлайн' },
    { id: 'OFFLINE_UNBOX_ONE', label: 'Unbox One' },
    { id: 'OFFLINE_UNBOX_UNI', label: 'Unbox Uni' },
    { id: 'OFFLINE_NEO_SCHOOL', label: 'Neo School' },
];

export function MobileCrmProfile() {
    const [profile, setProfile] = useState<ProfileData | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [specInput, setSpecInput] = useState('');

    useEffect(() => {
        api.get('/specialists/me')
            .then(r => setProfile(r.data))
            .catch(() => toast.error('Не удалось загрузить анкету'))
            .finally(() => setLoading(false));
    }, []);

    const save = async () => {
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

    if (loading) {
        return <div style={{ padding: 32, textAlign: 'center', color: '#999', fontSize: 14 }}>Загрузка…</div>;
    }
    if (!profile) {
        return (
            <div style={{ padding: 24, fontSize: 14, color: '#666' }}>
                Анкета не найдена. Если вы недавно подали заявку — она появится
                после подтверждения админом.
            </div>
        );
    }

    const set = <K extends keyof ProfileData>(key: K, val: ProfileData[K]) =>
        setProfile(p => (p ? { ...p, [key]: val } : p));

    const addSpec = () => {
        const v = specInput.trim();
        if (!v || profile.specializations.includes(v)) { setSpecInput(''); return; }
        set('specializations', [...profile.specializations, v]);
        setSpecInput('');
    };
    const removeSpec = (s: string) =>
        set('specializations', profile.specializations.filter(x => x !== s));
    const toggleFormat = (f: string) =>
        set('formats', profile.formats.includes(f)
            ? profile.formats.filter(x => x !== f)
            : [...profile.formats, f]);

    return (
        <div style={{ paddingTop: 16, paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ padding: '0 16px' }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                    Моя анкета
                </h1>
                <p style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                    Так вас видят клиенты в каталоге специалистов.
                </p>
            </div>

            {/* Photo */}
            <Section title="Фото профиля">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {profile.photoUrl ? (
                        <img
                            src={profile.photoUrl}
                            alt=""
                            style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, flexShrink: 0 }}
                        />
                    ) : (
                        <div style={{
                            width: 64, height: 64, borderRadius: 12, flexShrink: 0,
                            background: '#F4F4F2', display: 'grid', placeItems: 'center',
                            fontWeight: 700, fontSize: 20, color: '#999',
                        }}>
                            {(profile.firstName[0] || '') + (profile.lastName[0] || '')}
                        </div>
                    )}
                    <PhotoUpload onUploaded={(url) => set('photoUrl', url)} hasPhoto={!!profile.photoUrl} />
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>jpg, png · до 2 МБ</div>
            </Section>

            {/* Name */}
            <Section title="Имя и фамилия">
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        value={profile.firstName}
                        onChange={e => set('firstName', e.target.value)}
                        placeholder="Имя"
                        style={inputStyle}
                    />
                    <input
                        value={profile.lastName}
                        onChange={e => set('lastName', e.target.value)}
                        placeholder="Фамилия"
                        style={inputStyle}
                    />
                </div>
            </Section>

            {/* Tagline */}
            <Section title="Слоган (одна строка)">
                <input
                    value={profile.tagline}
                    onChange={e => set('tagline', e.target.value)}
                    placeholder="Гештальт-терапевт. Тревога, выгорание."
                    maxLength={150}
                    style={inputStyle}
                />
            </Section>

            {/* Bio */}
            <Section title="О себе">
                <textarea
                    value={profile.bio}
                    onChange={e => set('bio', e.target.value)}
                    placeholder="Образование, подход, опыт, с чем работаете…"
                    rows={6}
                    maxLength={5000}
                    style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }}
                />
            </Section>

            {/* Base price */}
            <Section title="Базовая цена сессии, ₾">
                <input
                    type="number"
                    inputMode="numeric"
                    value={profile.basePriceGel || ''}
                    onChange={e => set('basePriceGel', parseInt(e.target.value) || 0)}
                    placeholder="100"
                    style={inputStyle}
                />
            </Section>

            {/* Formats */}
            <Section title="Формат работы">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FORMAT_OPTIONS.map(f => {
                        const active = profile.formats.includes(f.id);
                        return (
                            <button
                                key={f.id}
                                onClick={() => toggleFormat(f.id)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: 10,
                                    border: active ? 'none' : '1px solid rgba(0,0,0,0.12)',
                                    background: active ? '#0E0E0E' : '#fff',
                                    color: active ? '#fff' : '#0E0E0E',
                                    fontSize: 13, fontWeight: 600,
                                    fontFamily: 'inherit', cursor: 'pointer',
                                }}
                            >
                                {f.label}
                            </button>
                        );
                    })}
                </div>
            </Section>

            {/* Specializations */}
            <Section title="Специализации">
                <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        value={specInput}
                        onChange={e => setSpecInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                        placeholder="Тревога"
                        style={inputStyle}
                    />
                    <button onClick={addSpec} style={{
                        background: '#0E0E0E', color: '#fff', border: 'none',
                        borderRadius: 10, padding: '0 16px', fontWeight: 700,
                        fontFamily: 'inherit', cursor: 'pointer', flexShrink: 0,
                    }}>+</button>
                </div>
                {profile.specializations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {profile.specializations.map(s => (
                            <span key={s} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                background: '#F4F4F2', borderRadius: 999,
                                padding: '4px 8px 4px 10px', fontSize: 12, fontWeight: 600,
                            }}>
                                {s}
                                <button
                                    onClick={() => removeSpec(s)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#999' }}
                                    aria-label={`Убрать ${s}`}
                                >
                                    <X size={13} />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </Section>

            <VacationSection />

            {/* Save — sticky-ish at bottom of content */}
            <div style={{ padding: '8px 16px 0' }}>
                <button
                    onClick={save}
                    disabled={saving}
                    style={{
                        width: '100%', background: '#0E0E0E', color: '#fff',
                        border: 'none', borderRadius: 12, padding: '15px',
                        fontSize: 15, fontWeight: 700, fontFamily: 'inherit',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                    }}
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {saving ? 'Сохраняем…' : 'Сохранить анкету'}
                </button>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.10em',
                textTransform: 'uppercase', color: '#999', marginBottom: 8,
            }}>{title}</div>
            <div style={{
                background: '#fff', border: '1px solid rgba(0,0,0,0.08)',
                borderRadius: 14, padding: 14,
            }}>
                {children}
            </div>
        </div>
    );
}

function PhotoUpload({ onUploaded, hasPhoto }: { onUploaded: (url: string) => void; hasPhoto: boolean }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const upload = await compressImage(file);
            if (upload.size > 2 * 1024 * 1024) {
                toast.error('Фото слишком большое даже после сжатия — попробуйте другое');
                return;
            }
            const data = new FormData();
            data.append('file', upload);
            const res = await api.post<{ url: string }>('/upload/', data, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Фото загружено — не забудьте «Сохранить»');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} style={{ display: 'none' }} />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                style={{
                    flex: 1, background: '#0E0E0E', color: '#fff', border: 'none',
                    borderRadius: 10, padding: '12px 14px', fontWeight: 700, fontSize: 13,
                    fontFamily: 'inherit', cursor: busy ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    opacity: busy ? 0.7 : 1,
                }}
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy ? 'Загружаем…' : hasPhoto ? 'Заменить фото' : 'Загрузить фото'}
            </button>
        </>
    );
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 12px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 10,
    fontSize: 14,
    fontFamily: 'inherit',
    background: '#fff',
    color: '#0E0E0E',
    boxSizing: 'border-box',
};

/** "Я в отпуске до ..." — sets crm_data.vacation_until on the User row.
 *  Specialist's Today screen shows a banner when active so the specialist
 *  (and any admin glancing at their card) sees the absence clearly.
 *  Auto-blocking new bookings is a separate backend change — left as TODO. */
function VacationSection() {
    const { currentUser, fetchCurrentUser } = useUserStore();
    const vacUntil: string | null = (currentUser as any)?.crmData?.vacationUntil
        ?? (currentUser as any)?.crm_data?.vacation_until
        ?? null;
    const [date, setDate] = useState<string>(vacUntil || '');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        setDate(vacUntil || '');
    }, [vacUntil]);

    const save = async (newDate: string | null) => {
        setBusy(true);
        try {
            await usersApi.setVacation(newDate);
            await fetchCurrentUser();
            toast.success(newDate ? `Установлен отпуск до ${newDate}` : 'Отпуск снят');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось обновить');
        } finally {
            setBusy(false);
        }
    };

    const isActive = !!vacUntil && new Date(vacUntil) >= new Date(new Date().toDateString());

    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.10em',
                textTransform: 'uppercase', color: '#999', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <Plane size={11} /> Отпуск / отъезд
            </div>
            <div style={{
                background: isActive ? 'rgba(255,138,76,0.10)' : '#fff',
                border: isActive ? '1px solid rgba(255,138,76,0.40)' : '1px solid rgba(0,0,0,0.08)',
                borderRadius: 14,
                padding: 14,
            }}>
                {isActive ? (
                    <div style={{ fontSize: 13, color: '#C66019', marginBottom: 10 }}>
                        Сейчас отмечено: «не принимаю клиентов до <b>{vacUntil}</b>».
                        В этот период баннер виден на Today, ваша анкета помечена.
                    </div>
                ) : (
                    <div style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>
                        Поставьте дату возвращения — на «Сегодня» появится баннер,
                        админам будет видно, что вас нет, и они не подсунут вам
                        горячую бронь.
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="date"
                        value={date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={e => setDate(e.target.value)}
                        style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                        onClick={() => save(date || null)}
                        disabled={busy || !date || date === vacUntil}
                        style={{
                            padding: '11px 14px',
                            background: '#0E0E0E', color: '#fff',
                            border: 'none', borderRadius: 10,
                            fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
                            cursor: busy ? 'wait' : (date && date !== vacUntil) ? 'pointer' : 'not-allowed',
                            opacity: !date || date === vacUntil ? 0.5 : 1,
                        }}
                    >
                        {busy ? <Loader2 size={14} className="animate-spin" /> : 'Сохранить'}
                    </button>
                    {isActive && (
                        <button
                            onClick={() => save(null)}
                            disabled={busy}
                            style={{
                                padding: '11px',
                                background: 'rgba(0,0,0,0.05)',
                                color: '#0E0E0E',
                                border: 'none', borderRadius: 10,
                                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                                cursor: 'pointer',
                            }}
                            title="Снять отпуск"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
