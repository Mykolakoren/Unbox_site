import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type ScheduleSlot, type Appointment } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { useUserStore } from '../../store/userStore';
import { api } from '../../api/client';
import { Clock, Save, Loader2, Trash2, Calendar, MapPin, Video, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

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
