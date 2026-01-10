import type { BookingState, Format } from '../types';
export type { Format };

export interface Subscription {
    id: string;
    name: string;
    totalHours: number;
    remainingHours: number;
    freeReschedules: number;
    expiryDate: string; // ISO string
    isFrozen: boolean;
    frozenUntil?: string; // ISO string
    includedFormats?: Format[];
}

export interface DiscountLogEntry {
    id: string;
    date: string;
    oldValue: number;
    newValue: number;
    reason: string;
    adminName: string;
}

export interface UserNote {
    id: string;
    text: string;
    date: string;
    adminName: string;
}

export interface User {
    id: string; // UUID from backend
    email: string;
    name: string;
    phone: string;
    level: 'basic' | 'loyal' | 'vip'; // Updated level types
    avatarUrl?: string;
    password?: string;
    balance: number;
    creditLimit: number;
    subscription?: Subscription;
    personalDiscountPercent?: number;
    discountHistory?: DiscountLogEntry[]; // New history
    pricingSystem?: 'standard' | 'personal';
    isAdmin?: boolean; // Legacy, keep for backward compat
    role?: 'owner' | 'senior_admin' | 'admin'; // Specific access role
    notes?: string; // Legacy simple note
    commentHistory?: UserNote[]; // New structured comments
    registrationDate?: string; // ISO string
    telegramId?: string; // Telegram User ID
    tags?: string[]; // Tag names or IDs
    adminTasks?: Task[];
    additionalContacts?: { type: string; value: string }[];
    manualStatus?: 'vip' | 'partner' | 'bad_client';
    profession?: string;
    targetAudience?: string[];
}

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    createdAt: string;
    dueDate?: string;
}

export interface BookingHistoryItem extends BookingState {
    id: string;
    userId: string;
    status: 'confirmed' | 'cancelled' | 'completed' | 're-rented' | 'rescheduled' | 'no_show';
    dateCreated: string;
    finalPrice: number;
    paymentSource?: 'subscription' | 'deposit' | 'credit';
    hoursDeducted?: number;
    isReRentListed?: boolean;
    price?: {
        basePrice: number;
        extrasTotal: number;
        discountAmount: number;
        discountRule?: string;
        finalPrice: number;
    };
    discountRule?: string;

    // CRM Extended Fields
    source?: 'telegram' | 'web' | 'admin';
    googleCalendarEventId?: string;
    cancellationReason?: string;
    cancelledBy?: string; // Admin Name/ID who cancelled
}

export interface WaitlistEntry {
    id: string;
    userId: string;
    resourceId: string;
    date: string;
    startTime: string;
    endTime: string;
    dateCreated: string;
    status: 'active' | 'fulfilled' | 'cancelled';
}

export interface AuthSlice {
    currentUser: User | null;
    login: (email: string, password?: string) => Promise<void>; // Make password optional for legacy compatibility, but async
    logout: () => void;
    register: (user: Partial<User> & { password?: string }) => Promise<void>;

    // New OAuth methods
    googleLogin: (token: string) => Promise<void>;
    telegramLogin: (data: any) => Promise<void>;
    fetchCurrentUser: () => Promise<void>;
}

export interface Credentials {
    email: string;
    password?: string;
}

export interface BookingSlice {
    bookings: BookingHistoryItem[];
    fetchBookings: () => Promise<void>;
    fetchAllBookings: () => Promise<void>; // Admin only
    addBooking: (booking: Omit<BookingHistoryItem, 'userId' | 'status'>) => Promise<void>;
    addBookings: (bookings: Omit<BookingHistoryItem, 'userId' | 'status'>[]) => Promise<void>;
    cancelBooking: (id: string, isFreeReschedule?: boolean, reason?: string, adminUser?: User) => void;
    rescheduleBooking: (oldId: string, newBooking: Omit<BookingHistoryItem, 'userId' | 'status'>) => void;
    updateBooking: (booking: BookingHistoryItem) => void;
    listForReRent: (id: string) => void;
    setManualPrice: (bookingId: string, newPrice: number) => void;
}

export interface UserSlice {
    users: User[];
    fetchUsers: () => Promise<void>;
    updateUser: (updates: Partial<User>) => Promise<void>;
    updateUserById: (userId: string, updates: Partial<User>) => Promise<void>;
    toggleSubscriptionFreeze: (userId: string) => Promise<void>;
    updatePersonalDiscount: (userId: string, percent: number, reason: string) => Promise<void>; // New action
    runWeeklyReconciliation: () => { amount: number, totalHours: number, discountPercent: number } | null;

    // CRM Actions
    addUserTag: (email: string, tag: string) => void;
    removeUserTag: (email: string, tag: string) => void;
    addUserTask: (email: string, task: Omit<Task, 'id' | 'createdAt'>) => void;
    toggleUserTask: (email: string, taskId: string) => void;
    removeUserTask: (email: string, taskId: string) => void;
    addUserComment: (email: string, text: string, adminName: string) => void;
}

export interface WaitlistSlice {
    waitlist: WaitlistEntry[];
    fetchWaitlist: () => Promise<void>;
    addToWaitlist: (entry: Omit<WaitlistEntry, 'id' | 'dateCreated' | 'status'>) => Promise<void>;
    removeFromWaitlist: (id: string) => Promise<void>;
}

// Finance & Audit
export interface Transaction {
    id: string;
    userId: string;
    // 'type' is legacy/high-level direction. 'category' is specific purpose.
    type: 'deposit' | 'subscription_purchase' | 'booking_payment' | 'manual_correction' | 'refund' | 'expense';
    category: 'booking' | 'subscription' | 'shop' | 'correction' | 'deposit';
    amount: number;
    currency: 'GEL' | 'USD' | 'EUR';
    paymentMethod: 'cash' | 'tbc' | 'bog' | 'balance' | 'admin_adjustment' | 'card' | 'transfer';
    status: 'completed' | 'pending' | 'failed' | 'refunded';
    adminId?: string; // If performed by admin
    adminName?: string;
    date: string;
    description?: string;
    relatedEntityId?: string; // Legacy single ID
    relatedEntityIds?: string[]; // New multiple IDs support
}

export interface FinanceSlice {
    transactions: Transaction[];
    addTransaction: (transaction: Omit<Transaction, 'id' | 'date' | 'currency' | 'status' | 'category'> & {
        currency?: Transaction['currency'];
        status?: Transaction['status'];
        category?: Transaction['category'];
    }) => void;
    getTransactionsByUser: (userId: string) => Transaction[];
}

export type UserStore = AuthSlice & BookingSlice & UserSlice & WaitlistSlice & FinanceSlice;
