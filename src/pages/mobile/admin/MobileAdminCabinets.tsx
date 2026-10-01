import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trash2, MapPin, Wrench, Bell, Check, Power } from 'lucide-react';
import { toast } from 'sonner';
import { useBookingStore } from '../../../store/bookingStore';
import { useUserStore } from '../../../store/userStore';
import { resourcesApi } from '../../../api/resources';
import { waitlistApi } from '../../../api/waitlist';
import { maintenanceApi, isMaintenanceConflict, type MaintenanceBlock, type MaintenanceConflict } from '../../../api/maintenance';
import type { Resource } from '../../../types';
import type { WaitlistEntry } from '../../../store/types';
import { LOCATIONS, RESOURCES } from '../../../utils/data';
import { batumiDayKey } from '../../../utils/adminToday';
import { toastApiError } from '../../../utils/errors';
import { Sheet } from '../../../components/ui/Sheet';
import { MobilePageHeader } from '../../../components/ui/PageHeader';
import { MaintenanceConflictSheet } from '../../../components/admin/MaintenanceConflictSheet';
import { Button } from '../../../components/ui/Button';
import { Chip, Segmented } from '../../../components/ui/Chip';
import { Field, Input, Select } from '../../../components/ui/Field';
import { EmptyState } from '../../../components/ui/EmptyState';
import { ErrorBar } from '../../../components/ui/ErrorBar';
import { SkeletonList } from '../../../components/ui/Skeleton';
import { useConfirmDialog } from '../../../components/ui/ConfirmDialogProvider';
import { formatDateLabel, formatDayMonth, formatGel } from '../../../utils/format';

type Tab = 'cabinets' | 'maintenance' | 'waitlist';
const TABS: Tab[] = ['cabinets', 'maintenance', 'waitlist'];

/** 1 кабинет, 2 кабинета, 5 кабинетов. */
function plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}

/**
 * Mobile admin "Кабинеты" — three operational tabs in one page so the
 * bottom nav doesn't drown in icons.
 *
 *   Кабинеты      — view active/inactive, toggle off for the day quickly.
 *   Закрытия      — list service blocks (cleaning, repair) and create new.
 *   Лист ожидания — see who's waiting for slots across all users,
 *                   remove entries when needed.
 *
 * Wave 1: общие Chip/Segmented/Button/Field, токены вместо hex, окна
 * подтверждения вместо confirm(). Кнопки переключателей называют действие
 * («Выключить» / «Включить»), а не текущее состояние («Вкл»).
 *
 * Волна 4: заголовок и «←» (MobilePageHeader), вкладка из ?tab= (ссылки
 * /admin/maintenance с телефона ведут сюда). Выключение кабинета — с
 * вопросом, включение — сразу. «Закрыть кабинет» — через maintenanceApi:
 * поверх брони клиента сервер отвечает 409, и мы показываем список броней
 * (MaintenanceConflictSheet, решение В1) — сами ничего не отменяем.
 */
