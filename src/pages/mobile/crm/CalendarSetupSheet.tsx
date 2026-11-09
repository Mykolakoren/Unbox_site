import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle, Copy, ShieldCheck } from 'lucide-react';
import { crmApi } from '../../../api/crm';
import { useCrmStore } from '../../../store/crmStore';
import { useUserStore } from '../../../store/userStore';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { Field, Input } from '../../../components/ui/Field';
import { apiErrorMessage } from '../../../utils/errors';

/** Адрес бота Unbox, с которым делятся календарём. Настоящий придёт с сервера
 *  при проверке подключения — тот же запасной, что в компьютерных «Настройках». */
const FALLBACK_SERVICE_ACCOUNT = 'psycrm-bot@psycrm-calendar.iam.gserviceaccount.com';

/**
 * «Календарь и счета» на телефоне (09.11, ревью п. 6).
 *
 * Раньше подключить Google Календарь с телефона было нельзя: кнопка ⟳ отвечала
 * «укажите его в Настройках CRM», а таких настроек на телефоне не было — тупик.
 * Здесь три шага (поделиться календарём с ботом → вписать адрес → проверить) —
 * те же вызовы, что у компьютерной страницы Psy-CRM → «Настройки». Счета для
 * оплаты показываем списком; правятся они на компьютере.
 */
export function CalendarSetupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
    const settings = useCrmStore(s => s.crmSettings);
    const fetchCrmSettings = useCrmStore(s => s.fetchCrmSettings);
    const paymentAccounts = useCrmStore(s => s.paymentAccounts);
    const fetchPaymentAccounts = useCrmStore(s => s.fetchPaymentAccounts);
    const myEmail = useUserStore(s => s.currentUser?.email) || '';
    const [calendarId, setCalendarId] = useState('');
    const [saving, setSaving] = useState(false);
    const [serviceAccount, setServiceAccount] = useState(FALLBACK_SERVICE_ACCOUNT);
    const [copied, setCopied] = useState(false);
    const [test, setTest] = useState<{ state: 'idle' | 'loading' | 'ok' | 'error'; message?: string }>({ state: 'idle' });

    useEffect(() => {
        if (!open) return;
        setTest({ state: 'idle' });
        fetchPaymentAccounts();
        fetchCrmSettings().then(s => setCalendarId(s?.calendarId || myEmail));
    }, [open, fetchCrmSettings, fetchPaymentAccounts, myEmail]);

    const connected = !!settings?.calendarId;

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(serviceAccount);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch { /* старый браузер — адрес виден, его можно выделить */ }
    };

    const check = async () => {
        setTest({ state: 'loading' });
        try {
            const r = await crmApi.testCalendarConnection();
            if (r.serviceAccount) setServiceAccount(r.serviceAccount);
            setTest(r.ok
                ? { state: 'ok', message: r.message || 'Подключение работает' }
                : { state: 'error', message: r.message || 'Не удалось подключиться' });
        } catch (e) {
            setTest({ state: 'error', message: apiErrorMessage(e, 'Сервер не ответил — попробуйте через минуту') });
        }
    };

    const save = async () => {
        const id = calendarId.trim();
        if (!id) return;
        setSaving(true);
        try {
            await crmApi.updateSettings({ calendarId: id });
            await fetchCrmSettings();
            toast.success('Календарь подключён — проверяем доступ');
            await check();
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось сохранить календарь — попробуйте ещё раз'));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Sheet
            open={open}
            onClose={onClose}
            title="Календарь и счета"
            description={connected ? `Google Календарь подключён: ${settings?.calendarId}` : 'Google Календарь не подключён'}
            footer={(
                <Button block loading={saving} disabled={!calendarId.trim()} onClick={save}>
                    {connected ? 'Сохранить и проверить' : 'Подключить календарь'}
                </Button>
            )}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <p style={text}>
                    Встречи из вашего Google Календаря сами появятся в CRM: клиенты, сессии, переносы.
                </p>
                <ol style={{ margin: 0, paddingLeft: 20, listStyle: 'decimal', display: 'flex', flexDirection: 'column', gap: 10, ...text }}>
                    <li>
                        В Google Календаре откройте «Настройки и общий доступ» своего календаря →
                        «Поделиться с конкретными пользователями» → добавьте этот адрес
                        с доступом «Внесение изменений в события»:
                        <div style={codeBox}>
                            <code style={{ flex: 1, minWidth: 0, wordBreak: 'break-all', fontSize: 13 }}>{serviceAccount}</code>
                            <Button
                                variant="secondary"
                                size="touch"
                                icon={copied ? <CheckCircle size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                                onClick={copy}
                            >
                                {copied ? 'Скопировано' : 'Копировать'}
                            </Button>
                        </div>
                    </li>
                    <li>Впишите адрес календаря ниже — обычно это ваша почта Google.</li>
                    <li>Нажмите «{connected ? 'Сохранить и проверить' : 'Подключить календарь'}».</li>
                </ol>
                <Field label="Адрес календаря" hint="Ваша почта Google или адрес вида …@group.calendar.google.com">
                    <Input
                        kind="email"
                        value={calendarId}
                        onChange={e => setCalendarId(e.target.value)}
                        placeholder="name@gmail.com"
                    />
                </Field>
                {connected && (
                    <Button
                        variant="secondary"
                        loading={test.state === 'loading'}
                        icon={<ShieldCheck size={16} aria-hidden="true" />}
                        onClick={check}
                    >
                        Проверить подключение
                    </Button>
                )}
                {test.state === 'ok' && (
                    <div role="status" style={{ ...note, background: 'var(--status-ok-bg)', color: 'var(--status-ok-fg)' }}>{test.message}</div>
                )}
                {test.state === 'error' && (
                    <div role="alert" style={{ ...note, background: 'var(--status-danger-bg)', color: 'var(--status-danger-fg)' }}>{test.message}</div>
                )}

                <div style={{ height: 1, background: 'var(--color-ink-08)', margin: '4px 0' }} />
                <div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Счета для оплаты</div>
                    <p style={{ ...text, margin: '0 0 8px' }}>
                        Куда записываются оплаты клиентов: {paymentAccounts.map(a => a.label).join(', ') || '—'}.
                    </p>
                    <p style={{ ...text, margin: 0, color: 'var(--color-ink-60)' }}>
                        Добавить или переименовать счёт можно на компьютере: Psy-CRM → «Настройки» → «Счета для оплаты».
                    </p>
                </div>
            </div>
        </Sheet>
    );
}

const text: React.CSSProperties = { fontSize: 14, lineHeight: 1.45, color: 'var(--color-ink-80)', margin: 0 };

const codeBox: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    marginTop: 8, padding: '8px 10px', borderRadius: 10,
    background: 'var(--color-sunken)', border: '1px solid var(--color-ink-08)', color: 'var(--color-ink)',
};

const note: React.CSSProperties = { borderRadius: 10, padding: '10px 12px', fontSize: 14, lineHeight: 1.4 };
