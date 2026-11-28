import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BellRing, CalendarDays, Info, Link as LinkIcon, Loader2, MessageCircle, Move, X } from 'lucide-react';
import { addDays, format as fmtDate } from 'date-fns';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { bookingsApi } from '../../api/bookings';
import { crmApi } from '../../api/crm';
import { LOCATIONS, RESOURCES } from '../../utils/data';
import { tbilisiNow } from '../../utils/dateUtils';
import { getFavoriteCabinet } from './favoriteCabinet';
import { LoadErrorCard, SkeletonRows } from './LoadStates';
import type { BookingHistoryItem } from '../../store/types';
import { backdateHours, canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard, SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { COLOR, RADIUS, STATUS, TEXT, Z } from '../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel, formatRelativeDay, formatWeekdayShort } from '../../utils/format';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { EmptyState } from '../../components/ui/EmptyState';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { WaitlistSubscribeModal } from '../../components/ui/WaitlistSubscribeModal';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useConfirmDialog } from '../../components/ui/ConfirmDialogProvider';
import { catalogPath } from '../../utils/catalogPath';
import { calculatePrice, isPeakTime } from '../../utils/pricing';
import { PRICING_CONFIG } from '../../utils/pricingConfig';
import { isHotStart, ymdOf } from '../../utils/bookingPolicy';
import { fmtHours, paymentPlan, subscriptionHours } from '../../utils/paymentPriority';
import { useActiveBonusHours } from '../../hooks/useActiveBonusHours';
import { isBookingAdmin } from './crmAccess';
import { resourceKind } from '../../utils/subscriptionHours';
import { useAdminFlow } from './adminFlow';
import { isLocationOpenOn } from '../../utils/locationDates';
import { BookingDetailSheet } from './BookingDetailSheet';
import { DayGrid, type GridSelection } from './DayGrid';
import { GRID_END_MIN, GRID_START_MIN, GRID_STEP_MIN, buildDayColumns, freeRunMin, roomsOpenOn, touchesReRent } from './dayGridModel';

type SpaceType = 'individual' | 'group' | 'capsule';

// Бронь — от часа до 9 часов, шаг 30 минут. Длительность выбирается на полосе
// под сеткой: там только те варианты, что помещаются от выбранного начала.
const MIN_DURATION = 60;
const MAX_DURATION = 9 * 60;
const isValidDuration = (n: number) => Number.isFinite(n) && n >= 60 && n <= MAX_DURATION && n % 30 === 0;
const ADMIN_TG_URL = 'https://t.me/UnboxCenter';

/* Последнюю выбранную длительность запоминаем на этом устройстве: касание
 * свободного времени сразу выделяет «как в прошлый раз». Хранилище может быть
 * недоступно (приватный режим, запрет сайта) — тогда час по умолчанию.
 * Раньше здесь же хранились «Где» и «Тип помещения»: с сеткой (шаг 2, 28.11)
 * фильтров нет — на экране все кабинеты, которые сдаются в выбранный день. */
const FIND_PREFS_KEY = 'unbox_find_prefs_v2';
const ALL_LOCS = ['unbox_99', 'unbox_one', 'unbox_uni'];

/** Центры, в которых ищем на этот день. Выбранные, но уже закрытые на эту дату
 *  (Палиашвили после 29.11, Абусеридзе после 30.11) отбрасываем; если так не
 *  осталось ни одного — ищем во всех работающих, чтобы человек не упёрся в
 *  пустой список из-за старой галочки. */
function locsOpenOn(locs: Set<string>, dayKey: string): Set<string> {
    const chosen = [...locs].filter(l => isLocationOpenOn(l, dayKey));
    return new Set(chosen.length ? chosen : ALL_LOCS.filter(l => isLocationOpenOn(l, dayKey)));
}
const ALL_SPACES: SpaceType[] = ['individual', 'group', 'capsule'];
// Сетка показывает все центры и все типы помещений — этими наборами считаем окна.
const EVERY_LOC: Set<string> = new Set(ALL_LOCS);
const EVERY_SPACE: Set<SpaceType> = new Set(ALL_SPACES);
/* Лента дней на самом экране (28.11, шаг 1 плана мобильной брони). По рабочему
 * сайту за 90 дней: только 11 % разовых броней делают на ближайшие сутки, 41 % —
 * за 3–7 дней, 31 % — больше чем за неделю. Раньше любой день, кроме
 * сегодняшнего, выбирался через шторку. Три недели закрывают почти все случаи,
 * дальше — «Другой день» (до 60 дней: столько сервер отдаёт занятости). */
const STRIP_DAYS = 21;
type FindPrefs = { dur?: number };

function readFindPrefs(): FindPrefs {
    try {
        const raw = localStorage.getItem(FIND_PREFS_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed as FindPrefs : {};
    } catch {
        return {};
    }
}

function writeFindPrefs(prefs: FindPrefs) {
    try {
        localStorage.setItem(FIND_PREFS_KEY, JSON.stringify(prefs));
    } catch {
        /* приватный режим / нет места — не страшно */
    }
}

/** Сколько дней от сегодня до даты (полночь к полуночи). */
function daysFromToday(d: Date): number {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    return Math.round((x.getTime() - t0.getTime()) / 86400000);
}


export function MobileFind() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { confirm: askConfirm } = useConfirmDialog();
    // Селективные селекторы — ре-рендер только на изменение нужных полей.
    const currentUser = useUserStore(s => s.currentUser);
    const users = useUserStore(s => s.users);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    // Занятость кабинетов. Пока она не загрузилась (или упала), показывать
    // кабинеты свободными нельзя: раньше при сбое /bookings/public экран
    // выдавал занятые кабинеты за свободные, и клиент узнавал об этом
    // только на оформлении («слот занят»).
    const occupancyStatus = useUserStore(s => s.occupancyStatus);
    const occupancyReady = occupancyStatus === 'ready';
    const reset = useBookingStore(s => s.reset);
    // Новую бронь сервер создаст только специалисту или админу. Остальным
    // свободные окна показываем, но вместо оформления — анкета.
    const canBook = canBookCabinets(currentUser);
    const applicationStatus = useSpecialistApplicationStatus(currentUser, !!currentUser && !canBook);

    // Reschedule mode: when ?reschedule=<id> is present, the user is moving an
    // existing booking instead of creating a new one. We re-use the same
    // free-slot search UI, but the slot-tap handler patches the booking via
    // bookingsApi.rescheduleBooking instead of going to /m/checkout.
    const rescheduleId = searchParams.get('reschedule');
    // Снимок переносимой брони. Экран при монтировании зовёт fetchBookings(),
    // который перезаписывает общий список «моими + публичными» (только
    // confirmed и ≤60 дней вперёд). Админ, переносивший чужую бронь «Ожидает»
    // или дальнюю, терял её из списка — и тап по слоту молча СОЗДАВАЛ новую
    // бронь вместо переноса (аудит мобильной админки 24.09). Держим снимок.
    const [rescheduleSnapshot, setRescheduleSnapshot] = useState<BookingHistoryItem | null>(
        () => (rescheduleId ? useUserStore.getState().bookings.find(b => b.id === rescheduleId) ?? null : null));
    const [rescheduleLookupFailed, setRescheduleLookupFailed] = useState(false);
    const liveRescheduleMatch = useMemo<BookingHistoryItem | null>(() => {
        if (!rescheduleId) return null;
        return bookings.find(b => b.id === rescheduleId) ?? null;
    }, [rescheduleId, bookings]);
    const rescheduleBooking = liveRescheduleMatch ?? rescheduleSnapshot;
    // Админ переносит чужую бронь: в общем списке у неё может не быть владельца
    // (публичная копия занятости без userId) — для имени клиента берём бронь
    // по номеру с сервера (ревью админки №2г).
    const [ownerSnapshot, setOwnerSnapshot] = useState<BookingHistoryItem | null>(null);
    useEffect(() => {
        if (!rescheduleId || !isBookingAdmin(useUserStore.getState().currentUser)) return;
        let cancelled = false;
        bookingsApi.getBookingById(rescheduleId)
            .then(found => { if (!cancelled && found) setOwnerSnapshot(found); })
            .catch(() => { /* имя клиента — не главное, перенос работает и без него */ });
        return () => { cancelled = true; };
    }, [rescheduleId]);
    useEffect(() => {
        if (liveRescheduleMatch) setRescheduleSnapshot(liveRescheduleMatch);
    }, [liveRescheduleMatch]);
    useEffect(() => {
        if (!rescheduleId || rescheduleSnapshot) return;
        const role = useUserStore.getState().currentUser?.role;
        if (role !== 'owner' && role !== 'senior_admin' && role !== 'admin') return;
        let cancelled = false;
        // 25.10: одна бронь по номеру, а не «5000 последних» (старую не находило).
        bookingsApi.getBookingById(rescheduleId)
            .then(found => {
                if (cancelled) return;
                if (found) setRescheduleSnapshot(found); else setRescheduleLookupFailed(true);
            })
            .catch(() => { if (!cancelled) setRescheduleLookupFailed(true); });
        return () => { cancelled = true; };
    }, [rescheduleId, rescheduleSnapshot]);

    // Link-session mode: when ?linkSession=<crm-session-id> is present, the
    // user came from the mobile CRM day-view's "Привязать кабинет" action.
    // Same free-slot search UI, but the slot-tap creates a booking AND links
    // it to the CRM session via crmApi.updateSession({ bookingId }). Default
    // date/duration come from the session — usually pre-filled correctly.
    const linkSessionId = searchParams.get('linkSession');
    // Снимок при входе: экран сам переписывает ?date= в ?day=N, и дата сессии
    // терялась — после брони возвращались на «Сегодня», а не на день сессии.
    const [linkSessionDate] = useState(() => searchParams.get('date') || '');
    const linkSessionMeta = useMemo(() => {
        if (!linkSessionId) return null;
        return {
            id: linkSessionId,
            date: linkSessionDate,
            time: searchParams.get('time') || '',
            duration: parseInt(searchParams.get('duration') || '60', 10) || 60,
        };
    }, [linkSessionId, linkSessionDate, searchParams]);
    const [linking, setLinking] = useState(false);

    // Persist date / duration in URL so navigating away (booking flow,
    // checkout) and coming back doesn't reset the user's selection.
    // Admins reported (2026-05-29) losing the picked date after every
    // return — chevral the entry as `?day=N` or `?date=YYYY-MM-DD`,
    // `?dur=60` so the URL is the source of truth.
    const [, setSearchParamsState] = useSearchParams();
    const initialCustomDate = (() => {
        const raw = searchParams.get('date');
        if (!raw) return null;
        const d = new Date(raw + 'T00:00:00');
        return Number.isFinite(d.getTime()) ? d : null;
    })();
    // 09.11 (ревью №1): ?date= без ?day= раньше молча игнорировался — экран
    // открывался на «Сегодня». Ближние дни — фишкой дня, дальние — «Другой».
    const initialDayOffset = (() => {
        const raw = searchParams.get('day');
        if (raw == null) {
            if (!initialCustomDate) return 0;
            const k = daysFromToday(initialCustomDate);
            return k >= 0 && k <= 8 ? k : -1;
        }
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    })();
    // День в ссылке уже задан — переносимая бронь его не перебивает.
    const [hadDayInUrl] = useState(() => searchParams.has('day') || searchParams.has('date'));
    // Запоминаем выбор только в обычном поиске: предвыбор кабинета (?cab=),
    // перенос и привязка к сессии — разовые сценарии, их не сохраняем.
    const rememberPrefs = !searchParams.get('cab') && !rescheduleId && !linkSessionId;
    const [savedPrefs] = useState<FindPrefs>(() => (rememberPrefs ? readFindPrefs() : {}));
    const initialDuration = (() => {
        const raw = searchParams.get('dur');
        if (!raw) {
            return typeof savedPrefs.dur === 'number' && isValidDuration(savedPrefs.dur) ? savedPrefs.dur : 60;
        }
        const n = Number(raw);
        return isValidDuration(n) ? n : 60;
    })();
    const [dayOffset, setDayOffset] = useState(initialDayOffset); // 0=today, 1=tomorrow, … or -1 = custom
    const [customDate, setCustomDate] = useState<Date | null>(initialDayOffset === -1 ? initialCustomDate : null);
    const [duration, setDuration] = useState(initialDuration);

    // Mirror state back to URL whenever it changes so the back-stack preserves
    // the picker. Use `replace` so we don't bloat history.
    useEffect(() => {
        const sp = new URLSearchParams(searchParams);
        if (dayOffset === -1 && customDate) {
            sp.set('date', fmtDate(customDate, 'yyyy-MM-dd'));
            sp.delete('day');
        } else if (dayOffset !== 0) {
            sp.set('day', String(dayOffset));
            sp.delete('date');
        } else {
            sp.delete('day');
            sp.delete('date');
        }
        if (duration !== 60) sp.set('dur', String(duration));
        else sp.delete('dur');
        setSearchParamsState(sp, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dayOffset, customDate, duration]);
    // Предвыбор кабинета: клиент пришёл из «Наши центры» → кабинет → «Забронировать»
    // (CabinetPage/LocationDetailsPage передают ?cab=<resourceId>). На сетке видны
    // все кабинеты дня, поэтому ничего не сужаем — имя этого кабинета выделено.
    const cabParam = searchParams.get('cab');
    useEffect(() => {
        if (rememberPrefs) writeFindPrefs({ dur: duration });
    }, [rememberPrefs, duration]);
    // Выбранное на сетке время: кабинет, начало, длительность. Полоса «Дальше»
    // внизу появляется только с ним.
    const [selection, setSelection] = useState<GridSelection | null>(null);
    // Своя бронь на сетке открывается той же шторкой, что в «Моих бронях».
    const [openBooking, setOpenBooking] = useState<BookingHistoryItem | null>(null);
    const [rescheduling, setRescheduling] = useState(false);
    // Защита от повторного тапа, пока идёт запрос привязки/переноса. Второй
    // тап по соседнему кабинету создавал ВТОРУЮ бронь (со списанием), а при
    // переносе — переносил бронь ещё раз. ref ловит тап в том же кадре, до
    // перерисовки; pendingChip — какой чип нажат (на нём крутится спиннер).
    const inFlightRef = useRef(false);
    const [pendingChip, setPendingChip] = useState<string | null>(null);
    const chipsBusy = linking || rescheduling;
    const releaseChips = () => { inFlightRef.current = false; setPendingChip(null); };

    useEffect(() => { fetchBookings(); }, [fetchBookings]);

    // When entering reschedule mode, prefill the duration from the source
    // booking — typing it again would be silly. Location filter stays loose
    // so the user can move to a different cabinet/site.
    const jumpedToBookingDay = useRef(false);
    useEffect(() => {
        if (rescheduleBooking) {
            // 28.10 (Егор): длительность переносимой брони — ровно как в брони.
            // Раньше 4 ч не было среди кнопок 1/1,5/2/3 ч, и перенос молча
            // делал из неё 1 час.
            setDuration(rescheduleBooking.duration ?? 60);
            // 09.11 (ревью №1): открываем на ДНЕ переносимой брони, а не на
            // «Сегодня» (ссылка без дня — например, из админки).
            if (!hadDayInUrl && !jumpedToBookingDay.current) {
                jumpedToBookingDay.current = true;
                const ymd = bookingDay(rescheduleBooking);
                if (ymd) jumpToDate(new Date(ymd + 'T00:00:00'));
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rescheduleBooking]);

    /** Перейти на день: ближние — фишкой, дальние — «Другой день»; прошлое — сегодня. */
    function jumpToDate(target: Date) {
        const k = daysFromToday(target);
        if (k < 0) { setDayOffset(0); setCustomDate(null); return; }
        if (k <= 8) { setDayOffset(k); setCustomDate(null); return; }
        setDayOffset(-1);
        setCustomDate(target);
    }

    // Link-session: pre-fill duration and jump to the session's date so the
    // first slot row the user sees is the correct day. We don't auto-narrow
    // the location/space filter — the user may want to consider alternative
    // cabinets near the session time.
    useEffect(() => {
        if (!linkSessionMeta) return;
        if (isValidDuration(linkSessionMeta.duration)) setDuration(linkSessionMeta.duration);
        if (linkSessionMeta.date) {
            const target = new Date(linkSessionMeta.date + 'T00:00:00');
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
            if (diffDays >= 0 && diffDays <= 8) {
                setDayOffset(diffDays);
                setCustomDate(null);
            } else {
                setDayOffset(-1);
                setCustomDate(target);
            }
        }
    }, [linkSessionMeta]);

    const targetDate = useMemo(() => {
        if (dayOffset === -1 && customDate) {
            const d = new Date(customDate);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        const d = addDays(new Date(), Math.max(0, dayOffset));
        d.setHours(0, 0, 0, 0);
        return d;
    }, [dayOffset, customDate]);

    // Админ может бронировать задним числом (сервер: _assert_start_not_past —
    // админ 12 ч, старший/владелец 72 ч; шахматка — то же окно). 12.10, чат
    // админов: с телефона прошедшее время было не выбрать вовсе. Сегодня — по
    // кнопке «Показать прошедшее время»; прошлые дни — чипами «Вчера/Задним
    // числом» (25.10, занятость догружается из админского списка).
    const backdateMin = backdateHours(currentUser) * 60;   // как сервер: админ 12 ч, старший/владелец 72
    const canBackdate = backdateMin > 0 && !rescheduleId && !linkSessionId;
    const [showPast, setShowPast] = useState(false);
    // 22.10 (Валерия Костенецкая, перенос 03.11 10:00 → 10:30): переносимая бронь
    // освобождает своё время — экран так и пишет, а окна считал с ней как с
    // занятой, и сдвиг в пределах её же часа (9:30, 10:30) не предлагался.
    // Сервер при переносе её тоже не считает (exclude_booking_id).
    const occupancy = useMemo(
        () => (rescheduleId ? bookings.filter(b => String(b.id) !== rescheduleId) : bookings),
        [bookings, rescheduleId],
    );
    // 25.10: прошлые дни задним числом (раньше — только сегодня). Дни, в которые
    // ещё дотягивается окно права (админ 12 ч, старший/владелец 72 ч), и их
    // занятость — из админского списка (ensureBookingsRange), а не «пусто».
    const pastDayOptions = useMemo(() => {
        if (!canBackdate) return [] as number[];
        const nowMin = tbilisiNow().totalMins;
        return [1, 2, 3].filter(k => nowMin - backdateMin + k * 1440 < 22 * 60);
    }, [canBackdate, backdateMin]);
    const daysBack = useMemo(() => {
        if (dayOffset !== -1 || !customDate) return 0;
        const t0 = new Date(); t0.setHours(0, 0, 0, 0);
        const k = Math.round((t0.getTime() - targetDate.getTime()) / 86400000);
        return k > 0 ? k : 0;
    }, [dayOffset, customDate, targetDate]);
    const ensureBookingsRange = useUserStore(s => s.ensureBookingsRange);
    useEffect(() => {
        if (daysBack > 0) void ensureBookingsRange(targetDate, addDays(targetDate, 1));
    }, [daysBack, targetDate, ensureBookingsRange]);
    // На какую длительность ищем НАЧАЛО. Обычная бронь: час — минимум; на сколько
    // растянуть, человек выбирает уже после касания (полоса внизу). Перенос
    // двигает бронь целиком — начало годится, только если она помещается вся.
    const searchDuration = rescheduleId ? duration : MIN_DURATION;
    const allSlots = useMemo(
        // dayOffset === 0 → сегодня. Скрываем стартовые точки которые
        // уже прошли по Тбилисскому времени. Для завтра+ — все 09:00-21:30
        // легальны.
        () => {
            // Прошлый день без права «задним числом» (чужая ссылка ?date=): сервер
            // такую бронь не создаст — не предлагаем.
            if (daysBack > 0 && backdateMin === 0) return [];
            return buildFreeWindows(occupancy, targetDate, searchDuration, EVERY_LOC, EVERY_SPACE, null, dayOffset === 0,
                                    canBackdate && (showPast || daysBack > 0) ? backdateMin : 0,
                                    canBackdate ? daysBack : 0);
        },
        [occupancy, targetDate, searchDuration, dayOffset, canBackdate, showPast, backdateMin, daysBack],
    );

    // 09.11 (ревью №1): при переносе не-админа сервер откажет, если новое время
    // в «срочном» окне (booking_policy.is_hot_start: меньше 12 ч, в выходные 24 ч,
    // после 21:00 на утро), а старое — нет. Такие окна не показываем, а над
    // списком честно пишем, что их переносит администратор.
    const isAdminActor = isBookingAdmin(currentUser);
    const restrictHot = useMemo(() => {
        if (!rescheduleBooking || isAdminActor) return false;
        const ymd = bookingDay(rescheduleBooking);
        const st = rescheduleBooking.startTime;
        if (!ymd || !st) return true;
        const [h, m] = st.split(':').map(Number);
        return !isHotStart(ymd, h * 60 + m);
    }, [rescheduleBooking, isAdminActor]);
    const targetYmd = ymdOf(targetDate);
    const hotHidden = useMemo(
        () => (restrictHot ? allSlots.filter(x => isHotStart(targetYmd, x.startMin)) : []),
        [restrictHot, allSlots, targetYmd],
    );
    // Дальше по экрану «окна» — только те, что можно выбрать (без срочных при переносе).
    const slots = useMemo(
        () => (hotHidden.length ? allSlots.filter(x => !hotHidden.includes(x)) : allSlots),
        [allSlots, hotHidden],
    );
    const hotUntil = hotHidden.length ? minsToHm(hotHidden[hotHidden.length - 1].startMin) : null;

    // Лента дней: есть ли в каждом из ближайших дней свободное начало — по тем же
    // правилам, что сетка ниже (иначе чип обещал бы время, которого на сетке
    // нет): при переносе — под длительность брони и без «срочных» окон,
    // у админа — с прошедшим временем сегодня, если он его открыл.
    // Занятость раскладываем по дням один раз, а не перебираем весь список на каждый день.
    const occupancyByDay = useMemo(() => {
        const m = new Map<string, BookingHistoryItem[]>();
        for (const b of occupancy) {
            // completed — бронь уже прошла (в базе она по-прежнему confirmed, и сервер
            // считает её при проверке пересечений): у админа «задним числом» прошедший
            // день иначе выглядел пустым. Расчёт окон (buildFreeWindows) их сам отбросит.
            if (b.status !== 'confirmed' && b.status !== 'pending_approval' && b.status !== 'completed') continue;
            const k = bookingDay(b);
            if (!k) continue;
            const arr = m.get(k);
            if (arr) arr.push(b); else m.set(k, [b]);
        }
        return m;
    }, [occupancy]);
    // Ключ сегодняшнего дня — чтобы после полуночи лента пересчиталась, а не
    // подписывала вчерашний день «Сегодня».
    const todayKey = fmtDate(new Date(), 'yyyy-MM-dd');
    const stripDays = useMemo(() => {
        const out: { k: number; date: Date; key: string; free: number }[] = [];
        for (let k = 0; k < STRIP_DAYS; k++) {
            const d = addDays(new Date(todayKey + 'T00:00:00'), k);
            const key = fmtDate(d, 'yyyy-MM-dd');
            const windows = buildFreeWindows(occupancyByDay.get(key) ?? [], d, searchDuration, EVERY_LOC, EVERY_SPACE, null, k === 0,
                                             k === 0 && canBackdate && showPast ? backdateMin : 0);
            const free = restrictHot ? windows.filter(w => !isHotStart(key, w.startMin)).length : windows.length;
            out.push({ k, date: d, key, free });
        }
        return out;
    }, [occupancyByDay, searchDuration, todayKey, canBackdate, showPast, backdateMin, restrictHot]);
    const targetKey = fmtDate(targetDate, 'yyyy-MM-dd');
    const targetInStrip = stripDays.some(x => x.key === targetKey) || (daysBack > 0 && pastDayOptions.includes(daysBack));
    /** Ближайший день после выбранного, где есть свободное время (для пустого дня). */
    const nextFreeDay = useMemo(
        () => stripDays.find(x => x.date.getTime() > targetDate.getTime() && x.free > 0) ?? null,
        [stripDays, targetDate],
    );
    // Выбранный день всегда на виду: лента сама подъезжает к нему (первый раз — без анимации).
    const stripRef = useRef<HTMLDivElement>(null);
    const stripScrolled = useRef(false);
    useEffect(() => {
        const box = stripRef.current;
        if (!box) return;
        const el = box.querySelector<HTMLElement>('[data-day-selected="true"]');
        if (!el) return;
        const left = Math.max(0, el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2);
        const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        box.scrollTo({ left, behavior: stripScrolled.current && !reduce ? 'smooth' : 'auto' });
        stripScrolled.current = true;
    }, [targetKey]);

    // ── Сетка дня (шаг 2, 28.11): кабинеты колонками, занятое видно. ──
    const isOwnBooking = (b: BookingHistoryItem) =>
        !!currentUser && (b.userId === currentUser.email || (b as { userUuid?: string }).userUuid === currentUser.id);
    const gridRooms = useMemo(() => roomsOpenOn(targetKey, ALL_LOCS), [targetKey]);
    const columns = useMemo(
        () => buildDayColumns(occupancyByDay.get(targetKey) ?? [], gridRooms, isOwnBooking),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [occupancyByDay, targetKey, gridRooms, currentUser?.id, currentUser?.email],
    );
    const showCenter = new Set(gridRooms.map(r => r.locationId)).size > 1;
    // Где можно НАЧАТЬ — решает тот же расчёт, что был у списка (slots): сетка
    // только рисует день. Ключ — «минута|кабинет».
    const startable = useMemo(() => {
        const set = new Set<string>();
        for (const w of slots) for (const rid of w.freeResIds) set.add(`${w.startMin}|${rid}`);
        return set;
    }, [slots]);
    // До какой минуты время «прошло» (те же границы, что в buildFreeWindows):
    // сегодня — до текущей минуты (у админа с открытым прошедшим — минус его
    // окно «задним числом»), прошлый день — по окну админа, будущий — ничего.
    const nowMin = tbilisiNow().totalMins;
    const pastUntilMin = daysBack > 0
        ? (backdateMin === 0 ? Infinity : canBackdate ? Math.max(0, nowMin - backdateMin + daysBack * 1440) : 0)
        : dayOffset === 0 ? Math.max(0, nowMin - (canBackdate && showPast ? backdateMin : 0)) : 0;
    // Сегодня день рисуем с текущего часа: прошедшее утро — пустая прокрутка.
    // Админ, открывший прошедшее время, и прошлые дни видят день целиком.
    const firstRowMin = dayOffset === 0 && !(canBackdate && showPast)
        ? Math.max(GRID_START_MIN, Math.min(Math.floor(nowMin / 60) * 60, GRID_END_MIN))
        : GRID_START_MIN;
    const gridHasRows = gridRooms.length > 0 && firstRowMin < GRID_END_MIN;
    // Пиковые часы: надбавка за час — на шкале времени и в подписи под сеткой.
    const isPeakMin = (t: number) => isPeakTime(minsToHHMM(t));
    const peakTag = `+${formatGel(PRICING_CONFIG.peak_hours.surcharge_per_hour_gel, { fraction: 'auto' })}`;
    const peakVisible = useMemo(() => {
        for (let t = firstRowMin; t < GRID_END_MIN; t += GRID_STEP_MIN) if (isPeakTime(minsToHHMM(t))) return true;
        return false;
    }, [firstRowMin]);
    // Цена часа — до касания (раньше она стояла на каждой кнопке списка): «Час — 20 ₾,
    // с пометкой «+5 ₾» — 25 ₾». Ставки — из данных кабинетов и настроек цен.
    const priceHint = useMemo(() => {
        const rates = gridRooms.map(r => r.hourlyRate).filter(n => Number.isFinite(n));
        if (rates.length === 0) return '';
        const min = Math.min(...rates);
        const from = rates.every(n => n === min) ? '' : 'от ';
        const hour = `Час — ${from}${formatGel(min, { fraction: 'auto' })}`;
        if (!peakVisible) return `${hour}.`;
        const peak = formatGel(min + PRICING_CONFIG.peak_hours.surcharge_per_hour_gel, { fraction: 'auto' });
        return `${hour}, с пометкой «${peakTag}» — ${from}${peak}.`;
    }, [gridRooms, peakVisible, peakTag]);
    // День сменили или время заняли, пока человек выбирал, — выделение снимаем.
    useEffect(() => { setSelection(null); }, [targetKey]);
    useEffect(() => {
        if (!selection || inFlightRef.current) return;
        const col = columns.find(c => c.room.id === selection.roomId);
        if (!col || freeRunMin(col, selection.startMin, selection.duration) < selection.duration) setSelection(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [columns]);
    const selCol = selection ? columns.find(c => c.room.id === selection.roomId) ?? null : null;
    /** Длительности, которые помещаются от выбранного начала (до ближайшей брони или закрытия). */
    const fitDurations = useMemo(() => {
        if (!selection || !selCol) return [] as number[];
        const run = freeRunMin(selCol, selection.startMin, MAX_DURATION);
        const out: number[] = [];
        for (let d = MIN_DURATION; d <= run; d += GRID_STEP_MIN) out.push(d);
        return out;
    }, [selection, selCol]);

    // Админ-бронь / админ-перенос (ревью админки №2): для кого — в полоске внизу
    // и в плашке переноса; после переноса чужой брони — обратно в админку.
    const adminFlow = useAdminFlow(s => s.active) && isAdminActor;
    const setAdminForName = useAdminFlow(s => s.setForName);
    const bookingForUser = useBookingStore(s => s.bookingForUser);
    const fetchUsers = useUserStore(s => s.fetchUsers);
    const ownerSource = (ownerSnapshot && ownerSnapshot.id === rescheduleBooking?.id ? ownerSnapshot : null)
        ?? (rescheduleBooking?.userId ? rescheduleBooking : null);
    const rescheduleIsForeign = !!ownerSource && !!currentUser
        && ownerSource.userId !== currentUser.email
        && (ownerSource as { userUuid?: string }).userUuid !== currentUser.id;
    useEffect(() => {
        if (isAdminActor && (rescheduleIsForeign || bookingForUser) && users.length === 0) fetchUsers().catch(() => {});
    }, [isAdminActor, rescheduleIsForeign, bookingForUser, users.length, fetchUsers]);
    const rescheduleOwnerName = rescheduleIsForeign && ownerSource
        ? (users.find(u => u.email === ownerSource.userId || u.id === (ownerSource as { userUuid?: string }).userUuid)?.name
            || ownerSource.userId || null)
        : null;
    const forName = rescheduleBooking
        ? (rescheduleIsForeign ? rescheduleOwnerName : (currentUser?.name ?? null))
        : bookingForUser
            ? (users.find(u => u.email === bookingForUser || u.id === bookingForUser)?.name || bookingForUser)
            : null;
    useEffect(() => {
        if (adminFlow) setAdminForName(forName);
    }, [adminFlow, forName, setAdminForName]);
    const afterRescheduleTo = adminFlow || rescheduleIsForeign ? '/m/admin/bookings' : '/m/bookings';

    // Цена выбранного времени (ревью №5): фактическая, с пиком; у залов —
    // «от … · группа …». Та же функция, что на оформлении (calculatePrice),
    // со своей персональной скидкой. Недельную скидку покажет оформление.
    // Админ-бронь «за другого»: скидка — того, для кого бронь (как на оформлении),
    // а пока клиент не выбран — без личной скидки. Раньше админ видел цену со
    // СВОЕЙ скидкой, а клиенту на оформлении выходила другая.
    const priceUser = adminFlow
        ? (bookingForUser ? users.find(u => u.email === bookingForUser || u.id === bookingForUser) ?? null : null)
        : currentUser;
    const windowPrice = (startMin: number, rid: string, durMin: number): { main: string; group: string | null; peak: number } | null => {
        const r = RESOURCES.find(x => x.id === rid);
        if (!r) return null;
        const start = new Date(targetDate); start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        const end = new Date(start.getTime() + durMin * 60000);
        const price = (format: 'individual' | 'group') => calculatePrice({
            format, startTime: start, endTime: end, extras: [], resourceId: rid,
            personalDiscountPercent: priceUser?.personalDiscountPercent,
            pricingSystem: priceUser?.pricingSystem,
        });
        const fmt = (n: number) => formatGel(n, { fraction: 'auto' });
        const ind = price('individual');
        const isHall = r.type !== 'capsule' && (r.capacity ?? 4) > 4 && (r.formats?.includes('group') ?? false);
        // Формат (индивидуально / группа) выбирается на оформлении — здесь обе цены.
        // Надбавка за пик — из самого расчёта: она уже внутри цены.
        return {
            main: fmt(ind.finalPrice),
            group: isHall ? fmt(price('group').finalPrice) : null,
            peak: ind.finalPrice > 0 ? (ind.peakSurcharge ?? 0) : 0,
        };
    };

    // «Сообщить, когда освободится» (G4-06, X2-08): касание занятого времени на
    // сетке — подписка на это время через общее окно WaitlistSubscribeModal.
    // Раньше время и кабинет выбирались двумя списками под результатами.
    const waitlistEnabled = canBook && !rescheduleId && !linkSessionMeta;
    const [waitlistPick, setWaitlistPick] = useState<{ roomId: string; startMin: number; endMin: number } | null>(null);
    const wlRoom = waitlistPick ? RESOURCES.find(r => r.id === waitlistPick.roomId) : undefined;

    const title = linkSessionMeta ? 'Привязать кабинет' : rescheduleId ? 'Перенести' : 'Свободно';
    useDocumentTitle(title);

    // crm-ux №9 (09.11): под сессию CRM — сначала короткое подтверждение с ценой
    // и тем, чем заплатим, а не бронь с одного касания по слоту.
    const [linkPick, setLinkPick] = useState<{ startMin: number; resourceId: string; duration: number } | null>(null);

    const bonusHoursAvail = useActiveBonusHours(linkSessionMeta ? currentUser?.id : null, false);
    /** Сводка для шторки «Забронировать и привязать»: цена, чем заплатим, срочность. */
    const linkSummary = useMemo(() => {
        if (!linkPick) return null;
        const r = RESOURCES.find(x => x.id === linkPick.resourceId);
        const format = ((r?.formats?.[0] as 'individual' | 'group' | 'intervision') || 'individual');
        const start = new Date(targetDate); start.setHours(Math.floor(linkPick.startMin / 60), linkPick.startMin % 60, 0, 0);
        const end = new Date(start.getTime() + linkPick.duration * 60000);
        const price = calculatePrice({
            format, startTime: start, endTime: end, extras: [], resourceId: linkPick.resourceId,
            personalDiscountPercent: currentUser?.personalDiscountPercent, pricingSystem: currentUser?.pricingSystem,
        });
        const hours = linkPick.duration / 60;
        const sub = subscriptionHours(currentUser?.subscription, {
            format, bookingDate: targetDate, bookings, ownerEmail: currentUser?.email,
            resourceKind: resourceKind(linkPick.resourceId), liftPause: true,
        });
        // Сервер сам выбирает: бонус → абонемент → баланс (оплата «balance» = «реши сам»).
        // 17.11 (владелец): подарок — первые часы, остаток по обычной цене (tail).
        const plan = paymentPlan({
            hours, bonusHours: bonusHoursAvail, sub, moneyPrice: price.finalPrice,
            items: [{
                hours, price: price.finalPrice, start,
                tail: (c: number) => calculatePrice({
                    format, startTime: new Date(start.getTime() + Math.round(c * 60) * 60000), endTime: end,
                    extras: [], resourceId: linkPick.resourceId,
                    personalDiscountPercent: currentUser?.personalDiscountPercent, pricingSystem: currentUser?.pricingSystem,
                }).finalPrice,
            }],
        });
        const peak = price.peakSurcharge ?? 0;
        const pay = plan.auto === 'bonus'
            ? (plan.bonusPays
                ? `${fmtHours(plan.bonusCovered)} бонусом + ${formatGel(plan.bonusMoney)} с баланса`
                : `${fmtHours(hours)} бонусных часов`)
            : plan.auto === 'subscription'
                ? `${fmtHours(hours)} абонемента${peak > 0 ? ` + ${formatGel(peak)} за пиковые часы` : ''}`
                : `${formatGel(price.finalPrice)} с баланса`;
        const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours() - 4, start.getMinutes());
        const hot = !isAdminActor && isHotStart(ymdOf(targetDate), linkPick.startMin);
        const deferred = startMs - Date.now() > 24 * 3600 * 1000;
        return {
            room: [r?.name ?? linkPick.resourceId, LOCATIONS.find(l => l.id === r?.locationId)?.name].filter(Boolean).join(' · '),
            time: `${formatDayMonth(targetDate)}, ${minsToHHMM(linkPick.startMin)}–${minsToHHMM(linkPick.startMin + linkPick.duration)}`,
            price: formatGel(price.finalPrice),
            pay,
            hot,
            when: hot ? 'спишем, когда администратор подтвердит' : deferred ? 'спишем за сутки до начала' : 'спишем сразу',
        };
    }, [linkPick, targetDate, currentUser, bookings, bonusHoursAvail, isAdminActor]);

    // Перенос: где бронь стоит сейчас — обводим на сетке её дня.
    const oldPlace = (() => {
        if (!rescheduleBooking || bookingDay(rescheduleBooking) !== targetKey || !rescheduleBooking.startTime) return null;
        const [h, m] = rescheduleBooking.startTime.split(':').map(Number);
        const startMin = h * 60 + m;
        return { roomId: String(rescheduleBooking.resourceId ?? ''), startMin, endMin: startMin + (rescheduleBooking.duration ?? 60) };
    })();
    // Полоса с выбранным временем: длительность, цена, «Дальше». При переносе её
    // нет — касание сразу показывает «было → станет».
    const barOpen = !!selection && !!selCol && !rescheduleId && occupancyReady;
    const selPrice = selection ? windowPrice(selection.startMin, selection.roomId, selection.duration) : null;
    // Что ограничивает длительность от выбранного начала: чужая бронь или закрытие.
    const selLimit = (() => {
        if (!selection || !selCol) return '';
        const run = freeRunMin(selCol, selection.startMin, MAX_DURATION);
        if (run >= MAX_DURATION) return '';
        const until = selection.startMin + run;
        const why = until >= GRID_END_MIN ? `центр закрывается в ${minsToHm(GRID_END_MIN)}` : `с ${minsToHm(until)} занято`;
        // Привычная длительность (под сессию CRM — длительность сессии) не
        // поместилась — говорим прямо, а не молча укорачиваем.
        if (duration > run) {
            return linkSessionMeta
                ? `Сессия — ${formatBookingDuration(duration)}, но ${why}: кабинет получится короче.`
                : `Обычно вы берёте ${formatBookingDuration(duration)}, но ${why}.`;
        }
        return fitDurations.length <= 4 ? `Дольше нельзя: ${why}.` : '';
    })();

    /** Касание свободного времени на сетке. */
    function pickFree(roomId: string, startMin: number) {
        if (chipsBusy || inFlightRef.current) return;
        const col = columns.find(c => c.room.id === roomId);
        if (!col) return;
        const run = freeRunMin(col, startMin, MAX_DURATION);
        // Начать можно, если так считает расчёт окон И на сетке хватает места
        // (бронь с началом в :15/:45 расчёт окон не видит, а сетка закрывает
        // оба соседних получаса — верим более строгому).
        if (!startable.has(`${startMin}|${roomId}`) || run < searchDuration) {
            // Свободно, но начать здесь нельзя — говорим почему.
            if (rescheduleId && run < searchDuration) {
                toast.info(`${col.room.name}: бронь на ${formatBookingDuration(searchDuration)} сюда не помещается — свободно до ${minsToHm(startMin + run)}.`);
            } else if (run < MIN_DURATION) {
                toast.info(`${col.room.name}: с ${minsToHm(startMin)} свободно только полчаса. Бронь — от часа, начните раньше.`);
            } else {
                toast.info('Это время выбрать нельзя.');
            }
            return;
        }
        if (rescheduleId) {
            // Перенос: длительность — как в брони; сразу «было → станет». Пока сама
            // бронь не загрузилась, ничего не выделяем — chooseWindow скажет подождать.
            if (rescheduleBooking) setSelection({ roomId, startMin, duration: searchDuration });
            void chooseWindow(startMin, roomId, searchDuration);
            return;
        }
        // Обычная бронь: привычная длительность, но не длиннее свободного отрезка.
        setSelection({ roomId, startMin, duration: Math.max(MIN_DURATION, Math.min(duration, run)) });
    }

    /** Другая длительность на полосе под сеткой — её же запоминаем на следующий раз. */
    function pickDuration(d: number) {
        if (!selection || chipsBusy) return;
        setSelection({ ...selection, duration: d });
        setDuration(d);
    }

    /** Касание занятого времени: подписка «сообщить, когда освободится». Время
     *  предсказуемое — ровно тот час, в который попал палец (а не «получас под
     *  пальцем плюс привычная длительность»): в окне подписки его не поправить. */
    function pickBusy(roomId: string, startMin: number) {
        let from = Math.floor(startMin / 60) * 60;
        while (from <= pastUntilMin && from < GRID_END_MIN) from += GRID_STEP_MIN;
        const to = Math.min(from + 60, GRID_END_MIN);
        if (to - from < GRID_STEP_MIN) return;
        setWaitlistPick({ roomId, startMin: from, endMin: to });
    }

    /** «Дальше» на полосе: под сессию CRM — сначала шторка подтверждения (crm-ux №9). */
    function pickWindow(startMin: number, resourceId: string, durMin: number) {
        if (!resourceId || inFlightRef.current) return;
        if (linkSessionMeta) { setLinkPick({ startMin, resourceId, duration: durMin }); return; }
        void chooseWindow(startMin, resourceId, durMin);
    }

    async function chooseWindow(startMin: number, resourceId: string, durMin: number) {
        if (!resourceId) return;
        if (inFlightRef.current) return;
        // Link-session path: create the booking (server picks bonus →
        // subscription → balance) and link it to the source CRM session.
        // Failures during the link don't roll back the booking — the user
        // can re-attach from the desktop CRM if needed.
        if (linkSessionMeta) {
            inFlightRef.current = true;
            setPendingChip(`${startMin}|${resourceId}`);
            setLinking(true);
            let left = false;
            try {
                const resource = RESOURCES.find(r => r.id === resourceId);
                const created = await bookingsApi.createBooking({
                    resourceId,
                    locationId: resource?.locationId || 'unbox_one',
                    // Строкой «ГГГГ-ММ-ДД», как в оформлении: объект Date уходил
                    // отметкой UTC с поясом, и сервер падал 500 (обход 10.10).
                    date: fmtDate(targetDate, 'yyyy-MM-dd') as unknown as Date,
                    startTime: minsToHHMM(startMin),
                    duration: durMin,
                    format: (resource?.formats?.[0] as 'individual' | 'group' | 'intervision') || 'individual',
                    paymentMethod: 'balance',
                    extras: [],
                });
                try {
                    // Та же привязка, что «Объединить» на компьютере: booking_id +
                    // is_booked + клиент в брони. Раньше слали только bookingId —
                    // телефон смотрит на is_booked и показывал «Без кабинета» с
                    // кнопкой «Забронировать кабинет» (вторая бронь; обход 10.10).
                    await crmApi.acceptMergeSuggestion(linkSessionMeta.id, created.id);
                } catch (linkErr) {
                    console.warn('CRM link failed (booking created)', linkErr);
                    toast.warning('Бронь создана, но привязать к сессии не получилось');
                }
                // Срочная бронь уходит админу на одобрение — так и говорим.
                if ((created as { status?: string }).status === 'pending_approval') {
                    toast.success('Отправили админу на подтверждение — кабинет за вами, пока он решает. Сессия привязана.', { duration: 6000 });
                } else {
                    toast.success('Кабинет забронирован и привязан');
                }
                setLinkPick(null);
                navigate(`/m/crm/today${linkSessionMeta.date ? `?date=${linkSessionMeta.date}` : ''}`, { replace: true });
                left = true;
            } catch (e: unknown) {
                const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                const msg = typeof detail === 'string' ? detail : ((e as Error)?.message || 'Не удалось забронировать');
                toast.error(msg);
            } finally {
                // После успеха уходим с экрана — чипы не разблокируем, чтобы
                // тап в этот момент не создал вторую бронь.
                if (!left) { setLinking(false); releaseChips(); }
            }
            return;
        }

        // Reschedule path: PATCH the existing booking instead of creating a
        // new one. Backend handles GCal sync, balance reconciliation, and
        // (if applicable) propagation through a series.
        if (rescheduleBooking) {
            // Обход мобильной версии 10.10: перенос шёл с одного касания — случайный
            // тап по соседнему кабинету (зал 30 ₾/ч вместо 20) переносил бронь
            // молча. Теперь — короткое «было → станет».
            inFlightRef.current = true;
            const oldRes = RESOURCES.find(r => r.id === rescheduleBooking.resourceId);
            const newRes = RESOURCES.find(r => r.id === resourceId);
            const oldStart = rescheduleBooking.startTime || '';
            const oldDay = rescheduleBooking.date ? formatDayMonth(rescheduleBooking.date) : '';
            const rateNote = oldRes && newRes && oldRes.hourlyRate !== newRes.hourlyRate
                ? `${newRes.name} — ${formatGel(newRes.hourlyRate)}/ч (было ${formatGel(oldRes.hourlyRate)}/ч). `
                : '';
            // 09.11 (ревью №1): что изменится — словами, до нажатия.
            const changes: string[] = [];
            const moveMin = rescheduleBooking.duration ?? durMin;
            const newStart = new Date(targetDate); newStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
            const newStartMs = Date.UTC(newStart.getFullYear(), newStart.getMonth(), newStart.getDate(),
                newStart.getHours() - 4, newStart.getMinutes());
            const hoursToNew = (newStartMs - Date.now()) / 3600000;
            const oldYmd = bookingDay(rescheduleBooking);
            const [oh, om] = oldStart.split(':').map(Number);
            const oldStartMs = oldYmd
                ? Date.UTC(+oldYmd.slice(0, 4), +oldYmd.slice(5, 7) - 1, +oldYmd.slice(8, 10), (oh || 0) - 4, om || 0)
                : NaN;
            const hoursToOld = (oldStartMs - Date.now()) / 3600000;
            if (!isAdminActor && Number.isFinite(hoursToOld) && hoursToOld < 24) {
                changes.push('Потратится один бесплатный перенос по абонементу.');
            }
            if (!isAdminActor && hoursToNew < 24) {
                changes.push('До нового времени меньше суток — отменить бронь потом будет нельзя, только «Пересдать».');
            }
            // Публичная копия занятости без цены и способа оплаты — берём полную бронь.
            const src = ownerSource ?? rescheduleBooking;
            if (!src.paymentMethod && !(Number(src.finalPrice) > 0)) {
                changes.push('Цена пересчитается по новому времени.');
            } else if (src.paymentMethod === 'subscription') {
                changes.push('Оплата — часами абонемента, как и раньше; пиковая доплата пересчитается по новому времени.');
            } else if (src.paymentMethod === 'bonus') {
                changes.push('Оплата бонусом сохранится; цена пересчитается по новому времени.');
            } else {
                const newPrice = calculatePrice({
                    format: (src.format as 'individual' | 'group' | 'intervision') || 'individual',
                    startTime: newStart, endTime: new Date(newStart.getTime() + moveMin * 60000), extras: [],
                    resourceId,
                    // Скидка — того, чья бронь (админ переносит чужую — не своя).
                    personalDiscountPercent: rescheduleIsForeign ? undefined : currentUser?.personalDiscountPercent,
                    pricingSystem: rescheduleIsForeign ? undefined : currentUser?.pricingSystem,
                }).finalPrice;
                const oldPrice = Number(src.finalPrice) || 0;
                if (Math.abs(newPrice - oldPrice) >= 0.5) {
                    changes.push(`Цена станет ≈ ${formatGel(newPrice)} (было ${formatGel(oldPrice)}): ${newPrice > oldPrice ? 'разницу спишем с баланса' : 'разницу вернём на баланс'}.`);
                } else {
                    changes.push('Цена та же.');
                }
            }
            const ok = await askConfirm({
                title: 'Перенести бронь?',
                body: (
                    <>
                        {rescheduleOwnerName && <div style={{ fontWeight: 600, marginBottom: 4 }}>Бронь: {rescheduleOwnerName}</div>}
                        <div>Было: {oldDay} в {oldStart} · {oldRes?.name ?? rescheduleBooking.resourceId}</div>
                        <div style={{ fontWeight: 600, marginTop: 4 }}>
                            Станет: {formatDayMonth(targetDate)} в {minsToHHMM(startMin)} · {newRes?.name ?? resourceId}
                        </div>
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: COLOR.ink80, display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {rateNote && <li>{rateNote.trim()}</li>}
                            {changes.map(c => <li key={c}>{c}</li>)}
                        </ul>
                    </>
                ),
                confirmLabel: 'Перенести',
            });
            if (!ok) { inFlightRef.current = false; setSelection(null); return; }
            setPendingChip(`${startMin}|${resourceId}`);
            setRescheduling(true);
            let left = false;
            try {
                await bookingsApi.rescheduleBooking(rescheduleBooking.id, {
                    newDate: fmtDate(targetDate, 'yyyy-MM-dd'),
                    newStartTime: minsToHHMM(startMin),
                    newResourceId: resourceId,
                    // 28.10 (Егор): перенос двигает бронь ЦЕЛИКОМ — длительность
                    // всегда из самой брони (кнопок длительности при переносе
                    // больше нет). Заменяет правило 02.06 «длительность из UI».
                    newDuration: moveMin,
                });
                await fetchBookings();
                toast.success(rescheduleOwnerName ? `Бронь перенесена: ${rescheduleOwnerName}` : 'Бронь перенесена');
                navigate(afterRescheduleTo, { replace: true });
                left = true;
            } catch (e: any) {
                const detail = e?.response?.data?.detail;
                const msg = typeof detail === 'string' ? detail
                    : (detail?.conflicts ? `Конфликт: ${detail.conflicts.map((c: any) => c.date).join(', ')}` : (e.message || 'Не удалось перенести'));
                toast.error(msg);
            } finally {
                if (!left) { setRescheduling(false); releaseChips(); setSelection(null); }
            }
            return;
        }

        // В режиме переноса новую бронь не создаём никогда: если исходную
        // бронь не удалось загрузить — честно говорим об этом.
        if (rescheduleId) {
            toast.error(rescheduleLookupFailed
                ? 'Бронь для переноса не найдена — возможно, её уже отменили. Обновите список броней.'
                : 'Загружаем бронь для переноса — попробуйте через секунду.');
            return;
        }

        // Normal create path → /m/checkout.
        // Не специалист — оформление закончилось бы отказом сервера (403).
        // Не ведём на /m/checkout, а сразу показываем дорогу к анкете.
        if (!canBook) {
            if (applicationStatus === 'pending') {
                toast.info('Анкета на проверке — бронирование откроется после одобрения');
            } else if (applicationStatus === 'approved') {
                toast.info('Анкета одобрена — доступ к бронированию скоро откроет администратор');
            } else {
                toast.info('Чтобы бронировать, заполните анкету специалиста', {
                    action: { label: 'Анкета', onClick: () => navigate(catalogPath(SPECIALIST_APPLICATION_PATH, true)) },
                });
            }
            return;
        }

        const slotStrs: string[] = [];
        for (let m = startMin; m < startMin + durMin; m += 30) {
            slotStrs.push(`${resourceId}|${minsToHHMM(m)}`);
        }
        const resource = RESOURCES.find(r => r.id === resourceId);
        // reset() стирал и «за кого бронь» — клиент, выбранный в карточке
        // клиента админки, терялся на выборе слота (ревью админки №2).
        const keepFor = adminFlow ? useBookingStore.getState().bookingForUser : null;
        reset();
        useBookingStore.setState({
            bookingForUser: keepFor,
            locationId: resource?.locationId || 'unbox_one',
            date: targetDate,
            format: (resource?.formats?.[0] as any) || 'individual',
            selectedSlots: slotStrs,
            step: 3,
        });
        navigate('/m/checkout');
    }

    return (
        <>
            <div style={{
                // С открытой полосой — запас снизу, чтобы вечерние часы не прятались под ней.
                paddingBottom: barOpen
                    ? 'calc(300px + env(safe-area-inset-bottom, 0px))'
                    : 'calc(24px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 16,
            }}>
                {/* 09.11 фаза 3: общая крупная шапка. Отдельного «Календаря» больше
                    нет (шаг 2, 28.11): день по кабинетам — прямо здесь, на сетке. */}
                <MobilePageHeader
                    variant="large"
                    title={title}
                    subtitle={(linkSessionMeta || rescheduleId)
                        ? (linkSessionMeta
                            ? 'Выберите свободное время — забронируем и привяжем к сессии.'
                            : 'Выберите новое время — прежнее освободится после переноса.')
                        : undefined}
                />

                {/* Ещё не специалист — наверху объясняем, почему оформить бронь
                    пока нельзя, и даём дорогу к анкете (до выбора времени). */}
                {!canBook && !rescheduleId && !linkSessionMeta && (
                    <div style={{ padding: '0 16px' }}>
                        <SpecialistGateCard variant="mobile" status={applicationStatus} />
                    </div>
                )}

                {/* 2026-06-06 owner: админ может попасть на /m/find через
                    FAB из /m/admin/bookings, чтобы создать бронь от имени
                    клиента. UI поиска слота идентичен клиентскому, поэтому
                    подскажем что admin-flow продолжится — picker «За кого
                    бронируете?» появится на /m/checkout. Без подсказки
                    админ ловит когнитивный диссонанс «куда меня кинуло».
                    Не показываем для reschedule/linkSession — у них свои
                    баннеры. */}
                {/* 09.11: только в админ-брони (пришли из админки), а не когда
                    админ бронирует себе своими вкладками. */}
                {!rescheduleBooking && !linkSessionMeta && adminFlow && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: STATUS.pending.bg,
                            border: `1px solid ${STATUS.pending.fg}33`,
                            color: STATUS.pending.fg,
                            borderRadius: RADIUS.control,
                            padding: '10px 12px',
                            fontSize: TEXT.small,
                            lineHeight: 1.45,
                        }}>
                            <strong>Админ-бронь{forName ? ` для: ${forName}` : ''}.</strong>{' '}
                            {forName
                                ? 'Выберите время — на следующем шаге проверите оплату.'
                                : 'Выберите время — на следующем шаге выберите, для кого бронь (поиск по имени, телефону, почте).'}
                        </div>
                    </div>
                )}

                {/* Reschedule banner — what booking we're moving and a way to bail out. */}
                {rescheduleBooking && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: STATUS.pending.bg,
                            border: `1px solid ${STATUS.pending.fg}33`,
                            color: STATUS.pending.fg,
                            borderRadius: RADIUS.control,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <Move size={18} />
                            <div style={{ flex: 1, fontSize: TEXT.small, lineHeight: 1.4 }}>
                                <b>Переносим{rescheduleOwnerName ? ` бронь: ${rescheduleOwnerName}` : ''}:</b>{' '}
                                {rescheduleBooking.date && formatDayMonth(rescheduleBooking.date)}
                                {' '}в {rescheduleBooking.startTime}
                                {' · '}
                                {RESOURCES.find(r => r.id === rescheduleBooking.resourceId)?.name ?? rescheduleBooking.resourceId}
                            </div>
                            <button
                                onClick={() => navigate(afterRescheduleTo)}
                                aria-label="Отменить перенос"
                                style={{ ...bannerCloseBtn, color: STATUS.pending.fg }}
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Link-session banner — surfaces the source CRM session so the
                    user can verify before tapping a slot. */}
                {linkSessionMeta && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: STATUS.info.bg,
                            border: `1px solid ${STATUS.info.fg}33`,
                            color: STATUS.info.fg,
                            borderRadius: RADIUS.control,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <LinkIcon size={18} />
                            <div style={{ flex: 1, fontSize: TEXT.small, lineHeight: 1.4 }}>
                                <b>Привязываем кабинет к сессии:</b>{' '}
                                {linkSessionMeta.date ? formatDayMonth(linkSessionMeta.date) : ''} в {linkSessionMeta.time} · {linkSessionMeta.duration % 30 === 0 && linkSessionMeta.duration >= 60 ? formatBookingDuration(linkSessionMeta.duration) : `${linkSessionMeta.duration} мин`}
                            </div>
                            <button
                                onClick={() => navigate(`/m/crm/today${linkSessionMeta.date ? `?date=${linkSessionMeta.date}` : ''}`)}
                                aria-label="Отменить привязку"
                                style={{ ...bannerCloseBtn, color: STATUS.info.fg }}
                            >
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                )}

                {/* Лента дней (28.11): день меняется одним касанием прямо на экране.
                    День, где свободного часа нет (при переносе — куда бронь не
                    помещается), помечен «занято» — его видно заранее, а не после
                    нажатия. «Другой день» закреплён справа: до него не нужно
                    листать три недели. У админа слева — прошлые дни «задним числом». */}
                <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, paddingRight: 16 }}>
                    <div
                        ref={stripRef}
                        role="group"
                        aria-label="День"
                        className="ui-chip-row ui-chip-row--scroll"
                        style={{ position: 'relative', flex: 1, minWidth: 0, gap: 8, padding: '0 24px 2px 16px' }}
                    >
                        {pastDayOptions.slice().reverse().map(k => {
                            const d = addDays(new Date(todayKey + 'T00:00:00'), -k);
                            const active = daysBack === k;
                            return (
                                <Chip
                                    key={`past-${k}`}
                                    selected={active}
                                    data-day-selected={active ? 'true' : undefined}
                                    onClick={() => { setCustomDate(d); setDayOffset(-1); }}
                                    aria-label={`${k === 1 ? 'Вчера' : formatWeekdayShort(d)}, ${formatDayMonth(d)} — задним числом`}
                                    style={{ ...dayChip, flex: '0 0 auto', minWidth: 68 }}
                                >
                                    <span style={{ fontWeight: 600 }}>{k === 1 ? 'Вчера' : formatWeekdayShort(d)}</span>
                                    <span style={dayChipSub}>{formatDayMonthShort(d)} · задним числом</span>
                                </Chip>
                            );
                        })}
                        {stripDays.map(({ k, date, key, free }) => {
                            const active = key === targetKey;
                            const full = occupancyReady && free === 0;
                            const top = k === 0 ? 'Сегодня' : k === 1 ? 'Завтра' : formatWeekdayShort(date);
                            return (
                                <Chip
                                    key={key}
                                    selected={active}
                                    data-day-selected={active ? 'true' : undefined}
                                    onClick={() => jumpToDate(date)}
                                    aria-label={`${formatRelativeDay(date, { capitalize: true })}${k < 2 ? `, ${formatDayMonth(date)}` : ''}${full ? ' — свободного времени нет' : ''}`}
                                    style={{ ...dayChip, flex: '0 0 auto', minWidth: 68 }}
                                >
                                    <span style={{ fontWeight: 600, color: full && !active ? COLOR.ink60 : undefined }}>{top}</span>
                                    <span style={dayChipSub}>{formatDayMonthShort(date)}{full ? ' · занято' : ''}</span>
                                </Chip>
                            );
                        })}
                    </div>
                    {/* Дальше трёх недель (и прошлые дни админа) — системный календарь. */}
                    <label
                        className="m-find-otherday"
                        style={{
                            // Тот же язык «выбрано», что у Chip (label с полем даты
                            // внутри не может быть кнопкой Chip).
                            ...dayChip,
                            display: 'inline-flex',
                            alignItems: 'center',
                            minHeight: 44,
                            marginBottom: 2,
                            background: !targetInStrip ? COLOR.accentSoft : COLOR.card,
                            color: !targetInStrip ? COLOR.accentInk : COLOR.ink,
                            border: `1px solid ${!targetInStrip ? COLOR.accent : COLOR.ink20}`,
                            boxShadow: !targetInStrip ? `inset 0 0 0 0.5px ${COLOR.accent}` : undefined,
                            borderRadius: RADIUS.control,
                            cursor: 'pointer',
                            fontFamily: 'inherit',
                            fontSize: TEXT.small,
                            flex: '0 0 auto',
                            minWidth: 64,
                            position: 'relative',
                        }}
                    >
                        <CalendarDays size={18} aria-hidden="true" />
                        <span style={{ ...dayChipSub, color: !targetInStrip ? COLOR.accentInk : COLOR.ink60, fontWeight: !targetInStrip ? 600 : 500 }}>
                            {!targetInStrip ? formatDayMonthShort(targetDate) : 'Другой'}
                        </span>
                        <input
                            type="date"
                            aria-label="Выбрать другой день"
                            min={fmtDate(new Date(), 'yyyy-MM-dd')}
                            // Сервер отдаёт занятость на 60 дней вперёд. Дальше этой
                            // границы список показывал бы ВСЕ кабинеты свободными
                            // (занятость не загружена) → клиент выбирал слот и получал
                            // отказ уже на оформлении. Ограничиваем выбор.
                            max={fmtDate(new Date(Date.now() + 60 * 24 * 3600 * 1000), 'yyyy-MM-dd')}
                            value={!targetInStrip ? targetKey : ''}
                            onChange={e => {
                                if (!e.target.value) return;
                                const [y, m, d] = e.target.value.split('-').map(Number);
                                jumpToDate(new Date(y, m - 1, d, 0, 0, 0, 0));
                            }}
                            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
                        />
                    </label>
                </div>

                {/* Что с занятостью и как пользоваться сеткой. Сетка — только когда
                    занятость загружена: пока грузится — заглушки, при сбое —
                    ошибка с «Повторить» (иначе занятое выглядело бы свободным). */}
                <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {canBackdate && dayOffset === 0 && (
                        <Button variant="secondary" size="touch" onClick={() => setShowPast(v => !v)}
                                style={{ alignSelf: 'flex-start' }}>
                            {showPast ? 'Скрыть прошедшее время' : 'Показать прошедшее время сегодня'}
                        </Button>
                    )}
                    <p aria-live="polite" style={{ margin: 0, fontSize: TEXT.small, color: COLOR.ink60, lineHeight: 1.45 }}>
                        {!occupancyReady
                            ? (occupancyStatus === 'error' ? 'Занятость не загрузилась' : 'Проверяем занятость…')
                            : slots.length === 0 || !gridHasRows ? ''
                                : rescheduleId ? 'Нажмите на новое время. Пунктиром обведено нынешнее.'
                                    : `${linkSessionMeta ? 'Нажмите на время для сессии.' : 'Нажмите на свободное время.'} ${priceHint}`}
                    </p>
                    {chipsBusy && (
                        <div role="status" style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: TEXT.small, color: COLOR.ink60,
                        }}>
                            <Loader2 size={14} className="animate-spin" />
                            {linking ? 'Создаём бронь и привязываем…' : 'Переносим…'}
                        </div>
                    )}
                    {occupancyStatus === 'error' && (
                        <LoadErrorCard
                            title="Не удалось проверить, что свободно"
                            text="Без этого легко выбрать уже занятое время. Подождите немного и нажмите «Повторить»."
                            onRetry={() => { fetchBookings(); }}
                        />
                    )}
                    {!occupancyReady && occupancyStatus !== 'error' && <SkeletonRows height={84} />}
                    {occupancyReady && hotHidden.length > 0 && (
                        <div role="note" style={{
                            display: 'flex', gap: 8, alignItems: 'flex-start',
                            background: STATUS.info.bg, color: STATUS.info.fg,
                            borderRadius: RADIUS.control, padding: '10px 12px', fontSize: TEXT.small, lineHeight: 1.45,
                        }}>
                            <Info size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                            <span>
                                Время до {hotUntil} выбрать нельзя: перенос на ближайшие часы (меньше 12 ч до начала,
                                в выходные — 24 ч) делает только администратор.{' '}
                                <a href={ADMIN_TG_URL} target="_blank" rel="noopener noreferrer"
                                   style={{ color: 'inherit', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <MessageCircle size={14} aria-hidden="true" /> Написать администратору
                                </a>
                            </span>
                        </div>
                    )}
                    {occupancyReady && allSlots.length > 0 && slots.length === 0 && (
                        <EmptyState
                            compact
                            title="В этот день перенести можно только через администратора"
                            hint="Выберите другой день — или напишите администратору."
                            action={{ label: 'Следующий день', onClick: () => jumpToDate(addDays(targetDate, 1)) }}
                        />
                    )}
                    {occupancyReady && allSlots.length === 0 && (
                        <EmptyState
                            compact
                            title={daysBack > 0 && backdateMin === 0 ? 'Этот день уже прошёл'
                                : dayOffset === 0 && !gridHasRows ? 'Сегодня время уже закончилось'
                                    : rescheduleId ? `На ${formatBookingDuration(searchDuration)} в этот день места нет`
                                        : 'В этот день свободного часа нет'}
                            hint={daysBack > 0 && backdateMin === 0
                                ? 'Кабинет на прошедшее время бронирует администратор.'
                                : waitlistEnabled && gridHasRows
                                    ? 'Выберите другой день — или нажмите на занятое время: сообщим, когда освободится.'
                                    : 'Выберите другой день.'}
                            // Ближайший день, где есть время (28.11): «Показать завтра» /
                            // «Показать пт, 4 дек.». Раньше вечером вели на «завтра»,
                            // даже если и там всё занято.
                            action={nextFreeDay
                                ? { label: `Показать ${formatRelativeDay(nextFreeDay.date, { capitalize: false })}`, onClick: () => jumpToDate(nextFreeDay.date) }
                                : undefined}
                        />
                    )}
                </div>

                {/* Сетка дня (шаг 2, 28.11): кабинеты колонками, время слева. Занятое
                    заштриховано, свои брони выделены и открываются касанием. */}
                {occupancyReady && gridHasRows && (
                    <DayGrid
                        columns={columns}
                        firstRowMin={firstRowMin}
                        // Закрыто для выбора: прошедшее время и — при переносе не админом —
                        // «срочные» часы (их переносит только администратор).
                        closedReason={t => (t <= pastUntilMin ? 'прошло'
                            : restrictHot && isHotStart(targetYmd, t) ? 'через админа' : null)}
                        isPeak={isPeakMin}
                        peakTag={peakTag}
                        selection={selection}
                        selectionPending={pendingChip != null}
                        oldPlace={oldPlace}
                        // Кабинет, с которым пришли со страницы кабинета; иначе — любимый из профиля.
                        highlightRoomId={cabParam ?? getFavoriteCabinet(currentUser?.id)}
                        showCenter={showCenter}
                        disabled={chipsBusy}
                        onPickFree={pickFree}
                        onPickBusy={waitlistEnabled ? pickBusy : undefined}
                        // При переносе и привязке к сессии свои брони не открываем:
                        // из их шторки легко начать второй перенос поверх первого.
                        onPickMine={b => { if (!rescheduleId && !linkSessionMeta) setOpenBooking(b); }}
                        onClearSelection={() => { if (!chipsBusy) setSelection(null); }}
                    />
                )}

                {occupancyReady && gridHasRows && waitlistEnabled && (
                    <p style={{
                        margin: 0, padding: '0 16px', display: 'flex', gap: 6, alignItems: 'flex-start',
                        fontSize: TEXT.small, color: COLOR.ink60, lineHeight: 1.45,
                    }}>
                        <BellRing size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>Нужное время занято? Нажмите на него — сообщим, когда освободится.</span>
                    </p>
                )}
            </div>

            {/* Полоса выбранного времени — над нижним меню, как кнопка на оформлении.
                Длительности — только те, что помещаются от выбранного начала;
                цена пересчитывается сразу. */}
            {barOpen && selection && selCol && (
                <div style={{
                    position: 'fixed',
                    bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    width: '100%',
                    maxWidth: 480,
                    zIndex: Z.sticky,
                }}>
                    <div
                        className="m-grid-bar"
                        role="region"
                        aria-label="Выбранное время"
                        style={{
                            background: COLOR.card,
                            borderTop: `1px solid ${COLOR.ink10}`,
                            boxShadow: `0 24px 0 0 ${COLOR.card}`,
                            padding: '10px 16px 12px',
                            display: 'flex', flexDirection: 'column', gap: 10,
                        }}
                    >
                        <div
                            role="group"
                            aria-label="На сколько"
                            className="ui-chip-row ui-chip-row--scroll"
                            style={{ gap: 8, margin: '0 -16px', padding: '0 24px 0 16px' }}
                        >
                            {fitDurations.map(d => (
                                <Chip
                                    key={d}
                                    selected={selection.duration === d}
                                    disabled={chipsBusy}
                                    onClick={() => pickDuration(d)}
                                    style={{ flex: '0 0 auto', padding: '0 14px' }}
                                >
                                    {formatBookingDuration(d)}
                                </Chip>
                            ))}
                        </div>
                        {/* Почему длительностей мало — словами: иначе привычные 2 часа
                            молча превращаются в час (дальше занято). */}
                        {selLimit && (
                            <div style={{ fontSize: TEXT.small, color: COLOR.ink60, lineHeight: 1.35, marginTop: -4 }}>
                                {selLimit}
                            </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div aria-live="polite" style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                                <div style={{ fontSize: TEXT.small, color: COLOR.ink60, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {selCol.room.name}
                                    {showCenter ? ` · ${LOCATIONS.find(l => l.id === selCol.room.locationId)?.name ?? ''}` : ''}
                                    {' · '}{formatRelativeDay(targetDate, { capitalize: false })}
                                </div>
                                <div className="num" style={{ fontSize: TEXT.body, fontWeight: 600 }}>
                                    {minsToHm(selection.startMin)}–{minsToHm(selection.startMin + selection.duration)}
                                    <span style={{ fontWeight: 500 }}> · {formatBookingDuration(selection.duration)}</span>
                                </div>
                                <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                                    <span className="num" style={{ fontSize: TEXT.body, fontWeight: 600, color: COLOR.ink }}>
                                        {selPrice?.main}
                                    </span>
                                    {selPrice?.group ? ` · для группы ${selPrice.group}` : ''}
                                    {selPrice && selPrice.peak > 0 ? ` · в т.ч. пик ${formatGel(selPrice.peak, { fraction: 'auto' })}` : ''}
                                </div>
                                {/* Полоса показывает стоимость; чем она спишется (часы абонемента,
                                    бонус, баланс) — решается на оформлении. */}
                                {!adminFlow && currentUser?.subscription && (
                                    <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                                        Абонемент или баланс — выберете дальше.
                                    </div>
                                )}
                            </div>
                            <Button
                                size="touch"
                                disabled={chipsBusy}
                                onClick={() => pickWindow(selection.startMin, selection.roomId, selection.duration)}
                                style={{ flexShrink: 0, minWidth: 112, minHeight: 52, fontSize: TEXT.body }}
                            >
                                Дальше
                            </Button>
                        </div>
                        {touchesReRent(selCol, selection.startMin, selection.startMin + selection.duration) && (
                            <div style={{ fontSize: TEXT.small, color: STATUS.pending.fg, lineHeight: 1.35 }}>
                                Пересдача: это время освободил другой специалист — его можно занять.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* crm-ux №9: подтверждение брони под сессию CRM — цена и чем заплатим. */}
            <Sheet
                open={!!linkPick}
                onClose={() => { if (!linking) setLinkPick(null); }}
                title="Забронировать кабинет под сессию?"
                footer={linkPick ? (
                    <>
                        <Button block loading={linking} disabled={linking}
                                onClick={() => { void chooseWindow(linkPick.startMin, linkPick.resourceId, linkPick.duration); }}>
                            {linkSummary?.hot ? 'Отправить на подтверждение и привязать' : 'Забронировать и привязать'}
                        </Button>
                        <Button variant="secondary" block disabled={linking} onClick={() => setLinkPick(null)}>
                            Выбрать другой слот
                        </Button>
                    </>
                ) : undefined}
            >
                {linkSummary && (
                    <dl style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 10, fontSize: TEXT.small }}>
                        {([
                            ['Кабинет', linkSummary.room],
                            ['Когда', linkSummary.time],
                            ['Цена', linkSummary.price],
                            ['Чем платите', `${linkSummary.pay} — ${linkSummary.when}`],
                        ] as Array<[string, string]>).map(([k, v]) => (
                            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                <dt style={{ color: COLOR.ink60 }}>{k}</dt>
                                <dd style={{ margin: 0, fontWeight: 600, textAlign: 'right' }}>{v}</dd>
                            </div>
                        ))}
                        {linkPick && linkSessionMeta && linkPick.duration < linkSessionMeta.duration && (
                            <div style={{ background: STATUS.pending.bg, color: STATUS.pending.fg, borderRadius: RADIUS.control, padding: '10px 12px', lineHeight: 1.45 }}>
                                Кабинет — на {formatBookingDuration(linkPick.duration)}, а сессия длится {linkSessionMeta.duration} мин. Бронь будет короче сессии.
                            </div>
                        )}
                        {linkSummary.hot && (
                            <div style={{ background: STATUS.pending.bg, color: STATUS.pending.fg, borderRadius: RADIUS.control, padding: '10px 12px', lineHeight: 1.45 }}>
                                Срочная бронь (меньше 12 часов до начала, в выходные — 24, или вечером на утро) — уйдёт администратору на подтверждение. Время за вами держится, пока он решает.
                            </div>
                        )}
                    </dl>
                )}
            </Sheet>

            {waitlistPick && wlRoom && (
                <WaitlistSubscribeModal
                    isOpen
                    onClose={() => setWaitlistPick(null)}
                    resourceId={wlRoom.id}
                    resourceName={wlRoom.name}
                    locationName={LOCATIONS.find(l => l.id === wlRoom.locationId)?.name}
                    date={targetDate}
                    startTime={minsToHHMM(waitlistPick.startMin)}
                    endTime={minsToHHMM(waitlistPick.endMin)}
                />
            )}

            {openBooking && (
                <BookingDetailSheet
                    booking={openBooking}
                    onClose={() => setOpenBooking(null)}
                />
            )}
        </>
    );
}

/** Двухстрочный чип дня («Пн / 16 нояб.») на общем Chip. */
const dayChip: React.CSSProperties = {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 2,
    padding: '6px 12px',
    lineHeight: 1.25,
};
const dayChipSub: React.CSSProperties = { fontSize: TEXT.caption, fontWeight: 500, color: COLOR.ink60 };

/** Крестик в плашке режима — цель касания 44×44. */
const bannerCloseBtn: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: 44,
    height: 44,
    margin: '-10px -8px -10px 0',
    padding: 0,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
};

// ─── availability math ────────────────────────────────────────────
function minsToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}
/** Like HH:MM but without leading zero on the hour — "9:00", "14:30". */
function minsToHm(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${h}:${mm.toString().padStart(2, '0')}`;
}

function bookingDay(b: BookingHistoryItem): string | null {
    try {
        const d = b.date instanceof Date ? b.date : new Date(b.date as any);
        if (isNaN(d.getTime())) return null;
        return fmtDate(d, 'yyyy-MM-dd');
    } catch { return null; }
}

interface FreeWindow {
    startMin: number;
    freeResIds: string[];
    /** Подмножество freeResIds, которые свободны ИМЕННО из-за переаренды
     *  (владелец выставил слот на пересдачу). Рендерим их с amber-меткой
     *  «переаренда» — клиент видит что слот освободил кто-то, и может
     *  забрать (backend вернёт 50% оригиналу). */
    reRentResIds: string[];
}

/**
 * For the chosen date and filters, walk the day in 1-hour increments and
 * find windows of `durationMin` length where at least one resource is free
 * for the whole window.
 *
 * Space-type taxonomy:
 *   - individual = formats include 'individual' but NOT 'group'  (rooms 1, 2, 5, 6)
 *   - group      = formats include 'group'                        (rooms 7, 8, 9)
 *   - capsule    = type === 'capsule'                              (capsules 1, 2)
 */
function buildFreeWindows(
    bookings: BookingHistoryItem[],
    date: Date,
    durationMin: number,
    locs: Set<string>,
    spaces: Set<SpaceType>,
    favCab: string | null,
    isToday: boolean,
    /** Сколько минут назад ещё можно начинать (админ, задним числом). */
    backMin = 0,
    /** Прошлый день (1 — вчера, …): окно «задним числом» тянется в него (25.10). */
    daysBack = 0,
): FreeWindow[] {
    if (locs.size === 0 || spaces.size === 0) return [];

    const dayKey = fmtDate(date, 'yyyy-MM-dd');
    // «На подтверждении» тоже держит время (12.10, как check_availability на сервере).
    const dayBookings = bookings.filter(b =>
        (b.status === 'confirmed' || b.status === 'pending_approval') && bookingDay(b) === dayKey
    );

    const matchesSpace = (r: typeof RESOURCES[number]) => {
        // 07.09 (просьба админов): «Индивид» — это про РАЗМЕР (до 4 чел.),
        // а не про форматы. После мини-групп кабинеты 2 (One) и 6 (Uni)
        // получили формат group и выпадали из «Индивид», хотя это обычные
        // кабинеты на 4 человека. Теперь они видны и в «Индивид», и в
        // «Большом зале»; настоящие залы (7/8/9, 10-20 чел.) — только в зале.
        const isCapsule = r.type === 'capsule';
        if (isCapsule) return spaces.has('capsule');
        const cap = r.capacity ?? 4;
        const canGroup = r.formats?.includes('group') ?? false;
        if (spaces.has('individual') && cap <= 4) return true;
        if (spaces.has('group') && (cap > 4 || canGroup)) return true;
        return false;
    };

    // Переезд 21.11.2026: только центры, которые в этот день работают.
    const dayLocs = locsOpenOn(locs, dayKey);
    const candidates = RESOURCES.filter(r =>
        r.locationId !== 'neo_school'
        && r.locationId
        && r.isActive !== false
        && dayLocs.has(r.locationId)
        && matchesSpace(r)
    );

    // Build occupied sets per resource: minutes-of-day where the slot is busy.
    // 2026-06-07 owner: брони с isReRentListed=true НЕ помечаем как busy —
    // владелец выставил их в пересдачу, любой может забрать. Backend при
    // создании новой брони на этот слот авто-отменяет переарендованную
    // с возвратом 50% оригиналу (см. find_re_rent_conflicts в bookings/
    // routes.py). Десктоп показывал такие слоты как dashed-amber, мобильный
    // же блокировал — это и есть «слотов на переаренде не видно».
    const busy: Record<string, Set<number>> = {};
    // reRent[resId] — минуты дня, где у ресурса стоит переарендованная
    // бронь. Эти минуты НЕ в busy (слот свободен для забора), но мы их
    // помним чтобы пометить окно меткой «переаренда».
    const reRent: Record<string, Set<number>> = {};
    for (const r of candidates) { busy[r.id] = new Set(); reRent[r.id] = new Set(); }
    for (const b of dayBookings) {
        if (!b.resourceId || !b.startTime || !busy[b.resourceId]) continue;
        const [h, m] = b.startTime.split(':').map(Number);
        const start = h * 60 + m;
        const end = start + (b.duration ?? 60);
        if (b.isReRentListed) {
            // slot открыт для пересдачи — не busy, но метим reRent.
            for (let t = start; t < end; t += 30) reRent[b.resourceId].add(t);
            continue;
        }
        // Granularity stays at 30 min for occupancy — matches how slots are
        // stored. Window step changes below.
        for (let t = start; t < end; t += 30) busy[b.resourceId].add(t);
    }

    const out: FreeWindow[] = [];
    const dayStart = 9 * 60;
    const dayEnd = 22 * 60;
    // 2026-06-06 owner: для сегодня скрываем все стартовые точки
    // которые УЖЕ прошли по Тбилисскому wall-clock. Раньше /m/find
    // показывал 9:00 как «свободный» в 15:56 — пользователь жал, потом
    // не мог забронировать. tbilisiNow() не зависит от браузерного TZ
    // (важно — клиент может быть на UK VPN).
    const minStartMin = isToday
        ? Math.max(0, tbilisiNow().totalMins - backMin)
        : daysBack > 0 ? Math.max(0, tbilisiNow().totalMins - backMin + daysBack * 1440) : 0;
    // Step by 30 minutes — owner 2026-05-31 (Микола): нужны полу-часовые
    // старты (19:30 на 1.5ч). Раньше шаг был 60 «для коротких списков»,
    // но это резало половину легальных слотов. Список вырос вдвое, но
    // покрытие — все возможные стартовые точки.
    for (let t = dayStart; t + durationMin <= dayEnd; t += 30) {
        // <= вместо < — слот «прямо сейчас» забронировать тоже нельзя
        // (физически не успеешь быть в кабинете).
        if (t <= minStartMin) continue;
        const free: string[] = [];
        for (const r of candidates) {
            let ok = true;
            for (let s = t; s < t + durationMin; s += 30) {
                if (busy[r.id].has(s)) { ok = false; break; }
            }
            if (ok) free.push(r.id);
        }
        if (free.length > 0) {
            // Favourite-cabinet first within each window so the user sees
            // their preferred room as the primary choice.
            if (favCab && free.includes(favCab)) {
                free.sort((a, b) => (a === favCab ? -1 : b === favCab ? 1 : 0));
            }
            // Какие из free-ресурсов свободны из-за переаренды: хотя бы
            // один слот окна попадает в reRent-сет ресурса.
            const reRentResIds = free.filter(rid => {
                for (let s = t; s < t + durationMin; s += 30) {
                    if (reRent[rid]?.has(s)) return true;
                }
                return false;
            });
            out.push({ startMin: t, freeResIds: free, reRentResIds });
        }
    }
    return out;
}
