/**
 * CRM Settings page — payment accounts, currencies, calendar sync, etc.
 */
import { useEffect, useState } from 'react';
import { Settings, Calendar, Link2, Coins, ShieldCheck, Save } from 'lucide-react';
import { PaymentAccountsManager } from '../../components/crm/PaymentAccountsManager';
import { useCrmStore } from '../../store/crmStore';
import { crmApi } from '../../api/crm';
import { api } from '../../api/client';
import { toast } from 'sonner';
import { CURRENCIES, EXCHANGE_RATES, fetchExchangeRates } from '../../utils/currency';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const glassCard: React.CSSProperties = {
    background: 'rgba(255,255,255,0.45)',
    backdropFilter: 'blur(24px) saturate(150%)',
    WebkitBackdropFilter: 'blur(24px) saturate(150%)',
    border: '1px solid rgba(255,255,255,0.60)',
    boxShadow: '0 4px 16px rgba(71,109,107,0.06), inset 0 1px 0 rgba(255,255,255,0.70)',
};

export function CrmSettings() {
    const gridHouse = useDesignFlag();
    const { fetchPaymentAccounts } = useCrmStore();
    const [calendarId, setCalendarId] = useState('');
    const [calendarSaved, setCalendarSaved] = useState(false);
    const [sourceOfTruth, setSourceOfTruth] = useState(false);
    const [sotSaving, setSotSaving] = useState(false);
    const [rates, setRates] = useState<Record<string, number>>({});
    const [ratesSaving, setRatesSaving] = useState(false);

    useEffect(() => {
        fetchPaymentAccounts();
        crmApi.getSettings().then((s) => {
            setCalendarId(s.calendarId || '');
            setSourceOfTruth(s.googleCalendarSourceOfTruth || false);
        }).catch(() => {});
        fetchExchangeRates().then(r => setRates({ ...r }));
    }, []);

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

    if (gridHouse) {
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
            />
        );
    }

    return (
        <div className="space-y-8 max-w-2xl">
            <div>
                <h1 className="text-2xl font-bold text-unbox-dark flex items-center gap-3">
                    <Settings size={24} /> Настройки CRM
                </h1>
                <p className="text-unbox-grey mt-1">Управление счетами, интеграциями и параметрами</p>
            </div>

            {/* Payment Accounts */}
            <div className="rounded-2xl p-6" style={glassCard}>
                <PaymentAccountsManager />
            </div>

            {/* Currencies & Exchange Rates */}
            <div className="rounded-2xl p-6" style={glassCard}>
                <h3 className="font-bold text-unbox-dark flex items-center gap-2 mb-1">
                    <Coins size={18} /> Валюты и курсы
                </h3>
                <p className="text-xs text-unbox-grey mb-4">
                    Курсы к GEL для расчёта эквивалента. Можно редактировать.
                </p>
                <div className="space-y-2">
                    {CURRENCIES.map(c => (
                        <div key={c.code} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/50 border border-unbox-light/30">
                            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-unbox-light/50 text-unbox-dark font-bold text-sm">
                                {c.symbol}
                            </span>
                            <span className="font-medium text-sm text-unbox-dark flex-1">{c.code}</span>
                            {c.code !== 'GEL' ? (
                                <div className="flex items-center gap-1.5">
                                    <span className="text-xs text-unbox-grey">1 {c.code} =</span>
                                    <input
                                        type="number"
                                        step="0.001"
                                        value={rates[c.code] ?? ''}
                                        onChange={e => setRates(r => ({ ...r, [c.code]: parseFloat(e.target.value) || 0 }))}
                                        className="w-20 px-2 py-1 rounded-lg border border-unbox-light text-sm text-right focus:outline-none focus:ring-1 focus:ring-unbox-green/30"
                                    />
                                    <span className="text-xs text-unbox-grey">GEL</span>
                                </div>
                            ) : (
                                <span className="text-xs text-unbox-green font-medium">Базовая валюта</span>
                            )}
                        </div>
                    ))}
                </div>
                {hasRateChanges && (
                    <button
                        onClick={handleSaveRates}
                        disabled={ratesSaving}
                        className="mt-3 px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors flex items-center gap-1.5"
                    >
                        <Save size={14} />
                        {ratesSaving ? 'Сохранение...' : 'Сохранить курсы'}
                    </button>
                )}
            </div>

            {/* Google Calendar Sync */}
            <div className="rounded-2xl p-6" style={glassCard}>
                <h3 className="font-bold text-unbox-dark flex items-center gap-2 mb-3">
                    <Calendar size={18} /> Синхронизация с Google Calendar
                </h3>
                <p className="text-xs text-unbox-grey mb-3">
                    Укажите ID календаря для автоматической синхронизации сессий.
                </p>
                <div className="flex gap-2 mb-5">
                    <input
                        type="text"
                        value={calendarId}
                        onChange={(e) => setCalendarId(e.target.value)}
                        placeholder="example@group.calendar.google.com"
                        className="flex-1 px-3 py-2 rounded-xl border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/20 focus:border-unbox-green"
                    />
                    <button
                        onClick={handleSaveCalendar}
                        className="px-4 py-2 rounded-xl bg-unbox-green text-white text-sm font-medium hover:bg-unbox-green/90 transition-colors flex items-center gap-1.5"
                    >
                        <Link2 size={14} />
                        {calendarSaved ? 'Сохранено!' : 'Сохранить'}
                    </button>
                </div>

                {/* Source of Truth toggle */}
                <div className="border-t border-unbox-light/40 pt-4">
                    <div className="flex items-start gap-3">
                        <button
                            onClick={handleToggleSourceOfTruth}
                            disabled={sotSaving}
                            className={`relative mt-0.5 flex-shrink-0 w-11 h-6 rounded-full transition-colors duration-200 ${
                                sourceOfTruth ? 'bg-unbox-green' : 'bg-unbox-light'
                            }`}
                        >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                                sourceOfTruth ? 'translate-x-5' : 'translate-x-0'
                            }`} />
                        </button>
                        <div className="flex-1">
                            <div className="flex items-center gap-1.5">
                                <ShieldCheck size={14} className={sourceOfTruth ? 'text-unbox-green' : 'text-unbox-grey'} />
                                <span className="text-sm font-semibold text-unbox-dark">
                                    Google Calendar — источник правды
                                </span>
                            </div>
                            <p className="text-xs text-unbox-grey mt-1 leading-relaxed">
                                Если включено, синхронизация будет обновлять время перенесённых сессий
                                и автоматически отменять удалённые из календаря.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
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

                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 28 }}>
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
