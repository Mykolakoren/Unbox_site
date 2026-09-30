import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { X, Loader2, Wallet } from 'lucide-react';
import { COLOR, FONT, SHADOW, STATUS } from '../../design/tokens';
import { formatGel } from '../../utils/format';
import { usersApi } from '../../api/users';

interface Props {
    isOpen: boolean;
    userId: string;
    userName: string;
    currentBalance: number;
    onClose: () => void;
    onSaved: (newBalance: number) => void;
}

/**
 * Balance correction modal — Egor 2026-05-27. Admin types the absolute new
 * balance value + a mandatory reason; backend writes the User row and also
 * inserts a `cashbox_transactions` row of type=adjustment so the change is
 * visible in finance history alongside regular payments.
 *
 * Why absolute (not delta): Egor's Excel reconciliation gives him the
 * target balance per user. Typing the target directly removes a mental
 * math step that was a frequent source of errors.
 */
export function BalanceCorrectionModal({
    isOpen, userId, userName, currentBalance, onClose, onSaved,
}: Props) {
    const [newBalance, setNewBalance] = useState<string>(String(currentBalance));
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setNewBalance(String(currentBalance));
            setReason('');
        }
    }, [isOpen, currentBalance]);

    if (!isOpen) return null;

    const parsed = Number(newBalance);
    const isNumber = newBalance !== '' && !Number.isNaN(parsed);
    const delta = isNumber ? +(parsed - currentBalance).toFixed(2) : 0;
    const canSave = isNumber && delta !== 0 && reason.trim().length > 0;

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            const updated = await usersApi.correctBalance(userId, parsed, reason.trim());
            toast.success(`Баланс обновлён: ${formatGel(updated.balance)}`);
            onSaved(updated.balance);
            onClose();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось обновить баланс');
        } finally {
            setSaving(false);
        }
    };

    return createPortal(
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
                padding: 16,
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: COLOR.card,
                    borderRadius: 16,
                    width: '100%', maxWidth: 420,
                    padding: 22,
                    position: 'relative',
                    boxShadow: SHADOW.pop,
                    fontFamily: FONT.sans,
                    color: COLOR.ink,
                }}
            >
                <button
                    onClick={onClose}
                    style={{
                        position: 'absolute', top: 14, right: 14,
                        background: 'none', border: 'none', cursor: 'pointer', color: COLOR.ink60, padding: 4,
                    }}
                    aria-label="Закрыть"
                >
                    <X size={18} />
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 9,
                        background: STATUS.ok.bg,
                        color: STATUS.ok.fg,
                        display: 'grid', placeItems: 'center',
                    }}>
                        <Wallet size={18} />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Скорректировать баланс</h3>
                        <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>{userName}</div>
                    </div>
                </div>

                <div style={{
                    background: COLOR.sunken, borderRadius: 10, padding: '10px 12px',
                    fontSize: 13, marginBottom: 14, display: 'flex', justifyContent: 'space-between',
                }}>
                    <span style={{ color: COLOR.ink60 }}>Текущий баланс</span>
                    <span style={{ fontWeight: 700, fontFamily: 'ui-monospace, "SF Mono", monospace' }}>
                        {formatGel(currentBalance)}
                    </span>
                </div>

                <label style={{ display: 'block', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLOR.ink60, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                        Новое значение (₾)
                    </div>
                    <input
                        type="number"
                        inputMode="decimal"
                        value={newBalance}
                        onChange={e => setNewBalance(e.target.value)}
                        autoFocus
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            border: '1px solid rgba(0,0,0,0.12)',
                            borderRadius: 8,
                            fontSize: 15,
                            fontFamily: 'ui-monospace, "SF Mono", monospace',
                            outline: 'none',
                        }}
                    />
                </label>

                {isNumber && delta !== 0 && (
                    <div style={{
                        background: delta > 0 ? STATUS.ok.bg : STATUS.danger.bg,
                        color: delta > 0 ? STATUS.ok.fg : STATUS.danger.fg,
                        padding: '8px 12px', borderRadius: 8,
                        fontSize: 12, fontWeight: 600,
                        marginBottom: 12,
                    }}>
                        Изменение: {formatGel(delta, { sign: true })}
                        {' · '}
                        {delta > 0 ? 'кредит юзеру' : 'списание'}
                    </div>
                )}

                <label style={{ display: 'block', marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: COLOR.ink60, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 5 }}>
                        Причина <span style={{ color: STATUS.danger.fg }}>*</span>
                    </div>
                    <textarea
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        rows={3}
                        placeholder="Сверка с Excel; компенсация за отменённую серию; …"
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            border: '1px solid rgba(0,0,0,0.12)',
                            borderRadius: 8,
                            fontSize: 13,
                            outline: 'none',
                            fontFamily: 'inherit',
                            resize: 'vertical',
                        }}
                    />
                </label>

                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={onClose}
                        style={{
                            flex: 1, padding: '11px 0',
                            background: 'rgba(0,0,0,0.05)',
                            color: COLOR.ink,
                            border: 'none', borderRadius: 10,
                            fontSize: 14, fontWeight: 600,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                    >
                        Отмена
                    </button>
                    <button
                        onClick={save}
                        disabled={!canSave || saving}
                        style={{
                            flex: 1, padding: '11px 0',
                            background: !canSave ? COLOR.ink20 : COLOR.ink,
                            color: COLOR.onInk,
                            border: 'none', borderRadius: 10,
                            fontSize: 14, fontWeight: 700,
                            cursor: !canSave || saving ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                            fontFamily: 'inherit',
                        }}
                    >
                        {saving && <Loader2 size={14} className="animate-spin" />}
                        Сохранить
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
