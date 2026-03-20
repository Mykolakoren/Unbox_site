import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import type { CrmClient, CrmSession, CrmNote, CrmPayment } from '../../api/crm';
import {
    ArrowLeft, Phone, Mail, Tag, Wallet, Calendar, StickyNote,
    Plus, Trash2, Check, X, Loader2, Pencil, Send,
    CheckCheck, RefreshCw, FileText,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

const STATUS_COLORS: Record<string, string> = {
    PLANNED: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-green-100 text-green-700',
    CANCELLED_CLIENT: 'bg-red-100 text-red-600',
    CANCELLED_THERAPIST: 'bg-orange-100 text-orange-700',
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
    const { updateSession, createNote, deleteNote } = useCrmStore();

    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [payments, setPayments] = useState<CrmPayment[]>([]);
    const [balance, setBalance] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showNoteForm, setShowNoteForm] = useState(false);
    const [editingSession, setEditingSession] = useState<string | null>(null);
    const [sessionNoteId, setSessionNoteId] = useState<string | null>(null);
    const [sessionNoteText, setSessionNoteText] = useState('');
    const [sessionNoteTags, setSessionNoteTags] = useState('');
    const [savingSessionNote, setSavingSessionNote] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const [editingProfile, setEditingProfile] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '', phone: '', email: '', telegram: '', aliasCode: '', basePrice: '', currency: 'GEL', tags: '',
    });

    const loadData = useCallback(async () => {
        if (!clientId) return;
        setLoading(true);
        try {
            const [c, s, n, p, b] = await Promise.all([
                crmApi.getClient(clientId),
                crmApi.getSessions({ clientId }),
                crmApi.getNotes(clientId),
                crmApi.getPayments({ clientId }),
                crmApi.getClientBalance(clientId),
            ]);
            setClient(c);
            setSessions(s);
            setNotes(n);
            setPayments(p);
            setBalance(b);
        } catch {
            toast.error('Не удалось загрузить данные клиента');
        } finally {
            setLoading(false);
        }
    }, [clientId]);

    useEffect(() => { loadData(); }, [loadData]);

    const stats = useMemo(() => {
        const completed = sessions.filter(s => s.status === 'COMPLETED').length;
        const unpaid = sessions.filter(
            s => !s.isPaid && s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST'
        );
        const debt = unpaid.reduce((sum, s) => sum + (s.price ?? client?.basePrice ?? 0), 0);
        const totalPaid = balance?.total_paid ?? 0;
        return { completed, unpaidCount: unpaid.length, debt, totalPaid };
    }, [sessions, client, balance]);

    const notesBySession = useMemo(() => {
        const map = new Map<string, CrmNote>();
        notes.forEach(n => { if (n.sessionId) map.set(n.sessionId, n); });
        return map;
    }, [notes]);

    // Split sessions into future and past
    const now = new Date();
    const futureSessions = useMemo(() =>
        sessions.filter(s => new Date(s.date) > now && s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST')
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()),
        [sessions]
    );
    const pastSessions = useMemo(() =>
        sessions.filter(s => new Date(s.date) <= now)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        [sessions]
    );

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleQuickPay = async (sessionId: string) => {
        try {
            const result = await crmApi.quickPaySession(sessionId);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPaid: true } : s));
            toast.success(`Оплачено: ${result.amount} ${result.currency}`);
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleUnmarkPaid = async (sessionId: string) => {
        try {
            await crmApi.unmarkPaidSession(sessionId);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPaid: false } : s));
            toast.success('Оплата снята');
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleMarkAllPaid = async () => {
        if (!clientId || !client) return;
        if (!confirm(`Отметить ${stats.unpaidCount} неоплаченных сессий как оплаченные?`)) return;
        setMarkingAll(true);
        try {
            const result = await crmApi.markAllPaid(clientId);
            toast.success(`Отмечено оплаченными: ${result.marked}`);
            loadData();
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        } finally {
            setMarkingAll(false);
        }
    };

    const handleUpdateSession = async (sessionId: string, data: Partial<CrmSession>) => {
        try {
            const updated = await updateSession(sessionId, data);
            setSessions(prev => prev.map(s => s.id === sessionId ? updated : s));
            setEditingSession(null);
            toast.success('Сессия обновлена');
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const handleAddSessionNote = async (sId: string) => {
        if (!clientId || !sessionNoteText.trim()) return;
        setSavingSessionNote(true);
        try {
            const note = await createNote({ clientId, sessionId: sId, content: sessionNoteText.trim(), tags: sessionNoteTags || undefined });
            setNotes(prev => [note, ...prev]);
            setSessionNoteId(null);
            setSessionNoteText('');
            setSessionNoteTags('');
            toast.success('Заметка к сессии добавлена');
        } catch {
            toast.error('Ошибка сохранения заметки');
        } finally {
            setSavingSessionNote(false);
        }
    };

    const handleAddNote = async (content: string, tags?: string) => {
        if (!clientId) return;
        try {
            const note = await createNote({ clientId, content, tags });
            setNotes(prev => [note, ...prev]);
            setShowNoteForm(false);
            toast.success('Заметка добавлена');
        } catch (e: any) {
            toast.error(e.message || 'Ошибка');
        }
    };

    const openEditProfile = () => {
        if (!client) return;
        setEditForm({
            name: client.name,
            phone: client.phone || '',
            email: client.email || '',
            telegram: client.telegram || '',
            aliasCode: client.aliasCode || '',
            basePrice: String(client.basePrice || ''),
            currency: client.currency || 'GEL',
            tags: (client.tags || []).join(', '),
        });
        setEditingProfile(true);
    };

    const handleSaveProfile = async () => {
        if (!clientId || !editForm.name.trim()) return;
        try {
            const tags = editForm.tags.split(',').map(t => t.trim()).filter(Boolean);
            const updated = await crmApi.updateClient(clientId, {
                name: editForm.name.trim(),
                phone: editForm.phone || undefined,
                email: editForm.email || undefined,
                telegram: editForm.telegram || undefined,
                aliasCode: editForm.aliasCode || undefined,
                basePrice: editForm.basePrice ? Number(editForm.basePrice) : undefined,
                currency: editForm.currency,
                tags: tags.length ? tags : [],
            });
            setClient(updated);
            setEditingProfile(false);
            toast.success('Профиль обновлён');
        } catch (e: any) {
            toast.error(e.message || 'Ошибка сохранения');
        }
    };

    const handleDeleteNote = async (noteId: string) => {
        try {
            await deleteNote(noteId);
            setNotes(prev => prev.filter(n => n.id !== noteId));
            toast.success('Заметка удалена');
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    // ── Render ────────────────────────────────────────────────────────────────

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
                <button onClick={() => navigate('/crm/clients')} className="mt-4 text-sm text-unbox-green hover:underline">
                    Вернуться к списку
                </button>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
            {/* Back */}
            <button
                onClick={() => navigate('/crm/clients')}
                className="flex items-center gap-1.5 text-sm text-unbox-grey hover:text-unbox-dark transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                К списку клиентов
            </button>

            {/* ═══ Header Profile (PsyCRM-style) ═══ */}
            <div className="bg-white rounded-2xl border border-unbox-light shadow-sm p-6 md:p-8">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                    <div className="flex items-center gap-5">
                        <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white shrink-0 ${
                            client.isActive ? 'bg-gradient-to-br from-unbox-green to-unbox-dark' : 'bg-gray-300'
                        }`}>
                            {client.name[0].toUpperCase()}
                        </div>
                        <div>
                            <h1 className="text-2xl font-bold text-unbox-dark flex items-center gap-2 flex-wrap">
                                {client.name}
                                {client.aliasCode && (
                                    <span className="text-gray-400 font-normal text-lg">#{client.aliasCode}</span>
                                )}
                            </h1>
                            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-600">
                                {client.phone && (
                                    <span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-gray-400" />{client.phone}</span>
                                )}
                                {client.telegram && (
                                    <span className="flex items-center gap-1.5"><Send className="w-4 h-4 text-gray-400" />{client.telegram}</span>
                                )}
                                {client.email && (
                                    <span className="flex items-center gap-1.5"><Mail className="w-4 h-4 text-gray-400" />{client.email}</span>
                                )}
                                <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700 font-medium">
                                    Оплачено всего: {client.currency} {stats.totalPaid}
                                </span>
                            </div>
                            {client.tags?.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {client.tags.map(tag => (
                                        <span key={tag} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-unbox-light text-unbox-green">
                                            <Tag className="w-2.5 h-2.5" />{tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Action buttons */}
                    <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                        {stats.unpaidCount > 0 && (
                            <button
                                onClick={handleMarkAllPaid}
                                disabled={markingAll}
                                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                {markingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                                Оплатить все ({stats.unpaidCount})
                            </button>
                        )}
                        <button
                            onClick={openEditProfile}
                            className="flex items-center gap-2 px-4 py-2 text-sm text-unbox-grey border border-unbox-light rounded-xl hover:bg-unbox-light/30 transition-colors"
                        >
                            <Pencil className="w-4 h-4" />
                            Редактировать профиль
                        </button>
                        <button
                            onClick={() => navigate('/crm/sessions')}
                            className="flex items-center gap-2 px-4 py-2 bg-unbox-green text-white rounded-xl text-sm font-medium hover:bg-unbox-dark transition-colors"
                        >
                            <Plus className="w-4 h-4" />
                            Новая сессия
                        </button>
                    </div>
                </div>
            </div>

            {/* ═══ Edit Profile Form ═══ */}
            {editingProfile && (
                <div className="bg-white rounded-2xl border border-unbox-green/30 shadow-sm p-6 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-unbox-dark flex items-center gap-2">
                            <Pencil className="w-5 h-5 text-unbox-green" />
                            Редактировать профиль
                        </h3>
                        <button onClick={() => setEditingProfile(false)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                            <X className="w-5 h-5 text-unbox-grey" />
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Имя <span className="text-red-500">*</span></label>
                            <input
                                type="text"
                                value={editForm.name}
                                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Телефон</label>
                            <input
                                type="text"
                                value={editForm.phone}
                                onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                placeholder="+995..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Email</label>
                            <input
                                type="email"
                                value={editForm.email}
                                onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Telegram</label>
                            <input
                                type="text"
                                value={editForm.telegram}
                                onChange={e => setEditForm(f => ({ ...f, telegram: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                placeholder="@username"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Код клиента</label>
                            <input
                                type="text"
                                value={editForm.aliasCode}
                                onChange={e => setEditForm(f => ({ ...f, aliasCode: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                placeholder="4-значный код"
                                maxLength={4}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-1">Ставка за сессию</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    value={editForm.basePrice}
                                    onChange={e => setEditForm(f => ({ ...f, basePrice: e.target.value }))}
                                    className="flex-1 px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                    placeholder="0"
                                />
                                <select
                                    value={editForm.currency}
                                    onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}
                                    className="px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                >
                                    <option value="GEL">GEL</option>
                                    <option value="USD">USD</option>
                                    <option value="EUR">EUR</option>
                                    <option value="RUB">RUB</option>
                                </select>
                            </div>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-unbox-dark mb-1">
                                <span className="flex items-center gap-1"><Tag className="w-3.5 h-3.5" /> Теги</span>
                            </label>
                            <input
                                type="text"
                                value={editForm.tags}
                                onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))}
                                className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                                placeholder="через запятую: тревога, пары, онлайн"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-100">
                        <button
                            onClick={() => setEditingProfile(false)}
                            className="px-4 py-2 text-sm text-unbox-grey hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSaveProfile}
                            disabled={!editForm.name.trim()}
                            className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                        >
                            <Check className="w-4 h-4" />
                            Сохранить
                        </button>
                    </div>
                </div>
            )}

            {/* ═══ Two-Column Layout ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* ── Left Column (Notes + Sessions) ── */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Notes Section */}
                    <section className="bg-white rounded-2xl border border-unbox-light shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-unbox-light flex justify-between items-center">
                            <h2 className="text-lg font-semibold text-unbox-dark flex items-center gap-2">
                                <FileText className="w-5 h-5 text-gray-400" />
                                Заметки
                            </h2>
                            <button
                                onClick={() => setShowNoteForm(!showNoteForm)}
                                className="text-sm font-medium text-unbox-green hover:text-unbox-dark flex items-center gap-1 transition-colors"
                            >
                                <Plus className="w-4 h-4" /> Написать
                            </button>
                        </div>

                        {showNoteForm && (
                            <NoteInlineForm onSave={handleAddNote} onCancel={() => setShowNoteForm(false)} />
                        )}

                        <div className="p-5 bg-gray-50/30">
                            {notes.filter(n => !n.sessionId).length === 0 && !showNoteForm ? (
                                <div className="text-center py-8 text-gray-500 text-sm border-2 border-dashed border-gray-200 rounded-xl">
                                    Заметок пока нет. Добавьте первую запись, чтобы отслеживать процесс терапии.
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {notes.filter(n => !n.sessionId).map(note => (
                                        <div key={note.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm group">
                                            <div className="flex justify-between items-start mb-2">
                                                <span className="text-xs text-gray-500 font-medium">
                                                    {format(parseISO(note.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    {note.tags && (
                                                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                                                            {note.tags}
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={() => handleDeleteNote(note.id)}
                                                        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{note.content}</p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>

                    {/* Upcoming Sessions */}
                    {futureSessions.length > 0 && (
                        <section className="bg-white rounded-2xl border border-blue-100 shadow-sm overflow-hidden">
                            <div className="px-5 py-3 border-b border-blue-50 bg-blue-50/30 flex justify-between items-center">
                                <h2 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                                    <Calendar className="w-4 h-4 text-blue-500" />
                                    Ближайшие сессии
                                </h2>
                                <span className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-0.5 rounded-full">
                                    {futureSessions.length} запланировано
                                </span>
                            </div>
                            <div className="divide-y divide-blue-50/50">
                                {futureSessions.slice(0, 3).map(s => (
                                    <div key={s.id} className={`px-5 py-2.5 flex justify-between items-center hover:bg-blue-50/30 transition-colors ${s.isBooked ? 'bg-green-50/30' : ''}`}>
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${s.isBooked ? 'bg-green-400' : 'bg-red-400'}`} />
                                            <span className="text-sm font-medium text-gray-900">
                                                {format(parseISO(s.date), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                            </span>
                                            {!s.isBooked && (
                                                <span className="text-xs px-1.5 py-0.5 bg-red-50 text-red-600 rounded">Нет брони</span>
                                            )}
                                        </div>
                                        <span className="text-sm font-medium text-gray-600">
                                            {s.price ?? client.basePrice} {client.currency}
                                        </span>
                                    </div>
                                ))}
                                {futureSessions.length > 3 && (
                                    <div className="px-5 py-2 text-center text-xs text-gray-500 bg-gray-50/50">
                                        И ещё {futureSessions.length - 3} сессий в будущем
                                    </div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* Session History (PsyCRM-style table) */}
                    <section className="bg-white rounded-2xl border border-unbox-light shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-unbox-light flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
                            <h2 className="text-lg font-semibold text-unbox-dark flex items-center gap-2">
                                <Calendar className="w-5 h-5 text-gray-400" />
                                История сессий
                            </h2>
                            <button
                                onClick={async () => {
                                    try {
                                        const r = await crmApi.autoCompleteSessions();
                                        if (r.autoCompleted > 0) {
                                            toast.success(`Завершено автоматически: ${r.autoCompleted}`);
                                            loadData();
                                        } else {
                                            toast.info('Нет сессий для автозавершения');
                                        }
                                    } catch { toast.error('Ошибка'); }
                                }}
                                className="flex items-center gap-1.5 text-sm text-unbox-grey hover:text-unbox-dark font-medium transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" />
                                Синхронизировать историю
                            </button>
                        </div>

                        {pastSessions.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 text-sm">
                                У клиента пока нет состоявшихся сессий.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200">
                                        <tr>
                                            <th className="px-5 py-3 font-medium">Дата</th>
                                            <th className="px-5 py-3 font-medium">Статус</th>
                                            <th className="px-5 py-3 font-medium">Ставка</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {pastSessions.map(session => {
                                            const dt = parseISO(session.date);
                                            const sessionPrice = session.price ?? client.basePrice;
                                            const isCancelled = session.status === 'CANCELLED_CLIENT' || session.status === 'CANCELLED_THERAPIST';
                                            const isEditing = editingSession === session.id;

                                            return (
                                                <tr key={session.id} className={`hover:bg-gray-50 cursor-pointer transition-colors ${session.isPaid ? 'bg-green-50/30' : isCancelled ? '' : 'bg-red-50/30'}`}>
                                                    <td className="px-5 py-3 text-gray-900 font-medium">
                                                        <div className="flex flex-col gap-0.5">
                                                            <span>{format(dt, 'dd MMM yyyy, HH:mm', { locale: ru })}</span>
                                                            {/* Session note toggle */}
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (sessionNoteId === session.id) {
                                                                        setSessionNoteId(null);
                                                                    } else {
                                                                        setSessionNoteId(session.id);
                                                                        const existing = notesBySession.get(session.id);
                                                                        setSessionNoteText(existing?.content || '');
                                                                        setSessionNoteTags(existing?.tags || '');
                                                                    }
                                                                }}
                                                                className="text-xs text-gray-400 hover:text-amber-600 flex items-center gap-1 transition-colors w-fit"
                                                            >
                                                                <StickyNote className="w-3 h-3" />
                                                                {notesBySession.has(session.id)
                                                                    ? <span className="text-amber-600 italic truncate max-w-[200px]">{notesBySession.get(session.id)?.content}</span>
                                                                    : 'Добавить заметку'
                                                                }
                                                            </button>
                                                            {/* Inline note form */}
                                                            {sessionNoteId === session.id && (
                                                                <div className="mt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
                                                                    <textarea
                                                                        value={sessionNoteText}
                                                                        onChange={e => setSessionNoteText(e.target.value)}
                                                                        placeholder="Заметка к сессии..."
                                                                        rows={2}
                                                                        className="w-full px-2.5 py-1.5 rounded-lg border border-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-300 text-xs resize-none bg-white"
                                                                    />
                                                                    <div className="flex items-center gap-1.5">
                                                                        <button
                                                                            onClick={() => handleAddSessionNote(session.id)}
                                                                            disabled={savingSessionNote || !sessionNoteText.trim()}
                                                                            className="px-2.5 py-1 bg-amber-500 text-white text-xs font-medium rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50"
                                                                        >
                                                                            {savingSessionNote ? '...' : 'Сохранить'}
                                                                        </button>
                                                                        <button onClick={() => setSessionNoteId(null)} className="p-1 text-gray-400 hover:text-gray-600">
                                                                            <X className="w-3 h-3" />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-5 py-3">
                                                        <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${STATUS_COLORS[session.status] || 'bg-gray-100'}`}>
                                                            {STATUS_LABELS[session.status] || session.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3 text-gray-800 font-medium">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span>{sessionPrice} {client.currency}</span>
                                                            {!isCancelled && (
                                                                <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                                                    {session.isPaid ? (
                                                                        <button
                                                                            onClick={() => handleUnmarkPaid(session.id)}
                                                                            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-lg hover:bg-red-100 hover:text-red-600 transition-colors font-medium"
                                                                            title="Нажми чтобы отменить оплату"
                                                                        >
                                                                            Оплачено
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            onClick={() => handleQuickPay(session.id)}
                                                                            className="text-xs px-2 py-1 bg-unbox-green text-white rounded-lg hover:bg-unbox-dark transition-colors font-medium flex items-center gap-1"
                                                                        >
                                                                            <Check className="w-3 h-3" />
                                                                            Оплатить
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        onClick={() => setEditingSession(isEditing ? null : session.id)}
                                                                        className={`p-1 rounded-lg transition-colors ${isEditing ? 'bg-unbox-light text-unbox-green' : 'text-gray-400 hover:text-unbox-green hover:bg-unbox-light/50'}`}
                                                                    >
                                                                        <Pencil className="w-3 h-3" />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                        {/* Quick status change */}
                                                        {isEditing && (
                                                            <div className="mt-2 flex flex-wrap gap-1.5" onClick={e => e.stopPropagation()}>
                                                                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                                                    <button
                                                                        key={key}
                                                                        onClick={() => handleUpdateSession(session.id, { status: key as CrmSession['status'] })}
                                                                        className={`px-2 py-0.5 text-xs rounded-lg border transition-colors ${
                                                                            session.status === key
                                                                                ? 'bg-unbox-green text-white border-unbox-green'
                                                                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                                                        }`}
                                                                    >
                                                                        {label}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>

                {/* ── Right Column (Finance) ── */}
                <div className="space-y-6">
                    <section className="bg-white rounded-2xl border border-unbox-light shadow-sm overflow-hidden">
                        <div className="p-5 border-b border-unbox-light flex justify-between items-center">
                            <h2 className="text-lg font-semibold text-unbox-dark flex items-center gap-2">
                                <Wallet className="w-5 h-5 text-gray-400" />
                                Финансы
                            </h2>
                        </div>

                        <div className="p-5 space-y-4">
                            <div className="p-4 bg-gray-50 border border-gray-100 rounded-xl">
                                <div className="text-sm text-gray-500 mb-1">Ставка за сессию</div>
                                <div className="text-xl font-semibold text-gray-900">{client.basePrice} {client.currency}</div>
                            </div>

                            <div className="p-4 rounded-xl border bg-green-50 border-green-100">
                                <div className="text-sm mb-1 text-green-600">LTV</div>
                                <div className="text-xl font-semibold text-green-700">
                                    {stats.totalPaid} {client.currency}
                                </div>
                            </div>

                            {stats.debt > 0 && (
                                <div className="p-4 rounded-xl border bg-red-50 border-red-100">
                                    <div className="text-sm mb-1 text-red-600">Текущий долг клиента</div>
                                    <div className="text-xl font-semibold text-red-700">
                                        {stats.debt} {client.currency}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Payment History */}
                        <div className="border-t border-gray-100">
                            <h3 className="text-xs font-semibold text-gray-500 uppercase px-5 py-3 bg-gray-50">История оплат</h3>
                            {payments.length === 0 ? (
                                <div className="p-5 text-center text-sm text-gray-500">
                                    Оплаты отсутствуют.
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-100 max-h-60 overflow-y-auto">
                                    {payments.map(p => (
                                        <div key={p.id} className="p-4 flex justify-between items-center hover:bg-gray-50 text-sm">
                                            <div>
                                                <div className="font-medium text-gray-900">
                                                    {p.amount} {p.currency}
                                                </div>
                                                <div className="text-xs text-gray-500">{p.account}</div>
                                            </div>
                                            <div className="text-xs text-gray-400">
                                                {format(parseISO(p.date || p.createdAt), 'dd.MM.yyyy', { locale: ru })}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}

// ── Note Inline Form ─────────────────────────────────────────────────────────

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
                onChange={e => setContent(e.target.value)}
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
                    onChange={e => setTags(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-lg border border-unbox-light text-xs focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green bg-white"
                    placeholder="Теги через запятую (необязательно)"
                />
                <button type="button" onClick={onCancel} className="p-1.5 hover:bg-unbox-light/50 rounded-lg transition-colors">
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