export function MobileAdminCabinets() {
    const [params, setParams] = useSearchParams();
    const fromUrl = params.get('tab') as Tab | null;
    const tab: Tab = fromUrl && TABS.includes(fromUrl) ? fromUrl : 'cabinets';
    const setTab = (t: Tab) => setParams(t === 'cabinets' ? {} : { tab: t }, { replace: true });

    return (
        <div style={{ padding: '0 16px 90px' }}>
            <MobilePageHeader title="Кабинеты" fallbackTo="/m/admin/dashboard" />
            <Segmented<Tab>
                aria-label="Раздел"
                className="mb-4"
                options={[
                    { value: 'cabinets', label: 'Кабинеты' },
                    { value: 'maintenance', label: 'Закрытия' },
                    { value: 'waitlist', label: 'Ожидание' },
                ]}
                value={tab}
                onChange={setTab}
            />

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
    // Пока кабинеты не пришли, не пишем «Нет кабинетов».
    const [resourcesTried, setResourcesTried] = useState(resources.length > 0);
    const { confirm } = useConfirmDialog();

    useEffect(() => {
        if (resources.length === 0) fetchResources().finally(() => setResourcesTried(true));
        if (locations.length === 0) fetchLocations();
    }, [resources.length, locations.length, fetchResources, fetchLocations]);

    const handleToggleLocation = async (loc: typeof LOCATIONS[number]) => {
        const next = !(loc.isActive !== false);
        const childrenAffected = resources.filter(r => r.locationId === loc.id);
        const n = childrenAffected.length;
        // Волна 4: спрашиваем только при выключении; включение — сразу
        // (кабинеты внутри останутся как есть — нужные включают вручную).
        if (!next) {
            const ok = await confirm({
                title: `Выключить локацию «${loc.name}»?`,
                body: `${n} ${plural(n, 'кабинет станет скрытым', 'кабинета станут скрытыми', 'кабинетов станут скрытыми')} — клиенты не смогут их бронировать.`,
                confirmLabel: 'Выключить локацию',
                cancelLabel: 'Оставить как есть',
                tone: 'danger',
            });
            if (!ok) return;
        }
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
            toast.success(next ? 'Локация включена — нужные кабинеты включите вручную' : 'Локация и кабинеты скрыты');
        } catch {
            toast.error('Не удалось переключить локацию. Попробуйте ещё раз');
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
        // Выключение — с вопросом (G9-09): промах выключал кабинет из брони.
        // Включение — сразу, вреда от него нет.
        if (!next) {
            const ok = await confirm({
                title: `Выключить «${r.name}»?`,
                body: 'Клиенты перестанут видеть кабинет при бронировании. Уже сделанные брони останутся.',
                confirmLabel: 'Выключить кабинет',
                cancelLabel: 'Оставить включённым',
                tone: 'danger',
            });
            if (!ok) return;
        }
        setUpdating(r.id);
        try {
            await resourcesApi.update(r.id, { isActive: next });
            await fetchResources();
            toast.success(next ? 'Кабинет включён' : 'Кабинет выключен');
        } catch {
            toast.error('Не удалось переключить кабинет. Попробуйте ещё раз');
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
                borderBottom: '1px solid var(--color-ink-08)',
            }}>
                <SectionLabel>Локации</SectionLabel>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {liveLocations.map(loc => {
                        const isActive = loc.isActive !== false;
                        const childActive = resources.filter(r => r.locationId === loc.id && r.isActive !== false).length;
                        const childTotal = resources.filter(r => r.locationId === loc.id).length;
                        return (
                            <div key={loc.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 10,
                                padding: '8px 8px 8px 12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)' }}>
                                        {loc.name}
                                        {!isActive && (
                                            <span className="ui-badge ui-badge--muted" style={{ marginLeft: 6 }}>Скрыта</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                                        Активных кабинетов: {childActive} из {childTotal}
                                    </div>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="touch"
                                    loading={updating === loc.id}
                                    icon={<Power size={16} aria-hidden="true" />}
                                    onClick={() => handleToggleLocation(loc as any)}
                                    aria-label={`${isActive ? 'Выключить' : 'Включить'} локацию ${loc.name}`}
                                >
                                    {isActive ? 'Выключить' : 'Включить'}
                                </Button>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div role="group" aria-label="Локация" style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 12, paddingBottom: 4 }}>
                <Chip selected={filterLoc === 'all'} onClick={() => setFilterLoc('all')} style={{ flexShrink: 0 }}>Все</Chip>
                {liveLocations.map(l => (
                    <Chip key={l.id} selected={filterLoc === l.id} onClick={() => setFilterLoc(l.id)} style={{ flexShrink: 0 }}>{l.name}</Chip>
                ))}
            </div>

            {!resourcesTried && resources.length === 0 ? (
                <SkeletonList count={4} label="Загружаем кабинеты" cardHeight={60} />
            ) : filtered.length === 0 ? (
                <EmptyState compact title="Нет кабинетов" hint="Выберите другую локацию или добавьте кабинет на компьютере." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {filtered.map(r => {
                        const isActive = r.isActive !== false;
                        return (
                            <div key={r.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 12,
                                padding: '8px 8px 8px 12px',
                                display: 'flex',
                                gap: 10,
                                alignItems: 'center',
                            }}>
                                <div style={{
                                    width: 36, height: 36, borderRadius: 9,
                                    background: 'var(--color-sunken)',
                                    color: isActive ? 'var(--color-ink)' : 'var(--color-ink-60)',
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}>
                                    <MapPin size={16} aria-hidden="true" />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {r.name}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)', marginTop: 1 }}>
                                        {!isActive && 'Выключен · '}
                                        {LOCATIONS.find(l => l.id === r.locationId)?.name || r.locationId} · {formatGel(r.hourlyRate)}/ч
                                        {r.capacity ? ` · до ${r.capacity}` : ''}
                                    </div>
                                </div>
                                <Button
                                    variant="secondary"
                                    size="touch"
                                    loading={updating === r.id}
                                    icon={<Power size={16} aria-hidden="true" />}
                                    onClick={() => toggleActive(r)}
                                    aria-label={`${isActive ? 'Выключить' : 'Включить'} ${r.name}`}
                                >
                                    {isActive ? 'Выключить' : 'Включить'}
                                </Button>
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
    // Сбой загрузки — не «блокировок нет».
    const [failed, setFailed] = useState(false);
    const [showCreate, setShowCreate] = useState(false);
    const { confirm } = useConfirmDialog();

    const load = async () => {
        setLoading(true);
        try {
            // «Сегодня» — по Батуми (toISOString с 00:00 до 04:00 давал «вчера»).
            setBlocks(await maintenanceApi.list({ dateFrom: batumiDayKey() }));
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        const ok = await confirm({
            title: 'Снять блокировку?',
            body: 'Кабинет снова станет доступен для броней в это время.',
            confirmLabel: 'Снять блокировку',
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        try {
            await maintenanceApi.remove(id);
            setBlocks(prev => prev.filter(b => b.id !== id));
            toast.success('Блокировка снята');
        } catch (e) {
            toastApiError(e, 'Не удалось снять блокировку. Попробуйте ещё раз');
        }
    };

    const handleDeleteGroup = async (groupId: string, n: number) => {
        const ok = await confirm({
            title: 'Снять всю серию?',
            body: `Снимем ${n} ${plural(n, 'блокировку', 'блокировки', 'блокировок')} этой серии. Брони клиентов не трогаем.`,
            confirmLabel: 'Снять серию',
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        try {
            const { deleted } = await maintenanceApi.removeGroup(groupId);
            toast.success(`Серия снята: ${deleted} ${plural(deleted, 'блокировка', 'блокировки', 'блокировок')}`);
            await load();
        } catch (e) {
            toastApiError(e, 'Не удалось снять серию. Попробуйте ещё раз');
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
    const seriesSize = useMemo(() => {
        const m = new Map<string, number>();
        for (const b of blocks) if (b.recurringGroupId) m.set(b.recurringGroupId, (m.get(b.recurringGroupId) || 0) + 1);
        return m;
    }, [blocks]);

    return (
        <div>
            <Button
                block
                icon={<Plus size={16} aria-hidden="true" />}
                onClick={() => setShowCreate(true)}
                style={{ marginBottom: 14 }}
            >
                Закрыть кабинет
            </Button>

            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить блокировки" onRetry={load} className="mb-3" />
            )}

            {loading ? (
                <SkeletonList count={3} label="Загружаем блокировки" cardHeight={56} />
            ) : failed ? null : blocks.length === 0 ? (
                <EmptyState compact title="Закрытых кабинетов нет" hint="Уборку или ремонт можно отметить кнопкой выше." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {Object.keys(groups).sort().map(date => (
                        <div key={date}>
                            <SectionLabel>{formatDateLabel(date, { capitalize: true })}</SectionLabel>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {groups[date].map(b => {
                                    const res = RESOURCES.find(r => r.id === b.resourceId);
                                    const n = b.recurringGroupId ? seriesSize.get(b.recurringGroupId) || 0 : 0;
                                    return (
                                        <div key={b.id} style={{
                                            background: 'var(--color-card)',
                                            border: '1px solid var(--color-ink-08)',
                                            borderRadius: 10,
                                            padding: '4px 4px 4px 12px',
                                            display: 'flex',
                                            gap: 10,
                                            alignItems: 'center',
                                        }}>
                                            <div style={{
                                                width: 32, height: 32, borderRadius: 8,
                                                background: 'var(--color-sunken)', color: 'var(--color-ink-80)',
                                                display: 'grid', placeItems: 'center', flexShrink: 0,
                                            }}>
                                                <Wrench size={14} aria-hidden="true" />
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    {res?.name || b.resourceId} · {b.startTime}–{addMinTime(b.startTime, b.duration)}
                                                </div>
                                                <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                                    {b.reason || 'Без описания'}
                                                    {n > 1 && ` · серия из ${n}`}
                                                </div>
                                            </div>
                                            {n > 1 && b.recurringGroupId && (
                                                <Button
                                                    variant="quiet"
                                                    size="touch"
                                                    onClick={() => handleDeleteGroup(b.recurringGroupId!, n)}
                                                >
                                                    Снять серию
                                                </Button>
                                            )}
                                            <button
                                                onClick={() => handleDelete(b.id)}
                                                style={iconBtn('var(--status-danger-fg)')}
                                                aria-label="Снять блокировку"
                                            >
                                                <Trash2 size={16} aria-hidden="true" />
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
    const [date, setDate] = useState(batumiDayKey());
    const [dateTo, setDateTo] = useState('');
    const [startTime, setStartTime] = useState('10:00');
    const [duration, setDuration] = useState(60);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    // В1: поверх броней клиентов не закрываем — показываем список (409).
    const [conflicts, setConflicts] = useState<MaintenanceConflict[] | null>(null);

    const resource = RESOURCES.find(r => r.id === resourceId);

    const handleSave = async () => {
        setSaving(true);
        try {
            await maintenanceApi.create({
                resourceId,
                locationId: resource?.locationId || 'unbox_one',
                dateFrom: date,
                dateTo: dateTo || null,
                startTime,
                duration,
                reason,
            });
            toast.success('Кабинет закрыт');
            await onCreated();
        } catch (e) {
            // Раньше detail уходил прямо в toast.error — на 409 это объект,
            // и React падал (#31). Теперь конфликт — шторкой со списком.
            if (isMaintenanceConflict(e)) setConflicts(e.conflicts);
            else toastApiError(e, 'Не удалось закрыть кабинет. Проверьте поля и попробуйте ещё раз');
        } finally {
            setSaving(false);
        }
    };

    return (
        <>
            <Sheet
                open
                onClose={onClose}
                title="Закрыть кабинет"
                description="Слот будет занят и не появится в свободных. Поверх броней клиентов закрыть нельзя."
                footer={
                    <Button
                        block
                        loading={saving}
                        icon={<Check size={16} aria-hidden="true" />}
                        onClick={handleSave}
                    >
                        Закрыть кабинет
                    </Button>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Field label="Кабинет">
                        <Select value={resourceId} onChange={e => setResourceId(e.target.value)}>
                            {RESOURCES.filter(r => r.isActive !== false).map(r => (
                                <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                        </Select>
                    </Field>
                    <Field label="Дата">
                        <Input kind="date" value={date} onChange={e => setDate(e.target.value)} />
                    </Field>
                    <Field label="Дата окончания" optional hint="Для серии — закроем каждый день до этой даты">
                        <Input kind="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <Field label="Начало">
                            <Input kind="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                        </Field>
                        <Field label="Длительность">
                            <Input kind="integer" suffix="мин" value={duration} onChange={e => setDuration(Number(e.target.value))} />
                        </Field>
                    </div>
                    <Field label="Причина" hint="Видно в шахматке">
                        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Уборка, ремонт, мероприятие…" />
                    </Field>
                </div>
            </Sheet>
            <MaintenanceConflictSheet
                open={!!conflicts}
                onClose={() => setConflicts(null)}
                conflicts={conflicts ?? []}
                linkFor={c => `/m/admin/bookings?day=${c.date}`}
                resourceName={id => RESOURCES.find(r => r.id === id)?.name || id}
            />
        </>
    );
}

// ── Waitlist tab ─────────────────────────────────────────────────────────

function WaitlistTab() {
    const { users } = useUserStore();
    const [entries, setEntries] = useState<WaitlistEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const { confirm } = useConfirmDialog();

    const load = async () => {
        setLoading(true);
        try {
            const data = await waitlistApi.getAllWaitlistAdmin();
            setEntries(data);
            setFailed(false);
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (id: string) => {
        const ok = await confirm({
            title: 'Убрать из листа ожидания?',
            body: 'Клиент больше не получит уведомление, когда слот освободится.',
            confirmLabel: 'Убрать из листа',
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        try {
            await waitlistApi.removeFromWaitlist(id);
            setEntries(prev => prev.filter(e => e.id !== id));
            toast.success('Убрали из листа ожидания');
        } catch {
            toast.error('Не удалось убрать из листа. Попробуйте ещё раз');
        }
    };

    const userName = (uid: string) => users.find(u => u.email === uid || String(u.id) === uid)?.name || uid;

    return (
        <div>
            {failed && !loading && (
                <ErrorBar message="Не удалось загрузить лист ожидания" onRetry={load} className="mb-3" />
            )}
            {loading ? (
                <SkeletonList count={3} label="Загружаем лист ожидания" cardHeight={56} />
            ) : failed ? null : entries.length === 0 ? (
                <EmptyState compact title="Лист ожидания пуст" hint="Здесь появятся клиенты, которые ждут освободившийся слот." />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {entries.map(e => {
                        const res = RESOURCES.find(r => r.id === (e as any).resourceId);
                        const dateStr = String((e as any).date || '').slice(0, 10);
                        return (
                            <div key={e.id} style={{
                                background: 'var(--color-card)',
                                border: '1px solid var(--color-ink-08)',
                                borderRadius: 10,
                                padding: '4px 4px 4px 12px',
                                display: 'flex', gap: 6, alignItems: 'center',
                            }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {userName((e as any).userId)}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--color-ink-60)' }}>
                                        {res?.name || (e as any).resourceId}
                                        {' · '}
                                        {dateStr ? formatDayMonth(dateStr) : 'дата не указана'}
                                        {' · '}
                                        {(e as any).startTime}–{(e as any).endTime}
                                    </div>
                                </div>
                                <button
                                    onClick={async () => {
                                        try {
                                            const r = await waitlistApi.notifyEntry(e.id);
                                            toast.success(`Уведомление отправлено${r.notified ? ` (${r.notified})` : ''}`);
                                        } catch (err) {
                                            toastApiError(err, 'Не удалось отправить уведомление');
                                        }
                                    }}
                                    style={iconBtn('var(--color-ink)')}
                                    aria-label="Уведомить клиента"
                                >
                                    <Bell size={16} aria-hidden="true" />
                                </button>
                                <button
                                    onClick={() => handleDelete(e.id)}
                                    style={iconBtn('var(--status-danger-fg)')}
                                    aria-label="Убрать из листа ожидания"
                                >
                                    <Trash2 size={16} aria-hidden="true" />
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

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: 'var(--color-ink-60)', marginBottom: 8,
        }}>
            {children}
        </div>
    );
}

/** Кнопка-иконка 44×44 (зона нажатия), значок 16. */
function iconBtn(color: string): React.CSSProperties {
    return {
        background: 'none', border: 'none', color, cursor: 'pointer',
        width: 44, height: 44, flexShrink: 0,
        display: 'grid', placeItems: 'center', borderRadius: 8,
    };
}
