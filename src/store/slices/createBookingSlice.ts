import type { StateCreator } from 'zustand';
import { toast } from 'sonner';
import type { UserStore, BookingSlice, BookingHistoryItem } from '../types';
import { bookingsApi } from '../../api/bookings';
import { isFrozenSub, notifyIfPauseLifted } from '../../utils/pauseLiftNotice';

// Номер последнего запуска fetchBookings и номер последнего ПРИМЕНЁННОГО
// ответа. На старте App.tsx и экран зовут fetchBookings одновременно — без
// этого запоздавший старый ответ (например, упавший) перетирал свежий.
let fetchSeq = 0;
let appliedSeq = 0;

// Скорость 23.10: экран и действия зовут fetchAllBookings пачкой (шахматка,
// дашборд, «после отмены»…) — каждый раз 5000 броней. Пока запрос в пути,
// новые вызовы ждут его же; если за это время что-то просили — ещё ОДИН
// догоняющий запрос, чтобы данные были свежее последнего действия.
let allInFlight: Promise<boolean> | null = null;
let allAgain = false;
// Пришёл ли хоть раз админский список окна (а не «мои + публичные» из fetchBookings).
let windowLoaded = false;

// 25.10: окно по умолчанию — 45 дней назад (CRM смотрит «активен за 45 дней»)
// и 60 вперёд. Раньше было «5000 последних» — при 9576 бронях это отрезало
// всё старше 20.08. Старое/дальнее догружается через ensureBookingsRange.
const WINDOW_BACK_DAYS = 45;
const WINDOW_AHEAD_DAYS = 60;
const dayStr = (d: Date) => {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
};
const shiftDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const defaultWindow = () => {
    const today = new Date();
    return { from: dayStr(shiftDays(today, -WINDOW_BACK_DAYS)), to: dayStr(shiftDays(today, WINDOW_AHEAD_DAYS)) };
};

