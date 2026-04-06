// ──────────────────────────────────────────────────────────────────────
// Grid House — эксперимент направления A.
// Чтобы откатить: удалите этот файл и уберите тоггл в SpecialistProfilePage.
// Переключение: ?design=grid в URL.
// Референс: Vignelli NYC Subway (1972), Bierut Yale Architecture posters.
// ──────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo } from 'react';
import { specialistsApi, type AvailableSlot, type AppointmentCreate } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

interface Props {
    specialistId: string;
    specialistName: string;
    formats: string[];
    basePriceGel: number;
}

// ── Grid House tokens (локальные, не трогают index.css) ──
const GH = {
    ink: '#0F0F10',
    paper: '#FAFAF7',
    ink5: 'rgba(15,15,16,0.05)',
    ink8: 'rgba(15,15,16,0.08)',
    ink10: 'rgba(15,15,16,0.10)',
    ink30: 'rgba(15,15,16,0.30)',
    ink60: 'rgba(15,15,16,0.60)',
    cellDead: '#F6F2E8',
    accent: '#476D6B',
};

const SANS = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

// 30-минутный шаг, с 09:00 до 21:00
const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => {
    const h = 9 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}).filter(t => t < '21:00');

const DOW_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const getLocationMark = (locId: string | null): string => {
    if (!locId) return 'O';
    if (locId === 'unbox_one') return '1';
    if (locId === 'unbox_uni') return 'U';
    if (locId === 'neo_school') return 'N';
    return '•';
};

