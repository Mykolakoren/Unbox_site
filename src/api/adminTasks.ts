import { api } from './client';

export interface AdminTask {
    id: string;
    title: string;
    description: string;
    status: 'TODO' | 'IN_PROGRESS' | 'DONE';
    priority: 'LOW' | 'MEDIUM' | 'HIGH';
    assigneeId?: string;
    assigneeName?: string;
    deadline?: string;
    labels: string[];
    checklist: ChecklistItem[];
    sortOrder: number;
    createdBy: string;
    createdByName: string;
    createdAt: string;
    updatedAt: string;
}

export interface ChecklistItem {
    id: string;
    text: string;
    done: boolean;
}

export interface AdminTaskComment {
    id: string;
    taskId: string;
    authorId: string;
    authorName: string;
    text: string;
    createdAt: string;
}

export interface CreateTaskPayload {
    title: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    assigneeName?: string;
    deadline?: string;
    labels?: string[];
    checklist?: ChecklistItem[];
    sortOrder?: number;
}

export interface UpdateTaskPayload {
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    assigneeId?: string;
    assigneeName?: string;
    deadline?: string | null;
    labels?: string[];
    checklist?: ChecklistItem[];
    sortOrder?: number;
}

export const adminTasksApi = {
    list: async (filters?: { status?: string; assigneeId?: string; priority?: string }): Promise<AdminTask[]> => {
        const response = await api.get('/admin/tasks/', { params: filters });
        return response.data;
    },

    create: async (data: CreateTaskPayload): Promise<AdminTask> => {
        const response = await api.post('/admin/tasks/', data);
        return response.data;
    },

    get: async (id: string): Promise<AdminTask> => {
        const response = await api.get(`/admin/tasks/${id}`);
        return response.data;
    },

    update: async (id: string, data: UpdateTaskPayload): Promise<AdminTask> => {
        const response = await api.patch(`/admin/tasks/${id}`, data);
        return response.data;
    },

    delete: async (id: string): Promise<void> => {
        await api.delete(`/admin/tasks/${id}`);
    },

    reorder: async (items: { id: string; sortOrder: number; status?: string }[]): Promise<void> => {
        await api.patch('/admin/tasks/batch/reorder', { items });
    },

    // Comments
    listComments: async (taskId: string): Promise<AdminTaskComment[]> => {
        const response = await api.get(`/admin/tasks/${taskId}/comments`);
        return response.data;
    },

    addComment: async (taskId: string, text: string): Promise<AdminTaskComment> => {
        const response = await api.post(`/admin/tasks/${taskId}/comments`, { text });
        return response.data;
    },
};
