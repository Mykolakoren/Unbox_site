import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../store/userStore';
import { specialistsApi, type SpecialistProfile, type SpecialistApplicationPayload } from '../api/specialists';
import { api, API_URL } from '../api/client';
import { compressImage } from '../utils/imageCompress';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';

// Self-service application page. Anyone with an account can fill out the
// form; on submit the row goes into the Specialist table with
// application_status="pending", an admin sees it in /admin/specialists,
// and approves → is_verified=True → public catalog entry.

const CATEGORIES: Array<{ id: string; label: string }> = [
    { id: 'psychology', label: 'Психология' },
    { id: 'psychiatry', label: 'Психиатрия' },
    { id: 'narcology', label: 'Наркология' },
    { id: 'coaching', label: 'Коучинг' },
    { id: 'education', label: 'Образование' },
];

const FORMATS: Array<{ id: string; label: string }> = [
    { id: 'ONLINE', label: 'Онлайн' },
    { id: 'OFFLINE_PALIASHVILI', label: 'Очно — Палиашвили 4' },
    { id: 'OFFLINE_TBEL', label: 'Очно — Тбел Абусеридзе 38' },
    { id: 'OFFLINE_NEO', label: 'Очно — Neo School' },
];

const ghMono: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: `1px solid ${GH.ink10}`,
    background: GH.paper,
    fontFamily: GH_SANS,
    fontSize: 14,
    color: GH.ink,
};

const labelStyle: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 9,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
    marginBottom: 6,
    display: 'block',
};

