import type { StateCreator } from 'zustand';
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
            } else {
                console.error("Failed to fetch my bookings", myResult.reason);
            }

            if (publicResult.status === 'fulfilled') {
                publicBookings = publicResult.value;
            } else {
                console.error("Failed to fetch public bookings", publicResult.reason);
            }

            // 3. Merge: prefer 'myBookings' (more details) over 'publicBookings'
            const myIds = new Set(myBookings.map(b => b.id));
            const uniquePublic = publicBookings.filter(b => !myIds.has(b.id));

            set({ bookings: [...myBookings, ...uniquePublic] });
        } catch (error) {
            console.error("Failed to fetch bookings (Critical)", error);
        }
    },

    fetchAllBookings: async () => {
        try {
            const bookings = await bookingsApi.getAllBookings();
            set({ bookings });
        } catch (error) {
            console.error("Failed to fetch all bookings", error);
        }
    },

    addBooking: async (bookingData) => {
        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return;

        try {
            const newBooking = await bookingsApi.createBooking({
                ...bookingData,
                finalPrice: bookingData.finalPrice,
                paymentMethod: bookingData.paymentMethod
            });

            set((state) => ({ bookings: [...state.bookings, newBooking] }));

            // Fetch updated user to reflect balance/subscription changes from backend
            await get().fetchCurrentUser();

        } catch (error) {
            console.error("Failed to create booking", error);
            throw error;
        }
    },

    // addBooking(s) batch is rarely used now, but we can keep it for data migration if needed
    // or deprecate it. Leaving as no-op or mapping to loop for now.
    addBookings: async (bookingsData) => {
        for (const b of bookingsData) {
            await get().addBooking(b);
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

    cancelBooking: async (id, _isFreeReschedule = false, _reason, _adminUser) => {
        try {
            const cancelledBooking = await bookingsApi.cancelBooking(id);
            set((state) => ({
                bookings: state.bookings.map(b =>
                    b.id === id ? cancelledBooking : b
                )
            }));

            // Sync user balance/subscription
            await get().fetchCurrentUser();

        } catch (error) {
            console.error("Failed to cancel booking", error);
        }
    },

    updateBooking: (updatedBooking) => set((state) => ({
        bookings: state.bookings.map(b =>
            b.id === updatedBooking.id ? updatedBooking : b
        )
    })),

    listForReRent: (id) => set((state) => ({
        bookings: state.bookings.map(b =>
            b.id === id ? { ...b, isReRentListed: true } : b
        )
    })),

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
