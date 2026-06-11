import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type ScheduleSlot, type Appointment } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { Clock, Save, Loader2, Trash2, Calendar, MapPin, Video, User, Plus, CalendarOff } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

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

export function CrmSchedule() {
    const currentUser = useUserStore(s => s.currentUser);
        const [specialistId, setSpecialistId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [days, setDays] = useState<DaySchedule[]>(Array(7).fill(null).map(DEFAULT_DAY));
    const [overrides, setOverrides] = useState<OverrideEntry[]>([]);
    const [appointments, setAppointments] = useState<Appointment[]>([]);

    // Find specialist ID for current user.
    // The shared axios interceptor converts every API response from
    // snake_case to camelCase before returning, so `Specialist.user_id`
    // arrives here as `userId`. Earlier code matched on `s.user_id`
    // and always missed — Mykola (owner, has anketa) saw the empty
    // "Аккаунт не привязан к анкете" placeholder. We check both keys
    // defensively in case any future call bypasses the interceptor.
    useEffect(() => {
        if (!currentUser) return;
        const targetId = String(currentUser.id);
        const matchUser = (s: any) => (s?.userId ?? s?.user_id) === targetId;
        api.get('/specialists/admin/all').then(r => {
            const spec = r.data.find(matchUser);
            if (spec) {
                setSpecialistId(spec.id);
            } else {
                // Try verified public list
                api.get('/specialists/').then(r2 => {
                    const spec2 = r2.data.find(matchUser);
                    if (spec2) setSpecialistId(spec2.id);
                }).catch(() => {});
            }
        }).catch(() => {});
    }, [currentUser]);

    // Load schedule
    useEffect(() => {
        if (!specialistId) { setLoading(false); return; }
        setLoading(true);
        Promise.all([
            specialistsApi.getSchedule(specialistId),
            specialistsApi.getAppointments(specialistId).catch(() => []),
        ]).then(([schedule, appts]) => {
            // Group weekly slots by day_of_week so the same day can hold
            // multiple ranges (e.g. Mon 10:00–13:00 + 16:00–20:00).
            const newDays: DaySchedule[] = Array(7).fill(null).map(DEFAULT_DAY);
            const haveAnyRange = Array(7).fill(false);
            const newOverrides: OverrideEntry[] = [];
            schedule.forEach(slot => {
                if (slot.specific_date) {
                    newOverrides.push({
                        specific_date: slot.specific_date,
                        is_available: slot.is_available,
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        location_id: slot.location_id || '__online__',
                    });
                } else if (slot.day_of_week != null && slot.day_of_week >= 0 && slot.day_of_week <= 6) {
                    const dow = slot.day_of_week;
                    const range: DayRange = {
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        location_id: slot.location_id || '__online__',
                    };
                    if (!haveAnyRange[dow]) {
                        newDays[dow] = { enabled: slot.is_available, ranges: [range] };
                        haveAnyRange[dow] = true;
                    } else {
                        newDays[dow].ranges.push(range);
                        if (slot.is_available) newDays[dow].enabled = true;
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
            toast.error('Не удалось загрузить расписание');
        }).finally(() => setLoading(false));
    }, [specialistId]);

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
                        day_of_week: i,
                        specific_date: null,
                        start_time: r.start_time,
                        end_time: r.end_time,
                        location_id: r.location_id === '__online__' ? null : r.location_id,
                        is_available: d.enabled,
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
            const overrideSlots: Omit<ScheduleSlot, 'id'>[] = Array.from(byDate.values()).map(o => ({
                day_of_week: null,
                specific_date: o.specific_date,
                start_time: o.is_available ? o.start_time : '00:00',
                end_time: o.is_available ? o.end_time : '00:00',
                location_id: o.location_id === '__online__' ? null : o.location_id,
                is_available: o.is_available,
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
            .sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
    }, [appointments]);

    if (!currentUser) return null;

    // ─── Grid House variant (behind feature flag) ────────────────────────
    return (

            <GridHouseCrmSchedule
                loading={loading}
                specialistId={specialistId}
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
                    if (!window.confirm('Отменить запись?')) return;
                    try {
                        await specialistsApi.cancelAppointment(specialistId, id);
                        setAppointments(prev => prev.map(a => a.id === id ? { ...a, status: 'cancelled' } : a));
                        toast.success('Запись отменена');
                    } catch {
                        toast.error('Ошибка');
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
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.18em',
    color: GH.ink60,
};
const GH_DOW_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

interface GridHouseCrmScheduleProps {
    loading: boolean;
    specialistId: string | null;
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
    if (loading) {
        return (
            <div
                style={{
                    fontFamily: GH_MONO,
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.18em',
                    color: GH.ink30,
                    padding: '80px 0',
                    textAlign: 'center',
                }}
            >
                Загрузка расписания…
            </div>
        );
    }

    if (!specialistId) {
        return (
            <div
                style={{
                    border: GH_HAIRLINE,
                    padding: '56px 32px',
                    background: GH.paper,
                    fontFamily: GH_SANS,
                    textAlign: 'center',
                }}
            >
                <div style={{ ...GH_MONO_LABEL, marginBottom: 16 }}>Нет привязки</div>
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
                    Аккаунт не привязан к анкете.
                </div>
                <div style={{ fontSize: 15, color: GH.ink60, lineHeight: 1.5, maxWidth: 460, margin: '0 auto' }}>
                    Обратитесь к администратору — он свяжет ваш пользовательский профиль с карточкой специалиста в разделе
                    {' '}Admin · Специалисты.
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
                            fontSize: 'clamp(36px, 4.5vw, 56px)',
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
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.18em',
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

                {/* Table header */}
                <div
                    style={{
                        display: 'grid',
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
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.18em',
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
                                display: 'grid',
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
                                onUpdate={(patch) => updateOverride(i, patch)}
                                onRemove={() => removeOverride(i)}
                                isLast={i === overrides.length - 1}
                            />
                        ))}
                    </div>
                )}
            </section>

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
                                display: 'grid',
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
                                    gridTemplateColumns: '32px 88px 1.4fr 1fr 1fr 40px',
                                    gap: 0,
                                    padding: '14px 16px',
                                    alignItems: 'center',
                                    borderBottom: i === upcomingAppointments.length - 1 ? 'none' : GH_HAIRLINE,
                                    fontSize: 14,
                                }}
                            >
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 11,
                                        color: GH.ink60,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {String(i + 1).padStart(2, '0')}
                                </div>
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        fontVariantNumeric: 'tabular-nums',
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {format(new Date(appt.date + 'T00:00'), 'dd MMM', { locale: ru })}
                                </div>
                                <div>
                                    <div style={{ fontWeight: 600, color: GH.ink }}>{appt.client_name}</div>
                                    {appt.client_phone && (
                                        <div
                                            style={{
                                                fontFamily: GH_MONO,
                                                fontSize: 11,
                                                color: GH.ink60,
                                                marginTop: 2,
                                            }}
                                        >
                                            {appt.client_phone}
                                        </div>
                                    )}
                                </div>
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 13,
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {appt.start_time}
                                </div>
                                <div
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 11,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        color: GH.ink60,
                                    }}
                                >
                                    {appt.location_id ? LOCATIONS.find(l => l.id === appt.location_id)?.name || appt.location_id : 'Онлайн'}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                    <button
                                        onClick={() => onCancelAppt(appt.id)}
                                        title="Отменить запись"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            color: GH.ink30,
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
    onUpdate,
    onUpdateRange,
    onAddRange,
    onRemoveRange,
}: {
    index: number;
    day: DaySchedule;
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
                gridTemplateColumns: '32px 60px 1.4fr 2.4fr',
                gap: 0,
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
                    fontFamily: GH_MONO,
                    fontSize: 11,
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {enabled ? (
                    <>
                        {day.ranges.map((range, ri) => (
                            <div key={ri} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <input
                                    type="time"
                                    value={range.start_time}
                                    onChange={e => onUpdateRange(ri, { start_time: e.target.value })}
                                    style={GH_TIME_INPUT}
                                />
                                <span style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 12 }}>—</span>
                                <input
                                    type="time"
                                    value={range.end_time}
                                    onChange={e => onUpdateRange(ri, { end_time: e.target.value })}
                                    style={GH_TIME_INPUT}
                                />
                                <select
                                    value={range.location_id}
                                    onChange={e => onUpdateRange(ri, { location_id: e.target.value })}
                                    style={{
                                        fontFamily: GH_MONO,
                                        fontSize: 12,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.1em',
                                        border: 'none',
                                        borderBottom: `1px solid ${GH.ink30}`,
                                        background: 'transparent',
                                        padding: '4px 2px',
                                        color: GH.ink,
                                        outline: 'none',
                                        flex: 1,
                                        minWidth: 120,
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
                                fontSize: 10,
                                fontWeight: 600,
                                textTransform: 'uppercase',
                                letterSpacing: '0.18em',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                marginTop: 2,
                            }}
                        >
                            <Plus size={11} /> Диапазон
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
    onUpdate,
    onRemove,
    isLast,
}: {
    override: OverrideEntry;
    onUpdate: (patch: Partial<OverrideEntry>) => void;
    onRemove: () => void;
    isLast: boolean;
}) {
    const { is_available } = override;
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '120px 180px 1fr 1fr 40px',
                gap: 0,
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
            <div style={{ display: 'flex', gap: 4 }}>
                <button
                    onClick={() => onUpdate({ is_available: false })}
                    style={{
                        flex: 1,
                        padding: '6px 10px',
                        border: !is_available ? GH_HAIRLINE_STRONG : GH_HAIRLINE,
                        background: !is_available ? GH.ink : 'transparent',
                        color: !is_available ? GH.paper : GH.ink60,
                        fontFamily: GH_MONO,
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
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
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.1em',
                        cursor: 'pointer',
                    }}
                >
                    Работаю
                </button>
            </div>

            {/* Time range */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                                width: 70,
                            }}
                        />
                        <span style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 12 }}>—</span>
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
                                width: 70,
                            }}
                        />
                    </>
                ) : (
                    <span style={{ ...GH_MONO_LABEL }}>—</span>
                )}
            </div>

            {/* Location */}
            <div>
                {is_available ? (
                    <select
                        value={override.location_id}
                        onChange={(e) => onUpdate({ location_id: e.target.value })}
                        style={{
                            fontFamily: GH_MONO,
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
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
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={onRemove}
                    title="Удалить"
                    style={{
                        background: 'none',
                        border: 'none',
                        color: GH.ink30,
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
