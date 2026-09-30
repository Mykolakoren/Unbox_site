import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type ScheduleSlot, type Appointment } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { useUserStore } from '../../store/userStore';
import { ADMIN_ROLES } from '../../utils/permissions';
import { Link } from 'react-router-dom';
import { Clock, Save, Loader2, Trash2, Calendar, MapPin, Video, User, Plus, CalendarOff } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { formatDayMonth, formatDateLabel, formatTime } from '../../utils/format';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { Skeleton } from '../../components/ui/Skeleton';

const DOW_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const LOCATION_OPTIONS = [
    { value: '__online__', label: 'Онлайн', icon: Video },
    ...LOCATIONS.filter(l => l.id !== 'neo_school').map(l => ({ value: l.id, label: l.name, icon: MapPin })),
];

interface DayRange {
    start_time: string;
    end_time: string;
    location_id: string; // "__online__" or location id
}

interface DaySchedule {
    enabled: boolean;
    /** Multiple time windows per day. Backend already supports any number
     *  of weekly ScheduleSlot rows for the same day_of_week, so e.g.
     *  Monday can be 10:00–13:00 at Unbox One AND 16:00–20:00 online. */
    ranges: DayRange[];
}

const DEFAULT_RANGE = (): DayRange => ({ start_time: '10:00', end_time: '18:00', location_id: 'unbox_uni' });

// Date-specific override: either mark the day off (is_available=false)
// or override the weekly schedule for that date (custom hours/location).
interface OverrideEntry {
    specific_date: string; // "YYYY-MM-DD"
    is_available: boolean;
    start_time: string;
    end_time: string;
    location_id: string;   // "__online__" or location id
}

const DEFAULT_DAY = (): DaySchedule => ({ enabled: false, ranges: [DEFAULT_RANGE()] });

const todayISO = () => format(new Date(), 'yyyy-MM-dd');

const emptyOverride = (): OverrideEntry => ({
    specific_date: todayISO(),
    is_available: false,
    start_time: '10:00',
    end_time: '18:00',
    location_id: 'unbox_uni',
});

/** `compact` — экран открыт в мобильном CRM (/m/crm/schedule): узкая
 *  колонка до 480px, поэтому таблицы складываются в карточки даже на
 *  широком окне. */
