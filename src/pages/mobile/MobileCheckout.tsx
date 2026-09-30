import { useEffect, useMemo, useRef, useState } from 'react';
import { formatChargeAt } from '../../utils/chargeTime';
import { useNavigate } from 'react-router-dom';
import { format as fmtDate, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { ArrowLeft, Check, Clock, Hourglass, MapPin, Loader2, Repeat } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { bookingsApi } from '../../api/bookings';
import { useActiveBonusHours } from '../../hooks/useActiveBonusHours';
import {
    balanceLockedReason, fmtHours, isSelectable, paymentPlan, resolveFinalMethod as resolvePayMethod,
    subscriptionHours, subscriptionHoursLabel, type PayMethod,
} from '../../utils/paymentPriority';
import { RESOURCES, LOCATIONS, EXTRAS, availableExtrasForResource } from '../../utils/data';
import { calculatePrice } from '../../utils/pricing';
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';
import { ruPlural } from '../../utils/plural';
import type { Format } from '../../types';
import { canBookCabinets } from '../../utils/permissions';
import { useSpecialistApplicationStatus } from '../../hooks/useSpecialistApplication';
import { SpecialistGateCard, SPECIALIST_APPLICATION_PATH } from '../../components/SpecialistGate';
import { COLOR, STATUS, Z } from '../../design/tokens';
import { formatDateLabel, formatDayMonthShort, formatGel, formatTime } from '../../utils/format';
import { formatBookingDuration } from '../../utils/bookingHelpers';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';

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
        return hoursUntil >= 0 && hoursUntil < threshold;
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
    }), [effectiveUser, state.format, state.date, bookings]);
    // Серию бонусом явно не оплачиваем: сервер сам потратит бонус на первые
    // даты, если его хватит на встречу целиком (это видно в «примерке» серии).
    const plan = useMemo(
        () => paymentPlan({ hours: totalDurationHours, bonusHours: totalBonusHours, sub: subHours, isSeries, moneyPrice: priced.total }),
        [totalDurationHours, totalBonusHours, subHours, isSeries, priced.total],
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
    const extrasTotal = priced.items.reduce((s, i) => s + i.price.extrasPrice, 0);
    const peakTotal = priced.items.reduce((s, i) => s + (i.price.peakSurcharge ?? 0), 0);
    // При абонементе деньгами идут только пиковая надбавка и допуслуги.
    const subMoney = peakTotal + extrasTotal;
    const subMoneyNote = subMoney > 0
        ? ` (+${formatGel(subMoney, { fraction: 0 })} ${peakTotal > 0 && extrasTotal > 0 ? 'за пиковые часы и допуслуги' : peakTotal > 0 ? 'за пиковые часы' : 'за допуслуги'})`
        : '';
    const payLabel = payMethod === 'bonus'
        ? `${fmtHours(totalDurationHours)} из бонусов`
        : payMethod === 'subscription'
            ? `${fmtHours(totalDurationHours)} абонемента${subMoney > 0 ? ` + ${formatGel(subMoney, { fraction: 0 })}` : ''}`
            : formatGel(priced.total, { fraction: 0 });
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
            useBookingStore.getState().reset();
            setSeriesConflicts(null);
            setConfirmed(true);
            const skippedNote = result.skipped?.length
                ? ` · пропущено занятых: ${result.skipped.length}`
                : '';
            toast.success(
                `Серия создана: ${result.created} ${ruPlural(result.created, ['сессия', 'сессии', 'сессий'])} · ${formatGel(result.totalCost, { fraction: 0 })}${skippedNote}`,
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
                const msg = typeof detail === 'string' ? detail : (e.message || 'Не удалось создать серию');
                toast.error(msg);
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
        if (finalMethod === 'balance' && priced.total > 0 && effectiveUser?.email === currentUser.email) {
            // Skip the projected-balance gate when admin is booking for someone
            // else — let the backend enforce against the target's wallet.
            const projected = (effectiveUser.balance ?? 0) - priced.total;
            const limit = effectiveUser.creditLimit ?? 0;
            if (projected < -limit) {
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
                const created = await bookingsApi.createBooking(newBookings[0] as any);
                await Promise.all([fetchCurrentUser(), fetchBookings()]);
                useBookingStore.getState().reset();
                setConfirmed(true);
                if ((created as any).status === 'pending_approval') {
                    toast.success(
                        'Заявка отправлена на согласование. Администратор одобрит её в ближайшее время — мы пришлём уведомление.',
                        { duration: 7000 },
                    );
                } else {
                    // «Ещё бронь» — быстрый повтор без полноценной корзины:
                    // возвращает к выбору свободных окон на ту же дату.
                    // Дата из уже собранной брони: стор к этому моменту сброшен.
                    const _d = newBookings[0].date;
                    toast.success('Бронь создана', {
                        duration: 6000,
                        action: {
                            label: 'Ещё бронь',
                            onClick: () => navigate(`/m/find?date=${_d}`),
                        },
                    });
                }
                navigate('/m/bookings', { replace: true });
            } else {
                // Multi-slot batch — addBookings handles its own toasts/errors.
                await addBookings(newBookings as any);
                useBookingStore.getState().reset();
                setConfirmed(true);
                toast.success('Брони созданы');
                navigate('/m/bookings', { replace: true });
            }
        } catch (e: any) {
            if (isSpecialistOnlyRefusal(e)) {
                showSpecialistGate();
                return;
            }
            const detail = e?.response?.data?.detail;
            const msg = typeof detail === 'string' ? detail : (e.message || 'Не удалось забронировать');
            toast.error(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (!firstSlot) return null;

    return (
        <>
            <div style={{
                paddingTop: 8,
                paddingBottom: 'calc(156px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 18,
            }}>
                {/* Header */}
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                        onClick={() => navigate(-1)}
                        aria-label="Назад"
                        style={{
                            background: COLOR.sunken,
                            border: 'none',
                            borderRadius: 10,
                            width: 44, height: 44,
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
                        Подтверждение
                    </h1>
                </div>

                {needsApplication && (
                    <div style={{ padding: '0 16px' }}>
                        <SpecialistGateCard variant="mobile" status={applicationStatus} />
                    </div>
                )}

                {/* Admin-proxy specialist picker — visible only to admins. */}
                {isAdminActor && specialistChoices.length > 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <Section title="За кого бронируете?">
                            <select
                                value={state.bookingForUser || ''}
                                onChange={e => useBookingStore.setState({ bookingForUser: e.target.value || null })}
                                style={{
                                    width: '100%',
                                    background: COLOR.card,
                                    border: `1px solid ${COLOR.ink10}`,
                                    borderRadius: 12,
                                    padding: '12px 14px',
                                    fontSize: 16,
                                    fontFamily: 'inherit',
                                    color: COLOR.ink,
                                    appearance: 'none',
                                    WebkitAppearance: 'none',
                                }}
                            >
                                <option value="">— За себя ({currentUser?.name || currentUser?.email}) —</option>
                                {specialistChoices
                                    .filter(u => u.email !== currentUser?.email)
                                    .map(u => (
                                        <option key={u.id} value={u.email}>{u.name || u.email}</option>
                                    ))}
                            </select>
                            {state.bookingForUser && (
                                <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 6 }}>
                                    Списание/абонемент уйдут с {effectiveUser?.name || state.bookingForUser}.
                                </div>
                            )}
                        </Section>
                    </div>
                )}

                {/* Hot booking notice */}
                {isHotBooking && (
                    <div style={{ padding: '0 16px' }}>
                        <div style={{
                            background: STATUS.pending.bg,
                            border: `1px solid ${STATUS.pending.fg}33`,
                            color: STATUS.pending.fg,
                            borderRadius: 12,
                            padding: '10px 12px',
                            fontSize: 13,
                            lineHeight: 1.4,
                        }}>
                            <Hourglass size={14} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }} />
                            <b>{(() => {
                                const f = priced.items[0];
                                if (!f) return 'Скоро старт';
                                const d = f.start.getDay();
                                return (d === 0 || d === 6) ? 'Меньше 24 ч до начала (выходной)' : 'Меньше 12 ч до начала';
                            })()}</b> — бронь уйдёт администратору на одобрение.
                            Слот закрепится за вами только после подтверждения.
                        </div>
                    </div>
                )}

                {/* Slot summary — cabinet visible prominently + "Change"
                    affordance (Galina 2026-05-31: бронились не те кабинеты,
                    а проверить было негде). Tap "Сменить" returns to /m/find
                    with the same date/duration so user can re-pick. */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: COLOR.ink,
                        color: COLOR.onInk,
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.7, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                            {formatDateLabel(state.date)}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Clock size={18} />
                            {firstSlot.startTime}–{formatTime(priced.items[priced.items.length - 1].end)}
                            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.7 }}>
                                · {formatBookingDuration(Math.round(totalDurationHours * 60))}
                            </span>
                        </div>
                        <div style={{
                            fontSize: 15,
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: `${COLOR.onInk}1A`,
                            padding: '8px 10px',
                            borderRadius: 8,
                        }}>
                            <MapPin size={15} /> {resource?.name}
                            {location && <span style={{ opacity: 0.7, fontWeight: 500 }}>· {location.name}</span>}
                        </div>
                        <button
                            onClick={() => navigate(-1)}
                            style={{
                                marginTop: 2,
                                alignSelf: 'flex-start',
                                background: 'transparent',
                                color: COLOR.onInk,
                                border: `1px solid ${COLOR.onInk}4D`,
                                borderRadius: 8,
                                minHeight: 44,
                                padding: '0 12px',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                opacity: 0.9,
                            }}
                        >
                            ← Сменить кабинет / время
                        </button>
                    </div>
                </div>

                {/* Клиент Psy-CRM — только для специалистов (у кого есть клиенты). */}
                {crmClients.length > 0 && (
                    <Section title="Клиент (Psy-CRM)">
                        <select
                            value={selectedCrmClientId}
                            onChange={e => setSelectedCrmClientId(e.target.value)}
                            style={{
                                width: '100%', padding: '12px 14px', borderRadius: 12,
                                border: `1px solid ${COLOR.ink10}`, background: COLOR.card,
                                fontFamily: 'inherit', fontSize: 14, color: COLOR.ink,
                            }}
                        >
                            <option value="">Без привязки к клиенту</option>
                            {crmClients.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 8 }}>
                            Бронь будет помечена клиентом — видно в шахматке и в CRM.
                        </div>
                    </Section>
                )}

                {/* Время: начало (шаг 30 мин) + длительность. Прямо здесь, рядом с
                    форматом/допами/ценой — ничего не перекрывает и всё видно. */}
                {editSlot && (
                    <Section title="Время">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                <button
                                    onClick={() => applyTime(curStartMin - 30, curDurMin)}
                                    disabled={!isFree(curStartMin - 30, curDurMin)}
                                    aria-label="Начать на 30 минут раньше"
                                    style={{
                                        width: 96, minHeight: 44, padding: '12px 0', borderRadius: 12, fontFamily: 'inherit',
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                        border: `1px solid ${COLOR.ink10}`, background: COLOR.card,
                                        opacity: isFree(curStartMin - 30, curDurMin) ? 1 : 0.35,
                                    }}
                                >← Раньше</button>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                        {mmToHHMM(curStartMin)}–{mmToHHMM(curStartMin + curDurMin)}
                                    </div>
                                    <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>начало · окончание</div>
                                </div>
                                <button
                                    onClick={() => applyTime(curStartMin + 30, curDurMin)}
                                    disabled={!isFree(curStartMin + 30, curDurMin)}
                                    aria-label="Начать на 30 минут позже"
                                    style={{
                                        width: 96, minHeight: 44, padding: '12px 0', borderRadius: 12, fontFamily: 'inherit',
                                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                        border: `1px solid ${COLOR.ink10}`, background: COLOR.card,
                                        opacity: isFree(curStartMin + 30, curDurMin) ? 1 : 0.35,
                                    }}
                                >Позже →</button>
                            </div>
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
                                            style={{
                                                flex: 1, minHeight: 44, padding: '12px 0', borderRadius: 12, cursor: ok ? 'pointer' : 'default',
                                                fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
                                                border: active ? 'none' : `1px solid ${COLOR.ink10}`,
                                                background: active ? COLOR.ink : COLOR.card,
                                                color: active ? COLOR.onInk : COLOR.ink,
                                                opacity: ok ? 1 : 0.35,
                                            }}
                                        >
                                            {formatBookingDuration(d)}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                                Серым — время, которое уже занято или выходит за 09:00–22:00.
                            </div>
                        </div>
                    </Section>
                )}

                {/* Формат — показываем, только если у кабинета правда есть выбор.
                    В большинстве кабинетов формат один (индивидуальный), и блок
                    из трёх кнопок, где две серые, только удлинял страницу. */}
                {(resource?.formats?.length ?? 1) > 1 && (
                <Section title="Формат">
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
                    }}>
                        {([
                            ['individual', 'Индивидуальный', '1 на 1'],
                            ['group', 'Групповой', 'от 5 чел. (с терапевтом)'],
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
                                    style={{
                                        background: active ? COLOR.ink : COLOR.card,
                                        color: active ? COLOR.onInk : COLOR.ink,
                                        border: active ? 'none' : `1px solid ${COLOR.ink10}`,
                                        borderRadius: 12,
                                        padding: '12px 8px',
                                        fontFamily: 'inherit',
                                        cursor: supported ? 'pointer' : 'not-allowed',
                                        opacity: supported ? 1 : 0.4,
                                        textAlign: 'center',
                                        display: 'flex', flexDirection: 'column', gap: 2,
                                    }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
                                    <span style={{ fontSize: 12, opacity: 0.7 }}>{sub}</span>
                                </button>
                            );
                        })}
                    </div>
                </Section>
                )}

                {/* Extras */}
                {availableExtras.length > 0 && (
                    <Section title="Дополнительные услуги">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {availableExtras.map(e => {
                                const active = state.extras.includes(e.id);
                                return (
                                    <button
                                        key={e.id}
                                        role="checkbox"
                                        aria-checked={active}
                                        onClick={() => state.toggleExtra(e.id)}
                                        style={{
                                            background: COLOR.card,
                                            border: `1px solid ${active ? COLOR.ink : COLOR.ink10}`,
                                            borderRadius: 12,
                                            padding: '12px 14px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            textAlign: 'left',
                                            color: COLOR.ink,
                                        }}
                                    >
                                        <div style={{
                                            width: 22, height: 22,
                                            borderRadius: 6,
                                            background: active ? COLOR.ink : 'transparent',
                                            border: `1.5px solid ${active ? COLOR.ink : COLOR.ink20}`,
                                            display: 'grid', placeItems: 'center',
                                            color: COLOR.onInk,
                                            flexShrink: 0,
                                        }}>
                                            {active && <Check size={14} />}
                                        </div>
                                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{e.name}</span>
                                        <span style={{ fontSize: 13, color: COLOR.ink60 }}>{e.price > 0 ? `+${formatGel(e.price)}` : 'бесплатно'}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </Section>
                )}

                {/* Повторение — нужно редко, поэтому по умолчанию свёрнуто:
                    у всех остальных путь до кнопки «Забронировать» короче. */}
                {!recurOpen && recurPattern === 'once' ? (
                    <div style={{ padding: '0 16px' }}>
                        <button
                            onClick={() => setRecurOpen(true)}
                            style={{
                                width: '100%', minHeight: 44, padding: '12px 14px', borderRadius: 12,
                                border: `1px dashed ${COLOR.ink20}`, background: 'transparent',
                                fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                                color: COLOR.ink80, cursor: 'pointer', textAlign: 'left',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}
                        >
                            <Repeat size={16} aria-hidden="true" /> Повторять регулярно →
                        </button>
                    </div>
                ) : (
                <Section title="Повторение">
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {([
                            ['once', 'Разово'],
                            ['weekly', 'Каждую неделю'],
                            ['biweekly', 'Раз в 2 недели'],
                            ['monthly', 'Раз в 4 недели'],
                        ] as Array<['once' | 'weekly' | 'biweekly' | 'monthly', string]>).map(([id, label]) => {
                            const active = recurPattern === id;
                            return (
                                <button
                                    key={id}
                                    aria-pressed={active}
                                    onClick={() => setRecurPattern(id)}
                                    style={{
                                        background: active ? COLOR.ink : COLOR.sunken,
                                        color: active ? COLOR.onInk : COLOR.ink,
                                        border: 'none',
                                        borderRadius: 10,
                                        minHeight: 44,
                                        padding: '0 12px',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        fontSize: 12,
                                        fontWeight: 600,
                                    }}
                                >
                                    {label}
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
                                            style={{
                                                flex: 1,
                                                background: active ? COLOR.card : 'transparent',
                                                color: COLOR.ink,
                                                border: `1px solid ${active ? COLOR.ink : COLOR.ink10}`,
                                                borderRadius: 10,
                                                minHeight: 44,
                                                padding: '0 10px',
                                                cursor: 'pointer',
                                                fontFamily: 'inherit',
                                                fontSize: 12,
                                                fontWeight: 600,
                                            }}
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
                                                style={{
                                                    background: active ? COLOR.ink : COLOR.sunken,
                                                    color: active ? COLOR.onInk : COLOR.ink,
                                                    border: 'none',
                                                    borderRadius: 10,
                                                    minWidth: 44,
                                                    minHeight: 44,
                                                    padding: '0 14px',
                                                    cursor: 'pointer',
                                                    fontFamily: 'inherit',
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {n}
                                            </button>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div>
                                    <input
                                        type="date"
                                        value={recurUntil}
                                        min={fmtDate(state.date, 'yyyy-MM-dd')}
                                        onChange={e => setRecurUntil(e.target.value)}
                                        style={{
                                            width: '100%',
                                            background: COLOR.card,
                                            border: `1px solid ${COLOR.ink10}`,
                                            borderRadius: 10,
                                            padding: '10px 12px',
                                            fontFamily: 'inherit',
                                            fontSize: 16,
                                            color: COLOR.ink,
                                        }}
                                    />
                                </div>
                            )}

                            {recurDates.length > 0 && (
                                <div style={{
                                    marginTop: 10,
                                    background: COLOR.sunken,
                                    borderRadius: 10,
                                    padding: '10px 12px',
                                    fontSize: 12,
                                    color: COLOR.ink80,
                                    lineHeight: 1.5,
                                }}>
                                    <b>Создастся {recurDates.length} {ruPlural(recurDates.length, ['сессия', 'сессии', 'сессий'])}:</b>{' '}
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
                </Section>
                )}

                {/* Payment — варианты в порядке сервера: бонус → абонемент → баланс. */}
                <div id="m-checkout-pay" style={{ scrollMarginTop: 12 }}>
                <Section title="Оплата">
                    <div role="radiogroup" aria-label="Способ оплаты" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {totalBonusHours > 0 && !isSeries && !plan.free && (
                            <PaymentRow
                                label="Бонусные часы"
                                sub={plan.bonusCovers
                                    ? `${fmtHours(totalBonusHours)} бесплатно`
                                    : `Нужно ${fmtHours(totalDurationHours)}, есть ${fmtHours(totalBonusHours)}`}
                                disabled={!plan.bonusCovers}
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
                                        ? subscriptionHoursLabel(subHours)
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
                                const bal = effectiveUser ? formatGel(effectiveUser.balance ?? 0, { fraction: 0 }) : '';
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
                </Section>
                </div>

                {/* Price summary */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: COLOR.sunken,
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <Row label="База" value={formatGel(priced.items.reduce((s, i) => s + i.price.basePrice, 0), { fraction: 0 })} />
                        {/* Пик (09–10, 20–22) уже внутри «Базы» — раньше клиент видел
                            на карточке кабинета «20 ₾/ч», а здесь 25 ₾ без объяснения. */}
                        {priced.items.some(i => (i.price.peakSurcharge ?? 0) > 0) && (
                            <Row
                                label="в т.ч. пиковые часы"
                                value={`+${formatGel(priced.items.reduce((s, i) => s + (i.price.peakSurcharge ?? 0), 0), { fraction: 0 })}`}
                            />
                        )}
                        {priced.items.some(i => i.price.extrasPrice > 0) && (
                            <Row label="Допуслуги" value={formatGel(priced.items.reduce((s, i) => s + i.price.extrasPrice, 0), { fraction: 0 })} />
                        )}
                        {priced.items.some(i => i.price.discountAmount > 0) && (
                            <Row
                                label="Скидка"
                                value={`−${formatGel(priced.items.reduce((s, i) => s + i.price.discountAmount, 0), { fraction: 0 })}`}
                                tone="ok"
                            />
                        )}
                        <div style={{ height: 1, background: COLOR.ink08, margin: '4px 0' }} />
                        <Row
                            label="Итого"
                            value={isSeries || payMethod === 'balance'
                                ? formatGel(priced.total, { fraction: 0 })
                                : payMethod === 'bonus'
                                    ? formatGel(0)
                                    : `${fmtHours(totalDurationHours)}${subMoney > 0 ? ` + ${formatGel(subMoney, { fraction: 0 })}` : ''}`}
                            bold
                        />
                        {!isSeries && payMethod === 'subscription' && (() => {
                            const firstStart = priced.items[0]?.start;
                            const deferred = !!firstStart && firstStart.getTime() - Date.now() > 24 * 3600 * 1000;
                            return (
                                <>
                                    <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                                        Спишется {fmtHours(totalDurationHours)} абонемента{subMoneyNote}
                                        {deferred && firstStart ? ` — ${formatChargeAt(firstStart)}, за сутки до начала.` : '.'}
                                    </div>
                                    {/* Часть остатка уже обещана будущим броням: честно
                                        говорим, что при нехватке часов крон за сутки до
                                        встречи возьмёт деньги (billing_defer). */}
                                    {!plan.subFreeCovers && (
                                        <div style={{ fontSize: 12, color: STATUS.danger.fg }}>
                                            Свободно только {fmtHours(subHours.free)}: {fmtHours(subHours.reserved)} уже в других бронях.
                                            {' '}Если к списанию часов не хватит, одна из броней спишется с баланса по обычной цене.
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                        {!isSeries && payMethod === 'bonus' && (
                            <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                                Спишется {fmtHours(totalDurationHours)} из бонусов — с баланса {formatGel(0)}
                            </div>
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
                            const firstStart = priced.items[0]?.start;
                            const deferred = !!firstStart && firstStart.getTime() - Date.now() > 24 * 3600 * 1000;
                            if (deferred) {
                                return (
                                    <div style={{ fontSize: 12, color: debt > 0 ? STATUS.danger.fg : COLOR.ink60 }}>
                                        Спишется с баланса {formatChargeAt(firstStart)} (за сутки до начала): {formatGel(priced.total, { fraction: 0 })}.
                                        {' '}Сейчас на балансе {formatGel(bal, { fraction: 0 })}
                                        {debt > 0 ? ` — не хватает ${formatGel(debt, { fraction: 0 })}, уйдёт в долг (лимит ${formatGel(effectiveUser.creditLimit ?? 0, { fraction: 0 })}), если не пополнить.` : '.'}
                                    </div>
                                );
                            }
                            return (
                                <div style={{ fontSize: 12, color: debt > 0 ? STATUS.danger.fg : COLOR.ink60 }}>
                                    {debt > 0
                                        ? `Спишется сразу ${formatGel(priced.total, { fraction: 0 })}, из них ${formatGel(debt, { fraction: 0 })} — в долг (лимит ${formatGel(effectiveUser.creditLimit ?? 0, { fraction: 0 })})`
                                        : `Спишется сразу ${formatGel(priced.total, { fraction: 0 })} с баланса, останется ${formatGel(after, { fraction: 0 })}`}
                                </div>
                            );
                        })()}
                        {recurPattern !== 'once' && effectiveOccurrences > 1 && (
                            seriesQuote && seriesQuote.occurrences === effectiveOccurrences ? (
                                <>
                                    <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                                        Серия из {seriesQuote.occurrences}: точно {formatGel(seriesQuote.totalMoney, { fraction: 0 })}
                                        {seriesQuote.totalHours > 0 ? ` + ${fmtHours(seriesQuote.totalHours)} с абонемента` : ''}
                                        {(seriesQuote.totalBonusHours ?? 0) > 0 ? ` + ${fmtHours(seriesQuote.totalBonusHours ?? 0)} из бонусов` : ''}
                                    </div>
                                    {(seriesQuote.subscriptionShortDates?.length ?? 0) > 0 && (
                                        <div style={{ fontSize: 12, color: STATUS.danger.fg }}>
                                            Абонемента хватит не на все даты ({seriesQuote.subscriptionShortDates.length} из {seriesQuote.occurrences} — мимо).
                                            Выберите оплату балансом или уменьшите число повторов, иначе серия не создастся.
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ fontSize: 12, color: COLOR.ink60 }}>
                                    Сумма серии ориентировочная — уточняем расчёт по каждой дате…
                                </div>
                            )
                        )}
                    </div>
                </div>
            </div>

            {/* Sticky CTA */}
            <div style={{
                position: 'fixed',
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '100%',
                maxWidth: 480,
                padding: '8px 16px',
                background: `linear-gradient(to bottom, ${COLOR.card}00 0%, ${COLOR.card} 30%)`,
                zIndex: Z.sticky,
                pointerEvents: 'none',
            }}>
                {/* Способ оплаты виден у кнопки — сам блок «Оплата» ниже первого
                    экрана, и раньше клиент жал кнопку, не видя, откуда спишется. */}
                {!confirmed && !isSeries && !needsApplication && (
                    <div style={{
                        pointerEvents: 'auto',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        background: COLOR.card, border: `1px solid ${COLOR.ink08}`, borderRadius: 10,
                        padding: '6px 10px', marginBottom: 6, fontSize: 12, color: COLOR.ink80,
                    }}>
                        <span>Оплата: <b style={{ color: COLOR.ink }}>{payName}</b></span>
                        {payChoices > 1 && (
                            <button
                                onClick={() => document.getElementById('m-checkout-pay')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    // Цель 44 px; отрицательный отступ — плашка не растёт.
                                    minHeight: 44, padding: '0 6px', margin: '-12px -6px',
                                    fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                                    color: COLOR.ink, textDecoration: 'underline',
                                }}
                            >
                                Изменить
                            </button>
                        )}
                    </div>
                )}
                <button
                    // Не специалист: вместо заведомого отказа — к анкете.
                    onClick={needsApplication ? () => navigate(SPECIALIST_APPLICATION_PATH) : submit}
                    disabled={submitting || confirmed}
                    className="press"
                    style={{
                        pointerEvents: 'auto',
                        width: '100%',
                        background: COLOR.ink,
                        color: COLOR.onInk,
                        border: 'none',
                        borderRadius: 12,
                        padding: '16px 18px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 10,
                        cursor: submitting ? 'wait' : 'pointer',
                        fontFamily: 'inherit',
                        fontSize: 16,
                        fontWeight: 600,
                        boxShadow: `0 4px 16px ${COLOR.ink20}`,
                        opacity: submitting ? 0.7 : 1,
                        // Asymmetric: пока submitting текст слегка размыт, на
                        // финальный «Готово» резко в фокусе. Маскирует
                        // crossfade — Emil pattern (filter: blur). Press scale
                        // даёт инстантный тактильный feedback на тап.
                        filter: submitting ? 'blur(0.8px)' : 'none',
                        transition: 'transform 160ms cubic-bezier(0.23,1,0.32,1), filter 200ms ease, opacity 200ms ease',
                    }}
                >
                    {submitting && <Loader2 size={18} className="animate-spin-fast" />}
                    {confirmed
                        ? 'Готово'
                        : needsApplication
                            ? (applicationStatus === 'none' ? 'Заполнить анкету специалиста' : 'Открыть анкету')
                        : submitting
                            ? (recurPattern !== 'once' ? 'Создаём серию…' : 'Бронируем…')
                            : recurPattern !== 'once'
                                ? (effectiveOccurrences > 0
                                    ? `Создать ${effectiveOccurrences} ${ruPlural(effectiveOccurrences, ['сессию', 'сессии', 'сессий'])} · ${formatGel(seriesQuote && seriesQuote.occurrences === effectiveOccurrences ? seriesQuote.totalMoney : priced.total * effectiveOccurrences, { fraction: 0 })}`
                                    : 'Выберите число повторов или дату')
                                : isHotBooking
                                    ? `Отправить на одобрение · ${payLabel}`
                                    : `Забронировать · ${payLabel}`}
                </button>
            </div>

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
                        <div style={{ fontSize: 14, color: COLOR.ink80, lineHeight: 1.5 }}>
                            Занято {seriesConflicts.length} из {effectiveOccurrences}:
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto', background: COLOR.sunken, borderRadius: 12,
                                      padding: '10px 12px', fontSize: 13, lineHeight: 1.7 }}>
                            {seriesConflicts.map(c => (
                                <div key={c.date}>{formatDateLabel(c.date, { capitalize: true })}</div>
                            ))}
                        </div>
                        <div style={{ fontSize: 13, color: COLOR.ink60 }}>
                            Можно создать серию без этих дат — остальные встречи забронируются.
                        </div>
                    </div>
                )}
            </Sheet>
        </>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
                textTransform: 'uppercase', color: COLOR.ink60,
                marginBottom: 8,
            }}>{title}</div>
            {children}
        </div>
    );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'ok' }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 600 : 500, color: COLOR.ink80 }}>{label}</span>
            <span style={{
                fontSize: bold ? 18 : 14,
                fontWeight: 600,
                color: tone === 'ok' ? STATUS.ok.fg : COLOR.ink,
            }}>{value}</span>
        </div>
    );
}

function PaymentRow({ label, sub, active, disabled, onClick }: {
    label: string;
    sub?: string;
    active: boolean;
    disabled?: boolean;
    onClick: () => void;
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            role="radio"
            aria-checked={active && !disabled}
            style={{
                background: COLOR.card,
                border: `1px solid ${active && !disabled ? COLOR.ink : COLOR.ink10}`,
                borderRadius: 12,
                padding: '12px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
                textAlign: 'left',
                opacity: disabled ? 0.5 : 1,
            }}
        >
            <div style={{
                width: 20, height: 20, borderRadius: 999,
                border: `2px solid ${active && !disabled ? COLOR.ink : COLOR.ink20}`,
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {active && !disabled && <div style={{ width: 10, height: 10, borderRadius: 999, background: COLOR.ink }} />}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: COLOR.ink }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: COLOR.ink60, marginTop: 2 }}>{sub}</div>}
            </div>
        </button>
    );
}

/** Минуты от полуночи → "HH:MM" (для сборки слотов редактора времени). */
function mmToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
