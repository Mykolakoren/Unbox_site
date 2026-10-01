import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { Plus, Trash2, X, Search, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import type { CrmNoteCreate, CrmNote, CrmClient } from '../../api/crm';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { NoteDeletePreview } from '../../components/crm/NoteDeletePreview';
import { formatDayMonth, formatTime } from '../../utils/format';
import { parseUTC, BATUMI_TZ } from '../../utils/dateUtils';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select, TextArea } from '../../components/ui/Field';

/**
 * Заметки Psy-CRM на компьютере (волна 3, пакет C; G5-24).
 *
 * - Строка заметки ~72 знака (раньше ~120 при 15 px — трудно читать).
 * - Имя клиента — ссылка в его карточку; номера 001–010 убраны.
 * - «Скрывать текст»: в кабинете бывают люди, а тут терапевтические записи.
 *   Выбор запоминается в этом браузере; одну заметку можно приоткрыть.
 * - Правки заметки нет: у сервера нет PATCH /crm/notes (вне волны).
 * - Пишем только createNote / deleteNote — заметки шифруются на сервере.
 */

const HIDE_KEY = 'crm_notes_hide_text';
const TZ = { timeZone: BATUMI_TZ };

function readHide(): boolean {
    try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}

export function CrmNotes() {
        const { notes, clients, fetchNotes, fetchClients, createNote, deleteNote, loading, error } =
        useCrmStore();
    const viewingOther = useCrmStore(s => !!s.viewAsSpecialistId);
    // Первый ответ ещё не пришёл — скелетон, а не «Заметок ещё нет» (rule 8).
    const [loaded, setLoaded] = useState(false);
    const [filterClient, setFilterClient] = useState<string>('');
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');
    const { confirm: askConfirm } = useConfirmDialog();

    useDocumentTitle('Заметки · Psy-CRM');

    useEffect(() => {
        fetchClients();
        fetchNotes();
    }, [fetchClients, fetchNotes]);

    useEffect(() => {
        const req = filterClient ? fetchNotes(filterClient) : fetchNotes();
        Promise.resolve(req).finally(() => setLoaded(true));
    }, [filterClient, fetchNotes]);

    const clientMap = useMemo(() => {
        const map = new Map<string, CrmClient>();
        clients.forEach((c) => map.set(c.id, c));
        return map;
    }, [clients]);

    return (

            <GridHouseCrmNotes
                notes={notes}
                clients={clients}
                clientMap={clientMap}
                loading={loading || !loaded}
                loadError={loaded && !loading ? error : null}
                onRetry={() => { fetchClients(); if (filterClient) fetchNotes(filterClient); else fetchNotes(); }}
                search={search}
                setSearch={setSearch}
                filterClient={filterClient}
                setFilterClient={setFilterClient}
                showForm={showForm && !viewingOther}
                setShowForm={setShowForm}
                canCreate={!viewingOther}
                onCreate={async (data) => {
                    await createNote(data);
                    setShowForm(false);
                    toast.success('Заметка сохранена');
                }}
                onDelete={async (id) => {
                    // Заметка стирается из базы насовсем — один клик по корзине
                    // больше не удаляет, сначала спрашиваем (аудит 29.09, G5-01).
                    const note = notes.find((n) => n.id === id);
                    const clientName = note ? clientMap.get(note.clientId)?.name : undefined;
                    const ok = await askConfirm({
                        title: clientName ? `Удалить заметку о клиенте ${clientName}?` : 'Удалить заметку?',
                        message: <NoteDeletePreview content={note?.content} hideText={readHide()} />,
                        confirmLabel: 'Удалить заметку',
                        cancelLabel: 'Оставить',
                        destructive: true,
                    });
                    if (!ok) return;
                    try {
                        await deleteNote(id);
                        toast.success('Заметка удалена');
                    } catch {
                        // Ошибку уже показал стор (crmStore.deleteNote) — второй тост не нужен.
                    }
                }}
            />
        );
}


// ═══════════════════════════════════════════════════════════════════════════
// Grid House — лента заметок
// ═══════════════════════════════════════════════════════════════════════════

const GHN_HAIRLINE = `1px solid ${GH.ink10}`;
const META: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 12, color: GH.ink60, fontVariantNumeric: 'tabular-nums' };

