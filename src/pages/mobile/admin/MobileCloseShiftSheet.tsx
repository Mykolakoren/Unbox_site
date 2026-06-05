import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { X, Lock, Loader2 } from 'lucide-react';
import { cashboxApi } from '../../../api/cashbox';

/**
 * Mobile close-shift flow — упрощённая версия десктопной 2-шаговой модалки.
 * Один лист с чек-листом сверху + поле «факт наличных» снизу. Submit
 * блокируется пока все чекбоксы не отмечены и не указана сумма.
 *
 * Owner 2026-06-05: раньше закрытие смены было только на десктопе, и
 * Валентина застряла в админке One — не могла закрыть кассу с iPhone.
 * Эта версия — точная функциональная копия EndShiftModal, без графиков
 * и доп. опций; для нестандартных случаев останется десктоп через
 * ?forceDesktop=1.
 */
interface Props {
    /** Бэкенд принимает branch как строку-метку (например «Unbox One»). */
    branch: string;
    /** Текущий баланс кассы по системе (для подсказки в форме). */
    systemBalance: number;
    onClose: () => void;
    onClosed: () => void;
}

interface ChecklistItem {
    key: string;
    label: string;
    sub: string;
}

const CHECKLIST: ChecklistItem[] = [
    {
        key: 'bookings',
        label: 'Все брони проверены',
        sub: 'Пришедшие отмечены, неявки — no-show, истёкшие — закрыты',
    },
    {
        key: 'transactions',
        label: 'Все приходы и расходы внесены',
        sub: 'Наличные, переводы, мелкие расходы',
    },
    {
        key: 'cash_count',
        label: 'Наличные пересчитаны',
        sub: 'Сумма в кассе совпадает с купюрной разбивкой',
    },
    {
        key: 'rooms',
        label: 'Кабинеты осмотрены',
        sub: 'Свет/кондёр выключены, вещей клиентов нет',
    },
];

