import { useEffect, useState } from 'react';
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
} from 'lucide-react';
import type { CrmClientCreate } from '../../api/crm';
import { toast } from 'sonner';

export function CrmClients() {
    const { clients, fetchClients, createClient, updateClient, deleteClient, loading } =
        useCrmStore();
    const { currentUser } = useUserStore();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);

    const editingClient = editingId ? clients.find((c) => c.id === editingId) ?? null : null;

    useEffect(() => {
        fetchClients();
    }, [fetchClients]);

    const filtered = clients.filter((c) => {
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
                <button
                    onClick={() => setShowForm(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md"
                >
                    <Plus className="w-4 h-4" />
                    Добавить клиента
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
                    }}
                    onCancel={() => setEditingId(null)}
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
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filtered.map((client) => (
                        <div
                            key={client.id}
                            className={`bg-white rounded-2xl border shadow-sm p-5 transition-all hover:shadow-md cursor-pointer ${
                                !client.isActive
                                    ? 'border-unbox-light opacity-60'
                                    : 'border-unbox-light'
                            }`}
                            onClick={() => navigate(`/crm/clients/${client.id}`)}
                        >
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-3">
                                    <div
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-white ${
                                            client.isActive
                                                ? 'bg-gradient-to-br from-unbox-green to-unbox-dark'
                                                : 'bg-gray-300'
                                        }`}
                                    >
                                        {client.name[0].toUpperCase()}
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
                        <option value="GEL">GEL (₾)</option>
                        <option value="USD">USD ($)</option>
                        <option value="EUR">EUR (€)</option>
                        <option value="RUB">RUB (₽)</option>
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
