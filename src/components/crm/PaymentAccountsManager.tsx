/**
 * Payment accounts manager — add, edit, delete custom accounts.
 */
import { useState } from 'react';
import { useCrmStore, type PaymentAccount } from '../../store/crmStore';
import { Plus, Pencil, Trash2, Check, X, Wallet } from 'lucide-react';
import { toast } from 'sonner';

export function PaymentAccountsManager() {
    const { paymentAccounts, updatePaymentAccounts } = useCrmStore();
    const [editing, setEditing] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [adding, setAdding] = useState(false);
    const [newLabel, setNewLabel] = useState('');

    const handleAdd = async () => {
        if (!newLabel.trim()) return;
        const id = newLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
        if (paymentAccounts.some(a => a.id === id)) {
            toast.error('Такой счёт уже существует');
            return;
        }
        const updated = [...paymentAccounts, { id, label: newLabel.trim() }];
        try {
            await updatePaymentAccounts(updated);
            setNewLabel('');
            setAdding(false);
            toast.success('Счёт добавлен');
        } catch {
            toast.error('Ошибка при сохранении');
        }
    };

    const handleEdit = async (account: PaymentAccount) => {
        if (!editLabel.trim()) return;
        const updated = paymentAccounts.map(a =>
            a.id === account.id ? { ...a, label: editLabel.trim() } : a
        );
        try {
            await updatePaymentAccounts(updated);
            setEditing(null);
            toast.success('Счёт обновлён');
        } catch {
            toast.error('Ошибка при сохранении');
        }
    };

    const handleDelete = async (id: string) => {
        if (paymentAccounts.length <= 1) {
            toast.error('Нужен хотя бы один счёт');
            return;
        }
        const updated = paymentAccounts.filter(a => a.id !== id);
        try {
            await updatePaymentAccounts(updated);
            toast.success('Счёт удалён');
        } catch {
            toast.error('Ошибка при удалении');
        }
    };

    return (
        <div className="space-y-3">
            <h3 className="font-bold text-unbox-dark flex items-center gap-2">
                <Wallet size={18} /> Счета для оплаты
            </h3>
            <p className="text-xs text-unbox-grey">
                Настройте список счетов, которые будут доступны при приёме оплаты от клиентов.
            </p>

            <div className="space-y-2">
                {paymentAccounts.map((acc) => (
                    <div
                        key={acc.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/60 border border-white/80"
                    >
                        {editing === acc.id ? (
                            <>
                                <input
                                    type="text"
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleEdit(acc)}
                                    className="flex-1 px-2 py-1 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20"
                                    autoFocus
                                />
                                <button
                                    onClick={() => handleEdit(acc)}
                                    className="p-1 text-unbox-green hover:bg-unbox-light rounded-lg transition-colors"
                                >
                                    <Check size={16} />
                                </button>
                                <button
                                    onClick={() => setEditing(null)}
                                    className="p-1 text-unbox-grey hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 text-sm text-unbox-dark font-medium">{acc.label}</span>
                                <span className="text-[10px] text-unbox-grey font-mono">{acc.id}</span>
                                <button
                                    onClick={() => { setEditing(acc.id); setEditLabel(acc.label); }}
                                    className="p-1 text-unbox-grey hover:text-unbox-dark hover:bg-gray-100 rounded-lg transition-colors"
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    onClick={() => handleDelete(acc.id)}
                                    className="p-1 text-unbox-grey hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </>
                        )}
                    </div>
                ))}
            </div>

            {adding ? (
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="Название счёта..."
                        className="flex-1 px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20"
                        autoFocus
                    />
                    <button
                        onClick={handleAdd}
                        disabled={!newLabel.trim()}
                        className="p-2 text-unbox-green hover:bg-unbox-light rounded-xl transition-colors disabled:opacity-40"
                    >
                        <Check size={18} />
                    </button>
                    <button
                        onClick={() => { setAdding(false); setNewLabel(''); }}
                        className="p-2 text-unbox-grey hover:bg-gray-100 rounded-xl transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => setAdding(true)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-unbox-green/40 text-unbox-green text-sm font-medium hover:bg-unbox-light/40 transition-colors w-full justify-center"
                >
                    <Plus size={16} /> Добавить счёт
                </button>
            )}
        </div>
    );
}
