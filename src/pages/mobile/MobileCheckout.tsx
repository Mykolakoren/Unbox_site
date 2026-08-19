import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format as fmtDate, startOfWeek, endOfWeek, isWithinInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ArrowLeft, Check, Clock, MapPin, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '../../store/userStore';
import { useBookingStore } from '../../store/bookingStore';
import { useCrmStore } from '../../store/crmStore';
import { bookingsApi } from '../../api/bookings';
import { bonusesApi, type Bonus } from '../../api/bonuses';
import { RESOURCES, LOCATIONS, EXTRAS, availableExtrasForResource } from '../../utils/data';
import { calculatePrice } from '../../utils/pricing';
import { groupSlotsIntoBookings } from '../../utils/cartHelpers';
import { ruPlural } from '../../utils/plural';
import type { Format } from '../../types';

/**
 * Mobile-native checkout — replaces the desktop OptionsStep+ConfirmationStep
 * pair when the user comes from the /m/* shell.
 *
 * What it covers:
 *   - Format selector (chips, three options)
 *   - Extras toggles (sandbox / projector / flipchart / sandbox-toys)
 *   - Payment method (balance / subscription) when applicable
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

    // Активные подарочные часы (welcome bonus). Бэкенд хранит тип 'free_hour';
    // принимаем и camelCase на случай легаси-записей (как в десктопном мастере).
    const [activeBonuses, setActiveBonuses] = useState<Bonus[]>([]);
    useEffect(() => {
        if (!currentUser) return;
        bonusesApi.getMyBonuses()
            .then(bs => setActiveBonuses(bs.filter(b =>
                b.status === 'active' && (b.type === 'free_hour' || b.type === 'freeHour'))))
            .catch(() => {});
    }, [currentUser]);

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

    /** Subscription eligibility — copy of the desktop wizard's logic, simplified. */
    const subInfo = useMemo(() => {
        const sub = effectiveUser?.subscription;
        if (!sub) return { eligible: false, reason: 'Нет абонемента' };
        if (sub.isFrozen) return { eligible: false, reason: 'Абонемент заморожен' };
        if (sub.remainingHours < totalDurationHours - 0.1) {
            return { eligible: false, reason: `Осталось ${sub.remainingHours.toFixed(1)}ч, нужно ${totalDurationHours.toFixed(1)}ч` };
        }
        return { eligible: true, reason: '' };
    }, [effectiveUser, totalDurationHours]);

    // Бонусные часы. Право = бонус-часов хватает на всю бронь И это одиночная
    // бронь (серию бонусом не покрываем — welcome bonus 1ч не хватит на серию).
    const totalBonusHours = activeBonuses.reduce((s, b) => s + (b.quantity || 0), 0);
    // !state.bookingForUser — в режиме «админ за клиента» бонусы принадлежат
    // админу, не клиенту, поэтому бонусную оплату там не предлагаем.
    const bonusEligible = recurPattern === 'once'
        && !state.bookingForUser
        && totalBonusHours > 0
        && totalBonusHours >= totalDurationHours - 0.01;

    // Reset payment to balance if subscription got disabled by hours change.
    useEffect(() => {
        if (!subInfo.eligible && state.paymentMethod === 'subscription') {
            useBookingStore.setState({ paymentMethod: 'balance' });
        }
        if (!bonusEligible && state.paymentMethod === 'bonus') {
            useBookingStore.setState({ paymentMethod: 'balance' });
        }
    }, [subInfo.eligible, bonusEligible, state.paymentMethod]);

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

    const resolveFinalMethod = (): 'balance' | 'subscription' | 'bonus' =>
        (bonusEligible && state.paymentMethod === 'bonus')
            ? 'bonus'
            : (subInfo.eligible && state.paymentMethod === 'subscription')
                ? 'subscription'
                : 'balance';

    /** Создание серии. skipConflicts=true — пропустить занятые даты (после того,
     *  как человек увидел их список и нажал «Создать остальные»). Раньше любой
     *  конфликт валил всю пачку, и поправить конкретные даты было нельзя. */
    const createSeries = async (skipConflicts: boolean) => {
        if (!firstSlot) return;
        if (effectiveOccurrences < 1) {
            toast.error('Выбери число повторов или дату «до»');
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
                `Серия создана: ${result.created} ${ruPlural(result.created, ['сессия', 'сессии', 'сессий'])} · ${result.totalCost.toFixed(0)} ₾${skippedNote}`,
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
        // their credit limit. Subscription path skips this — backend
        // validates remaining hours. We check the *effective* user (target
        // if admin-proxy, else current user).
        if (finalMethod === 'balance' && effectiveUser?.email === currentUser.email) {
            // Skip the projected-balance gate when admin is booking for someone
            // else — let the backend enforce against the target's wallet.
            const projected = (effectiveUser.balance ?? 0) - priced.total;
            const limit = effectiveUser.creditLimit ?? 0;
            if (projected < -limit) {
                const shortfall = Math.abs(projected + limit);
                toast.error(`Не хватает ${shortfall.toFixed(0)} ₾. Пополни баланс или попроси админа поднять кредитный лимит.`, { duration: 6000 });
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
                        '⏳ Заявка отправлена на согласование. Админ одобрит её в ближайшее время — мы пришлём уведомление.',
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
                paddingBottom: 'calc(120px + env(safe-area-inset-bottom, 0px))',
                display: 'flex', flexDirection: 'column', gap: 18,
            }}>
                {/* Header */}
                <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: '#F4F4F2',
                            border: 'none',
                            borderRadius: 10,
                            width: 36, height: 36,
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>
                        Подтверждение
                    </h1>
                </div>

                {/* Admin-proxy specialist picker — visible only to admins. */}
                {isAdminActor && specialistChoices.length > 0 && (
                    <div style={{ padding: '0 16px' }}>
                        <Section title="За кого бронируешь?">
                            <select
                                value={state.bookingForUser || ''}
                                onChange={e => useBookingStore.setState({ bookingForUser: e.target.value || null })}
                                style={{
                                    width: '100%',
                                    background: '#fff',
                                    border: '1px solid rgba(0,0,0,0.10)',
                                    borderRadius: 12,
                                    padding: '12px 14px',
                                    fontSize: 16,
                                    fontFamily: 'inherit',
                                    color: '#0E0E0E',
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
                                <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
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
                            background: '#FEF3C7',
                            border: '1px solid #FCD34D',
                            color: '#8A5A00',
                            borderRadius: 12,
                            padding: '10px 12px',
                            fontSize: 13,
                            lineHeight: 1.4,
                        }}>
                            ⏳ <b>{(() => {
                                const f = priced.items[0];
                                if (!f) return 'Скоро старт';
                                const d = f.start.getDay();
                                return (d === 0 || d === 6) ? 'Меньше 24ч до старта (выходной)' : 'Меньше 12ч до старта';
                            })()}</b> — бронь уйдёт админу на одобрение.
                            Слот закрепится за тобой только после подтверждения.
                        </div>
                    </div>
                )}

                {/* Slot summary — cabinet visible prominently + "Change"
                    affordance (Galina 2026-05-31: бронились не те кабинеты,
                    а проверить было негде). Tap "Сменить" returns to /m/find
                    with the same date/duration so user can re-pick. */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: '#0E0E0E',
                        color: '#fff',
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                            {fmtDate(state.date, 'EEEE, d MMMM', { locale: ru })}
                        </div>
                        <div style={{ fontSize: 20, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Clock size={18} />
                            {firstSlot.startTime}–{priced.items[priced.items.length - 1].end.toTimeString().slice(0, 5)}
                            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.7 }}>
                                · {totalDurationHours.toFixed(1)}ч
                            </span>
                        </div>
                        <div style={{
                            fontSize: 15,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            background: 'rgba(255,255,255,0.10)',
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
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.30)',
                                borderRadius: 8,
                                padding: '6px 10px',
                                fontSize: 11,
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
                                border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
                                fontFamily: 'inherit', fontSize: 14, color: '#0E0E0E',
                            }}
                        >
                            <option value="">Без привязки к клиенту</option>
                            {crmClients.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                        <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
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
                                    style={{
                                        width: 96, padding: '12px 0', borderRadius: 12, fontFamily: 'inherit',
                                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                        border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
                                        opacity: isFree(curStartMin - 30, curDurMin) ? 1 : 0.35,
                                    }}
                                >− 30 мин</button>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                                        {mmToHHMM(curStartMin)}–{mmToHHMM(curStartMin + curDurMin)}
                                    </div>
                                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>начало · окончание</div>
                                </div>
                                <button
                                    onClick={() => applyTime(curStartMin + 30, curDurMin)}
                                    disabled={!isFree(curStartMin + 30, curDurMin)}
                                    style={{
                                        width: 96, padding: '12px 0', borderRadius: 12, fontFamily: 'inherit',
                                        fontSize: 13, fontWeight: 700, cursor: 'pointer',
                                        border: '1px solid rgba(0,0,0,0.12)', background: '#fff',
                                        opacity: isFree(curStartMin + 30, curDurMin) ? 1 : 0.35,
                                    }}
                                >+ 30 мин</button>
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
                                            style={{
                                                flex: 1, padding: '12px 0', borderRadius: 12, cursor: ok ? 'pointer' : 'default',
                                                fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
                                                border: active ? 'none' : '1px solid rgba(0,0,0,0.12)',
                                                background: active ? '#0E0E0E' : '#fff',
                                                color: active ? '#fff' : '#0E0E0E',
                                                opacity: ok ? 1 : 0.35,
                                            }}
                                        >
                                            {d % 60 === 0 ? `${d / 60}ч` : `${Math.floor(d / 60)}.5ч`}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ fontSize: 12, color: '#888' }}>
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
                                    onClick={() => useBookingStore.setState({ format: id })}
                                    style={{
                                        background: active ? '#0E0E0E' : '#fff',
                                        color: active ? '#fff' : '#0E0E0E',
                                        border: active ? 'none' : '1px solid rgba(0,0,0,0.10)',
                                        borderRadius: 12,
                                        padding: '12px 8px',
                                        fontFamily: 'inherit',
                                        cursor: supported ? 'pointer' : 'not-allowed',
                                        opacity: supported ? 1 : 0.4,
                                        textAlign: 'center',
                                        display: 'flex', flexDirection: 'column', gap: 2,
                                    }}
                                >
                                    <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
                                    <span style={{ fontSize: 10, opacity: 0.7 }}>{sub}</span>
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
                                        onClick={() => state.toggleExtra(e.id)}
                                        style={{
                                            background: '#fff',
                                            border: `1px solid ${active ? '#0E0E0E' : 'rgba(0,0,0,0.10)'}`,
                                            borderRadius: 12,
                                            padding: '12px 14px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 12,
                                            cursor: 'pointer',
                                            fontFamily: 'inherit',
                                            textAlign: 'left',
                                            color: '#0E0E0E',
                                        }}
                                    >
                                        <div style={{
                                            width: 22, height: 22,
                                            borderRadius: 6,
                                            background: active ? '#0E0E0E' : 'transparent',
                                            border: `1.5px solid ${active ? '#0E0E0E' : 'rgba(0,0,0,0.20)'}`,
                                            display: 'grid', placeItems: 'center',
                                            color: '#fff',
                                            flexShrink: 0,
                                        }}>
                                            {active && <Check size={14} />}
                                        </div>
                                        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{e.name}</span>
                                        <span style={{ fontSize: 13, color: '#666' }}>+{e.price}₾</span>
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
                                width: '100%', padding: '12px 14px', borderRadius: 12,
                                border: '1px dashed rgba(0,0,0,0.18)', background: 'transparent',
                                fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                                color: '#555', cursor: 'pointer', textAlign: 'left',
                            }}
                        >
                            🔁 Повторять регулярно →
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
                                    onClick={() => setRecurPattern(id)}
                                    style={{
                                        background: active ? '#0E0E0E' : '#F4F4F2',
                                        color: active ? '#fff' : '#0E0E0E',
                                        border: 'none',
                                        borderRadius: 10,
                                        padding: '8px 12px',
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                        fontSize: 12,
                                        fontWeight: 700,
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
                                            onClick={() => setRecurMode(id)}
                                            style={{
                                                flex: 1,
                                                background: active ? '#fff' : 'transparent',
                                                color: '#0E0E0E',
                                                border: `1px solid ${active ? '#0E0E0E' : 'rgba(0,0,0,0.12)'}`,
                                                borderRadius: 10,
                                                padding: '6px 10px',
                                                cursor: 'pointer',
                                                fontFamily: 'inherit',
                                                fontSize: 12,
                                                fontWeight: 700,
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
                                                onClick={() => setRecurOccurrences(n)}
                                                style={{
                                                    background: active ? '#0E0E0E' : '#F4F4F2',
                                                    color: active ? '#fff' : '#0E0E0E',
                                                    border: 'none',
                                                    borderRadius: 10,
                                                    padding: '8px 14px',
                                                    cursor: 'pointer',
                                                    fontFamily: 'inherit',
                                                    fontSize: 13,
                                                    fontWeight: 700,
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
                                            background: '#fff',
                                            border: '1px solid rgba(0,0,0,0.10)',
                                            borderRadius: 10,
                                            padding: '10px 12px',
                                            fontFamily: 'inherit',
                                            fontSize: 16,
                                            color: '#0E0E0E',
                                        }}
                                    />
                                </div>
                            )}

                            {recurDates.length > 0 && (
                                <div style={{
                                    marginTop: 10,
                                    background: '#F4F4F2',
                                    borderRadius: 10,
                                    padding: '10px 12px',
                                    fontSize: 12,
                                    color: '#444',
                                    lineHeight: 1.5,
                                }}>
                                    <b>Создастся {recurDates.length} {ruPlural(recurDates.length, ['сессия', 'сессии', 'сессий'])}:</b>{' '}
                                    {recurDates
                                        .slice(0, 4)
                                        .map(d => fmtDate(d, 'd MMM', { locale: ru }))
                                        .join(', ')}
                                    {recurDates.length > 4 && (
                                        <>, …, <b>{fmtDate(recurDates[recurDates.length - 1], 'd MMM', { locale: ru })}</b></>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </Section>
                )}

                {/* Payment */}
                <Section title="Оплата">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {currentUser?.subscription && (
                            <PaymentRow
                                label="Абонемент"
                                sub={subInfo.eligible
                                    ? `Осталось ${currentUser.subscription.remainingHours.toFixed(1)} ч`
                                    : subInfo.reason}
                                disabled={!subInfo.eligible}
                                active={state.paymentMethod === 'subscription'}
                                onClick={() => useBookingStore.setState({ paymentMethod: 'subscription' })}
                            />
                        )}
                        {totalBonusHours > 0 && recurPattern === 'once' && !state.bookingForUser && (
                            <PaymentRow
                                label="Бонусные часы"
                                sub={bonusEligible
                                    ? `${totalBonusHours.toFixed(1)} ч бесплатно`
                                    : `Нужно ${totalDurationHours.toFixed(1)} ч, есть ${totalBonusHours.toFixed(1)} ч`}
                                disabled={!bonusEligible}
                                active={state.paymentMethod === 'bonus'}
                                onClick={() => bonusEligible && useBookingStore.setState({ paymentMethod: 'bonus' })}
                            />
                        )}
                        <PaymentRow
                            label="Баланс"
                            sub={currentUser ? `${(currentUser.balance ?? 0).toFixed(0)} ₾` : ''}
                            active={state.paymentMethod !== 'subscription' && state.paymentMethod !== 'bonus'}
                            onClick={() => useBookingStore.setState({ paymentMethod: 'balance' })}
                        />
                    </div>
                </Section>

                {/* Price summary */}
                <div style={{ padding: '0 16px' }}>
                    <div style={{
                        background: '#F4F4F2',
                        borderRadius: 14,
                        padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 8,
                    }}>
                        <Row label="База" value={`${priced.items.reduce((s, i) => s + i.price.basePrice, 0).toFixed(0)} ₾`} />
                        {priced.items.some(i => i.price.extrasPrice > 0) && (
                            <Row label="Допуслуги" value={`${priced.items.reduce((s, i) => s + i.price.extrasPrice, 0).toFixed(0)} ₾`} />
                        )}
                        {priced.items.some(i => i.price.discountAmount > 0) && (
                            <Row
                                label="Скидка"
                                value={`−${priced.items.reduce((s, i) => s + i.price.discountAmount, 0).toFixed(0)} ₾`}
                                tone="ok"
                            />
                        )}
                        <div style={{ height: 1, background: 'rgba(0,0,0,0.08)', margin: '4px 0' }} />
                        <Row label="Итого" value={`${priced.total.toFixed(0)} ₾`} bold />
                        {state.paymentMethod === 'subscription' && subInfo.eligible && (
                            <div style={{ fontSize: 12, color: '#666' }}>
                                Спишется {totalDurationHours.toFixed(1)} ч с абонемента
                            </div>
                        )}
                        {state.paymentMethod === 'bonus' && bonusEligible && (
                            <div style={{ fontSize: 12, color: '#666' }}>
                                Спишется {totalDurationHours.toFixed(1)} ч из бонуса — с баланса 0 ₾
                            </div>
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
                background: 'linear-gradient(to bottom, rgba(255,255,255,0) 0%, #fff 30%)',
                zIndex: 90,
                pointerEvents: 'none',
            }}>
                <button
                    onClick={submit}
                    disabled={submitting || confirmed}
                    className="press"
                    style={{
                        pointerEvents: 'auto',
                        width: '100%',
                        background: '#0E0E0E',
                        color: '#fff',
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
                        fontWeight: 700,
                        boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
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
                        : submitting
                            ? (recurPattern !== 'once' ? 'Создаём серию…' : 'Бронируем…')
                            : recurPattern !== 'once'
                                ? (effectiveOccurrences > 0
                                    ? `Создать ${effectiveOccurrences} ${ruPlural(effectiveOccurrences, ['сессию', 'сессии', 'сессий'])} · ${(priced.total * effectiveOccurrences).toFixed(0)} ₾`
                                    : 'Выбери число повторов или дату')
                                : isHotBooking
                                    ? `Отправить на одобрение · ${priced.total.toFixed(0)} ₾`
                                    : `Забронировать · ${priced.total.toFixed(0)} ₾`}
                </button>
            </div>

            {/* Конфликты серии: показываем занятые даты и даём создать остальные,
                вместо того чтобы валить всю пачку одним тостом. */}
            {seriesConflicts && (
                <div
                    onClick={() => setSeriesConflicts(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 220,
                             display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ background: '#fff', borderRadius: 18, padding: 20, width: '100%', maxWidth: 400,
                                 display: 'flex', flexDirection: 'column', gap: 12 }}
                    >
                        <div style={{ fontSize: 17, fontWeight: 800 }}>
                            Часть дат занята
                        </div>
                        <div style={{ fontSize: 14, color: '#555', lineHeight: 1.5 }}>
                            Занято {seriesConflicts.length} из {effectiveOccurrences}:
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto', background: '#F4F4F2', borderRadius: 12,
                                      padding: '10px 12px', fontSize: 13, lineHeight: 1.7 }}>
                            {seriesConflicts.map(c => (
                                <div key={c.date}>
                                    {(() => {
                                        const [y, m, d] = c.date.split('-').map(Number);
                                        return fmtDate(new Date(y, m - 1, d), 'd MMMM, EEEE', { locale: ru });
                                    })()}
                                </div>
                            ))}
                        </div>
                        <div style={{ fontSize: 13, color: '#777' }}>
                            Можно создать серию без этих дат — остальные встречи забронируются.
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                            <button
                                onClick={() => createSeries(true)}
                                disabled={submitting || seriesConflicts.length >= effectiveOccurrences}
                                style={{ padding: '14px 0', borderRadius: 12, fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
                                         border: 'none', color: '#fff',
                                         background: seriesConflicts.length >= effectiveOccurrences ? '#BBB' : '#0E0E0E',
                                         cursor: seriesConflicts.length >= effectiveOccurrences ? 'default' : 'pointer' }}
                            >
                                {submitting
                                    ? 'Создаём…'
                                    : `Создать остальные (${Math.max(0, effectiveOccurrences - seriesConflicts.length)})`}
                            </button>
                            <button
                                onClick={() => setSeriesConflicts(null)}
                                style={{ padding: '13px 0', borderRadius: 12, fontFamily: 'inherit', fontSize: 15, fontWeight: 700,
                                         border: '1px solid rgba(0,0,0,0.12)', background: '#fff', cursor: 'pointer' }}
                            >
                                Изменить время
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '0 16px' }}>
            <div style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: '#999',
                marginBottom: 8,
            }}>{title}</div>
            {children}
        </div>
    );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: 'ok' }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: bold ? 15 : 13, fontWeight: bold ? 700 : 500, color: '#444' }}>{label}</span>
            <span style={{
                fontSize: bold ? 18 : 14,
                fontWeight: bold ? 700 : 600,
                color: tone === 'ok' ? '#1B6E36' : '#0E0E0E',
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
            style={{
                background: '#fff',
                border: `1px solid ${active && !disabled ? '#0E0E0E' : 'rgba(0,0,0,0.10)'}`,
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
                border: `2px solid ${active && !disabled ? '#0E0E0E' : 'rgba(0,0,0,0.25)'}`,
                display: 'grid', placeItems: 'center',
                flexShrink: 0,
            }}>
                {active && !disabled && <div style={{ width: 10, height: 10, borderRadius: 999, background: '#0E0E0E' }} />}
            </div>
            <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0E0E0E' }}>{label}</div>
                {sub && <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{sub}</div>}
            </div>
        </button>
    );
}

/** Минуты от полуночи → "HH:MM" (для сборки слотов редактора времени). */
function mmToHHMM(m: number) {
    const h = Math.floor(m / 60), mm = m % 60;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
