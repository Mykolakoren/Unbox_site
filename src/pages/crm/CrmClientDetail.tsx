import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import type { CrmClient, CrmSession, CrmNote } from '../../api/crm';
import {
    ArrowLeft,
    Phone,
    Mail,
    Hash,
    Tag,
    Wallet,
    Calendar,
    StickyNote,
    Plus,
    Trash2,
    Check,
    X,
    Loader2,
    Banknote,
    Pencil,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-700 border-blue-200',
    COMPLETED: 'bg-green-100 text-green-700 border-green-200',
    CANCELLED_CLIENT: 'bg-red-100 text-red-600 border-red-200',
    CANCELLED_THERAPIST: 'bg-orange-100 text-orange-700 border-orange-200',
};

const STATUS_LABELS: Record<string, string> = {
    PLANNED: 'Запланирована',
    COMPLETED: 'Завершена',
    CANCELLED_CLIENT: 'Отмена (клиент)',
    CANCELLED_THERAPIST: 'Отмена (терапевт)',
};

export function CrmClientDetail() {
    const { clientId } = useParams<{ clientId: string }>();
    const navigate = useNavigate();
    const { updateSession, quickPaySession, createNote, deleteNote } = useCrmStore();

    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [loading, setLoading] = useState(true);
    const [showNoteForm, setShowNoteForm] = useState(false);
    const [editingSession, setEditingSession] = useState<string | null>(null);

    useEffect(() => {
        if (!clientId) return;
        setLoading(true);
        Promise.all([
            crmApi.getClient(clientId),
            crmApi.getSessions({ clientId }),
            crmApi.getNotes(clientId),
        ])
            .then(([c, s, n]) => {
                setClient(c);
                setSessions(s);
                setNotes(n);
            })
            .catch(() => toast.error('Не удалось загрузить данные клиента'))
            .finally(() => setLoading(false));
    }, [clientId]);

    const stats = useMemo(() => {
        const completed = sessions.filter((s) => s.status === 'COMPLETED').length;
        const unpaid = sessions.filter(
            (s) => !s.isPaid && s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST'
        );
        const debt = unpaid.reduce((sum, s) => sum + (s.price ?? client?.basePrice ?? 0), 0);
        const totalPaid = sessions
            .filter((s) => s.isPaid)
            .reduce((sum, s) => sum + (s.price ?? client?.basePrice ?? 0), 0);
        return { completed, unpaidCount: unpaid.length, debt, totalPaid };
    }, [sessions, client]);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 animate-spin text-unbox-grey" />
            </div>
        );
    }

    if (!client) {
        return (
            <div className="text-center py-20 text-unbox-grey">
                <p className="text-lg font-medium">Клиент не найден</p>
                <button
                    onClick={() => navigate('/crm/clients')}
                    className="mt-4 text-sm text-unbox-green hover:underline"
                >
                    Вернуться к списку
                </button>
            </div>
        );
    }

    const handleQuickPay = async (sessionId: string) => {
        try {
            const result = await quickPaySession(sessionId);
            setSessions((prev) =>
                prev.map((s) => (s.id === sessionId ? { ...s, isPaid: true } : s))
            );
            toast.success(`Оплачено: ${result.amount} ${result.currency}`);
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleUpdateSession = async (sessionId: string, data: Partial<CrmSession>) => {
        try {
            const updated = await updateSession(sessionId, data);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
            setEditingSession(null);
            toast.success('Сессия обновлена');
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleAddNote = async (content: string, tags?: string) => {
        if (!clientId) return;
        try {
            const note = await createNote({ clientId, content, tags });
            setNotes((prev) => [note, ...prev]);
            setShowNoteForm(false);
            toast.success('Заметка добавлена');
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        try {
            await deleteNote(noteId);
            setNotes((prev) => prev.filter((n) => n.id !== noteId));
            toast.success('Заметка удалена');
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Back + Header */}
            <div>
                <button
                    onClick={() => navigate('/crm/clients')}
                    className="flex items-center gap-1.5 text-sm text-unbox-grey hover:text-unbox-dark transition-colors mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Все клиенты
                </button>

                <div className="bg-white rounded-2xl border border-unbox-light shadow-sm p-6">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="flex items-center gap-4">
                            <div
                                className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shrink-0 ${
                                    client.isActive
                                        ? 'bg-gradient-to-br from-unbox-green to-unbox-dark'
                                        : 'bg-gray-300'
                                }`}
                            >
                                {client.name[0].toUpperCase()}
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold text-unbox-dark">{client.name}</h1>
                                <div className="flex flex-wrap items-center gap-3 mt-1">
                                    {client.aliasCode && (
                                        <span className="flex items-center gap-1 text-sm text-unbox-grey">
                                            <Hash className="w-3.5 h-3.5" />
                                            {client.aliasCode}
                                        </span>
                                    )}
                                    {client.phone && (
                                        <span className="flex items-center gap-1 text-sm text-unbox-grey">
                                            <Phone className="w-3.5 h-3.5" />
                                            {client.phone}
                                        </span>
                                    )}
                                    {client.email && (
                                        <span className="flex items-center gap-1 text-sm text-unbox-grey">
                                            <Mail className="w-3.5 h-3.5" />
                                            {client.email}
                                        </span>
                                    )}
                                    <span className="flex items-center gap-1 text-sm text-unbox-grey">
                                        <Wallet className="w-3.5 h-3.5" />
                                        {client.basePrice} {client.currency} / сессия
                                    </span>
                                </div>
                                {client.tags?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {client.tags.map((tag) => (
                                            <span
                                                key={tag}
                                                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-unbox-light text-unbox-green"
                                            >
                                                <Tag className="w-2.5 h-2.5" />
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => navigate('/crm/clients')}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-unbox-grey border border-unbox-light rounded-xl hover:bg-unbox-light/30 transition-colors"
                        >
                            <Pencil className="w-4 h-4" />
                            Редактировать
                        </button>
                    </div>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-unbox-light p-4 shadow-sm">
                    <div className="text-2xl font-bold text-unbox-dark">{sessions.length}</div>
                    <div className="text-xs text-unbox-grey mt-0.5">Всего сессий</div>
                </div>
                <div className="bg-white rounded-xl border border-unbox-light p-4 shadow-sm">
                    <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
                    <div className="text-xs text-unbox-grey mt-0.5">Завершено</div>
                </div>
                <div className={`bg-white rounded-xl border p-4 shadow-sm ${stats.debt > 0 ? 'border-orange-200' : 'border-unbox-light'}`}>
                    <div className={`text-2xl font-bold ${stats.debt > 0 ? 'text-orange-600' : 'text-unbox-grey'}`}>
                        {stats.debt} {client.currency}
                    </div>
                    <div className="text-xs text-unbox-grey mt-0.5">
                        Долг ({stats.unpaidCount} сессий)
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-unbox-light p-4 shadow-sm">
                    <div className="text-2xl font-bold text-unbox-dark">
                        {stats.totalPaid} {client.currency}
                    </div>
                    <div className="text-xs text-unbox-grey mt-0.5">Получено всего</div>
                </div>
            </div>

            {/* Sessions */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm">
                <div className="flex items-center justify-between p-5 border-b border-unbox-light">
                    <div className="flex items-center gap-2">
                        <Calendar className="w-5 h-5 text-unbox-grey" />
                        <h2 className="font-bold text-lg">История сессий</h2>
                        <span className="text-sm text-unbox-grey">({sessions.length})</span>
                    </div>
                    <button
                        onClick={() => navigate('/crm/sessions')}
                        className="text-sm text-unbox-green hover:text-unbox-dark font-medium transition-colors"
                    >
                        + Новая сессия
                    </button>
                </div>

                {sessions.length === 0 ? (
                    <div className="p-8 text-center text-unbox-grey">
                        <Calendar className="w-12 h-12 mx-auto mb-3 opacity-40" />
                        <p>Нет сессий</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {sessions.map((session) => {
                            const dt = parseISO(session.date);
                            const isEditing = editingSession === session.id;
                            return (
                                <div key={session.id}>
                                    <div className="flex items-center gap-4 px-5 py-3.5 hover:bg-unbox-light/20 transition-colors">
                                        {/* Date */}
                                        <div className="w-12 text-center shrink-0">
                                            <div className="text-xs text-unbox-grey uppercase">
                                                {format(dt, 'MMM', { locale: ru })}
                                            </div>
                                            <div className="text-lg font-bold text-unbox-dark">
                                                {format(dt, 'd')}
                                            </div>
                                            <div className="text-xs text-unbox-grey">
                                                {format(dt, 'HH:mm')}
                                            </div>
                                        </div>

                                        {/* Divider */}
                                        <div className="w-px h-10 bg-unbox-light shrink-0" />

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span
                                                    className={`text-xs px-2 py-0.5 rounded-full border ${
                                                        STATUS_COLORS[session.status] || 'bg-unbox-light/50'
                                                    }`}
                                                >
                                                    {STATUS_LABELS[session.status] || session.status}
                                                </span>
                                                <span className="text-xs text-unbox-grey">
                                                    {session.durationMinutes} мин
                                                </span>
                                                {session.isBooked && (
                                                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200">
                                                        Кабинет
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Price + Actions */}
                                        <div className="flex items-center gap-2 shrink-0">
                                            <div className="text-right">
                                                <div className="font-semibold text-sm text-unbox-dark">
                                                    {session.price ?? client.basePrice} {client.currency}
                                                </div>
                                                {session.isPaid ? (
                                                    <span className="text-xs text-green-600">Оплачено</span>
                                                ) : session.status !== 'CANCELLED_CLIENT' &&
                                                  session.status !== 'CANCELLED_THERAPIST' ? (
                                                    <span className="text-xs text-orange-500">Не оплачено</span>
                                                ) : null}
                                            </div>
                                            {!session.isPaid &&
                                                session.status !== 'CANCELLED_CLIENT' &&
                                                session.status !== 'CANCELLED_THERAPIST' && (
                                                    <button
                                                        onClick={() => handleQuickPay(session.id)}
                                                        className="p-1.5 bg-green-50 hover:bg-green-100 text-green-600 rounded-lg transition-colors"
                                                        title="Быстрая оплата"
                                                    >
                                                        <Banknote className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            <button
                                                onClick={() =>
                                                    setEditingSession(isEditing ? null : session.id)
                                                }
                                                className={`p-1.5 rounded-lg transition-colors ${
                                                    isEditing
                                                        ? 'bg-unbox-light text-unbox-green'
                                                        : 'hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green'
                                                }`}
                                                title="Изменить статус"
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Quick Status Change */}
                                    {isEditing && (
                                        <div className="px-5 py-3 bg-unbox-light/30 border-t border-unbox-light flex flex-wrap items-center gap-2">
                                            <span className="text-xs text-unbox-grey font-medium">Статус:</span>
                                            {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                                <button
                                                    key={key}
                                                    onClick={() =>
                                                        handleUpdateSession(session.id, { status: key as CrmSession['status'] })
                                                    }
                                                    className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                                                        session.status === key
                                                            ? 'bg-unbox-green text-white border-unbox-green'
                                                            : 'bg-white text-unbox-grey border-unbox-light hover:bg-unbox-light/30'
                                                    }`}
                                                >
                                                    {label}
                                                </button>
                                            ))}
                                            <div className="flex items-center gap-1 ml-auto">
                                                <label className="flex items-center gap-1.5 text-xs text-unbox-dark cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={session.isPaid}
                                                        onChange={(e) =>
                                                            handleUpdateSession(session.id, { isPaid: e.target.checked })
                                                        }
                                                        className="rounded"
                                                    />
                                                    Оплачено
                                                </label>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Notes */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm">
                <div className="flex items-center justify-between p-5 border-b border-unbox-light">
                    <div className="flex items-center gap-2">
                        <StickyNote className="w-5 h-5 text-unbox-grey" />
                        <h2 className="font-bold text-lg">Заметки</h2>
                        <span className="text-sm text-unbox-grey">({notes.length})</span>
                    </div>
                    <button
                        onClick={() => setShowNoteForm(!showNoteForm)}
                        className="flex items-center gap-1.5 text-sm text-unbox-green hover:text-unbox-dark font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Добавить заметку
                    </button>
                </div>

                {/* Note Form */}
                {showNoteForm && (
                    <NoteInlineForm
                        onSave={handleAddNote}
                        onCancel={() => setShowNoteForm(false)}
                    />
                )}

                {notes.length === 0 && !showNoteForm ? (
                    <div className="p-8 text-center text-unbox-grey">
                        <StickyNote className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Нет заметок по этому клиенту</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {notes.map((note) => (
                            <div key={note.id} className="px-5 py-4 group">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs text-unbox-grey mb-1">
                                            {format(parseISO(note.createdAt), 'dd MMM yyyy, HH:mm', {
                                                locale: ru,
                                            })}
                                        </div>
                                        <p className="text-sm text-unbox-dark whitespace-pre-wrap leading-relaxed">
                                            {note.content}
                                        </p>
                                        {note.tags && (
                                            <div className="flex gap-1 mt-2 flex-wrap">
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
                                        onClick={() => handleDeleteNote(note.id)}
                                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        title="Удалить"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ── Note Inline Form ──────────────────────────────────────────────────────────

function NoteInlineForm({
    onSave,
    onCancel,
}: {
    onSave: (content: string, tags?: string) => Promise<void>;
    onCancel: () => void;
}) {
    const [content, setContent] = useState('');
    const [tags, setTags] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!content.trim()) return;
        setSaving(true);
        try {
            await onSave(content.trim(), tags || undefined);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="p-4 border-b border-unbox-light bg-unbox-light/20 space-y-3">
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                autoFocus
                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green resize-none bg-white"
                placeholder="Текст заметки..."
                required
            />
            <div className="flex items-center gap-3">
                <input
                    type="text"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    placeholder="Теги через запятую (необязательно)"
                />
                <button
                    type="button"
                    onClick={onCancel}
                    className="p-1.5 hover:bg-unbox-light/50 rounded-lg transition-colors"
                >
                    <X className="w-4 h-4 text-unbox-grey" />
                </button>
                <button
                    type="submit"
                    disabled={saving || !content.trim()}
                    className="flex items-center gap-1.5 px-4 py-1.5 bg-unbox-green text-white text-xs font-medium rounded-lg hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Сохранить
                </button>
            </div>
        </form>
    );
}
