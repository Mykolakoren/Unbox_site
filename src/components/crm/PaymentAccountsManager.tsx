/**
 * Payment accounts manager — add, edit, delete custom accounts.
 *
 * Волна 3 (пакет D, G5-11): на токенах Grid House — поля ui-input, кнопки
 * Button, у значков-кнопок подписи для диктора. Сохранение — прежнее
 * (updatePaymentAccounts из стора).
 */
import { useState } from 'react';
import { useCrmStore, type PaymentAccount } from '../../store/crmStore';
import { CURRENCIES } from '../../utils/currency';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { apiErrorMessage } from '../../utils/errors';

/** Квадратная кнопка-значок 36 px с подписью для диктора. */
const ICON_BTN = 'inline-flex items-center justify-center w-9 h-9 text-ink-60 hover:text-ink hover:bg-ink-05 transition-colors';

export function PaymentAccountsManager() {
    const { paymentAccounts, updatePaymentAccounts } = useCrmStore();
    const [editing, setEditing] = useState<string | null>(null);
    const [editLabel, setEditLabel] = useState('');
    const [adding, setAdding] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [newCurrency, setNewCurrency] = useState('');

    const handleAdd = async () => {
        if (!newLabel.trim()) return;
        const id = newLabel.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Zа-яА-Я0-9_]/g, '');
        if (paymentAccounts.some(a => a.id === id)) {
            toast.error('Такой счёт уже существует');
            return;
        }
        const updated = [...paymentAccounts, { id, label: newLabel.trim(), currency: newCurrency || undefined }];
        try {
            await updatePaymentAccounts(updated);
            setNewLabel('');
            setNewCurrency('');
            setAdding(false);
            toast.success('Счёт добавлен');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось добавить счёт — попробуйте ещё раз'));
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
            toast.success('Счёт переименован');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось переименовать счёт — попробуйте ещё раз'));
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
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось удалить счёт — попробуйте ещё раз'));
        }
    };

    return (
        <div className="space-y-3">
            <p className="text-small text-ink-60">
                Эти счета вы выбираете, когда отмечаете оплату от клиента.
            </p>

            <ul className="border-t border-ink-10">
                {paymentAccounts.map((acc) => (
                    <li
                        key={acc.id}
                        className="flex items-center gap-2 py-2 border-b border-ink-10 flex-wrap"
                    >
                        {editing === acc.id ? (
                            <>
                                <input
                                    type="text"
                                    value={editLabel}
                                    onChange={(e) => setEditLabel(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleEdit(acc)}
                                    aria-label={`Новое название счёта «${acc.label}»`}
                                    className="ui-input flex-1 min-w-[160px]"
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    onClick={() => handleEdit(acc)}
                                    aria-label="Сохранить название"
                                    title="Сохранить название"
                                    className={ICON_BTN}
                                >
                                    <Check size={16} aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    aria-label="Не переименовывать"
                                    title="Не переименовывать"
                                    className={ICON_BTN}
                                >
                                    <X size={16} aria-hidden="true" />
                                </button>
                            </>
                        ) : (
                            <>
                                <span className="flex-1 min-w-[120px] text-body text-ink font-medium">{acc.label}</span>
                                <select
                                    value={acc.currency || ''}
                                    onChange={async (e) => {
                                        const updated = paymentAccounts.map(a =>
                                            a.id === acc.id ? { ...a, currency: e.target.value || undefined } : a
                                        );
                                        try {
                                            await updatePaymentAccounts(updated);
                                            toast.success(e.target.value
                                                ? `Счёт «${acc.label}» теперь в ${e.target.value}`
                                                : `Валюта у счёта «${acc.label}» снята`);
                                        } catch (err) {
                                            toast.error(apiErrorMessage(err, 'Не удалось сменить валюту счёта — попробуйте ещё раз'));
                                        }
                                    }}
                                    aria-label={`Валюта счёта «${acc.label}»`}
                                    title="Валюта счёта — подставится в платёж при выборе этого счёта"
                                    className="ui-input w-auto text-small"
                                >
                                    <option value="">Валюта не задана</option>
                                    {CURRENCIES.map(cur => (
                                        <option key={cur.code} value={cur.code}>{cur.symbol} {cur.code}</option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={() => { setEditing(acc.id); setEditLabel(acc.label); }}
                                    aria-label={`Переименовать счёт «${acc.label}»`}
                                    title="Переименовать"
                                    className={ICON_BTN}
                                >
                                    <Pencil size={16} aria-hidden="true" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDelete(acc.id)}
                                    aria-label={`Удалить счёт «${acc.label}»`}
                                    title="Удалить"
                                    className={`${ICON_BTN} hover:!text-[var(--status-danger-fg)] hover:!bg-[var(--status-danger-bg)]`}
                                >
                                    <Trash2 size={16} aria-hidden="true" />
                                </button>
                            </>
                        )}
                    </li>
                ))}
            </ul>

            {adding ? (
                <div className="flex items-center gap-2 flex-wrap">
                    <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                        placeholder="Например, Mono"
                        aria-label="Название нового счёта"
                        className="ui-input flex-1 min-w-[160px]"
                        autoFocus
                    />
                    <select
                        value={newCurrency}
                        onChange={(e) => setNewCurrency(e.target.value)}
                        aria-label="Валюта нового счёта"
                        className="ui-input w-auto"
                    >
                        <option value="">Валюта не задана</option>
                        {CURRENCIES.map(cur => (
                            <option key={cur.code} value={cur.code}>{cur.symbol} {cur.code}</option>
                        ))}
                    </select>
                    <Button variant="primary" onClick={handleAdd} disabled={!newLabel.trim()}>
                        Добавить
                    </Button>
                    <Button variant="quiet" onClick={() => { setAdding(false); setNewLabel(''); }}>
                        Отмена
                    </Button>
                </div>
            ) : (
                <Button variant="secondary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setAdding(true)}>
                    Добавить счёт
                </Button>
            )}
        </div>
    );
}
