import { useEffect, useRef, useState } from 'react';
import { X, Trash2, Plus, Loader2, Eye, EyeOff, Upload, ExternalLink, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { api, API_URL } from '../../api/client';
import { compressImage } from '../../utils/imageCompress';
import { postsApi, type Post, type PostType } from '../../api/posts';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select, TextArea } from '../../components/ui/Field';
import { Segmented } from '../../components/ui/Chip';
import { StructuredText } from '../../components/StructuredText';
import { GH, GH_SANS } from '../../hooks/useDesignFlag';
import { formatDayMonth } from '../../utils/format';
import { BATUMI_TZ, parseUTC } from '../../utils/dateUtils';
import { toastApiError } from '../../utils/errors';

/**
 * AdminPosts — редактор новостей/анонсов и статей специалистов.
 * Публикует админ за всех; у статьи выбирается автор-специалист (owner 2026-06-13).
 *
 * Волна 4, пакет D (G8-09, G8-17, G8-22): страница в стиле остальной
 * админки (Grid House, токены), строка целиком открывает редактор, видна
 * дата публикации и ссылка «На сайте ↗»; корзина нейтральная, краснеет
 * при наведении. Редактор — общий Sheet с вкладкой «Предпросмотр» тем же
 * StructuredText, что и на сайте; закрыть с правками — через вопрос.
 */

interface SpecOption { id: string; firstName: string; lastName: string }

const EMPTY: Post = {
    id: '', type: 'news', title: '', slug: '', excerpt: '', body: '',
    coverImageUrl: null, authorSpecialistId: null, isPublished: false,
    publishedAt: null, createdAt: '', updatedAt: '',
};

const publicPath = (p: Post) => `/${p.type === 'article' ? 'articles' : 'news'}/${p.slug}`;

const dayLabel = (iso?: string | null) => {
    if (!iso) return null;
    const d = parseUTC(iso);
    return isNaN(d.getTime()) ? null : formatDayMonth(d, { timeZone: BATUMI_TZ, withYear: 'auto' });
};

export function AdminPosts() {
    const [tab, setTab] = useState<PostType>('news');
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Post | null>(null);
    const [specs, setSpecs] = useState<SpecOption[]>([]);
    const [failed, setFailed] = useState(false);
    const { confirm } = useConfirmDialog();

    const load = () => {
        setLoading(true);
        setFailed(false);
        postsApi.listAdmin(tab)
            .then(setPosts)
            .catch(() => setFailed(true))
            .finally(() => setLoading(false));
    };
    useEffect(load, [tab]);

    useEffect(() => {
        // Список специалистов для выбора автора статьи.
        // Путь именно /admin/all — /admin падал бы в роут /{specialist_id}
        // и парсил "admin" как UUID (422).
        api.get('/specialists/admin/all')
            .then(r => setSpecs(r.data.map((s: any) => ({ id: s.id, firstName: s.firstName, lastName: s.lastName }))))
            .catch(() => {});
    }, []);

    const remove = async (p: Post) => {
        const ok = await confirm({
            title: `Удалить «${p.title || 'без заголовка'}»?`,
            body: 'Публикация пропадёт с сайта. Вернуть её не получится — если нужно только спрятать, снимите отметку «Опубликовано».',
            confirmLabel: 'Удалить публикацию',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        try { await postsApi.remove(p.id); toast.success('Публикация удалена'); load(); }
        catch (e) { toastApiError(e, 'Не удалось удалить публикацию'); }
    };

    const newLabel = tab === 'news' ? 'Новый анонс' : 'Новый текст';

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            <PageHeader
                title="Новости и статьи"
                description="Анонсы центра и тексты специалистов на сайте."
                actions={
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({ ...EMPTY, type: tab })}>
                        {newLabel}
                    </Button>
                }
            />

            <div style={{ maxWidth: 420, marginBottom: 16 }}>
                <Segmented<PostType>
                    aria-label="Тип публикаций"
                    value={tab}
                    onChange={setTab}
                    options={[
                        { value: 'news', label: 'Новости и анонсы' },
                        { value: 'article', label: 'Тексты специалистов' },
                    ]}
                />
            </div>

            {loading ? (
                <SkeletonList count={3} label="Загружаем публикации" />
            ) : failed ? (
                <ErrorBar message="Не удалось загрузить публикации" onRetry={load} />
            ) : posts.length === 0 ? (
                <div style={{ border: `1px solid ${GH.ink10}`, background: GH.card }}>
                    <EmptyState
                        title="Пока ничего нет"
                        hint="Создайте первую публикацию — она появится здесь."
                        action={{ label: newLabel, onClick: () => setEditing({ ...EMPTY, type: tab }) }}
                    />
                </div>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, border: `1px solid ${GH.ink10}`, background: GH.card }}>
                    {posts.map((p, i) => {
                        const when = p.isPublished ? dayLabel(p.publishedAt) : dayLabel(p.updatedAt);
                        return (
                            <li
                                key={p.id}
                                className="post-row"
                                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: i > 0 ? `1px solid ${GH.ink10}` : 'none' }}
                            >
                                {/* Вся строка открывает редактор (G8-22). */}
                                <button
                                    type="button"
                                    onClick={() => setEditing(p)}
                                    style={{
                                        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 12,
                                        background: 'none', border: 'none', padding: 0, textAlign: 'left',
                                        font: 'inherit', color: 'inherit', cursor: 'pointer',
                                    }}
                                >
                                    <span style={{ width: 48, height: 48, background: GH.sunken, overflow: 'hidden', flexShrink: 0 }}>
                                        {p.coverImageUrl && <img src={p.coverImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                    </span>
                                    <span style={{ minWidth: 0, flex: 1 }}>
                                        <span style={{ display: 'block', fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {p.title || '(без заголовка)'}
                                        </span>
                                        <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, color: GH.ink60 }}>
                                            {p.isPublished
                                                ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--status-ok-fg)' }}><Eye size={12} aria-hidden="true" /> Опубликовано{when ? ` ${when}` : ''}</span>
                                                : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><EyeOff size={12} aria-hidden="true" /> Черновик{when ? ` · изменён ${when}` : ''}</span>}
                                            {p.type === 'article' && p.authorName && <span>· {p.authorName}</span>}
                                        </span>
                                    </span>
                                    <ChevronRight size={16} aria-hidden="true" style={{ color: GH.ink60, flexShrink: 0 }} />
                                </button>
                                {p.isPublished && p.slug && (
                                    <a
                                        href={publicPath(p)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={`Открыть «${p.title || 'без заголовка'}» на сайте (новая вкладка)`}
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 14, color: 'var(--color-accent-ink)', whiteSpace: 'nowrap' }}
                                    >
                                        На сайте <ExternalLink size={12} aria-hidden="true" />
                                    </a>
                                )}
                                <button
                                    type="button"
                                    aria-label={`Удалить «${p.title || 'без заголовка'}»`}
                                    title="Удалить"
                                    onClick={() => remove(p)}
                                    className="post-trash"
                                    style={{
                                        width: 36, height: 36, display: 'grid', placeItems: 'center', flexShrink: 0,
                                        background: 'none', border: 'none', borderRadius: 8, color: GH.ink60, cursor: 'pointer',
                                    }}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
            <style>{`
                .post-row:hover { background: ${GH.ink5}; }
                .post-trash:hover { color: var(--status-danger-fg) !important; background: var(--status-danger-bg) !important; }
            `}</style>

            {editing && (
                <PostEditModal
                    post={editing}
                    specs={specs}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); load(); }}
                />
            )}
        </div>
    );
}