export function BecomeSpecialistPage() {
    const currentUser = useUserStore(s => s.currentUser);
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [profile, setProfile] = useState<SpecialistProfile | null>(null);

    const [form, setForm] = useState<SpecialistApplicationPayload>({
        firstName: '',
        lastName: '',
        photoUrl: '',
        tagline: '',
        bio: '',
        specializations: [],
        formats: [],
        basePriceGel: 0,
        category: 'psychology',
    });
    const [specInput, setSpecInput] = useState('');

    useEffect(() => {
        if (!currentUser) {
            // Anonymous → bounce to login with return URL
            navigate(`/login?redirect=${encodeURIComponent('/become-specialist')}`);
            return;
        }
        let cancelled = false;
        specialistsApi.getMine()
            .then(p => {
                if (cancelled) return;
                setProfile(p);
                if (p) {
                    setForm({
                        firstName: p.firstName || '',
                        lastName: p.lastName || '',
                        photoUrl: p.photoUrl || '',
                        tagline: p.tagline || '',
                        bio: p.bio || '',
                        specializations: p.specializations || [],
                        formats: p.formats || [],
                        basePriceGel: p.basePriceGel || 0,
                        category: p.category || 'psychology',
                    });
                }
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [currentUser, navigate]);

    const addSpec = () => {
        const v = specInput.trim();
        if (!v) return;
        if (form.specializations.includes(v)) { setSpecInput(''); return; }
        setForm(f => ({ ...f, specializations: [...f.specializations, v] }));
        setSpecInput('');
    };
    const removeSpec = (s: string) =>
        setForm(f => ({ ...f, specializations: f.specializations.filter(x => x !== s) }));

    const toggleFormat = (id: string) =>
        setForm(f => ({
            ...f,
            formats: f.formats.includes(id) ? f.formats.filter(x => x !== id) : [...f.formats, id],
        }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.firstName.trim() || !form.lastName.trim()) {
            toast.error('Имя и фамилия обязательны');
            return;
        }
        if (form.formats.length === 0) {
            toast.error('Выберите хотя бы один формат работы');
            return;
        }
        setSubmitting(true);
        try {
            const result = await specialistsApi.apply({
                ...form,
                photoUrl: form.photoUrl?.trim() || undefined,
                tagline: form.tagline?.trim() || '',
                bio: form.bio?.trim() || '',
            });
            setProfile(result);
            toast.success(profile ? 'Заявка обновлена и снова на проверке' : 'Заявка отправлена. Админ свяжется с вами.');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось отправить заявку');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '100vh', background: GH.paper, padding: 64, textAlign: 'center' }}>
                <div style={ghMono}>Загрузка…</div>
            </div>
        );
    }

    const status = profile?.applicationStatus;
    const statusBanner = (() => {
        if (!profile) return null;
        if (profile.isVerified) {
            return { color: '#065F46', bg: '#D1FAE5', text: 'Профиль верифицирован — вы в каталоге.' };
        }
        if (status === 'pending') {
            return { color: '#92400E', bg: '#FEF3C7', text: 'Заявка на рассмотрении у админа. Можно править — после правок снова уйдёт на проверку.' };
        }
        if (status === 'rejected') {
            return { color: '#991B1B', bg: '#FEE2E2', text: 'Заявка отклонена. Можете внести правки и отправить повторно.' };
        }
        if (status === 'approved' && !profile.isVerified) {
            return { color: '#065F46', bg: '#D1FAE5', text: 'Заявка одобрена. Скоро появитесь в каталоге.' };
        }
        return null;
    })();

    return (
        <div style={{ minHeight: '100vh', background: GH.paper, color: GH.ink, fontFamily: GH_SANS }}>
            <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 24px 96px' }}>
                <div style={ghMono}>Анкета специалиста</div>
                <h1 style={{
                    fontSize: 'clamp(28px, 4vw, 44px)',
                    fontWeight: 800,
                    letterSpacing: '-0.02em',
                    marginTop: 6, marginBottom: 12,
                }}>
                    {profile ? 'Моя анкета.' : 'Стать специалистом.'}
                </h1>
                <p style={{ color: GH.ink60, fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>
                    Заполните карточку — она появится в каталоге <Link to="/specialists" style={{ color: GH.ink, textDecoration: 'underline' }}>/specialists</Link> после подтверждения админом.
                </p>

                {statusBanner && (
                    <div style={{
                        padding: '12px 16px',
                        background: statusBanner.bg,
                        color: statusBanner.color,
                        marginBottom: 24,
                        fontSize: 13,
                        fontWeight: 500,
                    }}>
                        {statusBanner.text}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <label style={labelStyle}>Имя</label>
                            <input value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} style={inputStyle} required maxLength={100} />
                        </div>
                        <div>
                            <label style={labelStyle}>Фамилия</label>
                            <input value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} style={inputStyle} required maxLength={100} />
                        </div>
                    </div>

                    <div>
                        <label style={labelStyle}>Фото профиля</label>
                        <ProfilePhotoUpload
                            current={form.photoUrl || ''}
                            onUploaded={(url) => setForm(f => ({ ...f, photoUrl: url }))}
                        />
                        <div style={{ ...ghMono, fontSize: 9, marginTop: 4 }}>jpg, png · до 2 МБ. Можно оставить пустым — добавите позже.</div>
                    </div>

                    <div>
                        <label style={labelStyle}>Слоган (1 строка)</label>
                        <input value={form.tagline || ''} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))} style={inputStyle} maxLength={150} placeholder="Гештальт-терапевт. Работаю с тревогой и выгоранием." />
                    </div>

                    <div>
                        <label style={labelStyle}>О себе</label>
                        <textarea value={form.bio || ''} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} style={{ ...inputStyle, minHeight: 140, fontFamily: 'inherit' }} maxLength={5000} placeholder="Образование, подходы, опыт, с чем работаете…" />
                    </div>

                    <div>
                        <label style={labelStyle}>Специализации</label>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <input value={specInput} onChange={e => setSpecInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSpec(); } }}
                                style={inputStyle} placeholder="Гештальт-терапия, КПТ, EMDR…" />
                            <button type="button" onClick={addSpec} style={{
                                padding: '0 16px', border: `1px solid ${GH.ink}`, background: GH.ink, color: GH.paper,
                                fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', cursor: 'pointer',
                            }}>+ Добавить</button>
                        </div>
                        {form.specializations.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                {form.specializations.map(s => (
                                    <span key={s} style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        padding: '4px 10px', border: `1px solid ${GH.ink10}`, fontSize: 12,
                                    }}>
                                        {s}
                                        <button type="button" onClick={() => removeSpec(s)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, fontSize: 14, lineHeight: 1 }}>×</button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <label style={labelStyle}>Формат работы</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {FORMATS.map(f => (
                                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                                    <input type="checkbox" checked={form.formats.includes(f.id)} onChange={() => toggleFormat(f.id)} />
                                    {f.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                        <div>
                            <label style={labelStyle}>Категория</label>
                            <select value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} style={inputStyle}>
                                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Базовая цена (₾/час)</label>
                            <input type="number" min={0} value={form.basePriceGel} onChange={e => setForm(f => ({ ...f, basePriceGel: parseInt(e.target.value || '0', 10) }))} style={inputStyle} />
                        </div>
                    </div>

                    <button type="submit" disabled={submitting} style={{
                        marginTop: 12,
                        padding: '14px 24px',
                        background: GH.ink, color: GH.paper, border: 'none',
                        fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
                        cursor: submitting ? 'wait' : 'pointer',
                        opacity: submitting ? 0.6 : 1,
                    }}>
                        {submitting ? 'Отправляем…' : profile ? 'Обновить заявку' : 'Отправить на рассмотрение'}
                    </button>
                </form>
            </div>
        </div>
    );
}


/** Public application form's photo upload. Same /upload endpoint as the
 *  CRM profile / admin specialists modal — 2 MB cap, image-only.
 *  Shows a 56×56 preview tile next to the button if a photo is already set. */
function ProfilePhotoUpload({ current, onUploaded }: { current: string; onUploaded: (url: string) => void }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
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
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Фото загружено');
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(typeof msg === 'string' ? msg : 'Не удалось загрузить фото');
        } finally {
            setBusy(false);
            e.target.value = '';
        }
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {current && (
                <img src={current} alt="" style={{ width: 56, height: 56, objectFit: 'cover', border: '1px solid rgba(0,0,0,0.1)' }} />
            )}
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} style={{ display: 'none' }} />
            <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                style={{
                    flex: 1, padding: '12px 14px',
                    background: '#0E0E0E', color: '#fff',
                    border: 'none', cursor: busy ? 'wait' : 'pointer',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    fontWeight: 700, fontSize: 13, fontFamily: 'inherit',
                    opacity: busy ? 0.7 : 1,
                }}
            >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                {busy ? 'Загружаем…' : (current ? 'Заменить фото' : 'Загрузить с устройства')}
            </button>
        </div>
    );
}
