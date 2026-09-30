import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { useUserStore } from '../../store/userStore';
import {
    Plus,
    Search,
    Phone,
    Mail,
    Loader2,
    X,
    Check,
    Pencil,
    Tag,
    Send,
    Merge,
    Trash2,
} from 'lucide-react';
import type { CrmClientCreate, CrmClient } from '../../api/crm';
import { crmApi } from '../../api/crm';
import { AccountSelect } from '../../components/crm/AccountSelect';
import { toast } from 'sonner';
import { CURRENCIES } from '../../utils/currency';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatMoney, formatDayMonth } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Skeleton } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';

/** «1 сессия / 2 сессии / 5 сессий». */
function sessionsWord(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'сессия';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'сессии';
    return 'сессий';
}

type ViewMode = 'table' | 'cards';
type SortField = 'name' | 'basePrice' | 'sessionCount' | 'unpaidSum' | 'totalPaid' | 'lastSessionDate';
type SortDir = 'asc' | 'desc';

const VIEW_KEY = 'crm_clients_view';

export function CrmClients() {
        const { clients, fetchClients, createClient, updateClient, deleteClient, loading, error } =
        useCrmStore();
    const { confirm } = useConfirmDialog();
    // Пока первый ответ не пришёл — скелетон, а не «Клиентов ещё нет» (rule 8).
    const [fetchedOnce, setFetchedOnce] = useState(false);
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        return (localStorage.getItem(VIEW_KEY) as ViewMode) || 'table';
    });
    const [sortField, setSortField] = useState<SortField>('lastSessionDate');
    const [sortDir, setSortDir] = useState<SortDir>('desc');
    const [mergeMode, setMergeMode] = useState(false);
    const [mergeSelected, setMergeSelected] = useState<string[]>([]);
    const [showMergeDialog, setShowMergeDialog] = useState(false);

    const editingClient = editingId ? clients.find((c) => c.id === editingId) ?? null : null;

    useEffect(() => {
        fetchClients(false, true).finally(() => setFetchedOnce(true));
    }, [fetchClients]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDir(field === 'name' ? 'asc' : 'desc');
        }
    };

    const filtered = useMemo(() => {
        let result = clients.filter((c) => {
            if (!showInactive && !c.isActive) return false;
            if (!search) return true;
            const q = search.toLowerCase();
            return (
                c.name.toLowerCase().includes(q) ||
                c.phone?.toLowerCase().includes(q) ||
                c.email?.toLowerCase().includes(q) ||
                c.aliasCode?.includes(q)
            );
        });

        // Sort
        result = [...result].sort((a, b) => {
            const dir = sortDir === 'asc' ? 1 : -1;
            switch (sortField) {
                case 'name':
                    return dir * a.name.localeCompare(b.name);
                case 'basePrice':
                    return dir * ((a.basePrice || 0) - (b.basePrice || 0));
                case 'sessionCount':
                    return dir * (((a as any).sessionCount || 0) - ((b as any).sessionCount || 0));
                case 'unpaidSum':
                    return dir * (((a as any).unpaidSum || 0) - ((b as any).unpaidSum || 0));
                case 'totalPaid':
                    return dir * (((a as any).totalPaid || 0) - ((b as any).totalPaid || 0));
                case 'lastSessionDate': {
                    const da = (a as any).lastSessionDate || '';
                    const db = (b as any).lastSessionDate || '';
                    if (!da && !db) return 0;
                    if (!da) return 1; // no sessions → bottom
                    if (!db) return -1;
                    return dir * da.localeCompare(db);
                }
                default:
                    return 0;
            }
        });

        return result;
    }, [clients, search, showInactive, sortField, sortDir]);

    const handleToggleActive = async (client: CrmClient) => {
        if (client.isActive) {
            await deleteClient(client.id);
            toast.success(`${client.name} деактивирован`);
        } else {
            await updateClient(client.id, { isActive: true });
            toast.success(`${client.name} восстановлен`);
        }
        fetchClients(false, true);
    };

    const setView = (mode: ViewMode) => {
        setViewMode(mode);
        localStorage.setItem(VIEW_KEY, mode);
    };

    // ─── Grid House variant (behind feature flag) ────────────────────────
    return (

            <GridHouseCrmClients
                clients={clients}
                filtered={filtered}
                loading={loading || !fetchedOnce}
                loadError={fetchedOnce && !loading ? error : null}
                onRetry={() => fetchClients(false, true)}
                search={search}
                setSearch={setSearch}
                showInactive={showInactive}
                setShowInactive={setShowInactive}
                sortField={sortField}
                sortDir={sortDir}
                toggleSort={toggleSort}
                navigate={navigate}
                mergeMode={mergeMode}
                setMergeMode={setMergeMode}
                mergeSelected={mergeSelected}
                setMergeSelected={setMergeSelected}
                showMergeDialog={showMergeDialog}
                setShowMergeDialog={setShowMergeDialog}
                showForm={showForm}
                setShowForm={setShowForm}
                editingClient={editingClient}
                editingId={editingId}
                setEditingId={setEditingId}
                onCreate={async (data) => {
                    await createClient(data);
                    setShowForm(false);
                    toast.success('Клиент создан');
                    fetchClients(false, true);
                }}
                onUpdate={async (id, data) => {
                    await updateClient(id, data);
                    setEditingId(null);
                    toast.success('Клиент обновлён');
                    fetchClients(false, true);
                }}
                onToggleActive={handleToggleActive}
                onPermanentDelete={async (client) => {
                    const ok = await confirm({
                        title: `Удалить клиента «${client.name}»?`,
                        body: 'Все сессии, платежи и заметки клиента удалятся навсегда. Вернуть их будет нельзя.',
                        confirmLabel: 'Удалить клиента',
                        cancelLabel: 'Оставить',
                        tone: 'danger',
                    });
                    if (!ok) return;
                    try {
                        await deleteClient(client.id, true);
                        toast.success(`${client.name} удалён`);
                        fetchClients(false, true);
                    } catch (err: any) {
                        toast.error(err?.response?.data?.detail || 'Ошибка удаления');
                    }
                }}
                onMergeConfirm={async (targetId, overrides) => {
                    const sourceIds = mergeSelected.filter(id => id !== targetId);
                    try {
                        const result = await crmApi.mergeClients({ targetId, sourceIds, ...overrides });
                        toast.success(
                            `Объединено ${result.mergedCount} клиентов. Перенесено: ${result.reassigned.sessions} сессий, ${result.reassigned.payments} платежей, ${result.reassigned.notes} заметок`
                        );
                        setShowMergeDialog(false);
                        setMergeMode(false);
                        setMergeSelected([]);
                        fetchClients(false, true);
                    } catch (err: any) {
                        toast.error(err?.response?.data?.detail || 'Ошибка объединения');
                    }
                }}
            />
        );
}


