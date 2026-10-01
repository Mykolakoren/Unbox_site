import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus, Repeat, Trash2, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import {
    maintenanceApi, isMaintenanceConflict,
    type MaintenanceBlock, type MaintenanceConflict,
} from '../../api/maintenance';
import { useBookingStore } from '../../store/bookingStore';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { SkeletonList } from '../../components/ui/Skeleton';
import { ErrorBar } from '../../components/ui/ErrorBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input, Select } from '../../components/ui/Field';
import { Chip } from '../../components/ui/Chip';
import { MaintenanceConflictSheet } from '../../components/admin/MaintenanceConflictSheet';
import { formatDateLabel, formatDayMonth } from '../../utils/format';
import { ruCountWord } from '../../utils/plural';
import { toastApiError } from '../../utils/errors';
import { batumiDayKey } from '../../utils/adminToday';

/**
 * Обслуживание — «Закрыть кабинет» на уборку, ремонт, мероприятие (волна 4, пакет D).
 *
 * Решение владельца В1 (01.10): поверх брони клиента блок не ставится.
 * Сервер отвечает 409 со списком, maintenanceApi.create бросает
 * MaintenanceConflictError — показываем MaintenanceConflictSheet со ссылкой
 * на каждую бронь. Ничего не отменяем и не «закрываем всё равно».
 *
 * Серии (одна форма на несколько дат) сворачиваются в одну строку
 * «каждую ср · 13 дат» с кнопкой «Снять серию» (G8-12). Длинный список —
 * «Показать все», а не немой «и ещё 40…» (G8-admin-ops-M2).
 */

const WEEKDAYS = [
    { idx: 0, label: 'Пн' }, { idx: 1, label: 'Вт' }, { idx: 2, label: 'Ср' },
    { idx: 3, label: 'Чт' }, { idx: 4, label: 'Пт' }, { idx: 5, label: 'Сб' }, { idx: 6, label: 'Вс' },
];
const WEEKDAY_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

const DATES: [string, string, string] = ['дата', 'даты', 'дат'];
const BLOCKS: [string, string, string] = ['блокировка', 'блокировки', 'блокировок'];

/** Сколько строк (серий и одиночных дат) на кабинет видно сразу. */
const VISIBLE_ROWS = 10;

/** Ссылка на бронь из шторки конфликта — шахматка сама откроет её карточку. */
const bookingLink = (c: MaintenanceConflict) => `/admin/bookings?view=grid&highlight=${c.bookingId}`;

const dayOf = (b: MaintenanceBlock) => String(b.date || '').slice(0, 10);

function endTime(start: string, duration: number): string {
    const [h, m] = start.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const total = h * 60 + m + (duration || 0);
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const timeRange = (b: MaintenanceBlock) => {
    const start = (b.startTime || '').slice(0, 5);
    const end = endTime(start, b.duration);
    return end ? `${start}–${end}` : start;
};

/** 0 = пн … 6 = вс для «YYYY-MM-DD». */
function weekdayOf(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number);
    const js = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
    return (js + 6) % 7;
}

type Row =
    | { kind: 'single'; key: string; first: string; block: MaintenanceBlock }
    | { kind: 'series'; key: string; first: string; groupId: string; blocks: MaintenanceBlock[] };

/** Строки одного кабинета: серии свёрнуты, одиночные даты — как есть. */
function rowsOf(blocks: MaintenanceBlock[]): Row[] {
    const series = new Map<string, MaintenanceBlock[]>();
    const rows: Row[] = [];
    for (const b of blocks) {
        if (b.recurringGroupId) {
            const list = series.get(b.recurringGroupId) ?? [];
            list.push(b);
            series.set(b.recurringGroupId, list);
        } else {
            rows.push({ kind: 'single', key: b.id, first: dayOf(b), block: b });
        }
    }
    for (const [groupId, list] of series) {
        list.sort((a, b) => a.date.localeCompare(b.date));
        // От серии осталась одна дата — показываем обычной строкой.
        if (list.length === 1) {
            rows.push({ kind: 'single', key: list[0].id, first: dayOf(list[0]), block: list[0] });
        } else {
            rows.push({ kind: 'series', key: groupId, first: dayOf(list[0]), groupId, blocks: list });
        }
    }
    rows.sort((a, b) => a.first.localeCompare(b.first));
    return rows;
}

