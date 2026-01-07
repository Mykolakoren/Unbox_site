import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { BookingState, Format } from '../types';
import { format } from 'date-fns';

export interface Subscription {
    id: string;
    name: string;
    totalHours: number;
    remainingHours: number;
    freeReschedules: number;
    expiryDate: string; // ISO string
    isFrozen: boolean;
    frozenUntil?: string; // ISO string
    includedFormats?: Format[]; // Formats eligible for this subscription
}

export interface User {
    email: string;
    name: string;
    phone: string;
    level: 'none' | 'silver' | 'gold';
    password?: string; // Mock password
    balance: number;
    creditLimit: number; // Max negative balance allowed
    subscription?: Subscription;
}

export interface BookingHistoryItem extends BookingState {
    id: string;
    userId: string; // Owner email
    status: 'confirmed' | 'cancelled' | 'completed' | 're-rented';
    dateCreated: string; // ISO string
    finalPrice: number;
    isReRentListed?: boolean;
    hoursDeducted?: number; // Added
    price?: {
        basePrice: number;
        extrasTotal: number;
        discountAmount: number;
        discountRule?: string;
        finalPrice: number;
    };
    paymentSource?: 'subscription' | 'deposit' | 'credit';
}

interface UserStore {
    currentUser: User | null; // Logged in user
    users: User[]; // All fully registered users (Mock DB)
    bookings: BookingHistoryItem[]; // All bookings (Mock DB)

    // Actions
    login: (email: string, name?: string) => void;
    logout: () => void;
    register: (user: User) => void;

    // Booking Actions
    addBooking: (booking: Omit<BookingHistoryItem, 'userId' | 'status'>) => void;
    addBookings: (bookings: Omit<BookingHistoryItem, 'userId' | 'status'>[]) => void;
    cancelBooking: (id: string, isFreeReschedule?: boolean) => void; // Updated for subscription
    updateBooking: (booking: BookingHistoryItem) => void;
    listForReRent: (id: string) => void;
    updateUser: (updates: Partial<User>) => void;

    // Subscription Actions
    toggleSubscriptionFreeze: (userId: string) => void;
}

// Helper to check overlap
const timeToMinutes = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

const checkOverlap = (b1: BookingHistoryItem, b2: Omit<BookingHistoryItem, 'userId' | 'status'>) => {
    if (b1.resourceId !== b2.resourceId) return false;
    if (format(new Date(b1.date), 'yyyy-MM-dd') !== format(new Date(b2.date), 'yyyy-MM-dd')) return false;
    if (!b1.startTime || !b2.startTime) return false; // Safety check

    const start1 = timeToMinutes(b1.startTime);
    const end1 = start1 + b1.duration;

    const start2 = timeToMinutes(b2.startTime);
    const end2 = start2 + b2.duration;

    // Check intersection: start1 < end2 && start2 < end1
    return start1 < end2 && start2 < end1;
};