// SortHeader (старая таблица до Grid House) нигде не рендерился — удалён в wave 1.

// ── Client Form ──────────────────────────────────────────────────────────────

function ClientForm({
    onSave,
    onCancel,
    initial,
    isEdit = false,
}: {
    onSave: (data: CrmClientCreate) => Promise<void>;
    onCancel: () => void;
    initial?: Partial<CrmClientCreate>;
    isEdit?: boolean;
}) {
    const [name, setName] = useState(initial?.name ?? '');
    const [phone, setPhone] = useState(initial?.phone ?? '');
    const [email, setEmail] = useState(initial?.email ?? '');
    const [telegram, setTelegram] = useState(initial?.telegram ?? '');
    const [aliasCode, setAliasCode] = useState(initial?.aliasCode ?? '');
    const [basePrice, setBasePrice] = useState(String(initial?.basePrice ?? ''));
    const [currency, setCurrency] = useState(initial?.currency ?? 'GEL');
    const [defaultAccount, setDefaultAccount] = useState(initial?.defaultAccount ?? 'cash');
    const [tagsInput, setTagsInput] = useState((initial?.tags ?? []).join(', '));
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            const tags = tagsInput
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            await onSave({
                name: name.trim(),
                phone: phone || undefined,
                email: email || undefined,
                telegram: telegram || undefined,
                aliasCode: aliasCode || undefined,
                basePrice: basePrice ? Number(basePrice) : undefined,
                currency,
                defaultAccount,
                tags: tags.length ? tags : undefined,
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
            className="bg-card rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{isEdit ? 'Редактировать клиента' : 'Новый клиент'}</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-ink-60" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Имя <span className="text-[var(--status-danger-fg)]">*</span>
                    </label>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="Имя клиента"
                        required
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Телефон</label>
                    <input
                        type="text"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="+995..."
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="email@example.com"
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Telegram</label>
                    <input
                        type="text"
                        value={telegram}
                        onChange={(e) => setTelegram(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="@username"
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Код клиента</label>
                    <input
                        type="text"
                        value={aliasCode}
                        onChange={(e) => setAliasCode(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="4-значный код"
                        maxLength={4}
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Стоимость сессии</label>
                    <input
                        type="number"
                        value={basePrice}
                        onChange={(e) => setBasePrice(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                        placeholder="0"
                    />
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Валюта</label>
                    <select
                        value={currency}
                        onChange={(e) => setCurrency(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    >
                        {CURRENCIES.map(c => (
                            <option key={c.code} value={c.code}>{c.code} ({c.symbol})</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Счёт по умолчанию</label>
                    <AccountSelect value={defaultAccount} onChange={setDefaultAccount} />
                </div>
            </div>

            <div>
                <label className="text-sm font-medium text-unbox-dark mb-1 block flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" /> Теги <span className="text-ink-60 font-normal">(через запятую)</span>
                </label>
                <input
                    type="text"
                    value={tagsInput}
                    onChange={(e) => setTagsInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    placeholder="тревога, пары, онлайн"
                />
                {tagsInput && (
                    <div className="flex flex-wrap gap-1 mt-2">
                        {tagsInput.split(',').map((t) => t.trim()).filter(Boolean).map((tag) => (
                            <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-unbox-light text-unbox-green">
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>

            <div className="flex justify-end gap-3 pt-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-sm text-ink-60 hover:bg-unbox-light/50 rounded-xl transition-colors"
                >
                    Отмена
                </button>
                <button
                    type="submit"
                    disabled={saving || !name.trim()}
                    className="flex items-center gap-2 px-5 py-2 bg-unbox-green text-white text-sm font-medium rounded-xl hover:bg-unbox-dark disabled:opacity-50 transition-colors"
                >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    {isEdit ? 'Сохранить' : 'Создать'}
                </button>
            </div>
        </form>
    );
}

// ClientMenu (старое меню «⋯» с цветами Tailwind) нигде не рендерилось — удалено в wave 1.

// ── Merge Dialog ──────────────────────────────────────────────────────────────

function MergeDialog({
    clients,
    onConfirm,
    onCancel,
}: {
    clients: CrmClient[];
    onConfirm: (targetId: string, overrides: { name?: string; phone?: string; email?: string; telegram?: string }) => Promise<void>;
    onCancel: () => void;
}) {
    const [targetId, setTargetId] = useState(clients[0]?.id ?? '');
    const [nameSource, setNameSource] = useState(clients[0]?.id ?? '');
    const [phoneSource, setPhoneSource] = useState('');
    const [emailSource, setEmailSource] = useState('');
    const [telegramSource, setTelegramSource] = useState('');
    const [saving, setSaving] = useState(false);

    // Collect unique phone/email/telegram options from all clients
    const allPhones = clients.map(c => c.phone).filter(Boolean) as string[];
    const allEmails = clients.map(c => c.email).filter(Boolean) as string[];
    const allTelegrams = clients.map(c => c.telegram).filter(Boolean) as string[];

    const selectedName = clients.find(c => c.id === nameSource)?.name ?? clients[0]?.name ?? '';

    const handleConfirm = async () => {
        setSaving(true);
        try {
            await onConfirm(targetId, {
                name: selectedName,
                phone: phoneSource || undefined,
                email: emailSource || undefined,
                telegram: telegramSource || undefined,
            });
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/40 z-40 animate-in fade-in" onClick={onCancel} />
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <div className="bg-card rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 slide-in-from-bottom-4">
                    {/* Header */}
                    <div className="p-6 border-b border-gray-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                                    <Merge className="w-5 h-5 text-gray-700" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-unbox-dark">Объединить клиентов</h2>
                                    <p className="text-xs text-ink-60">{clients.length} карточек → 1</p>
                                </div>
                            </div>
                            <button onClick={onCancel} aria-label="Закрыть" className="p-1.5 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5 text-ink-60" />
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-5">
                        {/* Target client (base card) */}
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-2">
                                Основная карточка
                            </label>
                            <p className="text-xs text-ink-60 mb-2">
                                Все данные будут перенесены в эту карточку. Остальные карточки будут удалены.
                            </p>
                            <div className="space-y-1.5">
                                {clients.map(c => (
                                    <label
                                        key={c.id}
                                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                            targetId === c.id
                                                ? 'border-unbox-green bg-unbox-green/5'
                                                : 'border-gray-100 hover:border-gray-200'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="target"
                                            checked={targetId === c.id}
                                            onChange={() => setTargetId(c.id)}
                                            className="text-unbox-green focus:ring-unbox-green"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm text-unbox-dark truncate">{c.name}</div>
                                            <div className="text-xs text-ink-60 truncate">
                                                {[c.phone, c.telegram, c.email].filter(Boolean).join(' · ') || 'Нет контактов'}
                                            </div>
                                        </div>
                                        {(c as any).sessionCount > 0 && (
                                            <span className="text-xs text-ink-60 bg-gray-100 px-2 py-0.5 rounded-full">
                                                {(c as any).sessionCount} {sessionsWord((c as any).sessionCount)}
                                            </span>
                                        )}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Choose name */}
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-2">
                                Имя в карточке
                            </label>
                            <div className="space-y-1.5">
                                {clients.map(c => (
                                    <label
                                        key={c.id}
                                        className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                            nameSource === c.id
                                                ? 'border-unbox-green bg-unbox-green/5'
                                                : 'border-gray-100 hover:border-gray-200'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="nameSource"
                                            checked={nameSource === c.id}
                                            onChange={() => setNameSource(c.id)}
                                            className="text-unbox-green focus:ring-unbox-green"
                                        />
                                        <span className="text-sm">{c.name}</span>
                                    </label>
                                ))}
                            </div>
                        </div>

                        {/* Choose phone */}
                        {allPhones.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-unbox-dark mb-2">
                                    Телефон
                                </label>
                                <div className="space-y-1.5">
                                    {[...new Set(allPhones)].map(phone => (
                                        <label
                                            key={phone}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                                phoneSource === phone
                                                    ? 'border-unbox-green bg-unbox-green/5'
                                                    : 'border-gray-100 hover:border-gray-200'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="phoneSource"
                                                checked={phoneSource === phone}
                                                onChange={() => setPhoneSource(phone)}
                                                className="text-unbox-green focus:ring-unbox-green"
                                            />
                                            <Phone className="w-3.5 h-3.5 text-ink-60" />
                                            <span className="text-sm">{phone}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Choose email */}
                        {allEmails.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-unbox-dark mb-2">
                                    Email
                                </label>
                                <div className="space-y-1.5">
                                    {[...new Set(allEmails)].map(email => (
                                        <label
                                            key={email}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                                emailSource === email
                                                    ? 'border-unbox-green bg-unbox-green/5'
                                                    : 'border-gray-100 hover:border-gray-200'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="emailSource"
                                                checked={emailSource === email}
                                                onChange={() => setEmailSource(email)}
                                                className="text-unbox-green focus:ring-unbox-green"
                                            />
                                            <Mail className="w-3.5 h-3.5 text-ink-60" />
                                            <span className="text-sm">{email}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Choose telegram */}
                        {allTelegrams.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-unbox-dark mb-2">
                                    Telegram
                                </label>
                                <div className="space-y-1.5">
                                    {[...new Set(allTelegrams)].map(tg => (
                                        <label
                                            key={tg}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                                telegramSource === tg
                                                    ? 'border-unbox-green bg-unbox-green/5'
                                                    : 'border-gray-100 hover:border-gray-200'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="telegramSource"
                                                checked={telegramSource === tg}
                                                onChange={() => setTelegramSource(tg)}
                                                className="text-unbox-green focus:ring-unbox-green"
                                            />
                                            <Send className="w-3.5 h-3.5 text-ink-60" />
                                            <span className="text-sm">{tg}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Warning */}
                        <div className="bg-[var(--status-danger-bg)] rounded-xl p-3">
                            <p className="text-xs text-[var(--status-danger-fg)]">
                                <strong>Внимание:</strong> {clients.length - 1} карточ{clients.length - 1 === 1 ? 'ка' : clients.length - 1 < 5 ? 'ки' : 'ек'} будут удалены.
                                Все сессии, платежи и заметки будут перенесены в выбранную основную карточку.
                                Это действие необратимо.
                            </p>
                        </div>
                    </div>

                    {/* Footer */}
                    <div className="p-6 border-t border-gray-100 flex justify-end gap-3">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2.5 text-sm text-ink-60 hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            Оставить как есть
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2.5 bg-[var(--status-danger-solid)] text-white text-sm font-medium rounded-xl hover:bg-[var(--status-danger-fg)] disabled:opacity-50 transition-colors"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
                            Объединить карточки
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}

// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE CRM CLIENTS — newspaper index variant
// Rollback: delete this component + the early-return in CrmClients.
// ─────────────────────────────────────────────────────────────────────────

const GHC_HAIRLINE = `1px solid ${GH.ink10}`;
const GHC_HAIRLINE_STRONG = `1px solid ${GH.ink}`;
const GHC_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: GH.ink60,
};

interface GridHouseCrmClientsProps {
    clients: CrmClient[];
    filtered: CrmClient[];
    loading: boolean;
    loadError: string | null;
    onRetry: () => void;
    search: string;
    setSearch: (v: string) => void;
    showInactive: boolean;
    setShowInactive: (v: boolean) => void;
    sortField: SortField;
    sortDir: SortDir;
    toggleSort: (f: SortField) => void;
    navigate: (p: string) => void;
    mergeMode: boolean;
    setMergeMode: (v: boolean) => void;
    mergeSelected: string[];
    setMergeSelected: React.Dispatch<React.SetStateAction<string[]>>;
    showMergeDialog: boolean;
    setShowMergeDialog: (v: boolean) => void;
    showForm: boolean;
    setShowForm: (v: boolean) => void;
    editingClient: CrmClient | null;
    editingId: string | null;
    setEditingId: (v: string | null) => void;
    onCreate: (data: CrmClientCreate) => Promise<void>;
    onUpdate: (id: string, data: CrmClientCreate) => Promise<void>;
    onToggleActive: (client: CrmClient) => Promise<void>;
    onPermanentDelete: (client: CrmClient) => Promise<void>;
    onMergeConfirm: (targetId: string, overrides: any) => Promise<void>;
}

function GridHouseCrmClients(props: GridHouseCrmClientsProps) {
    const {
        clients, filtered, loading, loadError, onRetry, search, setSearch, showInactive, setShowInactive,
        sortField, sortDir, toggleSort, navigate, mergeMode, setMergeMode,
        mergeSelected, setMergeSelected, showMergeDialog, setShowMergeDialog,
        showForm, setShowForm, editingClient, editingId, setEditingId,
        onCreate, onUpdate, onToggleActive, onPermanentDelete, onMergeConfirm,
    } = props;

    const activeCount = clients.filter(c => c.isActive).length;

    return (
        <div
            style={{
                fontFamily: GH_SANS,
                color: GH.ink,
                background: GH.paper,
                maxWidth: 1280,
            }}
        >
            {/* ── Header ── */}
            <header
                style={{
                    borderBottom: GHC_HAIRLINE_STRONG,
                    paddingBottom: 20,
                    marginBottom: 24,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 16,
                }}
            >
                <div>
                    <div style={{ ...GHC_MONO_LABEL, marginBottom: 8 }}>Раздел · Клиенты</div>
                    <h1
                        style={{
                            fontSize: 'clamp(36px, 4.5vw, 56px)',
                            fontWeight: 800,
                            lineHeight: 0.95,
                            letterSpacing: '-0.025em',
                            margin: 0,
                        }}
                    >
                        Индекс клиентов.
                    </h1>
                    <div
                        style={{
                            ...GHC_MONO_LABEL,
                            marginTop: 10,
                            fontVariantNumeric: 'tabular-nums',
                        }}
                    >
                        Активных: {String(activeCount).padStart(3, '0')} / Всего: {String(clients.length).padStart(3, '0')}
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                        onClick={() => {
                            setMergeMode(!mergeMode);
                            setMergeSelected([]);
                        }}
                        style={{
                            background: mergeMode ? GH.danger : 'transparent',
                            color: mergeMode ? GH.paper : GH.ink,
                            border: `1px solid ${mergeMode ? GH.danger : GH.ink}`,
                            padding: '12px 20px',
                            fontFamily: GH_MONO,
                            fontSize: 12,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            transition: 'background 0.15s ease, color 0.15s ease',
                        }}
                    >
                        <Merge size={13} />
                        {mergeMode ? 'Отмена' : 'Слить'}
                    </button>
                    <button
                        onClick={() => setShowForm(true)}
                        style={{
                            background: GH.ink,
                            color: GH.paper,
                            border: 'none',
                            padding: '12px 20px',
                            fontFamily: GH_MONO,
                            fontSize: 12,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                        }}
                    >
                        <Plus size={13} />
                        Новый клиент
                    </button>
                </div>
            </header>

            {/* ── Filters ── */}
            <div
                style={{
                    display: 'flex',
                    gap: 24,
                    alignItems: 'center',
                    marginBottom: 24,
                    flexWrap: 'wrap',
                }}
            >
                <div
                    style={{
                        flex: '1 1 320px',
                        display: 'flex',
                        alignItems: 'center',
                        borderBottom: `1px solid ${GH.ink30}`,
                        paddingBottom: 8,
                    }}
                >
                    <Search size={14} color={GH.ink60} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Поиск по имени, телефону, email, алиасу…"
                        style={{
                            flex: 1,
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            fontFamily: GH_SANS,
                            fontSize: 15,
                            color: GH.ink,
                            marginLeft: 12,
                        }}
                    />
                    {search && (
                        <button
                            onClick={() => setSearch('')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: GH.ink60, display: 'flex', padding: 0 }}
                            aria-label="Очистить"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>

                <label
                    style={{
                        ...GHC_MONO_LABEL,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        cursor: 'pointer',
                        userSelect: 'none',
                    }}
                >
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        style={{ accentColor: GH.ink, cursor: 'pointer', margin: 0 }}
                    />
                    Неактивные
                </label>
            </div>

            {/* ── Merge info bar ── */}
            {mergeMode && (
                <div
                    style={{
                        border: `1px solid ${GH.danger}`,
                        padding: '14px 20px',
                        marginBottom: 20,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        background: GH.paper,
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Merge size={16} color={GH.danger} />
                        <div>
                            <div style={{ ...GHC_MONO_LABEL, color: GH.danger, marginBottom: 2 }}>
                                Режим объединения
                            </div>
                            <div style={{ fontSize: 13, color: GH.ink60 }}>
                                Выберите 2+ клиентов. Все сессии, платежи и заметки будут перенесены в одну карточку.
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ ...GHC_MONO_LABEL, fontVariantNumeric: 'tabular-nums' }}>
                            Выбрано: {String(mergeSelected.length).padStart(2, '0')}
                        </div>
                        <button
                            disabled={mergeSelected.length < 2}
                            onClick={() => setShowMergeDialog(true)}
                            style={{
                                background: mergeSelected.length < 2 ? GH.ink30 : GH.danger,
                                color: GH.paper,
                                border: 'none',
                                padding: '10px 18px',
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                fontWeight: 600,
                                cursor: mergeSelected.length < 2 ? 'not-allowed' : 'pointer',
                            }}
                        >
                            Объединить →
                        </button>
                    </div>
                </div>
            )}

            {/* ── New / Edit Form (legacy modal, acceptable compromise) ── */}
            {showForm && (
                <div style={{ marginBottom: 20 }}>
                    <ClientForm
                        onSave={onCreate}
                        onCancel={() => setShowForm(false)}
                    />
                </div>
            )}

            {editingClient && (
                <div style={{ marginBottom: 20 }}>
                    <ClientForm
                        isEdit
                        initial={{
                            name: editingClient.name,
                            phone: editingClient.phone,
                            email: editingClient.email,
                            telegram: editingClient.telegram,
                            aliasCode: editingClient.aliasCode,
                            basePrice: editingClient.basePrice,
                            currency: editingClient.currency,
                            tags: editingClient.tags,
                        }}
                        onSave={(data) => onUpdate(editingClient.id, data)}
                        onCancel={() => setEditingId(null)}
                    />
                </div>
            )}

            {showMergeDialog && (
                <MergeDialog
                    clients={clients.filter(c => mergeSelected.includes(c.id))}
                    onConfirm={onMergeConfirm}
                    onCancel={() => setShowMergeDialog(false)}
                />
            )}

            {/* ── Table ── Загрузка ≠ ошибка ≠ пусто (rule 8). */}
            {loadError && (
                <ErrorBar
                    message="Не удалось загрузить клиентов"
                    onRetry={onRetry}
                    retrying={loading}
                    className="mb-4"
                />
            )}
            {loading && !clients.length ? (
                <div role="status" aria-busy="true" style={{ border: GHC_HAIRLINE, padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <span className="sr-only">Загружаем клиентов…</span>
                    {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={20} radius={0} />)}
                </div>
            ) : filtered.length === 0 ? (
                loadError && !clients.length ? null : (
                    <div style={{ border: GHC_HAIRLINE }}>
                        <EmptyState
                            title={search ? 'Никого не нашли' : 'Клиентов пока нет'}
                            hint={search ? 'Попробуйте изменить запрос или снять фильтр.' : 'Добавьте первого клиента — займёт минуту.'}
                            action={search
                                ? { label: 'Очистить поиск', onClick: () => setSearch('') }
                                : { label: 'Новый клиент', onClick: () => setShowForm(true) }}
                        />
                    </div>
                )
            ) : (
                <div style={{ border: GHC_HAIRLINE, overflowX: 'auto' }}>
                    {/* Table head */}
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: mergeMode
                                ? '40px 32px 1.4fr 110px 1.2fr 90px 110px 110px 80px'
                                : '32px 1.4fr 110px 1.2fr 90px 110px 110px 80px',
                            gap: 0,
                            borderBottom: GHC_HAIRLINE,
                            padding: '12px 20px',
                            minWidth: mergeMode ? 1040 : 1000,
                            alignItems: 'center',
                        }}
                    >
                        {mergeMode && <div />}
                        <div style={GHC_MONO_LABEL}>#</div>
                        <GHSortHeader field="name" current={sortField} dir={sortDir} onSort={toggleSort}>Имя</GHSortHeader>
                        {/* Долг — сразу после имени: с телефона главный вопрос
                            «кто должен» не должен требовать скролла вбок (аудит 30.08) */}
                        <GHSortHeader field="unpaidSum" current={sortField} dir={sortDir} onSort={toggleSort}>Долг</GHSortHeader>
                        <div style={GHC_MONO_LABEL}>Контакты</div>
                        <GHSortHeader field="basePrice" current={sortField} dir={sortDir} onSort={toggleSort}>Ставка</GHSortHeader>
                        <GHSortHeader field="totalPaid" current={sortField} dir={sortDir} onSort={toggleSort}>Всего оплачено</GHSortHeader>
                        <GHSortHeader field="lastSessionDate" current={sortField} dir={sortDir} onSort={toggleSort}>Посл. сессия</GHSortHeader>
                        <div style={{ ...GHC_MONO_LABEL, textAlign: 'right' }}>Действия</div>
                    </div>

                    {/* Rows */}
                    {filtered.map((client, i) => {
                        const c = client as any;
                        const isSelected = mergeSelected.includes(client.id);
                        const isInactive = !client.isActive;
                        return (
                            <div
                                key={client.id}
                                onClick={() => {
                                    if (mergeMode) {
                                        setMergeSelected(prev =>
                                            prev.includes(client.id)
                                                ? prev.filter(id => id !== client.id)
                                                : [...prev, client.id]
                                        );
                                    } else {
                                        navigate(`/crm/clients/${client.id}`);
                                    }
                                }}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: mergeMode
                                        ? '40px 32px 1.4fr 110px 1.2fr 90px 110px 110px 80px'
                                        : '32px 1.4fr 110px 1.2fr 90px 110px 110px 80px',
                                    gap: 0,
                                    padding: '16px 20px',
                                    alignItems: 'center',
                                    borderBottom: i === filtered.length - 1 ? 'none' : GHC_HAIRLINE,
                                    cursor: 'pointer',
                                    background: isSelected ? GH.ink5 : 'transparent',
                                    // Неактивных приглушаем цветом, не прозрачностью:
                                    // текст не бледнее ink-60 (X4-19).
                                    color: isInactive ? GH.ink60 : undefined,
                                    transition: 'background 0.12s ease',
                                    minWidth: mergeMode ? 1040 : 1000,
                                    fontSize: 14,
                                }}
                                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = GH.ink5; }}
                                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                            >
                                {mergeMode && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <div
                                            style={{
                                                width: 16,
                                                height: 16,
                                                border: `1px solid ${GH.ink}`,
                                                background: isSelected ? GH.ink : GH.paper,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}
                                        >
                                            {isSelected && <Check size={12} color={GH.paper} />}
                                        </div>
                                    </div>
                                )}

                                {/* # + active dot */}
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        color: GH.ink60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    {/* Точка 6 px, а зона нажатия 24×24 (G5-10). */}
                                    <button
                                        onClick={() => onToggleActive(client)}
                                        title={client.isActive ? 'Деактивировать' : 'Активировать'}
                                        aria-label={client.isActive ? `Деактивировать ${client.name}` : `Активировать ${client.name}`}
                                        style={{
                                            width: 24,
                                            height: 24,
                                            margin: -9,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            background: 'transparent',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 0,
                                        }}
                                    >
                                        <span aria-hidden="true" style={{
                                            width: 6,
                                            height: 6,
                                            borderRadius: '50%',
                                            background: client.isActive ? GH.ink : GH.ink30,
                                        }} />
                                    </button>
                                    <span>{String(i + 1).padStart(2, '0')}</span>
                                </div>

                                {/* Name */}
                                <div style={{ paddingRight: 12 }}>
                                    <div style={{ fontWeight: 600, color: isInactive ? GH.ink60 : GH.ink, marginBottom: 2 }}>
                                        {client.name}
                                    </div>
                                    {(client.aliasCode || isInactive) && (
                                        <div
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 12,
                                                color: GH.ink60,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                            }}
                                        >
                                            {client.aliasCode && `#${client.aliasCode}`}
                                            {client.aliasCode && isInactive && ' · '}
                                            {isInactive && 'Неактивен'}
                                        </div>
                                    )}
                                </div>

                                {/* Debt */}
                                <div style={{ fontSize: 12 }}>
                                    {(c.unpaidSum || 0) > 0 ? (
                                        <span
                                            style={{
                                                fontFamily: GH_MONO,
                                                textTransform: 'uppercase',
                                                letterSpacing: '0.06em',
                                                color: GH.danger,
                                                fontWeight: 600,
                                                fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            {formatMoney(c.unpaidSum, { currency: client.currency })}
                                        </span>
                                    ) : (c.sessionCount || 0) > 0 ? (
                                        <StatusBadge kind="payment" status="paid" audience="staff" variant="dot" />
                                    ) : (
                                        <span style={{ color: GH.ink60 }}>—</span>
                                    )}
                                </div>

                                {/* Contacts */}
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        color: GH.ink60,
                                        paddingRight: 12,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 2,
                                    }}
                                >
                                    {client.telegram && <div>@{client.telegram.replace(/^@/, '')}</div>}
                                    {client.phone && <div>{client.phone}</div>}
                                    {!client.telegram && !client.phone && <div style={{ color: GH.ink60 }}>—</div>}
                                </div>

                                {/* Rate */}
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 13,
                                        color: GH.ink,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {formatMoney(client.basePrice || 0, { currency: client.currency })}
                                </div>

                                {/* LTV — sum of REAL payments (was totalCost
                                    = sessionCount × price, which gave 270k
                                    for Petrov when only 35k actually came in). */}
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 13,
                                        color: (c.totalPaid || 0) > 0 ? GH.ink : GH.ink60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                    title="Сумма всех реально полученных платежей (во всех валютах клиента)"
                                >
                                    {/* Сумма по всем валютам сразу — поэтому без знака валюты. */}
                                    {((c as any).totalPaid || 0).toLocaleString('ru-RU')}
                                </div>

                                {/* Last session */}
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        color: GH.ink60,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.05em',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {c.lastSessionDate
                                        ? formatDayMonth(c.lastSessionDate, { withYear: 'auto' })
                                        : <span style={{ color: GH.ink60 }}>—</span>}
                                </div>

                                {/* Actions */}
                                <div
                                    style={{ display: 'flex', justifyContent: 'flex-end', gap: 4 }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <button
                                        onClick={() => {
                                            setShowForm(false);
                                            setEditingId(editingId === client.id ? null : client.id);
                                        }}
                                        title="Редактировать"
                                        aria-label={`Редактировать ${client.name}`}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 6,
                                            color: GH.ink60,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Pencil size={13} />
                                    </button>
                                    <button
                                        onClick={() => onPermanentDelete(client)}
                                        title="Удалить"
                                        aria-label={`Удалить ${client.name}`}
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: 6,
                                            color: GH.ink60,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Trash2 size={13} />
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

// ── Grid House sort header ──
function GHSortHeader({
    field,
    current,
    dir,
    onSort,
    children,
}: {
    field: SortField;
    current: SortField;
    dir: SortDir;
    onSort: (f: SortField) => void;
    children: React.ReactNode;
}) {
    const active = current === field;
    return (
        <button
            onClick={() => onSort(field)}
            style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textAlign: 'left',
                fontFamily: GH_MONO,
                fontSize: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: active ? GH.ink : GH.ink60,
                fontWeight: active ? 600 : 400,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
            }}
        >
            {children}
            {active && <span style={{ fontSize: 12 }}>{dir === 'asc' ? '↑' : '↓'}</span>}
        </button>
    );
}
