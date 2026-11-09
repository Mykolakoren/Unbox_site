import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Save, X, Plane, CalendarClock, ChevronRight, Plus, User } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { api, API_URL } from '../../../api/client';
import { compressImage } from '../../../utils/imageCompress';
import { useUserStore } from '../../../store/userStore';
import { usersApi } from '../../../api/users';
import { Button } from '../../../components/ui/Button';
import { Chip } from '../../../components/ui/Chip';
import { Field, Input, TextArea } from '../../../components/ui/Field';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { EmptyState } from '../../../components/ui/EmptyState';
import { Skeleton } from '../../../components/ui/Skeleton';
import { formatDayMonth } from '../../../utils/format';
import { tbilisiToday } from '../../../utils/crmNextSession';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { COLOR, Z } from '../../../design/tokens';
import { toastApiError } from '../../../utils/errors';

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
 *
 * Волна 3 (G6-20): одна кнопка сохранения — липкая полоса «Есть изменения ·
 * Сохранить», появляется только при правках. Уход с несохранёнными правками
 * (вкладка внизу, ссылка, закрытие страницы) — с вопросом.
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

/** Поля, которые уходят в PATCH /specialists/me — по ним и считаем «есть изменения». */
function snapshot(p: ProfileData | null): string {
    if (!p) return '';
    return JSON.stringify([
        p.firstName, p.lastName, p.photoUrl || null, p.tagline, p.bio,
        p.specializations, p.formats, p.basePriceGel, p.sessionDurationMin,
    ]);
}

const FORMAT_OPTIONS = [
    { id: 'ONLINE', label: 'Онлайн' },
    { id: 'OFFLINE_UNBOX_ONE', label: 'Unbox One' },
    { id: 'OFFLINE_UNBOX_UNI', label: 'Unbox Uni' },
    { id: 'OFFLINE_NEO_SCHOOL', label: 'Neo School' },
];

