import { useEffect, useRef, useState } from 'react';
import { Pencil, X, Trash2, Plus, Loader2, Eye, EyeOff, Upload } from 'lucide-react';
import { toast } from 'sonner';
import clsx from 'clsx';
import { api, API_URL } from '../../api/client';
import { compressImage } from '../../utils/imageCompress';
import { postsApi, type Post, type PostType } from '../../api/posts';

/**
 * AdminPosts — редактор новостей/анонсов и статей специалистов.
 * Шаблон — AdminSpecialists EditModal. Публикует админ за всех; у статьи
 * выбирается автор-специалист. Owner 2026-06-13.
 */

interface SpecOption { id: string; firstName: string; lastName: string }

const EMPTY: Post = {
    id: '', type: 'news', title: '', slug: '', excerpt: '', body: '',
    coverImageUrl: null, authorSpecialistId: null, isPublished: false,
    publishedAt: null, createdAt: '', updatedAt: '',
};

export function AdminPosts() {
    const [tab, setTab] = useState<PostType>('news');
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<Post | null>(null);
    const [specs, setSpecs] = useState<SpecOption[]>([]);

    const load = () => {
        setLoading(true);
        postsApi.listAdmin(tab)
            .then(setPosts)
            .catch(() => toast.error('Не удалось загрузить'))
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

    return (
        <div className="max-w-4xl mx-auto p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold text-unbox-dark">Новости и статьи</h1>
                <button
                    onClick={() => setEditing({ ...EMPTY, type: tab })}
                    className="px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-semibold flex items-center gap-2"
                >
                    <Plus size={16} /> Новый {tab === 'news' ? 'анонс' : 'текст'}
                </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-5">
                {([['news', 'Новости / анонсы'], ['article', 'Тексты специалистов']] as [PostType, string][]).map(([t, label]) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={clsx(
                            'px-4 py-2 rounded-xl text-sm font-medium border transition-colors',
                            tab === t ? 'bg-unbox-dark text-white border-unbox-dark' : 'bg-white text-unbox-grey border-gray-200 hover:border-unbox-dark/40'
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="text-center py-16 text-gray-400"><Loader2 className="animate-spin mx-auto" /></div>
            ) : posts.length === 0 ? (
                <div className="text-center py-16 text-gray-400 text-sm">Пока ничего нет. Создайте первый.</div>
            ) : (
                <div className="flex flex-col gap-2">
                    {posts.map(p => (
                        <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-white">
                            <div className="w-12 h-12 rounded-lg bg-gray-100 overflow-hidden shrink-0">
                                {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="w-full h-full object-cover" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-sm truncate">{p.title || '(без заголовка)'}</div>
                                <div className="text-xs text-gray-400 flex items-center gap-2">
                                    {p.isPublished
                                        ? <span className="inline-flex items-center gap-1 text-green-600"><Eye size={11} /> Опубликовано</span>
                                        : <span className="inline-flex items-center gap-1 text-gray-400"><EyeOff size={11} /> Черновик</span>}
                                    <span>· /{p.slug}</span>
                                    {p.type === 'article' && p.authorName && <span>· {p.authorName}</span>}
                                </div>
                            </div>
                            <button onClick={() => setEditing(p)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><Pencil size={15} /></button>
                            <button
                                onClick={async () => {
                                    if (!window.confirm(`Удалить «${p.title}»?`)) return;
                                    try { await postsApi.remove(p.id); toast.success('Удалено'); load(); }
                                    catch { toast.error('Не удалось удалить'); }
                                }}
                                className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                            ><Trash2 size={15} /></button>
                        </div>
                    ))}
                </div>
            )}

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
            toast.success(isNew ? 'Создано' : 'Сохранено');
            onSaved();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось сохранить');
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto"
                onClick={e => e.stopPropagation()}
            >
                <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
                    <h3 className="font-bold">{isNew ? 'Новый материал' : 'Редактирование'}</h3>
                    <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4">
                    {/* Type */}
                    <div className="flex gap-2">
                        {([['news', 'Новость / анонс'], ['article', 'Статья специалиста']] as [PostType, string][]).map(([t, l]) => (
                            <button key={t} type="button" onClick={() => setType(t)}
                                className={clsx('flex-1 py-2 rounded-xl text-sm font-medium border',
                                    type === t ? 'bg-unbox-green text-white border-unbox-green' : 'bg-white border-gray-200 text-unbox-grey')}>
                                {l}
                            </button>
                        ))}
                    </div>

                    <Field label="Заголовок">
                        <input value={title} onChange={e => setTitle(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="Заголовок материала" />
                    </Field>

                    <Field label="Slug (адрес страницы)" hint="Оставьте пустым — сгенерируется из заголовка">
                        <input value={slug} onChange={e => setSlug(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono" placeholder="avto-iz-zagolovka" />
                    </Field>

                    {type === 'article' && (
                        <Field label="Автор (специалист)">
                            <select value={authorSpecialistId ?? ''} onChange={e => setAuthorSpecialistId(e.target.value || null)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                                <option value="">— выберите —</option>
                                {specs.map(s => <option key={s.id} value={s.id}>{s.firstName} {s.lastName}</option>)}
                            </select>
                        </Field>
                    )}

                    <Field label="Краткое описание" hint="Для карточки в ленте и SEO">
                        <textarea value={excerpt} onChange={e => setExcerpt(e.target.value)} rows={2}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y" placeholder="1-2 предложения" />
                    </Field>

                    <Field label="Текст" hint="## Подзаголовок · **жирный** · _курсив_ · - список">
                        <textarea value={body} onChange={e => setBody(e.target.value)} rows={12}
                            className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm resize-y font-[450] leading-relaxed"
                            placeholder={"## Заголовок секции\nТекст абзаца с **акцентом**.\n\n- пункт списка\n- ещё пункт"} />
                    </Field>

                    <Field label="Обложка">
                        {coverImageUrl && (
                            <div className="mb-2 relative w-full aspect-[16/10] rounded-lg overflow-hidden bg-gray-100">
                                <img src={coverImageUrl} alt="" className="w-full h-full object-cover" />
                                <button onClick={() => setCoverImageUrl(null)}
                                    className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 text-white"><X size={14} /></button>
                            </div>
                        )}
                        <CoverUpload onUploaded={setCoverImageUrl} />
                    </Field>

                    <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} className="w-4 h-4" />
                        <span className="text-sm font-medium">Опубликовано {isPublished ? '' : '(черновик — не виден на сайте)'}</span>
                    </label>
                </div>

                <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm">Отмена</button>
                    <button onClick={save} disabled={saving}
                        className="flex-1 py-2.5 rounded-xl bg-unbox-green text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                        {saving ? <Loader2 size={15} className="animate-spin" /> : null} Сохранить
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <label className="text-xs font-semibold text-unbox-grey mb-1 block">
                {label}{hint && <span className="font-normal text-gray-400"> · {hint}</span>}
            </label>
            {children}
        </div>
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
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Не удалось загрузить');
        } finally { setBusy(false); e.target.value = ''; }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept="image/*" onChange={handlePick} className="hidden" />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
                className="w-full px-3 py-2 rounded-lg bg-unbox-dark text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} Загрузить обложку
            </button>
        </>
    );
}
