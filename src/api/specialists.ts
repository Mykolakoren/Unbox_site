import { api } from './client';

export interface ScheduleSlot {
    id?: string;
    day_of_week?: number | null;  // 0=Mon..6=Sun
    specific_date?: string | null;  // "YYYY-MM-DD"
    start_time: string;
    end_time: string;
    location_id: string | null;  // null = online
    is_available: boolean;
}

export interface AvailableSlot {
    date: string;
    start_time: string;
    end_time: string;
    location_id: string | null;
}

export interface Appointment {
    id: string;
    specialist_id: string;
    client_name: string;
    client_phone?: string;
    client_email?: string;
    date: string;
    start_time: string;
    duration: number;
    location_id: string | null;
    status: string;
    notes?: string;
    created_at: string;
}

export interface AppointmentCreate {
    client_name: string;
    client_phone?: string;
    client_email?: string;
    date: string;
    start_time: string;
    duration?: number;
    location_id?: string | null;
    notes?: string;
}

// ─── Self-service application flow ──────────────────────────────────────────
// Used by /become-specialist. Returns the user's own profile (or 404) and
// lets them submit/resubmit. Admin then reviews and toggles is_verified.

export interface SpecialistApplicationPayload {
    firstName: string;
    lastName: string;
    photoUrl?: string;
    tagline?: string;
    bio?: string;
    specializations: string[];
    formats: string[];
    basePriceGel: number;
    category?: string;
    documents: string[];
    instagram?: string;
    telegram?: string;
    website?: string;
}

export interface SpecialistProfile {
    id: string;
    userId: string | null;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    tagline: string;
    bio: string;
    specializations: string[];
    formats: string[];
    basePriceGel: number;
    category: string | null;
    isVerified: boolean;
    applicationStatus: 'pending' | 'approved' | 'rejected' | null;
    sortOrder: number;
    documents: string[];
    badges: string[];
    instagram?: string | null;
    telegram?: string | null;
    website?: string | null;
}

export const specialistsApi = {
    // ── Self-service application ──
    // Returns null on 404 (no profile yet) instead of throwing — the page
    // distinguishes "draft mode" vs "edit mode" by null-ness, which is
    // cleaner than try/catch threading through React.
    getMine: async (): Promise<SpecialistProfile | null> => {
        try {
            const r = await api.get('/specialists/me');
            return r.data;
        } catch (e: any) {
            if (e?.response?.status === 404) return null;
            throw e;
        }
    },

    apply: async (payload: SpecialistApplicationPayload): Promise<SpecialistProfile> => {
        const r = await api.post('/specialists/apply', payload);
        return r.data;
    },

    adminApprove: async (specialistId: string): Promise<SpecialistProfile> => {
        const r = await api.post(`/specialists/admin/${specialistId}/approve`);
        return r.data;
    },

    adminReject: async (specialistId: string): Promise<SpecialistProfile> => {
        const r = await api.post(`/specialists/admin/${specialistId}/reject`);
        return r.data;
    },

    adminList: async (): Promise<SpecialistProfile[]> => {
        const r = await api.get('/specialists/admin/all');
        return r.data;
    },

    // Schedule
    getSchedule: async (specialistId: string): Promise<ScheduleSlot[]> => {
        const r = await api.get(`/specialists/${specialistId}/schedule`);
        return r.data;
    },

    updateSchedule: async (specialistId: string, slots: Omit<ScheduleSlot, 'id'>[]): Promise<void> => {
        await api.put(`/specialists/${specialistId}/schedule`, slots);
    },

    // Available slots
    getAvailableSlots: async (
        specialistId: string,
        dateFrom: string,
        dateTo: string,
        locationId?: string | null,
    ): Promise<AvailableSlot[]> => {
        const params: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
        if (locationId !== undefined && locationId !== null) params.location_id = locationId;
        const r = await api.get(`/specialists/${specialistId}/available-slots`, { params });
        return r.data;
    },

    // Appointments
    getAppointments: async (
        specialistId: string,
        dateFrom?: string,
        dateTo?: string,
    ): Promise<Appointment[]> => {
        const params: Record<string, string> = {};
        if (dateFrom) params.date_from = dateFrom;
        if (dateTo) params.date_to = dateTo;
        const r = await api.get(`/specialists/${specialistId}/appointments`, { params });
        return r.data;
    },

    createAppointment: async (specialistId: string, data: AppointmentCreate): Promise<Appointment> => {
        const r = await api.post(`/specialists/${specialistId}/appointments`, data);
        return r.data;
    },

    cancelAppointment: async (specialistId: string, appointmentId: string): Promise<void> => {
        await api.delete(`/specialists/${specialistId}/appointments/${appointmentId}`);
    },
};