function GridHouseCrmNotes({
    notes,
    clients,
    clientMap,
    loading,
    loadError,
    onRetry,
    search,
    setSearch,
    filterClient,
    setFilterClient,
    showForm,
    setShowForm,
    canCreate,
    onCreate,
    onDelete,
}: {
    notes: CrmNote[];
    clients: CrmClient[];
    clientMap: Map<string, CrmClient>;
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    search: string;
    setSearch: (v: string) => void;
    filterClient: string;
    setFilterClient: (v: string) => void;
    showForm: boolean;
    setShowForm: (v: boolean) => void;
    canCreate: boolean;
    onCreate: (data: CrmNoteCreate) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const activeClients = clients.filter((c) => c.isActive);
    const [hideText, setHideText] = useState(readHide);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());

    const toggleHide = () => {
        const next = !hideText;
        setHideText(next);
        setRevealed(new Set());
        try { localStorage.setItem(HIDE_KEY, next ? '1' : '0'); } catch { /* приватное окно — не страшно */ }
    };

    // Поиск живёт здесь, рядом с «Скрывать текст»: пока текст скрыт и заметка
    // не раскрыта, по её content не ищем — иначе по выдаче можно угадать,
    // что написано («депрессия» → осталась одна заметка Анны). Ищем по имени и тегам.
    const filtered = useMemo(() => {
        if (!search) return notes;
        const q = search.toLowerCase();
        return notes.filter((n) => {
            const textSearchable = !hideText || revealed.has(n.id);
            return (textSearchable && n.content.toLowerCase().includes(q)) ||
                n.tags?.toLowerCase().includes(q) ||
                clientMap.get(n.clientId)?.name.toLowerCase().includes(q);
        });
    }, [notes, search, clientMap, hideText, revealed]);

    const filteredBy = search || filterClient;

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            <PageHeader
                title="Заметки"
                description={notes.length
                    ? (filteredBy && filtered.length !== notes.length ? `Показано ${filtered.length} из ${notes.length}` : 'Видите только вы. Хранятся зашифрованными.')
                    : undefined}
                actions={
                    <>
                        <Button
                            variant="quiet"
                            icon={hideText ? <Eye size={16} aria-hidden="true" /> : <EyeOff size={16} aria-hidden="true" />}
                            aria-pressed={hideText}
                            onClick={toggleHide}
                        >
                            {hideText ? 'Показывать текст' : 'Скрывать текст'}
                        </Button>
                        {canCreate && (
                            <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setShowForm(true)}>Заметка</Button>
                        )}
                    </>
                }
            />

            {/* ── Поиск и клиент ── */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-end', marginBottom: 24, maxWidth: 'calc(72ch + 160px)' }}>
                <div style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${GH.ink30}`, minHeight: 40 }}>
                    <Search size={16} color={GH.ink60} aria-hidden="true" />
                    <input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={hideText ? 'Тег или имя клиента' : 'Текст, тег или имя клиента'}
                        aria-label="Поиск по заметкам"
                        style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: GH_SANS, fontSize: 15, color: GH.ink, minHeight: 36 }}
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            aria-label="Очистить поиск"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div style={{ flex: '0 1 240px' }}>
                    <Field label="Клиент">
                        <Select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
                            <option value="">Все клиенты</option>
                            {activeClients.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </Select>
                    </Field>
                </div>
            </div>

            {/* ── Лента / пусто / загрузка — три разных состояния (rule 8) ── */}
            {loadError && (
                <ErrorBar message="Не удалось загрузить заметки" onRetry={onRetry} retrying={loading} className="mb-4" />
            )}
            {loading && !notes.length ? (
                <div role="status" aria-busy="true" style={{ borderTop: `2px solid ${GH.ink}`, padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: '72ch' }}>
                    <span className="sr-only">Загружаем заметки…</span>
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} radius={0} />)}
                </div>
            ) : filtered.length === 0 ? (
                loadError && !notes.length ? null : (
                    <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: GHN_HAIRLINE }}>
                        <EmptyState
                            title={filteredBy ? 'Ничего не нашли' : 'Заметок пока нет'}
                            hint={filteredBy ? 'Сбросьте фильтр или попробуйте другой запрос.' : 'Записывайте наблюдения и домашние задания — их видите только вы.'}
                            action={filteredBy
                                ? { label: 'Сбросить фильтр', onClick: () => { setSearch(''); setFilterClient(''); } }
                                : canCreate ? { label: 'Новая заметка', onClick: () => setShowForm(true) } : undefined}
                        />
                    </div>
                )
            ) : (
                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {filtered.map((note) => {
                        const client = clientMap.get(note.clientId);
                        const created = parseUTC(note.createdAt);
                        const hidden = hideText && !revealed.has(note.id);
                        const tags = (note.tags || '').split(',').map(t => t.trim()).filter(Boolean);
                        return (
                            <article
                                key={note.id}
                                style={{ borderBottom: GHN_HAIRLINE, padding: '20px 0', display: 'flex', gap: 16, alignItems: 'flex-start' }}
                            >
                                <div style={{ flex: '0 1 72ch', minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
                                        {client ? (
                                            <Link
                                                to={`/crm/clients/${client.id}`}
                                                style={{ fontSize: 16, fontWeight: 600, color: GH.ink, textDecoration: 'underline', textDecorationThickness: 1, textUnderlineOffset: 3 }}
                                            >
                                                {client.name}
                                            </Link>
                                        ) : (
                                            <span style={{ fontSize: 16, fontWeight: 600, color: GH.ink60 }}>Клиент удалён</span>
                                        )}
                                        <span style={META}>
                                            {formatDayMonth(created, { withYear: 'auto', ...TZ })} · {formatTime(created, TZ)}
                                            {note.sessionId ? ' · к сессии' : ''}
                                        </span>
                                    </div>
                                    {hidden ? (
                                        <button
                                            type="button"
                                            onClick={() => setRevealed(prev => new Set(prev).add(note.id))}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 32, padding: 0,
                                                background: 'transparent', border: 'none', cursor: 'pointer',
                                                fontSize: 14, color: GH.ink60,
                                            }}
                                        >
                                            <Eye size={14} aria-hidden="true" /> Текст скрыт · Показать
                                        </button>
                                    ) : (
                                        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: GH.ink, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                            {note.content}
                                        </p>
                                    )}
                                    {tags.length > 0 && (
                                        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                                            {tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: GH.sunken, color: GH.ink80 }}
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {canCreate && (
                                    <button
                                        onClick={() => onDelete(note.id)}
                                        style={{
                                            background: 'transparent',
                                            border: `1px solid ${GH.ink10}`,
                                            width: 36,
                                            height: 36,
                                            flexShrink: 0,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: GH.ink60,
                                            transition: 'border-color 150ms, color 150ms',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = GH.danger;
                                            e.currentTarget.style.color = GH.danger;
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = GH.ink10;
                                            e.currentTarget.style.color = GH.ink60;
                                        }}
                                        title="Удалить заметку"
                                        aria-label={client ? `Удалить заметку о клиенте ${client.name}` : 'Удалить заметку'}
                                    >
                                        <Trash2 style={{ width: 14, height: 14 }} />
                                    </button>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            <NoteSheet
                open={showForm}
                clients={activeClients}
                defaultClient={filterClient}
                onSave={onCreate}
                onClose={() => setShowForm(false)}
            />
        </div>
    );
}

// ── Новая заметка — на общем Sheet ──
function NoteSheet({
    open,
    clients,
    defaultClient,
    onSave,
    onClose,
}: {
    open: boolean;
    clients: CrmClient[];
    defaultClient?: string;
    onSave: (data: CrmNoteCreate) => Promise<void>;
    onClose: () => void;
}) {
    const [clientId, setClientId] = useState(defaultClient || '');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [saving, setSaving] = useState(false);

    // Открыли — с чистого листа, клиент из фильтра.
    useEffect(() => {
        if (!open) return;
        setClientId(defaultClient || '');
        setContent('');
        setTags('');
    }, [open, defaultClient]);

    const handleSubmit = async () => {
        if (!clientId || !content.trim() || saving) return;
        setSaving(true);
        try {
            await onSave({ clientId, content: content.trim(), tags: tags || undefined });
        } catch {
            // Ошибку уже показал стор (crmStore.createNote) — второй тост не нужен.
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Новая заметка"
            description="Видите только вы. Хранится зашифрованной."
            width={560}
            footer={
                <>
                    <Button loading={saving} disabled={!clientId || !content.trim()} onClick={handleSubmit}>Сохранить заметку</Button>
                    <Button variant="secondary" onClick={onClose}>Не сохранять</Button>
                </>
            }
        >
            <div style={{ display: 'grid', gap: 16 }}>
                <Field label="Клиент" required>
                    <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                        <option value="">Выберите клиента</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </Select>
                </Field>
                <Field label="Текст" required>
                    <TextArea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={6}
                        placeholder="Что было на сессии, домашнее задание, наблюдения"
                    />
                </Field>
                <Field label="Теги" hint="Через запятую: важное, запрос, прогресс" optional>
                    <Input value={tags} onChange={(e) => setTags(e.target.value)} />
                </Field>
            </div>
        </Sheet>
    );
}
