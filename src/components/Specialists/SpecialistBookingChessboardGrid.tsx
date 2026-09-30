// ──────────────────────────────────────────────────────────────────────
// Запись к специалисту (Grid House). Живёт в профиле специалиста
// (/specialists/:id и /m/specialists/:id), блок #specialist-slots.
//
// Волна 2 (G2-04, G2-05, G2-22, G2-catalog-M2):
// - контакт обязателен: телефон или Telegram (хотя бы одно), вошедшему
//   имя, телефон и почта подставляются из профиля;
// - после записи — экран «Вы записаны: специалист, дата, время» вместо
//   тоста на пару секунд;
// - слоты и дни — настоящие кнопки (Tab, Enter, aria-pressed), подписи
//   полей связаны с полями;
// - «Онлайн» показывает только онлайн-слоты, центры берутся из слотов и
//   анкеты (любой OFFLINE-код), а не из устаревшего OFFLINE_ROOM;
// - пустая неделя — «Ближайшее свободное →», на телефоне сразу выбран
//   первый день со слотами.
// Поля запроса (AppointmentCreate) и specialistsApi не менялись.
// ──────────────────────────────────────────────────────────────────────

import { useState, useEffect, useMemo, useRef } from 'react';
import { specialistsApi, type AvailableSlot, type AppointmentCreate } from '../../api/specialists';
import { LOCATIONS } from '../../utils/data';
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, parseISO } from 'date-fns';
import { toast } from 'sonner';
import { CalendarPlus, Check } from 'lucide-react';
import { apiErrorMessage } from '../../utils/errors';
import { GH, GH_SANS, GH_MONO } from '../../hooks/useDesignFlag';
import { COLOR } from '../../design/tokens';
import { formatGel, formatDateLabel, formatDayMonthShort } from '../../utils/format';
import { useUserStore } from '../../store/userStore';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Skeleton } from '../ui/Skeleton';
import { Chip } from '../ui/Chip';

interface Props {
    specialistId: string;
    specialistName: string;
    formats: string[];
    basePriceGel: number;
}

// ── Grid House tokens — общие (src/design/tokens.ts), без локальной копии ──
const SANS = GH_SANS;
const MONO = GH_MONO;

// 30-минутный шаг, с 09:00 до 21:00
const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => {
    const h = 9 + Math.floor(i / 2);
    const m = (i % 2) * 30;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}).filter(t => t < '21:00');

const DOW_LABELS = ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'];

const monoCaps: React.CSSProperties = {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
};

// Центр в формате анкеты → id локации (как в профиле специалиста).
const CENTER_TAGS: Record<string, string> = {
    OFFLINE_UNBOX_ONE: 'unbox_one',
    OFFLINE_UNBOX_UNI: 'unbox_uni',
    OFFLINE_NEO_SCHOOL: 'neo_school',
};

type LocFilter = 'all' | 'online' | string;

const getLocationMark = (locId: string | null): string => {
    if (!locId) return 'O';
    if (locId === 'unbox_one') return '1';
    if (locId === 'unbox_uni') return 'U';
    if (locId === 'neo_school') return 'N';
    return '•';
};

function locationName(locId: string | null | undefined): string {
    if (!locId) return 'Онлайн';
    return LOCATIONS.find(l => l.id === locId)?.name || locId;
}

function locationAddress(locId: string | null | undefined): string | null {
    if (!locId) return null;
    return LOCATIONS.find(l => l.id === locId)?.address ?? null;
}

/** «@name» из «name», «@name», «t.me/name», «https://t.me/name». */
function normalizeTelegram(raw: string): string {
    const v = raw.trim().replace(/\s+/g, '');
    if (!v) return '';
    const handle = v.replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/\/$/, '');
    return handle ? `@${handle}` : '';
}

