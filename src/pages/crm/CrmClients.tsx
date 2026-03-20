import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCrmStore } from '../../store/crmStore';
import { useUserStore } from '../../store/userStore';
import {
    Plus,
    Search,
    Phone,
    Mail,
    Hash,
    MoreVertical,
    UserCircle,
    Loader2,
    X,
    Check,
    Pencil,
    Tag,
    Send,
    LayoutGrid,
    LayoutList,
    ArrowUpDown,
    Merge,
} from 'lucide-react';
import type { CrmClientCreate, CrmClient } from '../../api/crm';
import { crmApi } from '../../api/crm';
import { toast } from 'sonner';

type ViewMode = 'table' | 'cards';
type SortField = 'name' | 'basePrice' | 'sessionCount' | 'unpaidSum' | 'totalPaid' | 'lastSessionDate';
type SortDir = 'asc' | 'desc';

const VIEW_KEY = 'crm_clients_view';

export function CrmClients() {
    const { clients, fetchClients, createClient, updateClient, deleteClient, loading } =
        useCrmStore();
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
        fetchClients(false, true);
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

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold">Клиенты</h1>
                    <p className="text-unbox-grey text-sm">
                        {clients.filter((c) => c.isActive).length} активных из{' '}
                        {clients.length}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* View toggle */}
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                        <button
                            onClick={() => setView('table')}
                            className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-unbox-green' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Таблица"
                        >
                            <LayoutList size={18} />
                        </button>
                        <button
                            onClick={() => setView('cards')}
                            className={`p-1.5 rounded-md transition-colors ${viewMode === 'cards' ? 'bg-white shadow-sm text-unbox-green' : 'text-gray-400 hover:text-gray-600'}`}
                            title="Карточки"
                        >
                            <LayoutGrid size={18} />
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            if (mergeMode) {
                                setMergeMode(false);
                                setMergeSelected([]);
                            } else {
                                setMergeMode(true);
                                setMergeSelected([]);
                            }
                        }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                            mergeMode
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'bg-white border border-unbox-light text-unbox-grey hover:text-unbox-dark hover:border-unbox-green/30'
                        }`}
                    >
                        <Merge className="w-4 h-4" />
                        {mergeMode ? 'Отмена' : 'Объединить'}
                    </button>
                    <button
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                    >
                        <Plus className="w-4 h-4" />
                        Добавить клиента
                    </button>
                </div>
            </div>

            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-unbox-grey" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Поиск по имени, телефону, email..."
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    />
                </div>
                <label className="flex items-center gap-2 text-sm text-unbox-grey cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={(e) => setShowInactive(e.target.checked)}
                        className="rounded"
                    />
                    Неактивные
                </label>
            </div>

            {/* New Client Form */}
            {showForm && (
                <ClientForm
                    onSave={async (data) => {
                        await createClient(data);
                        setShowForm(false);
                        toast.success('Клиент создан');
                        fetchClients(false, true);
                    }}
                    onCancel={() => setShowForm(false)}
                />
            )}

            {/* Edit Client Form */}
            {editingClient && (
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
                    onSave={async (data) => {
                        await updateClient(editingClient.id, data);
                        setEditingId(null);
                        toast.success('Клиент обновлён');
                        fetchClients(false, true);
                    }}
                    onCancel={() => setEditingId(null)}
                />
            )}

            {/* Merge selection bar */}
            {mergeMode && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                        <Merge className="w-5 h-5 text-amber-600" />
                        <div>
                            <p className="text-sm font-medium text-amber-800">
                                Режим объединения
                            </p>
                            <p className="text-xs text-amber-600">
                                Выберите 2+ клиентов для объединения. Все сессии, платежи и заметки будут перенесены в одну карточку.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-amber-700">
                            {mergeSelected.length} выбрано
                        </span>
                        <button
                            disabled={mergeSelected.length < 2}
                            onClick={() => setShowMergeDialog(true)}
                            className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                            Объединить
                        </button>
                    </div>
                </div>
            )}

            {/* Merge Dialog */}
            {showMergeDialog && (
                <MergeDialog
                    clients={clients.filter(c => mergeSelected.includes(c.id))}
                    onConfirm={async (targetId, overrides) => {
                        const sourceIds = mergeSelected.filter(id => id !== targetId);
                        try {
                            const result = await crmApi.mergeClients({
                                targetId,
                                sourceIds,
                                ...overrides,
                            });
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
                    onCancel={() => setShowMergeDialog(false)}
                />
            )}

            {/* Client List */}
            {loading && !clients.length ? (
                <div className="flex items-center justify-center h-40">
                    <Loader2 className="w-6 h-6 animate-spin text-unbox-grey" />
                </div>
            ) : filtered.length === 0 ? (
                <div className="text-center py-12 text-unbox-grey">
                    <UserCircle className="w-16 h-16 mx-auto mb-3 opacity-40" />
                    <p className="font-medium text-lg">Нет клиентов</p>
                    <p className="text-sm mt-1">
                        {search ? 'Попробуйте изменить поисковый запрос' : 'Добавьте первого клиента'}
                    </p>
                </div>
            ) : viewMode === 'table' ? (
                /* ═══ TABLE VIEW (PsyCRM style) ═══ */
                <div className="bg-white rounded-2xl border border-unbox-light shadow-sm overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left" style={{ tableLayout: 'auto' }}>
                            <thead className="text-xs text-unbox-grey uppercase bg-gray-50/80 border-b border-gray-200">
                                <tr>
                                    {mergeMode && <th className="px-3 py-3.5 w-10"></th>}
                                    <th className="px-3 py-3.5 w-8"></th>
                                    <SortHeader field="name" current={sortField} dir={sortDir} onSort={toggleSort}>Имя</SortHeader>
                                    <th className="px-4 py-3.5 font-medium hidden md:table-cell">Контакты</th>
                                    <SortHeader field="basePrice" current={sortField} dir={sortDir} onSort={toggleSort}>Ставка</SortHeader>
                                    <SortHeader field="totalPaid" current={sortField} dir={sortDir} onSort={toggleSort} className="hidden lg:table-cell">LTV</SortHeader>
                                    <SortHeader field="unpaidSum" current={sortField} dir={sortDir} onSort={toggleSort}>Долг</SortHeader>
                                    <SortHeader field="lastSessionDate" current={sortField} dir={sortDir} onSort={toggleSort} className="hidden xl:table-cell">Посл. сессия</SortHeader>
                                    <th className="px-4 py-3.5 font-medium text-right">Действия</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map((client) => {
                                    const c = client as any;
                                    return (
                                        <tr
                                            key={client.id}
                                            className={`border-b border-gray-50 hover:bg-unbox-light/20 transition-colors cursor-pointer ${!client.isActive ? 'opacity-50' : ''} ${mergeMode && mergeSelected.includes(client.id) ? 'bg-amber-50/50' : ''}`}
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
                                        >
                                            {/* Merge checkbox */}
                                            {mergeMode && (
                                                <td className="px-3 py-3.5 text-center">
                                                    <input
                                                        type="checkbox"
                                                        checked={mergeSelected.includes(client.id)}
                                                        onChange={() => {}}
                                                        className="w-4 h-4 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                                                    />
                                                </td>
                                            )}
                                            {/* Active indicator */}
                                            <td className="px-3 py-3.5 text-center" onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleToggleActive(client)}
                                                    className={`w-3 h-3 rounded-full transition-all hover:scale-125 ${
                                                        client.isActive
                                                            ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]'
                                                            : 'bg-gray-300'
                                                    }`}
                                                    title={client.isActive ? 'Деактивировать' : 'Активировать'}
                                                />
                                            </td>
                                            {/* Name */}
                                            <td className="px-4 py-3.5 font-medium text-unbox-dark whitespace-nowrap">
                                                <div className="flex items-center gap-2.5">
                                                    <span className="hover:text-unbox-green transition-colors">
                                                        {client.name}
                                                    </span>
                                                    {client.aliasCode && (
                                                        <span className="text-[10px] text-gray-400 font-normal">
                                                            #{client.aliasCode}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            {/* Contacts */}
                                            <td className="px-4 py-3.5 text-unbox-grey hidden md:table-cell">
                                                <div className="flex flex-col gap-0.5 text-xs">
                                                    {client.telegram && <span className="flex items-center gap-1"><Send className="w-3 h-3" />{client.telegram}</span>}
                                                    {client.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{client.phone}</span>}
                                                    {!client.telegram && !client.phone && <span className="text-gray-400">&mdash;</span>}
                                                </div>
                                            </td>
                                            {/* Rate */}
                                            <td className="px-4 py-3.5 text-unbox-dark">
                                                {client.basePrice || 0} {client.currency}
                                            </td>
                                            {/* LTV */}
                                            <td className="px-4 py-3.5 text-unbox-dark font-medium hidden lg:table-cell">
                                                {c.sessionCount > 0
                                                    ? <span>{(c.totalCost || 0).toLocaleString()} {client.currency}</span>
                                                    : <span className="text-gray-400">0</span>
                                                }
                                            </td>
                                            {/* Debt */}
                                            <td className="px-4 py-3.5">
                                                {(c.unpaidSum || 0) > 0 ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 bg-red-50 text-red-700 text-xs font-medium rounded-full">
                                                        {(c.unpaidSum || 0).toLocaleString()} {client.currency}
                                                    </span>
                                                ) : (c.sessionCount || 0) > 0 ? (
                                                    <span className="inline-flex items-center px-2 py-0.5 bg-green-50 text-green-700 text-xs font-medium rounded-full">
                                                        Оплачено
                                                    </span>
                                                ) : (
                                                    <span className="text-gray-300">&mdash;</span>
                                                )}
                                            </td>
                                            {/* Last session */}
                                            <td className="px-4 py-3.5 text-unbox-grey text-xs hidden xl:table-cell">
                                                {c.lastSessionDate
                                                    ? new Date(c.lastSessionDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                                                    : <span className="text-gray-300">&mdash;</span>
                                                }
                                            </td>
                                            {/* Actions */}
                                            <td className="px-4 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        onClick={() => {
                                                            setShowForm(false);
                                                            setEditingId(editingId === client.id ? null : client.id);
                                                        }}
                                                        className="p-1.5 rounded-lg hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green transition-colors"
                                                        title="Редактировать"
                                                    >
                                                        <Pencil className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => navigate(`/crm/clients/${client.id}`)}
                                                        className="text-xs font-medium text-unbox-green hover:text-unbox-dark transition-colors"
                                                    >
                                                        Открыть
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            ) : (
                /* ═══ CARD VIEW ═══ */
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map((client) => (
                        <div
                            key={client.id}
                            className={`bg-white rounded-2xl border shadow-sm p-5 transition-all hover:shadow-md cursor-pointer ${
                                !client.isActive
                                    ? 'border-unbox-light opacity-60'
                                    : mergeMode && mergeSelected.includes(client.id)
                                    ? 'border-amber-400 bg-amber-50/30 ring-2 ring-amber-200'
                                    : 'border-unbox-light'
                            }`}
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
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                        {mergeMode && mergeSelected.includes(client.id) ? (
                                            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-amber-500 text-white">
                                                <Check className="w-5 h-5" />
                                            </div>
                                        ) : (
                                            <div
                                                className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white ${
                                                    client.isActive
                                                        ? 'bg-gradient-to-br from-unbox-green to-unbox-dark'
                                                        : 'bg-gray-300'
                                                }`}
                                            >
                                                {client.name?.[0]?.toUpperCase() ?? '?'}
                                            </div>
                                        )}
                                        {!mergeMode && (
                                            <div
                                                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                                                    client.isActive ? 'bg-green-400' : 'bg-gray-300'
                                                }`}
                                            />
                                        )}
                                    </div>
                                    <div>
                                        <div className="font-semibold text-unbox-dark">
                                            {client.name}
                                        </div>
                                        {client.aliasCode && (
                                            <div className="flex items-center gap-1 text-xs text-unbox-grey">
                                                <Hash className="w-3 h-3" />
                                                {client.aliasCode}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        onClick={() => {
                                            setShowForm(false);
                                            setEditingId(editingId === client.id ? null : client.id);
                                        }}
                                        className={`p-1.5 rounded-lg transition-colors ${
                                            editingId === client.id
                                                ? 'bg-unbox-light text-unbox-green'
                                                : 'hover:bg-unbox-light/50 text-unbox-grey hover:text-unbox-green'
                                        }`}
                                        title="Редактировать"
                                    >
                                        <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                    <ClientMenu
                                        isActive={client.isActive}
                                        onDelete={() => {
                                            deleteClient(client.id);
                                            toast.success('Клиент деактивирован');
                                        }}
                                        onRestore={() => {
                                            updateClient(client.id, { isActive: true });
                                            toast.success('Клиент восстановлен');
                                        }}
                                        onPermanentDelete={() => {
                                            if (confirm(`Вы уверены, что хотите НАВСЕГДА удалить клиента "${client.name}"?\n\nВсе сессии, платежи и заметки будут удалены. Это действие необратимо.`)) {
                                                deleteClient(client.id, true);
                                                toast.success('Клиент удалён навсегда');
                                            }
                                        }}
                                        canPermanentDelete={currentUser?.role === 'owner' || currentUser?.role === 'senior_admin'}
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5 text-sm">
                                {client.phone && (
                                    <div className="flex items-center gap-2 text-unbox-grey">
                                        <Phone className="w-3.5 h-3.5" />
                                        {client.phone}
                                    </div>
                                )}
                                {client.telegram && (
                                    <div className="flex items-center gap-2 text-unbox-grey">
                                        <Send className="w-3.5 h-3.5" />
                                        {client.telegram}
                                    </div>
                                )}
                                {client.email && (
                                    <div className="flex items-center gap-2 text-unbox-grey">
                                        <Mail className="w-3.5 h-3.5" />
                                        {client.email}
                                    </div>
                                )}
                            </div>

                            <div className="mt-3 pt-3 border-t border-unbox-light flex items-center justify-between text-sm">
                                <div className="text-unbox-grey">
                                    {client.basePrice} {client.currency}
                                </div>
                                {client.tags?.length > 0 && (
                                    <div className="flex gap-1 flex-wrap">
                                        {client.tags.slice(0, 2).map((tag) => (
                                            <span
                                                key={tag}
                                                className="px-2 py-0.5 text-xs rounded-full bg-unbox-light text-unbox-green"
                                            >
                                                {tag}
                                            </span>
                                        ))}
                                        {client.tags.length > 2 && (
                                            <span className="text-xs text-unbox-grey">
                                                +{client.tags.length - 2}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Sort Header ──────────────────────────────────────────────────────────────

function SortHeader({
    field,
    current,
    dir,
    onSort,
    children,
    className = '',
}: {
    field: SortField;
    current: SortField;
    dir: SortDir;
    onSort: (f: SortField) => void;
    children: React.ReactNode;
    className?: string;
}) {
    const isActive = current === field;
    return (
        <th
            className={`px-4 py-3.5 font-medium cursor-pointer select-none hover:bg-gray-100/50 transition-colors ${className}`}
            onClick={() => onSort(field)}
        >
            <div className="flex items-center gap-1">
                {children}
                <ArrowUpDown size={12} className={isActive ? 'text-unbox-green' : 'text-gray-300'} />
                {isActive && (
                    <span className="text-[10px] text-unbox-green">
                        {dir === 'asc' ? '\u2191' : '\u2193'}
                    </span>
                )}
            </div>
        </th>
    );
}

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
            className="bg-white rounded-2xl border border-unbox-light shadow-sm p-5 space-y-4 animate-in fade-in slide-in-from-top-2"
        >
            <div className="flex items-center justify-between">
                <h3 className="font-bold text-lg">{isEdit ? 'Редактировать клиента' : 'Новый клиент'}</h3>
                <button type="button" onClick={onCancel} className="p-1 hover:bg-unbox-light/50 rounded-lg">
                    <X className="w-5 h-5 text-unbox-grey" />
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">
                        Имя <span className="text-red-500">*</span>
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
                        <option value="GEL">GEL ({'\u20BE'})</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR ({'\u20AC'})</option>
                        <option value="RUB">RUB ({'\u20BD'})</option>
                    </select>
                </div>
                <div>
                    <label className="text-sm font-medium text-unbox-dark mb-1 block">Счёт по умолчанию</label>
                    <select
                        value={defaultAccount}
                        onChange={(e) => setDefaultAccount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    >
                        <option value="cash">Наличные</option>
                        <option value="tbc">TBC</option>
                        <option value="bog">BOG</option>
                        <option value="paypal">PayPal</option>
                        <option value="usdt">USDT</option>
                        <option value="p24">Приват24</option>
                        <option value="mono">Mono</option>
                    </select>
                </div>
            </div>

            <div>
                <label className="text-sm font-medium text-unbox-dark mb-1 block flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" /> Теги <span className="text-unbox-grey font-normal">(через запятую)</span>
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
                    className="px-4 py-2 text-sm text-unbox-grey hover:bg-unbox-light/50 rounded-xl transition-colors"
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

// ── Client Menu ──────────────────────────────────────────────────────────────

function ClientMenu({
    isActive,
    onDelete,
    onRestore,
    onPermanentDelete,
    canPermanentDelete = false,
}: {
    isActive: boolean;
    onDelete: () => void;
    onRestore: () => void;
    onPermanentDelete?: () => void;
    canPermanentDelete?: boolean;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div className="relative">
            <button
                onClick={() => setOpen(!open)}
                className="p-1.5 hover:bg-unbox-light/50 rounded-lg transition-colors"
            >
                <MoreVertical className="w-4 h-4 text-unbox-grey" />
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                    <div className="absolute right-0 top-8 z-20 bg-white rounded-xl border border-unbox-light shadow-lg py-1 w-44 animate-in fade-in slide-in-from-top-2">
                        {isActive ? (
                            <button
                                onClick={() => {
                                    onDelete();
                                    setOpen(false);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 transition-colors"
                            >
                                Деактивировать
                            </button>
                        ) : (
                            <button
                                onClick={() => {
                                    onRestore();
                                    setOpen(false);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-50 transition-colors"
                            >
                                Восстановить
                            </button>
                        )}
                        {canPermanentDelete && onPermanentDelete && (
                            <>
                                <div className="h-px bg-gray-100 my-1" />
                                <button
                                    onClick={() => {
                                        onPermanentDelete();
                                        setOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors font-medium"
                                >
                                    Удалить навсегда
                                </button>
                            </>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

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
                <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 slide-in-from-bottom-4">
                    {/* Header */}
                    <div className="p-6 border-b border-gray-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
                                    <Merge className="w-5 h-5 text-amber-600" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-unbox-dark">Объединить клиентов</h2>
                                    <p className="text-xs text-unbox-grey">{clients.length} карточек → 1</p>
                                </div>
                            </div>
                            <button onClick={onCancel} className="p-1.5 hover:bg-gray-100 rounded-lg">
                                <X className="w-5 h-5 text-unbox-grey" />
                            </button>
                        </div>
                    </div>

                    <div className="p-6 space-y-5">
                        {/* Target client (base card) */}
                        <div>
                            <label className="block text-sm font-medium text-unbox-dark mb-2">
                                Основная карточка
                            </label>
                            <p className="text-xs text-unbox-grey mb-2">
                                Все данные будут перенесены в эту карточку. Остальные карточки будут удалены.
                            </p>
                            <div className="space-y-1.5">
                                {clients.map(c => (
                                    <label
                                        key={c.id}
                                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                                            targetId === c.id
                                                ? 'border-amber-400 bg-amber-50'
                                                : 'border-gray-100 hover:border-gray-200'
                                        }`}
                                    >
                                        <input
                                            type="radio"
                                            name="target"
                                            checked={targetId === c.id}
                                            onChange={() => setTargetId(c.id)}
                                            className="text-amber-600 focus:ring-amber-500"
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-sm text-unbox-dark truncate">{c.name}</div>
                                            <div className="text-xs text-unbox-grey truncate">
                                                {[c.phone, c.telegram, c.email].filter(Boolean).join(' · ') || 'Нет контактов'}
                                            </div>
                                        </div>
                                        {(c as any).sessionCount > 0 && (
                                            <span className="text-[10px] text-unbox-grey bg-gray-100 px-2 py-0.5 rounded-full">
                                                {(c as any).sessionCount} сессий
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
                                            <Phone className="w-3.5 h-3.5 text-unbox-grey" />
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
                                            <Mail className="w-3.5 h-3.5 text-unbox-grey" />
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
                                            <Send className="w-3.5 h-3.5 text-unbox-grey" />
                                            <span className="text-sm">{tg}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Warning */}
                        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                            <p className="text-xs text-red-700">
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
                            className="px-4 py-2.5 text-sm text-unbox-grey hover:bg-gray-100 rounded-xl transition-colors"
                        >
                            Отмена
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white text-sm font-medium rounded-xl hover:bg-amber-700 disabled:opacity-50 transition-colors"
                        >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
                            Объединить
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
