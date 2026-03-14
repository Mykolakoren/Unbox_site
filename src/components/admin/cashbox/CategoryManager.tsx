import { useState } from 'react';
import { Plus, ChevronDown, ChevronRight, Pencil, Check, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCashboxStore } from '../../../store/cashboxStore';
import type { ExpenseCategory } from '../../../api/cashbox';

export function CategoryManager() {
    const { categories, createCategory, updateCategory, deleteCategory } = useCashboxStore();
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [addingTo, setAddingTo] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [showAddRoot, setShowAddRoot] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const toggleExpand = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const handleAdd = async (parentId?: string) => {
        if (!newName.trim()) return;
        try {
            await createCategory({ name: newName.trim(), parent_id: parentId });
            toast.success('Категория создана');
            setNewName('');
            setAddingTo(null);
            setShowAddRoot(false);
            if (parentId) setExpanded(prev => new Set(prev).add(parentId));
        } catch {
            toast.error('Ошибка создания категории');
        }
    };

    const handleEdit = async (id: string) => {
        if (!editName.trim()) return;
        try {
            await updateCategory(id, { name: editName.trim() });
            toast.success('Переименовано');
            setEditingId(null);
        } catch {
            toast.error('Ошибка обновления');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await deleteCategory(id);
            toast.success('Категория удалена');
            setConfirmDeleteId(null);
        } catch (err: unknown) {
            const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || 'Ошибка удаления');
            setConfirmDeleteId(null);
        }
    };

    const handleToggleActive = async (cat: ExpenseCategory) => {
        try {
            await updateCategory(cat.id, { is_active: !cat.isActive });
            toast.success(cat.isActive ? 'Скрыта' : 'Активирована');
        } catch {
            toast.error('Ошибка обновления');
        }
    };

    const renderCategory = (cat: ExpenseCategory, depth = 0) => {
        const hasChildren = cat.children && cat.children.length > 0;
        const isExpanded = expanded.has(cat.id);
        const isEditing = editingId === cat.id;
        const isAddingSub = addingTo === cat.id;
        const isConfirmingDelete = confirmDeleteId === cat.id;

        return (
            <div key={cat.id}>
                <div
                    className={`flex items-center gap-2 px-3 py-2.5 hover:bg-white rounded-lg transition-colors group ${!cat.isActive ? 'opacity-40' : ''}`}
                    style={{ paddingLeft: `${12 + depth * 24}px` }}
                >
                    {depth === 0 ? (
                        <button
                            onClick={() => toggleExpand(cat.id)}
                            className="text-gray-400 hover:text-gray-600 w-4 flex-shrink-0"
                        >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                    ) : (
                        <span className="w-4 flex-shrink-0 text-gray-300 text-xs select-none">└</span>
                    )}

                    {isEditing ? (
                        <div className="flex items-center gap-1.5 flex-1">
                            <input
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleEdit(cat.id); if (e.key === 'Escape') setEditingId(null); }}
                                className="flex-1 px-2 py-1 text-sm border border-unbox-green/50 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                                autoFocus
                            />
                            <button onClick={() => handleEdit(cat.id)} className="text-green-600 hover:text-green-700 p-0.5"><Check size={14} /></button>
                            <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
                        </div>
                    ) : isConfirmingDelete ? (
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-sm text-red-600 flex-1">Удалить «{cat.name}»?</span>
                            <button
                                onClick={() => handleDelete(cat.id)}
                                className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700 hover:bg-red-200 font-medium"
                            >
                                Удалить
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} className="p-0.5 text-gray-400 hover:text-gray-600"><X size={14} /></button>
                        </div>
                    ) : (
                        <>
                            <span className={`text-sm flex-1 ${depth === 0 ? 'font-medium text-gray-800' : 'text-gray-600'}`}>
                                {cat.name}
                            </span>
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                    onClick={() => { setEditingId(cat.id); setEditName(cat.name); }}
                                    className="p-1.5 text-gray-400 hover:text-unbox-green rounded"
                                    title="Переименовать"
                                >
                                    <Pencil size={12} />
                                </button>
                                {depth === 0 && (
                                    <button
                                        onClick={() => { setAddingTo(cat.id); setNewName(''); setExpanded(prev => new Set(prev).add(cat.id)); }}
                                        className="p-1.5 text-gray-400 hover:text-unbox-green rounded"
                                        title="Добавить подкатегорию"
                                    >
                                        <Plus size={12} />
                                    </button>
                                )}
                                <button
                                    onClick={() => handleToggleActive(cat)}
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cat.isActive ? 'text-gray-400 hover:text-amber-600' : 'text-green-600 hover:text-green-700'}`}
                                >
                                    {cat.isActive ? 'Скрыть' : 'Вкл'}
                                </button>
                                <button
                                    onClick={() => setConfirmDeleteId(cat.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                                    title="Удалить"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </>
                    )}
                </div>

                {isExpanded && hasChildren && cat.children.map(child => renderCategory(child, depth + 1))}

                {isAddingSub && (
                    <div className="flex items-center gap-1.5 py-1.5 pr-3" style={{ paddingLeft: `${40 + depth * 24}px` }}>
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAdd(cat.id); if (e.key === 'Escape') setAddingTo(null); }}
                            placeholder="Подкатегория..."
                            className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            autoFocus
                        />
                        <button onClick={() => handleAdd(cat.id)} className="text-green-600 hover:text-green-700"><Check size={14} /></button>
                        <button onClick={() => setAddingTo(null)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">Наведите на категорию для редактирования</p>
                <button
                    onClick={() => { setShowAddRoot(true); setNewName(''); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-unbox-green text-white text-xs font-medium hover:bg-unbox-green/90 transition-colors"
                >
                    <Plus size={13} />
                    Добавить категорию
                </button>
            </div>

            <div className="bg-gray-50/80 rounded-2xl border border-gray-100 overflow-hidden">
                {categories.length === 0 && !showAddRoot ? (
                    <div className="text-center py-10 text-gray-400 text-sm">Категорий пока нет</div>
                ) : (
                    <div className="py-2 px-2 divide-y divide-gray-100/50">
                        {categories.map(cat => renderCategory(cat))}
                    </div>
                )}

                {showAddRoot && (
                    <div className="flex items-center gap-1.5 px-4 py-3 border-t border-gray-200">
                        <input
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') { setShowAddRoot(false); setNewName(''); } }}
                            placeholder="Название категории..."
                            className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-unbox-green"
                            autoFocus
                        />
                        <button onClick={() => handleAdd()} className="text-green-600 hover:text-green-700"><Check size={16} /></button>
                        <button onClick={() => { setShowAddRoot(false); setNewName(''); }} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                    </div>
                )}
            </div>
        </div>
    );
}