export function SpecialistBookingChessboardGrid({ specialistId, formats, basePriceGel }: Props) {
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [locationFilter, setLocationFilter] = useState<string | null | 'all'>('all');
    const [slots, setSlots] = useState<AvailableSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
    const [bookingForm, setBookingForm] = useState({ name: '', phone: '', email: '' });
    const [submitting, setSubmitting] = useState(false);

    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const [mobileDate, setMobileDate] = useState(new Date());

    useEffect(() => {
        const check = () => setIsMobile(window.innerWidth < 768);
        window.addEventListener('resize', check);
        return () => window.removeEventListener('resize', check);
    }, []);

    const weekDays = useMemo(
        () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
        [weekStart]
    );

    const dateFrom = format(weekDays[0], 'yyyy-MM-dd');
    const dateTo = format(weekDays[6], 'yyyy-MM-dd');

    // ── Mock mode for design preview (URL ?mock=1) — remove after review ──
    const useMock = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1';

    useEffect(() => {
        setLoading(true);
        if (useMock) {
            // Realistic mock: weekdays 10:00-18:00 continuous, minus a few "booked" gaps
            const fake: AvailableSlot[] = [];
            const locationsByDay: (string | null)[] = ['unbox_one', 'unbox_uni', null, 'unbox_one', 'unbox_uni'];
            // Slots that are "already booked" and should NOT appear
            const booked = new Set([
                '0|11:00', '0|14:00', // day index | start_time
                '1|10:00', '1|15:00',
                '2|12:00', '2|16:00',
                '3|13:00',
                '4|10:00', '4|17:00',
            ]);
            for (let i = 0; i < 7; i++) {
                const d = addDays(new Date(dateFrom + 'T00:00'), i);
                const dow = (d.getDay() + 6) % 7; // 0=Mon
                if (dow >= 5) continue; // weekends off
                const dayLocation = locationsByDay[dow];
                // Generate hourly slots 10:00 through 18:00
                for (let h = 10; h <= 18; h++) {
                    const start = `${String(h).padStart(2, '0')}:00`;
                    if (booked.has(`${dow}|${start}`)) continue;
                    fake.push({
                        date: format(d, 'yyyy-MM-dd'),
                        start_time: start,
                        end_time: `${String(h + 1).padStart(2, '0')}:00`,
                        location_id: dayLocation,
                    });
                }
            }
            const locParam = locationFilter === 'all' ? undefined : locationFilter;
            const filtered = locParam === undefined || locParam === 'all' ? fake : fake.filter(s => s.location_id === locParam);
            setSlots(filtered);
            setLoading(false);
            return;
        }
        const locParam = locationFilter === 'all' ? undefined : locationFilter;
        specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo, locParam)
            .then(setSlots)
            .catch(() => setSlots([]))
            .finally(() => setLoading(false));
    }, [specialistId, dateFrom, dateTo, locationFilter, useMock]);

    const slotMap = useMemo(() => {
        const map = new Map<string, AvailableSlot>();
        slots.forEach(s => map.set(`${s.date}|${s.start_time}`, s));
        return map;
    }, [slots]);

    const hasOffline = formats.includes('OFFLINE_ROOM');
    const hasOnline = formats.includes('ONLINE');

    const filterOptions = useMemo(() => {
        const opts: { key: string; label: string; value: string | null | 'all' }[] = [
            { key: 'all', label: 'Все', value: 'all' },
        ];
        if (hasOnline) opts.push({ key: 'online', label: 'Онлайн', value: null });
        if (hasOffline) {
            LOCATIONS.filter(l => l.id !== 'neo_school').forEach(loc => {
                opts.push({ key: loc.id, label: loc.name, value: loc.id });
            });
        }
        return opts;
    }, [hasOnline, hasOffline]);

    const getLocationLabel = (locId: string | null) => {
        if (!locId) return 'Онлайн';
        const loc = LOCATIONS.find(l => l.id === locId);
        return loc?.name || locId;
    };

    const handleBook = async () => {
        if (!selectedSlot || !bookingForm.name.trim()) return;
        setSubmitting(true);
        try {
            const data: AppointmentCreate = {
                client_name: bookingForm.name.trim(),
                client_phone: bookingForm.phone.trim() || undefined,
                client_email: bookingForm.email.trim() || undefined,
                date: selectedSlot.date,
                start_time: selectedSlot.start_time,
                location_id: selectedSlot.location_id,
            };
            await specialistsApi.createAppointment(specialistId, data);
            toast.success('Записано.');
            setSelectedSlot(null);
            setBookingForm({ name: '', phone: '', email: '' });
            const locParam = locationFilter === 'all' ? undefined : locationFilter;
            specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo, locParam).then(setSlots);
        } catch (e: any) {
            const msg = e.response?.data?.detail || 'Ошибка при записи';
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    const weekRangeLabel = `${format(weekDays[0], 'd MMM', { locale: ru })} — ${format(weekDays[6], 'd MMM yyyy', { locale: ru })}`.toUpperCase();

    // ── Shared: filter row (Vignelli-style text labels) ──
    const filterRow = (
        <div
            style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'baseline',
                fontFamily: MONO,
                fontSize: '11px',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: GH.ink60,
                marginBottom: '24px',
            }}
        >
            {filterOptions.map((opt, idx) => {
                const active = locationFilter === opt.value;
                return (
                    <div key={opt.key} style={{ display: 'flex', alignItems: 'baseline' }}>
                        {idx > 0 && <span style={{ padding: '0 12px', color: GH.ink30 }}>·</span>}
                        <button
                            onClick={() => setLocationFilter(opt.value)}
                            style={{
                                fontFamily: 'inherit',
                                fontSize: 'inherit',
                                letterSpacing: 'inherit',
                                textTransform: 'inherit',
                                color: active ? GH.ink : GH.ink60,
                                background: 'transparent',
                                border: 'none',
                                padding: '0 0 3px 0',
                                cursor: 'pointer',
                                borderBottom: active ? `1.5px solid ${GH.ink}` : '1.5px solid transparent',
                                fontWeight: active ? 500 : 400,
                            }}
                        >
                            {opt.label.toUpperCase()}
                        </button>
                    </div>
                );
            })}
        </div>
    );

    // ── Shared: inline booking panel (ниже сетки, не модалка) ──
    const bookingPanel = selectedSlot && (
        <div
            style={{
                marginTop: '32px',
                borderTop: `1px solid ${GH.ink}`,
                paddingTop: '28px',
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: isMobile ? '28px' : '56px',
                fontFamily: SANS,
            }}
        >
            {/* Левая колонка: сводка */}
            <div>
                <div
                    style={{
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink60,
                        marginBottom: '14px',
                    }}
                >
                    ВЫ ВЫБРАЛИ
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px 16px', fontSize: '15px', alignItems: 'baseline' }}>
                    {[
                        { label: 'ДАТА', value: format(new Date(selectedSlot.date + 'T00:00'), 'EEEE, d MMMM', { locale: ru }), mono: false },
                        { label: 'ВРЕМЯ', value: `${selectedSlot.start_time} — ${selectedSlot.end_time}`, mono: true },
                        { label: 'ФОРМАТ', value: getLocationLabel(selectedSlot.location_id), mono: false },
                        { label: 'СТОИМОСТЬ', value: `${basePriceGel} ₾`, mono: true, bold: true },
                    ].map(({ label, value, mono, bold }) => (
                        <div key={label} style={{ display: 'contents' }}>
                            <div
                                style={{
                                    color: GH.ink60,
                                    fontFamily: MONO,
                                    fontSize: '10px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.15em',
                                }}
                            >
                                {label}
                            </div>
                            <div
                                style={{
                                    color: GH.ink,
                                    fontWeight: bold ? 600 : 500,
                                    fontFamily: mono ? MONO : SANS,
                                }}
                            >
                                {value}
                            </div>
                        </div>
                    ))}
                </div>
                <div
                    style={{
                        fontSize: '11px',
                        fontFamily: MONO,
                        color: GH.ink60,
                        marginTop: '20px',
                        lineHeight: 1.6,
                        letterSpacing: '0.02em',
                        maxWidth: '380px',
                    }}
                >
                    Оплата напрямую специалисту. Бронь закрепляется за вами сразу.
                </div>
            </div>

            {/* Правая колонка: форма */}
            <div>
                <div
                    style={{
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.2em',
                        textTransform: 'uppercase',
                        color: GH.ink60,
                        marginBottom: '14px',
                    }}
                >
                    КОНТАКТ
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {([
                        { key: 'name', label: 'ИМЯ', required: true, placeholder: 'Как к вам обращаться' },
                        { key: 'phone', label: 'ТЕЛЕФОН', required: false, placeholder: '+995 …' },
                        { key: 'email', label: 'EMAIL', required: false, placeholder: 'you@example.com' },
                    ] as const).map(({ key, label, required, placeholder }) => (
                        <div key={key}>
                            <label
                                style={{
                                    display: 'block',
                                    fontFamily: MONO,
                                    fontSize: '10px',
                                    letterSpacing: '0.2em',
                                    color: GH.ink60,
                                    marginBottom: '6px',
                                    textTransform: 'uppercase',
                                }}
                            >
                                {label}
                                {required && <span style={{ color: GH.ink }}> *</span>}
                            </label>
                            <input
                                type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'}
                                value={bookingForm[key]}
                                onChange={e => setBookingForm(f => ({ ...f, [key]: e.target.value }))}
                                placeholder={placeholder}
                                style={{
                                    width: '100%',
                                    fontFamily: SANS,
                                    fontSize: '15px',
                                    color: GH.ink,
                                    background: 'transparent',
                                    border: 'none',
                                    borderBottom: `1px solid ${GH.ink}`,
                                    borderRadius: 0,
                                    padding: '6px 0',
                                    outline: 'none',
                                }}
                            />
                        </div>
                    ))}
                </div>

                <div style={{ display: 'flex', gap: '20px', marginTop: '28px', alignItems: 'center' }}>
                    <button
                        onClick={handleBook}
                        disabled={submitting || !bookingForm.name.trim()}
                        style={{
                            fontFamily: MONO,
                            fontSize: '12px',
                            letterSpacing: '0.2em',
                            textTransform: 'uppercase',
                            color: GH.paper,
                            background: submitting || !bookingForm.name.trim() ? GH.ink30 : GH.ink,
                            border: 'none',
                            borderRadius: 0,
                            padding: '14px 32px',
                            cursor: submitting || !bookingForm.name.trim() ? 'not-allowed' : 'pointer',
                            fontWeight: 500,
                        }}
                    >
                        {submitting ? 'ЗАПИСЫВАЮ' : 'ЗАПИСАТЬСЯ →'}
                    </button>
                    <button
                        onClick={() => {
                            setSelectedSlot(null);
                            setBookingForm({ name: '', phone: '', email: '' });
                        }}
                        style={{
                            fontFamily: MONO,
                            fontSize: '11px',
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                            color: GH.ink60,
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            textUnderlineOffset: '4px',
                        }}
                    >
                        отмена
                    </button>
                </div>
            </div>
        </div>
    );

    // ═══════════════════════ DESKTOP ═══════════════════════
    if (!isMobile) {
        return (
            <div
                style={{
                    marginTop: '48px',
                    background: GH.paper,
                    padding: '40px',
                    color: GH.ink,
                    border: `1px solid ${GH.ink10}`,
                    fontFamily: SANS,
                }}
            >
                {/* Заголовок секции */}
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        marginBottom: '24px',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: '14px',
                    }}
                >
                    <h3
                        style={{
                            fontFamily: MONO,
                            fontSize: '11px',
                            letterSpacing: '0.22em',
                            textTransform: 'uppercase',
                            color: GH.ink,
                            margin: 0,
                            fontWeight: 500,
                        }}
                    >
                        ЗАПИСЬ · {weekRangeLabel}
                    </h3>
                    <div
                        style={{
                            display: 'flex',
                            gap: '28px',
                            fontFamily: MONO,
                            fontSize: '11px',
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                        }}
                    >
                        <button
                            onClick={() => setWeekStart(s => subWeeks(s, 1))}
                            style={{ background: 'transparent', border: 'none', color: GH.ink, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit' }}
                        >
                            ← ПРЕД
                        </button>
                        <button
                            onClick={() => setWeekStart(() => startOfWeek(new Date(), { weekStartsOn: 1 }))}
                            style={{ background: 'transparent', border: 'none', color: GH.ink60, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit' }}
                        >
                            СЕГОДНЯ
                        </button>
                        <button
                            onClick={() => setWeekStart(s => addWeeks(s, 1))}
                            style={{ background: 'transparent', border: 'none', color: GH.ink, cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit' }}
                        >
                            СЛЕД →
                        </button>
                    </div>
                </div>

                {filterRow}

                {loading ? (
                    <div style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em', color: GH.ink60, padding: '96px 0', textAlign: 'center' }}>
                        ЗАГРУЖАЮ
                    </div>
                ) : slots.length === 0 ? (
                    <div style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em', color: GH.ink60, padding: '96px 0', textAlign: 'center' }}>
                        НА ЭТОЙ НЕДЕЛЕ ВРЕМЕНИ НЕТ
                    </div>
                ) : (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: `64px repeat(7, minmax(0, 1fr))`,
                            borderTop: `1px solid ${GH.ink}`,
                            borderLeft: `1px solid ${GH.ink10}`,
                        }}
                    >
                        {/* Заголовочная строка */}
                        <div
                            style={{
                                borderRight: `1px solid ${GH.ink10}`,
                                borderBottom: `1px solid ${GH.ink}`,
                                background: GH.paper,
                            }}
                        />
                        {weekDays.map((day, i) => {
                            const isCurrentDay = isSameDay(day, new Date());
                            return (
                                <div
                                    key={i}
                                    style={{
                                        borderRight: `1px solid ${GH.ink10}`,
                                        borderBottom: `1px solid ${GH.ink}`,
                                        padding: '12px 14px',
                                        fontFamily: MONO,
                                        background: isCurrentDay ? GH.ink5 : GH.paper,
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: '10px',
                                            letterSpacing: '0.2em',
                                            color: GH.ink60,
                                            fontWeight: isCurrentDay ? 600 : 400,
                                        }}
                                    >
                                        {DOW_LABELS[i]}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: '22px',
                                            color: GH.ink,
                                            fontWeight: isCurrentDay ? 600 : 400,
                                            marginTop: '2px',
                                            fontFeatureSettings: '"tnum"',
                                        }}
                                    >
                                        {format(day, 'd')}
                                    </div>
                                </div>
                            );
                        })}

                        {/* Строки слотов */}
                        {TIME_SLOTS.map((time) => (
                            <div key={time} style={{ display: 'contents' }}>
                                <div
                                    style={{
                                        borderRight: `1px solid ${GH.ink10}`,
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        fontFamily: MONO,
                                        fontSize: '10px',
                                        color: GH.ink60,
                                        padding: '0 10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'flex-end',
                                        height: '36px',
                                        letterSpacing: '0.05em',
                                        fontFeatureSettings: '"tnum"',
                                    }}
                                >
                                    {time.endsWith(':00') ? time : ''}
                                </div>
                                {weekDays.map((day, i) => {
                                    const dateStr = format(day, 'yyyy-MM-dd');
                                    const key = `${dateStr}|${time}`;
                                    const slot = slotMap.get(key);
                                    const isSelected = !!selectedSlot && selectedSlot.date === dateStr && selectedSlot.start_time === time;

                                    return (
                                        <div
                                            key={i}
                                            onClick={slot ? () => setSelectedSlot(slot) : undefined}
                                            style={{
                                                borderRight: `1px solid ${GH.ink10}`,
                                                borderBottom: `1px solid ${GH.ink10}`,
                                                height: '36px',
                                                position: 'relative',
                                                background: isSelected ? GH.ink : slot ? '#FFFFFF' : GH.cellDead,
                                                cursor: slot ? 'pointer' : 'default',
                                                transition: 'background 0.08s linear',
                                            }}
                                            onMouseEnter={(e) => {
                                                if (slot && !isSelected) {
                                                    (e.currentTarget as HTMLDivElement).style.background = GH.ink5;
                                                }
                                            }}
                                            onMouseLeave={(e) => {
                                                if (slot && !isSelected) {
                                                    (e.currentTarget as HTMLDivElement).style.background = '#FFFFFF';
                                                }
                                            }}
                                            title={slot ? `${time} · ${getLocationLabel(slot.location_id)}` : undefined}
                                        >
                                            {slot && (
                                                <>
                                                    <div
                                                        style={{
                                                            position: 'absolute',
                                                            inset: 0,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            fontFamily: MONO,
                                                            fontSize: '11px',
                                                            color: isSelected ? 'rgba(250,250,247,0.55)' : 'rgba(15,15,16,0.42)',
                                                            letterSpacing: '0.1em',
                                                            fontWeight: 500,
                                                            fontFeatureSettings: '"tnum"',
                                                        }}
                                                    >
                                                        {time}
                                                    </div>
                                                    <div
                                                        style={{
                                                            position: 'absolute',
                                                            top: '3px',
                                                            right: '5px',
                                                            fontFamily: MONO,
                                                            fontSize: '10px',
                                                            color: isSelected ? GH.paper : GH.ink,
                                                            letterSpacing: '0.05em',
                                                            fontWeight: 600,
                                                        }}
                                                    >
                                                        {getLocationMark(slot.location_id)}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}

                {/* Легенда */}
                {!loading && slots.length > 0 && (
                    <div
                        style={{
                            marginTop: '18px',
                            display: 'flex',
                            gap: '28px',
                            fontFamily: MONO,
                            fontSize: '10px',
                            letterSpacing: '0.15em',
                            textTransform: 'uppercase',
                            color: GH.ink60,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: '#FFFFFF', border: `1px solid ${GH.ink10}` }} />
                            <span>СВОБОДНО</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: GH.cellDead, border: `1px solid ${GH.ink10}` }} />
                            <span>НЕТ ПРИЁМА</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: GH.ink }} />
                            <span>ВЫБРАНО</span>
                        </div>
                        <div style={{ marginLeft: 'auto', color: GH.ink30 }}>
                            O · ОНЛАЙН&nbsp;&nbsp;&nbsp;1 · UNBOX ONE&nbsp;&nbsp;&nbsp;U · UNBOX UNI
                        </div>
                    </div>
                )}

                {bookingPanel}
            </div>
        );
    }

    // ═══════════════════════ MOBILE ═══════════════════════
    const mobileDayStr = format(mobileDate, 'yyyy-MM-dd');
    const mobileDaySlots = slots.filter(s => s.date === mobileDayStr);

    return (
        <div
            style={{
                marginTop: '32px',
                background: GH.paper,
                padding: '20px',
                color: GH.ink,
                border: `1px solid ${GH.ink10}`,
                fontFamily: SANS,
            }}
        >
            <div style={{ borderBottom: `1px solid ${GH.ink}`, paddingBottom: '12px', marginBottom: '16px' }}>
                <div
                    style={{
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.22em',
                        textTransform: 'uppercase',
                        color: GH.ink,
                        fontWeight: 500,
                    }}
                >
                    ЗАПИСЬ
                </div>
                <div
                    style={{
                        fontFamily: MONO,
                        fontSize: '10px',
                        letterSpacing: '0.15em',
                        color: GH.ink60,
                        marginTop: '4px',
                    }}
                >
                    {weekRangeLabel}
                </div>
            </div>

            {filterRow}

            {/* Переключатель недель */}
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '14px',
                    fontFamily: MONO,
                    fontSize: '10px',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                }}
            >
                <button onClick={() => setWeekStart(s => subWeeks(s, 1))} style={{ background: 'transparent', border: 'none', color: GH.ink, padding: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', cursor: 'pointer' }}>
                    ← ПРЕД
                </button>
                <button onClick={() => setWeekStart(s => addWeeks(s, 1))} style={{ background: 'transparent', border: 'none', color: GH.ink, padding: 0, fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', cursor: 'pointer' }}>
                    СЛЕД →
                </button>
            </div>

            {/* 7 дней — узкая сетка */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    borderTop: `1px solid ${GH.ink}`,
                    borderLeft: `1px solid ${GH.ink10}`,
                    marginBottom: '18px',
                }}
            >
                {weekDays.map((day, i) => {
                    const isActive = isSameDay(day, mobileDate);
                    const isCurrentDay = isSameDay(day, new Date());
                    const dayHasSlots = slots.some(s => s.date === format(day, 'yyyy-MM-dd'));
                    return (
                        <button
                            key={i}
                            onClick={() => setMobileDate(day)}
                            style={{
                                borderRight: `1px solid ${GH.ink10}`,
                                borderBottom: `1px solid ${GH.ink10}`,
                                borderTop: 'none',
                                borderLeft: 'none',
                                background: isActive ? GH.ink : GH.paper,
                                color: isActive ? GH.paper : dayHasSlots ? GH.ink : GH.ink30,
                                padding: '10px 4px',
                                fontFamily: MONO,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '2px',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontSize: '9px', letterSpacing: '0.2em', fontWeight: isCurrentDay ? 600 : 400 }}>
                                {DOW_LABELS[i]}
                            </span>
                            <span style={{ fontSize: '18px', fontWeight: isCurrentDay ? 600 : 400, fontFeatureSettings: '"tnum"' }}>
                                {format(day, 'd')}
                            </span>
                        </button>
                    );
                })}
            </div>

            {loading ? (
                <div style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em', color: GH.ink60, padding: '64px 0', textAlign: 'center' }}>
                    ЗАГРУЖАЮ
                </div>
            ) : mobileDaySlots.length === 0 ? (
                <div style={{ fontFamily: MONO, fontSize: '11px', letterSpacing: '0.2em', color: GH.ink60, padding: '64px 0', textAlign: 'center' }}>
                    В ЭТОТ ДЕНЬ ВРЕМЕНИ НЕТ
                </div>
            ) : (
                <div style={{ borderTop: `1px solid ${GH.ink}` }}>
                    {mobileDaySlots.map((slot, i) => {
                        const isSelected = selectedSlot?.date === slot.date && selectedSlot?.start_time === slot.start_time;
                        return (
                            <div
                                key={`${slot.date}|${slot.start_time}|${i}`}
                                onClick={() => setSelectedSlot(slot)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'baseline',
                                    justifyContent: 'space-between',
                                    padding: '16px 6px',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    background: isSelected ? GH.ink : 'transparent',
                                    color: isSelected ? GH.paper : GH.ink,
                                    cursor: 'pointer',
                                }}
                            >
                                <span
                                    style={{
                                        fontFamily: MONO,
                                        fontSize: '18px',
                                        fontWeight: 500,
                                        letterSpacing: '0.02em',
                                        fontFeatureSettings: '"tnum"',
                                    }}
                                >
                                    {slot.start_time}
                                </span>
                                <span
                                    style={{
                                        fontFamily: MONO,
                                        fontSize: '10px',
                                        letterSpacing: '0.18em',
                                        textTransform: 'uppercase',
                                        color: isSelected ? 'rgba(250,250,247,0.7)' : GH.ink60,
                                    }}
                                >
                                    {slot.location_id ? getLocationLabel(slot.location_id).toUpperCase() : 'ОНЛАЙН'}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}

            {bookingPanel}
        </div>
    );
}
