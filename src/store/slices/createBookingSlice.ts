import type { StateCreator } from 'zustand';
import { toast } from 'sonner';
import type { UserStore, BookingSlice, BookingHistoryItem } from '../types';
import { bookingsApi } from '../../api/bookings';

export const createBookingSlice: StateCreator<UserStore, [], [], BookingSlice> = (set, get) => ({
    bookings: [],

    fetchBookings: async () => {
        try {
            // Use Promise.allSettled to fetch both in parallel and survive individual failures
            const [myResult, publicResult] = await Promise.allSettled([
                bookingsApi.getMyBookings(),
                bookingsApi.getPublicBookings()
            ]);

            let myBookings: BookingHistoryItem[] = [];
            let publicBookings: BookingHistoryItem[] = [];

            if (myResult.status === 'fulfilled') {
                myBookings = myResult.value;
            }

            if (publicResult.status === 'fulfilled') {
                publicBookings = publicResult.value;
            }

            // 3. Merge: prefer 'myBookings' (more details) over 'publicBookings'
            const myIds = new Set(myBookings.map(b => b.id));
            const uniquePublic = publicBookings.filter(b => !myIds.has(b.id));

            set({ bookings: [...myBookings, ...uniquePublic] });
        } catch (error) {
            toast.error('Не удалось загрузить бронирования');
        }
    },

    fetchAllBookings: async () => {
        try {
            const bookings = await bookingsApi.getAllBookings();
            set({ bookings });
        } catch (error) {
            toast.error('Не удалось загрузить бронирования');
        }
    },

    addBooking: async (bookingData) => {
        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return null;

        try {
            const newBooking = await bookingsApi.createBooking({
                ...bookingData,
                finalPrice: bookingData.finalPrice,
                paymentMethod: bookingData.paymentMethod
            });

            set((state) => ({ bookings: [...state.bookings, newBooking] }));

            // Fetch updated user to reflect balance/subscription changes from backend
            await get().fetchCurrentUser();

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
            await get().addBooking(bookingsData[0]);
            return;
        }
        // Multi-slot batch path
        try {
            const first = bookingsData[0] as any;
            await bookingsApi.createMultiSlotBooking({
                slots: bookingsData.map((b: any) => ({
                    resourceId: b.resourceId,
                    locationId: b.locationId || 'unbox_one',
                    date: typeof b.date === 'string' ? b.date : new Date(b.date).toISOString().slice(0, 10),
                    startTime: b.startTime,
                    duration: b.duration,
                    format: b.format || 'individual',
                })),
                paymentMethod: first.paymentMethod || 'balance',
                targetUserId: first.targetUserId,
                crmClientId: first.crmClientId,
            });
            // Refetch state so store matches server truth
            await get().fetchCurrentUser();
            const fetchAllBookings = (get() as any).fetchAllBookings;
            if (typeof fetchAllBookings === 'function') {
                await fetchAllBookings();
            }
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
            toast.error(detail || 'Не удалось обновить статус переаренды');
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
