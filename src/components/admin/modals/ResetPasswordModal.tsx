import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Eye, EyeOff, Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../../api/client';

/** Пароль без похожих символов (0/O, 1/l/I) — его диктуют или пересылают клиенту. */
export function generatePassword(len = 10): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const buf = new Uint32Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf, n => alphabet[n % alphabet.length]).join('');
}

/**
 * Сброс пароля клиента админом — вместо двух prompt(), где пароль набирался
 * открытым текстом (аудит 29.09, G7-04). Поле скрыто точками, можно
 * «Придумать» пароль; после сохранения пароль показывается ОДИН раз с кнопкой
 * «Скопировать», чтобы передать клиенту, — дальше его нигде нет.
 */
export function ResetPasswordModal({
    open,
    onClose,
    user,
}: {
    open: boolean;
    onClose: () => void;
    user: { id: string; email: string; name?: string };
}) {
    const [password, setPassword] = useState('');
    const [visible, setVisible] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedPassword, setSavedPassword] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (open) {
            setPassword('');
            setVisible(false);
            setSaving(false);
            setSavedPassword(null);
            setCopied(false);
        }
    }, [open]);

    if (!open) return null;

    const close = () => {
        if (saving) return;
        // Пароль не держим в памяти страницы после закрытия окна.
        setPassword('');
        setSavedPassword(null);
        onClose();
    };

    const tooShort = password.length > 0 && password.length < 6;
    const canSave = password.length >= 6 && !saving;

    const save = async () => {
        if (!canSave) return;
        setSaving(true);
        try {
            await api.post(`/users/${user.id}/change-password`, { new_password: password });
            setSavedPassword(password);
            setPassword('');
            toast.success('Пароль сброшен · запись в журнале аудита');
        } catch (err: any) {
            const d = err?.response?.data?.detail;
            toast.error(typeof d === 'string' ? d : 'Не удалось сбросить пароль');
        } finally {
            setSaving(false);
        }
    };

    const copy = async () => {
        if (!savedPassword) return;
        try {
            await navigator.clipboard.writeText(savedPassword);
            setCopied(true);
        } catch {
            toast.error('Не удалось скопировать — выделите пароль вручную');
        }
    };

    const who = user.name ? `${user.name} (${user.email})` : user.email;

    return createPortal(
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
            <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
                <button
                    type="button"
                    onClick={close}
                    aria-label="Закрыть"
                    className="absolute top-4 right-4 text-unbox-grey hover:text-unbox-dark"
                >
                    <X size={20} />
                </button>

                {savedPassword ? (
                    <>
                        <h3 className="text-xl font-bold text-unbox-dark mb-1">Пароль изменён</h3>
                        <p className="text-sm text-unbox-grey mb-4">Новый пароль для {who}:</p>
                        <div className="flex items-center gap-2 mb-3">
                            <code className="flex-1 px-3 py-2.5 rounded-xl bg-unbox-light/40 border border-unbox-light font-mono text-lg tracking-wide text-unbox-dark select-all break-all">
                                {savedPassword}
                            </code>
                            <button
                                type="button"
                                onClick={copy}
                                className="shrink-0 px-3 py-2.5 rounded-xl border border-unbox-light text-sm font-medium text-unbox-dark hover:bg-unbox-light/50 flex items-center gap-1.5"
                            >
                                {copied ? <Check size={14} className="text-unbox-green" /> : <Copy size={14} />}
                                {copied ? 'Скопирован' : 'Скопировать'}
                            </button>
                        </div>
                        <p className="text-xs text-unbox-grey mb-5">
                            Пароль показан один раз: после закрытия окна его нигде не будет.
                            Передайте клиенту и попросите сменить после входа.
                        </p>
                        <button
                            type="button"
                            onClick={close}
                            className="w-full py-2.5 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-dark"
                        >
                            Готово
                        </button>
                    </>
                ) : (
                    <form onSubmit={(e) => { e.preventDefault(); save(); }}>
                        <h3 className="text-xl font-bold text-unbox-dark mb-1">Сбросить пароль</h3>
                        <p className="text-sm text-unbox-grey mb-4">
                            Новый пароль для {who}. Старый перестанет работать.
                            Действие попадёт в журнал аудита.
                        </p>

                        <label className="block text-xs font-semibold text-unbox-grey mb-1" htmlFor="admin-reset-password">
                            Новый пароль
                        </label>
                        <div className="flex gap-2">
                            <div className="relative flex-1">
                                <input
                                    id="admin-reset-password"
                                    type={visible ? 'text' : 'password'}
                                    autoComplete="new-password"
                                    autoFocus
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="Минимум 6 символов"
                                    className="w-full pl-3 pr-10 py-2.5 rounded-xl border border-unbox-light text-sm focus:outline-none focus:border-unbox-green"
                                />
                                <button
                                    type="button"
                                    onClick={() => setVisible(v => !v)}
                                    aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-unbox-grey hover:text-unbox-dark"
                                >
                                    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => { setPassword(generatePassword()); setVisible(true); }}
                                className="shrink-0 px-3 rounded-xl border border-unbox-light text-sm font-medium text-unbox-dark hover:bg-unbox-light/50"
                            >
                                Придумать
                            </button>
                        </div>
                        <div className="min-h-[20px] mt-1.5 text-xs text-red-600">
                            {tooShort ? 'Минимум 6 символов' : ''}
                        </div>

                        <div className="flex gap-3 mt-4">
                            <button
                                type="button"
                                onClick={close}
                                disabled={saving}
                                className="flex-1 py-2.5 rounded-xl border border-unbox-light text-sm font-medium text-unbox-dark hover:bg-unbox-light/50 disabled:opacity-50"
                            >
                                Отмена
                            </button>
                            <button
                                type="submit"
                                disabled={!canSave}
                                className="flex-1 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {saving && <Loader2 size={14} className="animate-spin" />}
                                Сбросить пароль
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>,
        document.body,
    );
}