function PostEditModal({ post, specs, onClose, onSaved }: {
    post: Post; specs: SpecOption[]; onClose: () => void; onSaved: () => void;
}) {
    const isNew = !post.id;
    const [type, setType] = useState<PostType>(post.type);
    const [title, setTitle] = useState(post.title);
    const [slug, setSlug] = useState(post.slug);
    const [excerpt, setExcerpt] = useState(post.excerpt);
    const [body, setBody] = useState(post.body);
    const [coverImageUrl, setCoverImageUrl] = useState<string | null>(post.coverImageUrl ?? null);
    const [authorSpecialistId, setAuthorSpecialistId] = useState<string | null>(post.authorSpecialistId ?? null);
    const [isPublished, setIsPublished] = useState(post.isPublished);
    const [saving, setSaving] = useState(false);
    const [view, setView] = useState<'edit' | 'preview'>('edit');
    const { confirm } = useConfirmDialog();

    const dirty = type !== post.type || title !== post.title || slug !== post.slug || excerpt !== post.excerpt
        || body !== post.body || (coverImageUrl ?? null) !== (post.coverImageUrl ?? null)
        || (authorSpecialistId ?? null) !== (post.authorSpecialistId ?? null) || isPublished !== post.isPublished;

    const requestClose = async () => {
        if (saving) return;
        if (!dirty) { onClose(); return; }
        const ok = await confirm({
            title: 'Закрыть без сохранения?',
            body: 'Текст и правки в этой публикации пропадут.',
            confirmLabel: 'Закрыть без сохранения',
            cancelLabel: 'Вернуться к тексту',
        });
        if (ok) onClose();
    };

    const save = async () => {
        if (!title.trim()) { toast.error('Введите заголовок'); return; }
        if (type === 'article' && !authorSpecialistId) { toast.error('Выберите автора статьи'); return; }
        setSaving(true);
        const payload = {
            type, title: title.trim(), slug: slug.trim() || undefined, excerpt, body,
            coverImageUrl, authorSpecialistId: type === 'article' ? authorSpecialistId : null, isPublished,
        };
        try {
            if (isNew) await postsApi.create(payload);
            else await postsApi.update(post.id, payload);
            toast.success(isNew ? 'Публикация создана' : 'Публикация сохранена');
            onSaved();
        } catch (e) {
            toastApiError(e, 'Не удалось сохранить публикацию');
        } finally { setSaving(false); }
    };

    return (
        <Sheet
            open
            onClose={requestClose}
            title={isNew ? 'Новая публикация' : 'Публикация'}
            width={720}
            footer={
                <>
                    <Button block loading={saving} onClick={save}>
                        {isPublished ? 'Сохранить и опубликовать' : 'Сохранить черновик'}
                    </Button>
                    <Button block variant="secondary" onClick={requestClose} disabled={saving}>Отмена</Button>
                </>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Segmented<PostType>
                    aria-label="Тип публикации"
                    value={type}
                    onChange={setType}
                    options={[
                        { value: 'news', label: 'Новость или анонс' },
                        { value: 'article', label: 'Статья специалиста' },
                    ]}
                />

                <Field label="Заголовок" required>
                    <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Заголовок материала" />
                </Field>

                <Field label="Адрес страницы" optional hint="Пусто — сделаем из заголовка">
                    <Input value={slug} onChange={e => setSlug(e.target.value)} placeholder="avto-iz-zagolovka" style={{ fontFamily: 'var(--font-mono)' }} />
                </Field>

                {type === 'article' && (
                    <Field label="Автор (специалист)" required>
                        <Select value={authorSpecialistId ?? ''} onChange={e => setAuthorSpecialistId(e.target.value || null)}>
                            <option value="">Выберите автора</option>
                            {specs.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                        </Select>
                    </Field>
                )}

                <Field label="Краткое описание" hint="Для карточки в ленте и поисковиков">
                    <TextArea value={excerpt} onChange={e => setExcerpt(e.target.value)} rows={2} placeholder="1–2 предложения" />
                </Field>

                {/* Текст + «Предпросмотр» тем же StructuredText, что и на сайте (G8-22). */}
                <div>
                    <div style={{ maxWidth: 320, marginBottom: 8 }}>
                        <Segmented<'edit' | 'preview'>
                            aria-label="Текст"
                            value={view}
                            onChange={setView}
                            options={[
                                { value: 'edit', label: 'Текст' },
                                { value: 'preview', label: 'Предпросмотр' },
                            ]}
                        />
                    </div>
                    {view === 'edit' ? (
                        <Field label="Текст" hint="## Подзаголовок · **жирный** · _курсив_ · - список">
                            <TextArea
                                value={body}
                                onChange={e => setBody(e.target.value)}
                                rows={12}
                                placeholder={'## Заголовок секции\nТекст абзаца с **акцентом**.\n\n- пункт списка\n- ещё пункт'}
                            />
                        </Field>
                    ) : (
                        <div style={{ border: `1px solid ${GH.ink10}`, padding: 16, minHeight: 200, background: GH.paper }}>
                            {body.trim()
                                ? <StructuredText text={body} />
                                : <p style={{ color: GH.ink60, margin: 0 }}>Текста пока нет.</p>}
                        </div>
                    )}
                </div>

                <Field label="Обложка" optional>
                    <div>
                        {coverImageUrl && (
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 10', overflow: 'hidden', background: GH.sunken, marginBottom: 8 }}>
                                <img src={coverImageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                <button
                                    type="button"
                                    onClick={() => setCoverImageUrl(null)}
                                    aria-label="Убрать обложку"
                                    style={{ position: 'absolute', top: 8, right: 8, width: 36, height: 36, display: 'grid', placeItems: 'center', background: GH.ink, color: GH.paper, border: 'none', borderRadius: 8, cursor: 'pointer' }}
                                >
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </div>
                        )}
                        <CoverUpload onUploaded={setCoverImageUrl} />
                    </div>
                </Field>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 36, fontSize: 14 }}>
                    <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--color-accent)' }} />
                    <span style={{ fontWeight: 500 }}>Опубликовано</span>
                    {!isPublished && <span style={{ color: GH.ink60 }}>— черновик, на сайте не виден</span>}
                </label>
            </div>
        </Sheet>
    );
}

function CoverUpload({ onUploaded }: { onUploaded: (url: string) => void }) {
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [busy, setBusy] = useState(false);
    const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try {
            const upload = await compressImage(file);
            if (upload.size > 2 * 1024 * 1024) { toast.error('Фото слишком большое даже после сжатия'); return; }
            const data = new FormData();
            data.append('file', upload);
            const res = await api.post<{ url: string }>('/upload/', data, { headers: { 'Content-Type': 'multipart/form-data' } });
            const baseUrl = (API_URL || '').replace('/api/v1', '');
            onUploaded(`${baseUrl}${res.data.url}`);
            toast.success('Обложка загружена');
        } catch (err) {
            toastApiError(err, 'Не удалось загрузить обложку');
        } finally { setBusy(false); e.target.value = ''; }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />
            <Button
                block
                variant="secondary"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
                icon={busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
            >
                {busy ? 'Загружаем…' : 'Загрузить обложку'}
            </Button>
        </>
    );
}
