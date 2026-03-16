import { api } from './client';

export interface AppNotification {
    id: string;
    type: string;
    title: string;
    description: string;
    icon?: string;
    link?: string;
    recipientId: string;
    isRead: boolean;
    createdAt: string;
}

export const notificationsApi = {
    getNotifications: async (params?: { unreadOnly?: boolean; limit?: number }) => {
        const { data } = await api.get<AppNotification[]>('/notifications/', {
            params: { unread_only: params?.unreadOnly, limit: params?.limit },
        });
        return data;
    },

    getUnreadCount: async (): Promise<number> => {
        const { data } = await api.get<{ count: number }>('/notifications/unread-count');
        return data.count;
    },

    markRead: async (id: string) => {
        await api.post(`/notifications/${id}/read`);
    },

    markAllRead: async () => {
        await api.post('/notifications/read-all');
    },
};
