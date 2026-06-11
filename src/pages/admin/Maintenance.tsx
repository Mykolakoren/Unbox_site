import { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '../../api/client';
import { RESOURCES, LOCATIONS } from '../../utils/data';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

interface MaintenanceBlock {
    id: string;
    resourceId: string;
    locationId: string;
    date: string;
    startTime: string;
    duration: number;
    reason: string;
    createdAt: string;
}

const WEEKDAYS = [
    { idx: 0, label: 'Пн' }, { idx: 1, label: 'Вт' }, { idx: 2, label: 'Ср' },
    { idx: 3, label: 'Чт' }, { idx: 4, label: 'Пт' }, { idx: 5, label: 'Сб' }, { idx: 6, label: 'Вс' },
];

export function AdminMaintenance() {
    const [blocks, setBlocks] = useState<MaintenanceBlock[]>([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const { data } = await api.get<MaintenanceBlock[]>('/maintenance-blocks', {
                params: { date_from: today },
            });
            setBlocks(data);
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || 'Не удалось загрузить блокировки');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Снять блокировку?')) return;
        try {
            await api.delete(`/maintenance-blocks/${id}`);
            toast.success('Блокировка снята');
            setBlocks(prev => prev.filter(b => b.id !== id));
        } catch {
            toast.error('Не удалось снять');
        }
    };

    const grouped = groupByResource(blocks);
    const sortedResources = Object.keys(grouped).sort();

    return (
        <div style={{ padding: '32px 24px', maxWidth: 1200, margin: '0 auto', fontFamily: GH_SANS }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>
                    Обслуживание кабинетов
                </h1>
                <button
                    onClick={() => setCreating(true)}
                    style={primaryBtn}
                >
                    <Plus size={16} /> Закрыть кабинет
                </button>
            </div>
            <div style={{ ...subtitleStyle, marginBottom: 24 }}>
                Бронирования для уборки, ремонта или внутренних мероприятий —
                слот занят, но не считается в финансах.
            </div>

            {loading ? (
                <div style={{ color: GH.ink60, padding: 32 }}>Загрузка…</div>
            ) : sortedResources.length === 0 ? (
                <div style={emptyState}>
                    <AlertCircle size={20} color={GH.ink60} />
                    <div>
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>Активных блокировок нет</div>
                        <div style={{ fontSize: 13, color: GH.ink60 }}>
                            Нажмите «Закрыть кабинет», чтобы зарезервировать слот на обслуживание.
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {sortedResources.map(resId => {
                        const resource = RESOURCES.find(r => r.id === resId);
                        const location = LOCATIONS.find(l => l.id === resource?.locationId);
                        return (
                            <div key={resId} style={cardStyle}>
                                <div style={{ padding: '14px 18px', borderBottom: `1px solid ${GH.ink8}` }}>
                                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                                        {resource?.name || resId}
                                    </div>
                                    <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2 }}>
                                        {location?.name || resource?.locationId} · {grouped[resId].length} блокировок
                                    </div>
                                </div>
                                <div>
                                    {grouped[resId].slice(0, 20).map(b => (
                                        <div
                                            key={b.id}
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns: '120px 90px 1fr 32px',
                                                gap: 12,
                                                padding: '10px 18px',
                                                borderBottom: `1px solid ${GH.ink8}`,
                                                alignItems: 'center',
                                                fontSize: 13,
                                            }}
                                        >
                                            <span style={{ fontFamily: GH_MONO, fontSize: 12 }}>
                                                {fmtDate(b.date)}
                                            </span>
                                            <span style={{ fontFamily: GH_MONO, fontSize: 12 }}>
                                                {b.startTime}, {b.duration}м
                                            </span>
                                            <span style={{ color: GH.ink60 }}>{b.reason || '—'}</span>
                                            <button
                                                onClick={() => handleDelete(b.id)}
                                                title="Снять"
                                                style={iconBtn}
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    ))}
                                    {grouped[resId].length > 20 && (
                                        <div style={{ padding: '10px 18px', fontSize: 12, color: GH.ink60 }}>
                                            и ещё {grouped[resId].length - 20}…
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {creating && (
                <CreateModal
                    onClose={() => setCreating(false)}
                    onCreated={() => { setCreating(false); load(); }}
                />
            )}
        </div>
    );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
    const [resourceId, setResourceId] = useState(RESOURCES[0]?.id || '');
    const [dateFrom, setDateFrom] = useState(new Date().toISOString().slice(0, 10));
    const [dateTo, setDateTo] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [duration, setDuration] = useState(60);
    const [reason, setReason] = useState('');
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [submitting, setSubmitting] = useState(false);

    const resource = RESOURCES.find(r => r.id === resourceId);

    const toggleWeekday = (idx: number) => {
        setWeekdays(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx]);
    };

    const submit = async () => {
        setSubmitting(true);
        try {
            const { data } = await api.post<unknown[]>('/maintenance-blocks', {
                resource_id: resourceId,
                location_id: resource?.locationId || 'unbox_one',
                date_from: dateFrom,
                date_to: dateTo || null,
                start_time: startTime,
                duration,
                reason,
                recurring_weekdays: weekdays.length > 0 ? weekdays : null,
            });
            toast.success(`Создано ${data.length} блокировок`);
            onCreated();
        } catch (e: unknown) {
            const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
            toast.error(msg || 'Не удалось создать');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={overlayStyle} onClick={onClose}>
            <div style={modalStyle} onClick={e => e.stopPropagation()}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>
                    Закрыть кабинет
                </h2>
                <p style={{ ...subtitleStyle, marginTop: 4, marginBottom: 20 }}>
                    Слот будет занят и не появится в свободных для бронирования.
                </p>

                <Field label="Кабинет">
                    <select value={resourceId} onChange={e => setResourceId(e.target.value)} style={inputStyle}>
                        {RESOURCES.filter(r => r.isActive !== false).map(r => {
                            const loc = LOCATIONS.find(l => l.id === r.locationId);
                            return <option key={r.id} value={r.id}>{r.name} · {loc?.name || r.locationId}</option>;
                        })}
                    </select>
                </Field>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="С даты">
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
                    </Field>
                    <Field label="По дату (опционально)">
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
                    </Field>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <Field label="Начало">
                        <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inputStyle} />
                    </Field>
                    <Field label="Длительность (мин)">
                        <input
                            type="number"
                            min={15} max={600} step={15}
                            value={duration}
                            onChange={e => setDuration(parseInt(e.target.value) || 60)}
                            style={inputStyle}
                        />
                    </Field>
                </div>

                {dateTo && (
                    <Field label="Только в дни недели (опционально)">
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {WEEKDAYS.map(w => (
                                <button
                                    key={w.idx}
                                    type="button"
                                    onClick={() => toggleWeekday(w.idx)}
                                    style={{
                                        ...weekdayBtn,
                                        background: weekdays.includes(w.idx) ? GH.ink : '#fff',
                                        color: weekdays.includes(w.idx) ? '#fff' : GH.ink,
                                    }}
                                >
                                    {w.label}
                                </button>
                            ))}
                        </div>
                        <div style={{ fontSize: 11, color: GH.ink60, marginTop: 6 }}>
                            Пусто = каждый день в диапазоне.
                        </div>
                    </Field>
                )}

                <Field label="Причина (видна на брони)">
                    <input
                        type="text"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder="Уборка, замена ламп, ремонт мебели…"
                        style={inputStyle}
                    />
                </Field>

                <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                    <button onClick={onClose} style={secondaryBtn} disabled={submitting}>Отмена</button>
                    <button onClick={submit} style={primaryBtn} disabled={submitting}>
                        {submitting ? 'Создание…' : 'Закрыть слот'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: GH.ink60, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                {label}
            </div>
            {children}
        </div>
    );
}

function groupByResource(blocks: MaintenanceBlock[]): Record<string, MaintenanceBlock[]> {
    const out: Record<string, MaintenanceBlock[]> = {};
    for (const b of blocks) {
        (out[b.resourceId] ??= []).push(b);
    }
    for (const k of Object.keys(out)) {
        out[k].sort((a, b) => a.date.localeCompare(b.date));
    }
    return out;
}

function fmtDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', weekday: 'short' });
    } catch {
        return iso;
    }
}

const subtitleStyle: React.CSSProperties = { color: GH.ink60, fontSize: 14 };

const primaryBtn: React.CSSProperties = {
    background: GH.ink, color: '#fff',
    border: 'none', borderRadius: 8, padding: '10px 14px',
    fontWeight: 700, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 6,
};

const secondaryBtn: React.CSSProperties = {
    background: '#fff', color: GH.ink,
    border: `1px solid ${GH.ink10}`, borderRadius: 8, padding: '10px 14px',
    fontWeight: 600, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
};

const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: 4, color: GH.ink60, display: 'grid', placeItems: 'center',
    borderRadius: 6,
};

const cardStyle: React.CSSProperties = {
    background: '#fff', border: `1px solid ${GH.ink10}`, borderRadius: 12,
    overflow: 'hidden',
};

const emptyState: React.CSSProperties = {
    background: '#fff', border: `1px solid ${GH.ink10}`, borderRadius: 12,
    padding: 24, display: 'flex', alignItems: 'center', gap: 12,
};

const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
    display: 'grid', placeItems: 'center', zIndex: 1000, padding: 16,
};

const modalStyle: React.CSSProperties = {
    background: '#fff', borderRadius: 14, padding: 24,
    width: '100%', maxWidth: 520, maxHeight: '90vh', overflow: 'auto',
    fontFamily: GH_SANS,
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px',
    border: `1px solid ${GH.ink10}`, borderRadius: 8,
    fontSize: 14, fontFamily: 'inherit',
};

const weekdayBtn: React.CSSProperties = {
    border: `1px solid ${GH.ink10}`, borderRadius: 6,
    padding: '6px 10px', fontSize: 12, fontWeight: 700,
    fontFamily: 'inherit', cursor: 'pointer',
};
