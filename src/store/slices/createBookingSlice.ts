import type { StateCreator } from 'zustand';
import type { UserStore, BookingSlice, BookingHistoryItem } from '../types';
import { format } from 'date-fns';

const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const checkOverlap = (b1: BookingHistoryItem, b2: Omit<BookingHistoryItem, 'userId' | 'status'>) => {
    if (b1.resourceId !== b2.resourceId) return false;
    if (format(new Date(b1.date), 'yyyy-MM-dd') !== format(new Date(b2.date), 'yyyy-MM-dd')) return false;
    if (!b1.startTime || !b2.startTime) return false;

    const start1 = timeToMinutes(b1.startTime);
    const end1 = start1 + b1.duration;

    const start2 = timeToMinutes(b2.startTime);
    const end2 = start2 + b2.duration;

    return start1 < end2 && start2 < end1;
};

export const createBookingSlice: StateCreator<UserStore, [], [], BookingSlice> = (set, get) => ({
    bookings: [],

    addBooking: (bookingData) => {
        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return;

        const overlappingReRent = state.bookings.find(b =>
            b.status === 'confirmed' &&
            b.isReRentListed &&
            checkOverlap(b, bookingData)
        );

        let updatedUsers = [...state.users];
        let updatedBookings = [...state.bookings];

        if (overlappingReRent) {
            updatedBookings = updatedBookings.map(b =>
                b.id === overlappingReRent.id
                    ? { ...b, status: 're-rented' as const, isReRentListed: false }
                    : b
            );
            updatedUsers = updatedUsers.map(u =>
                u.email === overlappingReRent.userId
                    ? { ...u, balance: u.balance + (overlappingReRent.finalPrice * 0.5) }
                    : u
            );
        }

        const newBooking: BookingHistoryItem = {
            ...bookingData,
            userId: currentUser.email,
            status: 'confirmed',
            dateCreated: new Date().toISOString(),
            finalPrice: bookingData.finalPrice,
            source: bookingData.source || 'admin' // Default to admin if not specified
        };
        updatedBookings.push(newBooking);

        let updatedUser = updatedUsers.find(u => u.email === currentUser.email);
        if (updatedUser) {
            if (bookingData.paymentMethod === 'subscription' && updatedUser.subscription) {
                const hoursToDeduct = bookingData.hoursDeducted || (bookingData.duration / 60);
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
                    balance: updatedUser.balance - bookingData.finalPrice
                };
            }
            updatedUsers = updatedUsers.map(u => u.email === currentUser.email ? updatedUser! : u);
        }

        const newCurrentUser = updatedUsers.find(u => u.email === currentUser.email) || currentUser;

        set({
            bookings: updatedBookings,
            users: updatedUsers,
            currentUser: newCurrentUser
        });
    },

    addBookings: (bookingsData) => {
        const state = get();
        const currentUser = state.currentUser;
        if (!currentUser) return;

        let updatedUsers = [...state.users];
        let updatedBookings = [...state.bookings];

        bookingsData.forEach(bookingData => {
            const overlappingReRent = updatedBookings.find(b =>
                b.status === 'confirmed' &&
                b.isReRentListed &&
                checkOverlap(b, bookingData)
            );

            if (overlappingReRent) {
                updatedBookings = updatedBookings.map(b =>
                    b.id === overlappingReRent.id
                        ? { ...b, status: 're-rented' as const, isReRentListed: false }
                        : b
                );
                updatedUsers = updatedUsers.map(u =>
                    u.email === overlappingReRent.userId
                        ? { ...u, balance: u.balance + (overlappingReRent.finalPrice * 0.5) }
                        : u
                );
            }

            const newBooking: BookingHistoryItem = {
                ...bookingData,
                userId: currentUser.email,
                status: 'confirmed',
                dateCreated: new Date().toISOString(),
                finalPrice: bookingData.finalPrice
            };
            updatedBookings.push(newBooking);
        });

        let userToUpdate = updatedUsers.find(u => u.email === currentUser.email);
        if (userToUpdate) {
            bookingsData.forEach(bd => {
                if (bd.paymentMethod === 'subscription' && userToUpdate!.subscription) {
                    const hoursToDeduct = bd.hoursDeducted || (bd.duration / 60);
                    userToUpdate = {
                        ...userToUpdate!,
                        subscription: {
                            ...userToUpdate!.subscription!,
                            remainingHours: Math.max(0, userToUpdate!.subscription!.remainingHours - hoursToDeduct)
                        }
                    };
                } else {
                    userToUpdate = {
                        ...userToUpdate!,
                        balance: userToUpdate!.balance - bd.finalPrice
                    };
                }
            });
            updatedUsers = updatedUsers.map(u => u.email === currentUser.email ? userToUpdate! : u);
        }

        const newCurrentUser = updatedUsers.find(u => u.email === currentUser.email) || currentUser;

        set({
            bookings: updatedBookings,
            users: updatedUsers,
            currentUser: newCurrentUser
        });
    },

    rescheduleBooking: (oldId, newBookingData) => set((state) => {
        const currentUser = state.currentUser;
        if (!currentUser) return state;

        const newBooking: BookingHistoryItem = {
            ...newBookingData,
            userId: currentUser.email,
            status: 'confirmed',
            dateCreated: new Date().toISOString(),
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

    cancelBooking: (id, _isFreeReschedule = false, reason, adminUser) => { // Updated signature
        const state = get();
        const booking = state.bookings.find(b => b.id === id);
        if (!booking) return;

        let bookingTime = new Date(booking.date).getTime();
        if (booking.startTime) {
            const [h, m] = booking.startTime.split(':').map(Number);
            const d = new Date(booking.date);
            d.setHours(h, m, 0, 0);
            bookingTime = d.getTime();
        }

        const now = Date.now();
        const hoursUntilStart = (bookingTime - now) / (1000 * 60 * 60);

        // Permission Constraint Logic
        if (hoursUntilStart < 24) {
            // If Admin (not Owner/Senior) -> BLOCK
            if (adminUser && adminUser.role === 'admin') {
                // Throw error or handle by UI? ideally return result, but for now allow alert and return
                // In slice we usually just return, UI should check this BEFORE calling if possible,
                // OR we throw error. Let's assume UI checks too, but strict check here.
                console.error('Permission denied: Admin cannot cancel <24h');
                return;
            }

            // If Owner/Senior -> REQUIRE REASON
            if (!reason) {
                console.error('Reason required for <24h cancellation');
                return;
            }
        }


        let updatedUsers = [...state.users];
        let updatedUser = updatedUsers.find(u => u.email === booking.userId);

        if (updatedUser) {
            if (booking.paymentMethod === 'subscription' && updatedUser.subscription) {
                const hoursToRefund = booking.hoursDeducted || (booking.duration / 60);
                updatedUser = {
                    ...updatedUser,
                    subscription: {
                        ...updatedUser.subscription,
                        remainingHours: updatedUser.subscription.remainingHours + hoursToRefund
                    }
                };
            } else {
                updatedUser = {
                    ...updatedUser,
                    balance: updatedUser.balance + booking.finalPrice
                };
            }
            updatedUsers = updatedUsers.map(u => u.email === booking.userId ? updatedUser! : u);
        }

        const newCurrentUser = updatedUsers.find(u => u.email === updatedUser?.email) || state.currentUser;

        // Log Timeline Event for Forced Cancellation if < 24h
        // (Handled by UI mostly, or we can trigger it here if we had timeline store access. 
        // For now, Timeline is COMPUTED from data. So we just need to save the data fields!)

        set({
            bookings: state.bookings.map(b =>
                b.id === id ? {
                    ...b,
                    status: 'cancelled',
                    cancellationReason: reason,
                    cancelledBy: adminUser ? adminUser.name : 'System'
                } : b
            ),
            users: updatedUsers,
            currentUser: newCurrentUser
        });
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
