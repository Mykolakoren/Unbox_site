import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { AccountSelect } from '../../components/crm/AccountSelect';
import type { CrmClient, CrmSession, CrmNote, CrmPayment } from '../../api/crm';
import {
    ArrowLeft, Phone, Mail, Tag, Wallet, Calendar, StickyNote,
    Plus, Trash2, Check, X, Loader2, Pencil, Send,
    CheckCheck, RefreshCw, FileText,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { parseUTC } from '../../utils/dateUtils';
import { CURRENCIES } from '../../utils/currency';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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
    const gridHouse = useDesignFlag();
    const { clientId } = useParams<{ clientId: string }>();
    const navigate = useNavigate();
    const { updateSession, createNote, deleteNote, paymentAccounts } = useCrmStore();

    const [client, setClient] = useState<CrmClient | null>(null);
    const [sessions, setSessions] = useState<CrmSession[]>([]);
    const [notes, setNotes] = useState<CrmNote[]>([]);
    const [payments, setPayments] = useState<CrmPayment[]>([]);
    const [balance, setBalance] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [showNoteForm, setShowNoteForm] = useState(false);
    const [editingSession, setEditingSession] = useState<string | null>(null);
    const [editSessionPrice, setEditSessionPrice] = useState('');
    const [editSessionAccount, setEditSessionAccount] = useState('');
    const [sessionNoteId, setSessionNoteId] = useState<string | null>(null);
    const [sessionNoteText, setSessionNoteText] = useState('');
    const [sessionNoteTags, setSessionNoteTags] = useState('');
    const [savingSessionNote, setSavingSessionNote] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const [showSyncPicker, setShowSyncPicker] = useState(false);
    const [syncMonthsBack, setSyncMonthsBack] = useState(1);
    const [syncMonthsForward, setSyncMonthsForward] = useState(1);
    const [syncing, setSyncing] = useState(false);
    const [editingProfile, setEditingProfile] = useState(false);
    const [editForm, setEditForm] = useState({
        name: '', phone: '', email: '', telegram: '', aliasCode: '', basePrice: '', currency: 'GEL', defaultAccount: 'cash', tags: '',
    });
    const [applyPriceTo, setApplyPriceTo] = useState<'none' | 'all_unpaid' | 'future_only'>('none');

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
        const unpaid = sessions.filter(s => !s.isPaid && s.status === 'COMPLETED');
        const debt = unpaid.reduce((sum, s) => sum + (s.price ?? client?.basePrice ?? 0), 0);
        const totalPaid = balance?.totalPaid ?? 0;
        const paidByCurrency: Record<string, number> = balance?.paidByCurrency ?? {};
        const debtByCurrency: Record<string, number> = balance?.debtByCurrency ?? {};
        return { completed, unpaidCount: unpaid.length, debt, totalPaid, paidByCurrency, debtByCurrency };
    }, [sessions, client, balance]);

    const notesBySession = useMemo(() => {
        const map = new Map<string, CrmNote>();
        notes.forEach(n => { if (n.sessionId) map.set(n.sessionId, n); });
        return map;
    }, [notes]);

    // Split sessions into future and past
    const now = new Date();
    const futureSessions = useMemo(() =>
        sessions.filter(s => parseUTC(s.date) > now && s.status !== 'CANCELLED_CLIENT' && s.status !== 'CANCELLED_THERAPIST')
            .sort((a, b) => parseUTC(a.date).getTime() - parseUTC(b.date).getTime()),
        [sessions]
    );
    const pastSessions = useMemo(() =>
        sessions.filter(s => parseUTC(s.date) <= now)
            .sort((a, b) => parseUTC(b.date).getTime() - parseUTC(a.date).getTime()),
        [sessions]
    );

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleQuickPay = async (sessionId: string, account?: string) => {
        try {
            const result = await crmApi.quickPaySession(sessionId, account);
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, isPaid: true } : s));
            const accLabel = result.account ? (paymentAccounts.find(a => a.id === result.account)?.label || result.account) : '';
            toast.success(`Оплачено: ${result.amount} ${result.currency}${accLabel ? ` · ${accLabel}` : ''}`);
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
            defaultAccount: client.defaultAccount || 'cash',
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
                defaultAccount: editForm.defaultAccount,
                tags: tags.length ? tags : [],
            }, applyPriceTo !== 'none' ? applyPriceTo : undefined);
            setClient(updated);
            setEditingProfile(false);
            setApplyPriceTo('none');
            toast.success('Профиль обновлён');
            if (applyPriceTo !== 'none') loadData();
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
            <div className="flex items-center justify-center h-64" style={gridHouse ? { fontFamily: GH_SANS, color: GH.ink, background: GH.paper } : undefined}>
                <Loader2 className="w-8 h-8 animate-spin text-unbox-grey" />
            </div>
        );
    }

    if (!client) {
        return (
            <div className="text-center py-20 text-unbox-grey" style={gridHouse ? { fontFamily: GH_SANS, color: GH.ink, background: GH.paper } : undefined}>
                <p className="text-lg font-medium">Клиент не найден</p>
                <button onClick={() => navigate('/crm/clients')} className="mt-4 text-sm text-unbox-green hover:underline">
                    Вернуться к списку
                </button>
            </div>
        );
    }

    return (

        <GridHouseCrmClientDetail
            client={client}
            sessions={sessions}
            notes={notes}
            payments={payments}
            stats={stats}
            futureSessions={futureSessions}
            pastSessions={pastSessions}
            notesBySession={notesBySession}
            editingProfile={editingProfile}
            editForm={editForm}
            setEditForm={setEditForm}
            openEditProfile={openEditProfile}
            handleSaveProfile={handleSaveProfile}
            setEditingProfile={setEditingProfile}
            showNoteForm={showNoteForm}
            setShowNoteForm={setShowNoteForm}
            handleAddNote={handleAddNote}
            handleDeleteNote={handleDeleteNote}
            editingSession={editingSession}
            setEditingSession={setEditingSession}
            editSessionPrice={editSessionPrice}
            setEditSessionPrice={setEditSessionPrice}
            editSessionAccount={editSessionAccount}
            setEditSessionAccount={setEditSessionAccount}
            handleUpdateSession={handleUpdateSession}
            handleQuickPay={handleQuickPay}
            handleUnmarkPaid={handleUnmarkPaid}
            handleMarkAllPaid={handleMarkAllPaid}
            markingAll={markingAll}
            sessionNoteId={sessionNoteId}
            setSessionNoteId={setSessionNoteId}
            sessionNoteText={sessionNoteText}
            setSessionNoteText={setSessionNoteText}
            sessionNoteTags={sessionNoteTags}
            setSessionNoteTags={setSessionNoteTags}
            savingSessionNote={savingSessionNote}
            handleAddSessionNote={handleAddSessionNote}
            showSyncPicker={showSyncPicker}
            setShowSyncPicker={setShowSyncPicker}
            syncMonthsBack={syncMonthsBack}
            setSyncMonthsBack={setSyncMonthsBack}
            syncMonthsForward={syncMonthsForward}
            setSyncMonthsForward={setSyncMonthsForward}
            syncing={syncing}
            setSyncing={setSyncing}
            applyPriceTo={applyPriceTo}
            setApplyPriceTo={setApplyPriceTo}
            clientId={clientId!}
            loadData={loadData}
            navigate={navigate}
            paymentAccounts={paymentAccounts}
        />
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

// ─── Grid House: CrmClientDetail ────────────────────────────────────────────

interface GHClientDetailProps {
    client: CrmClient;
    sessions: CrmSession[];
    notes: CrmNote[];
    payments: CrmPayment[];
    stats: { completed: number; unpaidCount: number; debt: number; totalPaid: number; paidByCurrency: Record<string, number>; debtByCurrency: Record<string, number> };
    futureSessions: CrmSession[];
    pastSessions: CrmSession[];
    notesBySession: Map<string, CrmNote>;
    editingProfile: boolean;
    editForm: { name: string; phone: string; email: string; telegram: string; aliasCode: string; basePrice: string; currency: string; defaultAccount: string; tags: string };
    setEditForm: React.Dispatch<React.SetStateAction<GHClientDetailProps['editForm']>>;
    openEditProfile: () => void;
    handleSaveProfile: () => Promise<void>;
    setEditingProfile: (v: boolean) => void;
    showNoteForm: boolean;
    setShowNoteForm: (v: boolean) => void;
    handleAddNote: (content: string, tags?: string) => Promise<void>;
    handleDeleteNote: (noteId: string) => Promise<void>;
    editingSession: string | null;
    setEditingSession: (id: string | null) => void;
    editSessionPrice: string;
    setEditSessionPrice: (v: string) => void;
    editSessionAccount: string;
    setEditSessionAccount: (v: string) => void;
    handleUpdateSession: (sessionId: string, data: Partial<CrmSession>) => Promise<void>;
    handleQuickPay: (sessionId: string, account?: string) => Promise<void>;
    handleUnmarkPaid: (sessionId: string) => Promise<void>;
    handleMarkAllPaid: () => Promise<void>;
    markingAll: boolean;
    sessionNoteId: string | null;
    setSessionNoteId: (id: string | null) => void;
    sessionNoteText: string;
    setSessionNoteText: (v: string) => void;
    sessionNoteTags: string;
    setSessionNoteTags: (v: string) => void;
    savingSessionNote: boolean;
    handleAddSessionNote: (sId: string) => Promise<void>;
    showSyncPicker: boolean;
    setShowSyncPicker: (v: boolean) => void;
    syncMonthsBack: number;
    setSyncMonthsBack: (v: number) => void;
    syncMonthsForward: number;
    setSyncMonthsForward: (v: number) => void;
    syncing: boolean;
    setSyncing: (v: boolean) => void;
    applyPriceTo: 'none' | 'all_unpaid' | 'future_only';
    setApplyPriceTo: (v: 'none' | 'all_unpaid' | 'future_only') => void;
    clientId: string;
    loadData: () => Promise<void>;
    navigate: ReturnType<typeof useNavigate>;
    paymentAccounts: { id: string; label: string }[];
}

const ghMono: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', color: GH.ink60 };
const ghHairline = `1px solid ${GH.ink10}`;

const GH_STATUS_COLORS: Record<string, { bg: string; color: string }> = {
    PLANNED: { bg: 'rgba(71,109,107,0.10)', color: GH.accent },
    COMPLETED: { bg: 'rgba(71,109,107,0.15)', color: '#2D5250' },
    CANCELLED_CLIENT: { bg: 'rgba(184,74,47,0.10)', color: GH.danger },
    CANCELLED_THERAPIST: { bg: 'rgba(184,74,47,0.08)', color: '#A04030' },
};

function GridHouseCrmClientDetail(props: GHClientDetailProps) {
    const {
        client, sessions: _sessions, notes, payments, stats, futureSessions, pastSessions, notesBySession,
        editingProfile, editForm, setEditForm, openEditProfile, handleSaveProfile, setEditingProfile,
        showNoteForm, setShowNoteForm, handleAddNote, handleDeleteNote,
        editingSession, setEditingSession, editSessionPrice, setEditSessionPrice,
        editSessionAccount, setEditSessionAccount, handleUpdateSession,
        handleQuickPay, handleUnmarkPaid, handleMarkAllPaid, markingAll,
        sessionNoteId, setSessionNoteId, sessionNoteText, setSessionNoteText,
        sessionNoteTags: _sessionNoteTags, setSessionNoteTags, savingSessionNote, handleAddSessionNote,
        showSyncPicker, setShowSyncPicker, syncMonthsBack, setSyncMonthsBack,
        syncMonthsForward, setSyncMonthsForward, syncing, setSyncing,
        applyPriceTo, setApplyPriceTo,
        clientId, loadData, navigate, paymentAccounts,
    } = props;

    const ghInput: React.CSSProperties = {
        fontFamily: GH_SANS, fontSize: 13, padding: '8px 12px',
        border: ghHairline, background: '#fff', color: GH.ink,
        outline: 'none', width: '100%',
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, minHeight: '100vh' }}>

            {/* ── Back link ── */}
            <div style={{ padding: '24px 32px 0' }}>
                <button
                    onClick={() => navigate('/crm/clients')}
                    style={{
                        ...ghMono, display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60,
                    }}
                >
                    <ArrowLeft size={14} /> К списку клиентов
                </button>
            </div>

            {/* ── Head ── */}
            <div style={{ padding: '20px 32px 0' }}>
                <div style={ghMono}>CRM · Клиент</div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                        {/* Avatar */}
                        <div style={{
                            width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 22, fontWeight: 800, color: GH.paper,
                            background: client.isActive ? GH.accent : GH.ink30,
                        }}>
                            {client.name?.[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div>
                            <h1 style={{
                                fontFamily: GH_SANS, fontSize: 'clamp(28px, 3.5vw, 42px)',
                                fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1, margin: 0,
                            }}>
                                {client.name}
                                {client.aliasCode && (
                                    <span style={{ color: GH.ink30, fontWeight: 400, fontSize: '0.55em', marginLeft: 8 }}>#{client.aliasCode}</span>
                                )}
                            </h1>
                            {/* Contact row */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginTop: 8 }}>
                                {client.phone && (
                                    <span style={{ ...ghMono, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                        <Phone size={12} />{client.phone}
                                    </span>
                                )}
                                {client.telegram && (
                                    <span style={{ ...ghMono, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                        <Send size={12} />{client.telegram}
                                    </span>
                                )}
                                {client.email && (
                                    <span style={{ ...ghMono, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                                        <Mail size={12} />{client.email}
                                    </span>
                                )}
                            </div>
                            {/* Tags */}
                            {client.tags?.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                    {client.tags.map(tag => (
                                        <span key={tag} style={{
                                            ...ghMono, fontSize: 9, padding: '3px 8px',
                                            background: GH.ink5, border: ghHairline,
                                        }}>
                                            {tag}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    {/* Action buttons */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {stats.unpaidCount > 0 && (
                            <button
                                onClick={handleMarkAllPaid}
                                disabled={markingAll}
                                style={{
                                    fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                                    padding: '10px 20px', background: GH.accent, color: GH.paper,
                                    border: 'none', cursor: 'pointer', opacity: markingAll ? 0.5 : 1,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                            >
                                {markingAll ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                                Оплатить все ({stats.unpaidCount})
                            </button>
                        )}
                        <button
                            onClick={openEditProfile}
                            style={{
                                fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                                padding: '10px 16px', background: 'transparent', border: ghHairline,
                                cursor: 'pointer', color: GH.ink60, display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <Pencil size={14} /> Редактировать
                        </button>
                        <button
                            onClick={() => navigate('/crm/sessions')}
                            style={{
                                fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                                padding: '10px 20px', background: GH.ink, color: GH.paper,
                                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <Plus size={14} /> Новая сессия
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Anchor KPI + secondary ── */}
            <div style={{
                display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                padding: '32px 32px 24px', flexWrap: 'wrap', gap: 24,
            }}>
                <div>
                    {Object.keys(stats.paidByCurrency).length > 1 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {Object.entries(stats.paidByCurrency).map(([cur, amt]) => (
                                <div key={cur} style={{
                                    fontFamily: GH_MONO, fontSize: 'clamp(28px, 3.5vw, 44px)',
                                    fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                                }}>
                                    {amt}
                                    <span style={{ fontSize: '0.4em', marginLeft: 4, color: GH.ink30 }}>{cur}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{
                            fontFamily: GH_MONO, fontSize: 'clamp(40px, 5vw, 64px)',
                            fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                        }}>
                            {stats.totalPaid}
                            <span style={{ fontSize: '0.4em', marginLeft: 4, color: GH.ink30 }}>{Object.keys(stats.paidByCurrency)[0] || client.currency}</span>
                        </div>
                    )}
                    <div style={{ ...ghMono, marginTop: 4 }}>LTV</div>
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                    {[
                        { label: 'Сессий', value: stats.completed },
                        { label: 'Ставка', value: `${client.basePrice}` },
                        { label: 'Не оплачено', value: stats.unpaidCount, color: stats.unpaidCount > 0 ? GH.danger : undefined },
                        ...(stats.debt > 0 ? [{ label: 'Долг', value: Object.keys(stats.debtByCurrency).length > 1
                            ? Object.entries(stats.debtByCurrency).map(([c, a]) => `${a} ${c}`).join(' / ')
                            : `${stats.debt} ${Object.keys(stats.debtByCurrency)[0] || client.currency}`, color: GH.danger }] : []),
                    ].map(kpi => (
                        <div key={kpi.label} style={{ textAlign: 'right' }}>
                            <div style={{
                                fontFamily: GH_MONO, fontSize: 22, fontWeight: 700,
                                fontVariantNumeric: 'tabular-nums', color: kpi.color || GH.ink,
                            }}>
                                {kpi.value}
                            </div>
                            <div style={{ ...ghMono, fontSize: 9 }}>{kpi.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Thick header border ── */}
            <div style={{ margin: '0 32px', borderBottom: `2px solid ${GH.ink}` }} />

            {/* ── Edit Profile Form ── */}
            {editingProfile && (
                <div style={{ margin: '24px 32px', padding: 24, border: `1px solid ${GH.accent}`, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div style={{ ...ghMono, color: GH.accent }}>Редактировать профиль</div>
                        <button onClick={() => setEditingProfile(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}>
                            <X size={18} />
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Имя *</label>
                            <input style={ghInput} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Телефон</label>
                            <input style={ghInput} value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} placeholder="+995..." />
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Email</label>
                            <input style={ghInput} type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Telegram</label>
                            <input style={ghInput} value={editForm.telegram} onChange={e => setEditForm(f => ({ ...f, telegram: e.target.value }))} placeholder="@username" />
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Код клиента</label>
                            <input style={ghInput} value={editForm.aliasCode} onChange={e => setEditForm(f => ({ ...f, aliasCode: e.target.value }))} placeholder="4-значный код" maxLength={4} />
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Ставка</label>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input style={{ ...ghInput, flex: 1 }} type="number" value={editForm.basePrice} onChange={e => setEditForm(f => ({ ...f, basePrice: e.target.value }))} placeholder="0" />
                                <select
                                    style={{ ...ghInput, width: 'auto', minWidth: 80 }}
                                    value={editForm.currency}
                                    onChange={e => setEditForm(f => ({ ...f, currency: e.target.value }))}
                                >
                                    {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>)}
                                </select>
                            </div>
                        </div>
                        <div>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Счёт по умолчанию</label>
                            <AccountSelect value={editForm.defaultAccount} onChange={(v) => setEditForm(f => ({ ...f, defaultAccount: v }))} />
                        </div>
                        <div style={{ gridColumn: '1 / -1' }}>
                            <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Теги</label>
                            <input style={ghInput} value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} placeholder="через запятую: тревога, пары, онлайн" />
                        </div>
                    </div>
                    {(editForm.basePrice !== String(client?.basePrice || '') || editForm.currency !== (client?.currency || 'GEL') || editForm.defaultAccount !== (client?.defaultAccount || 'cash')) && (
                        <div style={{ marginTop: 16, padding: 12, background: 'rgba(184,154,47,0.08)', border: '1px solid rgba(184,154,47,0.25)' }}>
                            <div style={{ ...ghMono, fontSize: 10, color: '#8B7320', marginBottom: 8 }}>Применить к существующим сессиям:</div>
                            {[
                                { value: 'none' as const, label: 'Только для новых сессий' },
                                { value: 'future_only' as const, label: 'Ко всем запланированным (незавершённым)' },
                                { value: 'all_unpaid' as const, label: 'Ко всем неоплаченным' },
                            ].map(opt => (
                                <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, ...ghMono, fontSize: 11, color: '#6B5A18', cursor: 'pointer', marginBottom: 4 }}>
                                    <input type="radio" name="ghApplyPriceTo" checked={applyPriceTo === opt.value} onChange={() => setApplyPriceTo(opt.value)} />
                                    {opt.label}
                                </label>
                            ))}
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20, paddingTop: 16, borderTop: ghHairline }}>
                        <button
                            onClick={() => { setEditingProfile(false); setApplyPriceTo('none'); }}
                            style={{ ...ghMono, padding: '8px 16px', background: 'transparent', border: ghHairline, cursor: 'pointer', color: GH.ink60 }}
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleSaveProfile}
                            disabled={!editForm.name.trim()}
                            style={{
                                fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                                padding: '8px 20px', background: GH.ink, color: GH.paper,
                                border: 'none', cursor: 'pointer', opacity: !editForm.name.trim() ? 0.4 : 1,
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <Check size={14} /> Сохранить
                        </button>
                    </div>
                </div>
            )}

            {/* ── Two-column layout ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 0, padding: '0 32px' }}>

                {/* ── Left column ── */}
                <div style={{ borderRight: ghHairline }}>

                    {/* Notes section */}
                    <div style={{ padding: '24px 24px 24px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div style={ghMono}>Заметки</div>
                            <button
                                onClick={() => setShowNoteForm(!showNoteForm)}
                                style={{
                                    ...ghMono, fontSize: 10, padding: '6px 12px',
                                    background: 'transparent', border: ghHairline,
                                    cursor: 'pointer', color: GH.accent,
                                    display: 'flex', alignItems: 'center', gap: 4,
                                }}
                            >
                                <Plus size={12} /> Написать
                            </button>
                        </div>

                        {showNoteForm && (
                            <NoteInlineForm onSave={handleAddNote} onCancel={() => setShowNoteForm(false)} />
                        )}

                        {notes.filter(n => !n.sessionId).length === 0 && !showNoteForm ? (
                            <div style={{
                                padding: 32, textAlign: 'center', color: GH.ink30,
                                fontSize: 13, border: `1px dashed ${GH.ink10}`,
                            }}>
                                Заметок пока нет. Добавьте первую запись.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {notes.filter(n => !n.sessionId).map(note => (
                                    <div key={note.id} style={{ padding: '12px 16px', border: ghHairline, background: '#fff', position: 'relative' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                                            <span style={{ ...ghMono, fontSize: 9 }}>
                                                {format(parseISO(note.createdAt), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                {note.tags && (
                                                    <span style={{ ...ghMono, fontSize: 9, padding: '2px 6px', background: GH.ink5 }}>
                                                        {note.tags}
                                                    </span>
                                                )}
                                                <button
                                                    onClick={() => handleDeleteNote(note.id)}
                                                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink30, padding: 2 }}
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                        <p style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', margin: 0 }}>{note.content}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ borderBottom: ghHairline, marginRight: 24 }} />

                    {/* Upcoming sessions */}
                    {futureSessions.length > 0 && (
                        <div style={{ padding: '24px 24px 24px 0' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div style={ghMono}>Ближайшие сессии</div>
                                <span style={{ ...ghMono, fontSize: 9, color: GH.accent }}>{futureSessions.length} запланировано</span>
                            </div>
                            {futureSessions.slice(0, 3).map(s => (
                                <div key={s.id} style={{
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    padding: '10px 0', borderBottom: ghHairline,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div style={{
                                            width: 8, height: 8, borderRadius: '50%',
                                            background: s.isBooked ? GH.accent : GH.danger,
                                        }} />
                                        <span style={{ fontSize: 13, fontWeight: 500 }}>
                                            {format(parseUTC(s.date), 'dd MMM yyyy, HH:mm', { locale: ru })}
                                        </span>
                                        {!s.isBooked && (
                                            <button
                                                onClick={() => navigate('/dashboard/bookings', {
                                                    state: { crmMode: { sessionId: s.id, clientId: client.id, clientName: client.name, date: /Z$|[+-]\d{2}:\d{2}$/.test(s.date) ? s.date : s.date + 'Z', duration: s.durationMinutes } },
                                                })}
                                                style={{ ...ghMono, fontSize: 9, padding: '2px 8px', background: 'rgba(184,74,47,0.08)', color: GH.danger, border: 'none', cursor: 'pointer' }}
                                            >
                                                Нет брони
                                            </button>
                                        )}
                                    </div>
                                    <span style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 500, color: GH.ink60 }}>
                                        {s.price ?? client.basePrice} {s.currency ?? client.currency}
                                    </span>
                                </div>
                            ))}
                            {futureSessions.length > 3 && (
                                <div style={{ ...ghMono, fontSize: 9, padding: '10px 0', textAlign: 'center' }}>
                                    И ещё {futureSessions.length - 3} сессий в будущем
                                </div>
                            )}
                            <div style={{ borderBottom: ghHairline, marginTop: 24, marginRight: 24 }} />
                        </div>
                    )}

                    {/* Session history */}
                    <div style={{ padding: '24px 24px 24px 0' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <div style={ghMono}>История сессий</div>
                            <div style={{ position: 'relative' }}>
                                <button
                                    onClick={() => setShowSyncPicker(!showSyncPicker)}
                                    disabled={syncing}
                                    style={{
                                        ...ghMono, fontSize: 10, padding: '6px 12px',
                                        background: 'transparent', border: ghHairline,
                                        cursor: 'pointer', color: GH.ink60,
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                >
                                    {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                    Синхронизация
                                </button>
                                {showSyncPicker && (
                                    <div
                                        style={{ position: 'fixed', inset: 0, background: 'rgba(15,15,16,0.3)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        onClick={() => setShowSyncPicker(false)}
                                    >
                                        <div
                                            style={{ background: '#fff', border: `2px solid ${GH.ink}`, padding: 24, width: 340 }}
                                            onClick={e => e.stopPropagation()}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                                                <div style={{ ...ghMono, color: GH.ink }}>Период синхронизации</div>
                                                <button onClick={() => setShowSyncPicker(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink60 }}>
                                                    <X size={16} />
                                                </button>
                                            </div>
                                            <div style={{ marginBottom: 12 }}>
                                                <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Назад</label>
                                                <select style={ghInput} value={syncMonthsBack} onChange={e => setSyncMonthsBack(Number(e.target.value))}>
                                                    {[1, 3, 6, 12, 24, 60].map(m => <option key={m} value={m}>{m === 1 ? '1 месяц' : m === 3 ? '3 месяца' : m === 6 ? '6 месяцев' : m === 12 ? '1 год' : m === 24 ? '2 года' : '5 лет'}</option>)}
                                                </select>
                                            </div>
                                            <div style={{ marginBottom: 16 }}>
                                                <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Вперёд</label>
                                                <select style={ghInput} value={syncMonthsForward} onChange={e => setSyncMonthsForward(Number(e.target.value))}>
                                                    {[1, 3, 6, 12].map(m => <option key={m} value={m}>{m === 1 ? '1 месяц' : m === 3 ? '3 месяца' : m === 6 ? '6 месяцев' : '1 год'}</option>)}
                                                </select>
                                            </div>
                                            <div style={{ display: 'flex', gap: 12 }}>
                                                <button
                                                    onClick={() => setShowSyncPicker(false)}
                                                    style={{ ...ghMono, flex: 1, padding: '10px', background: 'transparent', border: ghHairline, cursor: 'pointer', color: GH.ink60 }}
                                                >
                                                    Отмена
                                                </button>
                                                <button
                                                    onClick={async () => {
                                                        setSyncing(true);
                                                        setShowSyncPicker(false);
                                                        try {
                                                            const r = await crmApi.syncClientHistory(clientId, syncMonthsBack, syncMonthsForward);
                                                            toast.success(`Найдено: ${r.totalFound}, создано: ${r.created}`);
                                                            loadData();
                                                        } catch (err: any) {
                                                            toast.error(err?.response?.data?.detail || 'Ошибка синхронизации');
                                                        } finally {
                                                            setSyncing(false);
                                                        }
                                                    }}
                                                    style={{
                                                        fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
                                                        flex: 1, padding: '10px', background: GH.ink, color: GH.paper,
                                                        border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                    }}
                                                >
                                                    <RefreshCw size={12} /> Синхронизировать
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {pastSessions.length === 0 ? (
                            <div style={{ padding: 32, textAlign: 'center', color: GH.ink30, fontSize: 13 }}>
                                У клиента пока нет состоявшихся сессий.
                            </div>
                        ) : (
                            <>
                                {/* Table header */}
                                <div style={{
                                    display: 'grid', gridTemplateColumns: '1fr auto auto',
                                    padding: '8px 0', borderBottom: `2px solid ${GH.ink}`,
                                }}>
                                    <div style={{ ...ghMono, fontSize: 9 }}>Дата</div>
                                    <div style={{ ...ghMono, fontSize: 9, textAlign: 'center', minWidth: 100 }}>Статус</div>
                                    <div style={{ ...ghMono, fontSize: 9, textAlign: 'right', minWidth: 140 }}>Ставка</div>
                                </div>

                                {/* Rows */}
                                {pastSessions.map(session => {
                                    const dt = parseUTC(session.date);
                                    const sessionPrice = session.price ?? client.basePrice;
                                    const isCancelled = session.status === 'CANCELLED_CLIENT' || session.status === 'CANCELLED_THERAPIST';
                                    const isEditing = editingSession === session.id;
                                    const statusStyle = GH_STATUS_COLORS[session.status] || { bg: GH.ink5, color: GH.ink60 };

                                    return (
                                        <div key={session.id} style={{ borderBottom: ghHairline }}>
                                            <div style={{
                                                display: 'grid', gridTemplateColumns: '1fr auto auto',
                                                padding: '12px 0', alignItems: 'start',
                                                background: session.isPaid ? 'rgba(71,109,107,0.03)' : isCancelled ? 'transparent' : 'rgba(184,74,47,0.03)',
                                            }}>
                                                {/* Date + session note */}
                                                <div>
                                                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                                                        {format(dt, 'dd MMM yyyy, HH:mm', { locale: ru })}
                                                    </span>
                                                    <button
                                                        onClick={() => {
                                                            if (sessionNoteId === session.id) {
                                                                setSessionNoteId(null);
                                                            } else {
                                                                setSessionNoteId(session.id);
                                                                const existing = notesBySession.get(session.id);
                                                                setSessionNoteText(existing?.content || '');
                                                                setSessionNoteTags(existing?.tags || '');
                                                            }
                                                        }}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 4,
                                                            background: 'transparent', border: 'none', cursor: 'pointer',
                                                            marginTop: 4, padding: 0, color: GH.ink30, fontSize: 11,
                                                        }}
                                                    >
                                                        <StickyNote size={11} />
                                                        {notesBySession.has(session.id)
                                                            ? <span style={{ color: GH.accent, fontStyle: 'italic', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
                                                                {notesBySession.get(session.id)?.content}
                                                              </span>
                                                            : <span>Добавить заметку</span>
                                                        }
                                                    </button>
                                                    {sessionNoteId === session.id && (
                                                        <div style={{ marginTop: 8 }} onClick={e => e.stopPropagation()}>
                                                            <textarea
                                                                value={sessionNoteText}
                                                                onChange={e => setSessionNoteText(e.target.value)}
                                                                placeholder="Заметка к сессии..."
                                                                rows={2}
                                                                style={{ ...ghInput, fontSize: 12, resize: 'none', width: '90%' }}
                                                            />
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                                                                <button
                                                                    onClick={() => handleAddSessionNote(session.id)}
                                                                    disabled={savingSessionNote || !sessionNoteText.trim()}
                                                                    style={{
                                                                        ...ghMono, fontSize: 9, padding: '4px 10px',
                                                                        background: GH.accent, color: GH.paper, border: 'none',
                                                                        cursor: 'pointer', opacity: savingSessionNote || !sessionNoteText.trim() ? 0.4 : 1,
                                                                    }}
                                                                >
                                                                    {savingSessionNote ? '...' : 'Сохранить'}
                                                                </button>
                                                                <button onClick={() => setSessionNoteId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: GH.ink30 }}>
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Status */}
                                                <div style={{ display: 'flex', justifyContent: 'center' }}>
                                                    <span style={{
                                                        ...ghMono, fontSize: 9, padding: '3px 10px',
                                                        background: statusStyle.bg, color: statusStyle.color,
                                                    }}>
                                                        {STATUS_LABELS[session.status] || session.status}
                                                    </span>
                                                </div>

                                                {/* Price + actions */}
                                                <div style={{ textAlign: 'right' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                                                        <span style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 500 }}>
                                                            {sessionPrice} {session.currency ?? client.currency}
                                                        </span>
                                                        {!isCancelled && (
                                                            session.isPaid ? (
                                                                <button
                                                                    onClick={() => handleUnmarkPaid(session.id)}
                                                                    style={{
                                                                        ...ghMono, fontSize: 9, padding: '3px 8px',
                                                                        background: 'rgba(71,109,107,0.10)', color: GH.accent,
                                                                        border: 'none', cursor: 'pointer',
                                                                    }}
                                                                    title="Нажми чтобы отменить оплату"
                                                                >
                                                                    Оплачено
                                                                </button>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleQuickPay(session.id, isEditing ? editSessionAccount : undefined)}
                                                                    style={{
                                                                        ...ghMono, fontSize: 9, padding: '3px 8px',
                                                                        background: GH.ink, color: GH.paper,
                                                                        border: 'none', cursor: 'pointer',
                                                                        display: 'flex', alignItems: 'center', gap: 4,
                                                                    }}
                                                                >
                                                                    <Check size={10} /> Оплатить
                                                                </button>
                                                            )
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                if (isEditing) {
                                                                    setEditingSession(null);
                                                                } else {
                                                                    setEditingSession(session.id);
                                                                    setEditSessionPrice(String(session.price ?? client.basePrice));
                                                                    setEditSessionAccount(session.account ?? (client.defaultAccount || 'cash'));
                                                                }
                                                            }}
                                                            style={{
                                                                background: isEditing ? GH.ink5 : 'transparent',
                                                                border: 'none', cursor: 'pointer', padding: 4,
                                                                color: isEditing ? GH.accent : GH.ink30,
                                                            }}
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                    </div>

                                                    {/* Edit panel */}
                                                    {isEditing && (
                                                        <div style={{ marginTop: 8, padding: 12, background: GH.ink5, border: ghHairline, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
                                                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                                                                <div style={{ flex: 1 }}>
                                                                    <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Сумма</label>
                                                                    <input
                                                                        type="number" step="0.01"
                                                                        value={editSessionPrice}
                                                                        onChange={e => setEditSessionPrice(e.target.value)}
                                                                        style={{ ...ghInput, fontSize: 12 }}
                                                                    />
                                                                </div>
                                                                <div style={{ flex: 1 }}>
                                                                    <label style={{ ...ghMono, fontSize: 9, display: 'block', marginBottom: 4 }}>Счёт</label>
                                                                    <AccountSelect value={editSessionAccount} onChange={setEditSessionAccount} />
                                                                </div>
                                                                <button
                                                                    onClick={() => {
                                                                        const newPrice = parseFloat(editSessionPrice);
                                                                        if (!isNaN(newPrice) && newPrice >= 0) {
                                                                            handleUpdateSession(session.id, { price: newPrice });
                                                                        }
                                                                    }}
                                                                    style={{
                                                                        fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                                                        padding: '8px 12px', background: GH.ink, color: GH.paper,
                                                                        border: 'none', cursor: 'pointer',
                                                                    }}
                                                                >
                                                                    OK
                                                                </button>
                                                            </div>
                                                            {/* Status buttons */}
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, paddingTop: 10, borderTop: ghHairline }}>
                                                                {Object.entries(STATUS_LABELS).map(([key, label]) => (
                                                                    <button
                                                                        key={key}
                                                                        onClick={() => handleUpdateSession(session.id, { status: key as CrmSession['status'] })}
                                                                        style={{
                                                                            ...ghMono, fontSize: 9, padding: '3px 10px',
                                                                            background: session.status === key ? GH.ink : 'transparent',
                                                                            color: session.status === key ? GH.paper : GH.ink60,
                                                                            border: session.status === key ? 'none' : ghHairline,
                                                                            cursor: 'pointer',
                                                                        }}
                                                                    >
                                                                        {label}
                                                                    </button>
                                                                ))}
                                                                <button
                                                                    onClick={async () => {
                                                                        if (!confirm('Удалить эту сессию?')) return;
                                                                        try {
                                                                            await crmApi.deleteSession(session.id);
                                                                            toast.success('Сессия удалена');
                                                                            loadData();
                                                                        } catch { toast.error('Ошибка удаления'); }
                                                                    }}
                                                                    style={{
                                                                        ...ghMono, fontSize: 9, padding: '3px 10px',
                                                                        background: 'transparent', border: `1px solid ${GH.danger}`,
                                                                        color: GH.danger, cursor: 'pointer', marginLeft: 'auto',
                                                                    }}
                                                                >
                                                                    Удалить
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </>
                        )}
                    </div>
                </div>

                {/* ── Right column (Finance) ── */}
                <div style={{ padding: '24px 0 24px 24px' }}>
                    <div style={ghMono}>Финансы</div>

                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ padding: '14px 16px', background: GH.cellDead, border: ghHairline }}>
                            <div style={{ ...ghMono, fontSize: 9, marginBottom: 4 }}>Ставка за сессию</div>
                            <div style={{ fontFamily: GH_MONO, fontSize: 20, fontWeight: 700 }}>{client.basePrice} {client.currency}</div>
                        </div>

                        <div style={{ padding: '14px 16px', background: 'rgba(71,109,107,0.06)', border: `1px solid rgba(71,109,107,0.15)` }}>
                            <div style={{ ...ghMono, fontSize: 9, marginBottom: 4, color: GH.accent }}>LTV</div>
                            {Object.keys(stats.paidByCurrency).length > 1 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {Object.entries(stats.paidByCurrency).map(([cur, amt]) => (
                                        <div key={cur} style={{ fontFamily: GH_MONO, fontSize: 17, fontWeight: 700, color: GH.accent }}>
                                            {amt} {cur}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ fontFamily: GH_MONO, fontSize: 20, fontWeight: 700, color: GH.accent }}>
                                    {stats.totalPaid} {Object.keys(stats.paidByCurrency)[0] || client.currency}
                                </div>
                            )}
                        </div>

                        {stats.debt > 0 && (
                            <div style={{ padding: '14px 16px', background: 'rgba(184,74,47,0.06)', border: `1px solid rgba(184,74,47,0.15)` }}>
                                <div style={{ ...ghMono, fontSize: 9, marginBottom: 4, color: GH.danger }}>Текущий долг</div>
                                {Object.keys(stats.debtByCurrency).length > 1 ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {Object.entries(stats.debtByCurrency).map(([cur, amt]) => (
                                            <div key={cur} style={{ fontFamily: GH_MONO, fontSize: 17, fontWeight: 700, color: GH.danger }}>
                                                {amt} {cur}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ fontFamily: GH_MONO, fontSize: 20, fontWeight: 700, color: GH.danger }}>
                                        {stats.debt} {Object.keys(stats.debtByCurrency)[0] || client.currency}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Payment history */}
                    <div style={{ marginTop: 24, borderTop: ghHairline }}>
                        <div style={{ ...ghMono, fontSize: 9, padding: '12px 0 8px' }}>История оплат</div>
                        {payments.length === 0 ? (
                            <div style={{ padding: '24px 0', textAlign: 'center', color: GH.ink30, fontSize: 13 }}>
                                Оплаты отсутствуют.
                            </div>
                        ) : (
                            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                                {payments.map(p => (
                                    <div key={p.id} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '10px 0', borderBottom: ghHairline,
                                    }}>
                                        <div>
                                            <div style={{ fontFamily: GH_MONO, fontSize: 13, fontWeight: 600 }}>
                                                {p.amount} {p.currency}
                                            </div>
                                            <div style={{ ...ghMono, fontSize: 9 }}>
                                                {paymentAccounts.find(a => a.id === p.account)?.label || p.account}
                                            </div>
                                        </div>
                                        <div style={{ ...ghMono, fontSize: 9 }}>
                                            {format(parseISO(p.date || p.createdAt), 'dd.MM.yyyy', { locale: ru })}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Footer ── */}
            <div style={{
                borderTop: `2px solid ${GH.ink}`, margin: '48px 32px 0',
                padding: '12px 0 32px', display: 'flex', justifyContent: 'space-between',
            }}>
                <div style={{ ...ghMono, fontSize: 9 }}>UNBOX · 2026</div>
                <div style={{ ...ghMono, fontSize: 9 }}>GRID HOUSE</div>
            </div>
        </div>
    );
}