export const useUserStore = create<UserStore>()(
    persist(
        (set, get) => ({
            currentUser: null,
            users: [],
            bookings: [],

            login: (email, name) => {
                const state = get();
                const existingUser = state.users.find(u => u.email === email);

                if (existingUser) {
                    // Patch existing user if missing subscription (Migration)
                    if (!existingUser.subscription) {
                        const patchedUser = {
                            ...existingUser,
                            subscription: {
                                id: 'sub-existing',
                                name: 'Unbox Pro (Promo)',
                                totalHours: 20,
                                remainingHours: 12.5,
                                freeReschedules: 2,
                                expiryDate: '2026-01-30T00:00:00.000Z',
                                isFrozen: false,
                                includedFormats: ['individual'] as Format[]
                            }
                        };

                        const updatedUsers = state.users.map(u => u.email === email ? patchedUser : u);
                        set({
                            users: updatedUsers,
                            currentUser: patchedUser
                        });
                    } else {
                        set({ currentUser: existingUser });
                    }
                } else if (name) {
                    // Auto-register mock
                    const newUser: User = {
                        email,
                        name,
                        phone: '',
                        level: 'none',
                        balance: 0,
                        creditLimit: 0, // Default 0 to enforce deposit logic
                        // Mock Subscription for demo if needed, or null
                        subscription: {
                            id: 'sub-123',
                            name: 'Unbox Pro',
                            totalHours: 20,
                            remainingHours: 12.5,
                            freeReschedules: 2,
                            expiryDate: '2026-01-30T00:00:00.000Z',
                            isFrozen: false,
                            includedFormats: ['individual'] as Format[]
                        }
                    };
                    set({
                        users: [...state.users, newUser],
                        currentUser: newUser
                    });
                }
            },

            logout: () => set({ currentUser: null }),
            register: (user) => set((state) => ({
                users: [...state.users, user],
                currentUser: user
            })),

            addBooking: (bookingData) => {
                const state = get();
                const currentUser = state.currentUser;
                if (!currentUser) return;

                // Check overlap logic
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
                };
                updatedBookings.push(newBooking);

                // Handle Payment
                let updatedUser = updatedUsers.find(u => u.email === currentUser.email);
                if (updatedUser) {
                    if (bookingData.paymentMethod === 'subscription' && updatedUser.subscription) {
                        // Deduct Hours
                        const hoursToDeduct = bookingData.hoursDeducted || (bookingData.duration / 60);
                        updatedUser = {
                            ...updatedUser,
                            subscription: {
                                ...updatedUser.subscription,
                                remainingHours: Math.max(0, updatedUser.subscription.remainingHours - hoursToDeduct)
                            }
                        };
                    } else {
                        // Default: Deduct Balance
                        updatedUser = {
                            ...updatedUser,
                            balance: updatedUser.balance - bookingData.finalPrice
                        };
                    }
                    // Update in array
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

                // Process each booking
                bookingsData.forEach(bookingData => {
                    // Check overlap logic
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
                    };
                    updatedBookings.push(newBooking);

                    // Handle Payment Accumulation
                    // Note: We need to handle this carefully. Logic is per-user.
                    // Since we are checking overlappingReRent for *other* users, we update them.
                    // But for the *currentUser*, we need to accumulate deductions.
                });

                // Recalculate Current User Debits
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

                    // Apply back to users array
                    updatedUsers = updatedUsers.map(u => u.email === currentUser.email ? userToUpdate! : u);
                }

                const newCurrentUser = updatedUsers.find(u => u.email === currentUser.email) || currentUser;

                set({
                    bookings: updatedBookings,
                    users: updatedUsers,
                    currentUser: newCurrentUser
                });
            },

            cancelBooking: (id) => set((state) => {
                return {
                    bookings: state.bookings.map(b =>
                        b.id === id ? { ...b, status: 'cancelled' } : b
                    )
                };
            }),

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

            updateUser: (updates) => set((state) => {
                if (!state.currentUser) return state;
                const updatedUser = { ...state.currentUser, ...updates };
                return {
                    currentUser: updatedUser,
                    users: state.users.map(u => u.email === state.currentUser?.email ? updatedUser : u)
                };
            }),

            toggleSubscriptionFreeze: (userId) => set((state) => {
                const userIndex = state.users.findIndex(u => u.email === userId);
                if (userIndex === -1) return state;

                const user = state.users[userIndex];
                if (!user.subscription) return state;

                const newSubscription = {
                    ...user.subscription,
                    isFrozen: !user.subscription.isFrozen,
                    frozenUntil: !user.subscription.isFrozen
                        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // Default 7 days freeze
                        : undefined
                };

                const updatedUser = { ...user, subscription: newSubscription };
                const updatedUsers = [...state.users];
                updatedUsers[userIndex] = updatedUser;

                return {
                    users: updatedUsers,
                    currentUser: state.currentUser?.email === userId ? updatedUser : state.currentUser
                };
            }),
        }),
        {
            name: 'unbox-user-storage',
        }
    )
);