export function CrmSchedule({ compact = false }: { compact?: boolean } = {}) {
    const currentUser = useUserStore(s => s.currentUser);
    const { confirm } = useConfirmDialog();
    const [specialistId, setSpecialistId] = useState<string | null>(null);
    // Поиск анкеты: 'pending' пока ищем, 'missing' — анкеты нет (404),
    // 'error' — не смогли спросить сервер (сеть/5xx). Раньше тупик «нет
    // анкеты» мигал ещё до ответа сервера и показывался при любой ошибке.
    const [lookup, setLookup] = useState<'pending' | 'found' | 'missing' | 'error'>('pending');
    const [lookupAttempt, setLookupAttempt] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [days, setDays] = useState<DaySchedule[]>(Array(7).fill(null).map(DEFAULT_DAY));
    const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);

    // Анкета текущего пользователя — через GET /specialists/me, как в
    // CrmProfile. Раньше искали в админском /specialists/admin/all: для
    // специалиста это 403, ошибка глоталась, и каждый психолог без
    // админских прав упирался в «Аккаунт не привязан к анкете».
    // Запасной путь только для админа без доступа к Psy-CRM (/me даёт ему
    // 403): его собственная анкета ищется в админском списке.
    useEffect(() => {
        if (!currentUser) return;
        let cancelled = false;
        const targetId = String(currentUser.id);
        const isAdmin = ADMIN_ROLES.includes(currentUser.role ?? '') || !!currentUser.isAdmin;
        setLookup('pending');
        (async () => {
            try {
                const mine = await specialistsApi.getMine();  // null = 404, анкеты нет
                if (cancelled) return;
                if (mine) {
                    setSpecialistId(mine.id);
                    setLookup('found');
                    return;
                }
                setLookup('missing');
            } catch (e: any) {
                if (cancelled) return;
                if (e?.response?.status === 403 && isAdmin) {
                    try {
                        const all = await specialistsApi.adminList();
                        if (cancelled) return;
                        const spec = all.find((x: any) => (x?.userId ?? x?.user_id) === targetId);
                        if (spec) {
                            setSpecialistId(spec.id);
                            setLookup('found');
                        } else {
                            setLookup('missing');
                        }
                        return;
                    } catch { /* ниже — общий экран ошибки */ }
                }
                if (!cancelled) setLookup(e?.response?.status === 403 ? 'missing' : 'error');
            }
        })();
        return () => { cancelled = true; };
    }, [currentUser, lookupAttempt]);

    // Load schedule
    useEffect(() => {
        if (!specialistId) {
            if (lookup !== 'pending') setLoading(false);
            return;
        }
        setLoading(true);
        Promise.all([
            specialistsApi.getSchedule(specialistId),
            specialistsApi.getAppointments(specialistId).catch(() => []),
        ]).then(([schedule, appts]) => {
            // Group weekly slots by dayOfWeek so the same day can hold
            // multiple ranges (e.g. Mon 10:00–13:00 + 16:00–20:00).
            // Поля ответа — camelCase (интерцептор client.ts). Раньше
            // читали поля day_of_week / start_time → undefined, и
            // сохранённое расписание открывалось пустым: одно нажатие
            // «Сохранить» стёрло бы все часы специалиста.
            const newDays: DaySchedule[] = Array(7).fill(null).map(DEFAULT_DAY);
            const haveAnyRange = Array(7).fill(false);
            const newOverrides: OverrideEntry[] = [];
            schedule.forEach(slot => {
                if (slot.specificDate) {
                    newOverrides.push({
                        specific_date: slot.specificDate,
                        is_available: slot.isAvailable,
                        start_time: slot.startTime,
                        end_time: slot.endTime,
                        location_id: slot.locationId || '__online__',
                    });
                } else if (slot.dayOfWeek != null && slot.dayOfWeek >= 0 && slot.dayOfWeek <= 6) {
                    const dow = slot.dayOfWeek;
                    const range: DayRange = {
                        start_time: slot.startTime,
                        end_time: slot.endTime,
                        location_id: slot.locationId || '__online__',
                    };
                    if (!haveAnyRange[dow]) {
                        newDays[dow] = { enabled: slot.isAvailable, ranges: [range] };
                        haveAnyRange[dow] = true;
                    } else {
                        newDays[dow].ranges.push(range);
                        if (slot.isAvailable) newDays[dow].enabled = true;
                    }
                }
            });
            // Sort each day's ranges by start_time so they read top-down chronologically.
            newDays.forEach(d => d.ranges.sort((a, b) => a.start_time.localeCompare(b.start_time)));
            newOverrides.sort((a, b) => a.specific_date.localeCompare(b.specific_date));
            setDays(newDays);
            setOverrides(newOverrides);
            setAppointments(appts);
        }).catch(() => {
            // Не показываем пустой редактор: «Сохранить» поверх незагруженного
            // расписания стёрло бы часы. Экран «Не удалось загрузить» + «Повторить».
            setSpecialistId(null);
            setLookup('error');
        }).finally(() => setLoading(false));
    }, [specialistId, lookup]);

    const handleSave = async () => {
        if (!specialistId) return;
        setSaving(true);
        try {
            // Flatten each day's ranges into one ScheduleSlot row per range.
            // Empty / invalid ranges (start >= end) are dropped silently —
            // we'd rather discard a half-edited row than reject the whole save.
            const weeklySlots: Omit<ScheduleSlot, 'id'>[] = [];
            days.forEach((d, i) => {
                d.ranges.forEach(r => {
                    if (d.enabled && r.start_time >= r.end_time) return;
                    weeklySlots.push({
                        dayOfWeek: i,
                        specificDate: null,
                        startTime: r.start_time,
                        endTime: r.end_time,
                        locationId: r.location_id === '__online__' ? null : r.location_id,
                        isAvailable: d.enabled,
                    });
                });
            });
            // Deduplicate overrides by date (last one wins) and drop invalid ranges
            const byDate = new Map<string, OverrideEntry>();
            overrides.forEach(o => {
                if (!o.specific_date) return;
                // Day-off overrides don't need time validation
                if (o.is_available && o.start_time >= o.end_time) return;
                byDate.set(o.specific_date, o);
            });
            // Ключи camelCase — интерцептор запроса переведёт их в
            // day_of_week / start_time / … для бэкенда.
            const overrideSlots: Omit<ScheduleSlot, 'id'>[] = Array.from(byDate.values()).map(o => ({
                dayOfWeek: null,
                specificDate: o.specific_date,
                startTime: o.is_available ? o.start_time : '00:00',
                endTime: o.is_available ? o.end_time : '00:00',
                locationId: o.location_id === '__online__' ? null : o.location_id,
                isAvailable: o.is_available,
            }));
            await specialistsApi.updateSchedule(specialistId, [...weeklySlots, ...overrideSlots]);
            toast.success('Расписание сохранено');
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    // Overrides helpers
    const addOverride = () => {
        setOverrides(prev => [...prev, emptyOverride()]);
    };
    const updateOverride = (i: number, patch: Partial<OverrideEntry>) => {
        setOverrides(prev => prev.map((o, idx) => idx === i ? { ...o, ...patch } : o));
    };
    const removeOverride = (i: number) => {
        setOverrides(prev => prev.filter((_, idx) => idx !== i));
    };

    const updateDay = (i: number, patch: Partial<DaySchedule>) => {
        setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
    };
    const updateRange = (dayIdx: number, rangeIdx: number, patch: Partial<DayRange>) => {
        setDays(prev => prev.map((d, idx) => {
            if (idx !== dayIdx) return d;
            return { ...d, ranges: d.ranges.map((r, ri) => ri === rangeIdx ? { ...r, ...patch } : r) };
        }));
    };
    const addRange = (dayIdx: number) => {
        // Adding a range to a disabled day auto-enables it — without this
        // the new row visually appears but doesn't get saved.
        setDays(prev => prev.map((d, idx) => {
            if (idx !== dayIdx) return d;
            const last = d.ranges[d.ranges.length - 1];
            const seed: DayRange = last
                ? { ...last, start_time: bumpHour(last.end_time, 1), end_time: bumpHour(last.end_time, 2) }
                : DEFAULT_RANGE();
            return { ...d, enabled: true, ranges: [...d.ranges, seed] };
        }));
    };
    const removeRange = (dayIdx: number, rangeIdx: number) => {
        setDays(prev => prev.map((d, idx) => {
            if (idx !== dayIdx) return d;
            const filtered = d.ranges.filter((_, ri) => ri !== rangeIdx);
            // Day always has at least one range row; if the user removed
            // the last one we drop back to the default and disable the day.
            if (filtered.length === 0) return { ...d, enabled: false, ranges: [DEFAULT_RANGE()] };
            return { ...d, ranges: filtered };
        }));
    };

    const upcomingAppointments = useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        return appointments
            .filter(a => a.status === 'confirmed' && a.date >= today)
            .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`));
    }, [appointments]);

    if (!currentUser) return null;

    // ─── Grid House variant (behind feature flag) ────────────────────────
    return (

            <GridHouseCrmSchedule
                loading={loading}
                specialistId={specialistId}
                lookup={lookup}
                onRetryLookup={() => setLookupAttempt(n => n + 1)}
                compact={compact}
                days={days}
                updateDay={updateDay}
                updateRange={updateRange}
                addRange={addRange}
                removeRange={removeRange}
                overrides={overrides}
                addOverride={addOverride}
                updateOverride={updateOverride}
                removeOverride={removeOverride}
                saving={saving}
                handleSave={handleSave}
                upcomingAppointments={upcomingAppointments}
                onCancelAppt={async (id) => {
                    if (!specialistId) return;
                    const appt = appointments.find(a => a.id === id);
                    const ok = await confirm({
                        title: 'Отменить запись?',
                        body: appt
                            ? `${appt.clientName} · ${formatDateLabel(appt.date)}, ${formatTime(appt.startTime)}`
                            : undefined,
                        confirmLabel: 'Отменить запись',
                        cancelLabel: 'Оставить',
                        tone: 'danger',
                    });
                    if (!ok) return;
                    try {
                        await specialistsApi.cancelAppointment(specialistId, id);
                        setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
                        toast.success('Запись отменена');
                    } catch {
                        toast.error('Не удалось отменить запись');
                    }
                }}
            />
        );
}


// ─────────────────────────────────────────────────────────────────────────
// GRID HOUSE CRM SCHEDULE — newspaper-scheduler variant
// Rollback: delete this component + the early-return in CrmSchedule.
// ─────────────────────────────────────────────────────────────────────────

const GH_HAIRLINE = `1px solid ${GH.ink10}`;
const GH_HAIRLINE_STRONG = `1px solid ${GH.ink}`;
const GH_MONO_LABEL: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: GH.ink60,
};
const GH_DOW_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

interface GridHouseCrmScheduleProps {
    loading: boolean;
    specialistId: string | null;
    lookup: 'pending' | 'found' | 'missing' | 'error';
    onRetryLookup: () => void;
    compact: boolean;
    days: DaySchedule[];
    updateDay: (i: number, patch: Partial<DaySchedule>) => void;
    updateRange: (dayIdx: number, rangeIdx: number, patch: Partial<DayRange>) => void;
    addRange: (dayIdx: number) => void;
    removeRange: (dayIdx: number, rangeIdx: number) => void;
    overrides: OverrideEntry[];
    addOverride: () => void;
    updateOverride: (i: number, patch: Partial<OverrideEntry>) => void;
    removeOverride: (i: number) => void;
    saving: boolean;
    handleSave: () => void;
    upcomingAppointments: Appointment[];
    onCancelAppt: (id: string) => Promise<void>;
}

function GridHouseCrmSchedule({
    loading,
    specialistId,
    lookup,
    onRetryLookup,
    compact,
    days,
    updateDay,
    updateRange,
    addRange,
    removeRange,
    overrides,
    addOverride,
    updateOverride,
    removeOverride,
    saving,
    handleSave,
    upcomingAppointments,
    onCancelAppt,
}: GridHouseCrmScheduleProps) {
    // Узкий экран (телефон или мобильный CRM): таблицы складываются в
    // карточки, иначе исключения и записи вылезали за край на 390px.
    const [narrowWindow, setNarrowWindow] = useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
    useEffect(() => {
        const onResize = () => setNarrowWindow(window.innerWidth < 640);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const narrow = compact || narrowWindow;

    if (loading || lookup === 'pending') {
        return (
            <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '24px 0' }}>
                <span className="sr-only">Загружаем расписание…</span>
                <Skeleton height={40} width="50%" radius={0} />
                {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height={36} radius={0} />)}
            </div>
        );
    }

    if (!specialistId) {
        const isError = lookup === 'error';
        const btn: React.CSSProperties = {
            background: GH.ink,
            color: GH.paper,
            border: 'none',
            padding: '14px 22px',
            fontFamily: GH_MONO,
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            cursor: 'pointer',
            textDecoration: 'none',
            display: 'inline-block',
        };
        const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: GH.ink, border: GH_HAIRLINE_STRONG };
        return (
            <div
                style={{
                    border: GH_HAIRLINE,
                    padding: narrow ? '40px 20px' : '56px 32px',
                    margin: narrow ? 16 : 0,
                    background: GH.paper,
                    fontFamily: GH_SANS,
                    textAlign: 'center',
                }}
            >
                <div style={{ ...GH_MONO_LABEL, marginBottom: 16 }}>{isError ? 'Нет связи' : 'Нет анкеты'}</div>
                <div
                    style={{
                        fontSize: 'clamp(28px, 3vw, 44px)',
                        fontWeight: 800,
                        lineHeight: 1.05,
                        letterSpacing: '-0.02em',
                        color: GH.ink,
                        marginBottom: 16,
                    }}
                >
                    {isError ? 'Не удалось загрузить.' : 'Сначала нужна анкета.'}
                </div>
                <div style={{ fontSize: 15, color: GH.ink60, lineHeight: 1.5, maxWidth: 460, margin: '0 auto 24px' }}>
                    {isError
                        ? 'Проверьте интернет и попробуйте ещё раз.'
                        : 'Часы приёма привязаны к анкете специалиста, а у этого аккаунта её пока нет. Заполните анкету. Если ваша карточка уже есть на сайте, напишите администратору: он привяжет её к аккаунту.'}
                </div>
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                    {isError ? (
                        <button type="button" onClick={onRetryLookup} style={btn}>Повторить</button>
                    ) : (
                        <>
                            <Link to="/become-specialist" style={btn}>Заполнить анкету</Link>
                            <a href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" style={btnGhost}>
                                Написать администратору
                            </a>
                        </>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                fontFamily: GH_SANS,
                color: GH.ink,
                background: GH.paper,
                maxWidth: 1120,
                padding: narrow ? '20px 16px 24px' : undefined,
            }}
        >
            {/* ── Header ── */}
            <header
                style={{
                    borderBottom: GH_HAIRLINE_STRONG,
                    paddingBottom: 20,
                    marginBottom: 32,
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 16,
                }}
            >
                <div>
                    <div style={{ ...GH_MONO_LABEL, marginBottom: 8 }}>Раздел · Расписание</div>
                    <h1
                        style={{
                            fontSize: narrow ? 30 : 'clamp(36px, 4.5vw, 56px)',
                            fontWeight: 800,
                            lineHeight: 0.95,
                            letterSpacing: '-0.025em',
                            margin: 0,
                        }}
                    >
                        Моё расписание.
                    </h1>
                    <div style={{ fontSize: 15, color: GH.ink60, marginTop: 8, maxWidth: 520 }}>
                        Недельный шаблон: когда, где и в каком формате вы принимаете. Клиенты видят только то, что здесь отмечено.
                    </div>
                </div>

                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        background: GH.ink,
                        color: GH.paper,
                        border: 'none',
                        padding: '14px 24px',
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        transition: 'opacity 0.15s ease',
                    }}
                >
                    <Save size={14} />
                    {saving ? 'Сохранение…' : 'Сохранить'}
                </button>
            </header>

            {/* ── Weekly template section ── */}
            <section style={{ marginBottom: 56 }}>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: 16,
                    }}
                >
                    <h2 style={{ ...GH_MONO_LABEL, color: GH.ink }}>Недельный шаблон</h2>
                    <div style={{ ...GH_MONO_LABEL }}>
                        Активных дней: {String(days.filter(d => d.enabled).length).padStart(2, '0')} / 07
                    </div>
                </div>

                {/* Table header (на узком экране не нужен — строки-карточки) */}
                <div
                    style={{
                        display: narrow ? 'none' : 'grid',
                        gridTemplateColumns: '32px 60px 1.4fr 2.4fr',
                        gap: 0,
                        ...GH_MONO_LABEL,
                        borderTop: GH_HAIRLINE,
                        borderBottom: GH_HAIRLINE,
                        padding: '10px 0',
                    }}
                >
                    <div>#</div>
                    <div>Вкл</div>
                    <div>День</div>
                    <div>Время · локация</div>
                </div>

                {/* Rows */}
                {days.map((day, i) => (
                    <GridHouseDayRow
                        key={i}
                        index={i}
                        day={day}
                        narrow={narrow}
                        onUpdate={(patch) => updateDay(i, patch)}
                        onUpdateRange={(rangeIdx, patch) => updateRange(i, rangeIdx, patch)}
                        onAddRange={() => addRange(i)}
                        onRemoveRange={(rangeIdx) => removeRange(i, rangeIdx)}
                    />
                ))}
            </section>

            {/* ── Date-specific overrides ── */}
            <section style={{ marginBottom: 56 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
                    <h2 style={{ ...GH_MONO_LABEL, color: GH.ink }}>Исключения</h2>
                    <button
                        onClick={addOverride}
                        style={{
                            background: 'none',
                            border: GH_HAIRLINE_STRONG,
                            color: GH.ink,
                            padding: '6px 14px',
                            fontFamily: GH_MONO,
                            fontSize: 12,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                        }}
                    >
                        <Plus size={12} /> Добавить
                    </button>
                </div>

                {overrides.length === 0 ? (
                    <div style={{ border: GH_HAIRLINE, padding: '32px 24px', textAlign: 'center', ...GH_MONO_LABEL }}>
                        Отпуск, доп. дни или нестандартные часы · Переопределяют недельный шаблон
                    </div>
                ) : (
                    <div style={{ border: GH_HAIRLINE }}>
                        {/* Header */}
                        <div
                            style={{
                                display: narrow ? 'none' : 'grid',
                                gridTemplateColumns: '120px 180px 1fr 1fr 40px',
                                gap: 0,
                                ...GH_MONO_LABEL,
                                borderBottom: GH_HAIRLINE,
                                padding: '10px 16px',
                            }}
                        >
                            <div>Дата</div>
                            <div>Статус</div>
                            <div>Время</div>
                            <div>Локация</div>
                            <div></div>
                        </div>
                        {overrides.map((ov, i) => (
                            <GridHouseOverrideRow
                                key={i}
                                override={ov}
                                narrow={narrow}
                                onUpdate={(patch) => updateOverride(i, patch)}
                                onRemove={() => removeOverride(i)}
                                isLast={i === overrides.length - 1}
                            />
                        ))}
                    </div>
                )}
            </section>

            {/* На телефоне кнопка в шапке уезжает далеко вверх — дублируем
                её после редактируемых блоков. */}
            {narrow && (
                <button
                    onClick={handleSave}
                    disabled={saving}
                    style={{
                        width: '100%',
                        background: GH.ink,
                        color: GH.paper,
                        border: 'none',
                        padding: '16px 24px',
                        marginTop: -24,
                        marginBottom: 48,
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.5 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                    }}
                >
                    <Save size={14} />
                    {saving ? 'Сохранение…' : 'Сохранить расписание'}
                </button>
            )}

            {/* ── Upcoming appointments ── */}
            <section>
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: 16,
                    }}
                >
                    <h2 style={{ ...GH_MONO_LABEL, color: GH.ink }}>Предстоящие записи</h2>
                    <div style={GH_MONO_LABEL}>
                        Всего: {String(upcomingAppointments.length).padStart(2, '0')}
                    </div>
                </div>

                {upcomingAppointments.length === 0 ? (
                    <div
                        style={{
                            border: GH_HAIRLINE,
                            padding: '48px 24px',
                            textAlign: 'center',
                            ...GH_MONO_LABEL,
                        }}
                    >
                        Нет предстоящих записей
                    </div>
                ) : (
                    <div style={{ border: GH_HAIRLINE }}>
                        {/* Header */}
                        <div
                            style={{
                                display: narrow ? 'none' : 'grid',
                                gridTemplateColumns: '32px 88px 1.4fr 1fr 1fr 40px',
                                gap: 0,
                                ...GH_MONO_LABEL,
                                borderBottom: GH_HAIRLINE,
                                padding: '10px 16px',
                            }}
                        >
                            <div>#</div>
                            <div>Дата</div>
                            <div>Клиент</div>
                            <div>Время</div>
                            <div>Локация</div>
                            <div></div>
                        </div>

                        {upcomingAppointments.map((appt, i) => (
                            <div
                                key={appt.id}
                                style={{
                                    display: 'grid',
                                    // Узко: [дата | клиент | ×] над [время | локация]
                                    gridTemplateColumns: narrow ? '64px 1fr 32px' : '32px 88px 1.4fr 1fr 1fr 40px',
                                    gap: narrow ? '6px 8px' : 0,
                                    padding: '14px 16px',
                                    alignItems: 'center',
                                    borderBottom: i === upcomingAppointments.length - 1 ? 'none' : GH_HAIRLINE,
                                    fontSize: 14,
                                }}
                            >
                                <div
                                    style={{
                                        display: narrow ? 'none' : undefined,
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        color: GH.ink60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                                <div
                                    style={{
                                        gridColumn: narrow ? 1 : undefined,
                                        gridRow: narrow ? 1 : undefined,
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        fontVariantNumeric: 'tabular-nums',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {formatDayMonth(appt.date)}
                                </div>
                                <div style={narrow ? { gridColumn: 2, gridRow: 1, minWidth: 0 } : undefined}>
                                    <div style={{ fontWeight: 600, color: GH.ink }}>{appt.clientName}</div>
                                    {appt.clientPhone && (
                                        <div
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 12,
                                                color: GH.ink60,
                                                marginTop: 2,
                                            }}
                                        >
                                            {appt.clientPhone}
                                        </div>
                                    )}
                                    {/* Контакт записи с сайта: e-mail и Telegram (он приходит в заметке
                                        «Telegram: @…», если клиент не оставил телефон). */}
                                    {appt.clientEmail && (
                                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2, overflowWrap: 'anywhere' }}>
                                            {appt.clientEmail}
                                        </div>
                                    )}
                                    {appt.notes && (
                                        <div style={{ fontSize: 12, color: GH.ink60, marginTop: 2, overflowWrap: 'anywhere' }}>
                                            {appt.notes}
                                        </div>
                                    )}
                                </div>
                                <div
                                    style={{
                                        gridColumn: narrow ? 1 : undefined,
                                        gridRow: narrow ? 2 : undefined,
                                        fontFamily: GH_MONO,
                                        fontSize: 13,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {appt.startTime}
                                </div>
                                <div
                                    style={{
                                        gridColumn: narrow ? 2 : undefined,
                                        gridRow: narrow ? 2 : undefined,
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        color: GH.ink60,
                                    }}
                                >
                                    {appt.locationId ? LOCATIONS.find(l => l.id === appt.locationId)?.name || appt.locationId : 'Онлайн'}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gridColumn: narrow ? 3 : undefined, gridRow: narrow ? 1 : undefined }}>
                                    <button
                                        onClick={() => onCancelAppt(appt.id)}
                                        title="Отменить запись"
                                        aria-label="Отменить запись"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: GH.ink60,
                                            cursor: 'pointer',
                                            padding: 4,
                                            display: 'flex',
                                            alignItems: 'center',
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

// ── Single day row ──
function GridHouseDayRow({
    index,
    day,
    narrow,
    onUpdate,
    onUpdateRange,
    onAddRange,
    onRemoveRange,
}: {
    index: number;
    day: DaySchedule;
    narrow: boolean;
    onUpdate: (patch: Partial<DaySchedule>) => void;
    onUpdateRange: (rangeIdx: number, patch: Partial<DayRange>) => void;
    onAddRange: () => void;
    onRemoveRange: (rangeIdx: number) => void;
}) {
    const enabled = day.enabled;
    const hasMultiple = day.ranges.length > 1;
    return (
        <div
            style={{
                display: 'grid',
                // Узко: [тумблер | день | «Выходной»], часы включённого дня —
                // отдельной строкой во всю ширину
                gridTemplateColumns: narrow ? '56px 1fr auto' : '32px 60px 1.4fr 2.4fr',
                gap: narrow ? '10px 0' : 0,
                padding: '16px 0',
                alignItems: 'flex-start',
                borderBottom: GH_HAIRLINE,
                opacity: enabled ? 1 : 0.6,
                background: enabled ? 'transparent' : GH.ink5,
                transition: 'opacity 0.15s ease, background 0.15s ease',
            }}
        >
            {/* # */}
            <div
                style={{
                    display: narrow ? 'none' : undefined,
                    fontFamily: GH_MONO,
                    fontSize: 12,
                    color: GH.ink60,
                    fontVariantNumeric: 'tabular-nums',
                    paddingTop: 6,
                }}
            >
                {String(index + 1).padStart(2, '0')}
            </div>

            {/* Toggle */}
            <div style={{ paddingTop: 4 }}>
                <button
                    onClick={() => onUpdate({ enabled: !enabled })}
                    style={{
                        width: 40,
                        height: 22,
                        border: `1px solid ${GH.ink}`,
                        background: enabled ? GH.ink : GH.paper,
                        position: 'relative',
                        cursor: 'pointer',
                        padding: 0,
                        transition: 'background 0.15s ease',
                    }}
                    aria-label={enabled ? 'Выключить день' : 'Включить день'}
                >
                    <div
                        style={{
                            position: 'absolute',
                            top: 2,
                            left: enabled ? 21 : 2,
                            width: 15,
                            height: 16,
                            background: enabled ? GH.paper : GH.ink,
                            transition: 'left 0.15s ease',
                        }}
                    />
                </button>
            </div>

            {/* Day label */}
            <div
                style={{
                    fontSize: 16,
                    fontWeight: enabled ? 600 : 500,
                    color: GH.ink,
                    paddingTop: 4,
                }}
            >
                {GH_DOW_LABELS[index]}
            </div>

            {/* Range list (time + location) — one row per range. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, gridColumn: narrow && enabled ? '1 / -1' : undefined }}>
                {enabled ? (
                    <>
                        {day.ranges.map((range, ri) => (
                            <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <input
                                    type="time"
                                    value={range.start_time}
                                    onChange={e => onUpdateRange(ri, { start_time: e.target.value })}
                                    style={narrow ? { ...GH_TIME_INPUT, width: 100 } : GH_TIME_INPUT}
                                />
                                <span aria-hidden="true" style={{ color: GH.ink60, fontFamily: GH_MONO, fontSize: 12 }}>—</span>
                                <input
                                    type="time"
                                    value={range.end_time}
                                    onChange={e => onUpdateRange(ri, { end_time: e.target.value })}
                                    style={narrow ? { ...GH_TIME_INPUT, width: 100 } : GH_TIME_INPUT}
                                />
                                <select
                                    value={range.location_id}
                                    onChange={e => onUpdateRange(ri, { location_id: e.target.value })}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        border: 'none',
                                        borderBottom: `1px solid ${GH.ink30}`,
                                        background: 'transparent',
                                        padding: '4px 2px',
                                        color: GH.ink,
                                        outline: 'none',
                                        flex: 1,
                                        minWidth: 120,
                                        // Узко: локация своей строкой под временем
                                        flexBasis: narrow ? '100%' : undefined,
                                        order: narrow ? 2 : undefined,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {LOCATION_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                                {hasMultiple && (
                                    <button
                                        onClick={() => onRemoveRange(ri)}
                                        title="Убрать этот диапазон"
                                        style={{
                                            width: 28,
                                            height: 28,
                                            border: 'none',
                                            background: 'transparent',
                                            color: GH.ink60,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                        }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {/* Add-range button: separate row so it doesn't collide with locations. */}
                        <button
                            onClick={onAddRange}
                            style={{
                                alignSelf: 'flex-start',
                                background: 'none',
                                border: `1px dashed ${GH.ink30}`,
                                color: GH.ink60,
                                padding: '4px 10px',
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                marginTop: 2,
                            }}
                        >
                            <Plus size={12} /> Диапазон
                        </button>
                    </>
                ) : (
                    <div style={{ ...GH_MONO_LABEL, paddingTop: 6 }}>Выходной</div>
                )}
            </div>
        </div>
    );
}

const GH_TIME_INPUT: React.CSSProperties = {
    fontFamily: GH_MONO,
    fontSize: 13,
    border: 'none',
    borderBottom: `1px solid ${GH.ink30}`,
    background: 'transparent',
    padding: '4px 2px',
    color: GH.ink,
    outline: 'none',
    width: 82,
    fontVariantNumeric: 'tabular-nums',
};

/** Add `n` hours to an "HH:MM" string, clamped to 22:00 so we never seed
 *  a new range past business close. Used by addRange() to suggest a sane
 *  start for the next chunk after the previous one ends. */
function bumpHour(t: string, n: number): string {
    const [h, m] = t.split(':').map(Number);
    const next = Math.min(22, Math.max(0, (isFinite(h) ? h : 10) + n));
    return `${String(next).padStart(2, '0')}:${String(isFinite(m) ? m : 0).padStart(2, '0')}`;
}

// ── Single override row (Grid House) ──
function GridHouseOverrideRow({
    override,
    narrow,
    onUpdate,
    onRemove,
    isLast,
}: {
    override: OverrideEntry;
    narrow: boolean;
    onUpdate: (patch: Partial<OverrideEntry>) => void;
    onRemove: () => void;
    isLast: boolean;
}) {
    const { is_available } = override;
    return (
        <div
            style={{
                display: 'grid',
                // Узко: [дата | ×], ниже во всю ширину статус, время, локация
                gridTemplateColumns: narrow ? '1fr 40px' : '120px 180px 1fr 1fr 40px',
                gap: narrow ? '10px 0' : 0,
                padding: '12px 16px',
                alignItems: 'center',
                borderBottom: isLast ? 'none' : GH_HAIRLINE,
                background: is_available ? 'transparent' : GH.ink5,
                transition: 'background 0.15s ease',
            }}
        >
            {/* Date */}
            <input
                type="date"
                value={override.specific_date}
                onChange={(e) => onUpdate({ specific_date: e.target.value })}
                style={{
                    gridColumn: narrow ? 1 : undefined,
                    gridRow: narrow ? 1 : undefined,
                    fontFamily: GH_MONO,
                    fontSize: 12,
                    border: 'none',
                    borderBottom: GH_HAIRLINE,
                    background: 'transparent',
                    padding: '4px 2px',
                    color: GH.ink,
                    outline: 'none',
                    width: '100%',
                    cursor: 'pointer',
                }}
            />

            {/* Status toggle */}
            <div style={{ display: 'flex', gap: 4, gridColumn: narrow ? '1 / -1' : undefined }}>
                <button
                    onClick={() => onUpdate({ is_available: false })}
                    style={{
                        flex: 1,
                        padding: '6px 10px',
                        border: !is_available ? GH_HAIRLINE_STRONG : GH_HAIRLINE,
                        background: !is_available ? GH.ink : 'transparent',
                        color: !is_available ? GH.paper : GH.ink60,
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        cursor: 'pointer',
                    }}
                >
                    Выходной
                </button>
                <button
                    onClick={() => onUpdate({ is_available: true })}
                    style={{
                        flex: 1,
                        padding: '6px 10px',
                        border: is_available ? GH_HAIRLINE_STRONG : GH_HAIRLINE,
                        background: is_available ? GH.ink : 'transparent',
                        color: is_available ? GH.paper : GH.ink60,
                        fontFamily: GH_MONO,
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        cursor: 'pointer',
                    }}
                >
                    Работаю
                </button>
            </div>

            {/* Time range */}
            <div style={{ display: narrow && !is_available ? 'none' : 'flex', gap: 8, alignItems: 'center', gridColumn: narrow ? '1 / -1' : undefined }}>
                {is_available ? (
                    <>
                        <input
                            type="time"
                            value={override.start_time}
                            onChange={(e) => onUpdate({ start_time: e.target.value })}
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                border: 'none',
                                borderBottom: GH_HAIRLINE,
                                background: 'transparent',
                                padding: '4px 2px',
                                color: GH.ink,
                                outline: 'none',
                                width: narrow ? 100 : 70,
                            }}
                        />
                        <span aria-hidden="true" style={{ color: GH.ink60, fontFamily: GH_MONO, fontSize: 12 }}>—</span>
                        <input
                            type="time"
                            value={override.end_time}
                            onChange={(e) => onUpdate({ end_time: e.target.value })}
                            style={{
                                fontFamily: GH_MONO,
                                fontSize: 12,
                                border: 'none',
                                borderBottom: GH_HAIRLINE,
                                background: 'transparent',
                                padding: '4px 2px',
                                color: GH.ink,
                                outline: 'none',
                                width: narrow ? 100 : 70,
                            }}
                        />
                    </>
                ) : (
                    <span style={{ ...GH_MONO_LABEL }}>—</span>
                )}
            </div>

            {/* Location */}
            <div style={narrow ? { gridColumn: '1 / -1', display: is_available ? undefined : 'none' } : undefined}>
                {is_available ? (
                    <select
                        value={override.location_id}
                        onChange={(e) => onUpdate({ location_id: e.target.value })}
                        style={{
                            fontFamily: GH_MONO,
                            fontSize: 12,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            border: 'none',
                            borderBottom: GH_HAIRLINE,
                            background: 'transparent',
                            padding: '4px 2px',
                            color: GH.ink,
                            outline: 'none',
                            width: '100%',
                            cursor: 'pointer',
                        }}
                    >
                        {LOCATION_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                ) : (
                    <span style={{ ...GH_MONO_LABEL }}>—</span>
                )}
            </div>

            {/* Remove */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gridColumn: narrow ? 2 : undefined, gridRow: narrow ? 1 : undefined }}>
                <button
                    onClick={onRemove}
                    title="Удалить"
                    aria-label="Удалить исключение"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: GH.ink60,
                        cursor: 'pointer',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                    }}
                >
                    <Trash2 size={14} />
                </button>
            </div>
        </div>
    );
}
