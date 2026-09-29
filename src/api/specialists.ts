import { api } from './client';

// Поля в camelCase — так их реально видит фронт: интерцептор ответа в
// client.ts переводит все ключи из snake_case (start_time → startTime).
// Раньше тут были snake_case-типы, и запись к специалисту читала
// undefined вместо времени (слоты без часов, запрос без start_time → 422).
// Тела запросов интерцептор переводит обратно в snake_case, так что
// бэкенд по-прежнему получает start_time / location_id / client_name.

export interface ScheduleSlot {
    id?: string;
    dayOfWeek?: number | null;  // 0=Mon..6=Sun
    specificDate?: string | null;  // "YYYY-MM-DD"
    startTime: string;
    endTime: string;
    locationId: string | null;  // null = online
    isAvailable: boolean;
}

export interface AvailableSlot {
    date: string;
    startTime: string;
    endTime: string;
    locationId: string | null;
}

export interface Appointment {
    id: string;
    specialistId: string;
    clientName: string;
    clientPhone?: string | null;
    clientEmail?: string | null;
    date: string;
    startTime: string;
    duration: number;
    locationId: string | null;
    status: string;
    notes?: string | null;
    createdAt: string;
}

export interface AppointmentCreate {
    clientName: string;
    clientPhone?: string;
    clientEmail?: string;
    date: string;
    startTime: string;
    duration?: number;
    locationId?: string | null;
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
