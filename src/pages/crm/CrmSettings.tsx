/**
 * CRM Settings page — payment accounts, currencies, calendar sync, etc.
 */
import { useEffect, useState } from 'react';
import { Settings, Calendar, Link2, Coins, ShieldCheck, Save, Copy, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { PaymentAccountsManager } from '../../components/crm/PaymentAccountsManager';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { CURRENCIES, EXCHANGE_RATES, fetchExchangeRates } from '../../utils/currency';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.45)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.60)',
    boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
};

export function CrmSettings() {
        const { fetchPaymentAccounts } = useCrmStore();
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
                message: e?.response?.data?.detail || 'Сервер не ответил — попробуйте через минуту',
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
            toast.success('Настройки сохранены');
            setTimeout(() => setCalendarSaved(false), 2000);
        } catch {
            toast.error('Ошибка при сохранении');
        }
    };

    const handleToggleSourceOfTruth = async () => {
        const newVal = !sourceOfTruth;
        setSotSaving(true);
        try {
            await crmApi.updateSettings({ googleCalendarSourceOfTruth: newVal });
            setSourceOfTruth(newVal);
            toast.success(newVal ? 'Google Calendar — источник правды' : 'Режим отключён');
        } catch {
            toast.error('Ошибка при сохранении');
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
        } catch {
            toast.error('Ошибка при сохранении курсов');
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
const GHS_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: '0.18em',
    textTransform: 'uppercase',
    color: GH.ink60,
};

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
    onSaveCalendar: () => Promise<void>;
    onToggleSourceOfTruth: () => Promise<void>;
    onSaveRates: () => Promise<void>;
    serviceAccount: string;
    saCopied: boolean;
    onCopyServiceAccount: () => void | Promise<void>;
    connTest: ConnTestState;
    onTestConnection: () => Promise<void>;
}) {
    const inkBtn = (disabled?: boolean): React.CSSProperties => ({
        background: GH.ink,
        color: GH.paper,
        fontFamily: GH_MONO,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        padding: '12px 18px',
        border: 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
    });

    const inputStyle: React.CSSProperties = {
        width: '100%',
        padding: '10px 0',
        border: 'none',
        borderBottom: `2px solid ${GH.ink}`,
        outline: 'none',
        background: 'transparent',
        fontFamily: GH_SANS,
        fontSize: 16,
        color: GH.ink,
    };

    return (
        <div style={{ fontFamily: GH_SANS, color: GH.ink, background: GH.paper, maxWidth: 820 }}>
            {/* ── Header ── */}
            <div style={{ borderBottom: GHS_HAIRLINE, paddingBottom: 28, marginBottom: 36 }}>
                <div style={{ ...GHS_MONO_LABEL, marginBottom: 14 }}>Раздел · Настройки</div>
                <h1
                    style={{
                        fontFamily: GH_SANS,
                        fontWeight: 800,
                        fontSize: 'clamp(36px, 4.5vw, 56px)',
                        lineHeight: 0.95,
                        letterSpacing: '-0.02em',
                        margin: 0,
                    }}
                >
                    Конфигурация CRM.
                </h1>
                <div style={{ ...GHS_MONO_LABEL, marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Settings size={12} /> Счета · Валюты · Интеграции
                </div>
            </div>

            {/* ── Section 01 · Payment accounts (legacy component) ── */}
            <GHSSection num={1} title="Платёжные счета">
                <div style={{ border: `1px solid ${GH.ink10}`, padding: 20, background: GH.paper }}>
                    <PaymentAccountsManager />
                </div>
                <div style={{ ...GHS_MONO_LABEL, color: GH.ink30, marginTop: 12 }}>
                    → Унаследованный компонент
                </div>
            </GHSSection>

            {/* ── Section 02 · Currencies & rates ── */}
            <GHSSection num={2} title="Валюты и курсы">
                <div style={{ ...GHS_MONO_LABEL, color: GH.ink60, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Coins size={12} /> Курсы к GEL для расчёта эквивалента
                </div>

                <div style={{ borderTop: `2px solid ${GH.ink}` }}>
                    {CURRENCIES.map((c, idx) => (
                        <div
                            key={c.code}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '40px 40px 1fr auto',
                                gap: 16,
                                alignItems: 'center',
                                padding: '16px 0',
                                borderBottom: idx === CURRENCIES.length - 1 ? `2px solid ${GH.ink}` : GHS_HAIRLINE,
                            }}
                        >
                            <div style={{ ...GHS_MONO_LABEL, fontVariantNumeric: 'tabular-nums' }}>
                                {String(idx + 1).padStart(2, '0')}
                            </div>
                            <div
                                style={{
                                    fontFamily: GH_SANS,
                                    fontWeight: 800,
                                    fontSize: 22,
                                    letterSpacing: '-0.02em',
                                    color: GH.ink,
                                    width: 40,
                                    textAlign: 'center',
                                }}
                            >
                                {c.symbol}
                            </div>
                            <div
                                style={{
                                    fontFamily: GH_MONO,
                                    fontSize: 13,
                                    fontWeight: 600,
                                    letterSpacing: '0.1em',
                                    color: GH.ink,
                                }}
                            >
                                {c.code}
                            </div>
                            {c.code !== 'GEL' ? (
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                                    <span style={{ ...GHS_MONO_LABEL, color: GH.ink30 }}>1 {c.code} =</span>
                                    <input
                                        type="number"
                                        step="0.001"
                                        value={rates[c.code] ?? ''}
                                        onChange={(e) => setRates((r) => ({ ...r, [c.code]: parseFloat(e.target.value) || 0 }))}
                                        style={{
                                            width: 80,
                                            padding: '4px 0',
                                            border: 'none',
                                            borderBottom: `1px solid ${GH.ink}`,
                                            outline: 'none',
                                            background: 'transparent',
                                            fontFamily: GH_MONO,
                                            fontSize: 14,
                                            textAlign: 'right',
                                            color: GH.ink,
                                            fontVariantNumeric: 'tabular-nums',
                                        }}
                                    />
                                    <span style={{ ...GHS_MONO_LABEL, color: GH.ink30 }}>GEL</span>
                                </div>
                            ) : (
                                <span style={{ ...GHS_MONO_LABEL, color: GH.ink, fontWeight: 600 }}>
                                    Базовая валюта
                                </span>
                            )}
                        </div>
                    ))}
                </div>

                {hasRateChanges && (
                    <button onClick={onSaveRates} disabled={ratesSaving} style={{ ...inkBtn(ratesSaving), marginTop: 20 }}>
                        <Save size={14} />
                        {ratesSaving ? 'Сохраняю' : 'Сохранить курсы'}
                    </button>
                )}
            </GHSSection>

            {/* ── Section 03 · Google Calendar sync ── */}
            <GHSSection num={3} title="Синхронизация Google Calendar">
                <div style={{ ...GHS_MONO_LABEL, color: GH.ink60, marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Calendar size={12} /> ID календаря для автосинхронизации
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 20 }}>
                    <input
                        type="text"
                        value={calendarId}
                        onChange={(e) => setCalendarId(e.target.value)}
                        placeholder="example@group.calendar.google.com"
                        style={inputStyle}
                    />
                    <button onClick={onSaveCalendar} style={inkBtn()}>
                        <Link2 size={14} />
                        {calendarSaved ? 'Сохранено' : 'Сохранить'}
                    </button>
                </div>

                {/* Connection panel — service-account email + test button.
                    Most "404 Not Found" errors at sync time come from the
                    user not having shared their calendar with the bot;
                    surfacing the bot's email here + a one-click smoke test
                    cuts that out. */}
                <div
                    style={{
                        border: GHS_HAIRLINE,
                        background: GH.paper,
                        padding: 18,
                        marginBottom: 28,
                    }}
                >
                    <div style={{ ...GHS_MONO_LABEL, color: GH.ink60, marginBottom: 8 }}>
                        Сервисный аккаунт Unbox
                    </div>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '10px 12px',
                            background: GH.ink5,
                            border: `1px solid ${GH.ink10}`,
                            marginBottom: 14,
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
                        <button
                            type="button"
                            onClick={onCopyServiceAccount}
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: 10,
                                letterSpacing: '0.14em',
                                textTransform: 'uppercase',
                                padding: '6px 10px',
                                background: 'transparent',
                                border: `1px solid ${GH.ink}`,
                                cursor: 'pointer',
                                color: GH.ink,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {saCopied ? <CheckCircle size={12} /> : <Copy size={12} />}
                            {saCopied ? 'Скопировано' : 'Копировать'}
                        </button>
                    </div>
                    <p
                        style={{
                            fontFamily: GH_SANS,
                            fontSize: 13,
                            lineHeight: 1.55,
                            color: GH.ink60,
                            margin: '0 0 14px',
                        }}
                    >
                        Чтобы синхронизация работала, поделитесь своим Google
                        Calendar с этим адресом: в календаре «Настройки и общий
                        доступ» → «Поделиться с конкретными пользователями» → доступ
                        «Внесение изменений в события».
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={onTestConnection}
                            disabled={connTest.state === 'loading'}
                            style={{
                                ...inkBtn(connTest.state === 'loading'),
                                padding: '10px 14px',
                            }}
                        >
                            {connTest.state === 'loading'
                                ? <Loader2 size={14} className="animate-spin" />
                                : <ShieldCheck size={14} />}
                            {connTest.state === 'loading' ? 'Проверяю' : 'Проверить подключение'}
                        </button>
                        {connTest.state === 'ok' && (
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontFamily: GH_SANS,
                                    fontSize: 13,
                                    color: GH.accent,
                                }}
                            >
                                <CheckCircle size={14} /> {connTest.message}
                            </span>
                        )}
                    </div>
                    {connTest.state === 'error' && (
                        <div
                            style={{
                                marginTop: 14,
                                padding: '10px 14px',
                                border: `1px solid ${GH.danger}`,
                                background: 'rgba(220,38,38,0.04)',
                                color: GH.danger,
                                fontFamily: GH_SANS,
                                fontSize: 13,
                                lineHeight: 1.55,
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 8,
                            }}
                        >
                            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>{connTest.message}</span>
                        </div>
                    )}
                </div>

                {/* Source of Truth — custom toggle */}
                <div style={{ borderTop: GHS_HAIRLINE, paddingTop: 20 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20, alignItems: 'start' }}>
                        <button
                            onClick={onToggleSourceOfTruth}
                            disabled={sotSaving}
                            style={{
                                width: 48,
                                height: 24,
                                border: `2px solid ${GH.ink}`,
                                background: sourceOfTruth ? GH.ink : GH.paper,
                                position: 'relative',
                                cursor: sotSaving ? 'default' : 'pointer',
                                padding: 0,
                                marginTop: 2,
                            }}
                            aria-label="Переключить источник правды"
                        >
                            <span
                                style={{
                                    position: 'absolute',
                                    top: 2,
                                    left: sourceOfTruth ? 26 : 2,
                                    width: 16,
                                    height: 16,
                                    background: sourceOfTruth ? GH.paper : GH.ink,
                                    transition: 'left 150ms ease',
                                }}
                            />
                        </button>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <ShieldCheck size={14} color={sourceOfTruth ? GH.ink : GH.ink60} />
                                <div
                                    style={{
                                        fontFamily: GH_SANS,
                                        fontSize: 16,
                                        fontWeight: 700,
                                        letterSpacing: '-0.01em',
                                        color: GH.ink,
                                    }}
                                >
                                    Google Calendar — источник правды
                                </div>
                            </div>
                            <div
                                style={{
                                    fontFamily: GH_SANS,
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                    color: GH.ink60,
                                    maxWidth: 520,
                                }}
                            >
                                Если включено, синхронизация обновит время перенесённых сессий и отменит удалённые из календаря.
                            </div>
                        </div>
                    </div>
                </div>
            </GHSSection>

            {/* Footer */}
            <div style={{ ...GHS_MONO_LABEL, textAlign: 'center', padding: '32px 0 24px', color: GH.ink30 }}>
                Unbox · Конфигурация · {new Date().getFullYear()}
            </div>
        </div>
    );
}

function GHSSection({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 40, paddingBottom: 40, borderBottom: GHS_HAIRLINE }}>
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 20, marginBottom: 24 }}>
                <div
                    style={{
                        fontFamily: GH_MONO,
                        fontSize: 11,
                        letterSpacing: '0.1em',
                        color: GH.ink60,
                        fontVariantNumeric: 'tabular-nums',
                        paddingTop: 6,
                    }}
                >
                    {String(num).padStart(2, '0')}
                </div>
                <h2
                    style={{
                        fontFamily: GH_SANS,
                        fontWeight: 700,
                        fontSize: 22,
                        letterSpacing: '-0.01em',
                        color: GH.ink,
                        margin: 0,
                    }}
                >
                    {title}
                </h2>
            </div>
            <div style={{ paddingLeft: 80 }}>{children}</div>
        </section>
    );
}
