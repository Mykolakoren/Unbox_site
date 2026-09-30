import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { COLOR, STATUS, TEXT } from '../../design/tokens';
import { toastApiError } from '../../utils/errors';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { Field, Input } from '../../components/ui/Field';
import { Button } from '../../components/ui/Button';

const BOT_USERNAME = 'Unbox_Booking_G_Bot';

/**
 * /m/profile — «Профиль и уведомления» (волна 2, G4-06).
 *
 * Раньше с телефона нельзя было поменять имя и телефон — человек писал
 * администратору, а ссылка на /dashboard/profile открывала компьютерный
 * кабинет. Здесь то же, что на компьютере (ProfilePage): черновик на
 * странице и один PATCH /users/me по кнопке «Сохранить» — через updateUser.
 * Уведомления приходят в Telegram — привязка бота здесь же.
 */
export function MobileProfileEdit() {
    const currentUser = useUserStore(s => s.currentUser);
    const updateUser = useUserStore(s => s.updateUser);
    const fetchCurrentUser = useUserStore(s => s.fetchCurrentUser);

    const savedName = currentUser?.name || '';
    const savedPhone = currentUser?.phone || '';
    const [name, setName] = useState(savedName);
    const [phone, setPhone] = useState(savedPhone);
    const [nameError, setNameError] = useState<string | null>(null);
    const [phoneError, setPhoneError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [tgBusy, setTgBusy] = useState(false);
    // Пришли новые данные с сервера — обновляем черновик (как на компьютере).
    useEffect(() => { setName(savedName); }, [savedName]);
    useEffect(() => { setPhone(savedPhone); }, [savedPhone]);

    if (!currentUser) return null;

    const isDirty = name.trim() !== savedName || phone.trim() !== savedPhone;
    const tgConnected = !!currentUser.telegramId && /^\d+$/.test(currentUser.telegramId);

    const save = async () => {
        if (saving) return;
        const nextName = name.trim();
        const nextPhone = phone.trim();
        // Те же проверки, что на компьютере (ProfilePage → handleSave).
        if (!nextName) { setNameError('Введите имя — его видит администратор'); return; }
        if (nextPhone && nextPhone !== savedPhone && nextPhone.replace(/\D/g, '').length < 8) {
            setPhoneError('Похоже, номер неполный — проверьте его');
            return;
        }
        const updates: { name?: string; phone?: string } = {};
        if (nextName !== savedName) updates.name = nextName;
        if (nextPhone !== savedPhone) updates.phone = nextPhone;
        if (Object.keys(updates).length === 0) return;
        setSaving(true);
        try {
            await updateUser(updates);
            toast.success('Сохранили');
        } catch (err) {
            toastApiError(err, 'Не удалось сохранить. Попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    const connectTg = async () => {
        setTgBusy(true);
        try {
            const { data } = await api.post<{ url: string; expires_at: string }>('/telegram/link-token');
            window.open(data.url, '_blank', 'noopener,noreferrer');
            toast.info('В Telegram нажмите «Start» и вернитесь сюда — статус обновится сам.', { duration: 6000 });
            // Ссылка живёт 30 минут (backend LINK_TOKEN_TTL) — столько и ждём.
            const deadline = Date.now() + 30 * 60 * 1000;
            const tick = setInterval(async () => {
                if (Date.now() > deadline) { clearInterval(tick); return; }
                await fetchCurrentUser();
                const cu = useUserStore.getState().currentUser;
                if (cu?.telegramId && /^\d+$/.test(cu.telegramId)) {
                    clearInterval(tick);
                    toast.success('Telegram подключён');
                }
            }, 2500);
        } catch (err) {
            toastApiError(err, 'Не удалось создать ссылку. Попробуйте позже');
        } finally {
            setTgBusy(false);
        }
    };

    return (
        <div style={{ paddingBottom: 24 }}>
            <MobilePageHeader title="Профиль и уведомления" fallbackTo="/m/me" />

            <form
                onSubmit={e => { e.preventDefault(); void save(); }}
                style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}
            >
                <Field label="Имя" error={nameError ?? undefined}>
                    <Input
                        kind="name"
                        value={name}
                        onChange={e => { setName(e.target.value); setNameError(null); }}
                    />
                </Field>
                <Field label="Телефон" hint="Для связи по брони — видит только администратор" error={phoneError ?? undefined} optional>
                    <Input
                        kind="phone"
                        value={phone}
                        onChange={e => { setPhone(e.target.value); setPhoneError(null); }}
                    />
                </Field>
                <Field label="Почта" hint="Почту для входа меняет администратор">
                    <Input kind="email" value={currentUser.email} readOnly />
                </Field>
                <Button type="submit" block loading={saving} disabled={!isDirty}>
                    {isDirty ? 'Сохранить' : 'Изменений нет'}
                </Button>
            </form>

            <section style={{ padding: '24px 16px 0' }} aria-labelledby="m-profile-notify">
                <h2 id="m-profile-notify" style={sectionTitle}>Уведомления</h2>
                <button
                    type="button"
                    className="press"
                    onClick={tgConnected ? () => window.open(`https://t.me/${BOT_USERNAME}`, '_blank', 'noopener,noreferrer') : connectTg}
                    disabled={tgBusy}
                    style={{
                        width: '100%', minHeight: 64,
                        background: COLOR.card, color: COLOR.ink,
                        border: `1px solid ${COLOR.ink10}`, borderRadius: 16,
                        padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12,
                        cursor: tgBusy ? 'wait' : 'pointer', fontFamily: 'inherit', textAlign: 'left',
                    }}
                >
                    <Send size={20} aria-hidden="true" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: TEXT.body, fontWeight: 600 }}>Telegram</span>
                        <span style={{ display: 'block', fontSize: TEXT.small, color: COLOR.ink60 }}>
                            {tgConnected
                                ? 'Подключён — напоминания за сутки и новости по броням'
                                : 'Не подключён — нажмите, чтобы получать напоминания'}
                        </span>
                    </span>
                    {tgConnected
                        ? <Check size={20} color={STATUS.ok.fg} aria-label="Подключён" />
                        : <ArrowUpRight size={18} color={COLOR.ink60} aria-hidden="true" />}
                </button>
            </section>
        </div>
    );
}

const sectionTitle: React.CSSProperties = {
    fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color: COLOR.ink60, margin: '0 0 8px',
};
