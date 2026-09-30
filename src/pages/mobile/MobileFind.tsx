import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BellRing, CalendarDays, Check, Link as LinkIcon, Loader2, Move, Repeat, SlidersHorizontal, X } from 'lucide-react';
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
import { canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard, SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { COLOR, STATUS, Z } from '../../design/tokens';
import { formatDayMonth, formatDayMonthShort, formatGel, formatRelativeDay, formatWeekdayShort } from '../../utils/format';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { EmptyState } from '../../components/ui/EmptyState';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Select } from '../../components/ui/Field';
import { WaitlistSubscribeModal } from '../../components/ui/WaitlistSubscribeModal';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { catalogPath } from '../../utils/catalogPath';

type SpaceType = 'individual' | 'group' | 'capsule';

const DURATIONS = [60, 90, 120, 180]; // minutes

/* Волна 2, пакет B (G4-04): последний выбор «Где / Тип / Сколько» запоминаем
 * на этом устройстве, чтобы сводка «Сегодня · 1 ч · оба центра» чаще всего
 * была готовой. Хранилище может быть недоступно (приватный режим, запрет
 * сайта) — тогда просто работаем с настройками по умолчанию. */
const FIND_PREFS_KEY = 'unbox_find_prefs_v1';
const ALL_LOCS = ['unbox_one', 'unbox_uni'];
const ALL_SPACES: SpaceType[] = ['individual', 'group', 'capsule'];
type FindPrefs = { locs?: string[]; spaces?: string[]; dur?: number };

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

/** Сохранённый набор, если он непустой и весь из допустимых значений. */
function validSet<T extends string>(saved: unknown, allowed: readonly T[]): Set<T> | null {
    if (!Array.isArray(saved) || saved.length === 0) return null;
    const ok = saved.filter((x): x is T => allowed.includes(x as T));
    return ok.length === saved.length ? new Set(ok) : null;
}

// Большие залы для подписи фильтра — из данных (X3-20: было «залы 7, 8, 9»,
// а кабинет 9 закрыт).
const GROUP_HALLS_SUB = (() => {
    const nums = RESOURCES
        .filter(r => r.type === 'cabinet' && r.isActive !== false && (r.capacity ?? 0) > 4)
        .map(r => r.name.replace(/^Кабинет\s*/, ''));
    return nums.length > 1 ? `залы ${nums.join(', ')}` : nums.length === 1 ? `зал ${nums[0]}` : 'группы';
})();

const SPACE_WORD: Record<SpaceType, string> = { individual: 'кабинет', group: 'зал', capsule: 'капсула' };

function pluralWindows(n: number): string {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'окно';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'окна';
    return 'окон';
}

