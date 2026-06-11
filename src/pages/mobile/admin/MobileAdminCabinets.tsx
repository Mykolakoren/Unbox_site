import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, MapPin, Wrench, Bell, X, Check, Loader2, Power } from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';
import { useBookingStore } from '../../../store/bookingStore';
import { useUserStore } from '../../../store/userStore';
import { resourcesApi } from '../../../api/resources';
import { waitlistApi } from '../../../api/waitlist';
import { api } from '../../../api/client';
import type { Resource } from '../../../types';
import type { WaitlistEntry } from '../../../store/types';
import { LOCATIONS, RESOURCES } from '../../../utils/data';

type Tab = 'cabinets' | 'maintenance' | 'waitlist';

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

/**
 * Mobile admin "Кабинеты" — three operational tabs in one page so the
 * bottom nav doesn't drown in icons.
 *
 *   Кабинеты      — view active/inactive, toggle off for the day quickly.
 *   Обслуживание  — list service blocks (cleaning, repair) and create new.
 *   Лист ожидания — see who's waiting for slots across all users,
 *                   remove entries when needed.
 */
export function MobileAdminCabinets() {
    const [tab, setTab] = useState<Tab>('cabinets');

    return (
        <div style={{ padding: '14px 14px 90px' }}>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 4,
                padding: 3,
                background: 'rgba(0,0,0,0.04)',
                borderRadius: 10,
                marginBottom: 16,
            }}>
                {([
                    { id: 'cabinets', label: 'Кабинеты' },
                    { id: 'maintenance', label: 'Обслуж.' },
                    { id: 'waitlist', label: 'Ожидание' },
                ] as { id: Tab; label: string }[]).map(t => (
                    <button
                        key={t.id}
                        onClick={() => setTab(t.id)}
                        style={{
                            padding: '8px 0',
                            background: tab === t.id ? '#fff' : 'transparent',
                            border: 'none',
                            borderRadius: 8,
                            fontWeight: tab === t.id ? 700 : 500,
                            color: '#0E0E0E',
                            fontSize: 12,
                            cursor: 'pointer',
                            boxShadow: tab === t.id ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                        }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'cabinets' && <CabinetsTab />}
            {tab === 'maintenance' && <MaintenanceTab />}
            {tab === 'waitlist' && <WaitlistTab />}
        </div>
    );
}

// ── Cabinets tab ─────────────────────────────────────────────────────────

function CabinetsTab() {
    const { resources, fetchResources, locations, fetchLocations } = useBookingStore();
    const [filterLoc, setFilterLoc] = useState<string>('all');
    const [updating, setUpdating] = useState<string | null>(null);

    useEffect(() => {
        if (resources.length === 0) fetchResources();
        if (locations.length === 0) fetchLocations();
    }, [resources.length, locations.length, fetchResources, fetchLocations]);

    const handleToggleLocation = async (loc: typeof LOCATIONS[number]) => {
        const next = !(loc.isActive !== false);
        const childrenAffected = resources.filter(r => r.locationId === loc.id);
        if (!confirm(
            `${next ? 'Включить' : 'Выключить'} локацию "${loc.name}"?\n\n`
            + (next
                ? 'Кабинеты внутри останутся в своём состоянии — включи нужные вручную.'
                : `Все ${childrenAffected.length} кабинета станут скрытыми.`),
        )) return;
        setUpdating(loc.id);
        try {
            const { locationsApi } = await import('../../../api/locations');
            await locationsApi.update(loc.id, { isActive: next });
            if (!next) {
                for (const child of childrenAffected) {
                    if (child.isActive !== false) {
                        await resourcesApi.update(child.id, { isActive: false });
                    }
                }
            }
            await fetchLocations();
            await fetchResources();
            toast.success(next ? 'Локация включена' : 'Локация и кабинеты скрыты');
        } catch {
            toast.error('Не удалось');
        } finally {
            setUpdating(null);
        }
    };

    const filtered = useMemo(() => {
        const list = filterLoc === 'all'
            ? resources
            : resources.filter(r => r.locationId === filterLoc);
        // Active first, then by sortOrder/name.
        return [...list].sort((a, b) => {
            const aActive = a.isActive !== false ? 0 : 1;
            const bActive = b.isActive !== false ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            return (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
        });
    }, [resources, filterLoc]);

    const toggleActive = async (r: Resource) => {
        const next = !(r.isActive !== false);
        setUpdating(r.id);
        try {
            await resourcesApi.update(r.id, { isActive: next });
            await fetchResources();
            toast.success(next ? 'Кабинет включён' : 'Кабинет выключен');
        } catch {
            toast.error('Не удалось обновить');
        } finally {
            setUpdating(null);
        }
    };

    const liveLocations = locations.length > 0 ? locations : LOCATIONS;

    return (
        <div>
            {/* Locations strip — on/off toggle per location, cascades to its
                cabinets when turning off. */}
            <div style={{
                marginBottom: 14,
                paddingBottom: 12,
                borderBottom: '1px solid rgba(0,0,0,0.06)',
            }}>
                <div style={{
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                    textTransform: 'uppercase', color: '#888', marginBottom: 8,
                }}>
                    Локации
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {liveLocations.map(loc => {
                        const isActive = loc.isActive !== false;
                        const childActive = resources.filter(r => r.locationId === loc.id && r.isActive !== false).length;
                        const childTotal = resources.filter(r => r.locationId === loc.id).length;
                        return (
                            <div key={loc.id} style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                                borderRadius: 10,
                                padding: '8px 11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                opacity: isActive ? 1 : 0.55,
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E' }}>
                                        {loc.name}
                                        {!isActive && (
                                            <span style={{
                                                marginLeft: 6,
                                                fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                                                color: '#fff', background: '#B3261E',
                                                padding: '2px 5px', borderRadius: 4,
                                                textTransform: 'uppercase',
                                            }}>Скрыта</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 10, color: '#888', marginTop: 1 }}>
                                        {childActive} / {childTotal} активных кабинетов
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleToggleLocation(loc as any)}
                                    disabled={updating === loc.id}
                                    style={{
                                        background: isActive ? 'rgba(0,0,0,0.05)' : '#B3261E',
                                        color: isActive ? '#0E0E0E' : '#fff',
                                        border: 'none', borderRadius: 7,
                                        padding: '6px 10px',
                                        fontSize: 11, fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    {updating === loc.id ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
                                    {isActive ? 'Вкл' : 'Выкл'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
                <Chip active={filterLoc === 'all'} onClick={() => setFilterLoc('all')}>Все</Chip>
                {liveLocations.map(l => (
                    <Chip key={l.id} active={filterLoc === l.id} onClick={() => setFilterLoc(l.id)}>{l.name}</Chip>
                ))}
            </div>

            {filtered.length === 0 ? (
                <Empty>Нет кабинетов</Empty>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.map(r => {
                        const isActive = r.isActive !== false;
                        return (
                            <div key={r.id} style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                                borderRadius: 12,
                                padding: '11px 12px',
                                display: 'flex',
                                gap: 10,
                                alignItems: 'center',
                                opacity: isActive ? 1 : 0.55,
                            }}>
                                <div style={{
                                    width: 36, height: 36, borderRadius: 9,
                                    background: isActive ? 'rgba(0,0,0,0.06)' : 'rgba(179,38,30,0.08)',
                                    color: isActive ? '#0E0E0E' : '#B3261E',
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    <MapPin size={16} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {r.name}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                                        {LOCATIONS.find(l => l.id === r.locationId)?.name || r.locationId} · {r.hourlyRate}₾/ч
                                        {r.capacity ? ` · до ${r.capacity}` : ''}
                                    </div>
                                </div>
                                <button
                                    onClick={() => toggleActive(r)}
                                    disabled={updating === r.id}
                                    style={{
                                        background: isActive ? 'rgba(0,0,0,0.05)' : '#B3261E',
                                        color: isActive ? '#0E0E0E' : '#fff',
                                        border: 'none',
                                        borderRadius: 8,
                                        padding: '7px 11px',
                                        fontSize: 11,
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        flexShrink: 0,
                                    }}
                                >
                                    {updating === r.id ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />}
                                    {isActive ? 'Вкл' : 'Выкл'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Maintenance tab ──────────────────────────────────────────────────────

function MaintenanceTab() {
    const [blocks, setBlocks] = useState<MaintenanceBlock[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    const load = async () => {
        setLoading(true);
        try {
            const today = new Date().toISOString().slice(0, 10);
            const { data } = await api.get<MaintenanceBlock[]>('/maintenance-blocks', {
                params: { date_from: today },
            });
            setBlocks(data);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Снять блокировку?')) return;
        try {
            await api.delete(`/maintenance-blocks/${id}`);
            setBlocks(prev => prev.filter(b => b.id !== id));
            toast.success('Снято');
        } catch {
            toast.error('Не удалось снять');
        }
    };

    const groups = useMemo(() => {
        const out: Record<string, MaintenanceBlock[]> = {};
        for (const b of blocks) {
            const k = b.date.slice(0, 10);
            (out[k] ||= []).push(b);
        }
        return out;
    }, [blocks]);

    return (
        <div>
            <button
                onClick={() => setShowCreate(true)}
                style={{
                    width: '100%',
                    padding: '11px',
                    marginBottom: 14,
                    background: '#0E0E0E',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    fontWeight: 700,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                }}
            >
                <Plus size={16} /> Закрыть кабинет
            </button>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : blocks.length === 0 ? (
                <Empty>Открытых блокировок нет</Empty>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {Object.keys(groups).sort().map(date => (
                        <div key={date}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 }}>
                                {format(new Date(date + 'T00:00:00'), 'd MMM, EEEE', { locale: ru })}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {groups[date].map(b => {
                                    const res = RESOURCES.find(r => r.id === b.resourceId);
                                    return (
                                        <div key={b.id} style={{
                                            background: '#fff',
                                            border: '1px solid rgba(0,0,0,0.06)',
                                            borderRadius: 10,
                                            padding: '10px 12px',
                                            display: 'flex',
                                            gap: 10,
                                            alignItems: 'center',
                                        }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: 8,
                                                background: 'rgba(255,138,76,0.12)', color: '#C66019',
                                                display: 'grid', placeItems: 'center', flexShrink: 0,
                                            }}>
                                                <Wrench size={14} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {res?.name || b.resourceId} · {b.startTime}–{addMinTime(b.startTime, b.duration)}
                                                </div>
                                                <div style={{ fontSize: 11, color: '#888' }}>
                                                    {b.reason || 'Без описания'}
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDelete(b.id)}
                                                style={{
                                                    background: 'none',
                                                    border: 'none',
                                                    color: '#B3261E',
                                                    cursor: 'pointer',
                                                    padding: 6,
                                                }}
                                                aria-label="Снять блокировку"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showCreate && (
                <CreateMaintenanceSheet
                    onClose={() => setShowCreate(false)}
                    onCreated={async () => {
                        setShowCreate(false);
                        await load();
                    }}
                />
            )}
        </div>
    );
}

function addMinTime(time: string, mins: number): string {
    const [h, m] = time.split(':').map(Number);
    const total = h * 60 + m + mins;
    const hh = Math.floor(total / 60) % 24;
    const mm = total % 60;
    return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

function CreateMaintenanceSheet({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
    const [resourceId, setResourceId] = useState(RESOURCES[0]?.id || '');
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [dateTo, setDateTo] = useState('');
    const [startTime, setStartTime] = useState('10:00');
    const [duration, setDuration] = useState(60);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const resource = RESOURCES.find(r => r.id === resourceId);

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.post('/maintenance-blocks/', {
                resource_id: resourceId,
                location_id: resource?.locationId || 'unbox_one',
                date_from: date,
                date_to: dateTo || undefined,
                start_time: startTime,
                duration,
                reason,
            });
            toast.success('Кабинет закрыт');
            await onCreated();
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Ошибка');
        } finally {
            setSaving(false);
        }
    };

    return (
        <BottomSheet onClose={onClose} title="Закрыть кабинет">
            <Field label="Кабинет">
                <select value={resourceId} onChange={e => setResourceId(e.target.value)} style={input}>
                    {RESOURCES.filter(r => r.isActive !== false).map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                </select>
            </Field>
            <Field label="Дата">
                <input type="date" value={date} onChange={e => setDate(e.target.value)} style={input} />
            </Field>
            <Field label="Дата окончания (необязательно, для серии)">
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={input} />
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <Field label="Начало">
                    <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={input} />
                </Field>
                <Field label="Длительность (мин)">
                    <input type="number" min={15} step={15} value={duration} onChange={e => setDuration(Number(e.target.value))} style={input} />
                </Field>
            </div>
            <Field label="Причина (видно в шахматке)">
                <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Уборка, ремонт, мероприятие..." style={input} />
            </Field>

            <button
                onClick={handleSave}
                disabled={saving}
                style={primaryBtn}
            >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                Закрыть кабинет
            </button>
        </BottomSheet>
    );
}

// ── Waitlist tab ─────────────────────────────────────────────────────────

function WaitlistTab() {
    const { users } = useUserStore();
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const load = async () => {
        setLoading(true);
        try {
            const data = await waitlistApi.getAllWaitlistAdmin();
            setEntries(data);
        } catch (e: any) {
            toast.error(e?.response?.data?.detail || 'Не удалось загрузить');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        if (!confirm('Удалить из листа ожидания?')) return;
        try {
            await waitlistApi.removeFromWaitlist(id);
            setEntries(prev => prev.filter(e => e.id !== id));
            toast.success('Удалено');
        } catch {
            toast.error('Ошибка удаления');
        }
    };

    const userName = (uid: string) => users.find(u => u.email === uid)?.name || uid;

    return (
        <div>
            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}>
                    <Loader2 size={18} className="animate-spin" style={{ color: '#888' }} />
                </div>
            ) : entries.length === 0 ? (
                <Empty>Лист ожидания пуст</Empty>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entries.map(e => {
                        const res = RESOURCES.find(r => r.id === (e as any).resourceId);
                        const dateStr = String((e as any).date || '').slice(0, 10);
                        return (
                            <div key={e.id} style={{
                                background: '#fff',
                                border: '1px solid rgba(0,0,0,0.06)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                display: 'flex', gap: 10, alignItems: 'center',
                            }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 8,
                                    background: 'rgba(76,138,255,0.12)', color: '#3F6BD8',
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    <Bell size={14} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0E0E0E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {userName((e as any).userId)}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888' }}>
                                        {res?.name || (e as any).resourceId}
                                        {' · '}
                                        {dateStr ? format(new Date(dateStr + 'T00:00:00'), 'd MMM', { locale: ru }) : '?'}
                                        {' · '}
                                        {(e as any).startTime}–{(e as any).endTime}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDelete(e.id)}
                                    style={{ background: 'none', border: 'none', color: '#B3261E', cursor: 'pointer', padding: 6 }}
                                    aria-label="Удалить"
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Shared bits ──────────────────────────────────────────────────────────

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
    return (
        <button onClick={onClick} style={{
            flexShrink: 0,
            padding: '7px 12px',
            borderRadius: 999,
            border: active ? '1px solid #0E0E0E' : '1px solid rgba(0,0,0,0.12)',
            background: active ? '#0E0E0E' : '#fff',
            color: active ? '#fff' : '#0E0E0E',
            fontSize: 12, fontWeight: 600,
            cursor: 'pointer', whiteSpace: 'nowrap',
        }}>{children}</button>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return (
        <div style={{ textAlign: 'center', padding: 32, color: '#888', fontSize: 13 }}>
            {children}
        </div>
    );
}

function BottomSheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
    return (
        <div onClick={onClose} style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 100,
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        }}>
            <div onClick={e => e.stopPropagation()} style={{
                width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto',
                background: '#fff',
                borderTopLeftRadius: 18, borderTopRightRadius: 18,
                padding: '14px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
                boxShadow: '0 -8px 24px rgba(0,0,0,0.18)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888' }}>
                        <X size={20} />
                    </button>
                </div>
                {children}
            </div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#666', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 5 }}>
                {label}
            </div>
            {children}
        </div>
    );
}

const input: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    border: '1px solid rgba(0,0,0,0.12)',
    borderRadius: 8,
    fontSize: 14,
    background: '#fff',
    color: '#0E0E0E',
    outline: 'none',
};

const primaryBtn: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    background: '#0E0E0E',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
};
