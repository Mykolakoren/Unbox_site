import { useEffect, useState, useMemo } from 'react';
import { useCrmStore } from '../../store/crmStore';
import {
    StickyNote,
    Plus,
    Trash2,
    Loader2,
    Check,
    X,
    Search,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import type { CrmNoteCreate, CrmClient } from '../../api/crm';

export function CrmNotes() {
    const { notes, clients, fetchNotes, fetchClients, createNote, deleteNote, loading } =
        useCrmStore();
    const [filterClient, setFilterClient] = useState<string>('');
    const [showForm, setShowForm] = useState(false);
    const [search, setSearch] = useState('');

    useEffect(() => {
        fetchClients();
        fetchNotes();
    }, [fetchClients, fetchNotes]);

    useEffect(() => {
        if (filterClient) {
            fetchNotes(filterClient);
        } else {
            fetchNotes();
        }
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
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Заметки</h1>
                    <p className="text-unbox-grey text-sm">Записи по клиентам</p>
                </div>
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                >
                    <Plus className="w-4 h-4" />
                    Новая заметка
                </button>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-unbox-grey" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Поиск по заметкам..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    />
                </div>
                <select
                    value={filterClient}
                    onChange={(e) => setFilterClient(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                >
                    <option value="">Все клиенты</option>
                    {clients
                        .filter((c) => c.isActive)
                        .map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                </select>
            </div>

            {/* New Note Form */}
            {showForm && (
                <NoteForm
                    clients={clients.filter((c) => c.isActive)}
                    defaultClient={filterClient}
                    onSave={async (data) => {
                        await createNote(data);
                        setShowForm(false);
                        toast.success('Заметка создана');
                    }}
                    onCancel={() => setShowForm(false)}
                />
            )}

            {/* Notes List */}
            {loading && !notes.length ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-unbox-grey">
                    <StickyNote className="w-16 h-16 mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-lg">Нет заметок</p>
                    <p className="text-sm mt-1">Создайте первую заметку о клиенте</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {filtered.map((note) => {
                        const client = clientMap.get(note.clientId);
                        return (
                            <div
                                key={note.id}
                                className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 group transition-all hover:shadow-md"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-7 h-7 rounded-lg bg-unbox-light text-unbox-green flex items-center justify-center shrink-0">
                                                <StickyNote className="w-3.5 h-3.5" />
                                            </div>
                                            <span className="font-medium text-sm text-unbox-dark">
                                                {client?.name || 'Неизвестный клиент'}
                                            </span>
                                            <span className="text-xs text-unbox-grey">
                                                {format(parseISO(note.createdAt), 'dd MMM yyyy, HH:mm', {
                                                    locale: ru,
                                                })}
                                            </span>
                                        </div>
                                        <p className="text-unbox-dark text-sm whitespace-pre-wrap leading-relaxed">
                                            {note.content}
                                        </p>
                                        {note.tags && (
                                            <div className="flex gap-1 mt-3 flex-wrap">
                                                {note.tags.split(',').map((tag) => (
                                                    <span
                                                        key={tag}
                                                        className="px-2 py-0.5 text-xs rounded-full bg-unbox-light/50 text-unbox-grey"
                                                    >
                                                        {tag.trim()}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={async () => {
                                            try {
                                                await deleteNote(note.id);
                                                toast.success('Заметка удалена');
                                            } catch {
                                                toast.error('Ошибка удаления');
                                            }
                                        }}
                                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Удалить"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Note Form ────────────────────────────────────────────────────────────────

function NoteForm({
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
            await onSave({
                clientId,
                content: content.trim(),
                tags: tags || undefined,
            });
        } catch (err: any) {
            toast.error(err.message || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <form
            onSubmit={handleSubmit}
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">Новая заметка</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="space-y-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Клиент <span className="text-red-500">*</span>
                    </label>
                    <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        required
                    >
                        <option value="">Выберите клиента</option>
                        {clients.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Содержание <span className="text-red-500">*</span>
                    </label>
                    <textarea
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green resize-none"
                        placeholder="Текст заметки..."
                        required
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Теги <span className="text-unbox-grey">(через запятую)</span>
                    </label>
                    <input
                        type="text"
                        value={tags}
                        onChange={(e) => setTags(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="важное, запрос, прогресс"
                    />
                </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors"
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !clientId || !content.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Создать
                </button>
            </div>
        </form>
    );
}