export const createBookingSlice: StateCreator<UserStore, [], [], BookingSlice> = (set, get) => ({
    bookings: [],
    bookingsWindow: null,
    bookingsStatus: 'idle',
    bookingsLoadedAt: null,
    occupancyStatus: 'idle',

    fetchBookings: async () => {
        const seq = ++fetchSeq;
        // Уже загруженное обновляем тихо (статус 'ready' остаётся), а с нуля
        // или после ошибки — честно показываем «загружаем».
        set(s => ({
            bookingsStatus: s.bookingsStatus === 'ready' ? 'ready' : 'loading',
            occupancyStatus: s.occupancyStatus === 'ready' ? 'ready' : 'loading',
        }));
        try {
            // Use Promise.allSettled to fetch both in parallel and survive individual failures
            const [myResult, publicResult] = await Promise.allSettled([
                bookingsApi.getMyBookings(),
                bookingsApi.getPublicBookings()
            ]);

            // Пока ждали, ушёл запрос новее и его ответ уже применён —
            // этот ответ устарел, не трогаем стор.
            if (seq < appliedSeq) return;
            appliedSeq = seq;

            // Упавшую часть НЕ заменяем пустым списком: раньше сбой /me
            // стирал уже показанные брони («броней нет»), а сбой /public —
            // занятость (занятые кабинеты выглядели свободными). Берём
            // прошлые данные этой части: у публичных строк userId пустой
            // (сервер его скрывает), у моих — заполнен.
            const prev = get().bookings;
            const myOk = myResult.status === 'fulfilled';
            const publicOk = publicResult.status === 'fulfilled';

            const myBookings: BookingHistoryItem[] = myOk
                ? myResult.value
                : prev.filter(b => !!b.userId);
            const publicBookings: BookingHistoryItem[] = publicOk
                ? publicResult.value
                : prev.filter(b => !b.userId);

            // 3. Merge: prefer 'myBookings' (more details) over 'publicBookings'
            const myIds = new Set(myBookings.map(b => b.id));
            const uniquePublic = publicBookings.filter(b => !myIds.has(b.id));

            // Это не админское окно — ensureBookingsRange не должен считать его загруженным.
            windowLoaded = false;
            set({
                bookings: [...myBookings, ...uniquePublic],
                bookingsStatus: myOk ? 'ready' : 'error',
                ...(myOk ? { bookingsLoadedAt: Date.now() } : {}),
                occupancyStatus: publicOk ? 'ready' : 'error',
            });
        } catch (error) {
            if (seq >= appliedSeq) {
                appliedSeq = seq;
                set({ bookingsStatus: 'error', occupancyStatus: 'error' });
            }
            toast.error('Не удалось загрузить бронирования');
        }
    },

    fetchAllBookings: async () => {
        // Admin-only endpoint. Non-admin users hit it via `fetchBookings`
        // chained from various places (e.g. after a booking create) and
        // get 403 "Not enough privileges" surfaced as a red toast — even
        // though the booking itself succeeded. Silently skip for them.
        const role = (get() as any)?.currentUser?.role;
        const isAdmin = role === 'owner' || role === 'senior_admin' || role === 'admin';
        if (!isAdmin) {
            return false;
        }
        // Quiet retry: a single 5xx / network blip shouldn't bother the
        // admin either. Surface only the second failure with the server's
        // detail so the message tells the truth (rate limit, etc.). 401/403
        // never bubble — those are silenced above.
        if (allInFlight) {
            // Всегда догоняющий: запрос в пути мог уйти в базу раньше, чем
            // сохранилось действие админа (ревизия 24.10).
            allAgain = true;
            return allInFlight;
        }
        if (!get().bookingsWindow) set({ bookingsWindow: defaultWindow() });
        const run = async (): Promise<boolean> => {
            // Окно читаем в момент запроса: если его расширили, пока шёл прошлый,
            // догоняющий запрос возьмёт уже новое окно.
            const w = get().bookingsWindow || defaultWindow();
            const tryOnce = () => bookingsApi.getBookingsWindow(w.from, w.to);
            try {
                const bookings = await tryOnce().catch(async (e) => {
                    if (e?.response?.status === 401 || e?.response?.status === 403) throw e;
                    await new Promise(r => setTimeout(r, 500));
                    return tryOnce();
                });
                set({ bookings });
                windowLoaded = true;
                return true;
            } catch (error: any) {
                // Окно уже расширено «в долг» — пусть следующий ensure повторит загрузку.
                windowLoaded = false;
                const status = error?.response?.status;
                if (status === 401 || status === 403) return false;  // not for us, no UI noise
                const detail = error?.response?.data?.detail
                    || error?.message
                    || 'Не удалось загрузить бронирования';
                toast.error(detail);
                return false;
            }
        };
        allInFlight = (async () => {
            let ok = await run();
            while (allAgain) {
                allAgain = false;
                ok = await run();
            }
            return ok;
        })().finally(() => { allInFlight = null; });
        return allInFlight;
    },

    ensureBookingsRange: async (from, to) => {
        const role = (get() as any)?.currentUser?.role;
        if (!(role === 'owner' || role === 'senior_admin' || role === 'admin')) return false;
        if (!get().bookingsWindow) set({ bookingsWindow: defaultWindow() });
        const w = get().bookingsWindow!;
        const needFrom = dayStr(from), needTo = dayStr(to);
        if (needFrom >= w.from && needTo <= w.to) {
            // Окно уже покрывает: ждём идущую загрузку или берём готовое — без
            // лишнего запроса (шахматка при открытии зовёт и общий, и этот).
            if (allInFlight) return allInFlight;
            if (windowLoaded) return true;
            return (get() as any).fetchAllBookings();
        }
        set({ bookingsWindow: { from: needFrom < w.from ? needFrom : w.from, to: needTo > w.to ? needTo : w.to } });
        return (get() as any).fetchAllBookings();
    },

    ensureBookingLoaded: async (id) => {
        const have = get().bookings.find(b => b.id === id);
        if (have) return have;
        try {
            const b = await bookingsApi.getBookingById(id);
            if (!b) return null;
            const d = new Date(b.date as any);
            await (get() as any).ensureBookingsRange(shiftDays(d, -1), shiftDays(d, 2));
            return get().bookings.find(x => x.id === id) || b;
        } catch {
            return null;
        }
    },

    addBooking: async (bookingData) => {
        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return null;

        // Своя бронь (не «за клиента»): была ли пауза до брони.
        const wasFrozen = !(bookingData as any).targetUserId && isFrozenSub(currentUser);
        try {
            const newBooking = await bookingsApi.createBooking({
                ...bookingData,
                finalPrice: bookingData.finalPrice,
                paymentMethod: bookingData.paymentMethod
            });

            set((state) => ({ bookings: [...state.bookings, newBooking] }));

            // Fetch updated user to reflect balance/subscription changes from backend
            await get().fetchCurrentUser();
            notifyIfPauseLifted(wasFrozen, get().currentUser);

            return newBooking;

        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            toast.error(detail || 'Не удалось создать бронирование');
            throw error;
        }
    },

    // Excel #24 — when the user selected multiple non-contiguous blocks
    // (multiple `cartDetails` entries for the same flow), we route through
    // the batch endpoint so all slots land in one transaction with one
    // `recurring_group_id` — failure is atomic, and the admin can cancel
    // the whole series with a single click later.
    //
    // Single-slot calls still fall through to the old one-by-one path so
    // we don't lose the existing error handling / rollback for those.
    addBookings: async (bookingsData) => {
        if (bookingsData.length === 0) return;
        if (bookingsData.length === 1) {
            const nb = await get().addBooking(bookingsData[0]);
            return { pendingApproval: nb && nb.status === 'pending_approval' ? 1 : 0 };
        }
        // Multi-slot batch path
        const wasFrozen = !(bookingsData[0] as any).targetUserId && isFrozenSub(get().currentUser);
        try {
            const first = bookingsData[0] as any;
            const res = await bookingsApi.createMultiSlotBooking({
                slots: bookingsData.map((b: any) => ({
                    resourceId: b.resourceId,
                    locationId: b.locationId || 'unbox_one',
                    date: typeof b.date === 'string' ? b.date : new Date(b.date).toISOString().slice(0, 10),
                    startTime: b.startTime,
                    duration: b.duration,
                    format: b.format || 'individual',
                    // 25.10: допы терялись — кофе выбран, а бронь и цена без него.
                    extras: Array.isArray(b.extras) ? b.extras : [],
                })),
                paymentMethod: first.paymentMethod || 'balance',
                targetUserId: first.targetUserId,
                crmClientId: first.crmClientId,
            });
            // Refetch state so store matches server truth
            await get().fetchCurrentUser();
            notifyIfPauseLifted(wasFrozen, get().currentUser);
            // Не админу fetchAllBookings ничего не грузит — свои брони отдельно
            // (аудит 12.10: после корзины «Мои брони» оставались без новых).
            const fetchAllBookings = (get() as any).fetchAllBookings;
            const loadedAll = typeof fetchAllBookings === 'function' ? await fetchAllBookings() : false;
            if (loadedAll === false && typeof (get() as any).fetchBookings === 'function') {
                await (get() as any).fetchBookings();
            }
            // Срочные слоты корзины сервер ставит «на подтверждение» (12.10) —
            // экран говорит об этом по ответу сервера, а не по догадке.
            return { pendingApproval: (res.bookings || []).filter((b: any) => b.status === 'pending_approval').length };
        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            const message = typeof detail === 'string'
                ? detail
                : detail?.message
                    ? `${detail.message}${detail.conflicts ? ' · ' + detail.conflicts.map((c: any) => c.date + ' ' + c.start_time).join(', ') : ''}`
                    : 'Не удалось создать все периоды — попробуйте ещё раз';
            toast.error(message);
            throw error;
        }
    },

    rescheduleBooking: (oldId, newBookingData) => set((state) => {
        const currentUser = state.currentUser;
        if (!currentUser) return state;

        const newBooking: BookingHistoryItem = {
            ...newBookingData,
            userId: currentUser.email,
            status: 'confirmed',
            createdAt: new Date().toISOString(),
            finalPrice: newBookingData.finalPrice || 0
        };

        const updatedBookings = state.bookings.map(b =>
            b.id === oldId ? { ...b, status: 'rescheduled' as const } : b
        );

        const oldBooking = state.bookings.find(b => b.id === oldId);
        let updatedUser = state.users.find(u => u.email === currentUser.email);
        let updatedUsers = [...state.users];

        if (oldBooking && updatedUser) {
            // 1. Refund Old
            if (oldBooking.paymentMethod === 'subscription' && updatedUser.subscription) {
                const hoursToRefund = oldBooking.hoursDeducted || (oldBooking.duration / 60);
                updatedUser = {
                    ...updatedUser,
                    subscription: {
                        ...updatedUser.subscription,
                        remainingHours: updatedUser.subscription.remainingHours + hoursToRefund
                    }
                };
            } else if (oldBooking.paymentSource === 'deposit' || oldBooking.paymentSource === 'credit') {
                updatedUser = {
                    ...updatedUser,
                    balance: updatedUser.balance + (oldBooking.finalPrice || 0)
                };
            }

            // 2. Deduct New
            if (newBooking.paymentMethod === 'subscription' && updatedUser.subscription) {
                const hoursToDeduct = newBooking.hoursDeducted || (newBooking.duration / 60);
                updatedUser = {
                    ...updatedUser,
                    subscription: {
                        ...updatedUser.subscription,
                        remainingHours: Math.max(0, updatedUser.subscription.remainingHours - hoursToDeduct)
                    }
                };
            } else {
                updatedUser = {
                    ...updatedUser,
                    balance: updatedUser.balance - (newBooking.finalPrice || 0)
                };
            }

            updatedUsers = updatedUsers.map(u => u.email === currentUser.email ? updatedUser! : u);
        }

        return {
            bookings: [...updatedBookings, newBooking],
            users: updatedUsers,
            currentUser: state.currentUser?.email === currentUser.email ? updatedUser : state.currentUser
        };
    }),

    cancelBooking: async (id, _isFreeReschedule = false, _reason, _adminUser, opts) => {
        try {
            const cancelledBooking = await bookingsApi.cancelBooking(id, opts);
            set((state) => ({
                bookings: state.bookings.map(b =>
                    b.id === id ? cancelledBooking : b
                )
            }));

            // Force refresh from server to ensure consistency
            // Removing this to prevent race condition where stale GET overwrites the updated status
            // await get().fetchBookings();

            // Sync user balance/subscription
            await get().fetchCurrentUser();

        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            toast.error(detail || 'Не удалось отменить бронирование');
            throw error;
        }
    },

    updateBooking: (updatedBooking) => set((state) => ({
        bookings: state.bookings.map(b =>
            b.id === updatedBooking.id ? updatedBooking : b
        )
    })),

    listForReRent: async (id) => {
        try {
            // Persist the re-rent toggle on the server. Without this, the local
            // flip was overwritten the next time fetchAllBookings() ran, making
            // the re-rent status "disappear" when switching views.
            const updated = await bookingsApi.toggleReRent(id);
            set((state) => ({
                bookings: state.bookings.map(b =>
                    b.id === id ? updated : b
                )
            }));
        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            toast.error(detail || 'Не удалось изменить пересдачу. Попробуйте ещё раз');
            throw error;
        }
    },

    setManualPrice: (bookingId, newPrice) => {
        const state = get();
        const bookingIndex = state.bookings.findIndex(b => b.id === bookingId);
        if (bookingIndex === -1) return;

        const booking = state.bookings[bookingIndex];
        const oldPrice = booking.finalPrice;
        const diff = oldPrice - newPrice;

        let updatedUsers = [...state.users];
        let updatedUser = updatedUsers.find(u => u.email === booking.userId);

        if (updatedUser) {
            updatedUser = {
                ...updatedUser,
                balance: updatedUser.balance + diff
            };
            updatedUsers = updatedUsers.map(u => u.email === booking.userId ? updatedUser! : u);
        }

        const updatedBooking: BookingHistoryItem = {
            ...booking,
            finalPrice: newPrice,
            discountRule: 'MANUAL_OVERRIDE'
        };

        const updatedBookings = [...state.bookings];
        updatedBookings[bookingIndex] = updatedBooking;

        set({
            bookings: updatedBookings,
            users: updatedUsers,
            currentUser: state.currentUser?.email === updatedUser?.email ? updatedUser : state.currentUser
        });
    }
});
