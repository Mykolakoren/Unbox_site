import { useEffect, useMemo, useState } from 'react';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { analyticsApi, type OwnerAnalytics, type MonthlyMetric } from '../../api/analytics';
import { toast } from 'sonner';

const fmt = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

function firstOfMonth(d = new Date()) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function iso(d: Date) { return d.toISOString().slice(0, 10); }

export function OwnerAnalytics() {
    const today = new Date();
    const [from, setFrom] = useState(iso(firstOfMonth()));
    const [to, setTo] = useState(iso(today));
    const [data, setData] = useState<OwnerAnalytics | null>(null);
    const [history, setHistory] = useState<MonthlyMetric[]>([]);
    const [loading, setLoading] = useState(true);
    const [snapBusy, setSnapBusy] = useState(false);

    const load = () => {
        setLoading(true);
        analyticsApi.getOwner(from, to).then(setData).catch(() => toast.error('Не удалось загрузить аналитику')).finally(() => setLoading(false));
    };
    useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);
    useEffect(() => { analyticsApi.getHistory().then(setHistory).catch(() => {}); }, []);

    const preset = (kind: 'this' | 'prev') => {
        const now = new Date();
        if (kind === 'this') { setFrom(iso(firstOfMonth(now))); setTo(iso(now)); }
        else {
            const p = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const end = new Date(now.getFullYear(), now.getMonth(), 0);
            setFrom(iso(p)); setTo(iso(end));
        }
    };

    const doSnapshot = async () => {
        setSnapBusy(true);
        try {
            const r = await analyticsApi.snapshot();
            toast.success(`Снимок за ${r.month} сохранён (${fmt(r.revenue)} ₾)`);
            setHistory(await analyticsApi.getHistory());
        } catch { toast.error('Не удалось сохранить снимок'); }
        finally { setSnapBusy(false); }
    };

    const maxHistRev = useMemo(() => Math.max(1, ...history.map(h => h.revenue)), [history]);

    return (
        <div style={{ padding: '20px clamp(12px,3vw,28px) 80px', maxWidth: 1200, margin: '0 auto', fontFamily: GH_SANS, color: GH.ink }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                    <div style={{ fontFamily: GH_MONO, fontSize: 11, letterSpacing: '0.14em', color: GH.ink60 }}>АНАЛИТИКА · ВЛАДЕЛЕЦ</div>
                    <h1 style={{ fontSize: 'clamp(24px,3vw,34px)', fontWeight: 800, margin: '4px 0 0' }}>Обзор бизнеса</h1>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <button onClick={() => preset('this')} style={chip}>Этот месяц</button>
                    <button onClick={() => preset('prev')} style={chip}>Прошлый месяц</button>
                    <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={dateInput} />
                    <span style={{ color: GH.ink30 }}>—</span>
                    <input type="date" value={to} onChange={e => setTo(e.target.value)} style={dateInput} />
                </div>
            </div>

            {loading && !data ? (
                <div style={{ padding: 60, textAlign: 'center', color: GH.ink30 }}>Загрузка…</div>
            ) : data ? (
                <>
                    {/* Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 28 }}>
                        <Tile label="Выручка" value={`${fmt(data.summary.revenue)} ₾`} accent />
                        <Tile label="Броней" value={fmt(data.summary.bookings)} />
                        <Tile label="Часов аренды" value={fmt(data.summary.hours)} />
                        <Tile label="Загрузка" value={`${data.summary.occupancyPct}%`} />
                        <Tile label="Средний чек" value={`${fmt(data.summary.avgCheck)} ₾`} />
                    </div>

                    {/* По центрам */}
                    <Section title="По центрам / филиалам">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
                            {data.byCenter.map(c => (
                                <div key={c.locationId} style={card}>
                                    <div style={{ fontWeight: 800, fontSize: 17 }}>{c.name}</div>
                                    <div style={{ fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, marginBottom: 10 }}>{c.rooms} каб.</div>
                                    <Row k="Выручка" v={`${fmt(c.revenue)} ₾`} />
                                    <Row k="Броней" v={fmt(c.bookings)} />
                                    <Row k="Часов" v={fmt(c.hours)} />
                                    <Row k="Средний чек" v={`${fmt(c.avgCheck)} ₾`} />
                                    <div style={{ marginTop: 10 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: GH.ink60, marginBottom: 4 }}>
                                            <span>Загрузка</span><span style={{ fontWeight: 700, color: GH.ink }}>{c.occupancyPct}%</span>
                                        </div>
                                        <Bar pct={c.occupancyPct} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* По кабинетам — загрузка */}
                    <Section title="Загрузка по кабинетам">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {data.byRoom.map(r => (
                                <div key={r.resourceId} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px', gap: 12, alignItems: 'center' }}>
                                    <div style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                                    <Bar pct={r.occupancyPct} />
                                    <div style={{ fontFamily: GH_MONO, fontSize: 12, textAlign: 'right' }}>{r.occupancyPct}% · {fmt(r.hours)}ч</div>
                                </div>
                            ))}
                        </div>
                    </Section>

                    {/* По админам */}
                    <Section title="По админам">
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                                <thead>
                                    <tr style={{ borderBottom: `2px solid ${GH.ink}`, textAlign: 'left' }}>
                                        {['Админ', 'Касса: доход', 'Касса: расход', 'Операций', 'Оформил броней'].map((h, i) => (
                                            <th key={i} style={{ padding: '8px 10px', fontFamily: GH_MONO, fontSize: 11, color: GH.ink60, textAlign: i === 0 ? 'left' : 'right' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.byAdmin.map(a => (
                                        <tr key={a.adminId} style={{ borderBottom: `1px solid ${GH.ink10}` }}>
                                            <td style={{ padding: '8px 10px', fontWeight: 600 }}>{a.name}</td>
                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#166534' }}>{fmt(a.cashIncome)} ₾</td>
                                            <td style={{ padding: '8px 10px', textAlign: 'right', color: '#b91c1c' }}>{fmt(a.cashExpense)} ₾</td>
                                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{a.cashOps}</td>
                                            <td style={{ padding: '8px 10px', textAlign: 'right' }}>{a.bookingsCreated || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {data.adminBookingsTracked === 0 && (
                            <div style={{ fontSize: 12, color: GH.ink30, marginTop: 8 }}>
                                «Оформил броней» начнёт заполняться с этого момента (трекинг создателя брони добавлен только что) — у прошлых броней его нет.
                            </div>
                        )}
                    </Section>

                    {/* История по месяцам */}
                    <Section
                        title="История по месяцам"
                        right={<button onClick={doSnapshot} disabled={snapBusy} style={{ ...chip, background: GH.ink, color: GH.paper }}>{snapBusy ? 'Сохраняю…' : 'Сохранить снимок месяца'}</button>}
                    >
                        {history.length === 0 ? (
                            <div style={{ color: GH.ink30, fontSize: 13 }}>Пока нет сохранённых месяцев. Снимки создаются автоматически 1-го числа (или кнопкой выше).</div>
                        ) : (
                            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', overflowX: 'auto', paddingBottom: 8 }}>
                                {[...history].reverse().map(h => (
                                    <div key={h.month} style={{ textAlign: 'center', minWidth: 56 }}>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 10, color: GH.ink60, marginBottom: 4 }}>{fmt(h.revenue)}</div>
                                        <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                                            <div style={{ width: 30, height: `${Math.max(4, (h.revenue / maxHistRev) * 100)}%`, background: GH.accent }} />
                                        </div>
                                        <div style={{ fontFamily: GH_MONO, fontSize: 10, marginTop: 4 }}>{h.month.slice(5)}·{h.month.slice(2, 4)}</div>
                                        <div style={{ fontSize: 10, color: GH.ink30 }}>{h.occupancyPct}%</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Section>
                </>
            ) : null}
        </div>
    );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
    return (
        <div style={{ border: `1px solid ${GH.ink10}`, padding: '14px 16px', background: accent ? `${GH.accent}0D` : GH.paper }}>
            <div style={{ fontFamily: GH_MONO, fontSize: 10, letterSpacing: '0.1em', color: GH.ink60, textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: accent ? GH.accent : GH.ink }}>{value}</div>
        </div>
    );
}
function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
    return (
        <section style={{ marginBottom: 34 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${GH.ink}`, paddingBottom: 8, marginBottom: 14 }}>
                <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{title}</h2>
                {right}
            </div>
            {children}
        </section>
    );
}
function Row({ k, v }: { k: string; v: string }) {
    return <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '2px 0' }}><span style={{ color: GH.ink60 }}>{k}</span><span style={{ fontWeight: 600 }}>{v}</span></div>;
}
function Bar({ pct }: { pct: number }) {
    const p = Math.min(100, Math.max(0, pct));
    const color = p >= 60 ? '#166534' : p >= 30 ? GH.accent : '#b45309';
    return <div style={{ height: 8, background: GH.ink10, position: 'relative' }}><div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${p}%`, background: color }} /></div>;
}

const chip: React.CSSProperties = { padding: '7px 12px', border: `1px solid ${GH.ink10}`, background: GH.paper, fontFamily: GH_MONO, fontSize: 11, cursor: 'pointer', color: GH.ink };
const dateInput: React.CSSProperties = { padding: '6px 8px', border: `1px solid ${GH.ink10}`, fontFamily: 'inherit', fontSize: 13 };
