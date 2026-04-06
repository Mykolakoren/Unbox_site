import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type ScheduleSlot, type Appointment } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { Clock, Save, Loader2, Trash2, Calendar, MapPin, Video, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useDesignFlag, GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';

const DOW_LABELS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const LOCATION_OPTIONS = [
    { value: '__online__', label: 'Онлайн', icon: Video },
    ...LOCATIONS.filter(l => l.id !== 'neo_school').map(l => ({ value: l.id, label: l.name, icon: MapPin })),
];

interface DaySchedule {
    enabled: boolean;
    start_time: string;
    end_time: string;
    location_id: string; // "__online__" or location id
}

const DEFAULT_DAY: DaySchedule = { enabled: false, start_time: '10:00', end_time: '18:00', location_id: 'unbox_uni' };

export function CrmSchedule() {
    const currentUser = useUserStore(s => s.currentUser);
    const gridHouse = useDesignFlag();
    const [specialistId, setSpecialistId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [days, setDays] = useState<DaySchedule[]>(Array(7).fill(null).map(() => ({ ...DEFAULT_DAY })));
    const [appointments, setAppointments] = useState<Appointment[]>([]);

    // Find specialist ID for current user
    useEffect(() => {
        if (!currentUser) return;
        api.get('/specialists/admin/all').then(r => {
            const spec = r.data.find((s: any) => s.user_id === String(currentUser.id));
            if (spec) {
                setSpecialistId(spec.id);
            } else {
                // Try verified public list
                api.get('/specialists/').then(r2 => {
                    const spec2 = r2.data.find((s: any) => s.user_id === String(currentUser.id));
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
            // Map schedule to days
            const newDays = Array(7).fill(null).map(() => ({ ...DEFAULT_DAY }));
            schedule.forEach(slot => {
                if (slot.day_of_week != null && slot.day_of_week >= 0 && slot.day_of_week <= 6) {
                    newDays[slot.day_of_week] = {
                        enabled: slot.is_available,
                        start_time: slot.start_time,
                        end_time: slot.end_time,
                        location_id: slot.location_id || '__online__',
                    };
                }
            });
            setDays(newDays);
            setAppointments(appts);
        }).catch(() => {
            toast.error('Не удалось загрузить расписание');
        }).finally(() => setLoading(false));
    }, [specialistId]);

    const handleSave = async () => {
        if (!specialistId) return;
        setSaving(true);
        try {
            const slots: Omit<ScheduleSlot, 'id'>[] = days.map((d, i) => ({
                day_of_week: i,
                specific_date: null,
                start_time: d.start_time,
                end_time: d.end_time,
                location_id: d.location_id === '__online__' ? null : d.location_id,
                is_available: d.enabled,
            }));
            await specialistsApi.updateSchedule(specialistId, slots);
            toast.success('Расписание сохранено');
        } catch {
            toast.error('Ошибка при сохранении');
        } finally {
            setSaving(false);
        }
    };

    const updateDay = (i: number, patch: Partial<DaySchedule>) => {
        setDays(prev => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
    };

    const upcomingAppointments = useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        return appointments
            .filter(a => a.status === 'confirmed' && a.date >= today)
            .sort((a, b) => `${a.date}${a.start_time}`.localeCompare(`${b.date}${b.start_time}`));
    }, [appointments]);

    if (!currentUser) return null;

    // ─── Grid House variant (behind feature flag) ────────────────────────
    if (gridHouse) {
        return (
            <GridHouseCrmSchedule
                loading={loading}
                specialistId={specialistId}
                days={days}
                updateDay={updateDay}
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

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20 text-unbox-dark/40">
                <Loader2 size={24} className="animate-spin" />
            </div>
        );
    }

    if (!specialistId) {
        return (
            <div className="text-center py-20">
                <Clock size={48} className="mx-auto text-unbox-dark/20 mb-3" />
                <p className="text-unbox-dark/40 text-sm">Ваш аккаунт не привязан к анкете специалиста.</p>
                <p className="text-unbox-dark/40 text-xs mt-1">Обратитесь к администратору.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-unbox-dark">Моё расписание</h1>
                    <p className="text-unbox-dark/60 text-sm">Настройте дни и время приёма клиентов</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-unbox-green text-white rounded-xl font-medium text-sm hover:bg-unbox-dark transition-colors shadow-md disabled:opacity-50"
                >
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    Сохранить
                </button>
            </div>

            {/* Weekly schedule */}
            <div className="bg-white rounded-xl border border-unbox-light shadow-sm overflow-hidden">
                <div className="p-4 border-b border-unbox-light bg-unbox-light/30">
                    <h2 className="font-bold text-sm text-unbox-dark flex items-center gap-2">
                        <Calendar size={16} /> Недельное расписание
                    </h2>
                </div>

                <div className="divide-y divide-unbox-light">
                    {days.map((day, i) => (
                        <div key={i} className={`flex items-center gap-4 px-5 py-3 transition-colors ${day.enabled ? 'bg-white' : 'bg-gray-50/50'}`}>
                            {/* Toggle */}
                            <button
                                onClick={() => updateDay(i, { enabled: !day.enabled })}
                                className={`w-10 h-6 rounded-full relative transition-colors ${day.enabled ? 'bg-unbox-green' : 'bg-gray-300'}`}
                            >
                                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${day.enabled ? 'left-[18px]' : 'left-0.5'}`} />
                            </button>

                            {/* Day label */}
                            <div className="w-28 text-sm font-medium text-unbox-dark">
                                {DOW_LABELS[i]}
                            </div>

                            {day.enabled ? (
                                <>
                                    {/* Time range */}
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="time"
                                            value={day.start_time}
                                            onChange={e => updateDay(i, { start_time: e.target.value })}
                                            className="px-2 py-1 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                        />
                                        <span className="text-unbox-dark/40">—</span>
                                        <input
                                            type="time"
                                            value={day.end_time}
                                            onChange={e => updateDay(i, { end_time: e.target.value })}
                                            className="px-2 py-1 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                        />
                                    </div>

                                    {/* Location */}
                                    <select
                                        value={day.location_id}
                                        onChange={e => updateDay(i, { location_id: e.target.value })}
                                        className="px-3 py-1.5 rounded-lg border border-unbox-light text-sm focus:outline-none focus:ring-2 focus:ring-unbox-green/50"
                                    >
                                        {LOCATION_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </>
                            ) : (
                                <span className="text-sm text-unbox-dark/40">Выходной</span>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {/* Upcoming appointments */}
            <div className="bg-white rounded-xl border border-unbox-light shadow-sm overflow-hidden">
                <div className="p-4 border-b border-unbox-light bg-unbox-light/30">
                    <h2 className="font-bold text-sm text-unbox-dark flex items-center gap-2">
                        <User size={16} /> Предстоящие записи ({upcomingAppointments.length})
                    </h2>
                </div>

                {upcomingAppointments.length === 0 ? (
                    <div className="text-center py-10 text-unbox-dark/40 text-sm">
                        Нет предстоящих записей
                    </div>
                ) : (
                    <div className="divide-y divide-unbox-light">
                        {upcomingAppointments.map(appt => (
                            <div key={appt.id} className="flex items-center justify-between px-5 py-3">
                                <div className="flex items-center gap-4">
                                    <div className="text-center bg-unbox-light rounded-lg px-3 py-1.5">
                                        <div className="text-[10px] uppercase text-unbox-dark/50">
                                            {format(new Date(appt.date + 'T00:00'), 'EEE', { locale: ru })}
                                        </div>
                                        <div className="text-lg font-bold text-unbox-dark">
                                            {format(new Date(appt.date + 'T00:00'), 'd', { locale: ru })}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-medium text-sm text-unbox-dark">{appt.client_name}</div>
                                        <div className="text-xs text-unbox-dark/50">
                                            {appt.start_time} · {appt.location_id ? LOCATIONS.find(l => l.id === appt.location_id)?.name : 'Онлайн'}
                                            {appt.client_phone && ` · ${appt.client_phone}`}
                                        </div>
                                    </div>
                                </div>
                                <button
                                    onClick={async () => {
                                        if (!window.confirm('Отменить запись?')) return;
                                        try {
                                            await specialistsApi.cancelAppointment(specialistId!, appt.id);
                                            setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: 'cancelled' } : a));
                                            toast.success('Запись отменена');
                                        } catch {
                                            toast.error('Ошибка');
                                        }
                                    }}
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-unbox-dark/30 hover:text-red-500 transition-colors"
                                    title="Отменить"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
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
                        gridTemplateColumns: '32px 60px 1.4fr 1fr 1fr',
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
                    <div>Время</div>
                    <div>Локация</div>
                </div>

                {/* Rows */}
                {days.map((day, i) => (
                    <GridHouseDayRow key={i} index={i} day={day} onUpdate={(patch) => updateDay(i, patch)} />
                ))}
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
}: {
    index: number;
    day: DaySchedule;
    onUpdate: (patch: Partial<DaySchedule>) => void;
}) {
    const enabled = day.enabled;
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: '32px 60px 1.4fr 1fr 1fr',
                gap: 0,
                padding: '16px 0',
                alignItems: 'center',
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
                }}
            >
                {String(index + 1).padStart(2, '0')}
            </div>

            {/* Toggle */}
            <div>
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
                }}
            >
                {GH_DOW_LABELS[index]}
            </div>

            {/* Time range */}
            <div>
                {enabled ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                            type="time"
                            value={day.start_time}
                            onChange={e => onUpdate({ start_time: e.target.value })}
                            style={{
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
                            }}
                        />
                        <span style={{ color: GH.ink30, fontFamily: GH_MONO, fontSize: 12 }}>—</span>
                        <input
                            type="time"
                            value={day.end_time}
                            onChange={e => onUpdate({ end_time: e.target.value })}
                            style={{
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
                            }}
                        />
                    </div>
                ) : (
                    <div style={{ ...GH_MONO_LABEL }}>Выходной</div>
                )}
            </div>

            {/* Location select */}
            <div>
                {enabled ? (
                    <select
                        value={day.location_id}
                        onChange={e => onUpdate({ location_id: e.target.value })}
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
                            width: '100%',
                            cursor: 'pointer',
                        }}
                    >
                        {LOCATION_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                ) : (
                    <div style={GH_MONO_LABEL}>—</div>
                )}
            </div>
        </div>
    );
}
