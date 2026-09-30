import { useState, useCallback, useEffect, useRef } from 'react';
import { useUserStore } from '../store/userStore';
import { Button as UiButton } from '../components/ui/Button';
import { PhoneInput } from '../components/ui/PhoneInput';
import { Shield, User, Phone, Mail, Plus, Lock, Eye, EyeOff, Pencil, X, Loader2, Send, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { toast } from 'sonner';
import { api } from '../api/client';
import { apiErrorMessage } from '../utils/errors';
import { hasPermission } from '../utils/permissions';
import { GH, GH_SANS, GH_MONO } from '../hooks/useDesignFlag';
import { COLOR, STATUS } from '../design/tokens';
import { formatGel } from '../utils/format';

export function ProfilePage() {
    const { currentUser, updateUser } = useUserStore();
    if (!currentUser) return null;
    const isAdmin = currentUser.role && ['owner', 'senior_admin', 'admin'].includes(currentUser.role);
    return <GridHouseProfilePage currentUser={currentUser} updateUser={updateUser} isAdmin={isAdmin} />;
}

// ── Telegram Connect Hook ───────────────────────────────────────────────────
// Generates a one-time link, opens it, and polls /users/me until the backend
// reports telegram_id is set (meaning the bot received /start <token>).

function useTelegramConnect() {
    const { fetchCurrentUser } = useUserStore();
    const [isConnecting, setIsConnecting] = useState(false);
    /** Hold the active link-token while polling. Used by the UI to render
     *  Safari-fallback («Скопировать команду») — Safari часто не доносит
     *  `?start=<token>` payload до Telegram-приложения, оставляя юзера
     *  с голым /start. Чтобы это обойти, показываем токен текстом и
     *  кнопку «Скопировать `/start <token>`» — юзер вставляет это в
     *  чат с ботом руками. */
    const [activeToken, setActiveToken] = useState<string | null>(null);
    const [activeUrl, setActiveUrl] = useState<string | null>(null);
    const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
    const deadline = useRef<number>(0);

    const stopPolling = useCallback(() => {
        if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
        setIsConnecting(false);
        setActiveToken(null);
        setActiveUrl(null);
    }, []);

    useEffect(() => () => stopPolling(), [stopPolling]);

    const connect = useCallback(async () => {
        try {
            setIsConnecting(true);
            const { data } = await api.post<{ token: string; url: string; expires_at: string }>('/telegram/link-token');
            setActiveToken(data.token);
            setActiveUrl(data.url);
            // Open bot deep-link (Telegram app if installed, else web)
            window.open(data.url, '_blank', 'noopener,noreferrer');
            toast.info(
                'Откройте Telegram → нажмите Start. Не работает в Safari? Скопируйте команду ниже и отправьте боту.',
                { duration: 10000 },
            );

            // Poll every 2s for up to 30 minutes — matches backend
            // LINK_TOKEN_TTL. Раньше было 3 мин и юзеры (Valentina 2026-06-02)
            // не успевали открыть Telegram → нажать Start → дождаться.
            deadline.current = Date.now() + 30 * 60 * 1000;
            pollTimer.current = setInterval(async () => {
                if (Date.now() > deadline.current) {
                    stopPolling();
                    toast.error('Не дождались подключения. Попробуйте ещё раз.');
                    return;
                }
                await fetchCurrentUser();
                const cu = useUserStore.getState().currentUser;
                if (cu?.telegramId && /^\d+$/.test(cu.telegramId)) {
                    stopPolling();
                    toast.success('Telegram подключён');
                }
            }, 2000);
        } catch (e) {
            stopPolling();
            toast.error('Не удалось создать ссылку. Попробуйте позже.');
            console.error(e);
        }
    }, [fetchCurrentUser, stopPolling]);

    return { connect, isConnecting, cancel: stopPolling, activeToken, activeUrl };
}


// ── Telegram ID Field ───────────────────────────────────────────────────────


// ── Legacy Design Switcher ──────────────────────────────────────────────────

// ── Change Password Section ──────────────────────────────────────────────────

function ChangePasswordSection() {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showCurrent, setShowCurrent] = useState(false);
    const [showNew, setShowNew] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            toast.error('Пароль должен быть не менее 6 символов');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Пароли не совпадают');
            return;
        }
        setSaving(true);
        try {
            await api.post('/users/me/change-password', {
                current_password: currentPassword,
                new_password: newPassword,
            });
            toast.success('Пароль успешно изменён');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка смены пароля');
        } finally {
            setSaving(false);
        }
    };

    const field = 'w-full min-h-11 pl-10 pr-11 rounded-lg border border-ink-20 bg-card text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent';
    const eyeBtn = 'absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-ink-60 hover:text-ink';
    return (
        // Раскрывающийся раздел «Сменить пароль» (G3-18): один стиль полей, одна кнопка.
        <details className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-body font-semibold text-ink">
                <Lock size={18} className="text-ink-60" aria-hidden="true" />
                Сменить пароль
                <span className="ml-auto text-small font-normal text-ink-60 group-open:hidden">Открыть</span>
                <span className="ml-auto hidden text-small font-normal text-ink-60 group-open:inline">Свернуть</span>
            </summary>
            <form onSubmit={handleSubmit} className="mt-4 space-y-4 max-w-md">
                <div>
                    <label htmlFor="pw-current" className="block text-small text-ink-60 mb-1">Текущий пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                        <input
                            id="pw-current"
                            type={showCurrent ? 'text' : 'password'}
                            autoComplete="current-password"
                            className={field}
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            required
                        />
                        <button type="button" onClick={() => setShowCurrent(!showCurrent)} className={eyeBtn}
                            aria-label={showCurrent ? 'Скрыть пароль' : 'Показать пароль'}>
                            {showCurrent ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        </button>
                    </div>
                </div>
                <div>
                    <label htmlFor="pw-new" className="block text-small text-ink-60 mb-1">Новый пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                        <input
                            id="pw-new"
                            type={showNew ? 'text' : 'password'}
                            autoComplete="new-password"
                            className={field}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={6}
                            placeholder="Минимум 6 символов"
                        />
                        <button type="button" onClick={() => setShowNew(!showNew)} className={eyeBtn}
                            aria-label={showNew ? 'Скрыть пароль' : 'Показать пароль'}>
                            {showNew ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                        </button>
                    </div>
                </div>
                <div>
                    <label htmlFor="pw-repeat" className="block text-small text-ink-60 mb-1">Повторите новый пароль</label>
                    <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                        <input
                            id="pw-repeat"
                            type="password"
                            autoComplete="new-password"
                            className={field}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                        />
                    </div>
                    {confirmPassword && newPassword !== confirmPassword && (
                        <p className="text-small mt-1" style={{ color: STATUS.danger.fg }}>Пароли не совпадают</p>
                    )}
                </div>
                <UiButton type="submit" size="touch" loading={saving} disabled={!currentPassword || !newPassword || newPassword !== confirmPassword}>
                    {saving ? 'Сохраняем…' : 'Сменить пароль'}
                </UiButton>
            </form>
        </details>
    );
}

// ── Change Email Inline ─────────────────────────────────────────────────────

function ChangeEmailInline({ currentEmail }: { currentEmail: string }) {
    const { fetchCurrentUser } = useUserStore();
    const [editing, setEditing] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);

    const field = 'w-full min-h-11 pl-10 pr-3 rounded-lg border border-ink-20 bg-card text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent';

    if (!editing) {
        return (
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                    <input
                        id="profile-email"
                        type="email"
                        className={`${field} bg-sunken`}
                        value={currentEmail}
                        readOnly
                    />
                </div>
                <UiButton variant="secondary" size="touch" icon={<Pencil size={16} aria-hidden="true" />}
                    onClick={() => { setNewEmail(currentEmail); setEditing(true); }}>
                    Изменить
                </UiButton>
            </div>
        );
    }

    const handleSave = async () => {
        if (!newEmail || newEmail === currentEmail) {
            toast.error('Введите новый email');
            return;
        }
        if (!password) {
            toast.error('Введите пароль для подтверждения');
            return;
        }
        setSaving(true);
        try {
            await api.post('/users/me/change-email', {
                new_email: newEmail,
                password,
            });
            toast.success('Email успешно изменён');
            await fetchCurrentUser();
            setEditing(false);
            setPassword('');
        } catch (err: any) {
            toast.error(err?.response?.data?.detail || 'Ошибка смены email');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-3 border border-ink-10 bg-sunken p-4">
            <div className="text-body font-semibold text-ink">Смена email</div>
            <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                <input
                    type="email"
                    aria-label="Новый email"
                    autoComplete="email"
                    className={field}
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="Новый email"
                    autoFocus
                />
            </div>
            <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-60" size={18} aria-hidden="true" />
                <input
                    type={showPw ? 'text' : 'password'}
                    aria-label="Текущий пароль для подтверждения"
                    autoComplete="current-password"
                    className={`${field} pr-11`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Текущий пароль для подтверждения"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                    aria-label={showPw ? 'Скрыть пароль' : 'Показать пароль'}
                    className="absolute right-0 top-0 h-11 w-11 flex items-center justify-center text-ink-60 hover:text-ink">
                    {showPw ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
                </button>
            </div>
            <div className="flex gap-2">
                <UiButton size="touch" className="flex-1" loading={saving} disabled={!newEmail || !password} onClick={handleSave}>
                    Сохранить email
                </UiButton>
                <UiButton variant="secondary" size="touch" className="flex-1" onClick={() => { setEditing(false); setPassword(''); }}>
                    Не менять
                </UiButton>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════════════════════
   Grid House — ProfilePage
   ═══════════════════════════════════════════════════════════════ */

const ghpHairline = `1px solid ${GH.ink10}`;
// Одно поле на всю страницу (G3-18): рамка, 44 px, подпись сверху.
const ghpInput: React.CSSProperties = {
    width: '100%', minHeight: 44, padding: '0 12px', fontSize: 16, fontFamily: GH_SANS,
    border: `1px solid ${GH.ink20}`, borderRadius: 8, background: COLOR.card,
    color: GH.ink,
};
const ghpLabel: React.CSSProperties = { display: 'block', fontSize: 14, color: GH.ink60, marginBottom: 6 };

// ── Design Switcher ─────────────────────────────────────────────────────────

// ── Grid House — Telegram Connect ────────────────────────────────────────────

function GridHouseTelegramConnect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const { connect, isConnecting, cancel, activeToken } = useTelegramConnect();
    const isBound = !!value && /^\d+$/.test(value);
    // 2026-06-05 owner: было — input напрямую звал onChange (= PATCH в БД)
    // на каждый keystroke. Если юзер вводил @username, БД заполнялась
    // мусором («@HHValentinaHH»), и polling потом никогда не давал
    // success (regex ждёт цифры). Теперь — локальный state,
    // валидация на blur, в БД попадают только цифры или пустота.
    const [draft, setDraft] = useState(value);
    useEffect(() => { setDraft(value); }, [value]);
    const commit = () => {
        const trimmed = draft.trim();
        if (trimmed === value) return; // ничего не менялось
        if (trimmed === '') {
            onChange('');
            return;
        }
        if (/^\d+$/.test(trimmed)) {
            onChange(trimmed);
            return;
        }
        // @username или что-то нецифровое — не сохраняем, откатываем
        toast.error(
            'В поле — только числовой Telegram chat_id. ' +
            'Узнать своё число можно у бота @userinfobot. ' +
            'Чтобы подключить по логину, используйте кнопку «Подключить Telegram» выше.',
            { duration: 9000 },
        );
        setDraft(value);
    };

    if (isBound) {
        return (
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '12px 14px', border: `1px solid ${GH.ink10}`, background: STATUS.ok.bg,
            }}>
                <CheckCircle2 size={18} color={STATUS.ok.fg} />
                <span style={{ fontSize: 13, color: GH.ink }}>Подключено — уведомления активны</span>
                <button
                    type="button"
                    onClick={() => onChange('')}
                    style={{
                        marginLeft: 'auto', fontSize: 12, fontFamily: GH_MONO,
                        color: GH.ink60, background: 'transparent', border: 'none',
                        textDecoration: 'underline', cursor: 'pointer',
                    }}
                >
                    Отключить
                </button>
            </div>
        );
    }

    return (
        <>
            <button
                type="button"
                onClick={isConnecting ? cancel : connect}
                style={{
                    width: '100%', padding: '12px 16px',
                    // Wave 1: без «телеграм-синего» — главная кнопка чернилами, как везде.
                    background: isConnecting ? GH.ink10 : GH.ink,
                    color: isConnecting ? GH.ink60 : COLOR.onInk,
                    fontWeight: 700, fontSize: 13, fontFamily: GH_SANS,
                    border: 'none', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
            >
                {isConnecting ? (
                    <><Loader2 size={16} className="animate-spin" /> Ждём подтверждения… (отмена)</>
                ) : (
                    <><Send size={16} /> Подключить Telegram</>
                )}
            </button>

            {/* Safari fallback — t.me deep-link не доносит ?start=<token>
                в Telegram-приложение, если открыт из Safari. Юзер видит
                бот, но без полезной нагрузки. Лекарство: показать
                команду текстом + кнопка Скопировать, чтобы юзер вручную
                отправил `/start TOKEN` боту. */}
            {isConnecting && activeToken && (
                <div style={{
                    marginTop: 12,
                    padding: 14,
                    background: STATUS.pending.bg,
                    border: `1px solid ${STATUS.pending.fg}33`,
                }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: STATUS.pending.fg, marginBottom: 6 }}>
                        Не сработало? Отправьте боту команду вручную
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink, lineHeight: 1.55, marginBottom: 10 }}>
                        Откройте бота{' '}
                        <a
                            href="https://t.me/Unbox_Booking_G_Bot"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: GH.ink, textDecoration: 'underline', fontWeight: 600 }}
                        >
                            @Unbox_Booking_G_Bot
                        </a>{' '}
                        и отправьте ему сообщение ниже как есть.
                    </div>
                    <div style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        gap: 0,
                        background: COLOR.card,
                        border: '1px solid ' + GH.ink10,
                    }}>
                        <code style={{
                            flex: 1,
                            padding: '10px 12px',
                            fontFamily: GH_MONO,
                            fontSize: 12,
                            color: GH.ink,
                            wordBreak: 'break-all',
                            lineHeight: 1.4,
                        }}>
                            /start {activeToken}
                        </code>
                        <button
                            type="button"
                            onClick={() => {
                                navigator.clipboard.writeText(`/start ${activeToken}`);
                                toast.success('Скопировано — вставьте боту');
                            }}
                            style={{
                                padding: '0 14px',
                                background: GH.ink,
                                color: COLOR.onInk,
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                letterSpacing: '0.06em',
                                textTransform: 'uppercase' as const,
                                border: 'none',
                                cursor: 'pointer',
                                whiteSpace: 'nowrap',
                            }}
                            aria-label="Скопировать команду"
                        >
                            Копировать
                        </button>
                    </div>
                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 8, lineHeight: 1.5 }}>
                        Бот ответит «Готово, Telegram подключён» — и эта страница
                        тоже подтянет привязку через пару секунд.
                    </div>
                </div>
            )}

            <div style={{ marginTop: 12 }}>
                <label htmlFor="profile-tg-id" style={ghpLabel}>
                    Или вручную — числовой chat_id
                </label>
                <input
                    id="profile-tg-id"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    style={ghpInput}
                    placeholder="142420406"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                />
                <div style={{ fontSize: 12, color: GH.ink60, marginTop: 6, lineHeight: 1.5 }}>
                    Узнать своё число — напишите{' '}
                    <a href="https://t.me/userinfobot" target="_blank" rel="noopener noreferrer"
                       style={{ color: GH.ink, textDecoration: 'underline' }}>
                        @userinfobot
                    </a>, он пришлёт ваш chat_id. @username сюда не подойдёт —
                    используйте кнопку «Подключить Telegram» выше.
                </div>
            </div>
        </>
    );
}


