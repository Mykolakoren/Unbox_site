import { useEffect, useRef, useState } from 'react';
import { Upload, Save, X, Plane, CalendarClock, ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { api, API_URL } from '../../../api/client';
import { compressImage } from '../../../utils/imageCompress';
import { useUserStore } from '../../../store/userStore';
import { usersApi } from '../../../api/users';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { Input, TextArea } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { formatDayMonth } from '../../../utils/format';

/**
 * Mobile CRM — specialist's own public profile editor.
 *
 * Mirrors the desktop /crm/profile (GET/PATCH /specialists/me) but in the
 * mobile workspace's visual language. Built 2026-05-22 so specialists can
 * upload a photo / edit their card from a phone — previously the only
 * editor was the desktop page.
 *
 * Wave 1: общие поля (Input/TextArea, 44 px, подпись для диктора), форматы —
 * Chip, кнопки — Button; крестик специализации — зона 44 px (был 13 px);
 * даты отпуска — «до 5 октября», а не «до 2026-10-05».
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
    sessionDurationMin: number;
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

    if (loading) {
        return (
            <div role="status" aria-busy="true" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <span className="sr-only">Загружаем анкету…</span>
                <Skeleton height={28} width="50%" />
                <Skeleton height={64} radius={14} />
                <Skeleton height={120} radius={14} />
                <Skeleton height={120} radius={14} />
            </div>
        );
    }
    if (!profile) {
        return (
            <div style={{ padding: 16 }}>
                <EmptyState
                    compact
                    title="Анкета не найдена"
                    hint="Если вы недавно подали заявку — анкета появится после подтверждения администратором."
                />
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
                <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                    Моя анкета
                </h1>
                <p style={{ fontSize: 14, color: 'var(--color-ink-60)', marginTop: 4 }}>
                    Так вас видят клиенты в каталоге специалистов.
                </p>
            </div>

            {/* Вход в расписание с телефона: без часов приёма клиенты не
                могут записаться к специалисту на сайте. */}
            <div style={{ padding: '0 16px' }}>
                <Link
                    to="/m/crm/schedule"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        background: 'var(--color-ink)', color: 'var(--color-on-ink)',
                        borderRadius: 14, padding: '14px 14px',
                        textDecoration: 'none',
                    }}
                >
                    <CalendarClock size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>Часы приёма</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-on-ink)', opacity: 0.8, marginTop: 2 }}>
                            Клиенты записываются к вам на сайте только в эти часы
                        </span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                </Link>
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
                            background: 'var(--color-sunken)', display: 'grid', placeItems: 'center',
                            fontWeight: 600, fontSize: 20, color: 'var(--color-ink-60)',
                        }}>
                            {(profile.firstName[0] || '') + (profile.lastName[0] || '')}
                        </div>
                    )}
                    <PhotoUpload onUploaded={(url) => set('photoUrl', url)} hasPhoto={!!profile.photoUrl} />
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 6 }}>jpg, png · до 2 МБ</div>
            </Section>

            {/* Name */}
            <Section title="Имя и фамилия">
                <div style={{ display: 'flex', gap: 8 }}>
                    <Input
                        kind="name"
                        aria-label="Имя"
                        value={profile.firstName}
                        onChange={e => set('firstName', e.target.value)}
                        placeholder="Имя"
                    />
                    <Input
                        kind="name"
                        aria-label="Фамилия"
                        value={profile.lastName}
                        onChange={e => set('lastName', e.target.value)}
                        placeholder="Фамилия"
                    />
                </div>
            </Section>

            {/* Tagline */}
            <Section title="Слоган (одна строка)">
                <Input
                    aria-label="Слоган"
                    value={profile.tagline}
                    onChange={e => set('tagline', e.target.value)}
                    placeholder="Гештальт-терапевт. Тревога, выгорание."
                    maxLength={150}
                />
            </Section>

            {/* Bio */}
            <Section title="О себе">
                <TextArea
                    aria-label="О себе"
                    value={profile.bio}
                    onChange={e => set('bio', e.target.value)}
                    placeholder="Образование, подход, опыт, с чем работаете…"
                    rows={6}
                    maxLength={5000}
                    style={{ minHeight: 120 }}
                />
            </Section>

            {/* Base price */}
            <Section title="Базовая цена сессии">
                <Input
                    kind="integer"
                    suffix="₾"
                    aria-label="Базовая цена сессии, лари"
                    value={profile.basePriceGel || ''}
                    onChange={e => set('basePriceGel', parseInt(e.target.value) || 0)}
                    placeholder="100"
                />
            </Section>

            {/* Session duration — показывается в шапке профиля на сайте */}
            <Section title="Длительность консультации">
                <Input
                    kind="integer"
                    suffix="мин"
                    aria-label="Длительность консультации, минут"
                    value={profile.sessionDurationMin ?? 50}
                    onChange={e => set('sessionDurationMin', parseInt(e.target.value) || 50)}
                    placeholder="50"
                />
            </Section>

            {/* Formats */}
            <Section title="Формат работы">
                <div role="group" aria-label="Формат работы" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {FORMAT_OPTIONS.map(f => (
                        <Chip
                            key={f.id}
                            selected={profile.formats.includes(f.id)}
                            onClick={() => toggleFormat(f.id)}
                        >
                            {f.label}
                        </Chip>
                    ))}
                </div>
            </Section>

            {/* Specializations */}
            <Section title="Специализации">
                <div style={{ display: 'flex', gap: 6 }}>
                    <Input
                        aria-label="Новая специализация"
                        value={specInput}
                        onChange={e => setSpecInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                        placeholder="Тревога"
                    />
                    <Button
                        variant="secondary"
                        icon={<Plus size={18} aria-hidden="true" />}
                        aria-label="Добавить специализацию"
                        onClick={addSpec}
                        style={{ flexShrink: 0 }}
                    />
                </div>
                {profile.specializations.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        {profile.specializations.map(s => (
                            <span key={s} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 0,
                                background: 'var(--color-sunken)', borderRadius: 8,
                                padding: '0 0 0 12px', fontSize: 14, fontWeight: 500,
                                minHeight: 44,
                            }}>
                                {s}
                                <button
                                    onClick={() => removeSpec(s)}
                                    style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        width: 44, height: 44, display: 'grid', placeItems: 'center',
                                        color: 'var(--color-ink-60)',
                                    }}
                                    aria-label={`Убрать ${s}`}
                                >
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </span>
                        ))}
                    </div>
                )}
            </Section>

            <VacationSection />

            {/* Save — sticky-ish at bottom of content */}
            <div style={{ padding: '8px 16px 0' }}>
                <Button
                    block
                    loading={saving}
                    icon={<Save size={16} aria-hidden="true" />}
                    onClick={save}
                >
                    Сохранить анкету
                </Button>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8,
            }}>{title}</div>
            <div style={{
                background: 'var(--color-card)', border: '1px solid var(--color-ink-08)',
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
            toast.success('Фото загружено — не забудьте сохранить анкету');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить фото. Попробуйте ещё раз');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} style={{ display: 'none' }} />
            <Button
                variant="secondary"
                loading={busy}
                icon={<Upload size={16} aria-hidden="true" />}
                onClick={() => inputRef.current?.click()}
                style={{ flex: 1 }}
            >
                {busy ? 'Загружаем…' : hasPhoto ? 'Заменить фото' : 'Загрузить фото'}
            </Button>
        </>
    );
}

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
            toast.success(newDate ? `Отпуск отмечен до ${formatDayMonth(newDate, { withYear: 'auto' })}` : 'Отпуск снят');
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось сохранить отпуск. Попробуйте ещё раз');
        } finally {
            setBusy(false);
        }
    };

    const isActive = !!vacUntil && new Date(vacUntil) >= new Date(new Date().toDateString());

    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <Plane size={12} aria-hidden="true" /> Отпуск или отъезд
            </div>
            <div style={{
                background: isActive ? 'var(--status-pending-bg)' : 'var(--color-card)',
                border: '1px solid var(--color-ink-08)',
                borderRadius: 14,
                padding: 14,
            }}>
                {isActive ? (
                    <div style={{ fontSize: 14, color: 'var(--status-pending-fg)', marginBottom: 10 }}>
                        Сейчас отмечено: «не принимаю клиентов до <b>{formatDayMonth(vacUntil!, { withYear: 'auto' })}</b>».
                        В этот период на экране «Сегодня» виден баннер, ваша анкета помечена.
                    </div>
                ) : (
                    <div style={{ fontSize: 14, color: 'var(--color-ink-60)', marginBottom: 10 }}>
                        Поставьте дату возвращения — на «Сегодня» появится баннер,
                        админам будет видно, что вас нет, и они не подсунут вам
                        горячую бронь.
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                        kind="date"
                        aria-label="Дата возвращения"
                        value={date}
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={e => setDate(e.target.value)}
                        style={{ flex: 1 }}
                    />
                    <Button
                        variant="secondary"
                        loading={busy}
                        disabled={!date || date === vacUntil}
                        onClick={() => save(date || null)}
                        style={{ flexShrink: 0 }}
                    >
                        Сохранить
                    </Button>
                    {isActive && (
                        <Button
                            variant="quiet"
                            disabled={busy}
                            icon={<X size={18} aria-hidden="true" />}
                            aria-label="Снять отпуск"
                            onClick={() => save(null)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
