/**
 * CRM Settings page — payment accounts, currencies, calendar sync, etc.
 *
 * Волна 3 (пакет D): общая шапка PageHeader; переключатель «Google Календарь
 * главный» — настоящий role="switch" (вопрос при включении остался); курсы
 * валют правят только owner / senior_admin — остальным только чтение
 * (сервер всё равно проверяет роль в PUT /settings/exchange_rates).
 */
import { useEffect, useState } from 'react';
import { Link2, ShieldCheck, Save, Copy, CheckCircle, AlertCircle, Plus } from 'lucide-react';
import { PaymentAccountsManager } from '../../components/crm/PaymentAccountsManager';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { CURRENCIES, EXCHANGE_RATES, fetchExchangeRates, registerCurrenciesFromRates } from '../../utils/currency';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { STATUS } from '../../design/tokens';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { useUserStore } from '../../store/userStore';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { apiErrorMessage } from '../../utils/errors';

/** Кто может менять курсы валют — то же правило, что на сервере
 *  (settings.py: PUT /settings/exchange_rates). */
const RATE_EDITOR_ROLES = ['owner', 'senior_admin'];

export function CrmSettings() {
    const { fetchPaymentAccounts } = useCrmStore();
    const role = useUserStore(st => st.currentUser?.role);
    const canEditRates = RATE_EDITOR_ROLES.includes(role || '');
    const { confirm } = useConfirmDialog();
    const [calendarId, setCalendarId] = useState('');
    const [calendarSaved, setCalendarSaved] = useState(false);
    const [sourceOfTruth, setSourceOfTruth] = useState(false);
    const [sotSaving, setSotSaving] = useState(false);
    const [rates, setRates] = useState<Record<string, number>>({});
    const [ratesSaving, setRatesSaving] = useState(false);
    // Connection test state — null = idle, otherwise show ok/error result.
    const [connTest, setConnTest] = useState<
        | { state: 'idle' }
        | { state: 'loading' }
        | { state: 'ok'; message: string }
        | { state: 'error'; message: string }
    >({ state: 'idle' });
    // Copy feedback for the service-account email (resets after 2s).
    const [saCopied, setSaCopied] = useState(false);
    // Hard-coded fallback so the UI shows a usable email even before the
    // first /test-connection roundtrip; real value comes from the backend.
    const [serviceAccount, setServiceAccount] = useState(
        'psycrm-bot@psycrm-calendar.iam.gserviceaccount.com',
    );

    useEffect(() => {
        fetchPaymentAccounts();
        crmApi.getSettings().then((s) => {
            setCalendarId(s.calendarId || '');
            setSourceOfTruth(s.googleCalendarSourceOfTruth || false);
        }).catch(() => {});
        fetchExchangeRates().then(r => setRates({ ...r }));
    }, []);

    const handleTestConnection = async () => {
        setConnTest({ state: 'loading' });
        try {
            const r = await crmApi.testCalendarConnection();
            setServiceAccount(r.serviceAccount || serviceAccount);
            if (r.ok) {
                setConnTest({ state: 'ok', message: r.message || 'Подключение работает' });
            } else {
                setConnTest({ state: 'error', message: r.message || 'Не удалось подключиться' });
            }
        } catch (e: any) {
            setConnTest({
                state: 'error',
                message: apiErrorMessage(e, 'Сервер не ответил — попробуйте через минуту'),
            });
        }
    };

    const handleCopyServiceAccount = async () => {
        try {
            await navigator.clipboard.writeText(serviceAccount);
            setSaCopied(true);
            setTimeout(() => setSaCopied(false), 2000);
        } catch {
            // Older browsers / non-https — silently no-op.
        }
    };

    const handleSaveCalendar = async () => {
        try {
            await crmApi.updateSettings({ calendarId: calendarId || null });
            setCalendarSaved(true);
            toast.success('Календарь сохранён');
            setTimeout(() => setCalendarSaved(false), 2000);
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось сохранить календарь — проверьте интернет и попробуйте ещё раз'));
        }
    };

    const handleToggleSourceOfTruth = async () => {
        const newVal = !sourceOfTruth;
        // Включение — опасное (удаление в Google отменит сессию и снимет бронь),
        // поэтому спрашиваем; выключение (защитный режим) — сразу (G5-25).
        if (newVal) {
            const ok = await confirm({
                title: 'Сделать Google Календарь главным?',
                body: 'Удалили событие в Google — сессия отменится, а привязанная бронь кабинета снимется автоматически. Удаляйте события осознанно.',
                confirmLabel: 'Сделать главным',
                cancelLabel: 'Оставить защитный режим',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setSotSaving(true);
        try {
            await crmApi.updateSettings({ googleCalendarSourceOfTruth: newVal });
            setSourceOfTruth(newVal);
            toast.success(newVal ? 'Google Календарь теперь главный' : 'Включён защитный режим');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось переключить режим — попробуйте ещё раз'));
        } finally {
            setSotSaving(false);
        }
    };

    const handleSaveRates = async () => {
        setRatesSaving(true);
        try {
            await api.put('/settings/exchange_rates', rates);
            // Update in-memory rates
            Object.assign(EXCHANGE_RATES, rates);
            toast.success('Курсы сохранены');
        } catch (e) {
            toast.error(apiErrorMessage(e, 'Не удалось сохранить курсы — попробуйте ещё раз'));
        } finally {
            setRatesSaving(false);
        }
    };

    const hasRateChanges = CURRENCIES.some(c => c.code !== 'GEL' && rates[c.code] !== EXCHANGE_RATES[c.code]);

    return (

            <GridHouseCrmSettings
                calendarId={calendarId}
                setCalendarId={setCalendarId}
                calendarSaved={calendarSaved}
                sourceOfTruth={sourceOfTruth}
                sotSaving={sotSaving}
                rates={rates}
                setRates={setRates}
                ratesSaving={ratesSaving}
                hasRateChanges={hasRateChanges}
                canEditRates={canEditRates}
                onSaveCalendar={handleSaveCalendar}
                onToggleSourceOfTruth={handleToggleSourceOfTruth}
                onSaveRates={handleSaveRates}
                serviceAccount={serviceAccount}
                saCopied={saCopied}
                onCopyServiceAccount={handleCopyServiceAccount}
                connTest={connTest}
                onTestConnection={handleTestConnection}
            />
        );
}


// ═══════════════════════════════════════════════════════════════════════════
// Grid House variant — Vignelli × Bierut
// ═══════════════════════════════════════════════════════════════════════════

const GHS_HAIRLINE = `1px solid ${GH.ink10}`;
const GHS_NOTE: React.CSSProperties = { fontSize: 14, lineHeight: 1.5, color: GH.ink60, margin: '0 0 16px' };

type ConnTestState =
    | { state: 'idle' }
    | { state: 'loading' }
    | { state: 'ok'; message: string }
    | { state: 'error'; message: string };

function GridHouseCrmSettings({
    calendarId,
    setCalendarId,
    calendarSaved,
    sourceOfTruth,
    sotSaving,
    rates,
    setRates,
    ratesSaving,
    hasRateChanges,
    canEditRates,
    onSaveCalendar,
    onToggleSourceOfTruth,
    onSaveRates,
    serviceAccount,
    saCopied,
    onCopyServiceAccount,
    connTest,
    onTestConnection,
}: {
    calendarId: string;
    setCalendarId: (v: string) => void;
    calendarSaved: boolean;
    sourceOfTruth: boolean;
    sotSaving: boolean;
    rates: Record<string, number>;
    setRates: React.Dispatch<React.SetStateAction<Record<string, number>>>;
    ratesSaving: boolean;
    hasRateChanges: boolean;
    canEditRates: boolean;
    onSaveCalendar: () => Promise<void>;
    onToggleSourceOfTruth: () => Promise<void>;
    onSaveRates: () => Promise<void>;
    serviceAccount: string;
    saCopied: boolean;
    onCopyServiceAccount: () => void | Promise<void>;
    connTest: ConnTestState;
    onTestConnection: () => Promise<void>;
}) {
    // 07.09 (владелец): добавление своей валюты (например UAH для счёта Mono).
    const [newCurCode, setNewCurCode] = useState('');
    const [newCurRate, setNewCurRate] = useState('');
    const addCurrency = () => {
        const code = newCurCode.trim().toUpperCase();
        const rate = parseFloat(newCurRate);
        if (!/^[A-Z]{2,6}$/.test(code)) { toast.error('Код валюты — 2-6 латинских букв (напр. UAH)'); return; }
        if (CURRENCIES.some(cu => cu.code === code)) { toast.error('Такая валюта уже есть'); return; }
        if (!rate || rate <= 0) { toast.error('Укажите курс: сколько лари (₾) стоит 1 единица'); return; }
        registerCurrenciesFromRates({ [code]: rate });
        setRates(r => ({ ...r, [code]: rate }));
        setNewCurCode('');
        setNewCurRate('');
        toast.info(`${code} добавлена — нажмите «Сохранить курсы», чтобы применить для всех`);
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, maxWidth: 820 }}>
            <PageHeader title="Настройки" description="Счета для оплаты, валюты и Google Календарь." />

            <GHSSection title="Счета для оплаты">
                <PaymentAccountsManager />
            </GHSSection>

            <GHSSection title="Валюты и курсы">
                <p style={GHS_NOTE}>Курсы к лари (₾) — по ним считаем эквивалент платежей в других валютах.</p>

                <div style={{ borderTop: GHS_HAIRLINE }}>
                    {CURRENCIES.map((c) => (
                        <div
                            key={c.code}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '40px 1fr auto',
                                gap: 16,
                                alignItems: 'center',
                                padding: '12px 0',
                                borderBottom: GHS_HAIRLINE,
                            }}
                        >
                            <div style={{ fontWeight: 600, fontSize: 20, textAlign: 'center' }} aria-hidden="true">
                                {c.symbol}
                            </div>
                            <div className="num" style={{ fontSize: 14, fontWeight: 600 }}>{c.code}</div>
                            {c.code === 'GEL' ? (
                                <span style={{ fontSize: 14, color: GH.ink60 }}>Базовая валюта</span>
                            ) : canEditRates ? (
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: GH.ink60 }}>
                                    <span className="num">1 {c.code} =</span>
                                    <input
                                        type="number"
                                        step="0.001"
                                        value={rates[c.code] ?? ''}
                                        onChange={(e) => setRates((r) => ({ ...r, [c.code]: parseFloat(e.target.value) || 0 }))}
                                        aria-label={`Курс ${c.code} к лари`}
                                        className="ui-input tabular-nums"
                                        style={{ width: 110, textAlign: 'right' }}
                                    />
                                    <span>₾</span>
                                </label>
                            ) : (
                                <span className="num" style={{ fontSize: 14, color: GH.ink }}>
                                    1 {c.code} = {rates[c.code] ?? EXCHANGE_RATES[c.code] ?? '—'} ₾
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {canEditRates ? (
                    <>
                        {/* Добавление валюты (07.09) */}
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginTop: 20, flexWrap: 'wrap' }}>
                            <Field label="Код валюты">
                                <Input
                                    value={newCurCode}
                                    onChange={(e) => setNewCurCode(e.target.value)}
                                    placeholder="UAH"
                                    maxLength={6}
                                    style={{ width: 120, textTransform: 'uppercase' }}
                                />
                            </Field>
                            <Field label="Курс: 1 единица =">
                                <Input
                                    type="number"
                                    step="0.001"
                                    value={newCurRate}
                                    onChange={(e) => setNewCurRate(e.target.value)}
                                    placeholder="0.065"
                                    suffix="₾"
                                    style={{ width: 140 }}
                                />
                            </Field>
                            <Button variant="secondary" icon={<Plus size={16} aria-hidden="true" />} onClick={addCurrency}>
                                Добавить валюту
                            </Button>
                        </div>
                        <p style={{ ...GHS_NOTE, marginTop: 8 }}>
                            Валюту можно привязать к счёту выше — платёж этим счётом сразу пойдёт в ней.
                        </p>

                        {hasRateChanges && (
                            <Button
                                variant="primary"
                                loading={ratesSaving}
                                icon={<Save size={16} aria-hidden="true" />}
                                onClick={onSaveRates}
                                style={{ marginTop: 16 }}
                            >
                                Сохранить курсы
                            </Button>
                        )}
                    </>
                ) : (
                    // Волна 3 (G5-M2): специалист видит курсы, но не правит —
                    // сохранить их может только owner / senior_admin.
                    <p style={{ ...GHS_NOTE, marginTop: 12 }}>
                        Курсы задаёт администратор центра.{' '}
                        <a
                            href="https://t.me/UnboxCenter"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                            Попросить добавить валюту
                        </a>
                    </p>
                )}
            </GHSSection>

            <GHSSection title="Google Календарь">
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 20 }}>
                    <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                        <Field label="ID календаря" hint="Сессии CRM будут появляться в этом календаре">
                            <Input
                                value={calendarId}
                                onChange={(e) => setCalendarId(e.target.value)}
                                placeholder="example@group.calendar.google.com"
                            />
                        </Field>
                    </div>
                    <Button variant="primary" icon={<Link2 size={16} aria-hidden="true" />} onClick={onSaveCalendar}>
                        {calendarSaved ? 'Сохранено' : 'Сохранить'}
                    </Button>
                </div>

                {/* Connection panel — service-account email + test button.
                    Most "404 Not Found" errors at sync time come from the
                    user not having shared their calendar with the bot;
                    surfacing the bot's email here + a one-click smoke test
                    cuts that out. */}
                <div style={{ border: GHS_HAIRLINE, padding: 16, marginBottom: 24 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: GH.ink60, marginBottom: 8 }}>
                        Сервисный аккаунт Unbox
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '8px 12px',
                            background: GH.ink5,
                            border: `1px solid ${GH.ink10}`,
                            marginBottom: 12,
                            flexWrap: 'wrap',
                        }}
                    >
                        <code
                            style={{
                                flex: 1,
                                fontFamily: GH_MONO,
                                fontSize: 13,
                                color: GH.ink,
                                wordBreak: 'break-all',
                            }}
                        >
                            {serviceAccount}
                        </code>
                        <Button
                            variant="secondary"
                            size="compact"
                            icon={saCopied ? <CheckCircle size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                            onClick={onCopyServiceAccount}
                        >
                            {saCopied ? 'Скопировано' : 'Копировать'}
                        </Button>
                    </div>
                    <p style={{ ...GHS_NOTE, margin: '0 0 12px' }}>
                        Чтобы синхронизация работала, поделитесь своим Google
                        Календарём с этим адресом: в календаре «Настройки и общий
                        доступ» → «Поделиться с конкретными пользователями» → доступ
                        «Внесение изменений в события».
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <Button
                            variant="secondary"
                            loading={connTest.state === 'loading'}
                            icon={<ShieldCheck size={16} aria-hidden="true" />}
                            onClick={onTestConnection}
                        >
                            {connTest.state === 'loading' ? 'Проверяем…' : 'Проверить подключение'}
                        </Button>
                        {connTest.state === 'ok' && (
                            <span role="status" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, color: STATUS.ok.fg }}>
                                <CheckCircle size={14} aria-hidden="true" /> {connTest.message}
                            </span>
                        )}
                    </div>
                    {connTest.state === 'error' && (
                        <div
                            role="alert"
                            style={{
                                marginTop: 12,
                                padding: '10px 14px',
                                background: STATUS.danger.bg,
                                color: STATUS.danger.fg,
                                fontSize: 14,
                                lineHeight: 1.5,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                            }}
                        >
                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 3 }} aria-hidden="true" />
                            <span>{connTest.message}</span>
                        </div>
                    )}
                </div>

                {/* 31.08: тумблер вернулся НАСТОЯЩИМ — бэкенд теперь хранит
                    флаг (crm_data.gcal_source_of_truth), а синк его читает.
                    Выключен (по умолчанию) = защитный режим: удаления из
                    Google не трогают сессии и брони, приходит уведомление.
                    Волна 3 (G5-14): role="switch" + aria-checked — диктор
                    называет состояние; при включении — тот же вопрос. */}
                <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 16, alignItems: 'start', borderTop: GHS_HAIRLINE, paddingTop: 20 }}>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={sourceOfTruth}
                        aria-labelledby="gcal-main-label"
                        aria-describedby="gcal-main-desc"
                        onClick={onToggleSourceOfTruth}
                        disabled={sotSaving}
                        style={{
                            width: 48,
                            height: 28,
                            border: `2px solid ${GH.ink}`,
                            background: sourceOfTruth ? GH.ink : GH.paper,
                            position: 'relative',
                            cursor: sotSaving ? 'default' : 'pointer',
                            padding: 0,
                            opacity: sotSaving ? 0.6 : 1,
                        }}
                    >
                        <span
                            aria-hidden="true"
                            style={{
                                position: 'absolute',
                                top: 4,
                                left: sourceOfTruth ? 24 : 4,
                                width: 16,
                                height: 16,
                                background: sourceOfTruth ? GH.paper : GH.ink,
                                transition: 'left 150ms ease',
                            }}
                        />
                    </button>
                    <div>
                        <div id="gcal-main-label" style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                            Google Календарь главный
                        </div>
                        <div id="gcal-main-desc" style={{ fontSize: 14, lineHeight: 1.5, color: GH.ink60, maxWidth: 520 }}>
                            {sourceOfTruth
                                ? 'Включено: удалили событие в Google — сессия отменится, привязанная бронь кабинета будет снята автоматически. Удаляйте события осознанно.'
                                : 'Выключено (защитный режим): удаление события в Google не трогает сессию и бронь — придёт уведомление, решение за вами. Переносы событий применяются в обоих режимах.'}
                        </div>
                    </div>
                </div>
            </GHSSection>
        </div>
    );
}

function GHSSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 32, paddingBottom: 32, borderBottom: GHS_HAIRLINE }}>
            <h2 style={{ fontFamily: GH_SANS, fontWeight: 600, fontSize: 20, color: GH.ink, margin: '0 0 16px' }}>
                {title}
            </h2>
            {children}
        </section>
    );
}