/** Ссылка «Добавить в Google Календарь» — без доступа к календарю, просто шаблон события. */
function googleCalendarUrl(opts: { title: string; date: string; start: string; end: string; location?: string | null; details?: string }): string {
    const stamp = (t: string) => `${opts.date.replace(/-/g, '')}T${t.replace(':', '')}00`;
    const params = new URLSearchParams({
        action: 'TEMPLATE',
        text: opts.title,
        dates: `${stamp(opts.start)}/${stamp(opts.end)}`,
        ctz: 'Asia/Tbilisi',
    });
    if (opts.location) params.set('location', opts.location);
    if (opts.details) params.set('details', opts.details);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function slotAriaLabel(slot: AvailableSlot): string {
    return `${formatDateLabel(slot.date)}, ${slot.startTime}, ${locationName(slot.locationId)}`;
}

type Booked = { slot: AvailableSlot; name: string };

export function SpecialistBookingChessboardGrid({ specialistId, specialistName, formats, basePriceGel }: Props) {
    const currentUser = useUserStore(s => s.currentUser);
    const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
    const [locationFilter, setLocationFilter] = useState<LocFilter>('all');
    const [allSlots, setAllSlots] = useState<AvailableSlot[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
    const [bookingForm, setBookingForm] = useState({ name: '', phone: '', telegram: '', email: '' });
    const [errors, setErrors] = useState<{ name?: string; contact?: string }>({});
    const [submitting, setSubmitting] = useState(false);
    const [booked, setBooked] = useState<Booked | null>(null);
    const [searchingNearest, setSearchingNearest] = useState(false);
    const [nearestNone, setNearestNone] = useState(false);

    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
    const [mobileDate, setMobileDate] = useState(new Date());
    // День, который человек выбрал сам: его не перебиваем автоподбором.
    const userPickedDay = useRef(false);
    const panelRef = useRef<HTMLDivElement>(null);
    const successRef = useRef<HTMLHeadingElement>(null);

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

    // Слоты недели грузим все сразу, фильтр центра/онлайна — здесь.
    // Раньше «Онлайн» передавал null, запрос уходил без параметра, и сервер
    // отдавал все слоты, включая очные.
    useEffect(() => {
        setLoading(true);
        setLoadFailed(false);
        if (useMock) {
            const fake: AvailableSlot[] = [];
            const locationsByDay: (string | null)[] = ['unbox_one', 'unbox_uni', null, 'unbox_one', 'unbox_uni'];
            const bookedMock = new Set(['0|11:00', '0|14:00', '1|10:00', '1|15:00', '2|12:00', '2|16:00', '3|13:00', '4|10:00', '4|17:00']);
            for (let i = 0; i < 7; i++) {
                const d = addDays(new Date(dateFrom + 'T00:00'), i);
                const dow = (d.getDay() + 6) % 7; // 0=Mon
                if (dow >= 5) continue; // weekends off
                for (let h = 10; h <= 18; h++) {
                    const start = `${String(h).padStart(2, '0')}:00`;
                    if (bookedMock.has(`${dow}|${start}`)) continue;
                    fake.push({
                        date: format(d, 'yyyy-MM-dd'),
                        startTime: start,
                        endTime: `${String(h + 1).padStart(2, '0')}:00`,
                        locationId: locationsByDay[dow],
                    });
                }
            }
            setAllSlots(fake);
            setLoading(false);
            return;
        }
        let alive = true;
        specialistsApi.getAvailableSlots(specialistId, dateFrom, dateTo)
            .then(list => { if (alive) setAllSlots(list); })
            .catch(() => { if (alive) { setAllSlots([]); setLoadFailed(true); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [specialistId, dateFrom, dateTo, useMock, reloadKey]);

    const slots = useMemo(() => {
        if (locationFilter === 'all') return allSlots;
        if (locationFilter === 'online') return allSlots.filter(s => !s.locationId);
        return allSlots.filter(s => s.locationId === locationFilter);
    }, [allSlots, locationFilter]);

    const slotMap = useMemo(() => {
        const map = new Map<string, AvailableSlot>();
        slots.forEach(s => map.set(`${s.date}|${s.startTime}`, s));
        return map;
    }, [slots]);

    // Фильтр: «Онлайн», если специалист работает онлайн; центры — из анкеты
    // (OFFLINE_UNBOX_ONE/UNI…) и из самих слотов недели.
    const filterOptions = useMemo(() => {
        const opts: { key: LocFilter; label: string }[] = [{ key: 'all', label: 'Все' }];
        const hasOnline = formats.includes('ONLINE') || allSlots.some(s => !s.locationId);
        if (hasOnline) opts.push({ key: 'online', label: 'Онлайн' });
        const centers = new Set<string>();
        formats.forEach(f => { const id = CENTER_TAGS[f.toUpperCase()]; if (id) centers.add(id); });
        allSlots.forEach(s => { if (s.locationId) centers.add(s.locationId); });
        LOCATIONS.forEach(loc => { if (centers.has(loc.id)) opts.push({ key: loc.id, label: loc.name }); });
        return opts;
    }, [formats, allSlots]);

    // Выбранный центр пропал из вариантов (другая неделя) — назад на «Все».
    useEffect(() => {
        if (!filterOptions.some(o => o.key === locationFilter)) setLocationFilter('all');
    }, [filterOptions, locationFilter]);

    // Телефон: если в выбранный день слотов нет — сразу первый день недели
    // со слотами (начиная с сегодня), пока человек не выбрал день сам.
    useEffect(() => {
        if (loading || userPickedDay.current) return;
        const today = format(new Date(), 'yyyy-MM-dd');
        const cur = format(mobileDate, 'yyyy-MM-dd');
        if (slots.some(s => s.date === cur)) return;
        const first = slots.map(s => s.date).filter(d => d >= today).sort()[0];
        if (first) setMobileDate(parseISO(first));
    }, [loading, slots, mobileDate]);

    // Подстановка из профиля вошедшего — только в пустые поля.
    useEffect(() => {
        if (!selectedSlot || !currentUser) return;
        setBookingForm(f => ({
            ...f,
            name: f.name || currentUser.name || '',
            phone: f.phone || currentUser.phone || '',
            email: f.email || currentUser.email || '',
        }));
    }, [selectedSlot, currentUser]);

    // Выбрали время — показываем форму (на телефоне она ниже списка слотов).
    useEffect(() => {
        if (!selectedSlot) return;
        const t = window.setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
        return () => window.clearTimeout(t);
    }, [selectedSlot]);

    useEffect(() => {
        if (!booked) return;
        successRef.current?.focus();
        successRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, [booked]);

    const pickSlot = (slot: AvailableSlot) => {
        setSelectedSlot(slot);
        setErrors({});
    };

    const goWeek = (next: Date) => {
        userPickedDay.current = false;
        setWeekStart(next);
        setMobileDate(next);
        setSelectedSlot(null);
    };

    const findNearest = async () => {
        setSearchingNearest(true);
        setNearestNone(false);
        try {
            const from = new Date();
            const list = await specialistsApi.getAvailableSlots(
                specialistId, format(from, 'yyyy-MM-dd'), format(addDays(from, 30), 'yyyy-MM-dd'),
            );
            const matching = list.filter(s => locationFilter === 'all' ? true : locationFilter === 'online' ? !s.locationId : s.locationId === locationFilter);
            const first = matching.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime))[0];
            if (!first) { setNearestNone(true); return; }
            const day = parseISO(first.date);
            userPickedDay.current = true;
            setWeekStart(startOfWeek(day, { weekStartsOn: 1 }));
            setMobileDate(day);
        } catch (e: unknown) {
            toast.error(apiErrorMessage(e, 'Не удалось найти свободное время. Попробуйте ещё раз.'));
        } finally {
            setSearchingNearest(false);
        }
    };

    const handleBook = async () => {
        if (!selectedSlot) return;
        const name = bookingForm.name.trim();
        const phone = bookingForm.phone.trim();
        const telegram = normalizeTelegram(bookingForm.telegram);
        const nextErrors: typeof errors = {};
        if (!name) nextErrors.name = 'Напишите, как к вам обращаться';
        if (!phone && !telegram) nextErrors.contact = 'Укажите телефон или Telegram — так специалист свяжется с вами';
        setErrors(nextErrors);
        if (nextErrors.name || nextErrors.contact) return;

        setSubmitting(true);
        try {
            // Ключи в camelCase — интерцептор запроса сам переведёт их
            // в client_name / start_time / location_id для бэкенда.
            // Telegram отдельного поля не имеет — уходит в заметку к записи
            // (её видит специалист в уведомлении и в CRM).
            const data: AppointmentCreate = {
                clientName: name,
                clientPhone: phone || undefined,
                clientEmail: bookingForm.email.trim() || undefined,
                date: selectedSlot.date,
                startTime: selectedSlot.startTime,
                locationId: selectedSlot.locationId,
                notes: telegram ? `Telegram: ${telegram}` : undefined,
            };
            await specialistsApi.createAppointment(specialistId, data);
            setBooked({ slot: selectedSlot, name });
            setSelectedSlot(null);
            setBookingForm(f => ({ ...f, telegram: '' }));
            setReloadKey(k => k + 1);
        } catch (e: any) {
            if (e?.response?.status === 409) {
                // Время успели занять, пока клиент заполнял форму —
                // обновляем сетку, чтобы он выбрал другой час.
                toast.error('Это время уже заняли. Выберите другое.');
                setSelectedSlot(null);
                setReloadKey(k => k + 1);
            } else {
                // detail бывает массивом (422) — рендер его в toast ронял
                // всё приложение (React #31). Только через apiErrorMessage.
                toast.error(apiErrorMessage(e, 'Не удалось записаться. Попробуйте ещё раз.'));
            }
        } finally {
            setSubmitting(false);
        }
    };

    const weekRangeLabel = `${formatDayMonthShort(weekDays[0])} — ${formatDayMonthShort(weekDays[6], { withYear: 'auto' })}`;
    const price = basePriceGel > 0 ? basePriceGel : null;

    // ── Shared: filter row ──
    const filterRow = filterOptions.length > 1 && (
        <div className="ui-chip-row" role="group" aria-label="Где проходит сессия" style={{ marginBottom: 20 }}>
            {filterOptions.map(opt => (
                <Chip key={opt.key} selected={locationFilter === opt.key} onClick={() => { setLocationFilter(opt.key); setSelectedSlot(null); }}>
                    {opt.label}
                </Chip>
            ))}
        </div>
    );

    const weekNavButton: React.CSSProperties = {
        ...monoCaps,
        background: 'transparent',
        border: 'none',
        color: GH.ink,
        cursor: 'pointer',
        padding: '0 8px',
        minHeight: 44,
        minWidth: 44,
    };

    // ── Пустая неделя: подсказка, куда идти дальше ──
    const emptyWeek = (
        <div style={{ padding: isMobile ? '40px 0' : '64px 0', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
            <p style={{ margin: 0, fontSize: 16, color: GH.ink }}>
                {loadFailed ? 'Не удалось загрузить расписание.' : isMobile ? 'В этот день свободного времени нет.' : 'На этой неделе свободного времени нет.'}
            </p>
            {nearestNone && (
                <p style={{ margin: 0, fontSize: 14, color: GH.ink60 }}>
                    В ближайший месяц свободных окон нет — напишите специалисту напрямую.
                </p>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                {loadFailed ? (
                    <Button variant="secondary" onClick={() => setReloadKey(k => k + 1)}>Повторить</Button>
                ) : (
                    <>
                        <Button variant="secondary" loading={searchingNearest} onClick={findNearest}>
                            Ближайшее свободное →
                        </Button>
                        <Button variant="quiet" onClick={() => goWeek(addWeeks(weekStart, 1))}>
                            Следующая неделя
                        </Button>
                    </>
                )}
            </div>
        </div>
    );

    // ── Shared: inline booking panel (ниже сетки, не модалка) ──
    const bookingPanel = selectedSlot && (
        <div
            ref={panelRef}
            style={{
                marginTop: '32px',
                borderTop: `1px solid ${GH.ink}`,
                paddingTop: '28px',
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: isMobile ? '28px' : '56px',
                fontFamily: SANS,
                scrollMarginTop: 80,
            }}
        >
            {/* Левая колонка: сводка */}
            <div>
                <h4 style={{ ...monoCaps, color: GH.ink60, margin: '0 0 14px', fontWeight: 500 }}>
                    Вы выбрали
                </h4>
                <dl style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '10px 16px', fontSize: 16, alignItems: 'baseline', margin: 0 }}>
                    {[
                        { label: 'Дата', value: formatDateLabel(selectedSlot.date, { capitalize: true }), mono: false },
                        { label: 'Время', value: `${selectedSlot.startTime} — ${selectedSlot.endTime}`, mono: true },
                        { label: 'Где', value: locationName(selectedSlot.locationId), mono: false },
                        ...(price !== null ? [{ label: 'Стоимость', value: formatGel(price), mono: true, bold: true }] : []),
                    ].map(({ label, value, mono, bold }: { label: string; value: string; mono: boolean; bold?: boolean }) => (
                        <div key={label} style={{ display: 'contents' }}>
                            <dt style={{ ...monoCaps, color: GH.ink60 }}>{label}</dt>
                            <dd style={{ margin: 0, color: GH.ink, fontWeight: bold ? 600 : 500, fontFamily: mono ? MONO : SANS }}>{value}</dd>
                        </div>
                    ))}
                </dl>
                <p style={{ fontSize: 14, color: GH.ink60, margin: '20px 0 0', lineHeight: 1.5, maxWidth: 380 }}>
                    Оплата — напрямую специалисту. Время закрепляется за вами сразу после записи.
                </p>
            </div>

            {/* Правая колонка: форма */}
            <form
                noValidate
                onSubmit={(e) => { e.preventDefault(); handleBook(); }}
            >
                <h4 style={{ ...monoCaps, color: GH.ink60, margin: '0 0 14px', fontWeight: 500 }}>
                    Как с вами связаться
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <Field label="Имя" required error={errors.name}>
                        <Input
                            kind="name"
                            value={bookingForm.name}
                            onChange={e => setBookingForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Как к вам обращаться"
                        />
                    </Field>
                    <Field
                        label="Телефон"
                        error={errors.contact}
                        hint="Нужен телефон или Telegram — хотя бы одно."
                    >
                        <Input
                            kind="phone"
                            value={bookingForm.phone}
                            onChange={e => { setBookingForm(f => ({ ...f, phone: e.target.value })); if (errors.contact) setErrors(er => ({ ...er, contact: undefined })); }}
                            placeholder="+995 …"
                        />
                    </Field>
                    <Field label="Telegram" optional={!!bookingForm.phone.trim()}>
                        <Input
                            kind="text"
                            autoComplete="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            value={bookingForm.telegram}
                            onChange={e => { setBookingForm(f => ({ ...f, telegram: e.target.value })); if (errors.contact) setErrors(er => ({ ...er, contact: undefined })); }}
                            placeholder="@username"
                        />
                    </Field>
                    <Field label="Email" optional>
                        <Input
                            kind="email"
                            value={bookingForm.email}
                            onChange={e => setBookingForm(f => ({ ...f, email: e.target.value }))}
                            placeholder="you@example.com"
                        />
                    </Field>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 28, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button type="submit" variant="primary" loading={submitting}>
                        {submitting ? 'Записываем…' : price !== null ? `Записаться · ${formatGel(price)}` : 'Записаться'}
                    </Button>
                    <Button
                        variant="quiet"
                        onClick={() => { setSelectedSlot(null); setErrors({}); }}
                    >
                        Выбрать другое время
                    </Button>
                </div>
            </form>
        </div>
    );

    // ── После записи: экран подтверждения вместо тоста ──
    if (booked) {
        const s = booked.slot;
        const dateLabel = formatDateLabel(s.date, { capitalize: true });
        const where = s.locationId
            ? [locationName(s.locationId), locationAddress(s.locationId)].filter(Boolean).join(', ')
            : 'Онлайн — ссылку пришлёт специалист';
        return (
            <div
                style={{
                    marginTop: isMobile ? 32 : 48,
                    background: GH.paper,
                    padding: isMobile ? 20 : 40,
                    color: GH.ink,
                    border: `1px solid ${GH.ink}`,
                    fontFamily: SANS,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...monoCaps, color: GH.ink60, marginBottom: 12 }}>
                    <Check size={16} aria-hidden="true" /> Запись подтверждена
                </div>
                <h3
                    ref={successRef}
                    tabIndex={-1}
                    style={{ fontSize: isMobile ? 24 : 32, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 20px', outline: 'none' }}
                >
                    Вы записаны: {specialistName}, {dateLabel}, <span className="num">{s.startTime}</span>
                </h3>
                <dl style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '140px 1fr', gap: isMobile ? '4px 0' : '10px 16px', margin: '0 0 24px', fontSize: 16 }}>
                    <dt style={{ ...monoCaps, color: GH.ink60 }}>Где</dt>
                    <dd style={{ margin: isMobile ? '0 0 12px' : 0 }}>{where}</dd>
                    <dt style={{ ...monoCaps, color: GH.ink60 }}>Время</dt>
                    <dd style={{ margin: isMobile ? '0 0 12px' : 0, fontFamily: MONO }}>{s.startTime} — {s.endTime}</dd>
                    {price !== null && (
                        <>
                            <dt style={{ ...monoCaps, color: GH.ink60 }}>Оплата</dt>
                            <dd style={{ margin: 0 }}>{formatGel(price)} — специалисту, напрямую</dd>
                        </>
                    )}
                </dl>
                <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: 1.5, color: GH.ink60, maxWidth: 560 }}>
                    Специалист получил вашу запись и контакты. Чтобы перенести или отменить встречу —{' '}
                    <a href="https://t.me/UnboxCenter" target="_blank" rel="noopener noreferrer" style={{ color: GH.ink, textDecoration: 'underline', textUnderlineOffset: 3 }}>
                        напишите нам в Telegram
                    </a>.
                </p>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <a
                        className="ui-btn ui-btn--secondary"
                        href={googleCalendarUrl({
                            title: `Сессия: ${specialistName}`,
                            date: s.date,
                            start: s.startTime,
                            end: s.endTime,
                            location: s.locationId ? where : null,
                            details: 'Запись через unbox.com.ge',
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'none' }}
                    >
                        <CalendarPlus size={18} aria-hidden="true" /> Добавить в календарь
                    </a>
                    <Button variant="quiet" onClick={() => setBooked(null)}>
                        Записаться ещё
                    </Button>
                </div>
            </div>
        );
    }

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
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '24px',
                        borderBottom: `1px solid ${GH.ink}`,
                        paddingBottom: '8px',
                        gap: 16,
                        flexWrap: 'wrap',
                    }}
                >
                    <h3 style={{ ...monoCaps, color: GH.ink, margin: 0, fontWeight: 500 }}>
                        Запись · <span className="num">{weekRangeLabel}</span>
                    </h3>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" onClick={() => goWeek(subWeeks(weekStart, 1))} style={weekNavButton} aria-label="Предыдущая неделя">
                            ← Пред.
                        </button>
                        <button type="button" onClick={() => goWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))} style={{ ...weekNavButton, color: GH.ink60 }}>
                            Сегодня
                        </button>
                        <button type="button" onClick={() => goWeek(addWeeks(weekStart, 1))} style={weekNavButton} aria-label="Следующая неделя">
                            След. →
                        </button>
                    </div>
                </div>

                {filterRow}

                {loading ? (
                    <div role="status" aria-busy="true">
                        <span className="sr-only">Загружаем расписание…</span>
                        <Skeleton height={320} radius={0} />
                    </div>
                ) : slots.length === 0 ? (
                    emptyWeek
                ) : (
                    <div
                        role="grid"
                        aria-label="Свободное время на неделе"
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
                                    <div style={{ fontSize: 12, letterSpacing: '0.06em', color: GH.ink60, fontWeight: isCurrentDay ? 600 : 400 }}>
                                        {DOW_LABELS[i]}
                                    </div>
                                    <div style={{ fontSize: 20, color: GH.ink, fontWeight: isCurrentDay ? 600 : 400, marginTop: 2, fontFeatureSettings: '"tnum"' }}>
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
                                        fontSize: 12,
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
                                    const slot = slotMap.get(`${dateStr}|${time}`);
                                    const isSelected = !!selectedSlot && selectedSlot.date === dateStr && selectedSlot.startTime === time;
                                    const cellBase: React.CSSProperties = {
                                        borderRight: `1px solid ${GH.ink10}`,
                                        borderBottom: `1px solid ${GH.ink10}`,
                                        height: '36px',
                                        position: 'relative',
                                    };
                                    if (!slot) {
                                        return <div key={i} style={{ ...cellBase, background: GH.cellDead }} />;
                                    }
                                    // G2-22: слот — настоящая кнопка (Tab, Enter, aria-pressed).
                                    return (
                                        <button
                                            key={i}
                                            type="button"
                                            aria-pressed={isSelected}
                                            aria-label={slotAriaLabel(slot)}
                                            onClick={() => pickSlot(slot)}
                                            className="spec-slot"
                                            style={{
                                                ...cellBase,
                                                borderTop: 'none',
                                                borderLeft: 'none',
                                                padding: 0,
                                                width: '100%',
                                                background: isSelected ? GH.ink : COLOR.card,
                                                cursor: 'pointer',
                                                transition: 'background 0.08s linear',
                                            }}
                                            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = GH.ink5; }}
                                            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = COLOR.card; }}
                                            title={`${time} · ${locationName(slot.locationId)}`}
                                        >
                                            <span
                                                aria-hidden="true"
                                                style={{
                                                    position: 'absolute',
                                                    inset: 0,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontFamily: MONO,
                                                    fontSize: 12,
                                                    color: isSelected ? GH.paper : GH.ink60,
                                                    letterSpacing: '0.06em',
                                                    fontWeight: 500,
                                                    fontFeatureSettings: '"tnum"',
                                                }}
                                            >
                                                {time}
                                            </span>
                                            <span
                                                aria-hidden="true"
                                                style={{
                                                    position: 'absolute',
                                                    top: '3px',
                                                    right: '5px',
                                                    fontFamily: MONO,
                                                    fontSize: 12,
                                                    color: isSelected ? GH.paper : GH.ink,
                                                    letterSpacing: '0.05em',
                                                    fontWeight: 600,
                                                    lineHeight: 1,
                                                }}
                                            >
                                                {getLocationMark(slot.locationId)}
                                            </span>
                                        </button>
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
                            ...monoCaps,
                            color: GH.ink60,
                            alignItems: 'center',
                            flexWrap: 'wrap',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: COLOR.card, border: `1px solid ${GH.ink10}` }} />
                            <span>Свободно</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: GH.cellDead, border: `1px solid ${GH.ink10}` }} />
                            <span>Нет приёма</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '14px', height: '14px', background: GH.ink }} />
                            <span>Выбрано</span>
                        </div>
                        <div style={{ marginLeft: 'auto', color: GH.ink60 }}>
                            O · Онлайн&nbsp;&nbsp;&nbsp;1 · Unbox One&nbsp;&nbsp;&nbsp;U · Unbox Uni
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
                padding: '16px',
                color: GH.ink,
                border: `1px solid ${GH.ink10}`,
                fontFamily: SANS,
            }}
        >
            <div style={{ borderBottom: `1px solid ${GH.ink}`, paddingBottom: '8px', marginBottom: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <button type="button" onClick={() => goWeek(subWeeks(weekStart, 1))} style={weekNavButton} aria-label="Предыдущая неделя">←</button>
                <h3 style={{ ...monoCaps, color: GH.ink, margin: 0, fontWeight: 500, textAlign: 'center' }}>
                    Запись · <span className="num">{weekRangeLabel}</span>
                </h3>
                <button type="button" onClick={() => goWeek(addWeeks(weekStart, 1))} style={weekNavButton} aria-label="Следующая неделя">→</button>
            </div>

            {filterRow}

            {/* 7 дней — узкая сетка. Дни со слотами — с точкой (G2-05). */}
            <div
                role="group"
                aria-label="День"
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
                            type="button"
                            aria-pressed={isActive}
                            aria-label={`${formatDateLabel(day)}${dayHasSlots ? ', есть свободное время' : ', нет свободного времени'}`}
                            onClick={() => { userPickedDay.current = true; setMobileDate(day); }}
                            style={{
                                borderRight: `1px solid ${GH.ink10}`,
                                borderBottom: `1px solid ${GH.ink10}`,
                                borderTop: 'none',
                                borderLeft: 'none',
                                background: isActive ? GH.ink : GH.paper,
                                color: isActive ? GH.paper : dayHasSlots ? GH.ink : GH.ink60,
                                padding: '8px 2px',
                                minHeight: 64,
                                fontFamily: MONO,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '2px',
                                cursor: 'pointer',
                            }}
                        >
                            <span style={{ fontSize: 12, letterSpacing: '0.06em', fontWeight: isCurrentDay ? 600 : 400 }}>
                                {DOW_LABELS[i]}
                            </span>
                            <span style={{ fontSize: 18, fontWeight: isCurrentDay ? 600 : 400, fontFeatureSettings: '"tnum"' }}>
                                {format(day, 'd')}
                            </span>
                            <span
                                aria-hidden="true"
                                style={{ width: 6, height: 6, borderRadius: '50%', background: dayHasSlots ? (isActive ? GH.paper : GH.accent) : 'transparent' }}
                            />
                        </button>
                    );
                })}
            </div>

            {loading ? (
                <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span className="sr-only">Загружаем расписание…</span>
                    {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={48} radius={0} />)}
                </div>
            ) : mobileDaySlots.length === 0 ? (
                emptyWeek
            ) : (
                <div role="group" aria-label="Время" style={{ borderTop: `1px solid ${GH.ink}` }}>
                    {mobileDaySlots.map((slot, i) => {
                        const isSelected = selectedSlot?.date === slot.date && selectedSlot?.startTime === slot.startTime;
                        return (
                            <button
                                key={`${slot.date}|${slot.startTime}|${i}`}
                                type="button"
                                aria-pressed={isSelected}
                                aria-label={slotAriaLabel(slot)}
                                onClick={() => pickSlot(slot)}
                                style={{
                                    display: 'flex',
                                    width: '100%',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    minHeight: 52,
                                    padding: '0 8px',
                                    border: 'none',
                                    borderBottom: `1px solid ${GH.ink10}`,
                                    background: isSelected ? GH.ink : 'transparent',
                                    color: isSelected ? GH.paper : GH.ink,
                                    cursor: 'pointer',
                                    fontFamily: SANS,
                                    textAlign: 'left',
                                }}
                            >
                                <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 500, letterSpacing: '0.02em', fontFeatureSettings: '"tnum"' }}>
                                    {slot.startTime}
                                </span>
                                <span style={{ ...monoCaps, color: isSelected ? GH.paper : GH.ink60 }}>
                                    {locationName(slot.locationId)}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            {bookingPanel}
        </div>
    );
}