interface GridHouseProfilePageProps {
    currentUser: any;
    updateUser: (data: any) => Promise<void>;
    isAdmin: boolean | "" | undefined;
}

/** Тост об ошибке сохранения профиля. Общий перехватчик (api/client.ts) сам
 *  показывает тост на 5xx, 422, 409 и обрыв связи — их не дублируем. Остальное
 *  (например, 400 «Имя не может быть пустым») раньше молча уходило в консоль. */
function toastProfileSaveError(err: any, fallback: string) {
    const status = err?.response?.status;
    const shownByInterceptor = status
        ? status >= 500 || status === 422 || status === 409
        : err?.code === 'ECONNABORTED' || err?.message === 'Network Error';
    if (shownByInterceptor) return;
    const detail = err?.response?.data?.detail;
    toast.error(detail ? apiErrorMessage(err, fallback) : fallback);
}

function GridHouseProfilePage({ currentUser, updateUser, isAdmin }: GridHouseProfilePageProps) {
    // G3-01 (аудит 29.09): раньше каждое нажатие клавиши сразу уходило PATCH'ем
    // на сервер, а поле ждало ответа — при быстром наборе буквы терялись, курсор
    // прыгал в конец, стёртое имя сохранялось пустым, а «Сохранить изменения»
    // ничего не делала. Теперь имя и телефон — черновик на странице, на сервер
    // уходят один раз по кнопке. Та же страница — /dashboard/profile,
    // /crm/account и /admin/account.
    const savedName: string = currentUser.name || '';
    const savedPhone: string = currentUser.phone || '';
    const [name, setName] = useState(savedName);
    const [phone, setPhone] = useState(savedPhone);
    const [saving, setSaving] = useState(false);
    // Данные пришли с сервера заново (сохранили, подтянули профиль) — обновляем
    // черновик. Фоновый опрос Telegram-привязки имя не меняет, набор не собьёт.
    useEffect(() => { setName(savedName); }, [savedName]);
    useEffect(() => { setPhone(savedPhone); }, [savedPhone]);

    const isDirty = name.trim() !== savedName || phone.trim() !== savedPhone;

    const handleSave = async () => {
        if (saving) return;
        const nextName = name.trim();
        const nextPhone = phone.trim();
        if (!nextName) {
            toast.error('Имя не может быть пустым');
            return;
        }
        if (nextPhone && nextPhone !== savedPhone && nextPhone.replace(/\D/g, '').length < 8) {
            toast.error('Похоже, номер телефона неполный — проверьте его');
            return;
        }
        const updates: { name?: string; phone?: string } = {};
        if (nextName !== savedName) updates.name = nextName;
        if (nextPhone !== savedPhone) updates.phone = nextPhone;
        if (Object.keys(updates).length === 0) return;
        setSaving(true);
        try {
            await updateUser(updates);
            setName(nextName);
            setPhone(nextPhone);
            toast.success('Изменения сохранены');
        } catch (err) {
            toastProfileSaveError(err, 'Не удалось сохранить. Попробуйте ещё раз.');
        } finally {
            setSaving(false);
        }
    };

    const onFieldKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
    };

    // PATCH /users/me не принимает telegram_id (защита от угона уведомлений,
    // models/user.py → UserUpdate) — сервер может молча проигнорировать поле.
    // Сверяем ответ, чтобы не показывать успех, которого не было.
    const saveTelegram = async (v: string) => {
        try {
            await updateUser({ telegramId: v });
            const saved = useUserStore.getState().currentUser?.telegramId || '';
            if (saved === v) {
                toast.success(v ? 'Telegram сохранён' : 'Telegram отключён');
            } else {
                toast.error(v
                    ? 'Номер не сохранился. Подключите Telegram кнопкой «Подключить Telegram».'
                    : 'Не получилось отключить Telegram. Напишите администратору.');
            }
        } catch (err) {
            toastProfileSaveError(err, 'Не удалось сохранить Telegram. Попробуйте ещё раз.');
        }
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink }}>
            {/* Шапка: имя и email обычным регистром (раньше email кричал капсом). */}
            <header className="mb-8 flex items-center gap-4 border-b border-ink-10 pb-4">
                <div style={{
                    width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                    background: GH.ink, color: GH.paper, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, fontWeight: 600,
                }}>
                    {currentUser.avatarUrl ? (
                        <img src={currentUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                        currentUser.name?.[0]?.toUpperCase()
                    )}
                </div>
                <div className="min-w-0">
                    <h1 className="m-0 text-heading font-semibold">{currentUser.name}</h1>
                    <div className="mt-1 text-small text-ink-60">{currentUser.email}</div>
                </div>
            </header>

            <div className="grid gap-10 lg:grid-cols-[minmax(0,480px)_minmax(0,1fr)] lg:items-start">
                {/* Форма */}
                <div>
                    <h2 className="m-0 mb-5 text-title font-semibold">Личные данные</h2>

                    <div style={{ marginBottom: 20 }}>
                        <label htmlFor="profile-name" style={ghpLabel}>Имя</label>
                        <input
                            id="profile-name"
                            type="text"
                            style={ghpInput}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            onKeyDown={onFieldKeyDown}
                            disabled={saving}
                            autoComplete="name"
                        />
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <label htmlFor="profile-phone" style={ghpLabel}>Телефон</label>
                        <PhoneInput
                            id="profile-phone"
                            style={ghpInput}
                            value={phone}
                            onChange={setPhone}
                            onKeyDown={onFieldKeyDown}
                            disabled={saving}
                        />
                    </div>

                    <button
                        type="button"
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        className="ui-btn ui-btn--primary ui-btn--touch"
                        aria-busy={saving || undefined}
                        style={{ marginBottom: 32 }}
                    >
                        {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                        {saving ? 'Сохраняем…' : 'Сохранить изменения'}
                    </button>

                    <div style={{ marginBottom: 24, borderTop: ghpHairline, paddingTop: 24 }}>
                        <label htmlFor="profile-email" style={ghpLabel}>Email</label>
                        <ChangeEmailInline currentEmail={currentUser.email} />
                    </div>

                    <div style={{ marginBottom: 24, borderTop: ghpHairline, paddingTop: 24 }}>
                        <h2 className="m-0 mb-1 text-title font-semibold">Уведомления в Telegram</h2>
                        <p className="m-0 mb-3 text-small text-ink-60">
                            Напоминания о бронях и ответы администратора приходят в Telegram.
                        </p>
                        <GridHouseTelegramConnect
                            value={currentUser.telegramId || ''}
                            onChange={saveTelegram}
                        />
                    </div>

                    {/* Password section */}
                    <div style={{ borderTop: ghpHairline, paddingTop: 16, marginBottom: 32 }}>
                        <ChangePasswordSection />
                    </div>
                </div>

                {/* Сводка аккаунта */}
                <aside aria-label="Аккаунт" className="flex flex-col gap-6">
                    <div className="border border-ink-10 bg-card px-5 py-4">
                        <div className="text-small text-ink-60">Баланс</div>
                        <div className="num mt-1 text-title font-semibold" style={{ color: (currentUser.balance ?? 0) < 0 ? STATUS.danger.fg : GH.ink }}>
                            {formatGel(currentUser.balance ?? 0)}
                        </div>
                    </div>
                    {currentUser.subscription ? (
                        <SubscriptionCard user={currentUser} />
                    ) : (
                        <div className="border border-ink-10 bg-card px-5 py-4 text-small text-ink-60">
                            Абонемента нет.{' '}
                            <Link to="/subscriptions" className="font-medium text-ink underline underline-offset-2">Посмотреть абонементы</Link>
                        </div>
                    )}

                    {/* Admin access */}
                    {(isAdmin || hasPermission(currentUser, 'admin.access')) && (
                        <div className="border border-ink-10 bg-card px-5 py-4">
                            <h2 className="m-0 mb-1 text-body font-semibold">Администрирование</h2>
                            <p className="m-0 mb-3 text-small text-ink-60">
                                Вам доступна панель администратора: брони и клиенты.
                            </p>
                            <Link to="/admin" className="ui-btn ui-btn--secondary ui-btn--touch">
                                Панель администратора
                            </Link>
                        </div>
                    )}
                </aside>
            </div>
        </div>
    );
}
