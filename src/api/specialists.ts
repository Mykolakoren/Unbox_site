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

export const specialistsApi = {
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