export function MobileCrmProfile() {
    const [profile, setProfile] = useState<ProfileData | null>(null);
    // Что лежит на сервере — с ним сравниваем правки.
    const [savedSnap, setSavedSnap] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [specInput, setSpecInput] = useState('');
    const navigate = useNavigate();
    const location = useLocation();
    const { confirm } = useConfirmDialog();
    useDocumentTitle('Анкета · Psy-CRM');

    useEffect(() => {
        api.get('/specialists/me')
            .then(r => { setProfile(r.data); setSavedSnap(snapshot(r.data)); })
            .catch(() => toast.error('Не удалось загрузить анкету'))
            .finally(() => setLoading(false));
    }, []);

    const dirty = useMemo(() => !!profile && snapshot(profile) !== savedSnap, [profile, savedSnap]);

    // Закрыть/перезагрузить страницу с правками — браузер спросит сам.
    useEffect(() => {
        if (!dirty) return;
        const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [dirty]);

    // Уход по ссылке внутри приложения (вкладки внизу, «Часы приёма») —
    // спрашиваем. Ловим клик раньше роутера (фаза захвата).
    useEffect(() => {
        if (!dirty) return;
        const onClick = (e: MouseEvent) => {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
            if (!a || a.target === '_blank') return;
            const url = new URL(a.href, window.location.href);
            if (url.origin !== window.location.origin || url.pathname === location.pathname) return;
            e.preventDefault();
            e.stopPropagation();
            confirm({
                title: 'Уйти без сохранения?',
                body: 'Правки анкеты пропадут.',
                confirmLabel: 'Уйти без сохранения',
                cancelLabel: 'Остаться',
                tone: 'danger',
            }).then(ok => { if (ok) navigate(url.pathname + url.search); });
        };
        document.addEventListener('click', onClick, true);
        return () => document.removeEventListener('click', onClick, true);
    }, [dirty, confirm, navigate, location.pathname]);

    const save = async () => {
        if (!profile || saving) return;
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
            setSavedSnap(snapshot(r.data));
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
                <Skeleton height={64} radius={16} />
                <Skeleton height={120} radius={16} />
                <Skeleton height={120} radius={16} />
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
        <div style={{ paddingBottom: 96, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 09.11 фаза 3: общая крупная шапка 28/14/16. */}
            <MobilePageHeader
                variant="large"
                title="Моя анкета"
                subtitle="Так вас видят клиенты в каталоге специалистов."
                className="crm-profile-header"
            />
            <style>{'.crm-profile-header { padding-bottom: 0; }'}</style>

            {/* Вход в расписание с телефона: без часов приёма клиенты не
                могут записаться к специалисту на сайте. */}
            <div style={{ padding: '0 16px' }}>
                <Link
                    to="/m/crm/schedule"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        // Дизайн-ревью п. 1: большой тёмный блок — panel, а не ink
                        // (ink в тёмной теме светлый — получалось светлое пятно).
                        background: 'var(--color-panel)', color: 'var(--color-on-panel)',
                        borderRadius: 16, padding: 16,
                        textDecoration: 'none',
                    }}
                >
                    <CalendarClock size={22} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 16, fontWeight: 600 }}>Часы приёма</span>
                        <span style={{ display: 'block', fontSize: 14, color: 'var(--color-on-panel)', opacity: 0.8, marginTop: 2 }}>
                            Клиенты записываются к вам на сайте только в эти часы
                        </span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                </Link>
            </div>

            {/* Дизайн-ревью п. 18: поле без «коробки в коробке» — подпись + поле,
                между полями 16, между разделами 32. */}
            <Group title="Карточка в каталоге">
                <Section title="Фото профиля">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {profile.photoUrl ? (
                            <img
                                src={profile.photoUrl}
                                alt=""
                                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 16, flexShrink: 0 }}
                            />
                        ) : (
                            // Значок, а не инициалы: «ОК» на сером читалось как «OK».
                            <div aria-hidden="true" style={{
                                width: 64, height: 64, borderRadius: 16, flexShrink: 0,
                                background: 'var(--color-sunken)', display: 'grid', placeItems: 'center',
                                color: 'var(--color-ink-60)',
                            }}>
                                <User size={24} />
                            </div>
                        )}
                        <PhotoUpload onUploaded={(url) => set('photoUrl', url)} hasPhoto={!!profile.photoUrl} />
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--color-ink-60)' }}>jpg, png · до 2 МБ</div>
                </Section>

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

                <Field label="Слоган" hint="Одна-две строки под именем в каталоге">
                    <TextArea
                        value={profile.tagline}
                        onChange={e => set('tagline', e.target.value)}
                        placeholder="Гештальт-терапевт. Тревога, выгорание."
                        maxLength={150}
                        rows={2}
                        style={{ minHeight: 0 }}
                    />
                </Field>

                <BioField value={profile.bio} onChange={v => set('bio', v)} />
            </Group>

            <Group title="Приём">
                <Field label="Базовая цена сессии">
                    <Input
                        kind="integer"
                        suffix="₾"
                        value={profile.basePriceGel || ''}
                        onChange={e => set('basePriceGel', parseInt(e.target.value) || 0)}
                        placeholder="100"
                    />
                </Field>

                {/* Длительность — показывается в шапке профиля на сайте */}
                <Field label="Длительность консультации">
                    <Input
                        kind="integer"
                        suffix="мин"
                        value={profile.sessionDurationMin ?? 50}
                        onChange={e => set('sessionDurationMin', parseInt(e.target.value) || 50)}
                        placeholder="50"
                    />
                </Field>

                <Section title="Формат работы">
                    <div role="group" aria-label="Формат работы" className="ui-chip-row">
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

                <Section title="Специализации">
                    <div style={{ display: 'flex', gap: 8 }}>
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
            </Group>

            <VacationSection />

            {/* Одна кнопка сохранения: липкая полоса над вкладками, только при правках. */}
            {dirty && (
                <div role="region" aria-label="Несохранённые изменения" style={stickyBar}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>Есть изменения</span>
                    <Button
                        loading={saving}
                        icon={<Save size={16} aria-hidden="true" />}
                        onClick={save}
                    >
                        Сохранить
                    </Button>
                </div>
            )}
        </div>
    );
}