export function MobileCloseShiftSheet({ branch, systemBalance, onClose, onClosed }: Props) {
    const [checked, setChecked] = useState<Record<string, boolean>>({});
    const [actualBalance, setActualBalance] = useState<string>('');
    const [notes, setNotes] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [preview, setPreview] = useState<Awaited<ReturnType<typeof cashboxApi.previewCloseShift>> | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    // Подгружаем preview сразу при открытии — там настоящее expected,
    // которое сервер сравнит с введённой суммой.
    useEffect(() => {
        let alive = true;
        cashboxApi.previewCloseShift(branch)
            .then(p => { if (alive) setPreview(p); })
            .catch(e => {
                if (alive) setPreviewError(e?.response?.data?.detail || 'Не удалось получить предпросмотр');
            });
        return () => { alive = false; };
    }, [branch]);

    const allChecked = CHECKLIST.every(i => checked[i.key]);
    const actualNum = parseFloat(actualBalance.replace(/[\s,]/g, '.').replace(/[^\d.-]/g, ''));
    const hasAmount = actualBalance.trim() !== '' && Number.isFinite(actualNum);
    const expected = preview?.expected ?? systemBalance;
    const drift = hasAmount ? actualNum - expected : 0;
    const hasDrift = hasAmount && Math.abs(drift) >= 0.01;
    const canSubmit = allChecked && hasAmount && !submitting;

    const branchLabel = branch;

    const handleSubmit = async () => {
        if (!canSubmit) return;
        if (hasDrift && !notes.trim()) {
            const ok = window.confirm(
                `Расхождение: ${drift > 0 ? '+' : ''}${drift.toFixed(2)} ₾ ` +
                `(${actualNum.toFixed(2)} факт vs ${expected.toFixed(2)} ожидание).\n\n` +
                'Сохранить без причины? Лучше пояснить в поле «Заметки».',
            );
            if (!ok) return;
        }
        setSubmitting(true);
        try {
            await cashboxApi.endShift({
                actual_balance: actualNum,
                notes: notes.trim() || undefined,
                branch,
            });
            toast.success(`Смена закрыта — ${branchLabel}`);
            onClosed();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось закрыть смену');
            setSubmitting(false);
        }
    };

    return (
        <div
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(14,14,14,0.55)', zIndex: 200,
                display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    width: '100%', maxWidth: 480,
                    background: '#fff',
                    borderRadius: '20px 20px 0 0',
                    padding: 20,
                    paddingBottom: 'calc(20px + env(safe-area-inset-bottom, 0px))',
                    display: 'flex', flexDirection: 'column', gap: 14,
                    maxHeight: '92vh',
                    overflowY: 'auto',
                }}
            >
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 700,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: '#999',
                        }}>
                            Закрытие смены
                        </div>
                        <div style={{ fontSize: 19, fontWeight: 800, marginTop: 4 }}>
                            {branchLabel}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Закрыть"
                        style={{
                            background: 'rgba(0,0,0,0.04)',
                            border: 'none', borderRadius: 8,
                            width: 32, height: 32,
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Checklist */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {CHECKLIST.map(item => {
                        const isOn = !!checked[item.key];
                        return (
                            <label
                                key={item.key}
                                style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10,
                                    padding: '10px 12px',
                                    background: isOn ? '#E6F4EA' : '#F4F4F2',
                                    borderRadius: 10, cursor: 'pointer',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={isOn}
                                    onChange={e => setChecked(c => ({ ...c, [item.key]: e.target.checked }))}
                                    style={{
                                        width: 20, height: 20, marginTop: 2,
                                        cursor: 'pointer', flexShrink: 0,
                                    }}
                                />
                                <div style={{ flex: 1 }}>
                                    <div style={{
                                        fontSize: 14, fontWeight: 700,
                                        color: isOn ? '#1B6E36' : '#0E0E0E',
                                    }}>
                                        {item.label}
                                    </div>
                                    <div style={{
                                        fontSize: 11, color: '#666', marginTop: 2, lineHeight: 1.45,
                                    }}>
                                        {item.sub}
                                    </div>
                                </div>
                            </label>
                        );
                    })}
                </div>

                {/* Cash count */}
                <div style={{
                    background: '#F4F4F2', borderRadius: 12, padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                }}>
                    <div>
                        <div style={{
                            fontSize: 11, fontWeight: 700,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: '#666',
                        }}>
                            Касса в системе ожидает
                        </div>
                        <div style={{
                            fontSize: 22, fontWeight: 800, marginTop: 2,
                            fontVariantNumeric: 'tabular-nums',
                        }}>
                            {expected.toFixed(2)} ₾
                        </div>
                        {previewError && (
                            <div style={{ fontSize: 11, color: '#C8253A', marginTop: 4 }}>
                                {previewError}
                            </div>
                        )}
                    </div>

                    <div>
                        <label style={{
                            fontSize: 11, fontWeight: 700,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: '#666',
                            display: 'block', marginBottom: 4,
                        }}>
                            Фактически в кассе
                        </label>
                        <input
                            type="number"
                            inputMode="decimal"
                            placeholder="например 1280"
                            value={actualBalance}
                            onChange={e => setActualBalance(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '10px 12px',
                                fontSize: 18, fontWeight: 800,
                                fontVariantNumeric: 'tabular-nums',
                                border: '1px solid rgba(0,0,0,0.10)',
                                borderRadius: 10,
                                fontFamily: 'inherit',
                                background: '#fff',
                            }}
                        />
                    </div>

                    {hasAmount && (
                        <div style={{
                            display: 'flex', justifyContent: 'space-between',
                            fontSize: 13,
                            color: hasDrift ? '#C8253A' : '#1B6E36',
                            fontWeight: 700,
                        }}>
                            <span>Расхождение</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {drift === 0 ? '0,00 ₾' : `${drift > 0 ? '+' : ''}${drift.toFixed(2)} ₾`}
                            </span>
                        </div>
                    )}

                    <div>
                        <label style={{
                            fontSize: 11, fontWeight: 700,
                            letterSpacing: '0.08em', textTransform: 'uppercase',
                            color: '#666',
                            display: 'block', marginBottom: 4,
                        }}>
                            Заметки {hasDrift && <span style={{ color: '#C8253A' }}>(для расхождения)</span>}
                        </label>
                        <textarea
                            placeholder={hasDrift
                                ? 'Опиши откуда расхождение (сдача, недосчёт, инкассация)'
                                : 'Свободный комментарий, по желанию'}
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            rows={hasDrift ? 3 : 2}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                fontSize: 13,
                                border: '1px solid rgba(0,0,0,0.10)',
                                borderRadius: 8,
                                fontFamily: 'inherit',
                                background: '#fff',
                                resize: 'vertical',
                            }}
                        />
                    </div>
                </div>

                {/* Submit */}
                <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    style={{
                        width: '100%',
                        padding: '14px 16px',
                        background: canSubmit ? '#0E0E0E' : 'rgba(0,0,0,0.10)',
                        color: canSubmit ? '#fff' : 'rgba(0,0,0,0.40)',
                        border: 'none', borderRadius: 12,
                        fontSize: 15, fontWeight: 800,
                        fontFamily: 'inherit',
                        cursor: canSubmit ? 'pointer' : 'not-allowed',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    }}
                >
                    {submitting
                        ? <><Loader2 size={16} className="animate-spin" /> Сохраняем…</>
                        : <><Lock size={16} /> Закрыть смену · {branchLabel}</>
                    }
                </button>

                {!allChecked && (
                    <div style={{ fontSize: 11, color: '#999', textAlign: 'center' }}>
                        Сначала пройди чек-лист сверху
                    </div>
                )}
            </div>
        </div>
    );
}
