import { useEffect, useState, useMemo } from 'react';
import { useCrmStore } from '../../store/crmStore';
import {
    Plus,
    Trash2,
    Loader2,
    Check,
    X,
    Search,
} from 'lucide-react';
import { toast } from 'sonner';
import type { CrmNoteCreate, CrmNote, CrmClient } from '../../api/crm';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { NoteDeletePreview } from '../../components/crm/NoteDeletePreview';
import { formatDayMonth, formatTime } from '../../utils/format';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';

export function CrmNotes() {
        const { notes, clients, fetchNotes, fetchClients, createNote, deleteNote, loading, error } =
        useCrmStore();
    // Первый ответ ещё не пришёл — скелетон, а не «Заметок ещё нет» (rule 8).
    const [loaded, setLoaded] = useState(false);
    const [filterClient, setFilterClient] = useState<string>('');
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');
    const { confirm: askConfirm } = useConfirmDialog();

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

    const filtered = useMemo(() => {
        if (!search) return notes;
        const q = search.toLowerCase();
        return notes.filter(
            (n) =>
                n.content.toLowerCase().includes(q) ||
                n.tags?.toLowerCase().includes(q) ||
                clientMap.get(n.clientId)?.name.toLowerCase().includes(q)
        );
    }, [notes, search, clientMap]);

    return (

            <GridHouseCrmNotes
                notes={notes}
                filtered={filtered}
                clients={clients}
                clientMap={clientMap}
                loading={loading || !loaded}
                loadError={loaded && !loading ? error : null}
                onRetry={() => { fetchClients(); if (filterClient) fetchNotes(filterClient); else fetchNotes(); }}
                search={search}
                setSearch={setSearch}
                filterClient={filterClient}
                setFilterClient={setFilterClient}
                showForm={showForm}
                setShowForm={setShowForm}
                onCreate={async (data) => {
                    await createNote(data);
                    setShowForm(false);
                    toast.success('Заметка создана');
                }}
                onDelete={async (id) => {
                    // Заметка стирается из базы насовсем — один клик по корзине
                    // больше не удаляет, сначала спрашиваем (аудит 29.09, G5-01).
                    const note = notes.find((n) => n.id === id);
                    const clientName = note ? clientMap.get(note.clientId)?.name : undefined;
                    const ok = await askConfirm({
                        title: clientName ? `Удалить заметку о клиенте ${clientName}?` : 'Удалить заметку?',
                        message: <NoteDeletePreview content={note?.content} />,
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


// NoteForm (старая форма до Grid House) нигде не рендерилась — удалена в wave 1.

// ═══════════════════════════════════════════════════════════════════════════
// Grid House variant — Vignelli × Bierut
// ═══════════════════════════════════════════════════════════════════════════

const GHN_HAIRLINE = `1px solid ${GH.ink10}`;
const GHN_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

function GridHouseCrmNotes({
    notes,
    filtered,
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
    onCreate,
    onDelete,
}: {
    notes: CrmNote[];
    filtered: CrmNote[];
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
    onCreate: (data: CrmNoteCreate) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
}) {
    const activeClients = clients.filter((c) => c.isActive);
    const totalFmt = String(notes.length).padStart(3, '0');
    const filteredFmt = String(filtered.length).padStart(3, '0');

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: GHN_HAIRLINE, paddingBottom: 28, marginBottom: 28 }}>
                <div style={{ ...GHN_MONO_LABEL, marginBottom: 14 }}>Раздел · Заметки</div>
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
                        Заметки по клиентам.
                    </h1>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                        <div style={{ ...GHN_MONO_LABEL, fontVariantNumeric: 'tabular-nums' }}>
                            Показано: {filteredFmt} / {totalFmt}
                        </div>
                        <button
                            onClick={() => setShowForm(true)}
                            style={{
                                background: GH.ink,
                                color: GH.paper,
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase',
                                padding: '14px 22px',
                                border: 'none',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 10,
                            }}
                        >
                            <Plus style={{ width: 14, height: 14 }} />
                            Новая заметка
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Filters ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 24, alignItems: 'end', marginBottom: 28 }}>
                {/* Search — hairline underline */}
                <div>
                    <div style={{ ...GHN_MONO_LABEL, marginBottom: 8 }}>→ Поиск</div>
                    <div style={{ position: 'relative', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8 }}>
                        <Search style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-80%)', width: 16, height: 16, color: GH.ink60 }} />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Текст, тег или имя клиента"
                            style={{
                                width: '100%',
                                paddingLeft: 28,
                                paddingRight: 28,
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontFamily: GH_SANS,
                                fontSize: 16,
                                color: GH.ink,
                            }}
                        />
                        {search && (
                            <button
                                onClick={() => setSearch('')}
                                style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-80%)', background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, padding: 4 }}
                                aria-label="Очистить поиск"
                            >
                                <X style={{ width: 14, height: 14 }} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Client filter */}
                <div>
                    <div style={{ ...GHN_MONO_LABEL, marginBottom: 8 }}>Клиент</div>
                    <div style={{ borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8 }}>
                        <select
                            value={filterClient}
                            onChange={(e) => setFilterClient(e.target.value)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                fontFamily: GH_SANS,
                                fontSize: 16,
                                color: GH.ink,
                                minWidth: 200,
                                cursor: 'pointer',
                            }}
                        >
                            <option value="">— Все —</option>
                            {activeClients.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* ── Inline form ── */}
            {showForm && (
                <div style={{ border: `2px solid ${GH.ink}`, background: GH.paper, padding: 28, marginBottom: 28 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingBottom: 16, borderBottom: GHN_HAIRLINE }}>
                        <div style={{ ...GHN_MONO_LABEL }}>→ Новая заметка</div>
                        <button
                            onClick={() => setShowForm(false)}
                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60, padding: 4 }}
                            aria-label="Закрыть форму"
                        >
                            <X style={{ width: 18, height: 18 }} />
                        </button>
                    </div>
                    <GridHouseNoteForm
                        clients={activeClients}
                        defaultClient={filterClient}
                        onSave={onCreate}
                        onCancel={() => setShowForm(false)}
                    />
                </div>
            )}

            {/* ── List / empty / loading — три разных состояния (rule 8) ── */}
            {loadError && (
                <ErrorBar message="Не удалось загрузить заметки" onRetry={onRetry} retrying={loading} className="mb-4" />
            )}
            {loading && !notes.length ? (
                <div role="status" aria-busy="true" style={{ borderTop: `2px solid ${GH.ink}`, padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <span className="sr-only">Загружаем заметки…</span>
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} radius={0} />)}
                </div>
            ) : filtered.length === 0 ? (
                loadError && !notes.length ? null : (
                    <div style={{ borderTop: `2px solid ${GH.ink}`, borderBottom: GHN_HAIRLINE }}>
                        <EmptyState
                            title={search || filterClient ? 'Ничего не нашли' : 'Заметок пока нет'}
                            hint={search || filterClient ? 'Сбросьте фильтр или попробуйте другой запрос.' : 'Создайте первую заметку о клиенте.'}
                            action={search || filterClient
                                ? { label: 'Сбросить фильтр', onClick: () => { setSearch(''); setFilterClient(''); } }
                                : { label: 'Новая заметка', onClick: () => setShowForm(true) }}
                        />
                    </div>
                )
            ) : (
                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {filtered.map((note, idx) => {
                        const client = clientMap.get(note.clientId);
                        return (
                            <div
                                key={note.id}
                                style={{
                                    borderBottom: GHN_HAIRLINE,
                                    padding: '24px 0',
                                    display: 'grid',
                                    gridTemplateColumns: '60px 1fr 40px',
                                    gap: 20,
                                    alignItems: 'start',
                                }}
                            >
                                {/* Number */}
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        letterSpacing: '0.06em',
                                        color: GH.ink60,
                                        fontVariantNumeric: 'tabular-nums',
                                        paddingTop: 2,
                                    }}
                                >
                                    {String(idx + 1).padStart(3, '0')}
                                </div>

                                {/* Body */}
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                                        <div
                                            style={{
                                                fontFamily: GH_SANS,
                                                fontSize: 18,
                                                fontWeight: 700,
                                                letterSpacing: '-0.01em',
                                                color: GH.ink,
                                            }}
                                        >
                                            {client?.name || '— Неизвестный клиент'}
                                        </div>
                                        <div style={{ ...GHN_MONO_LABEL, color: GH.ink60 }}>
                                            {formatDayMonth(note.createdAt, { withYear: 'auto' })} · {formatTime(note.createdAt)}
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            fontFamily: GH_SANS,
                                            fontSize: 15,
                                            lineHeight: 1.55,
                                            color: GH.ink,
                                            whiteSpace: 'pre-wrap',
                                        }}
                                    >
                                        {note.content}
                                    </div>
                                    {note.tags && (
                                        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                                            {note.tags.split(',').map((tag) => {
                                                const trimmed = tag.trim();
                                                if (!trimmed) return null;
                                                return (
                                                    <span
                                                        key={trimmed}
                                                        style={{
                                                            fontFamily: GH_MONO,
                                                            fontSize: 12,
                                                            letterSpacing: '0.06em',
                                                            textTransform: 'uppercase',
                                                            color: GH.ink,
                                                            border: `1px solid ${GH.ink}`,
                                                            padding: '4px 8px',
                                                        }}
                                                    >
                                                        {trimmed}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                {/* Delete */}
                                <button
                                    onClick={() => onDelete(note.id)}
                                    style={{
                                        background: 'transparent',
                                        border: `1px solid ${GH.ink10}`,
                                        width: 36,
                                        height: 36,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: GH.ink60,
                                        transition: 'all 150ms',
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
                                    aria-label="Удалить заметку"
                                >
                                    <Trash2 style={{ width: 14, height: 14 }} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Footer mono signature */}
            <div style={{ ...GHN_MONO_LABEL, textAlign: 'center', padding: '40px 0 20px', color: GH.ink60 }}>
                Unbox · Индекс заметок · {new Date().getFullYear()}
            </div>
        </div>
    );
}

// ── Grid House note form ──
function GridHouseNoteForm({
    clients,
    defaultClient,
    onSave,
    onCancel,
}: {
    clients: CrmClient[];
    defaultClient?: string;
    onSave: (data: CrmNoteCreate) => Promise<void>;
    onCancel: () => void;
}) {
    const [clientId, setClientId] = useState(defaultClient || '');
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!clientId || !content.trim()) return;
        setSaving(true);
        try {
            await onSave({ clientId, content: content.trim(), tags: tags || undefined });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    const fieldStyle: React.CSSProperties = {
        width: '100%',
        padding: '10px 0',
        border: 'none',
        borderBottom: `2px solid ${GH.ink}`,
        outline: 'none',
        background: 'transparent',
        fontFamily: GH_SANS,
        fontSize: 15,
        color: GH.ink,
    };

    return (
        <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gap: 24 }}>
                <div>
                    <div style={{ ...GHN_MONO_LABEL, marginBottom: 6 }}>Клиент *</div>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        required
                        style={{ ...fieldStyle, cursor: 'pointer' }}
                    >
                        <option value="">— Выберите —</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <div style={{ ...GHN_MONO_LABEL, marginBottom: 6 }}>Содержание *</div>
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={4}
                        required
                        placeholder="Текст заметки…"
                        style={{ ...fieldStyle, resize: 'vertical', fontFamily: GH_SANS }}
                    />
                </div>
                <div>
                    <div style={{ ...GHN_MONO_LABEL, marginBottom: 6 }}>Теги · через запятую</div>
                    <input
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        placeholder="важное, запрос, прогресс"
                        style={fieldStyle}
                    />
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 28, paddingTop: 16, borderTop: GHN_HAIRLINE }}>
                <button
                    type="button"
                    onClick={onCancel}
                    style={{
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        padding: '12px 20px',
                        background: 'transparent',
                        color: GH.ink60,
                        border: `1px solid ${GH.ink10}`,
                        cursor: 'pointer',
                    }}
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId || !content.trim()}
                    style={{
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        padding: '12px 22px',
                        background: GH.ink,
                        color: GH.paper,
                        border: 'none',
                        cursor: saving ? 'default' : 'pointer',
                        opacity: saving || !clientId || !content.trim() ? 0.5 : 1,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 10,
                    }}
                >
                    {saving ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Check style={{ width: 14, height: 14 }} />}
                    Создать
                </button>
            </div>
        </form>
    );
}