// Над нижними вкладками оболочки (их высота ~64 px + вырез iPhone).
const stickyBar: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    transform: 'translateX(-50%)',
    bottom: 'calc(64px + env(safe-area-inset-bottom, 0px))',
    width: '100%',
    maxWidth: 480,
    zIndex: Z.sticky,
    background: COLOR.card,
    borderTop: `1px solid ${COLOR.ink10}`,
    boxShadow: 'var(--shadow-pop)',
    padding: '8px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
};

/** Раздел анкеты: подпись 12/600 капсом, поля внутри через 16, разделы через 32. */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 className="ui-overline" style={{ margin: 0, padding: '0 4px' }}>{title}</h2>
            {children}
        </section>
    );
}

/** Подпись + содержимое — как Field, когда поля нет или их два (без своей карточки). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="ui-field">
            <div className="ui-field__label">{title}</div>
            {children}
        </div>
    );
}

/**
 * «О себе» (дизайн-ревью п. 18): текст хранится с разметкой «## Заголовок» —
 * так его показывает сайт. В анкете показываем, как увидит клиент (заголовки
 * разделов вместо «##»), правка — по кнопке «Изменить текст».
 */
function BioField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [editing, setEditing] = useState(() => !value?.trim());
    return (
        <div className="ui-field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <label htmlFor="crm-profile-bio" className="ui-field__label">О себе</label>
                {value?.trim() && (
                    <Button variant="quiet" size="sm" onClick={() => setEditing(v => !v)} style={{ color: 'var(--color-accent-ink)' }}>
                        {editing ? 'Как увидит клиент' : 'Изменить текст'}
                    </Button>
                )}
            </div>
            {editing ? (
                <>
                    <TextArea
                        id="crm-profile-bio"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder="Образование, подход, опыт, с чем работаете…"
                        rows={8}
                        maxLength={5000}
                        style={{ minHeight: 160 }}
                    />
                    <div className="ui-field__hint" style={{ marginTop: 0 }}>
                        Заголовок раздела — строка, которая начинается с «##», например «## Образование».
                    </div>
                </>
            ) : (
                <div
                    id="crm-profile-bio"
                    style={{
                        background: 'var(--color-card)', border: '1px solid var(--color-ink-10)', borderRadius: 16,
                        padding: 16, fontSize: 16, lineHeight: 1.5, color: 'var(--color-ink-80)',
                        overflowWrap: 'anywhere',
                    }}
                >
                    {renderBio(value)}
                </div>
            )}
        </div>
    );
}

/** «## Заголовок» → подзаголовок, пустая строка → абзац. Только показ, текст не меняется. */
function renderBio(text: string): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    let para: string[] = [];
    const flush = () => {
        if (para.length) out.push(<p key={out.length} style={{ margin: '0 0 8px', whiteSpace: 'pre-wrap' }}>{para.join('\n')}</p>);
        para = [];
    };
    for (const raw of (text || '').split('\n')) {
        const line = raw.trimEnd();
        const h = /^#{1,6}\s+(.*)$/.exec(line.trim());
        if (h) {
            flush();
            out.push(
                <div key={out.length} style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-ink)', margin: out.length ? '12px 0 4px' : '0 0 4px' }}>
                    {h[1]}
                </div>,
            );
        } else if (!line.trim()) {
            flush();
        } else {
            para.push(line);
        }
    }
    flush();
    return out;
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
            toast.success('Фото загружено — нажмите «Сохранить» внизу');
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
            toastApiError(e, 'Не удалось сохранить отпуск. Попробуйте ещё раз');
        } finally {
            setBusy(false);
        }
    };

    const isActive = !!vacUntil && new Date(vacUntil) >= new Date(new Date().toDateString());

    return (
        <section style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <h2 className="ui-overline" style={{ margin: 0, padding: '0 4px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Plane size={12} aria-hidden="true" /> Отпуск или отъезд
            </h2>
            <div style={{
                background: isActive ? 'var(--status-pending-bg)' : 'var(--color-card)',
                border: '1px solid var(--color-ink-10)',
                borderRadius: 16,
                padding: 16,
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
                        min={tbilisiToday()}
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
        </section>
    );
}
