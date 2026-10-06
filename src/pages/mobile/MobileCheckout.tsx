import { useEffect, useMemo, useRef, useState } from 'react';
import { formatChargeAt } from '../../utils/chargeTime';
import { useNavigate } from 'react-router-dom';
import { format as fmtDate, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { Check, ChevronDown, Hourglass, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { tbilisiNow } from '../../utils/dateUtils';
import { isFrozenSub, notifyIfPauseLifted } from '../../utils/pauseLiftNotice';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { bookingsApi } from '../../api/bookings';
import { useActiveBonusHours } from '../../hooks/useActiveBonusHours';
import {
    balanceLockedReason, bonusMoneyDue, bonusMoneyText, fmtHours, isSelectable, PAUSE_LIFT_NOTE, pauseLiftNote, paymentPlan,
    resolveFinalMethod as resolvePayMethod, subscriptionHours, subscriptionHoursLabel, type PayMethod,
} from '../../utils/paymentPriority';
import { cartResourceKind } from '../../utils/subscriptionHours';
import { RESOURCES, LOCATIONS, EXTRAS, availableExtrasForResource } from '../../utils/data';
import { calculatePrice } from '../../utils/pricing';
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';
import { ruPlural } from '../../utils/plural';
import type { Format } from '../../types';
import { canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard, SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { COLOR, RADIUS, STATUS, TEXT, Z } from '../../design/tokens';
import { formatDateLabel, formatDayMonthShort, formatGel, formatTime } from '../../utils/format';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { MobilePageHeader } from '../../components/ui/PageHeader';
import { Field as FormField, Input, Select } from '../../components/ui/Field';
import { markErrorToastShown, toastApiError } from '../../utils/errors';
import { catalogPath } from '../../utils/catalogPath';
import { isBookingAdmin } from './crmAccess';

/** Отказ require_can_book: «бронирование только для специалистов, подайте
 *  анкету». Узнаём по 403 и тексту, чтобы не спутать с другими 403. */
function isSpecialistOnlyRefusal(e: any): boolean {
    const detail = e?.response?.data?.detail;
    return e?.response?.status === 403 && typeof detail === 'string'
        && (detail.includes('become-specialist') || detail.includes('верифицированным специалистам'));
}

/**
 * Mobile-native checkout — replaces the desktop OptionsStep+ConfirmationStep
 * pair when the user comes from the /m/* shell.
 *
 * What it covers:
 *   - Format selector (chips, three options)
 *   - Extras toggles (sandbox / projector / flipchart / sandbox-toys)
 *   - Payment method (bonus / subscription / balance) — порядок как на сервере
 *   - Price breakdown
 *   - One-shot "Забронировать" CTA (sticky bottom)
 *
 * What it skips on purpose (falls back to desktop wizard via "Открыть в
 * полном режиме"):
 *   - Admin booking-for-other-user flow
 *   - Recurring series creation (Mobile Find creates single bookings only)
 *   - CRM client linking (Phase 2 mobile feature)
 *   - Reschedule confirmation (separate path planned)
 */
export function MobileCheckout() {
    const navigate = useNavigate();
    const { currentUser, addBookings, bookings, fetchBookings, fetchCurrentUser, users, fetchUsers } = useUserStore();
    const state = useBookingStore();
    const [submitting, setSubmitting] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    // Волна 2 (вёрстка V1): экран подтверждения после брони и шторки
    // «Время», «Чем платите», раскрытые «Допуслуги».
    const [done, setDone] = useState<{ pending: boolean } | null>(null);
    const [timeOpen, setTimeOpen] = useState(false);
    const [payOpen, setPayOpen] = useState(false);
    const [extrasOpen, setExtrasOpen] = useState(false);
    // Бронь только для специалистов (require_can_book). Знаем заранее по роли,
    // а если сервер всё же ответил таким 403 — показываем ту же карточку с
    // анкетой вместо красного тоста с адресом, на который нельзя нажать.
    const [specialistOnlyRefused, setSpecialistOnlyRefused] = useState(false);
    const needsApplication = !!currentUser && (!canBookCabinets(currentUser) || specialistOnlyRefused);
    const applicationStatus = useSpecialistApplicationStatus(currentUser, needsApplication);
    const showSpecialistGate = () => {
        setSpecialistOnlyRefused(true);
        document.querySelector('[data-mobile-scroll]')?.scrollTo({ top: 0, behavior: 'smooth' });
    };
    // Recurring series state — local to the checkout, not persisted in store
    // (one-shot decision). 'once' = single booking (default).
    const [recurPattern, setRecurPattern] = useState<'once' | 'weekly' | 'biweekly' | 'monthly'>('once');
    const [recurOccurrences, setRecurOccurrences] = useState(8);
    // Owner+Galina 2026-05-31: дать возможность задать «продлить до даты Х»
    // вместо «N сессий». Включается чекбоксом; когда задано, occurrences
    // вычисляется автоматически по шагу паттерна.
    const [recurMode, setRecurMode] = useState<'count' | 'until'>('count');
    const [recurUntil, setRecurUntil] = useState<string>('');
    // Блок «Повторение» свёрнут по умолчанию — раскрывается по кнопке.
    const [recurOpen, setRecurOpen] = useState(false);

    // Привязка брони к клиенту Psy-CRM — как в десктопном мастере. Показывается
    // только специалистам (у кого есть клиенты в CRM). Одиночная бронь просто
    // помечается клиентом; сессию в CRM бэкенд создаёт только для серии — ровно
    // то же поведение, что на компьютере, без нового риска дублей.
    const { clients: crmClients, fetchClients: fetchCrmClients } = useCrmStore();
    const [selectedCrmClientId, setSelectedCrmClientId] = useState<string>('');
    useEffect(() => {
        if (currentUser) fetchCrmClients(true, false).catch(() => {});
    }, [currentUser, fetchCrmClients]);
    // Занятые даты серии — показываем списком с выбором «создать остальные».
    const [seriesConflicts, setSeriesConflicts] = useState<Array<{ date: string; reason?: string }> | null>(null);

    // Admin actor flag — only admins/owner can book on behalf of a specialist.
    const isAdminActor = !!(currentUser && (
        currentUser.role === 'owner'
        || currentUser.role === 'senior_admin'
        || currentUser.role === 'admin'
        || currentUser.isAdmin
    ));

    // Specialists list for the proxy picker (admin-only).
    useEffect(() => {
        if (isAdminActor && (!users || users.length === 0)) fetchUsers().catch(() => {});
    }, [isAdminActor, users, fetchUsers]);

    const specialistChoices = useMemo(() => {
        if (!isAdminActor || !users) return [];
        return users
            .filter(u => {
                const role = u.role;
                return role === 'specialist' || role === 'owner'
                    || role === 'senior_admin' || role === 'admin' || u.isAdmin;
            })
            .filter(u => !!u.email)
            .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ru'));
    }, [isAdminActor, users]);

    // Resolve target user (whose booking this is) — for pricing weekly hours
    // and balance check, this should be the *target* not the actor.
    const effectiveUser = useMemo(() => {
        if (!state.bookingForUser) return currentUser;
        const u = users?.find(x => x.email === state.bookingForUser || x.id === state.bookingForUser);
        return u ?? currentUser;
    }, [state.bookingForUser, users, currentUser]);

    // Активные бонусные часы того, ЗА КОГО бронь (сервер тратит именно их).
    // Тип 'free_hour' и срок годности учитывает activeBonusHours.
    const isProxy = !!effectiveUser && effectiveUser.id !== currentUser?.id;
    const totalBonusHours = useActiveBonusHours(effectiveUser?.id, isProxy);

    // If we got here without a slot selection, kick back to Find.
    useEffect(() => {
        if (state.selectedSlots.length === 0 && !confirmed) {
            navigate('/m/find', { replace: true });
        }
    }, [state.selectedSlots.length, confirmed, navigate]);

    const cartItems = useMemo(
        () => groupSlotsIntoBookings(state.selectedSlots, state.date),
        [state.selectedSlots, state.date],
    );

    /** Hours already booked in the current Mon-Sun week — feeds weekly_progressive discount. */
    const accumulatedWeeklyHours = useMemo(() => {
        if (!effectiveUser) return 0;
        const start = startOfWeek(state.date, { weekStartsOn: 1 });
        const end = endOfWeek(state.date, { weekStartsOn: 1 });
        const weekly = bookings.filter(b =>
            b.userId === effectiveUser.email
            && b.status === 'confirmed'
            && isWithinInterval(new Date(b.date), { start, end })
        );
        return weekly.reduce((sum, b) => sum + ((b.duration ?? 60) / 60), 0);
    }, [bookings, effectiveUser, state.date]);

    const priced = useMemo(() => {
        if (cartItems.length === 0) return { items: [], total: 0 };
        const selectedExtras = EXTRAS.filter(e => state.extras.includes(e.id));
        let total = 0;
        const items = cartItems.map(b => {
            const start = new Date(state.date);
            const [h, m] = b.startTime.split(':').map(Number);
            start.setHours(h, m, 0, 0);
            const end = new Date(start.getTime() + b.duration * 60000);
            const p = calculatePrice({
                format: state.format,
                startTime: start,
                endTime: end,
                extras: selectedExtras,
                paymentMethod: state.paymentMethod,
                resourceId: b.resourceId,
                accumulatedWeeklyHours,
                personalDiscountPercent: effectiveUser?.personalDiscountPercent,
                pricingSystem: effectiveUser?.pricingSystem,
            });
            total += p.finalPrice;
            return { ...b, start, end, price: p };
        });
        return { items, total };
    }, [
        cartItems, state.extras, state.format, state.date, state.paymentMethod,
        accumulatedWeeklyHours,
        // Admin-proxy fix: the price depends on the BOOKING TARGET's
        // personal discount, not the logged-in admin's. Re-key the memo
        // on effectiveUser so switching "за кого бронируешь" recomputes.
        effectiveUser?.id,
        effectiveUser?.personalDiscountPercent,
        effectiveUser?.pricingSystem,
    ]);

    const totalDurationHours = priced.items.reduce((s, i) => s + i.duration / 60, 0);

    // Hot booking: start is within the approval-threshold window. Server
    // marks these `pending_approval`. Threshold per 2026-05-15 spec:
    //   Mon-Fri Tbilisi → 12h
    //   Sat-Sun Tbilisi → 24h (weekend admin coverage is patchier)
    // Mirror this here so the banner shows when it actually will apply.
    const isHotBooking = useMemo(() => {
        const first = priced.items[0];
        if (!first) return false;
        const hoursUntil = (first.start.getTime() - Date.now()) / 3600000;
        const dow = first.start.getDay(); // 0=Sun, 6=Sat (local browser TZ)
        const isWeekend = dow === 0 || dow === 6;
        const threshold = isWeekend ? 24 : 12;
        // 06.10: после 21:00 — бронь на завтра до 12:00 тоже ждёт подтверждения.
        const now = tbilisiNow();
        const tomorrow = new Date(`${now.ymd}T12:00:00`); tomorrow.setDate(tomorrow.getDate() + 1);
        const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        const eveningNextMorning = now.h >= 21 && sameDay(first.start, tomorrow) && first.start.getHours() < 12;
        return hoursUntil >= 0 && (hoursUntil < threshold || eveningNextMorning);
    }, [priced.items]);

    // ── Порядок оплаты (владелец 29.09): бонус → абонемент → баланс ──
    // Абонемент: честный остаток — часы будущих, ещё не списанных броней уже
    // обещаны, и «Осталось 6 ч» без них обманывало (G4-client-mobile-M1).
    const isSeries = recurPattern !== 'once';
    const subHours = useMemo(() => subscriptionHours(effectiveUser?.subscription, {
        format: state.format,
        bookingDate: state.date,
        bookings,
        ownerEmail: effectiveUser?.email,
        // Часы капсулы / «4 ч индивидуально» идут первыми (см. subscriptionHours.ts).
        resourceKind: cartResourceKind(cartItems.map(i => i.resourceId)),
        // Новая бронь снимает паузу абонемента, если пойдёт его часами (владелец 03.10).
        liftPause: true,
    }), [effectiveUser, state.format, state.date, bookings, cartItems]);
    // Серию бонусом явно не оплачиваем: сервер сам потратит бонус на первые
    // даты, если его хватит на встречу целиком (это видно в «примерке» серии).
    const plan = useMemo(
        // Слоты (items) — в порядке отправки на сервер: бонус тратится по слотам.
        () => paymentPlan({ hours: totalDurationHours, bonusHours: totalBonusHours, sub: subHours, isSeries, moneyPrice: priced.total,
            items: priced.items.map(i => ({ hours: i.duration / 60, price: i.price.finalPrice })) }),
        [totalDurationHours, totalBonusHours, subHours, isSeries, priced.total, priced.items],
    );

    // Способ по умолчанию — тот, что выберет сервер. Раньше стоял «Баланс»,
    // и экран писал «Спишется 45 ₾ с баланса», пока сервер брал часы
    // абонемента (G4-01). Пока клиент сам не переключал, выбор следует за
    // планом (бонусы подгружаются позже); ручной выбор сбрасываем, только
    // если он стал недоступен.
    const userPickedPay = useRef(false);
    useEffect(() => {
        const cur: PayMethod = state.paymentMethod ?? 'balance';
        const want: PayMethod = isSeries ? 'balance' : plan.auto;
        if (userPickedPay.current && isSelectable(cur, plan, isSeries)) return;
        userPickedPay.current = false;
        if (cur !== want) useBookingStore.setState({ paymentMethod: want });
    }, [plan, isSeries, state.paymentMethod]);
    const pickPay = (m: PayMethod) => {
        if (!isSelectable(m, plan, isSeries)) return;
        userPickedPay.current = true;
        useBookingStore.setState({ paymentMethod: m });
    };

    const firstSlot = priced.items[0];
    const resource = firstSlot ? RESOURCES.find(r => r.id === firstSlot.resourceId) : null;

    // ── Редактор времени прямо на странице оформления ──
    // Здесь же рядом — формат, допуслуги и цена, поэтому время правится в одном
    // месте и ничего не перекрывает (всплывающая панель в Календаре прятала
    // кнопку и уводила от допов — убрали). Работает для одиночной непрерывной
    // брони одного кабинета; мульти-слот не трогаем.
    const editSlot = cartItems.length === 1 ? cartItems[0] : null;
    const curStartMin = editSlot
        ? (() => { const [h, m] = editSlot.startTime.split(':').map(Number); return h * 60 + m; })()
        : 0;
    const curDurMin = editSlot ? editSlot.duration : 60;

    // Занятость этого кабинета в этот день — чтобы нельзя было выбрать занятое.
    const dayBusy = useMemo(() => {
        if (!editSlot) return [] as { s: number; e: number }[];
        const dayKey = fmtDate(state.date, 'yyyy-MM-dd');
        return bookings
            .filter(b => b.status === 'confirmed'
                && b.resourceId === editSlot.resourceId
                && b.date && fmtDate(new Date(b.date as any), 'yyyy-MM-dd') === dayKey)
            .map(b => {
                const [h, m] = (b.startTime || '00:00').split(':').map(Number);
                const s = h * 60 + m;
                return { s, e: s + (b.duration ?? 60) };
            });
    }, [bookings, state.date, editSlot?.resourceId]);

    const DAY_MIN = 9 * 60, DAY_MAX = 22 * 60;
    const isFree = (startMin: number, durMin: number) => {
        const end = startMin + durMin;
        if (startMin < DAY_MIN || end > DAY_MAX) return false;
        return !dayBusy.some(x => x.s < end && x.e > startMin);
    };
    /** Перезаписываем слоты в сторе — цена/итог пересчитываются сами. */
    const applyTime = (startMin: number, durMin: number) => {
        if (!editSlot) return;
        const slots: string[] = [];
        for (let m = startMin; m < startMin + durMin; m += 30) {
            slots.push(`${editSlot.resourceId}|${mmToHHMM(m)}`);
        }
        useBookingStore.setState({ selectedSlots: slots });
    };
    const location = resource ? LOCATIONS.find(l => l.id === resource.locationId) : null;

    /** Available extras filtered by what the resource supports. Owner
     *  2026-05-29: rule centralised in `availableExtrasForResource` so
     *  desktop and mobile flows agree (couch hidden in capsules, etc.). */
    const availableExtras = useMemo(() => availableExtrasForResource(resource), [resource]);

    /** When the user picks "до даты Х", translate that to an occurrences
     *  count from the start date and pattern step. Capped at 1..52 to match
     *  backend validation. Returns 0 if the date is invalid or before start. */
    const effectiveOccurrences = useMemo(() => {
        if (recurMode === 'count') return recurOccurrences;
        if (!recurUntil) return 0;
        const until = new Date(recurUntil + 'T00:00:00');
        if (!Number.isFinite(until.getTime())) return 0;
        const base = new Date(state.date);
        base.setHours(0, 0, 0, 0);
        if (until.getTime() < base.getTime()) return 0;
        // «monthly» = раз в 4 недели (28 дней), день недели фиксирован.
        const stepDays = recurPattern === 'weekly' ? 7 : recurPattern === 'biweekly' ? 14 : recurPattern === 'monthly' ? 28 : 0;
        if (stepDays === 0) return 0;
        const diffDays = Math.floor((until.getTime() - base.getTime()) / 86400000);
        return Math.min(52, Math.max(1, Math.floor(diffDays / stepDays) + 1));
    }, [recurMode, recurOccurrences, recurUntil, recurPattern, state.date]);

    /** Preview of the next N dates for the recurring series, so the user can
     *  glance-confirm what they're creating before tapping "Забронировать". */
    const recurDates = useMemo(() => {
        if (recurPattern === 'once' || !firstSlot || effectiveOccurrences === 0) return [];
        // «monthly» = раз в 4 недели (28 дней), день недели фиксирован.
        const stepDays = recurPattern === 'weekly' ? 7 : recurPattern === 'biweekly' ? 14 : recurPattern === 'monthly' ? 28 : 0;
        const out: Date[] = [];
        const base = new Date(state.date);
        base.setHours(0, 0, 0, 0);
        for (let i = 0; i < effectiveOccurrences; i++) {
            const d = new Date(base);
            d.setDate(d.getDate() + i * stepDays);
            out.push(d);
        }
        return out;
    }, [recurPattern, effectiveOccurrences, firstSlot, state.date]);

    // «Примерка» серии на бэке (аудит 30.08): точная сумма той же математикой,
    // что и создание. Пока не пришла — кнопка показывает оценку «цена × N».
    const [seriesQuote, setSeriesQuote] = useState<{ totalMoney: number; totalHours: number; totalBonusHours?: number; occurrences: number; subscriptionShortDates: string[] } | null>(null);
    useEffect(() => {
        setSeriesQuote(null);
        if (recurPattern === 'once' || !firstSlot || effectiveOccurrences < 1) return;
        let cancelled = false;
        const t = setTimeout(() => {
            bookingsApi.quoteRecurringBooking({
                resourceId: firstSlot.resourceId,
                locationId: state.locationId || resource?.locationId || 'unbox_one',
                startTime: firstSlot.startTime,
                duration: firstSlot.duration,
                format: state.format,
                paymentMethod: resolveFinalMethod(),
                firstDate: fmtDate(state.date, 'yyyy-MM-dd'),
                occurrences: effectiveOccurrences,
                pattern: recurPattern,
                targetUserId: state.bookingForUser || undefined,
            }).then((q) => { if (!cancelled) setSeriesQuote(q); }).catch(() => {});
        }, 350);
        return () => { cancelled = true; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [recurPattern, effectiveOccurrences, firstSlot?.resourceId, firstSlot?.startTime, firstSlot?.duration, state.format, state.paymentMethod, state.date, state.bookingForUser]);

    const resolveFinalMethod = (): PayMethod => resolvePayMethod(state.paymentMethod, plan, isSeries);

    // Что реально спишется — для итога, подписи и кнопки (G4-01: кнопка всегда
    // писала «Забронировать · 45 ₾», даже когда платили часами).
    const payMethod = resolveFinalMethod();
    // Абонемент на паузе, а бронь пойдёт его часами — пауза снимется (владелец 03.10).
    const pauseNote = pauseLiftNote(plan, payMethod, isSeries);
    const extrasTotal = priced.items.reduce((s, i) => s + i.price.extrasPrice, 0);
    const peakTotal = priced.items.reduce((s, i) => s + (i.price.peakSurcharge ?? 0), 0);
    // При абонементе деньгами идут только пиковая надбавка и допуслуги.
    const subMoney = peakTotal + extrasTotal;
    const subMoneyNote = subMoney > 0
        ? ` (+${formatGel(subMoney)} ${peakTotal > 0 && extrasTotal > 0 ? 'за пиковые часы и допуслуги' : peakTotal > 0 ? 'за пиковые часы' : 'за допуслуги'})`
        : '';
    // Частичный бонус (без абонемента, владелец 01.10): «1 ч бонусом + 20 ₾».
    const payLabel = payMethod === 'bonus'
        ? (plan.bonusPartial
            ? `${fmtHours(plan.bonusCovered)} бонусом + ${bonusMoneyText(plan, formatGel)}`
            : `${fmtHours(totalDurationHours)} из бонусов`)
        : payMethod === 'subscription'
            ? `${fmtHours(totalDurationHours)} абонемента${subMoney > 0 ? ` + ${formatGel(subMoney)}` : ''}`
            : formatGel(priced.total);
    const payName = payMethod === 'bonus' ? 'бонусные часы' : payMethod === 'subscription' ? 'абонемент' : 'баланс';
    const payChoices = (['bonus', 'subscription', 'balance'] as PayMethod[])
        .filter(m => isSelectable(m, plan, isSeries)).length;

    /** Создание серии. skipConflicts=true — пропустить занятые даты (после того,
     *  как человек увидел их список и нажал «Создать остальные»). Раньше любой
     *  конфликт валил всю пачку, и поправить конкретные даты было нельзя. */
    const createSeries = async (skipConflicts: boolean) => {
        if (!firstSlot) return;
        if (effectiveOccurrences < 1) {
            toast.error('Выберите число повторов или дату «до»');
            return;
        }
        setSubmitting(true);
        try {
            const wasFrozen = !state.bookingForUser && isFrozenSub(useUserStore.getState().currentUser);
            const result = await bookingsApi.createRecurringBooking({
                resourceId: firstSlot.resourceId,
                locationId: state.locationId || resource?.locationId || 'unbox_one',
                startTime: firstSlot.startTime,
                duration: firstSlot.duration,
                format: state.format,
                paymentMethod: resolveFinalMethod(),
                firstDate: fmtDate(state.date, 'yyyy-MM-dd'),
                occurrences: effectiveOccurrences,
                pattern: recurPattern === 'once' ? 'weekly' : recurPattern,
                targetUserId: state.bookingForUser || undefined,
                crmClientId: selectedCrmClientId || undefined,
                skipConflicts: skipConflicts || undefined,
            });
            await Promise.all([fetchCurrentUser(), fetchBookings()]);
            notifyIfPauseLifted(wasFrozen, useUserStore.getState().currentUser);
            useBookingStore.getState().reset();
            setSeriesConflicts(null);
            setConfirmed(true);
            const skippedNote = result.skipped?.length
                ? ` · пропущено занятых: ${result.skipped.length}`
                : '';
            toast.success(
                `Серия создана: ${result.created} ${ruPlural(result.created, ['бронь', 'брони', 'броней'])} · ${formatGel(result.totalCost)}${skippedNote}`,
                { duration: 6000 },
            );
            // Navigate immediately — the toast container lives at app
            // root, so the message survives the route change.
            navigate('/m/bookings', { replace: true });
        } catch (e: any) {
            const detail = e?.response?.data?.detail;
            if (typeof detail === 'object' && detail?.conflicts) {
                // Показываем занятые даты и даём выбор — создать остальные.
                setSeriesConflicts(detail.conflicts);
            } else if (isSpecialistOnlyRefusal(e)) {
                showSpecialistGate();
            } else {
                toastApiError(e, 'Не удалось создать серию');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const submit = async () => {
        if (priced.items.length === 0 || !currentUser) return;

        const finalMethod = resolveFinalMethod();

        // Recurring series path: one API call creates N bookings,
        // all sharing the same `recurring_group_id`.
        if (recurPattern !== 'once' && firstSlot) {
            await createSeries(false);
            return;
        }

        // Balance check: bail with toast if the user can't afford it within
        // their credit limit. Только когда платим деньгами: бонусы и абонемент
        // сервер спишет часами — раньше владелец абонемента с малым балансом
        // получал «Не хватает 45 ₾», хотя деньги бы не понадобились (G4-01).
        // We check the *effective* user (target if admin-proxy, else current user).
        // Частичный бонус: деньгами — только непокрытый остаток.
        const moneyDue = finalMethod === 'balance' ? priced.total : finalMethod === 'bonus' ? bonusMoneyDue(plan) : 0;
        if (finalMethod === 'balance' || finalMethod === 'bonus') {
            // Skip the projected-balance gate when admin is booking for someone
            // else — let the backend enforce against the target's wallet.
            const projected = (effectiveUser?.balance ?? 0) - moneyDue;
            const limit = effectiveUser?.creditLimit ?? 0;
            if (moneyDue > 0 && effectiveUser?.email === currentUser.email && projected < -limit) {
                const shortfall = Math.abs(projected + limit);
                const shortfallGel = formatGel(shortfall, { fraction: 0 });
                toast.error(`Не хватает ${shortfallGel}. Пополните баланс или попросите администратора поднять кредитный лимит.`, { duration: 6000 });
                return;
            }
        }

        let paymentSource: 'subscription' | 'deposit' | 'credit' = 'deposit';
        if (finalMethod === 'subscription') paymentSource = 'subscription';
        else if (finalMethod === 'bonus') paymentSource = 'deposit';
        else if ((effectiveUser?.balance ?? 0) < priced.total) paymentSource = 'credit';

        const newBookings = priced.items.map(item => ({
            id: Math.random().toString(36).slice(2, 11),
            step: 4,
            locationId: state.locationId || resource?.locationId || 'unbox_one',
            resourceId: item.resourceId,
            format: state.format,
            date: fmtDate(state.date, 'yyyy-MM-dd'),
            startTime: item.startTime,
            duration: item.duration,
            extras: state.extras,
            status: 'confirmed' as const,
            createdAt: new Date().toISOString(),
            finalPrice: item.price.finalPrice,
            selectedSlots: [],
            price: item.price,
            paymentMethod: finalMethod,
            paymentSource,
            hoursDeducted: finalMethod === 'subscription' ? (item.duration / 60) : 0,
            ...(selectedCrmClientId ? { crmClientId: selectedCrmClientId } : {}),
            // Admin-proxy: when bookingForUser is set, the booking is owned by
            // that target — backend resolves via target_user_id.
            ...(state.bookingForUser ? { targetUserId: state.bookingForUser } : {}),
        }));

        setSubmitting(true);
        try {
            // Single-slot path: create directly so we can read the resulting
            // status — hot bookings (<12h before start) come back as
            // `pending_approval`, and the user needs to know the slot isn't
            // confirmed until an admin clicks approve.
            if (newBookings.length === 1) {
                const wasFrozen = !(newBookings[0] as any).targetUserId && isFrozenSub(useUserStore.getState().currentUser);
                const created = await bookingsApi.createBooking(newBookings[0] as any);
                await Promise.all([fetchCurrentUser(), fetchBookings()]);
                useBookingStore.getState().reset();
                setConfirmed(true);
                notifyIfPauseLifted(wasFrozen, useUserStore.getState().currentUser);
                // Волна 2: экран подтверждения вместо уведомления (решение
                // владельца). Статус — из ответа сервера на ЭТУ бронь:
                // на одобрении — «Ждём подтверждения администратора».
                setDone({ pending: (created as any).status === 'pending_approval' });
            } else {
                // Multi-slot batch — addBookings handles its own toasts/errors.
                await addBookings(newBookings as any);
                useBookingStore.getState().reset();
                setConfirmed(true);
                // Мультислот (POST /bookings/multi-slot) сервер не отправляет
                // на одобрение — брони сразу подтверждены; ответ addBookings
                // сюда не приходит, поэтому «на одобрении» не обещаем.
                setDone({ pending: false });
            }
        } catch (e: any) {
            if (isSpecialistOnlyRefusal(e)) {
                showSpecialistGate();
                return;
            }
            if (newBookings.length > 1) markErrorToastShown(e);
            toastApiError(e, 'Не удалось забронировать');
        } finally {
            setSubmitting(false);
        }
    };

    // Снимок брони для экрана подтверждения: после успеха стор сбрасывается,
    // а экран должен показать, что именно забронировано.
    const summaryRef = useRef<{ day: string; time: string; place: string; more: number } | null>(null);
    if (firstSlot) {
        const lastItem = priced.items[priced.items.length - 1];
        summaryRef.current = {
            day: formatDateLabel(state.date, { capitalize: true }),
            time: `${firstSlot.startTime}–${formatTime(lastItem.end)}`,
            place: [resource?.name, location?.name].filter(Boolean).join(' · '),
            more: priced.items.length - 1,
        };
    }

    // После брони — экран подтверждения вместо уведомления (решение владельца).
    if (done) {
        return (
            <DoneScreen
                pending={done.pending}
                summary={summaryRef.current}
                onBookings={() => navigate('/m/bookings', { replace: true })}
                onHome={() => navigate('/m/today', { replace: true })}
            />
        );
    }

    if (!firstSlot) return null;

    const lastEnd = priced.items[priced.items.length - 1].end;
    const firstStart = priced.items[0]?.start;
    const moreThanDay = !!firstStart && firstStart.getTime() - Date.now() > 24 * 3600 * 1000;
    const extrasSummary = state.extras.length === 0
        ? 'Нет'
        : EXTRAS.filter(e => state.extras.includes(e.id)).map(e => e.name).join(', ');
    const recurSummary = recurPattern === 'once'
        ? 'Нет'
        : `${RECUR_LABEL[recurPattern]}${effectiveOccurrences > 0 ? ` · ${effectiveOccurrences} ${ruPlural(effectiveOccurrences, ['раз', 'раза', 'раз'])}` : ''}`;
    // «Чем платите» одной строкой: способ и что спишется (из payLabel/payName).
    const payTitle = payMethod === 'bonus'
        ? `Бонусные часы · ${payLabel}`
        : payMethod === 'subscription'
            ? `Абонемент · ${payLabel}`
            : isSeries && plan.subCovers
                ? 'Сначала часы абонемента, остальное — с баланса'
                : isSeries
                    ? (seriesQuote && seriesQuote.occurrences === effectiveOccurrences
                        ? `С баланса · ${formatGel(seriesQuote.totalMoney)} за серию`
                        : `С баланса · ${payLabel} за встречу`)
                    : `С баланса · ${payLabel}`;
    // На одобрение сервер отправляет только одиночную бронь не-админа
    // (routes.py: is_hot and not is_admin_or_above; у мультислота барьера нет).
    const expectApproval = isHotBooking && priced.items.length === 1 && !isBookingAdmin(currentUser) && !isSeries; // серия создаётся сразу confirmed (барьер только у одиночного POST /bookings/)

    return (
        <>
            <div style={{
                paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 16,
            }}>
                {/* «Назад» — через общую шапку: без истории (ссылка) — в «Свободно». */}
                <MobilePageHeader title="Оформление брони" fallbackTo="/m/find" />

                {needsApplication && (
                    <div style={pad}>
                        <SpecialistGateCard variant="mobile" status={applicationStatus} />
                    </div>
                )}

                {/* Admin-proxy specialist picker — visible only to admins. */}
                {isAdminActor && specialistChoices.length > 0 && (
                    <div style={pad}>
                        <FormField
                            label="За кого бронируете"
                            hint={state.bookingForUser
                                ? `Списание и абонемент — у ${effectiveUser?.name || state.bookingForUser}.`
                                : undefined}
                        >
                            <Select
                                value={state.bookingForUser || ''}
                                onChange={e => useBookingStore.setState({ bookingForUser: e.target.value || null })}
                            >
                                <option value="">За себя ({currentUser?.name || currentUser?.email})</option>
                                {specialistChoices
                                    .filter(u => u.email !== currentUser?.email)
                                    .map(u => (
                                        <option key={u.id} value={u.email}>{u.name || u.email}</option>
                                    ))}
                            </Select>
                        </FormField>
                    </div>
                )}

                {/* Карточка брони: день, время (один раз), кабинет · центр · адрес, «Изменить». */}
                <div style={pad}>
                    <div style={{ ...card, padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: TEXT.body, fontWeight: 600 }}>{formatDateLabel(state.date, { capitalize: true })}</div>
                            <div className="num" style={{ fontSize: TEXT.title, fontWeight: 600, margin: '2px 0' }}>
                                {firstSlot.startTime}–{formatTime(lastEnd)}
                                <span style={{ fontSize: TEXT.small, fontWeight: 500, color: COLOR.ink60 }}>
                                    {' '}· {formatBookingDuration(Math.round(totalDurationHours * 60))}
                                </span>
                            </div>
                            <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                                {resource?.name}{location ? ` · ${location.name}, ${location.address}` : ''}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => (editSlot ? setTimeOpen(true) : navigate(-1))}
                            style={linkBtn}
                        >
                            Изменить
                        </button>
                    </div>
                </div>

                {/* Клиент Psy-CRM — только для специалистов (у кого есть клиенты). */}
                {crmClients.length > 0 && (
                    <div style={pad}>
                        <FormField label="Клиент из CRM" hint="Бронь будет помечена клиентом — видно в шахматке и в CRM." optional>
                            <Select value={selectedCrmClientId} onChange={e => setSelectedCrmClientId(e.target.value)}>
                                <option value="">Без привязки к клиенту</option>
                                {crmClients.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </Select>
                        </FormField>
                    </div>
                )}

                {/* Формат — показываем, только если у кабинета правда есть выбор.
                    В большинстве кабинетов формат один (индивидуальный). */}
                {(resource?.formats?.length ?? 1) > 1 && (
                    <Section title="Формат">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                            {([
                                ['individual', 'Индивидуальный', '1 на 1'],
                                ['group', 'Групповой', 'от 5 чел.'],
                                ['intervision', 'Интервизия', 'коллеги'],
                            ] as Array<[Format, string, string]>).map(([id, label, sub]) => {
                                const active = state.format === id;
                                const supported = !resource?.formats || resource.formats.includes(id);
                                return (
                                    <button
                                        key={id}
                                        disabled={!supported}
                                        aria-pressed={active}
                                        onClick={() => useBookingStore.setState({ format: id })}
                                        className="press"
                                        style={{
                                            ...choiceBtn(active),
                                            cursor: supported ? 'pointer' : 'not-allowed',
                                            opacity: supported ? 1 : 0.45,
                                            flexDirection: 'column',
                                            gap: 2,
                                            padding: '8px 6px',
                                        }}
                                    >
                                        <span style={{ fontSize: TEXT.caption, fontWeight: 600 }}>{label}</span>
                                        <span style={{ fontSize: TEXT.caption, color: COLOR.ink60 }}>{sub}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </Section>
                )}

                {/* Стоимость — построчно, из того же calculatePrice. Пик (09–10,
                    20–22) уже внутри цены кабинета — показываем его строкой «в т.ч.»,
                    чтобы «20 ₾/ч» на карточке и 25 ₾ здесь не выглядели обманом. */}
                <Section title="Стоимость">
                    <div style={{ ...card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {priced.items.map((i, idx) => (
                            <Row
                                key={`${i.resourceId}-${i.startTime}-${idx}`}
                                label={`${RESOURCES.find(r => r.id === i.resourceId)?.name ?? i.resourceId}${priced.items.length > 1 ? `, ${i.startTime}` : ''} · ${formatBookingDuration(i.duration)}`}
                                value={formatGel(i.price.basePrice)}
                            />
                        ))}
                        {priced.items.some(i => (i.price.peakSurcharge ?? 0) > 0) && (
                            <Row
                                label="в т.ч. пиковые часы"
                                value={`+${formatGel(priced.items.reduce((s, i) => s + (i.price.peakSurcharge ?? 0), 0))}`}
                                muted
                            />
                        )}
                        {priced.items.some(i => i.price.extrasPrice > 0) && (
                            <Row label="Допуслуги" value={formatGel(priced.items.reduce((s, i) => s + i.price.extrasPrice, 0))} />
                        )}
                        {priced.items.some(i => i.price.discountAmount > 0) && (
                            <Row
                                label="Скидка"
                                value={`−${formatGel(priced.items.reduce((s, i) => s + i.price.discountAmount, 0))}`}
                                tone="ok"
                            />
                        )}
                        <div style={{ borderTop: `1px solid ${COLOR.ink10}`, paddingTop: 8 }}>
                            <Row
                                label="Итого"
                                value={isSeries || payMethod === 'balance'
                                    ? formatGel(priced.total)
                                    : payMethod === 'bonus'
                                        ? (plan.bonusPartial
                                            ? `${fmtHours(plan.bonusCovered)} + ${bonusMoneyText(plan, formatGel)}`
                                            : formatGel(0))
                                        : `${fmtHours(totalDurationHours)}${subMoney > 0 ? ` + ${formatGel(subMoney)}` : ''}`}
                                bold
                            />
                        </div>
                    </div>
                </Section>

                {/* Чем платите — одна строка; три способа — в шторке. */}
                {!needsApplication && (
                    <div style={pad} id="m-checkout-pay">
                        <button
                            type="button"
                            onClick={() => setPayOpen(true)}
                            className="press"
                            style={{
                                width: '100%', minHeight: 60,
                                background: COLOR.accentSoft, color: COLOR.ink,
                                border: 'none', borderRadius: 12,
                                padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
                                fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer',
                            }}
                        >
                            <span style={{ flex: 1, minWidth: 0 }}>
                                <span style={{ display: 'block', fontSize: TEXT.caption, color: COLOR.ink60 }}>Чем платите</span>
                                <span style={{ display: 'block', fontSize: TEXT.body, fontWeight: 600 }}>{payTitle}</span>
                            </span>
                            <span style={{ fontSize: TEXT.small, fontWeight: 600, color: COLOR.accentInk }}>
                                {payChoices > 1 ? 'Изменить' : 'Подробнее'}
                            </span>
                        </button>
                        {pauseNote && (
                            <div role="status" style={{ marginTop: 6, fontSize: TEXT.small, lineHeight: 1.45, color: STATUS.info.fg }}>
                                {pauseNote}
                            </div>
                        )}
                    </div>
                )}

                {/* Допуслуги и повтор — свёрнутыми строками (нужны редко). */}
                <div style={pad}>
                    <div style={{ ...card, overflow: 'hidden' }}>
                        {availableExtras.length > 0 && (
                            <>
                                <FoldRow
                                    label="Допуслуги"
                                    value={state.extras.length === 0 ? 'Нет · Добавить' : extrasSummary}
                                    open={extrasOpen}
                                    onToggle={() => setExtrasOpen(o => !o)}
                                />
                                {extrasOpen && (
                                    <div style={{ padding: '0 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {availableExtras.map(e => {
                                            const active = state.extras.includes(e.id);
                                            return (
                                                <button
                                                    key={e.id}
                                                    role="checkbox"
                                                    aria-checked={active}
                                                    onClick={() => state.toggleExtra(e.id)}
                                                    style={{
                                                        minHeight: 48,
                                                        background: active ? COLOR.accentSoft : COLOR.card,
                                                        border: `1px solid ${active ? COLOR.accent : COLOR.ink10}`,
                                                        borderRadius: RADIUS.control,
                                                        padding: '8px 12px',
                                                        display: 'flex', alignItems: 'center', gap: 12,
                                                        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: COLOR.ink,
                                                    }}
                                                >
                                                    <span aria-hidden="true" style={{
                                                        width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                                                        background: active ? COLOR.accent : 'transparent',
                                                        border: `1.5px solid ${active ? COLOR.accent : COLOR.ink40}`,
                                                        display: 'grid', placeItems: 'center', color: COLOR.onAccent,
                                                    }}>
                                                        {active && <Check size={14} />}
                                                    </span>
                                                    <span style={{ flex: 1, fontSize: TEXT.small, fontWeight: 600 }}>{e.name}</span>
                                                    <span className="num" style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                                                        {e.price > 0 ? `+${formatGel(e.price)}` : 'бесплатно'}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                        <FoldRow
                            label="Повторять"
                            value={recurSummary}
                            open={recurOpen}
                            onToggle={() => setRecurOpen(o => !o)}
                            divider={availableExtras.length > 0}
                        />
                        {recurOpen && (
                            <div style={{ padding: '0 16px 14px' }}>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {(['once', 'weekly', 'biweekly', 'monthly'] as Array<'once' | 'weekly' | 'biweekly' | 'monthly'>).map(id => {
                                        const active = recurPattern === id;
                                        return (
                                            <button
                                                key={id}
                                                aria-pressed={active}
                                                onClick={() => setRecurPattern(id)}
                                                style={{ ...choiceBtn(active), padding: '0 12px' }}
                                            >
                                                {id === 'once' ? 'Разово' : RECUR_LABEL[id]}
                                            </button>
                                        );
                                    })}
                                </div>

                                {recurPattern !== 'once' && (
                                    <div style={{ marginTop: 10 }}>
                                        {/* Mode toggle: N раз / до даты */}
                                        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                                            {([
                                                ['count', 'Сколько раз'],
                                                ['until', 'До даты'],
                                            ] as Array<['count' | 'until', string]>).map(([id, label]) => {
                                                const active = recurMode === id;
                                                return (
                                                    <button
                                                        key={id}
                                                        aria-pressed={active}
                                                        onClick={() => setRecurMode(id)}
                                                        style={{ ...choiceBtn(active), flex: 1, padding: '0 10px' }}
                                                    >
                                                        {label}
                                                    </button>
                                                );
                                            })}
                                        </div>

                                        {recurMode === 'count' ? (
                                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                                {[4, 8, 12, 16, 24].map(n => {
                                                    const active = recurOccurrences === n;
                                                    return (
                                                        <button
                                                            key={n}
                                                            aria-pressed={active}
                                                            onClick={() => setRecurOccurrences(n)}
                                                            className="num"
                                                            style={{ ...choiceBtn(active), minWidth: 44, padding: '0 14px' }}
                                                        >
                                                            {n}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <FormField label="Повторять до">
                                                <Input
                                                    kind="date"
                                                    value={recurUntil}
                                                    min={fmtDate(state.date, 'yyyy-MM-dd')}
                                                    onChange={e => setRecurUntil(e.target.value)}
                                                />
                                            </FormField>
                                        )}

                                        {recurDates.length > 0 && (
                                            <div style={{
                                                marginTop: 10,
                                                background: COLOR.sunken,
                                                borderRadius: RADIUS.control,
                                                padding: '10px 12px',
                                                fontSize: TEXT.small,
                                                color: COLOR.ink80,
                                                lineHeight: 1.5,
                                            }}>
                                                <b>Создадим {recurDates.length} {ruPlural(recurDates.length, ['бронь', 'брони', 'броней'])}:</b>{' '}
                                                {recurDates
                                                    .slice(0, 4)
                                                    .map(d => formatDayMonthShort(d))
                                                    .join(', ')}
                                                {recurDates.length > 4 && (
                                                    <>, …, <b>{formatDayMonthShort(recurDates[recurDates.length - 1])}</b></>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Что произойдёт: одобрение, когда и что спишем, до какого момента
                    отмена бесплатная. Тексты списания — те же, что были под итогом. */}
                {!needsApplication && (
                <Section title="Что произойдёт">
                    <ul style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8, fontSize: TEXT.small, lineHeight: 1.5, color: COLOR.ink }}>
                        {expectApproval ? (
                            <li>
                                <Hourglass size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4, color: STATUS.pending.fg }} />
                                <b>{(() => {
                                    const f = priced.items[0];
                                    if (!f) return 'Скоро старт';
                                    const d = f.start.getDay();
                                    return (d === 0 || d === 6) ? 'Меньше 24 ч до начала (выходной)' : 'Меньше 12 ч до начала';
                                })()}</b> — бронь уйдёт администратору на одобрение.
                                {' '}Слот закрепится за вами после подтверждения — пришлём уведомление.
                            </li>
                        ) : (
                            <li>Бронь сразу ваша — подтверждать не нужно.</li>
                        )}

                        {!isSeries && payMethod === 'subscription' && (() => {
                            const deferred = !!firstStart && firstStart.getTime() - Date.now() > 24 * 3600 * 1000;
                            return (
                                <li>
                                    Спишется {fmtHours(totalDurationHours)} абонемента{subMoneyNote}
                                    {deferred && firstStart ? ` — ${formatChargeAt(firstStart)}, за сутки до начала.` : '.'}
                                    {/* Часть остатка уже обещана будущим броням: честно
                                        говорим, что при нехватке часов крон за сутки до
                                        встречи возьмёт деньги (billing_defer). */}
                                    {!plan.subFreeCovers && (
                                        <span style={{ display: 'block', color: STATUS.danger.fg }}>
                                            Свободно только {fmtHours(subHours.free)}: {fmtHours(subHours.reserved)} уже в других бронях.
                                            {' '}Если к списанию часов не хватит, одна из броней спишется с баланса по обычной цене.
                                        </span>
                                    )}
                                </li>
                            );
                        })()}
                        {!isSeries && payMethod === 'bonus' && (
                            plan.bonusPartial
                                ? <li>Спишется {fmtHours(plan.bonusCovered)} из бонусов, остальное — {bonusMoneyText(plan, formatGel)} с баланса{plan.bonusApprox ? ' (точная сумма — после брони)' : ''}.</li>
                                : <li>Спишется {fmtHours(totalDurationHours)} из бонусов — с баланса {formatGel(0)}.</li>
                        )}
                        {/* Оплата балансом: говорим явно, сколько спишется, и
                            честно предупреждаем про уход в долг — раньше клиент
                            узнавал о минусе постфактум из истории баланса. */}
                        {!isSeries && payMethod === 'balance' && effectiveUser && (() => {
                            const bal = effectiveUser.balance ?? 0;
                            const after = bal - priced.total;
                            const debt = after < 0 ? Math.min(priced.total, -after) : 0;
                            // Списание отложенное: бронь дальше 24 ч спишется за сутки
                            // до начала (как на сервере). Раньше текст звучал так, будто
                            // деньги уходят прямо сейчас, и остаток «после» был неверным.
                            const deferred = !!firstStart && firstStart.getTime() - Date.now() > 24 * 3600 * 1000;
                            if (deferred) {
                                return (
                                    <li style={{ color: debt > 0 ? STATUS.danger.fg : COLOR.ink }}>
                                        Спишется с баланса {formatChargeAt(firstStart)} (за сутки до начала): {formatGel(priced.total)}.
                                        {' '}Сейчас на балансе {formatGel(bal)}
                                        {debt > 0 ? ` — не хватает ${formatGel(debt)}, уйдёт в долг (лимит ${formatGel(effectiveUser.creditLimit ?? 0)}), если не пополнить.` : '.'}
                                    </li>
                                );
                            }
                            return (
                                <li style={{ color: debt > 0 ? STATUS.danger.fg : COLOR.ink }}>
                                    {debt > 0
                                        ? `${expectApproval ? 'Спишем после одобрения' : 'Спишется сразу'} ${formatGel(priced.total)}, из них ${formatGel(debt)} — в долг (лимит ${formatGel(effectiveUser.creditLimit ?? 0)})`
                                        : expectApproval
                                            ? `Спишем после одобрения: ${formatGel(priced.total)} с баланса`
                                            : `Спишется сразу ${formatGel(priced.total)} с баланса, останется ${formatGel(after)}`}
                                </li>
                            );
                        })()}
                        {recurPattern !== 'once' && effectiveOccurrences > 1 && (
                            seriesQuote && seriesQuote.occurrences === effectiveOccurrences ? (
                                <li>
                                    Серия из {seriesQuote.occurrences}: точно {formatGel(seriesQuote.totalMoney)}
                                    {seriesQuote.totalHours > 0 ? ` + ${fmtHours(seriesQuote.totalHours)} с абонемента` : ''}
                                    {(seriesQuote.totalBonusHours ?? 0) > 0 ? ` + ${fmtHours(seriesQuote.totalBonusHours ?? 0)} из бонусов` : ''}
                                    {'. '}Каждая бронь спишется за сутки до своего начала.
                                    {(seriesQuote.subscriptionShortDates?.length ?? 0) > 0 && (
                                        <span style={{ display: 'block', color: STATUS.danger.fg }}>
                                            Абонемента хватит не на все даты ({seriesQuote.subscriptionShortDates.length} из {seriesQuote.occurrences} — мимо).
                                            Выберите оплату балансом или уменьшите число повторов, иначе серия не создастся.
                                        </span>
                                    )}
                                </li>
                            ) : (
                                <li style={{ color: COLOR.ink60 }}>
                                    Сумма серии ориентировочная — уточняем расчёт по каждой дате…
                                </li>
                            )
                        )}

                        {/* Отмена: сервер даёт клиенту отменить бронь не позже чем за
                            сутки до начала (routes.py → 400), потом — только пересдача. */}
                        {moreThanDay && firstStart ? (
                            <li>Бесплатная отмена — до {formatChargeAt(firstStart)}, потом только «Пересдать».</li>
                        ) : (
                            <li>До начала меньше суток — отменить бронь будет нельзя{expectApproval ? '. Если планы изменятся, напишите администратору.' : ', только «Пересдать».'}</li>
                        )}
                    </ul>
                </Section>
                )}
            </div>

            {/* Закреплённая кнопка над нижним меню. */}
            <div style={{
                position: 'fixed',
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                padding: '12px 16px',
                background: COLOR.card,
                borderTop: `1px solid ${COLOR.ink10}`,
                zIndex: Z.sticky,
            }}>
                <Button
                    block
                    size="touch"
                    // Не специалист: вместо заведомого отказа — к анкете (внутри /m).
                    onClick={needsApplication ? () => navigate(catalogPath(SPECIALIST_APPLICATION_PATH, true)) : submit}
                    disabled={submitting || confirmed}
                    loading={submitting}
                    // Длинная подпись («Отправить на одобрение · 1 ч абонемента + 5 ₾») переносится, а не режется.
                    style={{ minHeight: 52, fontSize: TEXT.body, whiteSpace: 'normal', lineHeight: 1.25, textAlign: 'center', paddingBlock: 8 }}
                >
                    {confirmed
                        ? 'Готово'
                        : needsApplication
                            ? (applicationStatus === 'none' ? 'Заполнить анкету специалиста' : 'Открыть анкету')
                        : submitting
                            ? (recurPattern !== 'once' ? 'Создаём серию…' : 'Бронируем…')
                            : recurPattern !== 'once'
                                ? (effectiveOccurrences > 0
                                    ? `Создать ${effectiveOccurrences} ${ruPlural(effectiveOccurrences, ['бронь', 'брони', 'броней'])} · ${formatGel(seriesQuote && seriesQuote.occurrences === effectiveOccurrences ? seriesQuote.totalMoney : priced.total * effectiveOccurrences)}`
                                    : 'Выберите число повторов или дату')
                                : expectApproval
                                    ? `Отправить на одобрение · ${payLabel}`
                                    : `Забронировать · ${payLabel}`}
                </Button>
            </div>

            {/* Время и кабинет — правка без ухода со страницы. */}
            <Sheet
                open={timeOpen}
                onClose={() => setTimeOpen(false)}
                title="Время брони"
                description={`${formatDateLabel(state.date, { capitalize: true })} · ${resource?.name ?? ''}`}
                footer={
                    <>
                        <Button block onClick={() => setTimeOpen(false)}>Готово</Button>
                        <Button variant="secondary" block onClick={() => { setTimeOpen(false); navigate(-1); }}>
                            Другой день или кабинет
                        </Button>
                    </>
                }
            >
                {editSlot && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div>
                            <div style={fieldLabel}>Начало</div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <button
                                    onClick={() => applyTime(curStartMin - 30, curDurMin)}
                                    disabled={!isFree(curStartMin - 30, curDurMin)}
                                    aria-label="Начать на 30 минут раньше"
                                    style={{ ...choiceBtn(false), width: 104, opacity: isFree(curStartMin - 30, curDurMin) ? 1 : 0.45 }}
                                >← Раньше</button>
                                <div className="num" style={{ fontSize: TEXT.title, fontWeight: 600, textAlign: 'center' }}>
                                    {mmToHHMM(curStartMin)}–{mmToHHMM(curStartMin + curDurMin)}
                                </div>
                                <button
                                    onClick={() => applyTime(curStartMin + 30, curDurMin)}
                                    disabled={!isFree(curStartMin + 30, curDurMin)}
                                    aria-label="Начать на 30 минут позже"
                                    style={{ ...choiceBtn(false), width: 104, opacity: isFree(curStartMin + 30, curDurMin) ? 1 : 0.45 }}
                                >Позже →</button>
                            </div>
                        </div>
                        <div>
                            <div style={fieldLabel}>Сколько</div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                {[60, 90, 120, 180].map(d => {
                                    const ok = isFree(curStartMin, d);
                                    const active = curDurMin === d;
                                    return (
                                        <button
                                            key={d}
                                            onClick={() => ok && applyTime(curStartMin, d)}
                                            disabled={!ok}
                                            aria-pressed={active}
                                            style={{ ...choiceBtn(active), flex: 1, opacity: ok ? 1 : 0.45, cursor: ok ? 'pointer' : 'default' }}
                                        >
                                            {formatBookingDuration(d)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                            Неактивно — время уже занято или выходит за 09:00–22:00.
                        </div>
                    </div>
                )}
            </Sheet>

            {/* Три способа оплаты — в порядке сервера: бонус → абонемент → баланс;
                у недоступного — причина. */}
            <Sheet
                open={payOpen}
                onClose={() => setPayOpen(false)}
                title="Чем платите"
                description={`Сейчас выбрано: ${payName}. Сначала тратятся бонусные часы, потом абонемент, потом баланс.`}
                footer={<Button block onClick={() => setPayOpen(false)}>Готово</Button>}
            >
                <div role="radiogroup" aria-label="Способ оплаты" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {totalBonusHours > 0 && !isSeries && !plan.free && (
                        <PaymentRow
                            label="Бонусные часы"
                            sub={plan.bonusCovers
                                ? `${fmtHours(totalBonusHours)} бесплатно`
                                : plan.bonusPartial
                                    ? `${fmtHours(plan.bonusCovered)} бесплатно + ${bonusMoneyText(plan, formatGel)} с баланса`
                                    : `Нужно ${fmtHours(totalDurationHours)}, есть ${fmtHours(totalBonusHours)}${plan.sub.active ? ' — при абонементе только на бронь целиком' : ''}`}
                            disabled={!plan.bonusCovers && !plan.bonusPartial}
                            active={payMethod === 'bonus'}
                            onClick={() => pickPay('bonus')}
                        />
                    )}
                    {effectiveUser?.subscription && (
                        <PaymentRow
                            label="Абонемент"
                            sub={!subHours.ok
                                ? subHours.reason
                                : plan.subCovers
                                    ? (subHours.paused
                                        ? `${subscriptionHoursLabel(subHours)}. ${PAUSE_LIFT_NOTE}`
                                        : subscriptionHoursLabel(subHours))
                                    : `${subscriptionHoursLabel(subHours)}, нужно ${fmtHours(totalDurationHours)}`}
                            disabled={!plan.subCovers}
                            active={payMethod === 'subscription'}
                            onClick={() => pickPay('subscription')}
                        />
                    )}
                    <PaymentRow
                        label="Баланс"
                        // Показываем баланс того, ЗА КОГО бронь (админ-прокси
                        // бронирует за клиента — списание идёт с клиента, не
                        // с админа; аудит 30.08). Пока бронь покрывают бонусы
                        // или абонемент, сервер деньги не возьмёт — вариант
                        // недоступен, и мы говорим почему.
                        sub={(() => {
                            const bal = effectiveUser ? formatGel(effectiveUser.balance ?? 0) : '';
                            if (!isSelectable('balance', plan, isSeries)) {
                                return `${bal} · ${balanceLockedReason(plan).toLowerCase()}`;
                            }
                            if (isSeries && plan.subCovers) return `${bal} · сначала спишутся часы абонемента`;
                            return bal;
                        })()}
                        disabled={!isSelectable('balance', plan, isSeries)}
                        active={payMethod === 'balance'}
                        onClick={() => pickPay('balance')}
                    />
                </div>
            </Sheet>

            {/* Конфликты серии: показываем занятые даты и даём создать остальные,
                вместо того чтобы валить всю пачку одним тостом. */}
            <Sheet
                open={!!seriesConflicts}
                onClose={() => setSeriesConflicts(null)}
                title="Часть дат занята"
                width={400}
                footer={seriesConflicts ? (
                    <>
                        <Button
                            block
                            onClick={() => createSeries(true)}
                            loading={submitting}
                            disabled={seriesConflicts.length >= effectiveOccurrences}
                        >
                            {`Создать остальные (${Math.max(0, effectiveOccurrences - seriesConflicts.length)})`}
                        </Button>
                        <Button variant="secondary" block onClick={() => setSeriesConflicts(null)}>
                            Изменить время
                        </Button>
                    </>
                ) : undefined}
            >
                {seriesConflicts && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink80, lineHeight: 1.5 }}>
                            Занято {seriesConflicts.length} из {effectiveOccurrences}:
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto', background: COLOR.sunken, borderRadius: 12,
                                      padding: '10px 12px', fontSize: TEXT.small, lineHeight: 1.7 }}>
                            {seriesConflicts.map(c => (
                                <div key={c.date}>{formatDateLabel(c.date, { capitalize: true })}</div>
                            ))}
                        </div>
                        <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                            Можно создать серию без этих дат — остальные встречи забронируются.
                        </div>
                    </div>
                )}
            </Sheet>
        </>
    );
}

const RECUR_LABEL: Record<'weekly' | 'biweekly' | 'monthly', string> = {
    weekly: 'Каждую неделю',
    biweekly: 'Раз в 2 недели',
    monthly: 'Раз в 4 недели',
};

const pad: React.CSSProperties = { padding: '0 16px' };

const card: React.CSSProperties = {
    background: COLOR.card,
    border: `1px solid ${COLOR.ink10}`,
    borderRadius: RADIUS.sheet,
};

const linkBtn: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    minHeight: 44, padding: '0 4px', margin: '-10px -4px 0 0',
    fontFamily: 'inherit', fontSize: TEXT.small, fontWeight: 600,
    color: COLOR.accentInk, flexShrink: 0,
};

const fieldLabel: React.CSSProperties = {
    fontSize: TEXT.small, fontWeight: 600, color: COLOR.ink80, marginBottom: 8,
};

/** Кнопка выбора (формат, повтор, длительность): 44 px, выбранная — бирюзой. */
function choiceBtn(active: boolean): React.CSSProperties {
    return {
        minHeight: 44,
        borderRadius: RADIUS.control,
        border: `1px solid ${active ? COLOR.accent : COLOR.ink20}`,
        background: active ? COLOR.accentSoft : COLOR.card,
        color: active ? COLOR.accentInk : COLOR.ink,
        fontFamily: 'inherit',
        fontSize: TEXT.small,
        fontWeight: 600,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
    };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section style={pad}>
            <h2 style={{
                fontSize: TEXT.caption, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: COLOR.ink60,
                margin: '0 0 8px',
            }}>{title}</h2>
            {children}
        </section>
    );
}

function Row({ label, value, bold, tone, muted }: { label: string; value: string; bold?: boolean; tone?: 'ok'; muted?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <span style={{
                fontSize: bold ? TEXT.body : TEXT.small,
                fontWeight: bold ? 600 : 400,
                color: muted ? COLOR.ink60 : COLOR.ink,
                paddingLeft: muted ? 12 : 0,
            }}>{label}</span>
            <span className="num" style={{
                fontSize: bold ? TEXT.title : TEXT.small,
                fontWeight: bold ? 600 : 500,
                whiteSpace: 'nowrap',
                color: tone === 'ok' ? STATUS.ok.fg : muted ? COLOR.ink60 : COLOR.ink,
            }}>{value}</span>
        </div>
    );
}

/** Свёрнутая строка: «Допуслуги — Нет · Добавить». */
function FoldRow({ label, value, open, onToggle, divider }: {
    label: string; value: string; open: boolean; onToggle: () => void; divider?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            style={{
                width: '100%', minHeight: 48,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                padding: '0 16px',
                background: 'transparent', border: 'none',
                borderTop: divider ? `1px solid ${COLOR.ink10}` : 'none',
                fontFamily: 'inherit', textAlign: 'left', color: COLOR.ink, cursor: 'pointer',
                fontSize: TEXT.small,
            }}
        >
            <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {label === 'Повторять' && <Repeat size={16} aria-hidden="true" />}
                {label}
            </span>
            <span style={{ color: COLOR.ink60, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
                <ChevronDown size={16} aria-hidden="true" style={{ flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </span>
        </button>
    );
}

function PaymentRow({ label, sub, active, disabled, onClick }: {
    label: string;
    sub?: string;
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    const on = active && !disabled;
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            role="radio"
            aria-checked={on}
            style={{
                minHeight: 60,
                background: on ? COLOR.accentSoft : COLOR.card,
                border: `1px solid ${on ? COLOR.accent : COLOR.ink10}`,
                borderRadius: 12,
                padding: '10px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
            }}
        >
            <div aria-hidden="true" style={{
                width: 20, height: 20, borderRadius: 999,
                border: `2px solid ${on ? COLOR.accent : disabled ? COLOR.ink20 : COLOR.ink40}`,
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {on && <div style={{ width: 10, height: 10, borderRadius: 999, background: COLOR.accent }} />}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: TEXT.small, fontWeight: 600, color: disabled ? COLOR.ink60 : COLOR.ink }}>{label}</div>
                {sub && <div style={{ fontSize: TEXT.caption, color: COLOR.ink60, marginTop: 2 }}>{sub}</div>}
            </div>
        </button>
    );
}

/** Экран после брони (решение владельца): бронь на одобрении —
 *  «Ждём подтверждения администратора», обычная — «Бронь ваша». */
function DoneScreen({ pending, summary, onBookings, onHome }: {
    pending: boolean;
    summary: { day: string; time: string; place: string; more: number } | null;
    onBookings: () => void;
    onHome: () => void;
}) {
    return (
        <div style={{ padding: '48px 16px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, textAlign: 'center' }}>
            <div aria-hidden="true" style={{
                width: 64, height: 64, borderRadius: 999,
                background: pending ? STATUS.pending.bg : STATUS.ok.bg,
                color: pending ? STATUS.pending.fg : STATUS.ok.fg,
                display: 'grid', placeItems: 'center',
            }}>
                {pending ? <Hourglass size={28} /> : <Check size={30} strokeWidth={2.5} />}
            </div>
            <h1 role="status" style={{ margin: 0, fontSize: TEXT.heading, fontWeight: 600, lineHeight: 1.2 }}>
                {pending ? 'Ждём подтверждения администратора' : 'Бронь ваша'}
            </h1>
            <p style={{ margin: 0, fontSize: TEXT.body, color: COLOR.ink80, lineHeight: 1.5, maxWidth: 340 }}>
                {pending
                    ? 'Слот закрепится за вами после подтверждения. Пришлём уведомление, как только администратор ответит.'
                    : 'Всё готово — бронь уже в «Моих бронях».'}
            </p>
            {summary && (
                <div style={{ ...card, width: '100%', padding: 16, textAlign: 'left' }}>
                    <div style={{ fontSize: TEXT.body, fontWeight: 600 }}>{summary.day}</div>
                    <div className="num" style={{ fontSize: TEXT.title, fontWeight: 600, margin: '2px 0' }}>{summary.time}</div>
                    <div style={{ fontSize: TEXT.small, color: COLOR.ink60 }}>
                        {summary.place}
                        {summary.more > 0 ? ` · и ещё ${summary.more} ${ruPlural(summary.more, ['бронь', 'брони', 'броней'])}` : ''}
                    </div>
                </div>
            )}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <Button block size="touch" onClick={onBookings}>Мои брони</Button>
                <Button block size="touch" variant="secondary" onClick={onHome}>На главную</Button>
            </div>
        </div>
    );
}

/** Минуты от полуночи → "HH:MM" (для сборки слотов редактора времени). */
function mmToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