export function MobileFind() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    // Селективные селекторы — ре-рендер только на изменение нужных полей.
    const currentUser = useUserStore(s => s.currentUser);
    const bookings = useUserStore(s => s.bookings);
    const fetchBookings = useUserStore(s => s.fetchBookings);
    // Занятость кабинетов. Пока она не загрузилась (или упала), показывать
    // кабинеты свободными нельзя: раньше при сбое /bookings/public экран
    // выдавал занятые кабинеты за свободные, и клиент узнавал об этом
    // только на оформлении («слот занят»).
    const occupancyStatus = useUserStore(s => s.occupancyStatus);
    const occupancyReady = occupancyStatus === 'ready';
    const reset = useBookingStore(s => s.reset);
    const favCab = getFavoriteCabinet(currentUser?.id);
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
    useEffect(() => {
        if (liveRescheduleMatch) setRescheduleSnapshot(liveRescheduleMatch);
    }, [liveRescheduleMatch]);
    useEffect(() => {
        if (!rescheduleId || rescheduleSnapshot) return;
        const role = useUserStore.getState().currentUser?.role;
        if (role !== 'owner' && role !== 'senior_admin' && role !== 'admin') return;
        let cancelled = false;
        bookingsApi.getAllBookings()
            .then(all => {
                if (cancelled) return;
                const found = all.find((b: BookingHistoryItem) => b.id === rescheduleId) ?? null;
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
    const linkSessionMeta = useMemo(() => {
        if (!linkSessionId) return null;
        return {
            id: linkSessionId,
            date: searchParams.get('date') || '',
            time: searchParams.get('time') || '',
            duration: parseInt(searchParams.get('duration') || '60', 10) || 60,
        };
    }, [linkSessionId, searchParams]);
    const [linking, setLinking] = useState(false);

    // Persist date / duration in URL so navigating away (booking flow,
    // checkout) and coming back doesn't reset the user's selection.
    // Admins reported (2026-05-29) losing the picked date after every
    // return — chevral the entry as `?day=N` or `?date=YYYY-MM-DD`,
    // `?dur=60` so the URL is the source of truth.
    const [, setSearchParamsState] = useSearchParams();
    const initialDayOffset = (() => {
        const raw = searchParams.get('day');
        if (raw == null) return 0;
        const n = Number(raw);
        return Number.isFinite(n) ? n : 0;
    })();
    const initialCustomDate = (() => {
        const raw = searchParams.get('date');
        if (!raw) return null;
        const d = new Date(raw + 'T00:00:00');
        return Number.isFinite(d.getTime()) ? d : null;
    })();
    // Запоминаем выбор только в обычном поиске: предвыбор кабинета (?cab=),
    // перенос и привязка к сессии — разовые сценарии, их не сохраняем.
    const rememberPrefs = !searchParams.get('cab') && !rescheduleId && !linkSessionId;
    const [savedPrefs] = useState<FindPrefs>(() => (rememberPrefs ? readFindPrefs() : {}));
    const initialDuration = (() => {
        const raw = searchParams.get('dur');
        if (!raw) {
            return typeof savedPrefs.dur === 'number' && DURATIONS.includes(savedPrefs.dur) ? savedPrefs.dur : 60;
        }
        const n = Number(raw);
        return DURATIONS.includes(n) ? n : 60;
    })();
    const [dayOffset, setDayOffset] = useState(initialDayOffset); // 0=today, 1=tomorrow, … or -1 = custom
    const [customDate, setCustomDate] = useState<Date | null>(initialCustomDate);
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
    // (CabinetPage/LocationDetailsPage передают ?cab=<resourceId>). Сужаем фильтры
    // на локацию и тип этого кабинета, чтобы клиент сразу видел нужный кабинет, а не
    // общий список. Фильтры остаются переключаемыми — можно расширить руками.
    const cabParam = searchParams.get('cab');
    const cabResource = cabParam ? RESOURCES.find(r => r.id === cabParam) : null;
    const spaceOfRes = (r: any): SpaceType =>
        r.type === 'capsule' ? 'capsule' : (r.formats?.includes('group') ? 'group' : 'individual');

    // Multi-select state — all checked by default; user uncheck to narrow.
    // Using Set lets us treat add/remove uniformly via toggle().
    const [locs, setLocs] = useState<Set<string>>(() => {
        const loc = cabResource?.locationId;   // Resource.locationId — string | undefined
        if (loc) return new Set([loc]);
        return validSet(savedPrefs.locs, ALL_LOCS) ?? new Set(ALL_LOCS);
    });
    const [spaces, setSpaces] = useState<Set<SpaceType>>(() => {
        if (cabResource) return new Set([spaceOfRes(cabResource)]);
        return validSet(savedPrefs.spaces, ALL_SPACES) ?? new Set(ALL_SPACES);
    });
    // Фильтры свёрнуты в строку-сводку; «Изменить» открывает шторку.
    const [filtersOpen, setFiltersOpen] = useState(false);
    useEffect(() => {
        if (!rememberPrefs || locs.size === 0 || spaces.size === 0) return;
        writeFindPrefs({ locs: [...locs], spaces: [...spaces], dur: duration });
    }, [rememberPrefs, locs, spaces, duration]);
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
    useEffect(() => {
        if (rescheduleBooking) {
            const dur = rescheduleBooking.duration ?? 60;
            // Snap to nearest available chip, else keep
            if (DURATIONS.includes(dur)) setDuration(dur);
        }
    }, [rescheduleBooking]);

    // Link-session: pre-fill duration and jump to the session's date so the
    // first slot row the user sees is the correct day. We don't auto-narrow
    // the location/space filter — the user may want to consider alternative
    // cabinets near the session time.
    useEffect(() => {
        if (!linkSessionMeta) return;
        if (DURATIONS.includes(linkSessionMeta.duration)) setDuration(linkSessionMeta.duration);
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

    const slots = useMemo(
        // dayOffset === 0 → сегодня. Скрываем стартовые точки которые
        // уже прошли по Тбилисскому времени. Для завтра+ — все 09:00-21:30
        // легальны.
        () => buildFreeWindows(bookings, targetDate, duration, locs, spaces, favCab, dayOffset === 0),
        [bookings, targetDate, duration, locs, spaces, favCab, dayOffset],
    );

    const toggleLoc = (id: string) => {
        setLocs(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const toggleSpace = (id: SpaceType) => {
        setSpaces(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // «Сообщить, когда освободится» (G4-06, X2-08): когда окон нет или нужного
    // кабинета нет в списке — подписка через общее окно WaitlistSubscribeModal.
    const waitlistEnabled = canBook && !rescheduleId && !linkSessionMeta;
    const waitlistRooms = useMemo(() => searchRooms(locs, spaces), [locs, spaces]);
    const waitlistStarts = useMemo(() => {
        const out: number[] = [];
        const minStart = dayOffset === 0 ? tbilisiNow().totalMins : 0;
        for (let t = 9 * 60; t + duration <= 22 * 60; t += 30) {
            if (t > minStart) out.push(t);
        }
        return out;
    }, [dayOffset, duration]);
    const [waitlistPickerOpen, setWaitlistPickerOpen] = useState(false);
    const [wlStartPick, setWlStartPick] = useState<number | null>(null);
    const [wlRoomPick, setWlRoomPick] = useState<string | null>(null);
    const [waitlistModalOpen, setWaitlistModalOpen] = useState(false);
    const wlStart = wlStartPick != null && waitlistStarts.includes(wlStartPick) ? wlStartPick : (waitlistStarts[0] ?? null);
    const wlRoomDefault = [cabResource?.id, favCab].find(id => id && waitlistRooms.some(r => r.id === id))
        ?? waitlistRooms[0]?.id ?? null;
    const wlRoomId = wlRoomPick && waitlistRooms.some(r => r.id === wlRoomPick) ? wlRoomPick : wlRoomDefault;
    const wlRoom = wlRoomId ? RESOURCES.find(r => r.id === wlRoomId) : undefined;

    // Строка-сводка: «Сегодня · 1 ч · оба центра · все помещения».
    const summary = [
        formatRelativeDay(targetDate),
        formatBookingDuration(duration),
        locs.size === ALL_LOCS.length ? 'оба центра'
            : locs.size === 0 ? 'центр не выбран'
                : LOCATIONS.filter(l => locs.has(l.id)).map(l => l.name).join(', '),
        spaces.size === ALL_SPACES.length ? 'все помещения'
            : spaces.size === 0 ? 'тип не выбран'
                : ALL_SPACES.filter(x => spaces.has(x)).map(x => SPACE_WORD[x]).join(', '),
    ].join(' · ');
    const title = linkSessionMeta ? 'Привязать кабинет' : rescheduleId ? 'Перенести' : 'Свободно';
    useDocumentTitle(title);

    async function chooseWindow(startMin: number, resourceId: string) {
        if (!resourceId) return;
        if (inFlightRef.current) return;

        // Link-session path: create the booking immediately (balance, no
        // extras) and link it to the source CRM session. No checkout step —
        // the user already committed by tapping "Привязать кабинет" in the
        // session sheet. Failures during the link don't roll back the
        // booking — the user can re-attach from the desktop CRM if needed.
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
                    date: targetDate,
                    startTime: minsToHHMM(startMin),
                    duration,
                    format: (resource?.formats?.[0] as 'individual' | 'group' | 'intervision') || 'individual',
                    paymentMethod: 'balance',
                    extras: [],
                });
                try {
                    await crmApi.updateSession(linkSessionMeta.id, { bookingId: created.id });
                } catch (linkErr) {
                    console.warn('CRM link failed (booking created)', linkErr);
                    toast.warning('Бронь создана, но привязать к сессии не получилось');
                }
                toast.success('Кабинет забронирован и привязан');
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
            inFlightRef.current = true;
            setPendingChip(`${startMin}|${resourceId}`);
            setRescheduling(true);
            let left = false;
            try {
                await bookingsApi.rescheduleBooking(rescheduleBooking.id, {
                    newDate: fmtDate(targetDate, 'yyyy-MM-dd'),
                    newStartTime: minsToHHMM(startMin),
                    newResourceId: resourceId,
                    // 2026-06-02: пробрасываем выбранную длительность.
                    // Раньше /m/find игнорировал её на reschedule, и бронь
                    // сохраняла исходную duration (1ч), даже если в UI
                    // выбрали 1.5ч — Galina багрепорт.
                    newDuration: duration,
                });
                await fetchBookings();
                toast.success('Бронь перенесена');
                navigate('/m/bookings', { replace: true });
                left = true;
            } catch (e: any) {
                const detail = e?.response?.data?.detail;
                const msg = typeof detail === 'string' ? detail
                    : (detail?.conflicts ? `Конфликт: ${detail.conflicts.map((c: any) => c.date).join(', ')}` : (e.message || 'Не удалось перенести'));
                toast.error(msg);
            } finally {
                if (!left) { setRescheduling(false); releaseChips(); }
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
        for (let m = startMin; m < startMin + duration; m += 30) {
            slotStrs.push(`${resourceId}|${minsToHHMM(m)}`);
        }
        const resource = RESOURCES.find(r => r.id === resourceId);
        reset();
        useBookingStore.setState({
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
                paddingTop: 16,
                paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 16,
            }}>
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                            {title}
                        </h1>
                        {(linkSessionMeta || rescheduleId) && (
                            <p style={{ fontSize: 14, color: COLOR.ink60, margin: '4px 0 0' }}>
                                {linkSessionMeta
                                    ? 'Выберите свободный слот — забронируем и привяжем к сессии.'
                                    : 'Выберите новое время — старый слот освободится.'}
                            </p>
                        )}
                    </div>
                    {/* Календарь — экран внутри приложения: без значка внешней
                        ссылки и без липкой кнопки, перекрывавшей первый результат. */}
                    {!linkSessionMeta && !rescheduleId && (
                        <Button
                            variant="secondary"
                            size="touch"
                            icon={<CalendarDays size={16} aria-hidden="true" />}
                            onClick={() => navigate('/m/calendar')}
                        >
                            Календарь
                        </Button>
                    )}
                </div>

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
                {!rescheduleBooking && !linkSessionMeta && (
                    currentUser?.role === 'owner' ||
                    currentUser?.role === 'senior_admin' ||
                    currentUser?.role === 'admin' ||
                    currentUser?.isAdmin
                ) && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: STATUS.pending.bg,
                            border: `1px solid ${STATUS.pending.fg}33`,
                            color: STATUS.pending.fg,
                            borderRadius: 12,
                            padding: '10px 12px',
                            fontSize: 12,
                            lineHeight: 1.4,
                        }}>
                            <strong>Админ-бронь.</strong> Выберите слот — на
                            следующем шаге появится поле «За кого
                            бронируете?». Если бронируете для себя — просто
                            оставьте его пустым.
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
                            borderRadius: 12,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <Move size={18} />
                            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>
                                <b>Переносим:</b>{' '}
                                {rescheduleBooking.date && formatDayMonth(rescheduleBooking.date)}
                                {' '}в {rescheduleBooking.startTime}
                                {' · '}
                                {RESOURCES.find(r => r.id === rescheduleBooking.resourceId)?.name ?? rescheduleBooking.resourceId}
                            </div>
                            <button
                                onClick={() => navigate('/m/bookings')}
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
                            borderRadius: 12,
                            padding: '10px 12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                        }}>
                            <LinkIcon size={18} />
                            <div style={{ flex: 1, fontSize: 13, lineHeight: 1.35 }}>
                                <b>Привязываем кабинет к сессии:</b>{' '}
                                {linkSessionMeta.date ? formatDayMonth(linkSessionMeta.date) : ''} в {linkSessionMeta.time} · {linkSessionMeta.duration} мин
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

                {/* Строка-сводка фильтров (G4-04): результаты — на первом экране. */}
                <div style={{ padding: '0 16px' }}>
                    <button
                        type="button"
                        onClick={() => setFiltersOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={filtersOpen}
                        aria-label={`Поиск: ${summary}. Изменить`}
                        className="press"
                        style={{
                            width: '100%',
                            minHeight: 48,
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px',
                            background: COLOR.sunken,
                            border: 'none',
                            borderRadius: 12,
                            color: COLOR.ink,
                            fontFamily: 'inherit',
                            textAlign: 'left',
                            cursor: 'pointer',
                        }}
                    >
                        <SlidersHorizontal size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>
                            {summary}
                        </span>
                        <span style={{ fontSize: 14, fontWeight: 600, color: COLOR.accentInk, flexShrink: 0 }}>
                            Изменить
                        </span>
                    </button>
                    {!linkSessionMeta && !rescheduleId && (
                        <p style={{ fontSize: 12, color: STATUS.pending.fg, margin: '8px 0 0' }}>
                            Пиковые часы 09–10 и 20–22: +5 ₾ за каждый час пика.
                        </p>
                    )}
                </div>

                {/* Results. Чипы — только когда занятость загружена: пока
                    грузится — заглушки, при сбое — ошибка с «Повторить». */}
                <div style={{ padding: '0 16px' }}>
                    <SectionTitle live>
                        {!occupancyReady
                            ? (occupancyStatus === 'error' ? 'Занятость не загрузилась' : 'Проверяем занятость…')
                            : slots.length === 0 ? 'Свободных окон нет' : `Найдено: ${slots.length}`}
                    </SectionTitle>
                    {/* Статус запроса — рядом со списком, а не над «Когда»:
                        чипы обычно ниже первого экрана, и надпись вверху
                        никто не видел. */}
                    {chipsBusy && (
                        <div role="status" style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            fontSize: 13, color: COLOR.ink60, marginBottom: 8,
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
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        {/* One chip per (time, resource) — owner+Galina 2026-05-31:
                            раньше строка показывала «Свободно: Каб.1, Каб.2, ...»
                            и тап всегда брал первый из списка. Пользователь
                            думал что бронит Каб.2, а вписывался Каб.1. Теперь
                            каждый кабинет — отдельная кликабельная карточка. */}
                        {occupancyReady && slots.map(s => (
                            <div
                                key={s.startMin}
                                style={{
                                    // Волна 2 (G4-05): строка «время слева — кабинеты справа»
                                    // с тонкой линией вместо карточки на каждое время —
                                    // список заметно короче, глазу есть за что зацепиться.
                                    display: 'grid',
                                    gridTemplateColumns: '52px minmax(0, 1fr)',
                                    gap: 8,
                                    alignItems: 'start',
                                    padding: '10px 0',
                                    borderTop: `1px solid ${COLOR.ink08}`,
                                }}
                            >
                                <div className="num" style={{ fontSize: 16, fontWeight: 600, color: COLOR.ink, lineHeight: '44px' }}>
                                    {minsToHm(s.startMin)}
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {s.freeResIds.map(rid => {
                                        const r = RESOURCES.find(x => x.id === rid);
                                        const isReRent = s.reRentResIds.includes(rid);
                                        const isPending = pendingChip === `${s.startMin}|${rid}`;
                                        return (
                                            <button
                                                key={rid}
                                                onClick={() => chooseWindow(s.startMin, rid)}
                                                disabled={chipsBusy}
                                                aria-busy={isPending || undefined}
                                                className="press"
                                                title={isReRent ? 'Слот на пересдаче — кто-то освободил, можно забрать' : undefined}
                                                style={{
                                                    // Пересдача — янтарная обводка вместо
                                                    // чёрной заливки: визуально «особый»
                                                    // слот, отличается от обычных свободных.
                                                    // Волна 2: контурные чипы вместо
                                                    // сплошной стены чёрных таблеток.
                                                    background: isReRent ? STATUS.pending.bg : COLOR.card,
                                                    color: isReRent ? STATUS.pending.fg : COLOR.ink,
                                                    border: isReRent ? `1px solid ${STATUS.pending.fg}4D` : `1px solid ${COLOR.ink20}`,
                                                    borderRadius: 8,
                                                    // Главный тап брони — цель 44 px (было 32).
                                                    minHeight: 44,
                                                    padding: '4px 12px',
                                                    fontSize: 14,
                                                    fontWeight: 600,
                                                    cursor: chipsBusy ? 'default' : 'pointer',
                                                    fontFamily: 'inherit',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 6,
                                                    // Пока идёт запрос — все чипы
                                                    // неактивны, нажатый остаётся ярким.
                                                    opacity: chipsBusy && !isPending ? 0.5 : 1,
                                                    pointerEvents: chipsBusy ? 'none' : undefined,
                                                }}
                                            >
                                                {isReRent && <Repeat size={14} aria-hidden="true" />}
                                                {/* Волна 2: название и ставка в две строки —
                                                    чип вдвое уже, в строку помещаются два. */}
                                                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', lineHeight: 1.2, textAlign: 'left' }}>
                                                    <span>{r?.name ?? rid}</span>
                                                    {/* Ставка прямо на чипе: цена не должна
                                                        появляться впервые только на оформлении. */}
                                                    {r?.hourlyRate != null && (
                                                        <span className="num" style={{ fontSize: 12, fontWeight: 500 }}>
                                                            {formatGel(r.hourlyRate)}/ч
                                                        </span>
                                                    )}
                                                </span>
                                                {isPending
                                                    ? <Loader2 size={11} className="animate-spin" />
                                                    : isReRent
                                                        ? <span style={{ fontSize: 12, fontWeight: 600 }}>пересдача</span>
                                                        : null}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                    {occupancyReady && slots.length === 0 && (locs.size === 0 || spaces.size === 0) && (
                        <EmptyState
                            compact
                            title="Не выбрано, где искать"
                            hint="Выберите хотя бы один центр и тип помещения."
                        />
                    )}
                    {occupancyReady && slots.length === 0 && locs.size > 0 && spaces.size > 0 && (
                        <EmptyState
                            compact
                            title="В этот день всё занято"
                            hint={waitlistEnabled
                                ? 'Попробуйте другой день или длительность — или попросите сообщить, когда освободится.'
                                : 'Попробуйте другой день, длительность или фильтры.'}
                            action={dayOffset === 0 && waitlistStarts.length === 0
                                // Вечером «сегодня» уже закончилось — сразу на завтра.
                                ? { label: 'Смотреть завтра', onClick: () => { setDayOffset(1); setCustomDate(null); } }
                                : { label: 'Изменить поиск', onClick: () => setFiltersOpen(true) }}
                        />
                    )}

                    {/* «Сообщить, когда освободится»: при пустом дне — сразу
                        открытая карточка, иначе — тихая кнопка под списком. */}
                    {occupancyReady && waitlistEnabled && waitlistRooms.length > 0 && waitlistStarts.length > 0 && (
                        (slots.length === 0 || waitlistPickerOpen) ? (
                            <div style={{
                                marginTop: 16,
                                border: `1px solid ${COLOR.ink10}`,
                                borderRadius: 16,
                                padding: 16,
                                background: COLOR.card,
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 600 }}>
                                    <BellRing size={18} aria-hidden="true" />
                                    Сообщить, когда освободится
                                </div>
                                <p style={{ fontSize: 14, color: COLOR.ink60, margin: '4px 0 12px' }}>
                                    Выберите время и кабинет — пришлём сообщение, как только в этом центре освободится место.
                                </p>
                                {wlStart != null && (
                                    <>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 8 }}>
                                            <Field label="Время">
                                                <Select
                                                    value={String(wlStart)}
                                                    onChange={e => setWlStartPick(Number(e.target.value))}
                                                >
                                                    {waitlistStarts.map(t => (
                                                        <option key={t} value={t}>{minsToHHMM(t)}–{minsToHHMM(t + duration)}</option>
                                                    ))}
                                                </Select>
                                            </Field>
                                            <Field label="Кабинет">
                                                <Select
                                                    value={wlRoomId ?? ''}
                                                    onChange={e => setWlRoomPick(e.target.value)}
                                                >
                                                    {waitlistRooms.map(rr => (
                                                        <option key={rr.id} value={rr.id}>
                                                            {rr.name}{locs.size > 1 ? ` · ${LOCATIONS.find(l => l.id === rr.locationId)?.name ?? ''}` : ''}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </Field>
                                        </div>
                                        <div style={{ marginTop: 12 }}>
                                            <Button
                                                block
                                                variant={slots.length === 0 ? 'primary' : 'secondary'}
                                                icon={<BellRing size={16} aria-hidden="true" />}
                                                onClick={() => setWaitlistModalOpen(true)}
                                                disabled={!wlRoom}
                                            >
                                                Сообщить, когда освободится
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <div style={{ marginTop: 12 }}>
                                <Button
                                    variant="quiet"
                                    icon={<BellRing size={16} aria-hidden="true" />}
                                    onClick={() => setWaitlistPickerOpen(true)}
                                    style={{ whiteSpace: 'normal', textAlign: 'left', paddingLeft: 0 }}
                                >
                                    Нет нужного времени? Сообщить, когда освободится
                                </Button>
                            </div>
                        )
                    )}
                </div>
            </div>


            {/* Фильтры — в шторке. Результаты за ней обновляются сразу. */}
            <Sheet
                open={filtersOpen}
                onClose={() => setFiltersOpen(false)}
                title="Когда и где искать"
                footer={
                    <Button block onClick={() => setFiltersOpen(false)}>
                        {occupancyReady && slots.length > 0
                            ? `Показать ${slots.length} ${pluralWindows(slots.length)}`
                            : 'Готово'}
                    </Button>
                }
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    {/* When */}
                    <FieldGroup label="Когда">
                        {/* Today/Tomorrow — flat 50/50 row */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                            {[0, 1].map(off => {
                                const d = addDays(new Date(), off);
                                const top = off === 0 ? 'Сегодня' : 'Завтра';
                                const bot = formatDayMonth(d);
                                const active = dayOffset === off;
                                return (
                                    <button
                                        key={off}
                                        aria-pressed={active}
                                        onClick={() => setDayOffset(off)}
                                        style={{
                                            background: active ? COLOR.ink : COLOR.sunken,
                                            color: active ? COLOR.onInk : COLOR.ink,
                                            border: 'none',
                                            borderRadius: 14,
                                            padding: '14px 16px',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            textAlign: 'left',
                                        }}
                                    >
                                        <div style={{ fontSize: 16, fontWeight: 600 }}>{top}</div>
                                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{bot}</div>
                                    </button>
                                );
                            })}
                        </div>
                        {/* Next 5 days as compact square chips + "Другой день" */}
                        <ChipsRow>
                            {[2, 3, 4, 5, 6, 7, 8].map(off => {
                                const d = addDays(new Date(), off);
                                const wd = formatWeekdayShort(d);
                                const dayLabel = formatDayMonthShort(d);
                                const active = dayOffset === off;
                                return (
                                    <button
                                        key={off}
                                        aria-pressed={active}
                                        onClick={() => { setDayOffset(off); setCustomDate(null); }}
                                        style={{
                                            background: active ? COLOR.ink : COLOR.sunken,
                                            color: active ? COLOR.onInk : COLOR.ink,
                                            border: 'none',
                                            borderRadius: 12,
                                            padding: '10px 12px',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            textAlign: 'center',
                                            flex: '0 0 auto',
                                            minWidth: 64,
                                        }}
                                    >
                                        <div style={{ fontSize: 12, fontWeight: 600 }}>{wd}</div>
                                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{dayLabel}</div>
                                    </button>
                                );
                            })}
                            {/* Native date input — covers any future date past the
                                7-day chip strip. Wrapping the <input> in a label
                                lets us style it like the other chips while still
                                popping the OS date picker on tap. */}
                            <label
                                style={{
                                    background: dayOffset === -1 ? COLOR.ink : COLOR.sunken,
                                    color: dayOffset === -1 ? COLOR.onInk : COLOR.ink,
                                    borderRadius: 12,
                                    padding: '10px 12px',
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    textAlign: 'center',
                                    flex: '0 0 auto',
                                    minWidth: 88,
                                    position: 'relative',
                                }}
                            >
                                <div style={{ fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <CalendarDays size={14} aria-hidden="true" /> Другой
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>
                                    {dayOffset === -1 && customDate
                                        ? formatDayMonthShort(customDate)
                                        : 'день'}
                                </div>
                                <input
                                    type="date"
                                    min={fmtDate(new Date(), 'yyyy-MM-dd')}
                                    // Сервер отдаёт занятость на 60 дней вперёд. Дальше этой
                                    // границы список показывал бы ВСЕ кабинеты свободными
                                    // (занятость не загружена) → клиент выбирал слот и получал
                                    // отказ уже на оформлении. Ограничиваем выбор.
                                    max={fmtDate(new Date(Date.now() + 60 * 24 * 3600 * 1000), 'yyyy-MM-dd')}
                                    value={customDate ? fmtDate(customDate, 'yyyy-MM-dd') : ''}
                                    onChange={e => {
                                        if (!e.target.value) return;
                                        const [y, m, d] = e.target.value.split('-').map(Number);
                                        const picked = new Date(y, m - 1, d, 0, 0, 0, 0);
                                        setCustomDate(picked);
                                        setDayOffset(-1);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        opacity: 0,
                                        cursor: 'pointer',
                                    }}
                                />
                            </label>
                        </ChipsRow>
                    </FieldGroup>

                    {/* Duration */}
                    <FieldGroup label="Сколько">
                        <ChipsRow>
                            {DURATIONS.map(d => {
                                const active = duration === d;
                                return (
                                    <button
                                        key={d}
                                        aria-pressed={active}
                                        onClick={() => setDuration(d)}
                                        style={{
                                            background: active ? COLOR.ink : COLOR.sunken,
                                            color: active ? COLOR.onInk : COLOR.ink,
                                            border: 'none',
                                            borderRadius: 12,
                                            minHeight: 44,
                                            padding: '0 16px',
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            flex: '0 0 auto',
                                        }}
                                    >
                                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                                            {formatBookingDuration(d)}
                                        </span>
                                    </button>
                                );
                            })}
                        </ChipsRow>
                    </FieldGroup>

                    {/* Where — multi-select */}
                    <FieldGroup label="Где">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {LOCATIONS.filter(l => l.id === 'unbox_one' || l.id === 'unbox_uni').map(l => (
                                <CheckCard
                                    key={l.id}
                                    checked={locs.has(l.id)}
                                    onClick={() => toggleLoc(l.id)}
                                    title={l.name}
                                    sub={l.address}
                                />
                            ))}
                        </div>
                    </FieldGroup>

                    {/* Space type — multi-select */}
                    <FieldGroup label="Тип помещения">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                            <CheckCard
                                checked={spaces.has('individual')}
                                onClick={() => toggleSpace('individual')}
                                title="Кабинет"
                                sub="до 4 чел."
                            />
                            <CheckCard
                                checked={spaces.has('group')}
                                onClick={() => toggleSpace('group')}
                                title="Большой зал"
                                sub={GROUP_HALLS_SUB}
                            />
                            <CheckCard
                                checked={spaces.has('capsule')}
                                onClick={() => toggleSpace('capsule')}
                                title="Капсула"
                                sub="1 чел."
                            />
                        </div>
                    </FieldGroup>

                </div>
            </Sheet>

            {waitlistModalOpen && wlRoom && wlStart != null && (
                <WaitlistSubscribeModal
                    isOpen
                    onClose={() => setWaitlistModalOpen(false)}
                    resourceId={wlRoom.id}
                    resourceName={wlRoom.name}
                    locationName={LOCATIONS.find(l => l.id === wlRoom.locationId)?.name}
                    date={targetDate}
                    startTime={minsToHHMM(wlStart)}
                    endTime={minsToHHMM(wlStart + duration)}
                    onSubscribed={() => setWaitlistPickerOpen(false)}
                />
            )}
        </>
    );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <SectionTitle>{label}</SectionTitle>
            {children}
        </div>
    );
}

/** live — диктор зачитывает изменения («Найдено: 13»). */
function SectionTitle({ children, live }: { children: React.ReactNode; live?: boolean }) {
    return (
        <div aria-live={live ? 'polite' : undefined} style={{
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: COLOR.ink60,
            marginBottom: 8,
        }}>{children}</div>
    );
}

function ChipsRow({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
            // Лента до краёв шторки (поля тела шторки — 24 px).
            margin: '0 -24px',
            padding: '0 24px 4px',
            scrollbarWidth: 'none',
        }}>
            {children}
        </div>
    );
}

/** Multi-select card with a checkbox in the corner. */
function CheckCard({ checked, onClick, title, sub }: {
    checked: boolean;
    onClick: () => void;
    title: string;
    sub?: string;
}) {
    return (
        <button
            onClick={onClick}
            aria-pressed={checked}
            style={{
                background: COLOR.card,
                color: COLOR.ink,
                border: `1px solid ${checked ? COLOR.ink : COLOR.ink10}`,
                borderRadius: 12,
                padding: '12px 12px 12px 14px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: 8,
            }}
        >
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                    {title}
                </div>
                {sub && (
                    <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2, lineHeight: 1.3 }}>
                        {sub}
                    </div>
                )}
            </div>
            <div style={{
                width: 20, height: 20,
                borderRadius: 6,
                border: `1.5px solid ${checked ? COLOR.ink : COLOR.ink20}`,
                background: checked ? COLOR.ink : 'transparent',
                display: 'grid', placeItems: 'center',
                color: COLOR.onInk,
                flexShrink: 0,
                marginTop: 1,
            }}>
                {checked && <Check size={14} />}
            </div>
        </button>
    );
}

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

/** Кабинеты под текущие фильтры — для «Сообщить, когда освободится».
 *  Те же правила, что в buildFreeWindows (её не трогаем): сдаваемые,
 *  не Neo School, выбранный центр и тип («Кабинет» — до 4 чел.,
 *  «Большой зал» — больше 4 или групповой формат, «Капсула» — капсулы). */
function searchRooms(locs: Set<string>, spaces: Set<SpaceType>) {
    return RESOURCES.filter(r => {
        if (r.locationId === 'neo_school' || !r.locationId || r.isActive === false || !locs.has(r.locationId)) return false;
        if (r.type === 'capsule') return spaces.has('capsule');
        const cap = r.capacity ?? 4;
        const canGroup = r.formats?.includes('group') ?? false;
        return (spaces.has('individual') && cap <= 4) || (spaces.has('group') && (cap > 4 || canGroup));
    }).sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
}

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
): FreeWindow[] {
    if (locs.size === 0 || spaces.size === 0) return [];

    const dayKey = fmtDate(date, 'yyyy-MM-dd');
    const dayBookings = bookings.filter(b =>
        b.status === 'confirmed' && bookingDay(b) === dayKey
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

    const candidates = RESOURCES.filter(r =>
        r.locationId !== 'neo_school'
        && r.locationId
        && r.isActive !== false
        && locs.has(r.locationId)
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
    const minStartMin = isToday ? tbilisiNow().totalMins : 0;
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