/** «по ср и пт» / «каждый день» — для подписи серии. */
function seriesDays(blocks: MaintenanceBlock[]): string {
    const days = Array.from(new Set(blocks.map(b => weekdayOf(dayOf(b))))).sort((a, b) => a - b);
    if (days.length === 7) return 'каждый день';
    const names = days.map(d => WEEKDAY_SHORT[d]);
    if (names.length === 1) return `по ${names[0]}`;
    return `по ${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`;
}

export function AdminMaintenance() {
    const [blocks, setBlocks] = useState<MaintenanceBlock[]>([]);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [creating, setCreating] = useState(false);
    const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());
    const [showAll, setShowAll] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState<string | null>(null);
    const { confirm } = useConfirmDialog();
    const { resources, fetchResources, locations, fetchLocations } = useBookingStore();

    useEffect(() => {
        fetchResources();
        if (locations.length === 0) fetchLocations();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const load = async () => {
        setLoading(true);
        setFailed(false);
        try {
            // «Сегодня» — по Батуми, а не по UTC (иначе вечером теряется день).
            setBlocks(await maintenanceApi.list({ dateFrom: batumiDayKey() }));
        } catch {
            setFailed(true);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const resourceName = (id: string) => resources.find(r => r.id === id)?.name || id;
    const locationName = (resourceId: string) => {
        const locId = resources.find(r => r.id === resourceId)?.locationId;
        return locations.find(l => l.id === locId)?.name || locId || '';
    };

    const byResource = useMemo(() => {
        const out = new Map<string, MaintenanceBlock[]>();
        for (const b of blocks) {
            const list = out.get(b.resourceId) ?? [];
            list.push(b);
            out.set(b.resourceId, list);
        }
        return Array.from(out.entries()).sort(([a], [b]) => {
            const ra = resources.findIndex(r => r.id === a);
            const rb = resources.findIndex(r => r.id === b);
            return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || a.localeCompare(b);
        });
    }, [blocks, resources]);

    const handleDelete = async (b: MaintenanceBlock) => {
        const ok = await confirm({
            title: 'Снять блокировку?',
            body: `${formatDateLabel(dayOf(b), { capitalize: true })}, ${timeRange(b)} — время снова станет свободным для бронирования.`,
            confirmLabel: 'Снять блокировку',
            cancelLabel: 'Оставить',
        });
        if (!ok) return;
        setBusy(b.id);
        try {
            await maintenanceApi.remove(b.id);
            setBlocks(prev => prev.filter(x => x.id !== b.id));
            toast.success('Блокировка снята');
        } catch (e) {
            toastApiError(e, 'Не удалось снять блокировку');
        } finally {
            setBusy(null);
        }
    };

    const handleDeleteGroup = async (groupId: string, list: MaintenanceBlock[]) => {
        const first = list[0];
        const ok = await confirm({
            title: 'Снять всю серию?',
            body: `${resourceName(first.resourceId)}: ${ruCountWord(list.length, DATES)} ${seriesDays(list)}, ${timeRange(first)}. `
                + 'Время снова станет свободным. Брони клиентов это не затронет.',
            confirmLabel: `Снять ${ruCountWord(list.length, BLOCKS)}`,
            cancelLabel: 'Оставить',
            tone: 'danger',
        });
        if (!ok) return;
        setBusy(groupId);
        try {
            const { deleted } = await maintenanceApi.removeGroup(groupId);
            setBlocks(prev => prev.filter(x => x.recurringGroupId !== groupId));
            toast.success(`Серия снята: ${ruCountWord(deleted, BLOCKS)}`);
        } catch (e) {
            toastApiError(e, 'Не удалось снять серию');
        } finally {
            setBusy(null);
        }
    };

    const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
        const next = new Set(set);
        if (next.has(key)) next.delete(key); else next.add(key);
        apply(next);
    };

    return (
        <div style={{ fontFamily: GH_SANS }}>
            <PageHeader
                title="Обслуживание"
                description="Уборка, ремонт, внутренние мероприятия: время занято и не продаётся, в финансы не попадает."
                actions={
                    <Button icon={<Plus size={16} aria-hidden="true" />} onClick={() => setCreating(true)}>
                        Закрыть кабинет
                    </Button>
                }
            />

            {/* Загрузка ≠ ошибка ≠ пусто. */}
            {loading ? (
                <SkeletonList count={3} label="Загружаем блокировки" />
            ) : failed ? (
                <ErrorBar message="Не удалось загрузить блокировки" onRetry={load} />
            ) : byResource.length === 0 ? (
                <div style={cardStyle}>
                    <EmptyState
                        icon={<Wrench size={24} />}
                        title="Активных блокировок нет"
                        hint="Нажмите «Закрыть кабинет», чтобы занять время под уборку или ремонт."
                        action={{ label: 'Закрыть кабинет', onClick: () => setCreating(true) }}
                        compact
                    />
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {byResource.map(([resId, list]) => {
                        const rows = rowsOf(list);
                        const all = showAll.has(resId);
                        const visible = all ? rows : rows.slice(0, VISIBLE_ROWS);
                        return (
                            <section key={resId} style={cardStyle} aria-labelledby={`mnt-${resId}`}>
                                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${GH.ink10}` }}>
                                    <h2 id={`mnt-${resId}`} style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>
                                        {resourceName(resId)}
                                    </h2>
                                    <div style={{ fontSize: 14, color: GH.ink60, marginTop: 2 }}>
                                        {[locationName(resId), ruCountWord(list.length, BLOCKS)].filter(Boolean).join(' · ')}
                                    </div>
                                </div>
                                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                                    {visible.map(row => row.kind === 'single' ? (
                                        <li key={row.key} style={rowStyle}>
                                            <span style={{ ...monoCell }}>{formatDateLabel(row.first, { capitalize: true, withYear: 'auto' })}</span>
                                            <span style={monoCell}>{timeRange(row.block)}</span>
                                            <span style={{ color: GH.ink60, minWidth: 0, overflowWrap: 'anywhere' }}>{row.block.reason || '—'}</span>
                                            <button
                                                type="button"
                                                onClick={() => handleDelete(row.block)}
                                                disabled={busy === row.block.id}
                                                title="Снять блокировку"
                                                aria-label={`Снять блокировку ${formatDayMonth(row.first)} ${timeRange(row.block)}`}
                                                style={iconBtn}
                                            >
                                                <Trash2 size={16} aria-hidden="true" />
                                            </button>
                                        </li>
                                    ) : (
                                        <li key={row.key} style={{ borderBottom: `1px solid ${GH.ink10}` }}>
                                            <div style={{ ...rowStyle, borderBottom: 'none' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => toggle(expandedSeries, row.groupId, setExpandedSeries)}
                                                    aria-expanded={expandedSeries.has(row.groupId)}
                                                    style={seriesToggle}
                                                >
                                                    {expandedSeries.has(row.groupId)
                                                        ? <ChevronDown size={16} aria-hidden="true" />
                                                        : <ChevronRight size={16} aria-hidden="true" />}
                                                    <Repeat size={14} aria-hidden="true" />
                                                    <span>
                                                        Серия · {formatDayMonth(row.first)} – {formatDayMonth(dayOf(row.blocks[row.blocks.length - 1]))}
                                                    </span>
                                                </button>
                                                <span style={monoCell}>{timeRange(row.blocks[0])}</span>
                                                <span style={{ color: GH.ink60, minWidth: 0, overflowWrap: 'anywhere' }}>
                                                    {ruCountWord(row.blocks.length, DATES)} {seriesDays(row.blocks)}
                                                    {row.blocks[0].reason ? ` · ${row.blocks[0].reason}` : ''}
                                                </span>
                                                <Button
                                                    variant="secondary"
                                                    size="compact"
                                                    loading={busy === row.groupId}
                                                    onClick={() => handleDeleteGroup(row.groupId, row.blocks)}
                                                >
                                                    Снять серию
                                                </Button>
                                            </div>
                                            {expandedSeries.has(row.groupId) && (
                                                <ul style={{ listStyle: 'none', margin: 0, padding: '0 0 4px 0', background: GH.sunken }}>
                                                    {row.blocks.map(b => (
                                                        <li key={b.id} style={{ ...rowStyle, paddingLeft: 40 }}>
                                                            <span style={monoCell}>{formatDateLabel(dayOf(b), { capitalize: true, withYear: 'auto' })}</span>
                                                            <span style={monoCell}>{timeRange(b)}</span>
                                                            <span />
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDelete(b)}
                                                                disabled={busy === b.id}
                                                                title="Снять только эту дату"
                                                                aria-label={`Снять блокировку ${formatDayMonth(dayOf(b))} ${timeRange(b)}`}
                                                                style={iconBtn}
                                                            >
                                                                <Trash2 size={16} aria-hidden="true" />
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                {rows.length > VISIBLE_ROWS && (
                                    <div style={{ padding: '8px 16px' }}>
                                        <Button
                                            variant="quiet"
                                            size="compact"
                                            onClick={() => toggle(showAll, resId, setShowAll)}
                                            aria-expanded={all}
                                        >
                                            {all ? 'Свернуть' : `Показать все (${rows.length})`}
                                        </Button>
                                    </div>
                                )}
                            </section>
                        );
                    })}
                </div>
            )}

            <CreateSheet
                open={creating}
                onClose={() => setCreating(false)}
                onCreated={() => { setCreating(false); load(); }}
                resourceName={resourceName}
            />
        </div>
    );
}

function CreateSheet({ open, onClose, onCreated, resourceName }: {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    resourceName: (id: string) => string;
}) {
    const { resources, locations } = useBookingStore();
    const active = resources.filter(r => r.isActive !== false);
    const [resourceId, setResourceId] = useState('');
    const [dateFrom, setDateFrom] = useState(batumiDayKey());
    const [dateTo, setDateTo] = useState('');
    const [startTime, setStartTime] = useState('09:00');
    const [duration, setDuration] = useState('60');
    const [reason, setReason] = useState('');
    const [weekdays, setWeekdays] = useState<number[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [conflicts, setConflicts] = useState<MaintenanceConflict[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    const chosen = resourceId || active[0]?.id || '';
    const resource = resources.find(r => r.id === chosen);
    const minutes = parseInt(duration, 10);
    const durationOk = Number.isFinite(minutes) && minutes >= 15 && minutes <= 600;
    const rangeOk = !dateTo || dateTo >= dateFrom;

    const toggleWeekday = (idx: number) => {
        setWeekdays(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx]);
    };

    const submit = async () => {
        if (!resource) { setError('Выберите кабинет'); return; }
        if (!durationOk) { setError('Длительность — от 15 до 600 минут'); return; }
        if (!rangeOk) { setError('«По дату» не может быть раньше «С даты»'); return; }
        setError(null);
        setSubmitting(true);
        try {
            const created = await maintenanceApi.create({
                resourceId: resource.id,
                locationId: resource.locationId || 'unbox_one',
                dateFrom,
                dateTo: dateTo || null,
                startTime,
                duration: minutes,
                reason,
                recurringWeekdays: dateTo && weekdays.length > 0 ? weekdays : null,
            });
            toast.success(`Кабинет закрыт: ${ruCountWord(created.length, DATES)}`);
            onCreated();
        } catch (e) {
            // В1: поверх брони не закрываем — показываем, какие брони мешают.
            if (isMaintenanceConflict(e)) setConflicts(e.conflicts);
            else toastApiError(e, 'Не удалось закрыть кабинет');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
            <Sheet
                open={open}
                onClose={onClose}
                title="Закрыть кабинет"
                description="Время будет занято и не появится в свободных для бронирования."
                width={520}
                dismissible={!submitting}
                footer={
                    <>
                        <Button block loading={submitting} onClick={submit}>
                            {resource ? `Закрыть ${resource.name}` : 'Закрыть кабинет'}
                        </Button>
                        <Button block variant="secondary" onClick={onClose} disabled={submitting}>Отмена</Button>
                    </>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <Field label="Кабинет">
                        <Select value={chosen} onChange={e => setResourceId(e.target.value)}>
                            {active.map(r => {
                                const loc = locations.find(l => l.id === r.locationId);
                                return <option key={r.id} value={r.id}>{r.name}{loc ? ` · ${loc.name}` : ''}</option>;
                            })}
                        </Select>
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="С даты">
                            <Input kind="date" type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                        </Field>
                        <Field label="По дату" optional error={!rangeOk ? 'Раньше, чем «С даты»' : undefined}>
                            <Input kind="date" type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} />
                        </Field>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <Field label="Начало">
                            <Input kind="time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                        </Field>
                        <Field
                            label="Длительность, мин"
                            hint={durationOk ? `До ${endTime(startTime, minutes)}` : undefined}
                            error={!durationOk ? 'От 15 до 600 минут' : undefined}
                        >
                            <Input kind="integer" value={duration} onChange={e => setDuration(e.target.value.replace(/\D/g, ''))} />
                        </Field>
                    </div>
                    {dateTo && (
                        <Field label="Только в дни недели" optional hint="Ничего не выбрано — каждый день диапазона.">
                            <div className="ui-chip-row" role="group" aria-label="Дни недели">
                                {WEEKDAYS.map(w => (
                                    <Chip key={w.idx} selected={weekdays.includes(w.idx)} onClick={() => toggleWeekday(w.idx)}>
                                        {w.label}
                                    </Chip>
                                ))}
                            </div>
                        </Field>
                    )}
                    <Field label="Причина" optional hint="Видна в шахматке на этом времени.">
                        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Уборка, замена ламп, ремонт мебели…" />
                    </Field>
                    {error && (
                        <div role="alert" style={{ color: 'var(--status-danger-fg)', fontSize: 14 }}>{error}</div>
                    )}
                </div>
            </Sheet>
            <MaintenanceConflictSheet
                open={!!conflicts}
                conflicts={conflicts ?? []}
                onClose={() => setConflicts(null)}
                linkFor={bookingLink}
                resourceName={resourceName}
            />
        </>
    );
}

const monoCell: React.CSSProperties = { fontFamily: GH_MONO, fontSize: 14, whiteSpace: 'nowrap' };

const rowStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 240px) 120px 1fr auto',
    gap: 12,
    padding: '6px 16px',
    minHeight: 44,
    borderBottom: `1px solid ${GH.ink10}`,
    alignItems: 'center',
    fontSize: 14,
};

const seriesToggle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'none', border: 'none', padding: 0, minHeight: 36,
    font: 'inherit', fontWeight: 500, color: GH.ink, cursor: 'pointer', textAlign: 'left',
};

const iconBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    width: 36, height: 36, color: GH.ink60, display: 'grid', placeItems: 'center',
    borderRadius: 8,
};

const cardStyle: React.CSSProperties = {
    background: GH.card, border: `1px solid ${GH.ink10}`, borderRadius: 0,
    overflow: 'hidden',
};
